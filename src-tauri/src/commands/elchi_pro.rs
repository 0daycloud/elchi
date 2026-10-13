//! Commands behind the Elchi Pro card (see crate::elchi_pro).

use serde::Serialize;
use specta::Type;
use tauri::AppHandle;

use crate::settings::{get_settings, write_settings, SecretString};

#[derive(Serialize, Type)]
pub struct ElchiProInfo {
    pub enabled: bool,
    pub has_key: bool,
    pub price_try_monthly: u32,
    pub free_months: u32,
    pub model: String,
    pub signup_url: String,
    pub keys_url: String,
}

#[tauri::command]
#[specta::specta]
pub fn get_elchi_pro_info(app: AppHandle) -> ElchiProInfo {
    let settings = get_settings(&app);
    ElchiProInfo {
        enabled: settings.elchi_pro_enabled,
        has_key: !settings.elchi_pro_api_key.0.trim().is_empty(),
        price_try_monthly: 200,
        free_months: 1,
        model: crate::elchi_pro::MODEL.to_string(),
        signup_url: crate::elchi_pro::SIGNUP_URL.to_string(),
        keys_url: crate::elchi_pro::KEYS_URL.to_string(),
    }
}

/// Checks the key against the Duyu API, then saves it and turns Pro on.
#[tauri::command]
#[specta::specta]
pub async fn connect_elchi_pro(app: AppHandle, api_key: String) -> Result<(), String> {
    let key = api_key.trim().to_string();
    if key.is_empty() {
        return Err("Enter your Elchi Pro key.".to_string());
    }
    let probe = key.clone();
    tauri::async_runtime::spawn_blocking(move || crate::elchi_pro::verify_key(&probe))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("{e:#}"))?;
    let mut settings = get_settings(&app);
    settings.elchi_pro_api_key = SecretString(key);
    settings.elchi_pro_enabled = true;
    write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn set_elchi_pro_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = get_settings(&app);
    if enabled && settings.elchi_pro_api_key.0.trim().is_empty() {
        return Err("Connect an Elchi Pro key first.".to_string());
    }
    settings.elchi_pro_enabled = enabled;
    write_settings(&app, settings);
    Ok(())
}

/// Forgets the key and turns Pro off.
#[tauri::command]
#[specta::specta]
pub fn disconnect_elchi_pro(app: AppHandle) {
    let mut settings = get_settings(&app);
    settings.elchi_pro_api_key = SecretString::default();
    settings.elchi_pro_enabled = false;
    write_settings(&app, settings);
}
