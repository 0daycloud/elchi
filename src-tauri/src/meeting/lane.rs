//! A meeting has a lane per side (the microphone, the call's audio). A lane takes that
//! side's audio as it is captured and reports utterances: streamed to Duyu Pro
//! (stream.rs), or cut at pauses and transcribed on this device (utter.rs) without it or
//! when the server cannot be reached. Either way, what comes back is one line per
//! utterance with when it started and ended, in samples from the meeting's start.

use std::sync::mpsc;

use log::warn;
use tauri::AppHandle;

use super::stream::CloudLane;
use super::utter::{DeviceLane, DeviceTranscriber};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Speaker {
    Me,
    Them,
}

impl Speaker {
    pub fn as_str(self) -> &'static str {
        match self {
            Speaker::Me => "me",
            Speaker::Them => "them",
        }
    }
}

pub enum LaneEvent {
    /// The words of the utterance being spoken, so far.
    Partial { text: String },
    /// A finished utterance; `start` and `end` in samples from the meeting's start.
    Final {
        start: usize,
        end: usize,
        text: String,
    },
    /// The server cannot be reached: this side goes on on the device.
    GaveUp,
}

pub enum Lane {
    Cloud(CloudLane),
    Device(DeviceLane),
}

impl Lane {
    pub fn start(
        app: &AppHandle,
        speaker: Speaker,
        cloud: bool,
        events: &mpsc::Sender<(Speaker, LaneEvent)>,
        device: &DeviceTranscriber,
    ) -> Self {
        if cloud {
            Lane::Cloud(CloudLane::start(app, speaker, 0, events.clone()))
        } else {
            Lane::Device(DeviceLane::new(app, speaker, 0, device.jobs()))
        }
    }

    pub fn push(&mut self, samples: &[f32]) {
        match self {
            Lane::Cloud(lane) => lane.push(samples),
            Lane::Device(lane) => lane.push(samples),
        }
    }

    /// The cloud lane gave up: the audio it had not been answered for, and everything from
    /// now on, are transcribed on the device.
    pub fn hand_to_device(
        &mut self,
        app: &AppHandle,
        speaker: Speaker,
        device: &DeviceTranscriber,
    ) {
        let Lane::Cloud(cloud) = self else { return };
        let (start, audio) = cloud.take_pending();
        let position = cloud.position();
        let mut lane = DeviceLane::new(app, speaker, start, device.jobs());
        lane.push(&audio);
        if start + audio.len() != position {
            warn!(
                "Meeting ({}): {:.1} s of audio could not be kept for the device",
                speaker.as_str(),
                position.saturating_sub(start + audio.len()) as f64 / super::capture::RATE as f64
            );
            lane.skip_to(position);
        }
        *self = Lane::Device(lane);
    }

    /// The meeting is over: the last utterance is finished (a cloud lane waits for the
    /// server's answer). A cloud lane that could not finish hands back what the server did
    /// not answer for, and the device transcribes it.
    pub fn finish(self, app: &AppHandle, speaker: Speaker, device: &DeviceTranscriber) {
        match self {
            Lane::Cloud(lane) => {
                if let Some((start, audio)) = lane.finish() {
                    let mut lane = DeviceLane::new(app, speaker, start, device.jobs());
                    lane.push(&audio);
                    lane.finish();
                }
            }
            Lane::Device(lane) => lane.finish(),
        }
    }
}
