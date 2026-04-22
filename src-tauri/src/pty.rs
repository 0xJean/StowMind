use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{State, Window};

/// Single PTY session holding writer, child process, and master (for resize).
struct PtySession {
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send>,
    master: Box<dyn portable_pty::MasterPty + Send>,
}

/// Global PTY manager injected as Tauri State.
pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<u32, PtySession>>>,
    next_id: AtomicU32,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            next_id: AtomicU32::new(1),
        }
    }
}

impl Default for PtyManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Payload for `pty-output` events (base64-encoded PTY stdout data).
#[derive(Clone, Serialize)]
pub struct PtyOutput {
    pub id: u32,
    pub data: String,
}

/// Payload for `pty-exit` events.
#[derive(Clone, Serialize)]
pub struct PtyExit {
    pub id: u32,
    pub code: Option<u32>,
}

/// Create a PTY session, spawn a child process, and start a reader thread
/// that emits `pty-output` events. Returns the session ID.
#[tauri::command]
pub async fn pty_spawn(
    window: Window,
    command: String,
    args: Vec<String>,
    cols: u16,
    rows: u16,
    state: State<'_, PtyManager>,
) -> Result<u32, String> {
    let pty_system = native_pty_system();

    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {e}"))?;

    let mut cmd = CommandBuilder::new(&command);
    cmd.args(&args);
    // Inherit the entire environment from the parent process so all
    // tools (mo, brew, git, etc.) can be found and config paths work
    for (key, value) in std::env::vars() {
        cmd.env(key, value);
    }
    // Override TERM to ensure TUI programs get full terminal support
    cmd.env("TERM", "xterm-256color");

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn command: {e}"))?;

    // Drop the slave side — we only need the master from here on
    drop(pair.slave);

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone PTY reader: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take PTY writer: {e}"))?;

    let id = state.next_id.fetch_add(1, Ordering::Relaxed);

    // Store session (writer + child + master for resize)
    {
        let mut sessions = state.sessions.lock().map_err(|e| format!("Lock error: {e}"))?;
        sessions.insert(
            id,
            PtySession {
                writer,
                child,
                master: pair.master,
            },
        );
    }

    // Clone what the reader thread needs
    let sessions_arc = Arc::clone(&state.sessions);
    let win = window.clone();

    // Spawn a std::thread (NOT tokio) because portable-pty's reader is blocking I/O
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 4096];

        loop {
            match reader.read(&mut buf) {
                Ok(0) => break, // EOF
                Ok(n) => {
                    let encoded = STANDARD.encode(&buf[..n]);
                    let _ = win.emit("pty-output", PtyOutput { id, data: encoded });
                }
                Err(_) => break,
            }
        }

        // Child exited — get exit code
        let code = {
            let mut sessions = match sessions_arc.lock() {
                Ok(s) => s,
                Err(_) => {
                    let _ = win.emit("pty-exit", PtyExit { id, code: None });
                    return;
                }
            };
            if let Some(session) = sessions.get_mut(&id) {
                session
                    .child
                    .wait()
                    .ok()
                    .map(|status| status.exit_code())
            } else {
                None
            }
        };

        let _ = win.emit("pty-exit", PtyExit { id, code });
    });

    Ok(id)
}

/// Write raw data to a PTY session's stdin.
#[tauri::command]
pub async fn pty_write(
    id: u32,
    data: String,
    state: State<'_, PtyManager>,
) -> Result<(), String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|e| format!("Lock error: {e}"))?;
    let session = sessions
        .get_mut(&id)
        .ok_or_else(|| "Session not found or already closed".to_string())?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("Write error: {e}"))?;
    session
        .writer
        .flush()
        .map_err(|e| format!("Flush error: {e}"))?;
    Ok(())
}

/// Resize a PTY session's window.
#[tauri::command]
pub async fn pty_resize(
    id: u32,
    cols: u16,
    rows: u16,
    state: State<'_, PtyManager>,
) -> Result<(), String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|e| format!("Lock error: {e}"))?;
    let session = sessions
        .get(&id)
        .ok_or_else(|| "Session not found or already closed".to_string())?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Resize error: {e}"))?;
    Ok(())
}

/// Kill a PTY session: remove from map, terminate child process.
#[tauri::command]
pub async fn pty_kill(
    id: u32,
    state: State<'_, PtyManager>,
) -> Result<(), String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|e| format!("Lock error: {e}"))?;
    let mut session = sessions
        .remove(&id)
        .ok_or_else(|| "Session not found".to_string())?;
    session
        .child
        .kill()
        .map_err(|e| format!("Kill error: {e}"))?;
    Ok(())
}
