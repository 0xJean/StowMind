mod parser;
mod review;
mod scripts;
#[cfg(test)]
mod tests;
mod types;

use crate::mole_utils::locate_selected_mole_script;
use parser::{parse_outcome, parse_records, preview_size};
use std::{
    path::Path,
    process::{Command, Output, Stdio},
    sync::{Mutex, OnceLock},
};
use tauri::Window;
use types::{MoleExecuteOutcome, MolePurgeItem, MolePurgePreview};

// Mole's helper scripts maintain process-local preview/operation files. Avoid
// overlapping invocations and bind destructive runs to a fresh native preview.
static OPERATION: OnceLock<Mutex<()>> = OnceLock::new();

#[tauri::command]
pub async fn mole_purge_preview(
    window: Window,
    path: String,
    include_empty: Option<bool>,
) -> Result<MolePurgePreview, String> {
    let requested_root = path.trim().to_string();
    let root = normalize_root(&requested_root)?;
    let include_empty = include_empty.unwrap_or(false);
    let window_label = window.label().to_string();
    review::invalidate(&window_label)?;
    tokio::task::spawn_blocking(move || {
        let _operation = OPERATION
            .get_or_init(Default::default)
            .try_lock()
            .map_err(|_| "A purge operation is already running")?;
        let script = std::fs::canonicalize(locate_selected_mole_script("purge.sh")?)
            .map_err(|error| format!("Mole purge script is unavailable: {error}"))?;
        let items = collect_purge_items(&script, &root, include_empty)?;
        let (total_size, size_kind) = preview_size(&items);
        let review_token = if items.is_empty() {
            None
        } else {
            Some(review::issue(
                &root,
                &items,
                &script,
                include_empty,
                &window_label,
            )?)
        };
        Ok(MolePurgePreview {
            root,
            requested_root,
            include_empty,
            total_size,
            size_kind,
            scan_status: "complete".to_string(),
            review_token,
            raw_output: format!("Collected {} Mole purge artifact(s)", items.len()),
            items,
        })
    })
    .await
    .map_err(|error| format!("Failed to join purge preview: {error}"))?
}

fn collect_purge_items(
    purge_script: &Path,
    root: &str,
    include_empty: bool,
) -> Result<Vec<MolePurgeItem>, String> {
    let output = Command::new("/bin/bash")
        .arg("-c")
        .arg(scripts::collect(
            &purge_script.to_string_lossy(),
            root,
            include_empty,
        ))
        .stdin(Stdio::null())
        .output()
        .map_err(|error| format!("Failed to run Mole purge preview: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "Mole purge scan did not complete (exit {:?}): {}",
            output.status.code(),
            output_text(&output)
        ));
    }
    let items = parse_records(&String::from_utf8_lossy(&output.stdout), include_empty)?;
    for item in &items {
        let path = std::fs::canonicalize(&item.path)
            .map_err(|error| format!("Purge candidate became unavailable: {error}"))?;
        if path == Path::new(root) || !path.starts_with(root) {
            return Err("Mole purge candidate is outside the scanned root".to_string());
        }
    }
    Ok(items)
}

#[tauri::command]
pub async fn mole_purge_execute(
    window: Window,
    path: String,
    include_empty: Option<bool>,
    review_token: String,
    confirmed: bool,
) -> Result<MoleExecuteOutcome, String> {
    if !confirmed {
        return Err("Purge requires explicit confirmation".to_string());
    }
    let root = normalize_root(&path)?;
    let include_empty = include_empty.unwrap_or(false);
    let reviewed = review::consume(&review_token, &root, include_empty, window.label())?;
    tokio::task::spawn_blocking(move || {
        let _operation = OPERATION
            .get_or_init(Default::default)
            .try_lock()
            .map_err(|_| "A purge operation is already running")?;
        let purge_script = std::fs::canonicalize(locate_selected_mole_script("purge.sh")?)
            .map_err(|error| format!("Mole purge script is unavailable: {error}"))?;
        if purge_script != reviewed.script {
            return Err("Mole runtime changed since preview; scan again".to_string());
        }
        let mut command = Command::new("/bin/bash");
        command
            .arg("-c")
            .arg(scripts::execute(
                &purge_script.to_string_lossy(),
                &root,
                include_empty,
            ))
            .arg("stowmind-purge-execute")
            .arg(&reviewed.root_identity);
        for (path, identity) in &reviewed.items {
            command.arg(path).arg(identity);
        }
        let output = command
            .env_remove("MOLE_TEST_MODE")
            .env_remove("MOLE_DRY_RUN")
            .env_remove("MO_NO_OPLOG")
            .stdin(Stdio::null())
            .output()
            .map_err(|error| format!("Failed to run Mole purge: {error}"))?;
        // Incomplete runs may still report removed items. Preserve that
        // evidence instead of throwing it away or substituting preview totals.
        Ok(parse_outcome(
            &output_text(&output),
            output.status.success(),
        ))
    })
    .await
    .map_err(|error| format!("Failed to join purge execution: {error}"))?
}

fn normalize_root(path: &str) -> Result<String, String> {
    if path.trim().is_empty() {
        return Err("Purge path is required".to_string());
    }
    let root = std::fs::canonicalize(path.trim())
        .map_err(|error| format!("Purge path is unavailable: {error}"))?;
    if !root.is_dir() {
        return Err("Purge path is not a directory".to_string());
    }
    Ok(root.to_string_lossy().to_string())
}

fn output_text(output: &Output) -> String {
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr);
    if stderr.trim().is_empty() {
        stdout
    } else {
        format!("{stdout}\n{stderr}")
    }
}
