use crate::deepclean;
use crate::mole_utils::{current_platform, mole_command, strip_ansi, unit_to_bytes};
use regex::Regex;
use serde::Serialize;
use std::process::Output;

#[derive(Clone, Debug, Serialize)]
pub struct MoleOptimizeHealth {
    pub health_score: i64,
    pub health_score_msg: String,
    pub memory_used_gb: f64,
    pub memory_total_gb: f64,
    pub disk_used_gb: f64,
    pub disk_total_gb: f64,
    pub disk_used_percent: f64,
    pub uptime_days: f64,
    pub active_whitelist: Vec<String>,
    pub optimizations: Vec<MoleOptimizationItem>,
    pub raw_output: String,
    pub platform: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct MoleOptimizationItem {
    pub category: String,
    pub name: String,
    pub description: String,
    pub action: String,
    pub safe: bool,
}

#[derive(Clone, Debug)]
struct OptimizePreview {
    memory_used_gb: Option<f64>,
    memory_total_gb: Option<f64>,
    disk_used_gb: Option<f64>,
    disk_total_gb: Option<f64>,
    disk_used_percent: Option<f64>,
    uptime_days: Option<f64>,
    active_whitelist: Vec<String>,
    optimizations: Vec<MoleOptimizationItem>,
    raw_output: String,
}

#[tauri::command]
pub async fn mole_optimize_health_json() -> Result<MoleOptimizeHealth, String> {
    let status_future = deepclean::mole_status_json();
    let preview_future = tokio::task::spawn_blocking(run_optimize_preview);
    let (status_result, preview_result) = tokio::join!(status_future, preview_future);

    let preview = preview_result
        .map_err(|e| format!("Failed to join Mole optimize preview task: {e}"))?
        .unwrap_or_else(|error| OptimizePreview {
            memory_used_gb: None,
            memory_total_gb: None,
            disk_used_gb: None,
            disk_total_gb: None,
            disk_used_percent: None,
            uptime_days: None,
            active_whitelist: Vec::new(),
            optimizations: Vec::new(),
            raw_output: error,
        });

    let status = status_result.ok();
    if status.is_none() && preview.optimizations.is_empty() && preview.raw_output.trim().is_empty()
    {
        return Err("Mole optimize preview unavailable".to_string());
    }

    Ok(build_optimize_health(status, preview))
}

fn run_optimize_preview() -> Result<OptimizePreview, String> {
    let output = mole_command()?
        .args(["optimize", "--dry-run"])
        .output()
        .map_err(|e| format!("Failed to run mo optimize --dry-run: {e}"))?;

    let raw_output = output_text(&output);
    let preview = parse_optimize_preview(&raw_output);

    if !output.status.success() && preview.optimizations.is_empty() {
        return Err(if raw_output.trim().is_empty() {
            "mo optimize --dry-run failed".to_string()
        } else {
            raw_output
        });
    }

    Ok(preview)
}

fn build_optimize_health(
    status: Option<deepclean::MoleStatusMetrics>,
    preview: OptimizePreview,
) -> MoleOptimizeHealth {
    let platform = status
        .as_ref()
        .map(|status| status.platform.clone())
        .filter(|platform| !platform.trim().is_empty())
        .unwrap_or_else(|| current_platform().to_string());

    let health_score = status
        .as_ref()
        .map(|status| status.health_score)
        .unwrap_or(0);
    let health_score_msg = status
        .as_ref()
        .map(|status| status.health_score_msg.clone())
        .filter(|msg| !msg.trim().is_empty())
        .unwrap_or_else(|| "Mole status unavailable".to_string());

    let (memory_used_gb, memory_total_gb) = status
        .as_ref()
        .map(|status| {
            (
                bytes_to_gb(status.memory.used),
                bytes_to_gb(status.memory.total),
            )
        })
        .unwrap_or_else(|| {
            (
                preview.memory_used_gb.unwrap_or(0.0),
                preview.memory_total_gb.unwrap_or(0.0),
            )
        });

    let (disk_used_gb, disk_total_gb, disk_used_percent) = status
        .as_ref()
        .and_then(primary_disk_snapshot)
        .map(|disk| {
            (
                bytes_to_gb(disk.used),
                bytes_to_gb(disk.total),
                disk.used_percent,
            )
        })
        .unwrap_or_else(|| {
            (
                preview.disk_used_gb.unwrap_or(0.0),
                preview.disk_total_gb.unwrap_or(0.0),
                preview.disk_used_percent.unwrap_or(0.0),
            )
        });

    let uptime_days = status
        .as_ref()
        .and_then(|status| parse_uptime_days(&status.uptime))
        .or(preview.uptime_days)
        .unwrap_or(0.0);

    MoleOptimizeHealth {
        health_score,
        health_score_msg,
        memory_used_gb,
        memory_total_gb,
        disk_used_gb,
        disk_total_gb,
        disk_used_percent,
        uptime_days,
        active_whitelist: preview.active_whitelist,
        optimizations: preview.optimizations,
        raw_output: preview.raw_output,
        platform,
    }
}

fn parse_optimize_preview(raw: &str) -> OptimizePreview {
    let clean = strip_ansi(raw).replace('\r', "\n");
    let mut sections: Vec<(String, Vec<String>)> = Vec::new();
    let mut current_title: Option<String> = None;
    let mut current_lines: Vec<String> = Vec::new();
    let mut active_whitelist = Vec::new();
    let mut memory_used_gb = None;
    let mut memory_total_gb = None;
    let mut disk_used_gb = None;
    let mut disk_total_gb = None;
    let mut disk_used_percent = None;
    let mut uptime_days = None;

    for line in clean.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.chars().all(|c| c == '=') {
            continue;
        }

        if let Some(value) = parse_active_whitelist(trimmed) {
            active_whitelist = value;
            continue;
        }

        if let Some(snapshot) = parse_system_snapshot(trimmed) {
            memory_used_gb = snapshot.memory_used_gb.or(memory_used_gb);
            memory_total_gb = snapshot.memory_total_gb.or(memory_total_gb);
            disk_used_gb = snapshot.disk_used_gb.or(disk_used_gb);
            disk_total_gb = snapshot.disk_total_gb.or(disk_total_gb);
            disk_used_percent = snapshot.disk_used_percent.or(disk_used_percent);
            uptime_days = snapshot.uptime_days.or(uptime_days);
            continue;
        }

        if let Some(title) = parse_section_title(trimmed) {
            if let Some(previous) = current_title.replace(title) {
                sections.push((previous, std::mem::take(&mut current_lines)));
            }
            continue;
        }

        if let Some(detail) = parse_detail_line(trimmed) {
            if current_title.is_some() {
                current_lines.push(detail);
            }
        }
    }

    if let Some(title) = current_title {
        sections.push((title, current_lines));
    }

    let optimizations = sections
        .into_iter()
        .map(|(title, lines)| {
            let description = lines.join("\n");
            MoleOptimizationItem {
                category: section_category(&title).to_string(),
                name: title.clone(),
                description,
                action: slugify(&title),
                safe: infer_safe(&title, &lines),
            }
        })
        .collect();

    OptimizePreview {
        memory_used_gb,
        memory_total_gb,
        disk_used_gb,
        disk_total_gb,
        disk_used_percent,
        uptime_days,
        active_whitelist,
        optimizations,
        raw_output: clean,
    }
}

fn parse_system_snapshot(line: &str) -> Option<SystemSnapshot> {
    let re = Regex::new(
        r"(?i)System\s+([0-9]+(?:\.[0-9]+)?)/([0-9]+(?:\.[0-9]+)?)\s*([KMGT]?B)\s*RAM\s*\|\s*([0-9]+(?:\.[0-9]+)?)/([0-9]+(?:\.[0-9]+)?)\s*([KMGT]?B)\s*Disk\s*\|\s*Uptime\s+([0-9]+(?:\.[0-9]+)?)d",
    )
    .ok()?;
    let caps = re.captures(line)?;

    Some(SystemSnapshot {
        memory_used_gb: parse_value_with_unit(caps.get(1)?.as_str(), caps.get(3)?.as_str()),
        memory_total_gb: parse_value_with_unit(caps.get(2)?.as_str(), caps.get(3)?.as_str()),
        disk_used_gb: parse_value_with_unit(caps.get(4)?.as_str(), caps.get(6)?.as_str()),
        disk_total_gb: parse_value_with_unit(caps.get(5)?.as_str(), caps.get(6)?.as_str()),
        disk_used_percent: Some(parse_percent(
            parse_value_with_unit(caps.get(4)?.as_str(), caps.get(6)?.as_str()),
            parse_value_with_unit(caps.get(5)?.as_str(), caps.get(6)?.as_str()),
        )),
        uptime_days: caps.get(7)?.as_str().parse::<f64>().ok(),
    })
}

fn parse_active_whitelist(line: &str) -> Option<Vec<String>> {
    let re = Regex::new(r"(?i)Active Whitelist:\s*(.+)$").ok()?;
    let value = re.captures(line)?.get(1)?.as_str();
    let items = value
        .split(',')
        .map(|item| item.trim())
        .filter(|item| !item.is_empty())
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    Some(items)
}

fn parse_section_title(line: &str) -> Option<String> {
    line.strip_prefix('➤')
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .map(ToString::to_string)
}

fn parse_detail_line(line: &str) -> Option<String> {
    let marker = line.chars().next()?;
    if !matches!(marker, '→' | '✓' | '◎' | '☞' | '•' | '↳') {
        return None;
    }

    let detail = line
        .char_indices()
        .nth(1)
        .map(|(idx, _)| line[idx..].trim())
        .unwrap_or("")
        .to_string();

    if detail.is_empty() {
        None
    } else {
        Some(detail)
    }
}

fn primary_disk_snapshot(status: &deepclean::MoleStatusMetrics) -> Option<&deepclean::MoleDisk> {
    status
        .disks
        .iter()
        .find(|disk| disk.mount == "/" || disk.mount.ends_with(':'))
        .or_else(|| status.disks.first())
}

fn section_category(title: &str) -> &'static str {
    let lower = title.to_lowercase();
    if lower.contains("cache")
        || lower.contains("spotlight")
        || lower.contains("finder")
        || lower.contains("dock")
        || lower.contains("font")
        || lower.contains("launchservices")
    {
        "Caches & UI"
    } else if lower.contains("network") || lower.contains("dns") || lower.contains("bluetooth") {
        "Network"
    } else if lower.contains("permission")
        || lower.contains("quarantine")
        || lower.contains("login items")
        || lower.contains("launch agents")
    {
        "Security & Access"
    } else if lower.contains("disk") || lower.contains("database") || lower.contains("usage") {
        "Storage & Data"
    } else {
        "Maintenance"
    }
}

fn infer_safe(title: &str, lines: &[String]) -> bool {
    let mut text = title.to_lowercase();
    for line in lines {
        text.push(' ');
        text.push_str(&line.to_lowercase());
    }

    text.contains("already")
        || text.contains("healthy")
        || text.contains("verified")
        || text.contains("not found")
        || text.contains("skipped")
        || text.starts_with("no ")
        || text.contains(" no ")
}

fn slugify(value: &str) -> String {
    let mut slug = String::new();
    let mut last_dash = false;

    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
            last_dash = false;
        } else if !last_dash {
            slug.push('-');
            last_dash = true;
        }
    }

    slug.trim_matches('-').to_string()
}

fn parse_value_with_unit(amount: &str, unit: &str) -> Option<f64> {
    let amount = amount.parse::<f64>().ok()?;
    let bytes = unit_to_bytes(amount, &unit.to_ascii_uppercase());
    Some(bytes_to_gb(bytes))
}

fn parse_percent(used_gb: Option<f64>, total_gb: Option<f64>) -> f64 {
    let used = used_gb.unwrap_or(0.0);
    let total = total_gb.unwrap_or(0.0);
    if total <= 0.0 {
        0.0
    } else {
        (used / total * 100.0).clamp(0.0, 100.0)
    }
}

fn parse_uptime_days(raw: &str) -> Option<f64> {
    let re = Regex::new(r"(?i)([0-9]+(?:\.[0-9]+)?)\s*d").ok()?;
    let caps = re.captures(raw)?;
    caps.get(1)?.as_str().parse::<f64>().ok()
}

fn bytes_to_gb(bytes: u64) -> f64 {
    bytes as f64 / 1024_f64.powi(3)
}

fn output_text(output: &Output) -> String {
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if stderr.trim().is_empty() {
        stdout
    } else if stdout.trim().is_empty() {
        stderr
    } else {
        format!("{stdout}\n{stderr}")
    }
}

#[derive(Debug)]
struct SystemSnapshot {
    memory_used_gb: Option<f64>,
    memory_total_gb: Option<f64>,
    disk_used_gb: Option<f64>,
    disk_total_gb: Option<f64>,
    disk_used_percent: Option<f64>,
    uptime_days: Option<f64>,
}

#[cfg(test)]
mod tests {
    use super::{infer_safe, parse_optimize_preview, parse_system_snapshot, slugify};

    #[test]
    fn parses_optimize_preview_sections() {
        let raw = r#"
Optimize and Check
→ DRY RUN MODE, No files will be modified

⚙ System 8/0 GB RAM | 1287/1858 GB Disk | Uptime 0d
⚙ Active Whitelist: check_brew_health,check_touchid,check_git_config

➤ DNS & Spotlight Check
  → DNS cache flushed
  → Spotlight index verified

➤ Launch Agents Cleanup
  → Cleaned 4 broken Launch Agent(s)

======================================================================
Dry Run Complete, No Changes Made
Would apply 23 optimizations
Run without --dry-run to apply these changes
======================================================================
"#;

        let preview = parse_optimize_preview(raw);

        assert_eq!(preview.active_whitelist.len(), 3);
        assert_eq!(preview.optimizations.len(), 2);
        assert_eq!(preview.optimizations[0].name, "DNS & Spotlight Check");
        assert!(preview.optimizations[0].safe);
        assert_eq!(preview.optimizations[1].action, "launch-agents-cleanup");
        assert!(!preview.optimizations[1].safe);
    }

    #[test]
    fn parses_system_snapshot_line() {
        let snapshot =
            parse_system_snapshot("⚙ System 8/0 GB RAM | 1287/1858 GB Disk | Uptime 3d").unwrap();
        assert!(snapshot.memory_used_gb.unwrap() >= 7.9);
        assert!(snapshot.disk_total_gb.unwrap() > 1800.0);
        assert_eq!(snapshot.uptime_days, Some(3.0));
    }

    #[test]
    fn slugifies_titles() {
        assert_eq!(slugify("Launch Agents Cleanup"), "launch-agents-cleanup");
        assert!(infer_safe(
            "DNS & Spotlight Check",
            &["DNS cache already flushed".to_string()]
        ));
    }
}
