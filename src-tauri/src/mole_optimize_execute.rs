use crate::mole_utils::{mole_command, strip_ansi};
use serde::Serialize;
use std::process::Output;

#[derive(Clone, Debug, Serialize)]
pub struct MoleOptimizeExecuteOutcome {
    pub applied_count: u64,
    pub raw_output: String,
}

#[tauri::command]
pub async fn mole_optimize_execute() -> Result<MoleOptimizeExecuteOutcome, String> {
    let output = tokio::task::spawn_blocking(|| -> Result<std::process::Output, String> {
        mole_command()?
            .arg("optimize")
            .output()
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("Failed to join Mole optimize task: {e}"))?
    .map_err(|e| format!("Failed to run mo optimize: {e}"))?;

    let raw_output = output_text(&output);
    if !output.status.success() {
        return Err(if raw_output.trim().is_empty() {
            "mo optimize failed".to_string()
        } else {
            raw_output
        });
    }

    let clean = strip_ansi(&raw_output);
    Ok(MoleOptimizeExecuteOutcome {
        applied_count: parse_applied_count(&clean),
        raw_output: clean,
    })
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

fn parse_applied_count(raw: &str) -> u64 {
    let patterns = [
        r"(?i)\bApplied\s+(\d+)\s+optimizations?\b",
        r"(?i)\b(\d+)\s+optimizations?\s+(?:applied|completed|complete)\b",
        r"(?i)\bWould\s+apply\s+(\d+)\s+optimizations?\b",
    ];

    for pattern in patterns {
        let Ok(re) = regex::Regex::new(pattern) else {
            continue;
        };
        if let Some(count) = re
            .captures(raw)
            .and_then(|caps| caps.get(1))
            .and_then(|value| value.as_str().parse::<u64>().ok())
        {
            return count;
        }
    }

    0
}

#[cfg(test)]
mod tests {
    use super::parse_applied_count;

    #[test]
    fn parses_applied_summary() {
        assert_eq!(parse_applied_count("Applied 23 optimizations"), 23);
        assert_eq!(parse_applied_count("23 optimizations completed"), 23);
        assert_eq!(parse_applied_count("Would apply 7 optimizations"), 7);
    }
}
