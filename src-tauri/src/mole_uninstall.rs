use crate::app_icons::app_icon_data_url;
use crate::mole_utils::{mole_command, unit_to_bytes};
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::process::Output;

#[derive(Clone, Debug, Serialize)]
pub struct MoleUninstallList {
    pub items: Vec<MoleUninstallItem>,
    pub total_size: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct MoleUninstallItem {
    pub name: String,
    pub bundle_id: String,
    pub source: String,
    pub uninstall_name: String,
    pub path: String,
    pub size: String,
    pub size_bytes: u64,
    pub icon_data_url: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct MoleUninstallOperationOutput {
    pub item_count: u64,
    pub total_size: u64,
    pub raw_output: String,
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
pub async fn mole_uninstall_list_json() -> Result<MoleUninstallList, String> {
    load_uninstall_list(false).await
}

async fn load_uninstall_list(include_icons: bool) -> Result<MoleUninstallList, String> {
    let output = tokio::task::spawn_blocking(|| -> Result<std::process::Output, String> {
        mole_command()?
            .args(["uninstall", "--list"])
            .output()
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("Failed to join uninstall list task: {e}"))?
    .map_err(|e| format!("Failed to run mo uninstall --list: {e}"))?;

    if !output.status.success() {
        let detail = output_text(&output);
        return Err(if detail.trim().is_empty() {
            "mo uninstall --list failed".to_string()
        } else {
            detail
        });
    }

    parse_uninstall_list_output(&output, include_icons)
}

#[tauri::command]
pub async fn mole_uninstall_preview(
    uninstall_name: String,
    path: String,
) -> Result<MoleUninstallOperationOutput, String> {
    let item = validate_uninstall_target(uninstall_name, path).await?;
    tokio::task::spawn_blocking(move || run_uninstall_command(&item, true))
        .await
        .map_err(|e| format!("Failed to join uninstall preview task: {e}"))?
}

#[tauri::command]
pub async fn mole_uninstall_execute(
    uninstall_name: String,
    path: String,
) -> Result<MoleUninstallOperationOutput, String> {
    let item = validate_uninstall_target(uninstall_name, path).await?;
    tokio::task::spawn_blocking(move || run_uninstall_command(&item, false))
        .await
        .map_err(|e| format!("Failed to join uninstall execute task: {e}"))?
}

async fn validate_uninstall_target(
    uninstall_name: String,
    path: String,
) -> Result<MoleUninstallItem, String> {
    let requested_name = uninstall_name.trim().to_string();
    let requested_path = path.trim().to_string();
    if requested_name.is_empty() || requested_path.is_empty() {
        return Err("Uninstall name and path are required".to_string());
    }

    let list = load_uninstall_list(false).await?;
    let same_name_count = list
        .items
        .iter()
        .filter(|item| item.uninstall_name == requested_name)
        .count();
    if same_name_count > 1 {
        return Err(format!(
            "Mole uninstall name '{requested_name}' matches {same_name_count} apps; GUI execution is blocked to avoid uninstalling the wrong app."
        ));
    }

    list.items
        .into_iter()
        .find(|item| {
            item.uninstall_name == requested_name
                && normalize_path_key(&item.path) == normalize_path_key(&requested_path)
        })
        .ok_or_else(|| {
            "Selected app is no longer present in Mole uninstall scan results".to_string()
        })
}

fn run_uninstall_command(
    item: &MoleUninstallItem,
    dry_run: bool,
) -> Result<MoleUninstallOperationOutput, String> {
    let mut command = mole_command()?;
    command.arg("uninstall");
    if dry_run {
        command.arg("--dry-run");
    }
    command.arg(&item.uninstall_name);
    command.env("MO_NO_OPLOG", "1");
    command.stdin(std::process::Stdio::piped());
    command.stdout(std::process::Stdio::piped());
    command.stderr(std::process::Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|e| format!("Failed to run mo uninstall: {e}"))?;

    if let Some(mut stdin) = child.stdin.take() {
        // First confirmation is direct-app match confirmation. Second one is Mole's
        // batch-removal confirmation. The destructive work still stays inside Mole.
        stdin
            .write_all(b"y\n\n")
            .map_err(|e| format!("Failed to confirm Mole uninstall: {e}"))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Failed to wait for mo uninstall: {e}"))?;
    let raw_output = strip_ansi(&output_text(&output));

    if !output.status.success() {
        return Err(if raw_output.trim().is_empty() {
            "mo uninstall failed".to_string()
        } else {
            raw_output
        });
    }

    let (item_count, total_size) =
        parse_uninstall_operation_summary(&raw_output).unwrap_or((1, item.size_bytes));
    Ok(MoleUninstallOperationOutput {
        item_count,
        total_size,
        raw_output,
    })
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
    let total_size = items.iter().map(|item| item.size_bytes).sum();

    Ok(MoleUninstallList { items, total_size })
}

fn parse_size_to_bytes(size: &str) -> u64 {
    let trimmed = size.trim();
    if trimmed.is_empty() {
        return 0;
    }

    let re = match regex::Regex::new(r"(?i)^\s*([0-9]+(?:\.[0-9]+)?)\s*([KMGT]?B)\s*$") {
        Ok(re) => re,
        Err(_) => return 0,
    };
    let Some(caps) = re.captures(trimmed) else {
        return 0;
    };

    let amount = caps
        .get(1)
        .and_then(|m| m.as_str().parse::<f64>().ok())
        .unwrap_or(0.0);
    let unit = caps
        .get(2)
        .map(|m| m.as_str().to_ascii_uppercase())
        .unwrap_or_else(|| "B".to_string());

    unit_to_bytes(amount, &unit)
}

fn parse_uninstall_operation_summary(raw: &str) -> Option<(u64, u64)> {
    let re = regex::Regex::new(
        r"(?i)(?:Would remove|Removed)\s+(\d+)\s+apps?(?:,\s+(?:would free|freed)\s+([0-9]+(?:\.[0-9]+)?)\s*([KMGT]?B))?",
    )
    .ok()?;
    let caps = re.captures(raw)?;
    let count = caps.get(1)?.as_str().parse::<u64>().ok()?;
    let total_size = caps
        .get(2)
        .and_then(|amount| {
            let unit = caps.get(3).map(|m| m.as_str()).unwrap_or("B");
            amount
                .as_str()
                .parse::<f64>()
                .ok()
                .map(|amount| unit_to_bytes(amount, unit))
        })
        .unwrap_or(0);
    Some((count, total_size))
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
    use super::{
        extract_json_array, parse_size_to_bytes, parse_uninstall_operation_summary,
        RawMoleUninstallItem,
    };

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
    fn parses_size_strings() {
        assert_eq!(parse_size_to_bytes("4KB"), 4096);
        assert_eq!(parse_size_to_bytes("1.5MB"), 1_572_864);
        assert!(parse_size_to_bytes("2.10GB") > 2_250_000_000);
    }

    #[test]
    fn extracts_json_array_from_noisy_output() {
        let raw = "Scanning...\n[\n  {\"name\":\"A\"}\n]\nlog tail";
        let json = extract_json_array(raw).unwrap();
        assert!(json.starts_with('['));
        assert!(json.ends_with(']'));
    }

    #[test]
    fn parses_uninstall_operation_summary() {
        let dry = "Uninstall dry run complete\nWould remove 1 app, would free 4KB: App\n";
        let executed = "Uninstall complete\nRemoved 2 apps, freed 1.5MB: A, B\n";

        assert_eq!(parse_uninstall_operation_summary(dry), Some((1, 4096)));
        assert_eq!(
            parse_uninstall_operation_summary(executed),
            Some((2, 1_572_864))
        );
    }
}
