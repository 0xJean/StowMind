use crate::mole_utils::{locate_mole_script, shell_quote, strip_ansi, unit_to_bytes};
use serde::Serialize;
use std::path::Path;
use std::process::{Command, Output};

const FIELD_SEP: char = '\x1f';
const RECORD_SEP: char = '\x1e';

#[derive(Clone, Debug, Serialize)]
pub struct MolePurgePreview {
    pub root: String,
    pub items: Vec<MolePurgeItem>,
    pub total_size: u64,
    pub raw_output: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct MolePurgeItem {
    pub path: String,
    pub size: u64,
}

#[derive(Clone, Debug, Serialize)]
pub struct MoleExecuteOutcome {
    pub item_count: u64,
    pub total_size: u64,
    pub raw_output: String,
}

#[tauri::command]
pub async fn mole_purge_preview(path: String) -> Result<MolePurgePreview, String> {
    let root = path.trim().to_string();
    if root.is_empty() {
        return Err("Purge path is required".to_string());
    }
    if !Path::new(&root).is_dir() {
        return Err(format!("Purge path is not a directory: {root}"));
    }

    let root_for_task = root.clone();
    let items = tokio::task::spawn_blocking(move || collect_purge_items(&root_for_task))
        .await
        .map_err(|e| format!("Failed to join purge preview task: {e}"))??;

    let total_size = items.iter().map(|item| item.size).sum();
    Ok(MolePurgePreview {
        root,
        raw_output: format!("Collected {} Mole purge artifact(s)", items.len()),
        items,
        total_size,
    })
}

fn collect_purge_items(root: &str) -> Result<Vec<MolePurgeItem>, String> {
    let purge_script = locate_mole_script("purge.sh")?;
    let output = Command::new("/bin/bash")
        .arg("-c")
        .arg(build_purge_collect_script(
            &purge_script.to_string_lossy(),
            root,
        ))
        .env("MOLE_SKIP_MAIN", "1")
        .env("MOLE_TEST_MODE", "1")
        .env("MO_NO_OPLOG", "1")
        .env(
            "XDG_CACHE_HOME",
            std::env::temp_dir().join("stowmind-mole-cache"),
        )
        .output()
        .map_err(|e| format!("Failed to run Mole purge preview: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !output.status.success() {
        return Err(if stderr.is_empty() {
            "Mole purge preview failed".to_string()
        } else {
            stderr
        });
    }

    Ok(parse_purge_collect_records(&stdout))
}

fn build_purge_collect_script(purge_script: &str, root: &str) -> String {
    format!(
        "export MOLE_SKIP_MAIN=1; \
         export MOLE_TEST_MODE=1; \
         export MO_NO_OPLOG=1; \
         source {}; \
         scan_output=$(mktemp); \
         stats_dir=\"${{XDG_CACHE_HOME:-$HOME/.cache}}/mole\"; \
         mkdir -p \"$stats_dir\" >/dev/null 2>&1 || true; \
         : > \"$stats_dir/purge_scanning\" 2>/dev/null || true; \
         scan_purge_targets {} \"$scan_output\"; \
         while IFS= read -r item_path; do \
           [[ -n \"$item_path\" && -d \"$item_path\" ]] || continue; \
           size_kb=$(du -sk \"$item_path\" 2>/dev/null | awk '{{print $1}}'); \
           [[ \"$size_kb\" =~ ^[0-9]+$ ]] || size_kb=0; \
           printf '%s\\x1f%s\\x1e' \"$item_path\" \"$((size_kb * 1024))\"; \
         done < \"$scan_output\"; \
         rm -f \"$scan_output\" \"$stats_dir/purge_scanning\" 2>/dev/null || true",
        shell_quote(purge_script),
        shell_quote(root)
    )
}

fn parse_purge_collect_records(raw: &str) -> Vec<MolePurgeItem> {
    raw.split(RECORD_SEP)
        .filter_map(|record| {
            let record = record.trim_end_matches('\n');
            if record.is_empty() {
                return None;
            }

            let mut parts = record.split(FIELD_SEP);
            let path = parts.next()?.trim().to_string();
            let size = parts.next()?.trim().parse::<u64>().ok()?;
            if path.is_empty() || size == 0 {
                return None;
            }

            Some(MolePurgeItem { path, size })
        })
        .collect()
}

#[tauri::command]
pub async fn mole_purge_execute(path: String) -> Result<MoleExecuteOutcome, String> {
    let root = path.trim().to_string();
    if root.is_empty() {
        return Err("Purge path is required".to_string());
    }
    if !Path::new(&root).is_dir() {
        return Err(format!("Purge path is not a directory: {root}"));
    }

    let root_for_task = root.clone();
    let output = tokio::task::spawn_blocking(move || -> Result<Output, String> {
        let purge_script = locate_mole_script("purge.sh")?;
        let script = format!(
            "export MOLE_SKIP_MAIN=1; \
             source {}; \
             PURGE_SEARCH_PATHS=({}); \
             unset MOLE_DRY_RUN; \
             start_purge; \
             perform_purge",
            shell_quote(&purge_script.to_string_lossy()),
            shell_quote(&root_for_task)
        );
        Command::new("/bin/bash")
            .arg("-c")
            .arg(script)
            .env("MOLE_SKIP_MAIN", "1")
            .output()
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("Failed to join purge execute task: {e}"))?
    .map_err(|e| format!("Failed to run Mole purge execute: {e}"))?;

    let raw_output = output_text(&output);
    if !output.status.success() {
        return Err(if raw_output.trim().is_empty() {
            "Mole purge execute failed".to_string()
        } else {
            raw_output
        });
    }

    let (item_count, total_size) = parse_purge_execute_summary(&raw_output);
    Ok(MoleExecuteOutcome {
        item_count,
        total_size,
        raw_output: strip_ansi(&raw_output),
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

fn parse_purge_execute_summary(raw: &str) -> (u64, u64) {
    let clean = strip_ansi(raw);
    let re = match regex::Regex::new(
        r"Space freed:\s*([0-9]+(?:\.[0-9]+)?)\s*([KMGT]?B)(?:\s*\|\s*Items:\s*(\d+))?",
    ) {
        Ok(re) => re,
        Err(_) => return (0, 0),
    };
    let Some(caps) = re.captures(&clean) else {
        return (0, 0);
    };
    let amount = caps
        .get(1)
        .and_then(|m| m.as_str().parse::<f64>().ok())
        .unwrap_or(0.0);
    let unit = caps.get(2).map(|m| m.as_str()).unwrap_or("B");
    let item_count = caps
        .get(3)
        .and_then(|m| m.as_str().parse::<u64>().ok())
        .unwrap_or(0);
    (item_count, unit_to_bytes(amount, unit))
}

#[cfg(test)]
mod tests {
    use super::{parse_purge_collect_records, parse_purge_execute_summary};

    #[test]
    fn parses_purge_collect_records() {
        let raw = "/tmp/project/node_modules\x1f4096\x1e/tmp/project/target\x1f8192\x1e";

        let items = parse_purge_collect_records(raw);

        assert_eq!(items.len(), 2);
        assert_eq!(items[0].path, "/tmp/project/node_modules");
        assert_eq!(items[0].size, 4096);
        assert_eq!(items[1].path, "/tmp/project/target");
    }

    #[test]
    fn parses_purge_execute_summary() {
        let (count, size) = parse_purge_execute_summary(
            "Purge complete\nSpace freed: 42.50MB | Items: 3 | Free: 500Gi\n",
        );

        assert_eq!(count, 3);
        assert!(size > 44_000_000);
        assert!(size < 45_000_000);
    }
}
