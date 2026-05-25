use crate::mole_utils::{locate_mole_script, shell_quote};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::process::Command;

const FIELD_SEP: char = '\x1f';
const RECORD_SEP: char = '\x1e';

#[derive(Clone, Debug, Serialize)]
pub struct MoleInstallerPreview {
    pub items: Vec<MoleInstallerItem>,
    pub total_size: u64,
}

#[derive(Clone, Debug, Serialize)]
pub struct MoleInstallerItem {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub source: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct MoleInstallerExecuteOutcome {
    pub item_count: u64,
    pub total_size: u64,
    pub raw_output: String,
}

#[tauri::command]
pub async fn mole_installer_preview() -> Result<MoleInstallerPreview, String> {
    tokio::task::spawn_blocking(move || {
        let installer_script = locate_mole_script("installer.sh")?;
        let items = collect_installer_items(&installer_script)?;
        let total_size = items.iter().map(|item| item.size).sum();
        Ok(MoleInstallerPreview { items, total_size })
    })
    .await
    .map_err(|e| format!("Failed to join installer preview task: {e}"))?
}

fn collect_installer_items(installer_script: &Path) -> Result<Vec<MoleInstallerItem>, String> {
    let output = Command::new("/bin/bash")
        .arg("-c")
        .arg(build_installer_collect_script(
            &installer_script.to_string_lossy(),
        ))
        .env("MOLE_TEST_MODE", "1")
        .output()
        .map_err(|e| format!("Failed to run Mole installer preview: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !output.status.success() {
        return Err(if stderr.is_empty() {
            "Mole installer preview failed".to_string()
        } else {
            stderr
        });
    }

    Ok(parse_installer_records(&stdout))
}

fn build_installer_collect_script(installer_script: &str) -> String {
    format!(
        "export MOLE_TEST_MODE=1; \
         source {}; \
         collect_installers >/dev/null || true; \
         for i in \"${{!INSTALLER_PATHS[@]}}\"; do \
           printf '%s\\x1f%s\\x1f%s\\x1e' \
             \"${{INSTALLER_PATHS[$i]}}\" \
             \"${{INSTALLER_SIZES[$i]}}\" \
             \"${{INSTALLER_SOURCES[$i]}}\"; \
         done",
        shell_quote(installer_script)
    )
}

fn parse_installer_records(raw: &str) -> Vec<MoleInstallerItem> {
    raw.split(RECORD_SEP)
        .filter_map(|record| {
            let record = record.trim_end_matches('\n');
            if record.is_empty() {
                return None;
            }

            let mut parts = record.split(FIELD_SEP);
            let path = parts.next()?.trim().to_string();
            let size = parts.next()?.trim().parse::<u64>().ok()?;
            let source = parts.next().unwrap_or("").trim().to_string();
            if path.is_empty() {
                return None;
            }

            let name = std::path::Path::new(&path)
                .file_name()
                .map(|value| value.to_string_lossy().to_string())
                .unwrap_or_else(|| path.clone());

            Some(MoleInstallerItem {
                path,
                name,
                size,
                source,
            })
        })
        .collect()
}

#[tauri::command]
pub async fn mole_installer_execute(
    paths: Vec<String>,
) -> Result<MoleInstallerExecuteOutcome, String> {
    let selected_paths: Vec<String> = paths
        .into_iter()
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty())
        .collect();
    if selected_paths.is_empty() {
        return Err("No installer paths selected".to_string());
    }

    tokio::task::spawn_blocking(move || execute_selected_installers(selected_paths))
        .await
        .map_err(|e| format!("Failed to join installer execute task: {e}"))?
}

fn execute_selected_installers(paths: Vec<String>) -> Result<MoleInstallerExecuteOutcome, String> {
    let installer_script = locate_mole_script("installer.sh")?;
    let mole_items = collect_installer_items(&installer_script)?;
    let mole_paths = filter_selected_mole_installers(&paths, &mole_items);
    if mole_paths.is_empty() {
        return Err(
            "No selected installer paths are present in Mole installer scan results".to_string(),
        );
    }

    let mut args = vec![
        "-c".to_string(),
        build_installer_execute_script(&installer_script.to_string_lossy(), mole_paths.len()),
        "stowmind-installer-execute".to_string(),
    ];
    args.extend(mole_paths);

    let output = Command::new("/bin/bash")
        .args(args)
        .env("MOLE_TEST_MODE", "1")
        .output()
        .map_err(|e| format!("Failed to run Mole installer execute: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let raw_output = if stderr.trim().is_empty() {
        stdout
    } else {
        format!("{stdout}\n{stderr}")
    };

    if !output.status.success() {
        return Err(if raw_output.trim().is_empty() {
            "Mole installer execute failed".to_string()
        } else {
            raw_output
        });
    }

    Ok(parse_installer_execute_summary(&raw_output))
}

fn filter_selected_mole_installers(
    selected_paths: &[String],
    mole_items: &[MoleInstallerItem],
) -> Vec<String> {
    let mole_by_key: HashMap<String, &MoleInstallerItem> = mole_items
        .iter()
        .map(|item| (normalize_path_key(&item.path), item))
        .collect();
    let mut seen = HashSet::new();

    selected_paths
        .iter()
        .filter_map(|path| {
            let key = normalize_path_key(path);
            if !seen.insert(key.clone()) {
                return None;
            }
            mole_by_key.get(&key).map(|item| item.path.clone())
        })
        .collect()
}

fn normalize_path_key(path: &str) -> String {
    let trimmed = path.trim();
    std::fs::canonicalize(trimmed)
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|_| trimmed.to_string())
}

fn build_installer_execute_script(installer_script: &str, path_count: usize) -> String {
    let index_list = (0..path_count)
        .map(|index| index.to_string())
        .collect::<Vec<_>>()
        .join(",");
    format!(
        // StowMind only injects the selected paths. The destructive operation must remain
        // inside Mole's delete_selected_installers function; do not add Rust-side deletion here.
        "export MOLE_TEST_MODE=1; \
         source {}; \
         INSTALLER_PATHS=(); INSTALLER_SIZES=(); INSTALLER_SOURCES=(); \
         for file_path in \"${{@}}\"; do \
           [[ -f \"$file_path\" ]] || continue; \
           file_size=$(get_file_size \"$file_path\" 2>/dev/null || stat -f%z \"$file_path\" 2>/dev/null || echo 0); \
           INSTALLER_PATHS+=(\"$file_path\"); \
           INSTALLER_SIZES+=(\"$file_size\"); \
           INSTALLER_SOURCES+=(\"StowMind\"); \
         done; \
         MOLE_SELECTION_RESULT={}; \
         printf '\\n'; \
         printf '\\n' | delete_selected_installers; \
         show_summary",
        shell_quote(installer_script),
        shell_quote(&index_list)
    )
}

fn parse_installer_execute_summary(raw: &str) -> MoleInstallerExecuteOutcome {
    let clean = strip_ansi(raw);
    let re = regex::Regex::new(
        r"Removed\s+(\d+)\s+installers,\s+freed\s+([0-9]+(?:\.[0-9]+)?)\s*([KMGT]?B)",
    )
    .ok();
    let (item_count, total_size) = re
        .and_then(|re| re.captures(&clean))
        .map(|caps| {
            let count = caps
                .get(1)
                .and_then(|m| m.as_str().parse::<u64>().ok())
                .unwrap_or(0);
            let amount = caps
                .get(2)
                .and_then(|m| m.as_str().parse::<f64>().ok())
                .unwrap_or(0.0);
            let unit = caps.get(3).map(|m| m.as_str()).unwrap_or("B");
            (count, crate::mole_utils::unit_to_bytes(amount, unit))
        })
        .unwrap_or((0, 0));

    MoleInstallerExecuteOutcome {
        item_count,
        total_size,
        raw_output: clean,
    }
}

fn strip_ansi(raw: &str) -> String {
    crate::mole_utils::strip_ansi(raw)
}

#[cfg(test)]
mod tests {
    use super::{
        filter_selected_mole_installers, parse_installer_execute_summary, parse_installer_records,
        MoleInstallerItem,
    };

    #[test]
    fn parses_installer_records() {
        let raw = "/Users/me/Downloads/App.dmg\x1f1048576\x1fDownloads\x1e/Users/me/Desktop/Tool.pkg\x1f2048\x1fDesktop\x1e";

        let items = parse_installer_records(raw);

        assert_eq!(items.len(), 2);
        assert_eq!(items[0].name, "App.dmg");
        assert_eq!(items[0].size, 1_048_576);
        assert_eq!(items[1].source, "Desktop");
    }

    #[test]
    fn parses_installer_execute_summary() {
        let outcome = parse_installer_execute_summary(
            "Installers cleaned\nRemoved 3 installers, freed 42.50MB\n",
        );

        assert_eq!(outcome.item_count, 3);
        assert!(outcome.total_size > 44_000_000);
        assert!(outcome.total_size < 45_000_000);
    }

    #[test]
    fn filters_selected_paths_to_mole_scan_results() {
        let mole_items = vec![
            MoleInstallerItem {
                path: "/Users/me/Downloads/App.dmg".to_string(),
                name: "App.dmg".to_string(),
                size: 1_048_576,
                source: "Downloads".to_string(),
            },
            MoleInstallerItem {
                path: "/Users/me/Desktop/Tool.pkg".to_string(),
                name: "Tool.pkg".to_string(),
                size: 2_048,
                source: "Desktop".to_string(),
            },
        ];
        let selected = vec![
            "/Users/me/Downloads/App.dmg".to_string(),
            "/Users/me/Documents/notes.txt".to_string(),
            "/Users/me/Downloads/App.dmg".to_string(),
        ];

        let filtered = filter_selected_mole_installers(&selected, &mole_items);

        assert_eq!(filtered, vec!["/Users/me/Downloads/App.dmg".to_string()]);
    }
}
