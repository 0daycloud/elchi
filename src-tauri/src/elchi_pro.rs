//! Duyu Pro in Elchi: the first 7 days after a machine first registers, and
//! for Elchi Pro subscribers, recordings are transcribed by Duyu Pro (the
//! cloud model `duyu-1`); otherwise by Duyu-small on this computer.
//!
//! The entitlement lives on speech.patientdesk.ai. The app registers the
//! machine (a stable install id, so reinstalling does not restart the trial)
//! with `POST /api/elchi/session`, which answers with the plan and, while the
//! cloud is allowed, a short-lived token for the transcription API. Any cloud
//! failure falls back to Duyu-small, so dictation keeps working offline.

use std::io::Cursor;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::{anyhow, bail, Context, Result};
use chrono::{DateTime, Utc};
use log::{debug, info, warn};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use specta::Type;
use tauri::{AppHandle, Emitter, Manager};

use crate::settings::{get_settings, write_settings, SecretString};

pub const SITE_URL: &str = "https://speech.patientdesk.ai";
pub const API_URL: &str = "https://voice.patientdesk.ai/v1/audio/transcriptions";
pub const MODEL: &str = "duyu-1";
const TRANSCRIBE_TIMEOUT: Duration = Duration::from_secs(30);
const SESSION_TIMEOUT: Duration = Duration::from_secs(15);
/// How often the plan is re-checked in the background.
const REFRESH_EVERY: Duration = Duration::from_secs(3 * 60 * 60);
/// After the upgrade page is opened, how often and how long to look for the
/// activation, so the app switches to Pro within seconds.
const WATCH_EVERY: Duration = Duration::from_secs(5);
const WATCH_FOR: Duration = Duration::from_secs(20 * 60);
/// Refresh the token when it has less than this left.
const TOKEN_MARGIN_S: i64 = 120;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum Plan {
    Trial,
    Pro,
    Free,
}

/// The server's answer, cached in settings so the app knows its plan offline.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct ElchiSession {
    pub plan: Plan,
    pub cloud: bool,
    pub trial_ends_at: Option<String>,
    pub pro_until: Option<String>,
    pub token: Option<SecretString>,
    pub token_expires_at: Option<String>,
    pub upgrade_url: String,
    pub price_try_monthly: u32,
    pub free_months: u32,
}

/// What the interface shows: the session without the token.
#[derive(Clone, Debug, Serialize, Type)]
pub struct ElchiProStatus {
    /// None until the first successful check with the server.
    pub plan: Option<Plan>,
    /// Whether recordings go to Duyu Pro right now.
    pub cloud_active: bool,
    pub use_pro: bool,
    pub trial_ends_at: Option<String>,
    pub pro_until: Option<String>,
    pub price_try_monthly: u32,
    pub free_months: u32,
}

#[derive(Debug)]
pub enum CloudError {
    /// The token was refused (expired or revoked): refresh the session.
    Unauthorized,
    /// The plan no longer covers Duyu Pro.
    NotEntitled,
    Other(anyhow::Error),
}

impl std::fmt::Display for CloudError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CloudError::Unauthorized => f.write_str("Duyu Pro token refused"),
            CloudError::NotEntitled => f.write_str("Duyu Pro is not included in this plan"),
            CloudError::Other(e) => write!(f, "{e:#}"),
        }
    }
}

/// sha256 of the machine id: stable across reinstalls, reveals nothing.
pub fn install_id() -> Result<String> {
    let uid = machine_uid::get().map_err(|e| anyhow!("machine id unavailable: {e}"))?;
    let digest = Sha256::digest(format!("elchi-install:{}", uid.trim()).as_bytes());
    Ok(format!("{digest:x}"))
}

fn platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    }
}

fn parse_time(s: &Option<String>) -> Option<DateTime<Utc>> {
    s.as_deref()
        .and_then(|t| DateTime::parse_from_rfc3339(t).ok())
        .map(|t| t.with_timezone(&Utc))
}

impl ElchiSession {
    /// A token that is still good for a while, if the plan includes the cloud.
    fn usable_token(&self, now: DateTime<Utc>) -> Option<String> {
        if !self.cloud {
            return None;
        }
        let token = self.token.as_ref().filter(|t| !t.0.is_empty())?;
        let expires = parse_time(&self.token_expires_at)?;
        ((expires - now).num_seconds() > TOKEN_MARGIN_S).then(|| token.0.clone())
    }
}

#[derive(Serialize)]
struct SessionRequest<'a> {
    install_id: &'a str,
    platform: &'a str,
    app_version: &'a str,
    locale: &'a str,
}

async fn request_session(locale: String) -> Result<ElchiSession> {
    request_session_for(&install_id()?, locale).await
}

async fn request_session_for(id: &str, locale: String) -> Result<ElchiSession> {
    let body = SessionRequest {
        install_id: id,
        platform: platform(),
        app_version: env!("CARGO_PKG_VERSION"),
        locale: &locale,
    };
    let resp = reqwest::Client::builder()
        .timeout(SESSION_TIMEOUT)
        .build()?
        .post(format!("{SITE_URL}/api/elchi/session"))
        .json(&body)
        .send()
        .await
        .context("could not reach speech.patientdesk.ai")?;
    let status = resp.status();
    if !status.is_success() {
        bail!("Elchi session request returned {status}");
    }
    resp.json::<ElchiSession>()
        .await
        .context("unexpected Elchi session response")
}

pub struct ElchiPro {
    app: AppHandle,
    /// Serializes refreshes so a burst of callers makes one request.
    refresh_lock: Mutex<()>,
    watch_until: Mutex<Option<std::time::Instant>>,
}

impl ElchiPro {
    pub fn new(app: &AppHandle) -> Arc<Self> {
        Arc::new(Self {
            app: app.clone(),
            refresh_lock: Mutex::new(()),
            watch_until: Mutex::new(None),
        })
    }

    /// Starts the background refresh: now, every few hours, and every few
    /// seconds while an upgrade is being watched for.
    pub fn start(self: &Arc<Self>) {
        let this = self.clone();
        std::thread::spawn(move || {
            let mut last = None::<std::time::Instant>;
            loop {
                let watching = this
                    .watch_until
                    .lock()
                    .unwrap()
                    .is_some_and(|until| std::time::Instant::now() < until);
                let due = last.is_none_or(|t| t.elapsed() >= REFRESH_EVERY);
                if due || watching {
                    if let Err(e) = this.refresh() {
                        debug!("Elchi session refresh failed: {e:#}");
                    }
                    last = Some(std::time::Instant::now());
                }
                std::thread::sleep(WATCH_EVERY);
            }
        });
    }

    pub fn status(&self) -> ElchiProStatus {
        let settings = get_settings(&self.app);
        let session = settings.elchi_session.as_ref();
        ElchiProStatus {
            plan: session.map(|s| s.plan),
            cloud_active: settings.elchi_use_pro
                && session.is_some_and(|s| s.usable_token(Utc::now()).is_some()),
            use_pro: settings.elchi_use_pro,
            trial_ends_at: session.and_then(|s| s.trial_ends_at.clone()),
            pro_until: session.and_then(|s| s.pro_until.clone()),
            price_try_monthly: session.map_or(200, |s| s.price_try_monthly),
            free_months: session.map_or(1, |s| s.free_months),
        }
    }

    /// Asks the server for the current plan and a fresh token, stores them
    /// and tells the interface. Blocking.
    pub fn refresh(&self) -> Result<ElchiSession> {
        let _guard = self.refresh_lock.lock().unwrap();
        let locale = get_settings(&self.app).app_language;
        let session =
            std::thread::spawn(move || tauri::async_runtime::block_on(request_session(locale)))
                .join()
                .map_err(|_| anyhow!("Elchi session thread panicked"))??;

        let mut settings = get_settings(&self.app);
        let before = settings.elchi_session.as_ref().map(|s| s.plan);
        settings.elchi_session = Some(session.clone());
        write_settings(&self.app, settings);

        if before != Some(session.plan) {
            info!("Elchi plan: {:?} -> {:?}", before, session.plan);
            if session.plan == Plan::Pro {
                *self.watch_until.lock().unwrap() = None;
            }
            if before.is_some_and(|p| p != Plan::Free) && session.plan == Plan::Free {
                self.on_trial_ended();
            }
        }
        let _ = self.app.emit("elchi-pro-changed", self.status());
        Ok(session)
    }

    /// The token to send to Duyu Pro, refreshing it if it is about to expire.
    /// None when Duyu Pro is off, not in the plan, or unreachable.
    pub fn cloud_token(&self) -> Option<String> {
        let settings = get_settings(&self.app);
        if !settings.elchi_use_pro {
            return None;
        }
        let now = Utc::now();
        if let Some(token) = settings
            .elchi_session
            .as_ref()
            .and_then(|s| s.usable_token(now))
        {
            return Some(token);
        }
        // Only worth a round trip if the plan may include the cloud.
        if settings.elchi_session.as_ref().is_some_and(|s| !s.cloud) {
            return None;
        }
        self.refresh().ok().and_then(|s| s.usable_token(Utc::now()))
    }

    /// Opens the upgrade page and watches for the activation.
    pub fn open_upgrade(&self) -> Result<()> {
        let url = match get_settings(&self.app).elchi_session {
            Some(s) => s.upgrade_url,
            None => self.refresh()?.upgrade_url,
        };
        if !url.starts_with(&format!("{SITE_URL}/")) {
            bail!("unexpected upgrade URL");
        }
        use tauri_plugin_opener::OpenerExt;
        self.app
            .opener()
            .open_url(&url, None::<&str>)
            .map_err(|e| anyhow!("could not open the browser: {e}"))?;
        *self.watch_until.lock().unwrap() = Some(std::time::Instant::now() + WATCH_FOR);
        Ok(())
    }

    /// Called when a transcription learns the plan no longer covers Duyu Pro.
    pub fn mark_not_entitled(&self) {
        if let Err(e) = self.refresh() {
            warn!("Elchi session refresh after a refused request failed: {e:#}");
        }
    }

    /// The trial (or subscription) just ended: bring the main window up once
    /// so the upgrade banner is seen.
    fn on_trial_ended(&self) {
        let mut settings = get_settings(&self.app);
        if settings.elchi_trial_end_seen {
            return;
        }
        settings.elchi_trial_end_seen = true;
        write_settings(&self.app, settings);
        if let Some(window) = self.app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
        }
        let _ = self.app.emit("elchi-trial-ended", ());
    }
}

fn wav_bytes(audio: &[f32], sample_rate: u32) -> Result<Vec<u8>> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut buf = Cursor::new(Vec::with_capacity(audio.len() * 2 + 44));
    {
        let mut w = hound::WavWriter::new(&mut buf, spec)?;
        for &s in audio {
            w.write_sample((s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16)?;
        }
        w.finalize()?;
    }
    Ok(buf.into_inner())
}

#[derive(Deserialize)]
struct TranscriptionResponse {
    text: String,
}

async fn request_transcription(
    token: String,
    wav: Vec<u8>,
    language: Option<String>,
) -> Result<String, CloudError> {
    let file = reqwest::multipart::Part::bytes(wav)
        .file_name("elchi.wav")
        .mime_str("audio/wav")
        .map_err(|e| CloudError::Other(e.into()))?;
    let mut form = reqwest::multipart::Form::new()
        .part("file", file)
        .text("model", MODEL)
        .text("response_format", "json");
    if let Some(lang) = language {
        form = form.text("language", lang);
    }
    let client = reqwest::Client::builder()
        .timeout(TRANSCRIBE_TIMEOUT)
        .build()
        .map_err(|e| CloudError::Other(e.into()))?;
    let resp = client
        .post(API_URL)
        .bearer_auth(token)
        .multipart(form)
        .send()
        .await
        .map_err(|e| CloudError::Other(anyhow!(e).context("could not reach the Duyu API")))?;
    match resp.status().as_u16() {
        200..=299 => resp
            .json::<TranscriptionResponse>()
            .await
            .map(|r| r.text.trim().to_string())
            .map_err(|e| CloudError::Other(anyhow!(e).context("unexpected Duyu API response"))),
        401 => Err(CloudError::Unauthorized),
        402 | 403 => Err(CloudError::NotEntitled),
        status => Err(CloudError::Other(anyhow!("the Duyu API returned {status}"))),
    }
}

/// Transcribes 16 kHz mono audio with Duyu Pro. `language` is a hint
/// (`tr` / `en`); None lets the model decide. Blocking; safe to call from
/// inside or outside an async runtime.
pub fn transcribe(
    token: &str,
    audio: &[f32],
    language: Option<&str>,
) -> Result<String, CloudError> {
    let wav = wav_bytes(audio, 16_000).map_err(CloudError::Other)?;
    let token = token.to_string();
    let language = language.map(str::to_string);
    std::thread::spawn(move || {
        tauri::async_runtime::block_on(request_transcription(token, wav, language))
    })
    .join()
    .map_err(|_| CloudError::Other(anyhow!("Duyu API request thread panicked")))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(cloud: bool, token: Option<&str>, expires_in_s: i64) -> ElchiSession {
        ElchiSession {
            plan: if cloud { Plan::Trial } else { Plan::Free },
            cloud,
            trial_ends_at: None,
            pro_until: None,
            token: token.map(|t| SecretString(t.to_string())),
            token_expires_at: Some(
                (Utc::now() + chrono::Duration::seconds(expires_in_s)).to_rfc3339(),
            ),
            upgrade_url: format!("{SITE_URL}/elchi/activate?code=x"),
            price_try_monthly: 200,
            free_months: 1,
        }
    }

    #[test]
    fn token_used_only_while_cloud_and_fresh() {
        let now = Utc::now();
        assert_eq!(
            session(true, Some("t"), 3600).usable_token(now).as_deref(),
            Some("t")
        );
        assert!(session(true, Some("t"), 30).usable_token(now).is_none()); // about to expire
        assert!(session(false, Some("t"), 3600).usable_token(now).is_none());
        assert!(session(true, None, 3600).usable_token(now).is_none());
        assert!(session(true, Some(""), 3600).usable_token(now).is_none());
    }

    #[test]
    fn session_response_parses() {
        let json = r#"{"plan":"trial","cloud":true,"trial_ends_at":"2026-10-20T10:00:00Z",
            "pro_until":null,"token":"abc","token_expires_at":"2026-10-13T22:00:00Z",
            "upgrade_url":"https://speech.patientdesk.ai/elchi/activate?code=x",
            "price_try_monthly":200,"free_months":1}"#;
        let s: ElchiSession = serde_json::from_str(json).unwrap();
        assert_eq!(s.plan, Plan::Trial);
        assert_eq!(s.token.unwrap().0, "abc");
    }

    #[test]
    fn install_id_is_stable_hex() {
        let a = install_id().unwrap();
        assert_eq!(a, install_id().unwrap());
        assert_eq!(a.len(), 64);
        assert!(a
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
    }

    /// Against the live site and API, with a throwaway install id:
    /// `cargo test --lib elchi_pro::tests::live -- --ignored --nocapture`.
    /// Prints the install id so the row can be deleted afterwards.
    #[test]
    #[ignore = "talks to speech.patientdesk.ai and voice.patientdesk.ai"]
    fn live_trial_session_transcribes() {
        let id = format!(
            "{:x}",
            Sha256::digest(format!(
                "elchi-live-test-{}",
                Utc::now().timestamp_nanos_opt().unwrap()
            ))
        );
        println!("test install id: {id}");
        let session =
            tauri::async_runtime::block_on(request_session_for(&id, "tr".into())).unwrap();
        assert_eq!(session.plan, Plan::Trial);
        let token = session.usable_token(Utc::now()).expect("trial token");
        assert!(session
            .upgrade_url
            .starts_with(&format!("{SITE_URL}/elchi/activate?code=")));

        let clips = std::env::var("DUYU_TEST_CLIPS").expect("DUYU_TEST_CLIPS");
        let mut r = hound::WavReader::open(format!("{clips}/tr1.wav")).unwrap();
        let audio: Vec<f32> = r
            .samples::<i16>()
            .map(|s| s.unwrap() as f32 / 32768.0)
            .collect();
        let text = transcribe(&token, &audio, None).unwrap();
        println!("Duyu Pro: {text}");
        assert!(text.to_lowercase().contains("toplantı"));
        assert!(matches!(
            transcribe("not-a-token", &audio, None),
            Err(CloudError::Unauthorized)
        ));
    }

    #[test]
    fn wav_has_header_and_samples() {
        let w = wav_bytes(&[0.0, 0.5, -1.0, 2.0], 16_000).unwrap();
        assert_eq!(&w[..4], b"RIFF");
        assert_eq!(w.len(), 44 + 4 * 2);
    }
}
