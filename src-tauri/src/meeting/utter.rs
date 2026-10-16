//! One side of a meeting transcribed on this device: the audio is cut into utterances
//! where the speaker pauses (Silero VAD, the detector dictation uses), and each utterance
//! is transcribed on a thread of its own as soon as it ends. Cutting at pauses keeps words
//! whole and gives each line its own start and end, as the server's stream does.

use std::collections::VecDeque;
use std::sync::mpsc;
use std::thread::JoinHandle;

use log::warn;
use tauri::{AppHandle, Manager};

use super::capture::RATE;
use super::lane::{LaneEvent, Speaker};
use crate::audio_toolkit::vad::{SileroVad, VoiceActivityDetector};

/// Speech before the detector is sure, kept at the utterance's start.
const PRE_ROLL: usize = RATE * 3 / 10;
/// Silence that ends an utterance.
const END_SILENCE: usize = RATE * 6 / 10;
/// Silence kept at an utterance's end.
const TAIL: usize = RATE / 5;
/// An utterance is cut here even without a pause (as the server does).
const MAX_UTTERANCE: usize = 25 * RATE;
/// Less speech than this is a cough or a click, not an utterance.
const MIN_SPEECH: usize = RATE / 4;
/// Energy above which a frame counts as speech when Silero cannot be loaded.
const ENERGY: f32 = 0.01;

pub struct Job {
    speaker: Speaker,
    start: usize,
    end: usize,
    audio: Vec<f32>,
}

/// The thread that transcribes finished utterances, both sides', in order.
pub struct DeviceTranscriber {
    jobs: Option<mpsc::Sender<Job>>,
    thread: Option<JoinHandle<()>>,
}

impl DeviceTranscriber {
    pub fn start(app: &AppHandle, events: mpsc::Sender<(Speaker, LaneEvent)>) -> Self {
        let (jobs, rx) = mpsc::channel::<Job>();
        let app = app.clone();
        let thread = std::thread::Builder::new()
            .name("meeting-transcribe".into())
            .spawn(move || {
                for job in rx {
                    if let Some(text) = super::transcribe(&app, &job.audio) {
                        let _ = events.send((
                            job.speaker,
                            LaneEvent::Final {
                                start: job.start,
                                end: job.end,
                                text,
                            },
                        ));
                    }
                }
            })
            .map_err(|e| warn!("Meeting transcription thread not started: {e}"))
            .ok();
        Self {
            jobs: Some(jobs),
            thread,
        }
    }

    pub fn jobs(&self) -> Option<mpsc::Sender<Job>> {
        self.jobs.clone()
    }

    /// Waits for every utterance handed over so far (the lanes must be finished first).
    pub fn finish(mut self) {
        self.jobs.take();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

enum Detector {
    Silero(Box<SileroVad>),
    /// Loudness alone, when Silero cannot be loaded.
    Energy,
}

impl Detector {
    fn new(app: &AppHandle) -> Self {
        let silero = app
            .path()
            .resolve(
                "resources/models/silero-vad-v6.2-F32.gguf",
                tauri::path::BaseDirectory::Resource,
            )
            .map_err(anyhow::Error::from)
            .and_then(|path| SileroVad::new(path, 0.4));
        match silero {
            Ok(vad) => Detector::Silero(Box::new(vad)),
            Err(e) => {
                warn!("Meeting: no Silero VAD ({e:#}); cutting by loudness");
                Detector::Energy
            }
        }
    }

    fn frame(&self) -> usize {
        match self {
            Detector::Silero(vad) => vad.frame_samples(),
            Detector::Energy => RATE * 32 / 1000,
        }
    }

    fn is_speech(&mut self, frame: &[f32]) -> bool {
        match self {
            Detector::Silero(vad) => vad.is_voice(frame).unwrap_or(false),
            Detector::Energy => rms(frame) > ENERGY,
        }
    }
}

fn rms(s: &[f32]) -> f32 {
    if s.is_empty() {
        return 0.0;
    }
    (s.iter().map(|x| x * x).sum::<f32>() / s.len() as f32).sqrt()
}

/// Where utterances start and end, frame by frame; no audio model, so it can be tested.
#[derive(Default)]
struct Cutter {
    /// The sample the next frame starts at.
    position: usize,
    /// Recent audio before an utterance (its pre-roll).
    recent: VecDeque<f32>,
    utterance: Option<Utterance>,
}

struct Utterance {
    start: usize,
    audio: Vec<f32>,
    speech: usize,
    silence: usize,
}

impl Cutter {
    fn at(position: usize) -> Self {
        Self {
            position,
            ..Self::default()
        }
    }

    /// One frame, and whether it is speech; a finished utterance comes back.
    fn frame(&mut self, frame: &[f32], speech: bool) -> Option<(usize, usize, Vec<f32>)> {
        self.position += frame.len();
        if let Some(u) = self.utterance.as_mut() {
            u.audio.extend_from_slice(frame);
            if speech {
                u.speech += frame.len();
                u.silence = 0;
            } else {
                u.silence += frame.len();
            }
            if u.silence >= END_SILENCE || u.audio.len() >= MAX_UTTERANCE {
                return self.end();
            }
            return None;
        }
        self.recent.extend(frame.iter().copied());
        let over = self.recent.len().saturating_sub(PRE_ROLL);
        self.recent.drain(..over);
        if speech {
            let audio: Vec<f32> = self.recent.drain(..).collect();
            self.utterance = Some(Utterance {
                start: self.position - audio.len(),
                speech: frame.len(),
                silence: 0,
                audio,
            });
        }
        None
    }

    /// Ends the utterance in progress, if it had enough speech.
    fn end(&mut self) -> Option<(usize, usize, Vec<f32>)> {
        let mut u = self.utterance.take()?;
        let trailing = u.silence.saturating_sub(TAIL);
        u.audio
            .truncate(u.audio.len() - trailing.min(u.audio.len()));
        (u.speech >= MIN_SPEECH).then(|| (u.start, u.start + u.audio.len(), u.audio))
    }
}

pub struct DeviceLane {
    speaker: Speaker,
    detector: Detector,
    carry: Vec<f32>,
    cutter: Cutter,
    jobs: Option<mpsc::Sender<Job>>,
}

impl DeviceLane {
    /// Starts at sample `position` of the meeting.
    pub fn new(
        app: &AppHandle,
        speaker: Speaker,
        position: usize,
        jobs: Option<mpsc::Sender<Job>>,
    ) -> Self {
        Self {
            speaker,
            detector: Detector::new(app),
            carry: Vec::new(),
            cutter: Cutter::at(position),
            jobs,
        }
    }

    pub fn push(&mut self, samples: &[f32]) {
        self.carry.extend_from_slice(samples);
        let frame = self.detector.frame();
        let whole = self.carry.len() / frame * frame;
        let audio: Vec<f32> = self.carry.drain(..whole).collect();
        for f in audio.chunks(frame) {
            let speech = self.detector.is_speech(f);
            if let Some(done) = self.cutter.frame(f, speech) {
                self.hand_over(done);
            }
        }
    }

    /// Audio was lost up to `position`: whatever was being heard ends there.
    pub fn skip_to(&mut self, position: usize) {
        if let Some(done) = self.cutter.end() {
            self.hand_over(done);
        }
        self.carry.clear();
        self.cutter = Cutter::at(position);
    }

    pub fn finish(mut self) {
        let rest = std::mem::take(&mut self.carry);
        for f in rest.chunks(self.detector.frame()) {
            if let Some(done) = self.cutter.frame(f, false) {
                self.hand_over(done);
            }
        }
        if let Some(done) = self.cutter.end() {
            self.hand_over(done);
        }
    }

    fn hand_over(&self, (start, end, audio): (usize, usize, Vec<f32>)) {
        if let Some(jobs) = &self.jobs {
            let _ = jobs.send(Job {
                speaker: self.speaker,
                start,
                end,
                audio,
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const F: usize = 512;

    fn run(cutter: &mut Cutter, pattern: &[(bool, usize)]) -> Vec<(usize, usize)> {
        let mut out = Vec::new();
        for &(speech, frames) in pattern {
            for _ in 0..frames {
                if let Some((s, e, audio)) = cutter.frame(&[0.0; F], speech) {
                    assert_eq!(audio.len(), e - s);
                    out.push((s, e));
                }
            }
        }
        out
    }

    #[test]
    fn utterances_end_at_a_pause_with_their_pre_roll_and_a_short_tail() {
        let mut c = Cutter::at(0);
        // 1 s quiet, 2 s speech, 1 s quiet, 1 s speech, 1 s quiet
        let frames = |s: usize| s * RATE / F;
        let cuts = run(
            &mut c,
            &[
                (false, frames(1)),
                (true, frames(2)),
                (false, frames(1)),
                (true, frames(1)),
                (false, frames(1)),
            ],
        );
        assert_eq!(cuts.len(), 2);
        let (s, e) = cuts[0];
        // starts a pre-roll before the speech, ends a tail after it
        assert!(
            (RATE - PRE_ROLL - F..=RATE - PRE_ROLL + F).contains(&s),
            "{s}"
        );
        let speech_end = frames(1) * F + frames(2) * F;
        assert!((speech_end..=speech_end + TAIL + F).contains(&e), "{e}");
    }

    #[test]
    fn long_speech_is_cut_and_clicks_are_dropped() {
        let mut c = Cutter::at(1_000);
        let cuts = run(&mut c, &[(true, 30 * RATE / F)]);
        assert!(!cuts.is_empty());
        assert!(cuts[0].1 - cuts[0].0 <= MAX_UTTERANCE + F);
        assert!(cuts[0].0 >= 1_000);

        let mut c = Cutter::at(0);
        assert!(run(&mut c, &[(true, 2), (false, 40)]).is_empty());
    }

    #[test]
    fn the_end_finishes_what_was_being_said() {
        let mut c = Cutter::at(0);
        assert!(run(&mut c, &[(true, 40)]).is_empty());
        let (s, e, _) = c.end().unwrap();
        assert_eq!((s, e), (0, 40 * F));
    }
}
