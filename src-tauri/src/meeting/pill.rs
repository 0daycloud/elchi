//! The meeting pill: while a meeting is recorded, a tiny floating pill at the right edge of
//! the screen (Elchi's mark and both sides' levels), like Granola's. Hovering it opens the
//! live transcript beside it; clicking it brings Elchi's window to the meeting. It never
//! takes focus, sits above full-screen apps, and is left out of screen sharing.
//!
//! Like the recording overlay, the panel is created once, hidden, when Elchi starts, and
//! then only shown and hidden: made at the meeting's start, its page had not drawn yet and
//! the pill stayed invisible until Elchi's window was brought up; and destroying an NSPanel
//! that tauri-nspanel made crashed Elchi (an abort on the main thread as a meeting ended).
//!
//! The panel cannot reliably see the mouse itself (WebKit tracks hover only in the key
//! window, and a non-activating panel never is one), so a thread watches the cursor and
//! tells the pill when it is over it; the window grows to the left to make room for the
//! transcript and shrinks back when the cursor leaves.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

pub const LABEL: &str = "meeting_pill";

/// Logical sizes: the pill alone, and the pill with the transcript panel to its left.
const COLLAPSED: (f64, f64) = (64.0, 104.0);
const EXPANDED: (f64, f64) = (470.0, 560.0);
/// Gap between the pill and the screen's right edge.
const EDGE: f64 = 10.0;

static WATCHING: AtomicBool = AtomicBool::new(false);

#[cfg(target_os = "macos")]
tauri_nspanel::tauri_panel! {
    panel!(MeetingPillPanel {
        config: {
            can_become_key_window: false,
            is_floating_panel: true
        }
    })
}

/// Where the window goes for a size: flush right, centred on the same height either way,
/// so the pill does not move when the panel opens.
fn frame(app: &AppHandle, (w, h): (f64, f64)) -> Option<(f64, f64)> {
    let monitor = app.primary_monitor().ok()??;
    let scale = monitor.scale_factor();
    let (mx, my) = (
        monitor.position().x as f64 / scale,
        monitor.position().y as f64 / scale,
    );
    let (mw, mh) = (
        monitor.size().width as f64 / scale,
        monitor.size().height as f64 / scale,
    );
    Some((mx + mw - w - EDGE, my + (mh - h) / 2.0))
}

fn place(app: &AppHandle, size: (f64, f64)) {
    let (Some(window), Some((x, y))) = (app.get_webview_window(LABEL), frame(app, size)) else {
        return;
    };
    let _ = window.set_size(tauri::LogicalSize::new(size.0, size.1));
    let _ = window.set_position(tauri::LogicalPosition::new(x, y));
}

/// Makes the pill, hidden, so its page is loaded by the first meeting. At startup, on the
/// main thread.
pub fn init(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    create(app, false);
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

/// Shows the pill for the meeting that just started.
pub fn show(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || create(&handle, true));
        watch(app.clone());
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

#[cfg(target_os = "macos")]
fn create(app: &AppHandle, visible: bool) {
    use tauri_nspanel::{CollectionBehavior, PanelBuilder, PanelLevel, StyleMask};
    if let Some(window) = app.get_webview_window(LABEL) {
        if !visible {
            return;
        }
        // Made for an earlier meeting: back on screen, closed, out of screen sharing.
        place(app, COLLAPSED);
        let _ = window.show();
        super::hide_from_capture(&window, true);
        let _ = window.emit("meeting-pill-open", false);
        return;
    }
    let Some((x, y)) = frame(app, COLLAPSED) else {
        return;
    };
    match PanelBuilder::<_, MeetingPillPanel>::new(app, LABEL)
        .url(tauri::WebviewUrl::App("src/meeting-pill/index.html".into()))
        .title("Meeting")
        .position(tauri::Position::Logical(tauri::LogicalPosition { x, y }))
        .size(tauri::Size::Logical(tauri::LogicalSize {
            width: COLLAPSED.0,
            height: COLLAPSED.1,
        }))
        .level(PanelLevel::Status)
        .has_shadow(false)
        .transparent(true)
        .no_activate(true)
        .corner_radius(0.0)
        .style_mask(StyleMask::empty().borderless().nonactivating_panel())
        .with_window(|w| {
            w.decorations(false)
                .transparent(true)
                .focusable(false)
                .accept_first_mouse(true)
        })
        .collection_behavior(
            CollectionBehavior::new()
                .can_join_all_spaces()
                .full_screen_auxiliary(),
        )
        .build()
    {
        Ok(panel) => {
            if visible {
                panel.show();
            } else {
                panel.hide();
            }
            if let Some(window) = app.get_webview_window(LABEL) {
                super::hide_from_capture(&window, true);
            }
        }
        Err(e) => log::error!("Meeting pill not shown: {e}"),
    }
}

/// Takes the pill off screen when the meeting ends (hidden, not destroyed: see above).
pub fn hide(app: &AppHandle) {
    WATCHING.store(false, Ordering::SeqCst);
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.emit("meeting-pill-open", false);
        let _ = window.hide();
    }
}

/// Opens the transcript while the cursor is over the pill, closes it once the cursor has
/// left the open window for a moment (so passing over the gap does not flicker it).
fn watch(app: AppHandle) {
    if WATCHING.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(move || {
        let mut open = false;
        let mut outside = 0u32;
        while WATCHING.load(Ordering::SeqCst) {
            std::thread::sleep(Duration::from_millis(120));
            let Some(window) = app.get_webview_window(LABEL) else {
                continue;
            };
            let (Ok(cursor), Ok(pos), Ok(size)) = (
                app.cursor_position(),
                window.outer_position(),
                window.outer_size(),
            ) else {
                continue;
            };
            let scale = window.scale_factor().unwrap_or(1.0);
            // The pill is the right-hand COLLAPSED-wide strip of the window, vertically centred.
            let pill_w = COLLAPSED.0 * scale;
            let pill_h = COLLAPSED.1 * scale;
            let (wx, wy) = (pos.x as f64, pos.y as f64);
            let (ww, wh) = (size.width as f64, size.height as f64);
            let in_window =
                cursor.x >= wx && cursor.x < wx + ww && cursor.y >= wy && cursor.y < wy + wh;
            let on_pill = cursor.x >= wx + ww - pill_w
                && cursor.x < wx + ww
                && cursor.y >= wy + (wh - pill_h) / 2.0
                && cursor.y < wy + (wh + pill_h) / 2.0;
            if !open && on_pill {
                open = true;
                outside = 0;
                place(&app, EXPANDED);
                let _ = window.emit("meeting-pill-open", true);
            } else if open {
                outside = if in_window { 0 } else { outside + 1 };
                if outside >= 3 {
                    open = false;
                    let _ = window.emit("meeting-pill-open", false);
                    place(&app, COLLAPSED);
                }
            }
        }
    });
}

/// The pill was clicked: Elchi's window, on the meeting.
#[tauri::command]
#[specta::specta]
pub fn open_meeting_from_pill(app: AppHandle) {
    crate::show_main_window(&app);
    let _ = app.emit("open-meetings", ());
}
