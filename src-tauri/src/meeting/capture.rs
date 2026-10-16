//! The two sides of a meeting as 16 kHz mono: the microphone (the user) and what the computer
//! plays (everyone else on the call). For the second, cpal opens an input stream on the output
//! device, which on macOS 14.6+ is a Core Audio process tap: macOS asks once for "System Audio
//! Recording Only", nothing joins the call, and the audio still plays as usual.
//!
//! cpal streams may not leave the thread that built them, so one thread owns both and drops
//! them when the meeting ends. Their audio lands in shared buffers the meeting's worker drains.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, Sample, SampleFormat, SizedSample};
use log::{info, warn};
use rubato::audioadapter_buffers::direct::SequentialSlice;
use rubato::{Fft, FixedSync, Indexing, Resampler, WindowFunction};

pub const RATE: usize = 16_000;
const RESAMPLER_CHUNK: usize = 1024;

/// One side's audio, waiting for the worker, and how loud it was lately (for the meters).
#[derive(Default)]
pub struct Track {
    pub samples: Vec<f32>,
    pub level: f32,
    /// Samples ever received: the capture thread watches it to tell a stalled stream.
    pub received: u64,
}

pub type Shared = Arc<Mutex<Track>>;

pub struct Capture {
    pub me: Shared,
    /// None when the call's audio cannot be recorded here (an older macOS, Linux). Where it
    /// can, the track is there even while the tap is not open yet: it is retried every few
    /// seconds, and a call that takes the headset as the meeting starts lets it open late.
    pub them: Option<Shared>,
    stop: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl Capture {
    /// Opens the microphone (`mic`: a device name, or the default) and the call's audio.
    pub fn start(mic: Option<String>) -> Result<Self, String> {
        let me: Shared = Arc::default();
        let them: Shared = Arc::default();
        let stop = Arc::new(AtomicBool::new(false));
        let supported = system_audio_supported();
        let (ready_tx, ready_rx) = mpsc::channel::<Result<bool, String>>();
        let (me2, them2, stop2) = (me.clone(), them.clone(), stop.clone());
        let thread = std::thread::Builder::new()
            .name("meeting-capture".into())
            .spawn(move || {
                let host = cpal::default_host();
                let mic_device = mic
                    .as_deref()
                    .and_then(|name| {
                        host.input_devices()
                            .ok()?
                            .find(|d| d.description().map(|x| x.name() == name).unwrap_or(false))
                    })
                    .or_else(|| host.default_input_device());
                let Some(mic_device) = mic_device else {
                    let _ = ready_tx.send(Err("no microphone".into()));
                    return;
                };
                let mic_stream = match open(&mic_device, true, me2) {
                    Ok(s) => s,
                    Err(e) => {
                        let _ = ready_tx.send(Err(format!("microphone: {e}")));
                        return;
                    }
                };
                // The call's audio is a bonus: without it the meeting is the user's side only.
                let mut call = if supported {
                    open_call(&host, &them2)
                        .map_err(|e| warn!("Meeting: the call's audio is not recorded: {e}"))
                        .ok()
                } else {
                    None
                };
                let _ = ready_tx.send(Ok(call.is_some()));
                let mut ticks = 0u32;
                let mut last_received = 0u64;
                let mut stalled_for = 0u32;
                // Reopened for a stall at most every 30 s, in case a tap sends nothing at
                // all while nothing plays.
                let mut since_stall_reopen = u32::MAX;
                while !stop2.load(Ordering::SeqCst) {
                    std::thread::sleep(Duration::from_millis(100));
                    ticks += 1;
                    if !supported || ticks % 10 != 0 {
                        continue;
                    }
                    since_stall_reopen = since_stall_reopen.saturating_add(1);
                    // Once a second: the call's audio follows the output device (AirPods
                    // connecting, a call switching them to headset mode, another speaker
                    // chosen) and is reopened when it stops arriving: the tap belongs to
                    // the device it was opened on, and goes silent when that one changes.
                    let received = them2.lock().map(|t| t.received).unwrap_or(0);
                    stalled_for = if received == last_received {
                        stalled_for + 1
                    } else {
                        0
                    };
                    last_received = received;
                    let now = host.default_output_device().and_then(|d| device_id(&d));
                    let moved = call
                        .as_ref()
                        .is_some_and(|c| now.is_some() && now != c.device);
                    let reason = if call.is_none() {
                        (stalled_for % 3 == 0).then_some("not open")
                    } else if moved {
                        Some("the output device changed")
                    } else if stalled_for >= 3 && since_stall_reopen >= 30 {
                        since_stall_reopen = 0;
                        Some("it stopped arriving")
                    } else {
                        None
                    };
                    if let Some(reason) = reason {
                        drop(call.take());
                        match open_call(&host, &them2) {
                            Ok(c) => {
                                info!(
                                    "Meeting: the call's audio reopened ({reason}) on {:?}",
                                    c.device
                                );
                                call = Some(c);
                                stalled_for = 0;
                            }
                            Err(e) => warn!(
                                "Meeting: the call's audio could not be reopened ({reason}): {e}"
                            ),
                        }
                    }
                }
                drop(call);
                drop(mic_stream);
            })
            .map_err(|e| e.to_string())?;
        let open = ready_rx
            .recv_timeout(Duration::from_secs(10))
            .map_err(|_| "audio devices did not open".to_string())??;
        info!(
            "Meeting capture started (call audio: {})",
            match (supported, open) {
                (false, _) => "not on this system",
                (true, true) => "open",
                (true, false) => "not open yet, retrying",
            }
        );
        Ok(Self {
            me,
            them: supported.then_some(them),
            stop,
            thread: Some(thread),
        })
    }

    pub fn stop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

impl Drop for Capture {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Recording what the computer plays needs a Core Audio tap (macOS 14.6+, cpal's floor) or
/// WASAPI loopback (Windows). Linux's monitor sources are not wired up yet.
fn system_audio_supported() -> bool {
    #[cfg(target_os = "macos")]
    {
        let v = objc2_foundation::NSProcessInfo::processInfo().operatingSystemVersion();
        (v.majorVersion, v.minorVersion) >= (14, 6)
    }
    #[cfg(target_os = "windows")]
    {
        true
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        false
    }
}

/// The call's audio, from whichever output device is the default now.
struct Call {
    _stream: cpal::Stream,
    device: Option<String>,
}

fn device_id(device: &cpal::Device) -> Option<String> {
    device.id().ok().map(|id| id.to_string())
}

fn open_call(host: &cpal::Host, track: &Shared) -> Result<Call, String> {
    let device = host
        .default_output_device()
        .ok_or_else(|| "no output device".to_string())?;
    Ok(Call {
        device: device_id(&device),
        _stream: open(&device, false, track.clone())?,
    })
}

fn open(device: &cpal::Device, input: bool, track: Shared) -> Result<cpal::Stream, String> {
    let config = if input {
        device.default_input_config()
    } else {
        device.default_output_config()
    }
    .map_err(|e| e.to_string())?;
    let format = config.sample_format();
    let channels = config.channels() as usize;
    let rate = config.sample_rate() as usize;
    let mut sink = Sink::new(rate, channels, track)?;
    let err = |e: cpal::Error| warn!("Meeting audio stream: {e}");
    macro_rules! build {
        ($t:ty) => {
            device.build_input_stream::<$t, _, _>(
                config.into(),
                move |data: &[$t], _: &_| sink.push(data),
                err,
                None,
            )
        };
    }
    let stream = match format {
        SampleFormat::F32 => build!(f32),
        SampleFormat::I16 => build!(i16),
        SampleFormat::I32 => build!(i32),
        SampleFormat::U16 => build!(u16),
        other => return Err(format!("unsupported sample format {other}")),
    }
    .map_err(|e| e.to_string())?;
    stream.play().map_err(|e| e.to_string())?;
    Ok(stream)
}

/// Downmixes a stream to mono, resamples it to 16 kHz and appends it to its track.
struct Sink {
    channels: usize,
    resampler: Option<Fft<f32>>,
    pending: Vec<f32>,
    out: Vec<f32>,
    track: Shared,
}

impl Sink {
    fn new(rate: usize, channels: usize, track: Shared) -> Result<Self, String> {
        let resampler = if rate == RATE {
            None
        } else {
            let r = Fft::<f32>::new_custom(
                rate,
                RATE,
                RESAMPLER_CHUNK,
                1,
                1,
                WindowFunction::BlackmanHarris2,
                FixedSync::Input,
            )
            .map_err(|e| e.to_string())?;
            Some(r)
        };
        let out = vec![0.0; resampler.as_ref().map_or(0, |r| r.output_frames_max())];
        Ok(Self {
            channels: channels.max(1),
            resampler,
            pending: Vec::with_capacity(RESAMPLER_CHUNK * 2),
            out,
            track,
        })
    }

    fn push<T: SizedSample>(&mut self, data: &[T])
    where
        f32: FromSample<T>,
    {
        let mono = data.chunks(self.channels).map(|frame| {
            frame.iter().map(|s| f32::from_sample(*s)).sum::<f32>() / frame.len() as f32
        });
        let mut ready = Vec::new();
        match self.resampler.as_mut() {
            None => ready.extend(mono),
            Some(resampler) => {
                for s in mono {
                    self.pending.push(s);
                    if self.pending.len() == RESAMPLER_CHUNK {
                        let input =
                            SequentialSlice::new(&self.pending, 1, RESAMPLER_CHUNK).unwrap();
                        let frames = self.out.len();
                        let mut output =
                            SequentialSlice::new_mut(&mut self.out, 1, frames).unwrap();
                        let indexing = Indexing::new().partial_len(RESAMPLER_CHUNK);
                        if let Ok((_, n)) =
                            resampler.process_into_buffer(&input, &mut output, Some(&indexing))
                        {
                            ready.extend_from_slice(&self.out[..n]);
                        }
                        self.pending.clear();
                    }
                }
            }
        }
        if ready.is_empty() {
            return;
        }
        let rms = (ready.iter().map(|s| s * s).sum::<f32>() / ready.len() as f32).sqrt();
        if let Ok(mut t) = self.track.lock() {
            t.samples.extend_from_slice(&ready);
            t.received += ready.len() as u64;
            t.level = t.level * 0.6 + rms * 0.4;
        }
    }
}
