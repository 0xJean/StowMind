use serde::Serialize;
use std::fs;
use std::io;
use std::path::PathBuf;
use std::process::Command;

#[cfg(target_os = "windows")]
const APP_NAME: &str = "StowMind";
#[cfg(target_os = "macos")]
const LAUNCH_AGENT_LABEL: &str = "com.stowmind.app";
#[cfg(target_os = "windows")]
const WINDOWS_RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemSettingsState {
    pub platform: String,
    pub launch_at_login_supported: bool,
    pub launch_at_login_enabled: bool,
    pub full_disk_access_status: String,
}

fn platform_name() -> String {
    if cfg!(target_os = "macos") {
        "macos".to_string()
    } else if cfg!(target_os = "windows") {
        "windows".to_string()
    } else if cfg!(target_os = "linux") {
        "linux".to_string()
    } else {
        "other".to_string()
    }
}

#[cfg(target_os = "macos")]
fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn current_exe_string() -> Result<String, String> {
    std::env::current_exe()
        .map_err(|e| format!("Failed to resolve current executable: {e}"))
        .map(|path| path.to_string_lossy().to_string())
}

#[cfg(target_os = "macos")]
fn launch_agent_path() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME").ok_or_else(|| "HOME is not set".to_string())?;
    Ok(PathBuf::from(home)
        .join("Library")
        .join("LaunchAgents")
        .join(format!("{LAUNCH_AGENT_LABEL}.plist")))
}

#[cfg(target_os = "macos")]
fn launch_at_login_enabled() -> bool {
    launch_agent_path()
        .map(|path| path.exists())
        .unwrap_or(false)
}

#[cfg(target_os = "macos")]
fn set_launch_at_login(enabled: bool) -> Result<(), String> {
    let path = launch_agent_path()?;
    if !enabled {
        if path.exists() {
            fs::remove_file(&path)
                .map_err(|e| format!("Failed to remove launch agent {}: {e}", path.display()))?;
        }
        return Ok(());
    }

    let executable = xml_escape(&current_exe_string()?);
    let parent = path
        .parent()
        .ok_or_else(|| format!("Invalid launch agent path: {}", path.display()))?;
    fs::create_dir_all(parent).map_err(|e| {
        format!(
            "Failed to create launch agent directory {}: {e}",
            parent.display()
        )
    })?;

    let plist = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>{LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>{executable}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
"#
    );
    fs::write(&path, plist)
        .map_err(|e| format!("Failed to write launch agent {}: {e}", path.display()))
}

#[cfg(target_os = "windows")]
fn launch_at_login_enabled() -> bool {
    Command::new("reg")
        .args(["query", WINDOWS_RUN_KEY, "/v", APP_NAME])
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
fn set_launch_at_login(enabled: bool) -> Result<(), String> {
    if enabled {
        let executable = current_exe_string()?;
        let output = Command::new("reg")
            .args([
                "add",
                WINDOWS_RUN_KEY,
                "/v",
                APP_NAME,
                "/t",
                "REG_SZ",
                "/d",
                &executable,
                "/f",
            ])
            .output()
            .map_err(|e| format!("Failed to update Windows startup apps: {e}"))?;
        if output.status.success() {
            return Ok(());
        }
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let output = Command::new("reg")
        .args(["delete", WINDOWS_RUN_KEY, "/v", APP_NAME, "/f"])
        .output()
        .map_err(|e| format!("Failed to update Windows startup apps: {e}"))?;
    if output.status.success() || !launch_at_login_enabled() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn launch_at_login_enabled() -> bool {
    false
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn set_launch_at_login(_enabled: bool) -> Result<(), String> {
    Err("Launch at login is not supported on this platform".to_string())
}

#[cfg(target_os = "macos")]
#[derive(Clone, Copy)]
enum DiskAccessProbe {
    Granted,
    Denied,
    Missing,
    Unknown,
}

#[cfg(target_os = "macos")]
fn summarize_full_disk_access(probes: impl IntoIterator<Item = DiskAccessProbe>) -> &'static str {
    let mut saw_denied = false;

    for probe in probes {
        match probe {
            DiskAccessProbe::Granted => return "granted",
            DiskAccessProbe::Denied => saw_denied = true,
            DiskAccessProbe::Missing | DiskAccessProbe::Unknown => {}
        }
    }

    if saw_denied {
        "denied"
    } else {
        "unknown"
    }
}

#[cfg(target_os = "macos")]
fn full_disk_access_status() -> String {
    let Some(home) = std::env::var_os("HOME") else {
        return "unknown".to_string();
    };
    let home = PathBuf::from(home);
    let probes = [
        home.join("Library").join("Mail"),
        home.join("Library").join("Messages"),
        home.join("Library").join("Safari"),
    ];

    let results = probes.into_iter().map(|probe| match fs::read_dir(&probe) {
        Ok(_) => DiskAccessProbe::Granted,
        Err(error) if error.kind() == io::ErrorKind::PermissionDenied => DiskAccessProbe::Denied,
        Err(error) if error.kind() == io::ErrorKind::NotFound => DiskAccessProbe::Missing,
        Err(_) => DiskAccessProbe::Unknown,
    });

    summarize_full_disk_access(results).to_string()
}

#[cfg(not(target_os = "macos"))]
fn full_disk_access_status() -> String {
    if cfg!(target_os = "windows") {
        "unknown".to_string()
    } else {
        "unsupported".to_string()
    }
}

#[tauri::command]
pub fn system_settings_state() -> SystemSettingsState {
    SystemSettingsState {
        platform: platform_name(),
        launch_at_login_supported: cfg!(any(target_os = "macos", target_os = "windows")),
        launch_at_login_enabled: launch_at_login_enabled(),
        full_disk_access_status: full_disk_access_status(),
    }
}

#[tauri::command]
pub fn set_system_launch_at_login(enabled: bool) -> Result<SystemSettingsState, String> {
    set_launch_at_login(enabled)?;
    Ok(system_settings_state())
}

#[tauri::command]
pub fn open_system_settings(target: String) -> Result<(), String> {
    let target = target.trim();
    if target.is_empty() {
        return Err("Missing system settings target".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        let uri = match target {
            "login_items" => "x-apple.systempreferences:com.apple.LoginItems-Settings.extension",
            "full_disk_access" => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"
            }
            _ => {
                return Err(format!(
                    "Unsupported macOS system settings target: {target}"
                ))
            }
        };
        Command::new("open")
            .arg(uri)
            .spawn()
            .map_err(|e| format!("Failed to open macOS system settings: {e}"))?;
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        let uri = match target {
            "login_items" => "ms-settings:startupapps",
            "full_disk_access" => "ms-settings:privacy-broadfilesystemaccess",
            _ => {
                return Err(format!(
                    "Unsupported Windows system settings target: {target}"
                ))
            }
        };
        Command::new("cmd")
            .args(["/C", "start", "", uri])
            .spawn()
            .map_err(|e| format!("Failed to open Windows settings: {e}"))?;
        return Ok(());
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Err(format!(
            "System settings target is not supported on this platform: {target}"
        ))
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::{summarize_full_disk_access, DiskAccessProbe};

    #[test]
    fn granted_probe_wins_over_an_earlier_denial() {
        let status = summarize_full_disk_access([
            DiskAccessProbe::Denied,
            DiskAccessProbe::Granted,
            DiskAccessProbe::Missing,
        ]);

        assert_eq!(status, "granted");
    }

    #[test]
    fn denied_requires_at_least_one_permission_error() {
        let status = summarize_full_disk_access([
            DiskAccessProbe::Missing,
            DiskAccessProbe::Denied,
            DiskAccessProbe::Unknown,
        ]);

        assert_eq!(status, "denied");
    }

    #[test]
    fn inconclusive_probes_remain_unknown() {
        let status =
            summarize_full_disk_access([DiskAccessProbe::Missing, DiskAccessProbe::Unknown]);

        assert_eq!(status, "unknown");
    }
}
