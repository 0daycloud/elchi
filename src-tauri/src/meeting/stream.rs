//! One side of a meeting streamed to Duyu Pro (`/v1/audio/stream` on the transcription
//! service): the audio goes up as it is captured, the server finds where each utterance
//! starts and ends, and sends back its words while it is spoken (partials) and once it is
//! over (a final, with its start and end). So the transcript is a conversation in order,
//! line by line, rather than pieces cut every 25 seconds.
//!
//! The audio since the last final is kept (`Pending`) until the server has answered for it:
//! when the connection drops, a new one starts by sending it again, and the times it
//! answers with are counted from where that audio began. When the server cannot be reached
//! at all, or the plan has no Duyu Pro, the lane gives up and hands what is pending to an
//! on-device lane (utter.rs). At the end, "stop" makes the server finish the utterance in
//! progress, and the lane waits for it.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use log::{info, warn};
use serde::Deserialize;
use tauri::{AppHandle, Manager};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;

use super::capture::RATE;
use super::lane::{LaneEvent, Speaker};
use crate::elchi_pro::{ElchiPro, STREAM_URL};
use crate::settings::get_settings;

/// Audio kept for resending at most (two minutes); older audio is given up on.
const PENDING_MAX: usize = 120 * RATE;
/// Kept before an answered point, in case the next utterance's pre-roll reaches back.
const MARGIN: usize = RATE / 2;
/// Audio sent per message when resending.
const SEND_CHUNK: usize = RATE / 2;
/// Failed connections in a row before giving up on the server for this meeting.
const MAX_FAILURES: u32 = 4;
/// How long the end of a meeting waits for the server's last words.
pub const FINISH_WAIT: Duration = Duration::from_secs(25);

/// The audio not yet answered for, from sample `start` of the meeting.
#[derive(Default)]
pub struct Pending {
    start: usize,
    audio: VecDeque<f32>,
}

impl Pending {
    /// Everything before sample `at` is answered for.
    fn answered(&mut self, at: usize) {
        let drop = at.saturating_sub(self.start).min(self.audio.len());
        self.audio.drain(..drop);
        self.start += drop;
    }
}

enum Msg {
    Audio { at: usize, samples: Vec<f32> },
    Stop,
}

pub struct CloudLane {
    tx: tokio::sync::mpsc::UnboundedSender<Msg>,
    pending: Arc<Mutex<Pending>>,
    done: mpsc::Receiver<()>,
    /// The server answered "stopped": everything sent was transcribed.
    stopped: Arc<AtomicBool>,
    position: usize,
}

impl CloudLane {
    /// Starts streaming one side, from sample `position` of the meeting.
    pub fn start(
        app: &AppHandle,
        speaker: Speaker,
        position: usize,
        events: mpsc::Sender<(Speaker, LaneEvent)>,
    ) -> Self {
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
        let pending = Arc::new(Mutex::new(Pending {
            start: position,
            audio: VecDeque::new(),
        }));
        let (done_tx, done) = mpsc::channel();
        let stopped = Arc::new(AtomicBool::new(false));
        let task = Task {
            app: app.clone(),
            speaker,
            events,
            pending: pending.clone(),
            stopped: stopped.clone(),
        };
        tauri::async_runtime::spawn(async move {
            task.run(rx).await;
            let _ = done_tx.send(());
        });
        Self {
            tx,
            pending,
            done,
            stopped,
            position,
        }
    }

    pub fn push(&mut self, samples: &[f32]) {
        if samples.is_empty() {
            return;
        }
        if let Ok(mut p) = self.pending.lock() {
            p.audio.extend(samples.iter().copied());
            let over = p.audio.len().saturating_sub(PENDING_MAX);
            if over > 0 {
                let at = p.start + over;
                p.answered(at);
            }
        }
        let _ = self.tx.send(Msg::Audio {
            at: self.position,
            samples: samples.to_vec(),
        });
        self.position += samples.len();
    }

    /// The meeting is ending: the server finishes the utterance in progress. Waits for it
    /// (at most FINISH_WAIT). What the server did not answer for comes back, from which
    /// sample, for the device to transcribe (nothing when the server finished).
    pub fn finish(self) -> Option<(usize, Vec<f32>)> {
        let _ = self.tx.send(Msg::Stop);
        if self.done.recv_timeout(FINISH_WAIT).is_err() {
            warn!("Meeting stream did not finish in time");
        }
        let (start, audio) = self.take_pending();
        (!audio.is_empty() && !self.stopped.load(Ordering::SeqCst)).then_some((start, audio))
    }

    /// What the server has not answered for, from which sample: after the lane gave up,
    /// for the on-device lane to transcribe.
    pub fn take_pending(&self) -> (usize, Vec<f32>) {
        match self.pending.lock() {
            Ok(mut p) => {
                let audio = p.audio.drain(..).collect();
                (p.start, audio)
            }
            Err(_) => (self.position, Vec::new()),
        }
    }

    pub fn position(&self) -> usize {
        self.position
    }
}

#[derive(Deserialize)]
struct ServerEvent {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    text: String,
    #[serde(default)]
    start: f64,
    #[serde(default)]
    end: f64,
    #[serde(default)]
    t: f64,
    #[serde(default)]
    active: bool,
    #[serde(default)]
    code: String,
    #[serde(default)]
    message: String,
    #[serde(default)]
    retry_after: u64,
}

/// Why a connection ended.
enum Ended {
    /// The server finished everything after "stop".
    Stopped,
    /// Try again, after this long.
    Retry(Duration),
    /// The token was refused: refresh it, then try again.
    Unauthorized,
    /// No point trying again (no Duyu Pro, quota used up).
    GiveUp,
}

struct Task {
    app: AppHandle,
    speaker: Speaker,
    events: mpsc::Sender<(Speaker, LaneEvent)>,
    pending: Arc<Mutex<Pending>>,
    stopped: Arc<AtomicBool>,
}

impl Task {
    fn send(&self, event: LaneEvent) {
        let _ = self.events.send((self.speaker, event));
    }

    async fn run(&self, mut rx: tokio::sync::mpsc::UnboundedReceiver<Msg>) {
        let mut stopping = false;
        let mut failures = 0u32;
        let mut refreshed = false;
        loop {
            let ended = match self.token().await {
                Some(token) => self.connection(&token, &mut rx, &mut stopping).await,
                None => Ended::GiveUp,
            };
            match ended {
                Ended::Stopped => {
                    self.stopped.store(true, Ordering::SeqCst);
                    return;
                }
                Ended::GiveUp => break,
                Ended::Unauthorized if !refreshed => {
                    refreshed = true;
                    let app = self.app.clone();
                    let ok = tauri::async_runtime::spawn_blocking(move || {
                        app.try_state::<Arc<ElchiPro>>()
                            .is_some_and(|e| e.refresh().is_ok())
                    })
                    .await
                    .unwrap_or(false);
                    if !ok {
                        break;
                    }
                }
                Ended::Unauthorized => break,
                Ended::Retry(wait) => {
                    failures += 1;
                    // At the end there is no time to wait for the server: the device does it.
                    if failures >= MAX_FAILURES || stopping {
                        break;
                    }
                    tokio::time::sleep(wait).await;
                }
            }
        }
        warn!(
            "Meeting stream ({}) gave up; transcribing on this device",
            self.speaker.as_str()
        );
        if !stopping {
            self.send(LaneEvent::GaveUp);
        }
        // Whatever is still queued is in Pending too; the device lane takes it from there.
        rx.close();
    }

    async fn token(&self) -> Option<String> {
        let app = self.app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            app.try_state::<Arc<ElchiPro>>()
                .and_then(|e| e.cloud_token())
        })
        .await
        .ok()
        .flatten()
    }

    /// One connection, until it ends one way or another.
    async fn connection(
        &self,
        token: &str,
        rx: &mut tokio::sync::mpsc::UnboundedReceiver<Msg>,
        stopping: &mut bool,
    ) -> Ended {
        let retry = Ended::Retry(Duration::from_secs(2));
        let Ok(mut request) = STREAM_URL.into_client_request() else {
            return Ended::GiveUp;
        };
        let Ok(auth) = format!("Bearer {token}").parse() else {
            return Ended::GiveUp;
        };
        request.headers_mut().insert("Authorization", auth);
        let connected = tokio::time::timeout(
            Duration::from_secs(10),
            tokio_tungstenite::connect_async(request),
        )
        .await;
        let mut ws = match connected {
            Ok(Ok((ws, _))) => ws,
            Ok(Err(e)) => {
                warn!("Meeting stream: could not connect: {e}");
                return retry;
            }
            Err(_) => {
                warn!("Meeting stream: connecting timed out");
                return retry;
            }
        };

        let settings = get_settings(&self.app);
        let language = match settings.selected_language.as_str() {
            "tr" | "en" => settings.selected_language.as_str(),
            _ => "auto",
        };
        let start = serde_json::json!({
            "type": "start",
            "sampleRate": RATE,
            "partials": true,
            "eager_final": true,
            "language": language,
        });
        if ws.send(Message::text(start.to_string())).await.is_err() {
            return retry;
        }

        // The server says "ready", or why not.
        loop {
            let next = tokio::time::timeout(Duration::from_secs(10), ws.next()).await;
            let Ok(Some(Ok(message))) = next else {
                return retry;
            };
            let Message::Text(text) = message else {
                continue;
            };
            let Ok(event) = serde_json::from_str::<ServerEvent>(&text) else {
                continue;
            };
            match event.kind.as_str() {
                "ready" => break,
                "error" => {
                    warn!("Meeting stream refused: {} ({})", event.message, event.code);
                    return match event.code.as_str() {
                        "high_demand" | "rate_limit_exceeded" | "model_loading" => {
                            Ended::Retry(Duration::from_secs(event.retry_after.clamp(1, 10)))
                        }
                        "missing_api_key" | "invalid_token" | "token_expired" | "unauthorized" => {
                            Ended::Unauthorized
                        }
                        _ => Ended::GiveUp,
                    };
                }
                _ => {}
            }
        }

        // From here on the server's times count from `base`, where the pending audio begins.
        let (base, resend) = match self.pending.lock() {
            Ok(p) => (p.start, p.audio.iter().copied().collect::<Vec<f32>>()),
            Err(_) => return Ended::GiveUp,
        };
        let mut sent = base + resend.len();
        info!(
            "Meeting stream ({}) connected at {:.1} s{}",
            self.speaker.as_str(),
            base as f64 / RATE as f64,
            if resend.is_empty() {
                String::new()
            } else {
                format!(", resending {:.1} s", resend.len() as f64 / RATE as f64)
            }
        );
        for chunk in resend.chunks(SEND_CHUNK) {
            if ws.send(Message::binary(pcm16(chunk))).await.is_err() {
                return retry;
            }
        }
        if *stopping && ws.send(Message::text(r#"{"type":"stop"}"#)).await.is_err() {
            return retry;
        }

        let at = |seconds: f64| base + (seconds.max(0.0) * RATE as f64) as usize;
        // Utterances the server has closed and not yet answered for.
        let mut open = 0usize;
        loop {
            tokio::select! {
                msg = rx.recv(), if !*stopping => match msg {
                    Some(Msg::Audio { at: from, samples }) => {
                        let skip = sent.saturating_sub(from).min(samples.len());
                        if skip < samples.len() {
                            if ws.send(Message::binary(pcm16(&samples[skip..]))).await.is_err() {
                                return retry;
                            }
                            sent = from + samples.len();
                        }
                    }
                    Some(Msg::Stop) | None => {
                        *stopping = true;
                        if ws.send(Message::text(r#"{"type":"stop"}"#)).await.is_err() {
                            return retry;
                        }
                    }
                },
                incoming = ws.next() => {
                    let Some(Ok(message)) = incoming else {
                        warn!("Meeting stream ({}) dropped", self.speaker.as_str());
                        return retry;
                    };
                    let Message::Text(text) = message else { continue };
                    let Ok(event) = serde_json::from_str::<ServerEvent>(&text) else { continue };
                    match event.kind.as_str() {
                        "partial" => self.send(LaneEvent::Partial { text: event.text }),
                        "segment_end" => open += 1,
                        "final" => {
                            open = open.saturating_sub(1);
                            let (start, end) = (at(event.start), at(event.end));
                            self.send(LaneEvent::Final { start, end, text: event.text });
                            if let Ok(mut p) = self.pending.lock() {
                                p.answered(end.saturating_sub(MARGIN));
                            }
                        }
                        "vad" if !event.active && open == 0 => {
                            if let Ok(mut p) = self.pending.lock() {
                                p.answered(at(event.t).saturating_sub(MARGIN));
                            }
                        }
                        "stopped" => {
                            let _ = ws.close(None).await;
                            return Ended::Stopped;
                        }
                        "error" => {
                            warn!("Meeting stream error: {} ({})", event.message, event.code);
                            if event.code == "quota_exceeded" {
                                return Ended::GiveUp;
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
    }
}

/// 16-bit little-endian PCM, as the server takes it.
fn pcm16(samples: &[f32]) -> Vec<u8> {
    samples
        .iter()
        .flat_map(|s| ((s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16).to_le_bytes())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn answered_audio_leaves_pending() {
        let mut p = Pending {
            start: 100,
            audio: (0..50).map(|i| i as f32).collect(),
        };
        p.answered(90); // before what is kept: nothing changes
        assert_eq!((p.start, p.audio.len()), (100, 50));
        p.answered(120);
        assert_eq!((p.start, p.audio.len(), p.audio[0]), (120, 30, 20.0));
        p.answered(1_000);
        assert_eq!((p.start, p.audio.len()), (150, 0));
    }

    #[test]
    fn pcm_is_little_endian_and_clamped() {
        assert_eq!(pcm16(&[0.0, 1.0, -2.0]), vec![0, 0, 0xff, 0x7f, 0x01, 0x80]);
    }
}
