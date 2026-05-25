use crate::deepclean;
use crate::mole_utils::{current_platform, locate_mole_script, mo_cmd, strip_ansi};
use serde::Serialize;
use std::process::Command;

#[derive(Clone, Debug, Serialize)]
pub struct MoleDoctorCheck {
    pub title: String,
    pub detail: String,
    pub level: String,
    pub action: Option<String>,
    pub section: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct MoleDoctorResult {
    pub collected_at: String,
    pub platform: String,
    pub health_score: i64,
    pub health_score_msg: String,
    pub status: deepclean::MoleStatusMetrics,
    pub checks: Vec<MoleDoctorCheck>,
    pub update_available: bool,
    pub update_message: Option<String>,
    pub console_command: String,
    pub raw_output: String,
}

#[tauri::command]
pub async fn mole_doctor_json() -> Result<MoleDoctorResult, String> {
    let status_future = deepclean::mole_status_json();
    let check_future = tokio::task::spawn_blocking(run_mole_check);
    let (status_result, check_result) = tokio::join!(status_future, check_future);

    let status = status_result?;
    let check = check_result
        .map_err(|e| format!("Failed to join Mole doctor task: {e}"))?
        .unwrap_or_else(|error| MoleDoctorRun {
            checks: Vec::new(),
            update_available: false,
            update_message: None,
            raw_output: error,
        });

    Ok(MoleDoctorResult {
        collected_at: status.collected_at.clone(),
        platform: status.platform.clone(),
        health_score: status.health_score,
        health_score_msg: status.health_score_msg.clone(),
        status,
        checks: check.checks,
        update_available: check.update_available,
        update_message: check.update_message,
        console_command: doctor_console_command(),
        raw_output: check.raw_output,
    })
}

#[derive(Clone, Debug)]
struct MoleDoctorRun {
    checks: Vec<MoleDoctorCheck>,
    update_available: bool,
    update_message: Option<String>,
    raw_output: String,
}

fn doctor_console_command() -> String {
    mo_cmd().to_string()
}

fn run_mole_check() -> Result<MoleDoctorRun, String> {
    let script_name = if current_platform() == "windows" {
        "check.ps1"
    } else {
        "check.sh"
    };
    let script = locate_mole_script(script_name)?;
    let script_ext = script
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let output = if script_ext == "ps1" {
        Command::new("powershell.exe")
            .args([
                "-NoLogo",
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                script.to_string_lossy().as_ref(),
            ])
            .env("MOLE_TEST_MODE", "1")
            .env("MOLE_TEST_NO_AUTH", "1")
            .output()
            .map_err(|e| format!("Failed to run Mole doctor check: {e}"))?
    } else if script_ext == "cmd" || script_ext == "bat" {
        Command::new("cmd")
            .args(["/C", script.to_string_lossy().as_ref()])
            .env("MOLE_TEST_MODE", "1")
            .env("MOLE_TEST_NO_AUTH", "1")
            .output()
            .map_err(|e| format!("Failed to run Mole doctor check: {e}"))?
    } else {
        Command::new("/bin/bash")
            .arg(script.to_string_lossy().as_ref())
            .env("MOLE_TEST_MODE", "1")
            .env("MOLE_TEST_NO_AUTH", "1")
            .output()
            .map_err(|e| format!("Failed to run Mole doctor check: {e}"))?
    };

    let raw_output = output_text(&output);
    let checks = parse_mole_check_output(&raw_output);
    let update_available = raw_output.contains("Update ") && raw_output.contains("available");
    let update_message = extract_update_message(&raw_output);

    if !output.status.success() && checks.is_empty() && update_message.is_none() {
        return Err(if raw_output.trim().is_empty() {
            "Mole doctor check failed".to_string()
        } else {
            raw_output
        });
    }

    Ok(MoleDoctorRun {
        checks,
        update_available,
        update_message,
        raw_output,
    })
}

fn parse_mole_check_output(raw: &str) -> Vec<MoleDoctorCheck> {
    let clean = strip_ansi(raw).replace('\r', "\n");
    let mut checks = Vec::new();
    let mut current_section = String::new();

    for line in clean.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.chars().all(|c| c == '=') {
            continue;
        }

        if let Some(section) = parse_section_title(trimmed) {
            current_section = section;
            continue;
        }

        if let Some(check) = parse_check_line(trimmed, &current_section) {
            checks.push(check);
        }
    }

    checks
}

fn parse_section_title(line: &str) -> Option<String> {
    line.strip_prefix('➤').map(str::trim).and_then(|title| {
        if title.is_empty() {
            None
        } else {
            Some(title.to_string())
        }
    })
}

fn parse_check_line(line: &str, section: &str) -> Option<MoleDoctorCheck> {
    let level = match line.chars().next()? {
        '✓' => "success",
        '◎' | '-' | '☞' => "warning",
        '✗' => "destructive",
        _ => return None,
    };

    let rest = line
        .char_indices()
        .nth(1)
        .map(|(idx, _)| line[idx..].trim())?;
    if rest.is_empty() {
        return None;
    }

    let (title, detail) = split_title_detail(rest);
    let action = if section.contains("Updates") && rest.contains("brew upgrade") {
        Some("brew upgrade".to_string())
    } else if section.contains("Updates") && rest.contains("mo update") {
        Some("mo update".to_string())
    } else if section.contains("Configuration") && rest.contains("Touch ID") {
        Some("mo touchid".to_string())
    } else {
        None
    };

    Some(MoleDoctorCheck {
        title,
        detail,
        level: level.to_string(),
        action,
        section: section.to_string(),
    })
}

fn split_title_detail(text: &str) -> (String, String) {
    let mut parts = text.splitn(2, "  ");
    let first = parts.next().unwrap_or("").trim();
    let second = parts.next().unwrap_or("").trim();
    if second.is_empty() {
        if let Some((title, detail)) = first.split_once(':') {
            return (title.trim().to_string(), detail.trim().to_string());
        }
        return (first.to_string(), String::new());
    }
    (first.to_string(), second.to_string())
}

fn extract_update_message(raw: &str) -> Option<String> {
    for line in raw.lines() {
        let trimmed = strip_ansi(line).trim().to_string();
        if trimmed.contains("Update ") && trimmed.contains("available") {
            return Some(trimmed);
        }
        if trimmed.contains("latest version") && trimmed.contains("Mole") {
            return Some(trimmed);
        }
    }
    None
}

fn output_text(output: &std::process::Output) -> String {
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if stderr.trim().is_empty() {
        stdout
    } else {
        format!("{stdout}\n{stderr}")
    }
}
