//! The app a dictation went into: the frontmost application when it is saved, which
//! is the one Elchi pastes into (its own overlay never takes focus). Shown on the
//! home feed ("Mail · 2 dk"). None when it cannot be told, on Linux, or when it is
//! Elchi itself.

#[cfg(target_os = "macos")]
pub fn app_name() -> Option<String> {
    use objc2_app_kit::NSWorkspace;
    let workspace = NSWorkspace::sharedWorkspace();
    let app = workspace.frontmostApplication()?;
    let name = app.localizedName()?.to_string();
    (!name.is_empty() && name != "Elchi").then_some(name)
}

#[cfg(target_os = "windows")]
pub fn app_name() -> Option<String> {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};

    let exe = unsafe {
        let window = GetForegroundWindow();
        let mut pid = 0u32;
        GetWindowThreadProcessId(window, Some(&mut pid));
        if pid == 0 {
            return None;
        }
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_WIN32,
            PWSTR(buf.as_mut_ptr()),
            &mut len,
        );
        let _ = CloseHandle(process);
        ok.ok()?;
        String::from_utf16_lossy(&buf[..len as usize])
    };
    windows_app_name(&exe)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn app_name() -> Option<String> {
    None
}

/// A readable name for a Windows executable path ("…\\slack.exe" -> "Slack").
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn windows_app_name(path: &str) -> Option<String> {
    let stem = path
        .rsplit(['\\', '/'])
        .next()?
        .trim_end_matches(".exe")
        .trim_end_matches(".EXE");
    let known = match stem.to_lowercase().as_str() {
        "elchi" | "explorer" | "" => return None,
        "chrome" => "Chrome",
        "msedge" => "Edge",
        "firefox" => "Firefox",
        "winword" => "Word",
        "excel" => "Excel",
        "powerpnt" => "PowerPoint",
        "outlook" | "olk" => "Outlook",
        "ms-teams" | "teams" => "Teams",
        "code" => "VS Code",
        "windowsterminal" => "Terminal",
        "whatsapp" => "WhatsApp",
        "notepad" => "Notepad",
        _ => "",
    };
    if !known.is_empty() {
        return Some(known.to_string());
    }
    let mut chars = stem.chars();
    chars
        .next()
        .map(|c| c.to_uppercase().collect::<String>() + chars.as_str())
}

#[cfg(test)]
mod tests {
    use super::windows_app_name;

    #[test]
    fn windows_executables_get_readable_names() {
        assert_eq!(
            windows_app_name(r"C:\Program Files\Slack\slack.exe").as_deref(),
            Some("Slack")
        );
        assert_eq!(
            windows_app_name(r"C:\Program Files\Microsoft Office\WINWORD.EXE").as_deref(),
            Some("Word")
        );
        assert_eq!(
            windows_app_name(r"C:\Users\a\AppData\Local\Programs\cursor\Cursor.exe").as_deref(),
            Some("Cursor")
        );
        assert_eq!(windows_app_name(r"C:\Windows\explorer.exe"), None);
        assert_eq!(windows_app_name(r"C:\Program Files\Elchi\elchi.exe"), None);
    }
}
