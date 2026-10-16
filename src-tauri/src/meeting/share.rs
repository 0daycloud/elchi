//! Sharing a finished meeting by link (https://elchi.xyz/<id>): a snapshot of its notes,
//! and its transcript and recording when the user picks them, kept on PatientDesk's
//! servers until the user stops sharing. Whoever has the link can read, listen and
//! download. The website's /api/elchi/shares makes the link (Duyu Pro token: the trial
//! and Elchi Pro only) and hands back a signed URL the recording goes straight to; once
//! it is all there, the link starts to work. Stopping takes any plan's token.

use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::anyhow;
use serde::{Deserialize, Serialize};

use crate::elchi_pro::{CloudError, SITE_URL};

const SHARES_URL: &str = "https://speech.patientdesk.ai/api/elchi/shares";
/// The bucket's limit on the server: a little over four hours of the mixed recording.
pub const MAX_AUDIO_BYTES: u64 = 500 * 1024 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Serialize)]
pub struct ShareSegment<'a> {
    pub speaker: &'a str,
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: &'a str,
}

#[derive(Serialize)]
pub struct ShareRequest<'a> {
    pub title: &'a str,
    pub notes: &'a str,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub segments: Option<Vec<ShareSegment<'a>>>,
    pub audio_bytes: Option<u64>,
}

#[derive(Deserialize)]
pub struct CreatedShare {
    pub id: String,
    pub url: String,
    pub upload_url: Option<String>,
}

fn client(timeout: Option<Duration>) -> Result<reqwest::Client, CloudError> {
    let mut builder = reqwest::Client::builder().connect_timeout(CONNECT_TIMEOUT);
    if let Some(t) = timeout {
        builder = builder.timeout(t);
    }
    builder.build().map_err(|e| CloudError::Other(e.into()))
}

async fn status_of(what: &str, resp: reqwest::Response) -> Result<reqwest::Response, CloudError> {
    match resp.status().as_u16() {
        200..=299 => Ok(resp),
        401 => Err(CloudError::Unauthorized),
        402 | 403 => Err(CloudError::NotEntitled),
        status => {
            let body = resp.text().await.unwrap_or_default();
            Err(CloudError::Other(anyhow!(
                "{what} returned {status}: {body}"
            )))
        }
    }
}

/// Makes the link. With a recording to come, it works only after `finish`.
pub async fn create(token: &str, req: &ShareRequest<'_>) -> Result<CreatedShare, CloudError> {
    let resp = client(Some(REQUEST_TIMEOUT))?
        .post(SHARES_URL)
        .bearer_auth(token)
        .json(req)
        .send()
        .await
        .map_err(|e| CloudError::Other(anyhow!("sharing unreachable: {e}")))?;
    let created: CreatedShare = status_of("sharing", resp)
        .await?
        .json()
        .await
        .map_err(|e| CloudError::Other(anyhow!("sharing: bad response: {e}")))?;
    if !is_share_url(&created.url) {
        return Err(CloudError::Other(anyhow!("sharing: unexpected link")));
    }
    Ok(created)
}

/// Puts the recording where the server said, as it is on disk: no time limit, since a
/// long meeting on a slow connection takes a while.
pub async fn upload(upload_url: &str, wav: &Path) -> Result<(), CloudError> {
    if !upload_url.starts_with("https://") {
        return Err(CloudError::Other(anyhow!("sharing: unexpected upload URL")));
    }
    let file = tokio::fs::File::open(wav)
        .await
        .map_err(|e| CloudError::Other(e.into()))?;
    let len = file
        .metadata()
        .await
        .map_err(|e| CloudError::Other(e.into()))?
        .len();
    let resp = client(None)?
        .put(upload_url)
        .header(reqwest::header::CONTENT_TYPE, "audio/wav")
        .header(reqwest::header::CONTENT_LENGTH, len)
        .body(reqwest::Body::from(file))
        .send()
        .await
        .map_err(|e| CloudError::Other(anyhow!("recording upload failed: {e}")))?;
    status_of("recording upload", resp).await.map(|_| ())
}

/// The recording is up: the link starts to work.
pub async fn finish(token: &str, id: &str) -> Result<(), CloudError> {
    let resp = client(Some(REQUEST_TIMEOUT))?
        .post(format!("{SHARES_URL}/{id}/ready"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| CloudError::Other(anyhow!("sharing unreachable: {e}")))?;
    status_of("sharing", resp).await.map(|_| ())
}

/// Stops sharing: the link stops working and the server deletes its copy.
pub async fn revoke(token: &str, id: &str) -> Result<(), CloudError> {
    let resp = client(Some(REQUEST_TIMEOUT))?
        .delete(format!("{SHARES_URL}/{id}"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| CloudError::Other(anyhow!("sharing unreachable: {e}")))?;
    // Gone already (404) is what stopping wants.
    if resp.status().as_u16() == 404 {
        return Ok(());
    }
    status_of("stop sharing", resp).await.map(|_| ())
}

/// The size of the mixed recording the two kept tracks make, without making it.
pub fn mixed_size(tracks: &[PathBuf]) -> Option<u64> {
    let samples = tracks
        .iter()
        .filter_map(|p| hound::WavReader::open(p).ok().map(|r| r.duration() as u64))
        .max()?;
    (samples > 0).then_some(44 + samples * 2)
}

/// One file to listen to: the user's microphone and the call's audio mixed into 16 kHz
/// mono, sample by sample (both tracks start when the meeting does).
pub fn mix(tracks: &[PathBuf], out: &Path) -> anyhow::Result<()> {
    let mut readers = tracks
        .iter()
        .map(hound::WavReader::open)
        .collect::<Result<Vec<_>, _>>()?;
    let spec = readers
        .first()
        .map(|r| r.spec())
        .ok_or_else(|| anyhow!("no recording to share"))?;
    let mut writer = hound::WavWriter::create(out, spec)?;
    let mut samples: Vec<_> = readers.iter_mut().map(|r| r.samples::<i16>()).collect();
    loop {
        let mut any = false;
        let mut sum = 0i32;
        for s in samples.iter_mut() {
            if let Some(v) = s.next() {
                sum += v? as i32;
                any = true;
            }
        }
        if !any {
            break;
        }
        writer.write_sample(sum.clamp(i16::MIN as i32, i16::MAX as i32) as i16)?;
    }
    writer.finalize()?;
    Ok(())
}

/// Shared links point at elchi.xyz; anything else the server answers is not opened.
pub fn is_share_url(url: &str) -> bool {
    url.starts_with("https://elchi.xyz/") || url.starts_with(&format!("{SITE_URL}/elchi/s/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track(path: &Path, samples: &[i16]) {
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: 16_000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut w = hound::WavWriter::create(path, spec).unwrap();
        for s in samples {
            w.write_sample(*s).unwrap();
        }
        w.finalize().unwrap();
    }

    #[test]
    fn the_two_sides_are_mixed_into_one_recording() {
        let dir = tempfile::tempdir().unwrap();
        let (me, them, out) = (
            dir.path().join("me.wav"),
            dir.path().join("them.wav"),
            dir.path().join("share.wav"),
        );
        track(&me, &[100, -200, 30_000, 5]);
        track(&them, &[1, 2, 10_000]);
        let tracks = vec![me, them];
        assert_eq!(mixed_size(&tracks), Some(44 + 4 * 2));
        mix(&tracks, &out).unwrap();
        let mixed: Vec<i16> = hound::WavReader::open(&out)
            .unwrap()
            .samples::<i16>()
            .map(Result::unwrap)
            .collect();
        // Summed, clipped rather than wrapped, and as long as the longer side.
        assert_eq!(mixed, vec![101, -198, i16::MAX, 5]);
        assert_eq!(std::fs::metadata(&out).unwrap().len(), 44 + 4 * 2);
    }

    #[test]
    fn only_elchis_own_links_are_trusted() {
        assert!(is_share_url("https://elchi.xyz/AbCdEfGhIjKlMnOpQrStUv"));
        assert!(is_share_url(
            "https://speech.patientdesk.ai/elchi/s/AbCdEfGhIjKlMnOpQrStUv"
        ));
        assert!(!is_share_url("https://elchi.xyz.evil.example/x"));
        assert!(!is_share_url("http://elchi.xyz/x"));
    }
}
