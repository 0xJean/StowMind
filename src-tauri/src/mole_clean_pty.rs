use crate::mole_clean::{
    format_clean_process_failure, parse_clean_preview, MoleCleanPreview, MoleCleanPreviewOutput,
};
use crate::mole_utils::{locate_mole_executable, runtime_path, strip_ansi};
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{State, Window};

const CLEAN_PREVIEW_PTY_IDLE_TIMEOUT_SECS: u64 = 180;
const CLEAN_PREVIEW_PTY_MAX_RUNTIME_SECS: u64 = 1_800;
const CLEAN_PREVIEW_PTY_COLS: u16 = 140;
const CLEAN_PREVIEW_PTY_ROWS: u16 = 40;

enum PtyReadEvent {
    Chunk(Vec<u8>),
    Done,
}

struct MoleCleanPtySession {
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

#[derive(Clone, Default)]
pub struct MoleCleanPtyManager {
    sessions: Arc<Mutex<HashMap<String, MoleCleanPtySession>>>,
}

impl MoleCleanPtyManager {
    pub(crate) fn insert(
        &self,
        run_id: String,
        writer: Box<dyn Write + Send>,
        killer: Box<dyn ChildKiller + Send + Sync>,
    ) -> Result<(), String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|e| format!("Lock error: {e}"))?;
        sessions.insert(run_id, MoleCleanPtySession { writer, killer });
        Ok(())
    }

    pub(crate) fn write(&self, run_id: &str, input: &[u8]) -> Result<(), String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|e| format!("Lock error: {e}"))?;
        let session = sessions
            .get_mut(run_id)
            .ok_or_else(|| "Mole clean scan is no longer running".to_string())?;
        session
            .writer
            .write_all(input)
            .map_err(|e| format!("Failed to write to Mole clean PTY: {e}"))?;
        session
            .writer
            .flush()
            .map_err(|e| format!("Failed to flush Mole clean PTY: {e}"))
    }

    pub(crate) fn cancel(&self, run_id: &str) -> Result<(), String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|e| format!("Lock error: {e}"))?;
        if let Some(mut session) = sessions.remove(run_id) {
            let _ = session.killer.kill();
        }
        Ok(())
    }

    pub(crate) fn remove(&self, run_id: &str) {
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.remove(run_id);
        }
    }
}

struct SessionCleanup {
    manager: MoleCleanPtyManager,
    run_id: String,
}

impl Drop for SessionCleanup {
    fn drop(&mut self) {
        self.manager.remove(&self.run_id);
    }
}

#[derive(Clone, Serialize)]
pub struct MoleCleanInteractionRequest {
    pub run_id: String,
    pub prompt: String,
    pub kind: String,
}

struct PreviewOutputEmitter {
    window: Window,
    run_id: String,
    pending: String,
    last_line: Option<String>,
    pending_interaction_request_sent: bool,
}

impl PreviewOutputEmitter {
    fn new(window: Window, run_id: String) -> Self {
        Self {
            window,
            run_id,
            pending: String::new(),
            last_line: None,
            pending_interaction_request_sent: false,
        }
    }

    fn process_chunk(&mut self, chunk: &[u8]) {
        let text = String::from_utf8_lossy(chunk);
        let normalized = normalize_clean_output(&text);
        self.pending.push_str(&normalized);

        while let Some(index) = self.pending.find('\n') {
            let line = self.pending[..index].to_string();
            self.pending = self.pending[index + 1..].to_string();
            self.pending_interaction_request_sent = false;
            self.emit_line(&line);
        }

        self.emit_pending_interaction_prompt();
    }

    fn flush(&mut self) {
        if self.pending.trim().is_empty() {
            self.pending.clear();
            return;
        }
        let line = std::mem::take(&mut self.pending);
        self.emit_line(&line);
    }

    fn emit_line(&mut self, line: &str) {
        let line = sanitize_stream_line(line);
        if line.is_empty() || self.last_line.as_deref() == Some(line.as_str()) {
            return;
        }

        self.last_line = Some(line.clone());
        let interaction_kind = detect_interaction_kind(&line);
        let needs_interaction_request =
            interaction_kind.is_some() && !self.pending_interaction_request_sent;
        let _ = self.window.emit(
            "mole-clean-preview-output",
            MoleCleanPreviewOutput {
                run_id: self.run_id.clone(),
                stream: "pty".to_string(),
                line: line.clone(),
            },
        );

        if needs_interaction_request {
            self.pending_interaction_request_sent = true;
            let _ = self.window.emit(
                "mole-clean-interaction-request",
                MoleCleanInteractionRequest {
                    run_id: self.run_id.clone(),
                    prompt: line,
                    kind: interaction_kind.unwrap_or("text").to_string(),
                },
            );
        }
    }

    fn emit_pending_interaction_prompt(&mut self) {
        let line = sanitize_stream_line(&self.pending);
        if detect_interaction_kind(&line).is_none() || self.pending_interaction_request_sent {
            return;
        }
        self.emit_line(&line);
    }
}

#[tauri::command]
pub async fn mole_clean_preview_pty(
    window: Window,
    run_id: String,
    state: State<'_, MoleCleanPtyManager>,
) -> Result<MoleCleanPreview, String> {
    let manager = state.inner().clone();
    tokio::task::spawn_blocking(move || run_mole_clean_preview_pty(window, run_id, manager))
        .await
        .map_err(|e| format!("Failed to join Mole clean PTY preview task: {e}"))?
}

#[tauri::command]
pub fn mole_clean_preview_pty_submit_interaction(
    run_id: String,
    input: String,
    state: State<'_, MoleCleanPtyManager>,
) -> Result<(), String> {
    let bytes = encode_interaction_input(&input);
    state.write(&run_id, &bytes)
}

#[tauri::command]
pub fn mole_clean_preview_pty_cancel(
    run_id: String,
    state: State<'_, MoleCleanPtyManager>,
) -> Result<(), String> {
    state.cancel(&run_id)
}

fn run_mole_clean_preview_pty(
    window: Window,
    run_id: String,
    manager: MoleCleanPtyManager,
) -> Result<MoleCleanPreview, String> {
    let command = locate_mole_executable()?.to_string_lossy().to_string();
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: CLEAN_PREVIEW_PTY_ROWS,
            cols: CLEAN_PREVIEW_PTY_COLS,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open Mole clean PTY: {e}"))?;

    let mut cmd = CommandBuilder::new(&command);
    cmd.args(["clean", "--dry-run"]);
    for (key, value) in std::env::vars() {
        cmd.env(key, value);
    }
    cmd.env("PATH", runtime_path());
    cmd.env("TERM", "xterm-256color");

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn mo clean --dry-run in PTY: {e}"))?;
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone Mole clean PTY reader: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to open Mole clean PTY input: {e}"))?;
    manager.insert(run_id.clone(), writer, child.clone_killer())?;
    let _cleanup = SessionCleanup {
        manager: manager.clone(),
        run_id: run_id.clone(),
    };
    drop(pair.master);

    let (tx, rx) = mpsc::channel::<PtyReadEvent>();
    std::thread::spawn(move || {
        let mut buffer = [0_u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(size) => {
                    if tx
                        .send(PtyReadEvent::Chunk(buffer[..size].to_vec()))
                        .is_err()
                    {
                        return;
                    }
                }
                Err(_) => break,
            }
        }
        let _ = tx.send(PtyReadEvent::Done);
    });

    let started = Instant::now();
    let mut last_activity = started;
    let mut output = Vec::new();
    let mut emitter = PreviewOutputEmitter::new(window, run_id);
    let mut reader_done = false;
    let mut status = None;

    loop {
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(PtyReadEvent::Chunk(chunk)) => {
                last_activity = Instant::now();
                output.extend_from_slice(&chunk);
                emitter.process_chunk(&chunk);
            }
            Ok(PtyReadEvent::Done) => {
                reader_done = true;
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => {
                reader_done = true;
            }
        }

        if status.is_none() {
            status = child
                .try_wait()
                .map_err(|e| format!("Failed to poll mo clean --dry-run: {e}"))?;
        }

        if status.is_some() && reader_done {
            break;
        }

        if last_activity.elapsed() > Duration::from_secs(CLEAN_PREVIEW_PTY_IDLE_TIMEOUT_SECS) {
            let _ = child.kill();
            let _ = child.wait();
            emitter.flush();
            let raw_output = normalize_clean_output(&String::from_utf8_lossy(&output));
            return Err(if raw_output.trim().is_empty() {
                format!(
                    "mo clean --dry-run produced no output for {CLEAN_PREVIEW_PTY_IDLE_TIMEOUT_SECS}s"
                )
            } else {
                format!(
                    "mo clean --dry-run produced no output for {CLEAN_PREVIEW_PTY_IDLE_TIMEOUT_SECS}s\n{raw_output}"
                )
            });
        }

        if started.elapsed() > Duration::from_secs(CLEAN_PREVIEW_PTY_MAX_RUNTIME_SECS) {
            let _ = child.kill();
            let _ = child.wait();
            emitter.flush();
            let raw_output = normalize_clean_output(&String::from_utf8_lossy(&output));
            return Err(if raw_output.trim().is_empty() {
                format!("mo clean --dry-run exceeded {CLEAN_PREVIEW_PTY_MAX_RUNTIME_SECS}s runtime")
            } else {
                format!(
                    "mo clean --dry-run exceeded {CLEAN_PREVIEW_PTY_MAX_RUNTIME_SECS}s runtime\n{raw_output}"
                )
            });
        }
    }

    emitter.flush();
    let raw_output = normalize_clean_output(&String::from_utf8_lossy(&output));
    let status = status.ok_or_else(|| "mo clean --dry-run exited without status".to_string())?;

    if !status.success() {
        return Err(format_clean_process_failure(
            Some(status.exit_code() as i32),
            &raw_output,
        ));
    }

    Ok(parse_clean_preview(&raw_output))
}

fn encode_interaction_input(input: &str) -> Vec<u8> {
    match input {
        "__ENTER__" => vec![b'\n'],
        "__SPACE__" => vec![b' '],
        value => {
            let mut bytes = value.as_bytes().to_vec();
            bytes.push(b'\n');
            bytes
        }
    }
}

fn normalize_clean_output(raw: &str) -> String {
    strip_ansi(raw)
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .chars()
        .filter(|&c| c == '\n' || c == '\t' || !c.is_control())
        .collect()
}

fn sanitize_stream_line(line: &str) -> String {
    let line = line.trim();
    let line = line.strip_prefix(spinner_prefix).unwrap_or(line).trim();
    line.to_string()
}

fn detect_interaction_kind(line: &str) -> Option<&'static str> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }

    let lower = trimmed.to_ascii_lowercase();
    if lower.contains("password:") || lower.contains("password for") || trimmed.contains("输入密码")
    {
        return Some("password");
    }

    if contains_any(
        &lower,
        &[
            "press enter",
            "hit enter",
            "return to continue",
            "enter to continue",
        ],
    ) || trimmed.contains("按回车")
        || trimmed.contains("回车继续")
    {
        return Some("enter");
    }

    if contains_any(&lower, &["space skip", "space to skip", "space: skip"])
        || trimmed.contains("空格跳过")
    {
        return Some("enter_space");
    }

    if is_confirm_prompt(trimmed, &lower) {
        return Some("confirm");
    }

    if contains_any(
        &lower,
        &[
            "enter choice",
            "enter option",
            "select option",
            "choose option",
            "please select",
            "your choice",
        ],
    ) || trimmed.contains("请输入")
        || trimmed.contains("请选择")
    {
        return Some("text");
    }

    None
}

fn is_confirm_prompt(trimmed: &str, lower: &str) -> bool {
    contains_any(
        lower,
        &[
            "[y/n]",
            "(y/n)",
            "yes/no",
            "y/n",
            "continue?",
            "proceed?",
            "are you sure",
            "confirm?",
        ],
    ) || trimmed.contains("是否继续")
        || trimmed.contains("确定")
        || trimmed.contains("确认")
}

fn contains_any(value: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| value.contains(needle))
}

fn spinner_prefix(value: char) -> bool {
    matches!(
        value,
        '⠋' | '⠙' | '⠹' | '⠸' | '⠼' | '⠴' | '⠦' | '⠧' | '⠇' | '⠏'
    )
}
