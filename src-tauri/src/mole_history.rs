use crate::mole_utils::mole_command;
use serde::{Deserialize, Serialize};
use std::process::{Output, Stdio};
use std::time::{Duration, Instant};

const MOLE_HISTORY_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct MoleHistoryLogs {
    #[serde(default)]
    pub operations: Option<String>,
    #[serde(default)]
    pub deletions: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct MoleHistoryActions {
    #[serde(default)]
    pub removed: u64,
    #[serde(default)]
    pub trashed: u64,
    #[serde(default)]
    pub skipped: u64,
    #[serde(default)]
    pub failed: u64,
    #[serde(default)]
    pub rebuilt: u64,
    #[serde(default)]
    pub other: u64,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct MoleHistorySession {
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub started_at: String,
    #[serde(default)]
    pub ended_at: String,
    #[serde(default)]
    pub items: u64,
    #[serde(default)]
    pub size: String,
    #[serde(default)]
    pub operation_count: u64,
    #[serde(default)]
    pub failed_tasks: u64,
    #[serde(default)]
    pub actions: MoleHistoryActions,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct MoleHistoryDeletion {
    #[serde(default)]
    pub timestamp: String,
    #[serde(default)]
    pub mode: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub size_kb: u64,
    #[serde(default)]
    pub path: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct MoleHistorySnapshot {
    #[serde(default)]
    pub logs: MoleHistoryLogs,
    #[serde(default)]
    pub limit: Option<u64>,
    #[serde(default)]
    pub sessions: Vec<MoleHistorySession>,
    #[serde(default)]
    pub deletions: Vec<MoleHistoryDeletion>,
}

/// Read Mole's operation and deletion history without parsing its log files in the UI.
/// The command is intentionally tolerant of fields added by newer Mole versions.
#[tauri::command]
pub async fn mole_history_json(limit: Option<u32>) -> Result<MoleHistorySnapshot, String> {
    let output = tokio::task::spawn_blocking(move || {
        let mut command = mole_command()?;
        command.arg("history").arg("--json");
        if let Some(limit) = limit {
            command.args(["--limit", &limit.to_string()]);
        }
        let mut child = command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("Failed to run Mole history: {error}"))?;
        let deadline = Instant::now() + MOLE_HISTORY_TIMEOUT;
        loop {
            match child
                .try_wait()
                .map_err(|error| format!("Failed to check Mole history: {error}"))?
            {
                Some(_) => {
                    return child
                        .wait_with_output()
                        .map_err(|error| format!("Failed to collect Mole history: {error}"));
                }
                None if Instant::now() >= deadline => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!(
                        "Mole history timed out after {} seconds",
                        MOLE_HISTORY_TIMEOUT.as_secs()
                    ));
                }
                None => std::thread::sleep(Duration::from_millis(100)),
            }
        }
    })
    .await
    .map_err(|error| format!("Failed to join Mole history task: {error}"))??;

    if !output.status.success() {
        return Err(history_command_error(&output));
    }

    let stdout = String::from_utf8(output.stdout)
        .map_err(|error| format!("Mole history output is not valid UTF-8: {error}"))?;
    if stdout.trim().is_empty() {
        return Err("Mole history returned an empty JSON response".to_string());
    }

    serde_json::from_str::<MoleHistorySnapshot>(&stdout)
        .map_err(|error| format!("Failed to parse Mole history JSON: {error}"))
}

fn history_command_error(output: &Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let detail = if stderr.is_empty() { stdout } else { stderr };
    if detail.is_empty() {
        "Mole history --json failed".to_string()
    } else {
        detail
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_mole_history_with_missing_optional_fields() {
        let snapshot: MoleHistorySnapshot = serde_json::from_str(
            r#"{"sessions":[{"command":"clean","items":2,"actions":{"removed":1}}],"deletions":[]}"#,
        )
        .expect("history JSON should parse");
        assert_eq!(snapshot.sessions[0].command, "clean");
        assert_eq!(snapshot.sessions[0].items, 2);
        assert_eq!(snapshot.sessions[0].actions.removed, 1);
        assert_eq!(snapshot.sessions[0].actions.failed, 0);
    }
}
