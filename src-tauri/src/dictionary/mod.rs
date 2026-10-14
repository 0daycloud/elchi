//! Elchi's personal dictionary: the names, brands and terms a user dictates, and how
//! the recognizer tends to mishear them.
//!
//! Entries come from three places: corrections Elchi notices (`learn`; on macOS it
//! reads the text field back after pasting, see `watch`), edits made to a dictation
//! in History, and words the user adds. They are used where context decides: the
//! formatter (crate::elchi_pro::format) gets every entry with its misheard forms and
//! fixes a word only where it fits ("Kan'a gönder" -> "Kaan'a gönder", never "kan
//! tahlili"), and Duyu Pro gets the words as a recognition hint. They are not blindly
//! substituted into transcripts, which is what Handy's custom words do.

pub mod learn;
pub mod spell;
#[cfg(target_os = "macos")]
pub mod watch;

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Emitter};

use crate::settings::{get_settings, write_settings};

/// The dictionary keeps at most this many entries; past it, the oldest learned ones go.
const MAX_WORDS: usize = 500;
/// The formatter gets the most recent entries, up to this many.
const MAX_FOR_FORMATTER: usize = 200;
/// Duyu Pro's hint is a short prompt: this many words at most.
const MAX_FOR_PROMPT: usize = 40;

#[derive(Clone, Debug, Serialize, Deserialize, Type, PartialEq, Eq)]
pub struct DictionaryWord {
    /// As the user writes it: "Kaan", "PatientDesk".
    pub word: String,
    /// How Elchi wrote it before it was corrected: "Kan".
    #[serde(default)]
    pub heard: Vec<String>,
    /// Learned from a correction, rather than added by the user.
    #[serde(default)]
    pub learned: bool,
    /// Unix seconds.
    #[serde(default)]
    pub added_at: i64,
}

fn key(word: &str) -> String {
    learn::fold(word.trim())
}

fn changed(app: &AppHandle, words: &[DictionaryWord]) {
    let _ = app.emit("dictionary-changed", words.to_vec());
}

/// Adds `word` (or, if it is already there, adds `heard` to how it was misheard).
/// Returns the entry if anything changed.
pub fn add(
    app: &AppHandle,
    word: &str,
    heard: Option<&str>,
    learned: bool,
) -> Option<DictionaryWord> {
    let word = word.trim();
    if word.is_empty() || word.chars().count() > 40 {
        return None;
    }
    // A misheard form is any other spelling, case included ("elchi" for "Elchi").
    let heard = heard.map(str::trim).filter(|h| !h.is_empty() && *h != word);
    let mut settings = get_settings(app);
    let dict = &mut settings.elchi_dictionary;
    let entry = if let Some(e) = dict.iter_mut().find(|e| key(&e.word) == key(word)) {
        match heard {
            Some(h) if !e.heard.iter().any(|x| x == h) => {
                e.heard.push(h.to_string());
                e.clone()
            }
            _ => return None,
        }
    } else {
        let e = DictionaryWord {
            word: word.to_string(),
            heard: heard.map(|h| vec![h.to_string()]).unwrap_or_default(),
            learned,
            added_at: chrono::Utc::now().timestamp(),
        };
        dict.push(e.clone());
        while dict.len() > MAX_WORDS {
            let oldest = dict
                .iter()
                .enumerate()
                .filter(|(_, e)| e.learned)
                .min_by_key(|(_, e)| e.added_at)
                .or_else(|| dict.iter().enumerate().min_by_key(|(_, e)| e.added_at))
                .map(|(i, _)| i);
            match oldest {
                Some(i) => {
                    dict.remove(i);
                }
                None => break,
            }
        }
        e
    };
    let words = settings.elchi_dictionary.clone();
    write_settings(app, settings);
    changed(app, &words);
    Some(entry)
}

pub fn remove(app: &AppHandle, word: &str) -> Vec<DictionaryWord> {
    let mut settings = get_settings(app);
    settings
        .elchi_dictionary
        .retain(|e| key(&e.word) != key(word));
    let words = settings.elchi_dictionary.clone();
    write_settings(app, settings);
    changed(app, &words);
    words
}

/// Learns from the user's edit of a dictation; tells the interface what was learned.
pub fn learn_from_edit(app: &AppHandle, pasted: &str, edited: &str) -> Vec<DictionaryWord> {
    if !get_settings(app).elchi_dictionary_learn {
        return vec![];
    }
    let known = |w: &str| spell::is_known(app, w);
    let learned: Vec<DictionaryWord> = learn::lessons_with(pasted, edited, &known)
        .into_iter()
        .filter_map(|l| add(app, &l.word, Some(&l.heard), true))
        .collect();
    if !learned.is_empty() {
        log::info!(
            "Dictionary learned {} word(s) from a correction",
            learned.len()
        );
        let _ = app.emit("dictionary-learned", learned.clone());
    }
    learned
}

/// A dictation corrected where it was pasted (crate::dictionary::watch): the
/// correction becomes the dictation's text in history, so the home feed shows it
/// and what changed, and the dictionary learns from it. Nothing happens when the
/// change is more typing after the dictation, or a rewrite.
pub fn correct_dictation(app: &AppHandle, history_id: Option<i64>, pasted: &str, edited: &str) {
    let Some(corrected) = learn::correction(pasted, edited) else {
        return;
    };
    if let Some(id) = history_id {
        use tauri::Manager;
        if let Some(hm) =
            app.try_state::<std::sync::Arc<crate::managers::history::HistoryManager>>()
        {
            if let Err(e) = hm.correct_text(id, &corrected) {
                log::warn!("Could not save a correction to history: {e}");
            }
        }
    }
    learn_from_edit(app, pasted, &corrected);
}

/// What the formatter gets: the most recent entries, each with its misheard forms.
pub fn for_formatter(words: &[DictionaryWord]) -> Vec<DictionaryWord> {
    let mut v = words.to_vec();
    v.sort_by_key(|e| std::cmp::Reverse(e.added_at));
    v.truncate(MAX_FOR_FORMATTER);
    v
}

/// Duyu Pro's hint: the words themselves, most recent first, as a short prompt.
pub fn prompt(words: &[DictionaryWord]) -> Option<String> {
    if words.is_empty() {
        return None;
    }
    let mut v: Vec<&DictionaryWord> = words.iter().collect();
    v.sort_by_key(|e| std::cmp::Reverse(e.added_at));
    Some(
        v.iter()
            .take(MAX_FOR_PROMPT)
            .map(|e| e.word.as_str())
            .collect::<Vec<_>>()
            .join(", "),
    )
}

#[tauri::command]
#[specta::specta]
pub fn get_dictionary(app: AppHandle) -> Vec<DictionaryWord> {
    get_settings(&app).elchi_dictionary
}

#[tauri::command]
#[specta::specta]
pub fn add_dictionary_word(app: AppHandle, word: String) -> Vec<DictionaryWord> {
    add(&app, &word, None, false);
    get_settings(&app).elchi_dictionary
}

#[tauri::command]
#[specta::specta]
pub fn remove_dictionary_word(app: AppHandle, word: String) -> Vec<DictionaryWord> {
    remove(&app, &word)
}

/// Whether corrections teach the dictionary.
#[tauri::command]
#[specta::specta]
pub fn set_dictionary_learning(app: AppHandle, enabled: bool) {
    let mut settings = get_settings(&app);
    settings.elchi_dictionary_learn = enabled;
    write_settings(&app, settings);
}
