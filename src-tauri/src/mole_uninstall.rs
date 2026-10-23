use crate::app_icons::app_icon_data_url;
mod summary;
use crate::maintenance_process::{
    MaintenanceError, MaintenanceManager, RunContext, EXECUTE_TIMEOUT, LIST_TIMEOUT,
    PREVIEW_TIMEOUT,
};
use crate::mole_utils::mole_command;
use serde::{Deserialize, Serialize};
use std::process::Output;
use summary::{parse_size_to_bytes, parse_uninstall_operation_summary};
use tauri::{State, Window};

#[derive(Clone, Debug, Serialize)]
pub struct MoleUninstallList {
    pub output_truncated: bool,
    pub items: Vec<MoleUninstallItem>,
    pub total_size: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct MoleUninstallItem {
    pub name: String,
    pub bundle_id: String,
    pub source: String,
    pub uninstall_name: String,
    pub path: String,
    pub size: String,
    pub size_bytes: Option<u64>,
    pub icon_data_url: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct MoleUninstallOperationOutput {
    pub output_truncated: bool,
    pub item_count: Option<u64>,
    pub total_size: Option<u64>,
    pub raw_output: String,
    pub dry_run: bool,
    pub permanent: bool,
}

#[derive(Clone, Debug, Deserialize)]
struct RawMoleUninstallItem {
    name: String,
    bundle_id: String,
    source: String,
    uninstall_name: String,
    path: String,
    size: String,
}

#[tauri::command]
pub async fn mole_uninstall_list_json(
    window: Window,
    state: State<'_, MaintenanceManager>,
    run_id: String,
) -> Result<MoleUninstallList, MaintenanceError> {
    let run = state.begin(window.label(), &run_id, LIST_TIMEOUT)?;
    tokio::task::spawn_blocking(move || load_uninstall_list(&run, false))
        .await
        .map_err(|error| {
            MaintenanceError::new("failed", format!("Cannot join uninstall list: {error}"))
        })?
}

fn load_uninstall_list(
    run: &RunContext,
    include_icons: bool,
) -> Result<MoleUninstallList, MaintenanceError> {
    let mut command = mole_command()?;
    let captured = run.run(command.args(["uninstall", "--list"]), None)?;
    if captured.output_truncated {
        return Err(
            captured.failure("Uninstall inventory was truncated; scan again before proceeding")
        );
    }
    let output = captured.output;
    if !output.status.success() {
        let detail = output_text(&output);
        return Err(if detail.trim().is_empty() {
            "mo uninstall --list failed".to_string()
        } else {
            detail
        }
        .into());
    }

    run.check()?;
    parse_uninstall_list_output(&output, include_icons).map_err(Into::into)
}

#[tauri::command]
pub async fn mole_uninstall_preview(
    window: Window,
    state: State<'_, MaintenanceManager>,
    run_id: String,
    uninstall_name: String,
    path: String,
    permanent: Option<bool>,
) -> Result<MoleUninstallOperationOutput, MaintenanceError> {
    let run = state.begin(window.label(), &run_id, PREVIEW_TIMEOUT)?;
    tokio::task::spawn_blocking(move || {
        let item = validate_uninstall_target(&run, uninstall_name, path)?;
        run_uninstall_command(&run, &item, true, permanent.unwrap_or(false))
    })
    .await
    .map_err(|error| {
        MaintenanceError::new("failed", format!("Cannot join uninstall preview: {error}"))
    })?
}

#[tauri::command]
pub async fn mole_uninstall_execute(
    window: Window,
    state: State<'_, MaintenanceManager>,
    run_id: String,
    uninstall_name: String,
    path: String,
    permanent: Option<bool>,
) -> Result<MoleUninstallOperationOutput, MaintenanceError> {
    let run = state.begin(window.label(), &run_id, EXECUTE_TIMEOUT)?;
    tokio::task::spawn_blocking(move || {
        let item = validate_uninstall_target(&run, uninstall_name, path)?;
        let permanent = permanent.unwrap_or(false);
        let preview = run_uninstall_command(&run, &item, true, permanent)?;
        if preview.item_count != Some(1) {
            return Err(MaintenanceError::new(
                "failed",
                "Mole uninstall preview did not confirm exactly one app; execution is blocked",
            ));
        }
        run_uninstall_command(&run, &item, false, permanent)
    })
    .await
    .map_err(|error| {
        MaintenanceError::new(
            "failed",
            format!("Cannot join uninstall execution: {error}"),
        )
    })?
}

fn validate_uninstall_target(
    run: &RunContext,
    uninstall_name: String,
    path: String,
) -> Result<MoleUninstallItem, MaintenanceError> {
    let requested_name = uninstall_name.trim().to_string();
    let requested_path = path.trim().to_string();
    if requested_name.is_empty() || requested_path.is_empty() {
        return Err("Uninstall name and path are required".into());
    }

    let list = load_uninstall_list(run, false)?;
    let same_name_count = list
        .items
        .iter()
        .filter(|item| item.uninstall_name == requested_name)
        .count();
    if same_name_count > 1 {
        return Err(format!(
            "Mole uninstall name '{requested_name}' matches {same_name_count} apps; GUI execution is blocked to avoid uninstalling the wrong app."
        ).into());
    }

    list.items
        .into_iter()
        .find(|item| {
            item.uninstall_name == requested_name
                && normalize_path_key(&item.path) == normalize_path_key(&requested_path)
        })
        .ok_or_else(|| {
            MaintenanceError::new(
                "failed",
                "Selected app is no longer present in Mole uninstall scan results",
            )
        })
}

fn run_uninstall_command(
    run: &RunContext,
    item: &MoleUninstallItem,
    dry_run: bool,
    permanent: bool,
) -> Result<MoleUninstallOperationOutput, MaintenanceError> {
    let mut command = mole_command()?;
    command.arg("uninstall");
    if dry_run {
        command.arg("--dry-run");
    }
    if permanent {
        command.arg("--permanent");
    }
    command.arg(&item.uninstall_name);
    command.env("MO_NO_OPLOG", "1");
    // Fixed, bounded confirmations preserve Mole's existing direct-app flow;
    // no interactive input can keep the worker waiting indefinitely.
    let captured = match run.run(&mut command, Some(b"y\n\n")) {
        Ok(output) => output,
        Err(error) => {
            return Err(if dry_run {
                error
            } else {
                attach_uninstall_partial(error, permanent)
            })
        }
    };
    if dry_run && captured.output_truncated {
        return Err(captured.failure("Uninstall preview was truncated; execution is blocked"));
    }
    let raw_output = strip_ansi(&captured.text());
    if !captured.output.status.success() {
        let error = captured.failure("mo uninstall failed");
        return Err(if dry_run {
            error
        } else {
            attach_uninstall_partial(error, permanent)
        });
    }
    Ok(uninstall_outcome(
        raw_output,
        dry_run,
        permanent,
        captured.output_truncated,
    ))
}

fn uninstall_outcome(
    raw_output: String,
    dry_run: bool,
    permanent: bool,
    output_truncated: bool,
) -> MoleUninstallOperationOutput {
    let (item_count, total_size) = parse_uninstall_operation_summary(&raw_output, dry_run);
    MoleUninstallOperationOutput {
        item_count,
        total_size,
        raw_output,
        dry_run,
        permanent,
        output_truncated,
    }
}

fn attach_uninstall_partial(error: MaintenanceError, permanent: bool) -> MaintenanceError {
    let partial = uninstall_outcome(
        strip_ansi(&error.raw_output),
        false,
        permanent,
        error.output_truncated,
    );
    error.partial(&partial)
}

fn parse_uninstall_list_output(
    output: &Output,
    include_icons: bool,
) -> Result<MoleUninstallList, String> {
    let stdout = String::from_utf8(output.stdout.clone())
        .map_err(|e| format!("Mole uninstall list output is not valid UTF-8: {e}"))?;
    let clean = strip_ansi(&stdout);
    let json = extract_json_array(&clean)
        .ok_or_else(|| "Failed to locate Mole uninstall list JSON array".to_string())?;
    let raw_items: Vec<RawMoleUninstallItem> = serde_json::from_str(json)
        .map_err(|e| format!("Failed to parse Mole uninstall list JSON: {e}"))?;

    let items: Vec<MoleUninstallItem> = raw_items
        .into_iter()
        .map(|item| {
            let size_bytes = parse_size_to_bytes(&item.size);
            let icon_data_url = if include_icons {
                app_icon_data_url(&item.path)
            } else {
                None
            };
            MoleUninstallItem {
                name: item.name,
                bundle_id: item.bundle_id,
                source: item.source,
                uninstall_name: item.uninstall_name,
                path: item.path,
                size: item.size,
                size_bytes,
                icon_data_url,
            }
        })
        .collect();
    let total_size = items
        .iter()
        .map(|item| item.size_bytes)
        .try_fold(0_u64, |sum, size| sum.checked_add(size?));

    Ok(MoleUninstallList {
        items,
        total_size,
        output_truncated: false,
    })
}

fn output_text(output: &Output) -> String {
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if stderr.trim().is_empty() {
        stdout
    } else {
        format!("{stdout}\n{stderr}")
    }
}

fn extract_json_array(raw: &str) -> Option<&str> {
    let start = raw.find('[')?;
    let end = raw.rfind(']')?;
    if start > end {
        return None;
    }
    Some(raw[start..=end].trim())
}

fn strip_ansi(raw: &str) -> String {
    crate::mole_utils::strip_ansi(raw)
}

fn normalize_path_key(path: &str) -> String {
    std::fs::canonicalize(path.trim())
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|_| path.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::{extract_json_array, RawMoleUninstallItem};
    #[test]
    fn interrupted_uninstall_never_uses_the_preflight_as_removal_evidence() {
        use super::{attach_uninstall_partial, MaintenanceError};
        let mut error = MaintenanceError::new("timeout", "timeout");
        error.raw_output = "Removed 1 app, freed 4KB\n".to_string();
        assert!(attach_uninstall_partial(error.clone(), false)
            .partial_result
            .is_none());
        error.process_started = true;
        let partial = attach_uninstall_partial(error, true)
            .partial_result
            .unwrap();
        assert_eq!(partial["item_count"], 1);
        assert_eq!(partial["total_size"], 4096);
        assert_eq!(partial["dry_run"], false);
        assert_eq!(partial["permanent"], true);
        let mut unknown = MaintenanceError::new("cancelled", "cancelled");
        unknown.process_started = true;
        unknown.raw_output = "Would remove 1 app, would free 9GB\n".to_string();
        let partial = attach_uninstall_partial(unknown, false)
            .partial_result
            .unwrap();
        assert!(partial["item_count"].is_null());
        assert!(partial["total_size"].is_null());
    }

    #[test]
    fn parses_uninstall_item_json() {
        let raw = r#"[
          {
            "name": "Docker",
            "bundle_id": "unknown",
            "source": "Homebrew",
            "uninstall_name": "docker-desktop",
            "path": "/Applications/Docker.app",
            "size": "2.10GB"
          }
        ]"#;

        let items: Vec<RawMoleUninstallItem> = serde_json::from_str(raw).unwrap();

        assert_eq!(items.len(), 1);
        assert_eq!(items[0].uninstall_name, "docker-desktop");
    }

    #[test]
    fn extracts_json_array_from_noisy_output() {
        let raw = "Scanning...\n[\n  {\"name\":\"A\"}\n]\nlog tail";
        let json = extract_json_array(raw).unwrap();
        assert!(json.starts_with('['));
        assert!(json.ends_with(']'));
    }
}
