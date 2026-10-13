//! Elchi Pro: dictation with Duyu, PatientDesk AI's full speech-to-text
//! model, through its OpenAI-compatible transcription API. Opt-in and
//! subscription based (₺200 / month, first month free, no card); the
//! on-device Duyu-small stays loaded and takes over whenever the cloud call
//! fails, so dictation keeps working offline.
//!
//! Billing is not wired yet: subscribers get a `pd_live_...` key from the
//! PatientDesk developer panel and paste it into Elchi.

use std::io::Cursor;
use std::time::Duration;

use anyhow::{anyhow, bail, Context, Result};
use serde::Deserialize;

pub const API_URL: &str = "https://voice.patientdesk.ai/v1/audio/transcriptions";
pub const MODEL: &str = "duyu-1";
/// Where "Start your free month" sends people.
pub const SIGNUP_URL: &str = "https://speech.patientdesk.ai/signup?ref=elchi";
/// Where subscribers create the API key they paste into Elchi.
pub const KEYS_URL: &str = "https://speech.patientdesk.ai/developers";
const TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Deserialize)]
struct TranscriptionResponse {
    text: String,
}

#[derive(Deserialize)]
struct ErrorBody {
    error: ErrorDetail,
}

#[derive(Deserialize)]
struct ErrorDetail {
    message: String,
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

async fn request(api_key: String, wav: Vec<u8>, language: Option<String>) -> Result<String> {
    let file = reqwest::multipart::Part::bytes(wav)
        .file_name("elchi.wav")
        .mime_str("audio/wav")?;
    let mut form = reqwest::multipart::Form::new()
        .part("file", file)
        .text("model", MODEL)
        .text("response_format", "json");
    if let Some(lang) = language {
        form = form.text("language", lang);
    }
    let resp = reqwest::Client::builder()
        .timeout(TIMEOUT)
        .build()?
        .post(API_URL)
        .bearer_auth(api_key)
        .multipart(form)
        .send()
        .await
        .context("could not reach the Duyu API")?;
    let status = resp.status();
    let body = resp.bytes().await?;
    if !status.is_success() {
        let message = serde_json::from_slice::<ErrorBody>(&body)
            .map(|e| e.error.message)
            .unwrap_or_else(|_| String::from_utf8_lossy(&body).chars().take(200).collect());
        if status.as_u16() == 401 || status.as_u16() == 403 {
            bail!("the Duyu API rejected the key ({status}): {message}");
        }
        bail!("the Duyu API returned {status}: {message}");
    }
    let parsed: TranscriptionResponse =
        serde_json::from_slice(&body).context("unexpected response from the Duyu API")?;
    Ok(parsed.text.trim().to_string())
}

/// Transcribes 16 kHz mono audio with Duyu in the cloud. `language` is a
/// hint (`tr` / `en`); `None` lets the model decide. Blocking: runs the
/// request on its own thread so it is safe to call from inside or outside
/// an async runtime.
pub fn transcribe(api_key: &str, audio: &[f32], language: Option<&str>) -> Result<String> {
    if api_key.trim().is_empty() {
        bail!("no Elchi Pro key");
    }
    let wav = wav_bytes(audio, 16_000)?;
    let key = api_key.trim().to_string();
    let language = language.map(str::to_string);
    std::thread::spawn(move || tauri::async_runtime::block_on(request(key, wav, language)))
        .join()
        .map_err(|_| anyhow!("Duyu API request thread panicked"))?
}

/// Checks a key by transcribing half a second of silence.
pub fn verify_key(api_key: &str) -> Result<()> {
    transcribe(api_key, &vec![0.0; 8_000], Some("tr")).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wav_has_header_and_samples() {
        let w = wav_bytes(&[0.0, 0.5, -1.0, 2.0], 16_000).unwrap();
        assert_eq!(&w[..4], b"RIFF");
        assert_eq!(w.len(), 44 + 4 * 2);
        let last = i16::from_le_bytes([w[w.len() - 2], w[w.len() - 1]]);
        assert_eq!(last, i16::MAX); // clamped
    }

    #[test]
    fn empty_key_is_refused_without_a_request() {
        assert!(transcribe("  ", &[0.0; 16], None).is_err());
    }
}
