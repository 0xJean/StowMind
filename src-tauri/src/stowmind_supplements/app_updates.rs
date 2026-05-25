//! StowMind supplement for App update scanning.
//!
//! Mole's website describes App Store / Sparkle / Electron update scanning, but
//! the current Mole CLI / JSON surface does not expose that scanner. This
//! adapter fills the UI gap with clearly labeled StowMind supplement scanning.
//! It is not Mole-native and should be replaced by Mole once official CLI / JSON
//! support exists.

mod app_store;
mod electron;
mod homebrew;
mod macos;
mod sparkle;
mod types;
mod version;
mod windows;

use crate::mole_utils::current_platform;
use serde::Serialize;
use std::process::{Command, Output};
pub use types::StowmindSupplementAppUpdateScan;
use types::{empty_scan, refresh_counts};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StowmindAppUpdateActionOutput {
    pub action: String,
    pub target: String,
    pub success: bool,
    pub raw_output: String,
}

#[tauri::command]
pub async fn stowmind_supplement_app_update_scan() -> Result<StowmindSupplementAppUpdateScan, String>
{
    let platform = current_platform().to_string();

    if cfg!(target_os = "macos") {
        let mut scan = tokio::task::spawn_blocking(macos::scan)
            .await
            .map_err(|e| format!("Failed to finish app scan task: {e}"))??;
        sparkle::enrich_versions(&mut scan).await;
        electron::enrich_versions(&mut scan).await;
        app_store::enrich_versions(&mut scan).await;
        homebrew::enrich_versions(&mut scan);
        refresh_counts(&mut scan);
        return Ok(scan);
    }

    if cfg!(target_os = "windows") {
        return tokio::task::spawn_blocking(windows::scan)
            .await
            .map_err(|e| format!("Failed to finish Windows app scan task: {e}"))?;
    }

    Ok(empty_scan(
        platform,
        "unsupported",
        "App update scanning currently supports macOS app information and Windows inventory only.",
    ))
}

#[tauri::command]
pub async fn stowmind_supplement_app_update_action(
    action_kind: String,
    action_target: String,
) -> Result<StowmindAppUpdateActionOutput, String> {
    let action = action_kind.trim().to_string();
    let target = action_target.trim().to_string();
    if action.is_empty() || target.is_empty() {
        return Err("Update action and target are required".to_string());
    }

    tokio::task::spawn_blocking(move || run_update_action(&action, &target))
        .await
        .map_err(|e| format!("Failed to finish app update action: {e}"))?
}

fn run_update_action(action: &str, target: &str) -> Result<StowmindAppUpdateActionOutput, String> {
    match action {
        "brew_cask_upgrade" => run_command(action, target, "brew", &["upgrade", "--cask", target]),
        "open_url" => open_target(action, target, target),
        "open_app_store" => open_target(action, target, "macappstore://showUpdatesPage"),
        "open_app" => open_target(action, target, target),
        _ => Err(format!("Unsupported app update action: {action}")),
    }
}

fn open_target(
    action: &str,
    target: &str,
    open_target: &str,
) -> Result<StowmindAppUpdateActionOutput, String> {
    let output = if cfg!(target_os = "macos") {
        Command::new("open").arg(open_target).output()
    } else if cfg!(target_os = "windows") {
        Command::new("cmd")
            .args(["/C", "start", "", open_target])
            .output()
    } else {
        Command::new("xdg-open").arg(open_target).output()
    }
    .map_err(|e| format!("Failed to open update target: {e}"))?;
    action_output(action, target, output)
}

fn run_command(
    action: &str,
    target: &str,
    command: &str,
    args: &[&str],
) -> Result<StowmindAppUpdateActionOutput, String> {
    let output = Command::new(command)
        .args(args)
        .output()
        .map_err(|e| format!("Failed to start update action: {e}"))?;
    action_output(action, target, output)
}

fn action_output(
    action: &str,
    target: &str,
    output: Output,
) -> Result<StowmindAppUpdateActionOutput, String> {
    let raw_output = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    if !output.status.success() {
        return Err(if raw_output.trim().is_empty() {
            format!("{action} failed for {target}")
        } else {
            raw_output
        });
    }
    Ok(StowmindAppUpdateActionOutput {
        action: action.to_string(),
        target: target.to_string(),
        success: true,
        raw_output,
    })
}
