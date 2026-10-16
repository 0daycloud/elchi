//! Two checks on what a meeting heard: whether anyone spoke in a stretch of audio, and
//! whether the microphone only heard the call coming out of the speakers (no headphones),
//! which would put the others' words in the user's mouth.

use super::capture::RATE;

fn rms(s: &[f32]) -> f32 {
    if s.is_empty() {
        return 0.0;
    }
    (s.iter().map(|x| x * x).sum::<f32>() / s.len() as f32).sqrt()
}

/// Whether someone speaks in a stretch of audio: at least 0.4 s of 30 ms frames above -40 dBFS.
/// Silent audio is not sent to be transcribed (a recognizer hears words in silence).
pub fn has_speech(audio: &[f32]) -> bool {
    let frame = RATE * 3 / 100;
    let loud = audio.chunks(frame).filter(|f| rms(f) > 0.01).count();
    loud * frame >= RATE * 2 / 5
}

fn words(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(str::to_lowercase)
        .collect()
}

/// Whether what the microphone transcribed is the call's own audio heard through the
/// speakers: most of its words are in what the call said over the same seconds.
pub fn is_echo(me: &str, them: &str) -> bool {
    let mine = words(me);
    if mine.is_empty() {
        return true;
    }
    let theirs: std::collections::HashSet<String> = words(them).into_iter().collect();
    if theirs.is_empty() {
        return false;
    }
    let shared = mine.iter().filter(|w| theirs.contains(*w)).count();
    shared as f32 / mine.len() as f32 >= 0.6
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(seconds: f32, amp: f32) -> Vec<f32> {
        (0..(seconds * RATE as f32) as usize)
            .map(|i| amp * (i as f32 * 0.05).sin())
            .collect()
    }

    #[test]
    fn silence_is_not_speech() {
        assert!(!has_speech(&tone(20.0, 0.001)));
        assert!(has_speech(&tone(1.0, 0.2)));
    }

    #[test]
    fn the_call_heard_through_the_speakers_is_echo() {
        let them = "Lansmanı on Kasım'a alalım, App Store incelemesi iki gün sürüyor.";
        assert!(is_echo("lansmanı on kasım'a alalım app store", them));
        assert!(!is_echo(
            "Tamam, o zaman build'i altı Kasım'da gönderiyoruz.",
            them
        ));
        assert!(!is_echo("Merhaba herkese.", ""));
        assert!(is_echo("", them));
    }
}
