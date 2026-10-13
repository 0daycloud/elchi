//! Learning from corrections on macOS: after Elchi pastes a dictation, it watches the
//! text field it pasted into for a minute (through Accessibility, which Elchi already
//! has to paste) and, once the user stops, compares what it pasted with what that
//! stretch of text became. A fixed name becomes a dictionary entry (crate::dictionary).
//!
//! Only the pasted stretch is compared, and only while the text around it is
//! unchanged: if the user edits elsewhere or moves to another field, the watch ends
//! with what it last saw. Nothing read here leaves the computer. Fields that do not
//! expose their text (password fields, some custom editors) are simply not watched.

use std::ffi::c_void;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use core_foundation::base::{CFType, CFTypeRef, TCFType};
use core_foundation::string::{CFString, CFStringRef};
use tauri::AppHandle;

/// When to look again after pasting, in seconds from the paste.
const LOOKS: [u64; 6] = [3, 6, 12, 20, 35, 60];
/// Longer fields are not watched (a whole document is not a dictation's context).
const MAX_FIELD_UTF16: usize = 200_000;

static GENERATION: AtomicU64 = AtomicU64::new(0);

type AXUIElementRef = *const c_void;
type AXValueRef = *const c_void;

#[repr(C)]
#[derive(Default, Clone, Copy)]
struct CFRange {
    location: isize,
    length: isize,
}

const K_AX_VALUE_CF_RANGE_TYPE: u32 = 4;

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXUIElementCreateSystemWide() -> AXUIElementRef;
    fn AXUIElementCopyAttributeValue(
        element: AXUIElementRef,
        attribute: CFStringRef,
        value: *mut CFTypeRef,
    ) -> i32;
    fn AXValueGetValue(value: AXValueRef, the_type: u32, value_ptr: *mut c_void) -> bool;
}

/// The focused text field of whatever app is in front.
struct Field(CFType);

// AXUIElement is a CF object that may be used from any thread.
unsafe impl Send for Field {}

fn attribute(element: AXUIElementRef, name: &'static str) -> Option<CFType> {
    let name = CFString::from_static_string(name);
    let mut value: CFTypeRef = std::ptr::null();
    let err =
        unsafe { AXUIElementCopyAttributeValue(element, name.as_concrete_TypeRef(), &mut value) };
    (err == 0 && !value.is_null()).then(|| unsafe { CFType::wrap_under_create_rule(value) })
}

impl Field {
    fn focused() -> Option<Field> {
        let system =
            unsafe { CFType::wrap_under_create_rule(AXUIElementCreateSystemWide() as CFTypeRef) };
        attribute(
            system.as_CFTypeRef() as AXUIElementRef,
            "AXFocusedUIElement",
        )
        .map(Field)
    }

    fn text(&self) -> Option<Vec<u16>> {
        let value = attribute(self.0.as_CFTypeRef() as AXUIElementRef, "AXValue")?;
        let s = value.downcast::<CFString>()?.to_string();
        let utf16: Vec<u16> = s.encode_utf16().collect();
        (utf16.len() <= MAX_FIELD_UTF16).then_some(utf16)
    }

    /// Where the insertion point is, in UTF-16 units (the end of the selection).
    fn caret(&self) -> Option<usize> {
        let value = attribute(
            self.0.as_CFTypeRef() as AXUIElementRef,
            "AXSelectedTextRange",
        )?;
        let mut range = CFRange::default();
        let ok = unsafe {
            AXValueGetValue(
                value.as_CFTypeRef() as AXValueRef,
                K_AX_VALUE_CF_RANGE_TYPE,
                &mut range as *mut _ as *mut c_void,
            )
        };
        (ok && range.location >= 0).then(|| (range.location + range.length.max(0)) as usize)
    }
}

/// Where `pasted` sits in `field`: the occurrence ending at or just before the caret
/// (a trailing space may follow it), else the last one. UTF-16 offsets.
pub fn locate(field: &[u16], pasted: &[u16], caret: Option<usize>) -> Option<(usize, usize)> {
    if pasted.is_empty() || pasted.len() > field.len() {
        return None;
    }
    let ends: Vec<usize> = (pasted.len()..=field.len())
        .filter(|&end| field[end - pasted.len()..end] == *pasted)
        .collect();
    let end = match caret {
        Some(c) => ends
            .iter()
            .copied()
            .rev()
            .find(|&e| e <= c && c - e <= 2)
            .or_else(|| ends.last().copied()),
        None => ends.last().copied(),
    }?;
    Some((end - pasted.len(), end))
}

/// What the stretch `start..end` of `before` became in `after`, provided the text
/// before and after it is unchanged.
pub fn region_after(before: &[u16], start: usize, end: usize, after: &[u16]) -> Option<Vec<u16>> {
    let (prefix, suffix) = (&before[..start], &before[end..]);
    if after.len() < prefix.len() + suffix.len()
        || !after.starts_with(prefix)
        || !after.ends_with(suffix)
    {
        return None;
    }
    Some(after[prefix.len()..after.len() - suffix.len()].to_vec())
}

/// Watches the field `pasted` just went into; learns from what the user changes.
pub fn start(app: &AppHandle, pasted: String) {
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(700)); // let the paste land
        let Some(field) = Field::focused() else {
            return;
        };
        let Some(before) = field.text() else { return };
        let pasted16: Vec<u16> = pasted.encode_utf16().collect();
        let Some((start, end)) = locate(&before, &pasted16, field.caret()) else {
            log::debug!("Dictionary watch: the pasted text is not readable in the focused field");
            return;
        };
        let mut last = pasted16.clone();
        let mut waited = 0;
        for at in LOOKS {
            std::thread::sleep(Duration::from_secs(at - waited));
            waited = at;
            let Some(now) = field.text() else { break };
            match region_after(&before, start, end, &now) {
                Some(region) => last = region,
                None => break, // edited elsewhere, or a different text now
            }
            if GENERATION.load(Ordering::SeqCst) != generation {
                break; // a new dictation: learn from what this one became so far
            }
        }
        if last != pasted16 {
            let edited = String::from_utf16_lossy(&last);
            super::learn_from_edit(&app, &pasted, &edited);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u(s: &str) -> Vec<u16> {
        s.encode_utf16().collect()
    }

    #[test]
    fn the_paste_is_found_at_the_caret() {
        let field = u("Merhaba. Raporu Kan'a gönder. Raporu Kan'a gönder. ");
        let pasted = u("Raporu Kan'a gönder.");
        let second = (30, 30 + pasted.len());
        assert_eq!(locate(&field, &pasted, Some(second.1 + 1)), Some(second)); // trailing space
        assert_eq!(
            locate(&field, &pasted, Some(29)),
            Some((9, 9 + pasted.len()))
        );
        assert_eq!(locate(&field, &pasted, None), Some(second));
        assert_eq!(locate(&field, &u("yok"), None), None);
    }

    #[test]
    fn an_edit_inside_the_paste_is_recovered() {
        let before = u("Selam! Raporu Kan'a gönder. Görüşürüz.");
        let start = 7;
        let end = start + u("Raporu Kan'a gönder.").len();
        let after = u("Selam! Raporu Kaan'a gönder. Görüşürüz.");
        assert_eq!(
            region_after(&before, start, end, &after),
            Some(u("Raporu Kaan'a gönder."))
        );
    }

    #[test]
    fn an_edit_outside_the_paste_ends_the_watch() {
        let before = u("Selam! Raporu Kan'a gönder.");
        let (start, end) = (7, before.len());
        assert_eq!(
            region_after(&before, start, end, &u("Merhaba! Raporu Kan'a gönder.")),
            None
        );
        assert_eq!(region_after(&before, start, end, &u("")), None);
    }

    #[test]
    fn turkish_text_is_measured_in_utf16() {
        let field = u("İyi günler. Şükrü’ye söyle.");
        let pasted = u("Şükrü’ye söyle.");
        let (s, e) = locate(&field, &pasted, None).unwrap();
        assert_eq!(String::from_utf16_lossy(&field[s..e]), "Şükrü’ye söyle.");
    }
}
