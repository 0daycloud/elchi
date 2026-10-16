//! Meeting notes, the Granola way: Elchi records the user's microphone and the call's audio
//! as two tracks (so it knows who said what without guessing voices), transcribes them in
//! pieces while the meeting goes on, and when it ends writes notes from the transcript and
//! the user's own rough notes (Duyu Pro, on PatientDesk's servers: POST /v1/elchi/notes).
//! Nothing joins the call; macOS shows its own recording indicators, and Elchi's windows are
//! left out of screen sharing while a meeting is recorded.
//!
//! By default only the notes stay: no audio is written, and the transcript is deleted once
//! the notes are. "Keep meeting recordings" keeps both. Without Duyu Pro, or when the notes
//! fail, the transcript is what the meeting leaves.

mod capture;
mod chunk;
pub mod detect;
pub mod pill;
mod share;
pub mod store;
mod webm;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use log::{error, info, warn};
use serde::Serialize;
use specta::Type;
use tauri::{AppHandle, Emitter, Manager};

use crate::managers::history::HistoryManager;
use crate::managers::transcription::TranscriptionManager;
use crate::settings::{get_settings, write_settings};
use capture::{Capture, RATE};
use store::{Meeting, Segment};

/// The meeting being recorded, if any.
static ACTIVE: Mutex<Option<Active>> = Mutex::new(None);

struct Active {
    id: i64,
    started_at: i64,
    call_audio: bool,
    ending: Arc<AtomicBool>,
    worker: Option<std::thread::JoinHandle<()>>,
}

#[derive(Clone, Serialize, Type)]
pub struct ActiveMeeting {
    pub id: i64,
    pub started_at: i64,
    /// The call's audio is recorded too (false: only the microphone, e.g. macOS before 14.6).
    pub call_audio: bool,
}

#[derive(Clone, Serialize, Type)]
pub struct MeetingDetail {
    pub meeting: Meeting,
    pub segments: Vec<Segment>,
}

#[derive(Clone, Serialize, Type)]
struct SegmentEvent {
    meeting_id: i64,
    segment: Segment,
}

#[derive(Clone, Serialize, Type)]
struct LevelEvent {
    me: f32,
    them: f32,
}

fn db(app: &AppHandle) -> Result<rusqlite::Connection, String> {
    app.state::<Arc<HistoryManager>>()
        .connection()
        .map_err(|e| e.to_string())
}

fn changed(app: &AppHandle) {
    let _ = app.emit("meetings-changed", ());
}

pub fn is_recording() -> bool {
    ACTIVE.lock().map(|a| a.is_some()).unwrap_or(false)
}

fn audio_dir(app: &AppHandle, id: i64) -> Option<std::path::PathBuf> {
    crate::portable::app_data_dir(app)
        .ok()
        .map(|d| d.join("meetings").join(id.to_string()))
}

/// At startup: meetings cut short by a quit keep their transcript, marked as interrupted.
pub fn init(app: &AppHandle) {
    match db(app).and_then(|c| store::mark_interrupted(&c).map_err(|e| e.to_string())) {
        Ok(n) if n > 0 => warn!("{n} meeting(s) were interrupted when Elchi last quit"),
        Ok(_) => {}
        Err(e) => error!("Meetings: could not check for interrupted meetings: {e}"),
    }
}

/// Elchi's windows are left out of screen sharing and screenshots while a meeting is recorded.
pub fn hide_from_capture(window: &tauri::WebviewWindow, hidden: bool) {
    #[cfg(target_os = "macos")]
    {
        let Ok(ptr) = window.ns_window() else { return };
        let ptr = ptr as usize;
        let _ = window.run_on_main_thread(move || {
            use objc2_app_kit::{NSWindow, NSWindowSharingType};
            // SAFETY: Tauri's NSWindow, alive while its webview window is; on the main thread.
            let ns: &NSWindow = unsafe { &*(ptr as *const NSWindow) };
            ns.setSharingType(if hidden {
                NSWindowSharingType::None
            } else {
                NSWindowSharingType::ReadOnly
            });
        });
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (window, hidden);
}

fn hide_all_from_capture(app: &AppHandle, hidden: bool) {
    for window in app.webview_windows().values() {
        hide_from_capture(window, hidden);
    }
}

// Starting, ending and discarding wait on audio devices and on the last piece's
// transcription: off the main thread, so the window never stalls.
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
#[specta::specta]
pub async fn start_meeting(app: AppHandle) -> Result<ActiveMeeting, String> {
    blocking(move || start(app)).await
}

fn start(app: AppHandle) -> Result<ActiveMeeting, String> {
    let mut active = ACTIVE.lock().map_err(|e| e.to_string())?;
    if active.is_some() {
        return Err("A meeting is already being recorded.".into());
    }
    let settings = get_settings(&app);
    let capture = Capture::start(settings.selected_microphone.clone())?;
    let call_audio = capture.them.is_some();
    let started_at = chrono::Utc::now().timestamp();
    let keep = settings.meeting_keep_recording;
    let id = store::create(&db(&app)?, started_at, keep).map_err(|e| e.to_string())?;
    // With Duyu Pro the pieces go to the cloud; otherwise Duyu-small has to be loaded.
    if let Some(tm) = app.try_state::<Arc<TranscriptionManager>>() {
        tm.initiate_model_load();
    }
    let ending = Arc::new(AtomicBool::new(false));
    let worker = {
        let (app, ending) = (app.clone(), ending.clone());
        std::thread::Builder::new()
            .name("meeting".into())
            .spawn(move || record(app, id, capture, keep, ending))
            .map_err(|e| e.to_string())?
    };
    *active = Some(Active {
        id,
        started_at,
        call_audio,
        ending,
        worker: Some(worker),
    });
    drop(active);
    hide_all_from_capture(&app, true);
    pill::show(&app);
    info!("Meeting {id} started (call audio: {call_audio}, keep: {keep})");
    changed(&app);
    Ok(ActiveMeeting {
        id,
        started_at,
        call_audio,
    })
}

#[tauri::command]
#[specta::specta]
pub fn get_active_meeting() -> Option<ActiveMeeting> {
    let active = ACTIVE.lock().ok()?;
    active.as_ref().map(|a| ActiveMeeting {
        id: a.id,
        started_at: a.started_at,
        call_audio: a.call_audio,
    })
}

/// Ends the recording; the last piece is transcribed and the notes written in the background.
#[tauri::command]
#[specta::specta]
pub async fn stop_meeting(app: AppHandle) -> Result<i64, String> {
    blocking(move || stop(app)).await
}

fn stop(app: AppHandle) -> Result<i64, String> {
    let taken = ACTIVE.lock().map_err(|e| e.to_string())?.take();
    let Some(mut active) = taken else {
        return Err("No meeting is being recorded.".into());
    };
    let id = active.id;
    pill::hide(&app);
    store::end(&db(&app)?, id, chrono::Utc::now().timestamp()).map_err(|e| e.to_string())?;
    hide_all_from_capture(&app, false);
    changed(&app);
    active.ending.store(true, Ordering::SeqCst);
    let worker = active.worker.take();
    std::thread::spawn(move || {
        if let Some(w) = worker {
            let _ = w.join();
        }
        write_notes(&app, id);
    });
    Ok(id)
}

/// Ends the recording and deletes the meeting: nothing of it stays.
#[tauri::command]
#[specta::specta]
pub async fn cancel_meeting(app: AppHandle) -> Result<(), String> {
    blocking(move || cancel(app)).await
}

fn cancel(app: AppHandle) -> Result<(), String> {
    let taken = ACTIVE.lock().map_err(|e| e.to_string())?.take();
    let Some(mut active) = taken else {
        return Ok(());
    };
    pill::hide(&app);
    hide_all_from_capture(&app, false);
    active.ending.store(true, Ordering::SeqCst);
    if let Some(w) = active.worker.take() {
        let _ = w.join();
    }
    delete(&app, active.id)?;
    info!("Meeting {} cancelled", active.id);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn list_meetings(app: AppHandle) -> Result<Vec<Meeting>, String> {
    store::list(&db(&app)?).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn get_meeting(app: AppHandle, id: i64) -> Result<MeetingDetail, String> {
    let conn = db(&app)?;
    let meeting = store::get(&conn, id)
        .map_err(|e| e.to_string())?
        .ok_or("No such meeting.")?;
    let segments = store::segments(&conn, id).map_err(|e| e.to_string())?;
    Ok(MeetingDetail { meeting, segments })
}

#[tauri::command]
#[specta::specta]
pub fn set_meeting_user_notes(app: AppHandle, id: i64, text: String) -> Result<(), String> {
    store::set_user_notes(&db(&app)?, id, &text).map_err(|e| e.to_string())
}

/// The user's own title for a meeting; the notes keep it rather than titling it themselves.
#[tauri::command]
#[specta::specta]
pub fn set_meeting_title(app: AppHandle, id: i64, title: String) -> Result<(), String> {
    store::set_title(&db(&app)?, id, title.trim()).map_err(|e| e.to_string())
}

/// The notes after the user ticked a to-do in them.
#[tauri::command]
#[specta::specta]
pub fn set_meeting_notes(app: AppHandle, id: i64, notes: String) -> Result<(), String> {
    store::update_notes(&db(&app)?, id, &notes).map_err(|e| e.to_string())
}

/// Deletes a meeting, and stops sharing it first: a link nobody can stop any more must
/// not outlive it. Fails with `unshare_failed` when sharing could not be stopped.
#[tauri::command]
#[specta::specta]
pub async fn delete_meeting(app: AppHandle, id: i64) -> Result<(), String> {
    if get_active_meeting().is_some_and(|a| a.id == id) {
        return cancel_meeting(app).await;
    }
    let share_id = store::share_id(&db(&app)?, id).map_err(|e| e.to_string())?;
    if let Some(share_id) = share_id {
        stop_sharing(&app, &share_id).await?;
    }
    delete(&app, id)
}

fn delete(app: &AppHandle, id: i64) -> Result<(), String> {
    store::delete(&db(app)?, id).map_err(|e| e.to_string())?;
    if let Some(dir) = audio_dir(app, id) {
        let _ = std::fs::remove_dir_all(dir);
    }
    changed(app);
    Ok(())
}

/// Writes the notes again (after a failure, or once the user has Duyu Pro), from the
/// transcript a meeting without notes keeps.
#[tauri::command]
#[specta::specta]
pub fn retry_meeting_notes(app: AppHandle, id: i64) -> Result<(), String> {
    store::set_status(&db(&app)?, id, "processing").map_err(|e| e.to_string())?;
    changed(&app);
    std::thread::spawn(move || write_notes(&app, id));
    Ok(())
}

/// The kept recording of one side (`me` or `them`), for playback.
#[tauri::command]
#[specta::specta]
pub fn meeting_audio_path(app: AppHandle, id: i64, speaker: String) -> Option<String> {
    if speaker != "me" && speaker != "them" {
        return None;
    }
    let path = audio_dir(&app, id)?.join(format!("{speaker}.wav"));
    path.exists().then(|| path.to_string_lossy().into_owned())
}

/// Shares a finished meeting by link (see share.rs): its notes, with its transcript and
/// its recording when asked and still kept. Answers the link; a meeting already shared
/// keeps the link it has. Errors are codes the interface explains: `needs_pro`,
/// `too_long` (the recording is past what the server takes) or `failed`.
#[tauri::command]
#[specta::specta]
pub async fn share_meeting(
    app: AppHandle,
    id: i64,
    transcript: bool,
    recording: bool,
) -> Result<String, String> {
    if get_active_meeting().is_some_and(|a| a.id == id) {
        return Err("failed".into());
    }
    let result = share(&app, id, transcript, recording).await;
    match &result {
        Ok(url) => {
            info!("Meeting {id} shared (transcript: {transcript}, recording: {recording}): {url}")
        }
        Err(e) => warn!("Meeting {id} not shared: {e}"),
    }
    changed(&app);
    result
}

fn elchi_pro(app: &AppHandle) -> Result<Arc<crate::elchi_pro::ElchiPro>, String> {
    app.try_state::<Arc<crate::elchi_pro::ElchiPro>>()
        .map(|s| s.inner().clone())
        .ok_or_else(|| "failed".to_string())
}

/// The Duyu Pro token, which only the trial and Elchi Pro get.
async fn cloud_token(elchi: &Arc<crate::elchi_pro::ElchiPro>) -> Result<String, String> {
    let elchi = elchi.clone();
    blocking(move || Ok(elchi.cloud_token()))
        .await?
        .ok_or_else(|| "needs_pro".to_string())
}

fn share_error(e: crate::elchi_pro::CloudError) -> String {
    use crate::elchi_pro::CloudError;
    match e {
        CloudError::NotEntitled | CloudError::Unauthorized => "needs_pro".into(),
        CloudError::Other(e) => {
            warn!("Sharing failed: {e:#}");
            "failed".into()
        }
    }
}

async fn share(
    app: &AppHandle,
    id: i64,
    transcript: bool,
    recording: bool,
) -> Result<String, String> {
    use crate::elchi_pro::CloudError;
    let (meeting, segments) = {
        let conn = db(app)?;
        let meeting = store::get(&conn, id)
            .map_err(|e| e.to_string())?
            .ok_or("No such meeting.")?;
        if let Some(url) = meeting.share_url.clone() {
            return Ok(url);
        }
        let segments = if transcript {
            store::segments(&conn, id).map_err(|e| e.to_string())?
        } else {
            Vec::new()
        };
        (meeting, segments)
    };

    let mut mixed = None;
    let tracks: Vec<_> = audio_dir(app, id)
        .filter(|_| recording)
        .map(|dir| ["me.wav", "them.wav"].map(|f| dir.join(f)).to_vec())
        .unwrap_or_default()
        .into_iter()
        .filter(|p| p.exists())
        .collect();
    if let Some(dir) = tracks
        .first()
        .and_then(|p| p.parent())
        .map(|d| d.to_path_buf())
    {
        let length = share::mixed_length(&tracks).ok_or("failed")?;
        if length > share::MAX_RECORDING {
            return Err("too_long".into());
        }
        let out = dir.join(format!("share.{}", share::AUDIO_FORMAT));
        let path = out.clone();
        blocking(move || share::mix(&tracks, &out).map_err(|e| format!("{e:#}"))).await?;
        let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        if size == 0 || size > share::MAX_AUDIO_BYTES {
            let _ = std::fs::remove_file(&path);
            return Err(if size == 0 { "failed" } else { "too_long" }.into());
        }
        mixed = Some((path, size));
    }

    let notes = meeting
        .notes
        .clone()
        .unwrap_or_else(|| meeting.user_notes.clone());
    let request = share::ShareRequest {
        title: meeting.title.trim(),
        notes: &notes,
        started_at: meeting.started_at,
        ended_at: meeting.ended_at,
        segments: (!segments.is_empty()).then(|| {
            segments
                .iter()
                .map(|s| share::ShareSegment {
                    speaker: &s.speaker,
                    start_ms: s.start_ms,
                    end_ms: s.end_ms,
                    text: &s.text,
                })
                .collect()
        }),
        audio_bytes: mixed.as_ref().map(|m| m.1),
        audio_format: mixed.as_ref().map(|_| share::AUDIO_FORMAT),
    };

    let elchi = elchi_pro(app)?;
    let result = async {
        let mut created = None;
        for attempt in 0..2 {
            let token = cloud_token(&elchi).await?;
            match share::create(&token, &request).await {
                Ok(c) => {
                    created = Some(c);
                    break;
                }
                Err(CloudError::Unauthorized) if attempt == 0 => {
                    let elchi = elchi.clone();
                    blocking(move || elchi.refresh().map_err(|e| format!("{e:#}"))).await?;
                }
                Err(CloudError::NotEntitled) => {
                    let elchi = elchi.clone();
                    let _ = blocking(move || {
                        elchi.mark_not_entitled();
                        Ok(())
                    })
                    .await;
                    return Err("needs_pro".to_string());
                }
                Err(e) => return Err(share_error(e)),
            }
        }
        let created = created.ok_or("needs_pro")?;
        if let (Some(upload_url), Some((path, _))) = (&created.upload_url, &mixed) {
            let uploaded = async {
                share::upload(upload_url, path).await?;
                // A long upload can outlast the token it started with.
                let token = cloud_token(&elchi)
                    .await
                    .map_err(|_| CloudError::NotEntitled)?;
                share::finish(&token, &created.id).await
            };
            if let Err(e) = uploaded.await {
                // Leave nothing half shared behind.
                if let Ok(token) = cloud_token(&elchi).await {
                    let _ = share::revoke(&token, &created.id).await;
                }
                return Err(share_error(e));
            }
        }
        Ok(created)
    }
    .await;
    if let Some((path, _)) = &mixed {
        let _ = std::fs::remove_file(path);
    }
    let created = result?;
    store::set_share(&db(app)?, id, Some((&created.id, &created.url)))
        .map_err(|e| e.to_string())?;
    Ok(created.url)
}

/// Stops sharing a meeting: its link stops working and the server's copy is deleted.
#[tauri::command]
#[specta::specta]
pub async fn unshare_meeting(app: AppHandle, id: i64) -> Result<(), String> {
    let share_id = store::share_id(&db(&app)?, id).map_err(|e| e.to_string())?;
    if let Some(share_id) = share_id {
        stop_sharing(&app, &share_id).await?;
        store::set_share(&db(&app)?, id, None).map_err(|e| e.to_string())?;
        info!("Meeting {id} no longer shared");
        changed(&app);
    }
    Ok(())
}

async fn stop_sharing(app: &AppHandle, share_id: &str) -> Result<(), String> {
    use crate::elchi_pro::CloudError;
    let elchi = elchi_pro(app)?;
    for attempt in 0..2 {
        let token = {
            let elchi = elchi.clone();
            blocking(move || Ok(elchi.install_token())).await?
        }
        .ok_or("unshare_failed")?;
        match share::revoke(&token, share_id).await {
            Ok(()) => return Ok(()),
            Err(CloudError::Unauthorized) if attempt == 0 => {
                let elchi = elchi.clone();
                blocking(move || elchi.refresh().map_err(|e| format!("{e:#}"))).await?;
            }
            Err(e) => {
                warn!("Could not stop sharing {share_id}: {e}");
                return Err("unshare_failed".into());
            }
        }
    }
    Err("unshare_failed".into())
}

#[tauri::command]
#[specta::specta]
pub fn acknowledge_meeting_consent(app: AppHandle) {
    let mut settings = get_settings(&app);
    settings.meeting_consent_ack = true;
    write_settings(&app, settings);
}

#[tauri::command]
#[specta::specta]
pub fn change_meeting_detection_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = get_settings(&app);
    settings.meeting_detection = enabled;
    write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_meeting_keep_recording_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = get_settings(&app);
    settings.meeting_keep_recording = enabled;
    write_settings(&app, settings);
    Ok(())
}

fn wav_writer(
    path: &std::path::Path,
) -> Option<hound::WavWriter<std::io::BufWriter<std::fs::File>>> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: RATE as u32,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    hound::WavWriter::create(path, spec)
        .map_err(|e| warn!("Meeting audio not kept: {e}"))
        .ok()
}

fn take(track: &capture::Shared) -> (Vec<f32>, f32) {
    match track.lock() {
        Ok(mut t) => (std::mem::take(&mut t.samples), t.level),
        Err(_) => (Vec::new(), 0.0),
    }
}

/// The meeting's worker: takes the audio as it arrives, keeps it on disk if asked, and
/// transcribes it piece by piece until the meeting ends.
fn record(app: AppHandle, id: i64, mut capture: Capture, keep: bool, ending: Arc<AtomicBool>) {
    let mut writers = (None, None);
    if keep {
        if let Some(dir) = audio_dir(&app, id) {
            if std::fs::create_dir_all(&dir).is_ok() {
                writers.0 = wav_writer(&dir.join("me.wav"));
                if capture.them.is_some() {
                    writers.1 = wav_writer(&dir.join("them.wav"));
                }
            }
        }
    }
    let (mut me, mut them) = (Vec::<f32>::new(), Vec::<f32>::new());
    let mut offset = 0usize;
    loop {
        let last = ending.load(Ordering::SeqCst);
        if last {
            capture.stop();
        }
        let (new_me, level_me) = take(&capture.me);
        let (new_them, level_them) = capture.them.as_ref().map(take).unwrap_or_default();
        for (samples, writer) in [(&new_me, &mut writers.0), (&new_them, &mut writers.1)] {
            if let Some(w) = writer.as_mut() {
                for s in samples.iter() {
                    let _ = w.write_sample((s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16);
                }
            }
        }
        me.extend(new_me);
        them.extend(new_them);
        let _ = app.emit(
            "meeting-level",
            LevelEvent {
                me: level_me,
                them: level_them,
            },
        );
        let call = capture.them.is_some();
        while let Some(cut) = chunk::cut_point(&me, call.then_some(them.as_slice()), last) {
            let piece_me: Vec<f32> = me.drain(..cut.min(me.len())).collect();
            let piece_them: Vec<f32> = them.drain(..cut.min(them.len())).collect();
            let start_ms = (offset * 1000 / RATE) as i64;
            offset += cut;
            let end_ms = (offset * 1000 / RATE) as i64;
            transcribe_piece(&app, id, &piece_me, &piece_them, start_ms, end_ms);
        }
        if last {
            break;
        }
        std::thread::sleep(Duration::from_millis(400));
    }
    for writer in [writers.0, writers.1].into_iter().flatten() {
        let _ = writer.finalize();
    }
    info!("Meeting {id}: recording ended after {} s", offset / RATE);
}

fn transcribe(app: &AppHandle, audio: &[f32]) -> Option<String> {
    if !chunk::has_speech(audio) {
        return None;
    }
    let tm = app.try_state::<Arc<TranscriptionManager>>()?;
    match tm.transcribe(audio.to_vec()) {
        Ok(text) if !text.trim().is_empty() => Some(text.trim().to_string()),
        Ok(_) => None,
        Err(e) => {
            warn!("Meeting piece not transcribed: {e:#}");
            None
        }
    }
}

/// One piece of the meeting: the others first (what they said is what the user answers),
/// then the user, unless the microphone only heard the call through the speakers.
fn transcribe_piece(app: &AppHandle, id: i64, me: &[f32], them: &[f32], start: i64, end: i64) {
    let theirs = transcribe(app, them);
    let mine = transcribe(app, me)
        .filter(|text| !theirs.as_deref().is_some_and(|t| chunk::is_echo(text, t)));
    let Ok(conn) = db(app) else { return };
    for (speaker, text) in [("them", theirs), ("me", mine)] {
        let Some(text) = text else { continue };
        match store::add_segment(&conn, id, speaker, start, end, &text) {
            Ok(segment) => {
                let _ = app.emit(
                    "meeting-segment",
                    SegmentEvent {
                        meeting_id: id,
                        segment,
                    },
                );
            }
            Err(e) => error!("Meeting {id}: segment not saved: {e}"),
        }
    }
}

/// The language a meeting was held in (Turkish or English), from what was said and
/// written: the notes are in it, whatever language Elchi's own screens are in. None when
/// there is too little to tell.
fn language_of(texts: &[&str]) -> Option<&'static str> {
    const TR: &[&str] = &[
        "ve", "bir", "bu", "da", "de", "için", "ile", "ama", "çok", "ne", "mi", "var", "yok",
        "gibi", "daha", "şey", "olarak", "ben", "sen", "biz",
    ];
    const EN: &[&str] = &[
        "the", "and", "is", "to", "of", "we", "you", "that", "it", "for", "with", "this", "are",
        "was", "be", "have", "not", "on",
    ];
    let (mut tr, mut en) = (0usize, 0usize);
    for text in texts {
        tr += text.chars().filter(|c| "çğıöşüÇĞİÖŞÜ".contains(*c)).count();
        for word in text.split(|c: char| !c.is_alphanumeric()) {
            let word = word.to_lowercase();
            tr += 2 * TR.contains(&word.as_str()) as usize;
            en += 2 * EN.contains(&word.as_str()) as usize;
        }
    }
    match (tr, en) {
        (0, 0) => None,
        (tr, en) if tr >= en => Some("tr"),
        _ => Some("en"),
    }
}

/// Writes a finished meeting's notes with Duyu Pro, then drops the transcript and audio
/// unless they are kept. Without Duyu Pro, or if the notes fail, the transcript stays.
fn write_notes(app: &AppHandle, id: i64) {
    let result = (|| -> Result<&'static str, String> {
        let conn = db(app)?;
        let meeting = store::get(&conn, id)
            .map_err(|e| e.to_string())?
            .ok_or("meeting gone")?;
        let segments = store::segments(&conn, id).map_err(|e| e.to_string())?;
        if segments.is_empty() && meeting.user_notes.trim().is_empty() {
            return Ok("empty");
        }
        let Some(elchi) = app.try_state::<Arc<crate::elchi_pro::ElchiPro>>() else {
            return Ok("no_notes");
        };
        let spoken: Vec<&str> = segments
            .iter()
            .map(|s| s.text.as_str())
            .chain(std::iter::once(meeting.user_notes.as_str()))
            .collect();
        let language =
            language_of(&spoken).unwrap_or(if get_settings(app).app_language.starts_with("en") {
                "en"
            } else {
                "tr"
            });
        let parts: Vec<crate::elchi_pro::NotesSegment> = segments
            .iter()
            .map(|s| crate::elchi_pro::NotesSegment {
                speaker: &s.speaker,
                text: &s.text,
            })
            .collect();
        for attempt in 0..2 {
            let Some(token) = elchi.cloud_token() else {
                return Ok("no_notes");
            };
            let call =
                crate::elchi_pro::meeting_notes(&token, &parts, &meeting.user_notes, language);
            match tauri::async_runtime::block_on(call) {
                Ok(notes) => {
                    // A title the user gave the meeting stays.
                    let title = if meeting.title.trim().is_empty() {
                        notes.title.trim()
                    } else {
                        meeting.title.trim()
                    };
                    store::set_notes(&conn, id, title, notes.notes.trim())
                        .map_err(|e| e.to_string())?;
                    if !meeting.kept {
                        store::drop_transcript(&conn, id).map_err(|e| e.to_string())?;
                    }
                    return Ok("done");
                }
                Err(crate::elchi_pro::CloudError::Unauthorized) if attempt == 0 => {
                    elchi.refresh().map_err(|e| format!("{e:#}"))?;
                }
                Err(crate::elchi_pro::CloudError::NotEntitled) => {
                    elchi.mark_not_entitled();
                    return Ok("no_notes");
                }
                Err(e) => return Err(e.to_string()),
            }
        }
        Ok("no_notes")
    })();
    let status = result.unwrap_or_else(|e| {
        warn!("Meeting {id}: notes not written: {e}");
        "no_notes"
    });
    if status != "done" {
        if let Ok(conn) = db(app) {
            let _ = store::set_status(&conn, id, status);
        }
    }
    info!("Meeting {id}: {status}");
    changed(app);
}

#[cfg(test)]
mod tests {
    use super::language_of;

    #[test]
    fn notes_follow_the_language_spoken_not_the_apps() {
        assert_eq!(
            language_of(&["Hadi lan, bu arada çok kötü CS oynuyorsun."]),
            Some("tr")
        );
        assert_eq!(
            language_of(&["Let's move the launch to the tenth of November."]),
            Some("en")
        );
        assert_eq!(language_of(&["", "OK"]), None);
    }
}
