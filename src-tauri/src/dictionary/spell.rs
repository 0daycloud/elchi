//! Whether a word is an ordinary Turkish or English word, by the system spell
//! checker. Learning uses it to tell a misheard term ("spero", "kubectl") from a
//! corrected common word ("gitti" -> "geldi"), which is not worth remembering.
//! None where there is no spell checker to ask (not macOS), and the learning rules
//! fall back to stricter ones.

use tauri::AppHandle;

#[cfg(target_os = "macos")]
pub fn is_known(app: &AppHandle, word: &str) -> Option<bool> {
    use objc2_foundation::MainThreadMarker;

    fn check(mtm: MainThreadMarker, word: &str) -> Option<bool> {
        use objc2_app_kit::NSSpellChecker;
        use objc2_foundation::NSString;

        let _ = mtm; // the checker is the main thread's, which `mtm` proves this is
        let checker = NSSpellChecker::sharedSpellChecker();
        let languages: Vec<String> = checker
            .availableLanguages()
            .iter()
            .map(|l| l.to_string())
            .collect();
        let wanted: Vec<&String> = languages
            .iter()
            .filter(|l| l.starts_with("tr") || l.starts_with("en"))
            .collect();
        if wanted.is_empty() {
            return None;
        }
        let text = NSString::from_str(word);
        let known = wanted.iter().any(|lang| {
            let lang = NSString::from_str(lang);
            let mut count = 0isize;
            let miss = unsafe {
                checker.checkSpellingOfString_startingAt_language_wrap_inSpellDocumentWithTag_wordCount(
                    &text,
                    0,
                    Some(&lang),
                    false,
                    0,
                    &mut count,
                )
            };
            miss.length == 0
        });
        Some(known)
    }

    if let Some(mtm) = MainThreadMarker::new() {
        return check(mtm, word);
    }
    // The spell checker belongs to the main thread: ask there, and do not wait long.
    let (tx, rx) = std::sync::mpsc::channel();
    let word = word.to_string();
    app.run_on_main_thread(move || {
        let mtm = MainThreadMarker::new().expect("run_on_main_thread runs on the main thread");
        let _ = tx.send(check(mtm, &word));
    })
    .ok()?;
    rx.recv_timeout(std::time::Duration::from_secs(2))
        .ok()
        .flatten()
}

#[cfg(not(target_os = "macos"))]
pub fn is_known(_app: &AppHandle, _word: &str) -> Option<bool> {
    None
}
