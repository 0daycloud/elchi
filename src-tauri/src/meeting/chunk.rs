//! How a meeting's audio is cut into pieces to transcribe while it goes on, and two checks on
//! each piece: whether anyone spoke in it, and whether the microphone only heard the call
//! coming out of the speakers (no headphones), which would put the others' words in the
//! user's mouth.

use super::capture::RATE;

/// A piece is cut once this much audio is waiting, at the quietest moment of its last seconds,
/// and never longer than MAX: short enough to show the transcript as the meeting goes, long
/// enough for the recognizer to have context.
pub const MIN_PIECE: usize = 20 * RATE;
pub const MAX_PIECE: usize = 28 * RATE;
const LOOK_BACK: usize = 8 * RATE;
const WINDOW: usize = RATE / 5;

fn rms(s: &[f32]) -> f32 {
    if s.is_empty() {
        return 0.0;
    }
    (s.iter().map(|x| x * x).sum::<f32>() / s.len() as f32).sqrt()
}

fn window(track: Option<&[f32]>, at: usize) -> f32 {
    track.map_or(0.0, |t| {
        let end = (at + WINDOW).min(t.len());
        if at >= end {
            0.0
        } else {
            rms(&t[at..end])
        }
    })
}

/// Where to cut the waiting audio of both sides (one timeline): None while less than a piece
/// is waiting, unless the meeting is ending, when everything goes.
pub fn cut_point(me: &[f32], them: Option<&[f32]>, ending: bool) -> Option<usize> {
    let waiting = me.len().max(them.map_or(0, <[f32]>::len));
    if ending {
        return (waiting > 0).then_some(waiting);
    }
    if waiting < MIN_PIECE {
        return None;
    }
    let limit = waiting.min(MAX_PIECE);
    let mut best = (f32::MAX, limit);
    let mut at = limit.saturating_sub(LOOK_BACK);
    while at + WINDOW <= limit {
        let energy = window(Some(me), at) + window(them, at);
        if energy < best.0 {
            best = (energy, at + WINDOW / 2);
        }
        at += WINDOW / 2;
    }
    Some(best.1)
}

/// Whether someone speaks in a piece: at least 0.4 s of 30 ms frames above -40 dBFS.
/// Silent pieces are not sent to be transcribed (a recognizer hears words in silence).
pub fn has_speech(piece: &[f32]) -> bool {
    let frame = RATE * 3 / 100;
    let loud = piece.chunks(frame).filter(|f| rms(f) > 0.01).count();
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
    fn a_piece_is_cut_at_the_quietest_moment_once_enough_is_waiting() {
        assert_eq!(cut_point(&tone(10.0, 0.3), None, false), None);
        let mut me = tone(18.0, 0.3);
        me.extend(tone(1.0, 0.0)); // a pause at 18-19 s
        me.extend(tone(6.0, 0.3));
        let cut = cut_point(&me, None, false).unwrap();
        assert!((18 * RATE..19 * RATE).contains(&cut), "cut at {cut}");
    }

    #[test]
    fn the_quiet_moment_is_quiet_on_both_sides() {
        let me = tone(26.0, 0.0);
        let mut them = tone(21.0, 0.3);
        them.extend(tone(1.0, 0.0)); // the others pause at 21-22 s
        them.extend(tone(4.0, 0.3));
        let cut = cut_point(&me, Some(&them), false).unwrap();
        assert!((21 * RATE..22 * RATE).contains(&cut), "cut at {cut}");
    }

    #[test]
    fn a_piece_never_runs_past_the_limit_and_the_end_takes_everything() {
        let long = tone(40.0, 0.3);
        assert!(cut_point(&long, None, false).unwrap() <= MAX_PIECE);
        assert_eq!(cut_point(&long, None, true), Some(long.len()));
        assert_eq!(cut_point(&[], Some(&[]), true), None);
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
