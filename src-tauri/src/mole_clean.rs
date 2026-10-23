mod parser;
mod summary;
#[cfg(test)]
mod tests;
mod types;

pub(crate) use parser::parse_clean_preview;
pub use types::{MoleCleanPreview, MoleCleanPreviewOutput};

use crate::mole_utils::{mole_command, mole_tokio_command, strip_ansi};
use std::process::Stdio;
use tauri::Window;
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::time::{timeout, Duration};

const CLEAN_PREVIEW_TIMEOUT_SECS: u64 = 60;

#[tauri::command]
pub async fn mole_clean_preview(external_path: Option<String>) -> Result<MoleCleanPreview, String> {
    let external_path = normalize_external_path(external_path)?;
    let output = tokio::task::spawn_blocking(move || -> Result<std::process::Output, String> {
        let mut command = mole_command()?;
        command.args(["clean", "--dry-run"]);
        if let Some(path) = external_path.as_deref() {
            command.args(["--external", path]);
        }
        command.output().map_err(|e| e.to_string())
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
    external_path: Option<String>,
) -> Result<MoleCleanPreview, String> {
    let external_path = normalize_external_path(external_path)?;
    let mut command = mole_tokio_command()?;
    command.args(["clean", "--dry-run"]);
    if let Some(path) = external_path.as_deref() {
        command.args(["--external", path]);
    }
    let mut child = command
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

pub(crate) fn normalize_external_path(path: Option<String>) -> Result<Option<String>, String> {
    let Some(path) = path else {
        return Ok(None);
    };
    let path = path.trim().to_string();
    if path.is_empty() {
        return Ok(None);
    }
    if !std::path::Path::new(&path).is_dir() {
        return Err(format!("External clean path is not a directory: {path}"));
    }
    Ok(Some(path))
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
