//! Installer adapter: Mole discovers and deletes; StowMind binds confirmation to that scan.
mod protocol;
mod review;
mod scripts;
#[cfg(test)]
mod tests;
mod types;

use crate::mole_utils::{command_with_runtime_path, locate_selected_mole_script};
use std::{path::Path, process::Stdio};
use tauri::Window;
use types::{MoleInstallerExecuteOutcome, MoleInstallerPreview, ReviewedInstaller};

#[tauri::command]
pub async fn mole_installer_preview(window: Window) -> Result<MoleInstallerPreview, String> {
    let label = window.label().to_string();
    tokio::task::spawn_blocking(move || {
        let script = std::fs::canonicalize(locate_selected_mole_script("installer.sh")?)
            .map_err(|error| format!("Mole installer script is unavailable: {error}"))?;
        let reviewed = collect_installer_items(&script)?;
        let items: Vec<_> = reviewed.iter().map(|entry| entry.item.clone()).collect();
        let total_size = items
            .iter()
            .try_fold(0_u64, |sum, item| sum.checked_add(item.size))
            .ok_or("Installer scan size exceeds the supported range")?;
        let review_token = if items.is_empty() {
            None
        } else {
            Some(review::issue(reviewed, script, &label)?)
        };
        Ok(MoleInstallerPreview {
            items,
            total_size,
            scan_status: "complete",
            review_token,
        })
    })
    .await
    .map_err(|error| format!("Failed to join installer preview task: {error}"))?
}

fn collect_installer_items(script: &Path) -> Result<Vec<ReviewedInstaller>, String> {
    let output = command_with_runtime_path("/bin/bash")
        .args(["-c", &scripts::collect_script(&script.to_string_lossy())])
        .env("MOLE_TEST_MODE", "1")
        .stdin(Stdio::null())
        .output()
        .map_err(|error| format!("Failed to run Mole installer preview: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "Mole installer preview failed (status {:?}): {}",
            output.status.code(),
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    protocol::parse_records(&String::from_utf8_lossy(&output.stdout))
}

#[tauri::command]
pub async fn mole_installer_execute(
    window: Window,
    paths: Vec<String>,
    review_token: String,
) -> Result<MoleInstallerExecuteOutcome, String> {
    let reviewed = review::consume(&review_token, window.label(), &paths)?;
    tokio::task::spawn_blocking(move || {
        let script = std::fs::canonicalize(locate_selected_mole_script("installer.sh")?)
            .map_err(|error| format!("Mole installer script is unavailable: {error}"))?;
        if script != reviewed.script {
            return Err("The selected Mole runtime changed; scan installers again".to_string());
        }
        let mut command = command_with_runtime_path("/bin/bash");
        command.args([
            "-c",
            &scripts::execute_script(&reviewed.script.to_string_lossy()),
            "stowmind-installer-execute",
        ]);
        for entry in &reviewed.items {
            command
                .arg(&entry.item.path)
                .arg(entry.item.size.to_string())
                .arg(&entry.identity);
        }
        let output = command
            .env("MOLE_TEST_MODE", "1")
            .stdin(Stdio::null())
            .output()
            .map_err(|error| format!("Failed to run Mole installer execute: {error}"))?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let raw = if stderr.trim().is_empty() {
            stdout.into_owned()
        } else {
            format!("{stdout}\n{stderr}")
        };
        // Failed runs can contain confirmed partial results. Never substitute preview estimates.
        Ok(protocol::parse_outcome(&raw, output.status.success()))
    })
    .await
    .map_err(|error| format!("Failed to join installer execute task: {error}"))?
}
