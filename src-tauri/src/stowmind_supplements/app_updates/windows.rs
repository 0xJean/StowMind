#[cfg(not(target_os = "windows"))]
use super::types::empty_scan;
use super::types::StowmindSupplementAppUpdateScan;
#[cfg(target_os = "windows")]
use super::types::{
    refresh_counts, unix_epoch, StowmindSupplementAppUpdateItem, OPERATION, SOURCE,
};
use crate::mole_utils::current_platform;
#[cfg(target_os = "windows")]
use serde_json::Value;
#[cfg(target_os = "windows")]
use std::process::Command;

#[cfg(target_os = "windows")]
pub fn scan() -> Result<StowmindSupplementAppUpdateScan, String> {
    let script = r#"
$paths = @(
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
Get-ItemProperty $paths -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName } |
  Select-Object DisplayName, DisplayVersion, Publisher, InstallLocation |
  ConvertTo-Json -Depth 3
"#;
    let output = Command::new("powershell.exe")
        .args([
            "-NoLogo",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .output()
        .map_err(|e| format!("Failed to read Windows app inventory: {e}"))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let raw = String::from_utf8_lossy(&output.stdout);
    let parsed: Value = serde_json::from_str(raw.trim()).unwrap_or(Value::Null);
    let values = match parsed {
        Value::Array(items) => items,
        Value::Object(_) => vec![parsed],
        _ => Vec::new(),
    };

    let items = values
        .into_iter()
        .filter_map(windows_registry_item)
        .collect::<Vec<_>>();

    let mut scan = StowmindSupplementAppUpdateScan {
        source: SOURCE.to_string(),
        operation: OPERATION.to_string(),
        platform: current_platform().to_string(),
        generated_at_epoch: unix_epoch(),
        scan_status: "inventory_only".to_string(),
        message:
            "Read installed Windows apps; update availability may require vendor-specific checks."
                .to_string(),
        directories: vec!["Windows uninstall registry".to_string()],
        scanned_apps: items.len(),
        update_candidates: 0,
        app_store_apps: 0,
        sparkle_apps: 0,
        electron_apps: 0,
        items,
    };
    refresh_counts(&mut scan);
    Ok(scan)
}

#[cfg(not(target_os = "windows"))]
pub fn scan() -> Result<StowmindSupplementAppUpdateScan, String> {
    Ok(empty_scan(
        current_platform().to_string(),
        "unsupported",
        "Windows app inventory is not available on this platform.",
    ))
}

#[cfg(target_os = "windows")]
fn windows_registry_item(value: Value) -> Option<StowmindSupplementAppUpdateItem> {
    let name = json_string(&value, "DisplayName")?;
    Some(StowmindSupplementAppUpdateItem {
        name,
        path: json_string(&value, "InstallLocation").unwrap_or_default(),
        bundle_id: json_string(&value, "Publisher"),
        installed_version: json_string(&value, "DisplayVersion"),
        latest_version: None,
        provider: "windows_registry".to_string(),
        update_status: "unknown".to_string(),
        confidence: "inventory_only".to_string(),
        feed_url: None,
        detail: "Installed app inventory from system records; update availability is not inferred automatically.".to_string(),
        action_kind: None,
        action_target: None,
        action_label: None,
    })
}

#[cfg(target_os = "windows")]
fn json_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)?
        .as_str()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}
