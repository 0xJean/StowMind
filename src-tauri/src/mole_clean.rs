use crate::mole_utils::{mole_command, mole_tokio_command, strip_ansi, unit_to_bytes};
use serde::Serialize;
use std::process::Stdio;
use tauri::Window;
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::time::{timeout, Duration};

const CLEAN_PREVIEW_TIMEOUT_SECS: u64 = 60;

#[derive(Clone, Debug, Serialize)]
pub struct MoleCleanPreview {
    pub potential_space: u64,
    pub item_count: u64,
    pub category_count: u64,
    pub sections: Vec<MoleCleanSection>,
    pub raw_output: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct MoleCleanSection {
    pub title: String,
    pub items: Vec<MoleCleanItem>,
}

#[derive(Clone, Debug, Serialize)]
pub struct MoleCleanItem {
    pub label: String,
    pub size: Option<u64>,
    pub count: Option<u64>,
    pub status: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct MoleCleanPreviewOutput {
    pub run_id: String,
    pub stream: String,
    pub line: String,
}

#[tauri::command]
pub async fn mole_clean_preview() -> Result<MoleCleanPreview, String> {
    let output = tokio::task::spawn_blocking(|| -> Result<std::process::Output, String> {
        mole_command()?
            .args(["clean", "--dry-run"])
            .output()
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("Failed to join clean preview task: {e}"))?
    .map_err(|e| format!("Failed to run mo clean --dry-run: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let raw_output = if stderr.trim().is_empty() {
        stdout
    } else {
        format!("{stdout}\n{stderr}")
    };

    if !output.status.success() {
        return Err(format_clean_process_failure(
            output.status.code(),
            &raw_output,
        ));
    }

    Ok(parse_clean_preview(&raw_output))
}

#[tauri::command]
pub async fn mole_clean_preview_stream(
    window: Window,
    run_id: String,
) -> Result<MoleCleanPreview, String> {
    let mut child = mole_tokio_command()?
        .args(["clean", "--dry-run"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to run mo clean --dry-run: {e}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture mo clean stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture mo clean stderr".to_string())?;

    let stdout_task = tokio::spawn(read_clean_output_stream(
        stdout,
        window.clone(),
        run_id.clone(),
        "stdout",
    ));
    let stderr_task = tokio::spawn(read_clean_output_stream(stderr, window, run_id, "stderr"));

    let status = match timeout(
        Duration::from_secs(CLEAN_PREVIEW_TIMEOUT_SECS),
        child.wait(),
    )
    .await
    {
        Ok(result) => result.map_err(|e| format!("Failed to wait for mo clean --dry-run: {e}"))?,
        Err(_) => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            let stdout = collect_clean_output_task(stdout_task, "stdout").await;
            let stderr = collect_clean_output_task(stderr_task, "stderr").await;
            let raw_output = if stderr.trim().is_empty() {
                stdout
            } else {
                format!("{stdout}\n{stderr}")
            };
            let message =
                format!("mo clean --dry-run timed out after {CLEAN_PREVIEW_TIMEOUT_SECS}s");
            return Err(if raw_output.trim().is_empty() {
                message
            } else {
                format!("{message}\n{raw_output}")
            });
        }
    };

    let stdout = stdout_task
        .await
        .map_err(|e| format!("Failed to join clean stdout stream: {e}"))??;
    let stderr = stderr_task
        .await
        .map_err(|e| format!("Failed to join clean stderr stream: {e}"))??;
    let raw_output = if stderr.trim().is_empty() {
        stdout
    } else {
        format!("{stdout}\n{stderr}")
    };

    if !status.success() {
        return Err(format_clean_process_failure(status.code(), &raw_output));
    }

    Ok(parse_clean_preview(&raw_output))
}

async fn read_clean_output_stream<R>(
    reader: R,
    window: Window,
    run_id: String,
    stream: &'static str,
) -> Result<String, String>
where
    R: AsyncRead + Unpin,
{
    let mut lines = BufReader::new(reader).lines();
    let mut raw_output = String::new();

    while let Some(line) = lines
        .next_line()
        .await
        .map_err(|e| format!("Failed to read mo clean {stream}: {e}"))?
    {
        raw_output.push_str(&line);
        raw_output.push('\n');

        let line = strip_ansi(&line);
        if line.trim().is_empty() {
            continue;
        }

        let _ = window.emit(
            "mole-clean-preview-output",
            MoleCleanPreviewOutput {
                run_id: run_id.clone(),
                stream: stream.to_string(),
                line,
            },
        );
    }

    Ok(raw_output)
}

async fn collect_clean_output_task(
    task: tokio::task::JoinHandle<Result<String, String>>,
    stream: &str,
) -> String {
    match task.await {
        Ok(Ok(output)) => output,
        Ok(Err(error)) => format!("[{stream}] {error}\n"),
        Err(error) => format!("[{stream}] Failed to join clean output stream: {error}\n"),
    }
}

pub(crate) fn parse_clean_preview(raw: &str) -> MoleCleanPreview {
    let clean = strip_ansi(raw).replace("\r\n", "\n").replace('\r', "\n");
    let mut sections = Vec::new();
    let mut current: Option<MoleCleanSection> = None;

    for line in clean.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.chars().all(|c| c == '=') {
            continue;
        }

        if let Some(title) = parse_clean_section_title(trimmed) {
            if let Some(section) = current.take() {
                sections.push(section);
            }
            current = Some(MoleCleanSection {
                title,
                items: Vec::new(),
            });
            continue;
        }

        if let Some(item) = parse_clean_item(trimmed) {
            if let Some(section) = current.as_mut() {
                section.items.push(item);
            }
        }
    }

    if let Some(section) = current {
        sections.push(section);
    }

    let (potential_space, item_count, category_count) = parse_clean_summary(&clean);

    MoleCleanPreview {
        potential_space,
        item_count,
        category_count,
        sections,
        raw_output: clean,
    }
}

pub(crate) fn format_clean_process_failure(exit_code: Option<i32>, raw_output: &str) -> String {
    let code = exit_code
        .map(|value| value.to_string())
        .unwrap_or_else(|| "unknown".to_string());
    let message = format!("mo clean --dry-run failed with exit code {code}");
    if raw_output.trim().is_empty() {
        message
    } else {
        format!("{message}\n{raw_output}")
    }
}

fn parse_clean_section_title(line: &str) -> Option<String> {
    line.strip_prefix('➤')
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .map(ToString::to_string)
}

fn parse_clean_item(line: &str) -> Option<MoleCleanItem> {
    let status = match line.chars().next()? {
        '→' => "dry_run",
        '✓' => "ok",
        '◎' => "skipped",
        '☞' => "advice",
        '•' => "info",
        '↳' => "detail",
        _ => return None,
    };

    let label = line
        .char_indices()
        .nth(1)
        .map(|(idx, _)| line[idx..].trim())
        .unwrap_or("")
        .to_string();

    if label.is_empty() {
        return None;
    }

    let size = extract_clean_size(&label);
    let count = extract_clean_count(&label);

    Some(MoleCleanItem {
        label,
        size,
        count,
        status: status.to_string(),
    })
}

fn parse_clean_summary(raw: &str) -> (u64, u64, u64) {
    let re = match regex::Regex::new(
        r"Potential space:\s*([0-9]+(?:\.[0-9]+)?)\s*([KMGT]?B)\s*\|\s*Items:\s*(\d+)\s*\|\s*Categories:\s*(\d+)",
    ) {
        Ok(re) => re,
        Err(_) => return (0, 0, 0),
    };

    let Some(caps) = re.captures(raw) else {
        return (0, 0, 0);
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
    let category_count = caps
        .get(4)
        .and_then(|m| m.as_str().parse::<u64>().ok())
        .unwrap_or(0);

    (unit_to_bytes(amount, unit), item_count, category_count)
}

fn extract_clean_size(label: &str) -> Option<u64> {
    let patterns = [
        r"(?:at least|about|clean|would clean|Reclaimable:)\s*([0-9]+(?:\.[0-9]+)?)\s*([KMGT]?B)",
        r",\s*([0-9]+(?:\.[0-9]+)?)\s*([KMGT]?B)\s*dry",
        r"\b([0-9]+(?:\.[0-9]+)?)\s*([KMGT]?B)\s*dry",
    ];

    for pattern in patterns {
        let re = match regex::Regex::new(pattern) {
            Ok(re) => re,
            Err(_) => continue,
        };
        if let Some(caps) = re.captures(label) {
            let amount = caps.get(1)?.as_str().parse::<f64>().ok()?;
            let unit = caps.get(2)?.as_str();
            return Some(unit_to_bytes(amount, unit));
        }
    }

    None
}

fn extract_clean_count(label: &str) -> Option<u64> {
    let re = regex::Regex::new(r"\b(\d+)\s+items?\b").ok()?;
    re.captures(label)
        .and_then(|caps| caps.get(1))
        .and_then(|m| m.as_str().parse::<u64>().ok())
}

#[cfg(test)]
mod tests {
    use super::{format_clean_process_failure, parse_clean_preview};

    #[test]
    fn process_failures_keep_exit_code_and_output() {
        assert_eq!(
            format_clean_process_failure(Some(2), "permission denied"),
            "mo clean --dry-run failed with exit code 2\npermission denied"
        );
        assert_eq!(
            format_clean_process_failure(None, ""),
            "mo clean --dry-run failed with exit code unknown"
        );
    }

    #[test]
    fn parses_clean_preview_sections_and_summary() {
        let raw = "\
Clean Your Mac

Dry Run Mode, Preview only, no deletions

➤ User essentials
  → User app cache 187 items, 8.85GB dry
  → User app logs 23 items, 1.4MB dry
  → Trash · would empty, 1 items

➤ Developer tools
  → npm cache · would clean
  → npm cache directory 3 items, 2.87GB dry
  ✓ Rust toolchains: 5 found · rustup toolchain list

======================================================================
Dry run complete - no changes made
Potential space: 19.57GB | Items: 1050 | Categories: 50
======================================================================
";

        let preview = parse_clean_preview(raw);

        assert!(preview.potential_space > 21_000_000_000);
        assert!(preview.potential_space < 21_020_000_000);
        assert_eq!(preview.item_count, 1050);
        assert_eq!(preview.category_count, 50);
        assert_eq!(preview.sections.len(), 2);
        assert_eq!(preview.sections[0].title, "User essentials");
        assert_eq!(preview.sections[0].items[0].count, Some(187));
        let first_size = preview.sections[0].items[0].size.unwrap_or_default();
        assert!(first_size > 9_490_000_000);
        assert!(first_size < 9_510_000_000);
        assert_eq!(preview.sections[1].items[2].status, "ok");
    }
}
