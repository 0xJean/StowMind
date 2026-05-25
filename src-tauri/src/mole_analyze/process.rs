use super::manager::MoleAnalyzeManager;
use super::types::{compact_analyze_result, MoleAnalyzeProgress, MoleAnalyzeResult};
use crate::mole_utils::{mole_command, mole_tokio_command, strip_ansi};
use std::process::Stdio;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Instant;
use tauri::Window;
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::time::{sleep, Duration};

pub const CANCELLED_ERROR: &str = "Analysis cancelled";

#[tauri::command]
pub async fn mole_analyze_json(path: String) -> Result<MoleAnalyzeResult, String> {
    let target = path.trim().to_string();
    if target.is_empty() {
        return Err("Analyze path is required".to_string());
    }

    let output = tokio::task::spawn_blocking(move || -> Result<std::process::Output, String> {
        mole_command()?
            .args(["analyze", "-json", &target])
            .output()
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("Failed to join analyze task: {e}"))?
    .map_err(|e| format!("Failed to run mo analyze -json: {e}"))?;

    if !output.status.success() {
        return Err(output_failure_detail(
            "mo analyze -json failed",
            &output.stdout,
            &output.stderr,
        ));
    }

    parse_analyze_output(output.stdout).map(compact_analyze_result)
}

pub async fn run_mole_analyze_process(
    window: Window,
    manager: MoleAnalyzeManager,
    run_id: &str,
    target: &str,
    started_at: Instant,
) -> Result<MoleAnalyzeResult, String> {
    let mut child = mole_tokio_command()?
        .args(["analyze", "-json", target])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to run mo analyze -json: {e}"))?;

    if let Some(pid) = child.id() {
        manager.set_pid(run_id, pid);
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture mo analyze stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture mo analyze stderr".to_string())?;

    let running = Arc::new(AtomicBool::new(true));
    let heartbeat = tokio::spawn(emit_analyze_heartbeat(
        window.clone(),
        run_id.to_string(),
        target.to_string(),
        Some(target.to_string()),
        started_at,
        running.clone(),
        None,
        None,
    ));
    let stdout_task = tokio::spawn(read_analyze_output_stream(
        stdout,
        window.clone(),
        run_id.to_string(),
        target.to_string(),
        "stdout",
        started_at,
    ));
    let stderr_task = tokio::spawn(read_analyze_output_stream(
        stderr,
        window.clone(),
        run_id.to_string(),
        target.to_string(),
        "stderr",
        started_at,
    ));

    let status = child
        .wait()
        .await
        .map_err(|e| format!("Failed to wait for mo analyze -json: {e}"))?;
    running.store(false, Ordering::Relaxed);
    manager.clear_pid(run_id);
    let _ = heartbeat.await;

    let stdout_result = stdout_task
        .await
        .map_err(|e| format!("Failed to join analyze stdout stream: {e}"))?;
    let stderr_result = stderr_task
        .await
        .map_err(|e| format!("Failed to join analyze stderr stream: {e}"))?;

    if manager.is_cancelled(run_id) {
        return Err(CANCELLED_ERROR.to_string());
    }

    let stdout = stdout_result?;
    let stderr = stderr_result?;

    if !status.success() {
        emit_analyze_progress(
            &window,
            run_id,
            target,
            "failed",
            Some("stderr"),
            Some(&stderr),
            started_at,
            None,
            None,
        );
        let detail = if stderr.trim().is_empty() {
            stdout.trim().to_string()
        } else {
            stderr.trim().to_string()
        };
        return Err(if detail.is_empty() {
            "mo analyze -json failed".to_string()
        } else {
            detail
        });
    }

    emit_analyze_progress(
        &window, run_id, target, "parsing", None, None, started_at, None, None,
    );
    let result = serde_json::from_str::<MoleAnalyzeResult>(&stdout)
        .map(compact_analyze_result)
        .map_err(|e| {
            let message = format!("Failed to parse Mole analyze JSON: {e}");
            emit_analyze_progress(
                &window,
                run_id,
                target,
                "failed",
                Some("stdout"),
                Some(&message),
                started_at,
                None,
                None,
            );
            message
        })?;
    emit_analyze_progress(
        &window, run_id, target, "finished", None, None, started_at, None, None,
    );
    Ok(result)
}

pub async fn run_mole_analyze_quiet(
    manager: MoleAnalyzeManager,
    run_id: &str,
    target: &str,
) -> Result<MoleAnalyzeResult, String> {
    let child = mole_tokio_command()?
        .args(["analyze", "-json", target])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to run mo analyze -json: {e}"))?;

    if let Some(pid) = child.id() {
        manager.set_pid(run_id, pid);
    }

    let output = child
        .wait_with_output()
        .await
        .map_err(|e| format!("Failed to wait for mo analyze -json: {e}"))?;
    manager.clear_pid(run_id);

    if manager.is_cancelled(run_id) {
        return Err(CANCELLED_ERROR.to_string());
    }

    if !output.status.success() {
        return Err(output_failure_detail(
            "mo analyze -json failed",
            &output.stdout,
            &output.stderr,
        ));
    }

    parse_analyze_output(output.stdout).map(compact_analyze_result)
}

pub async fn emit_analyze_heartbeat(
    window: Window,
    run_id: String,
    path: String,
    line: Option<String>,
    started_at: Instant,
    running: Arc<AtomicBool>,
    current: Option<usize>,
    total: Option<usize>,
) {
    while running.load(Ordering::Relaxed) {
        sleep(Duration::from_secs(2)).await;
        if running.load(Ordering::Relaxed) {
            emit_analyze_progress(
                &window,
                &run_id,
                &path,
                "running",
                None,
                line.as_deref(),
                started_at,
                current,
                total,
            );
        }
    }
}

async fn read_analyze_output_stream<R>(
    reader: R,
    window: Window,
    run_id: String,
    path: String,
    stream: &'static str,
    started_at: Instant,
) -> Result<String, String>
where
    R: AsyncRead + Unpin,
{
    let mut lines = BufReader::new(reader).lines();
    let mut raw_output = String::new();

    while let Some(line) = lines
        .next_line()
        .await
        .map_err(|e| format!("Failed to read mo analyze {stream}: {e}"))?
    {
        raw_output.push_str(&line);
        raw_output.push('\n');

        if stream == "stdout" {
            continue;
        }

        let line = strip_ansi(&line);
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        emit_analyze_progress(
            &window,
            &run_id,
            &path,
            "output",
            Some(stream),
            Some(trimmed),
            started_at,
            None,
            None,
        );
    }

    Ok(raw_output)
}

pub fn parse_analyze_output(stdout: Vec<u8>) -> Result<MoleAnalyzeResult, String> {
    let stdout = String::from_utf8(stdout)
        .map_err(|e| format!("Mole analyze output is not valid UTF-8: {e}"))?;
    serde_json::from_str::<MoleAnalyzeResult>(&stdout)
        .map_err(|e| format!("Failed to parse Mole analyze JSON: {e}"))
}

pub fn output_failure_detail(default_message: &str, stdout: &[u8], stderr: &[u8]) -> String {
    let stderr = String::from_utf8_lossy(stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(stdout).trim().to_string();
    let detail = if stderr.is_empty() { stdout } else { stderr };
    if detail.is_empty() {
        default_message.to_string()
    } else {
        detail
    }
}

pub fn emit_analyze_progress(
    window: &Window,
    run_id: &str,
    path: &str,
    phase: &str,
    stream: Option<&str>,
    line: Option<&str>,
    started_at: Instant,
    current: Option<usize>,
    total: Option<usize>,
) {
    let line = line.map(|value| {
        let value = value.trim();
        if value.chars().count() > 240 {
            format!("{}...", value.chars().take(240).collect::<String>())
        } else {
            value.to_string()
        }
    });
    let _ = window.emit(
        "mole-analyze-progress",
        MoleAnalyzeProgress {
            run_id: run_id.to_string(),
            path: path.to_string(),
            phase: phase.to_string(),
            stream: stream.map(ToString::to_string),
            line,
            elapsed_secs: started_at.elapsed().as_secs(),
            current,
            total,
        },
    );
}
