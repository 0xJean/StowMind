use crate::mole_utils::mole_command;
use serde_json::Value;
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex, OnceLock,
};
use tauri::{AppHandle, Manager};

const MOLE_STATUS_WATCH_EVENT: &str = "mole-status-watch";
const MOLE_STATUS_WATCH_ERROR_EVENT: &str = "mole-status-watch-error";
static MOLE_STATUS_WATCH: OnceLock<Mutex<Option<MoleStatusWatchHandle>>> = OnceLock::new();
static MOLE_STATUS_WATCH_ID: AtomicU64 = AtomicU64::new(1);

struct MoleStatusWatchHandle {
    id: u64,
    subscribers: u32,
    stop: Arc<AtomicBool>,
    pid: Arc<Mutex<Option<u32>>>,
}

fn mole_status_watch_state() -> &'static Mutex<Option<MoleStatusWatchHandle>> {
    MOLE_STATUS_WATCH.get_or_init(|| Mutex::new(None))
}

/// Start one shared Mole status stream. Multiple windows can subscribe without
/// spawning duplicate status collectors; the stream stops after the last
/// subscriber leaves.
#[tauri::command]
pub fn mole_status_watch_start(app: AppHandle, interval_ms: Option<u64>) -> Result<(), String> {
    let mut state = mole_status_watch_state()
        .lock()
        .map_err(|_| "Mole status watch state is unavailable".to_string())?;
    if let Some(handle) = state.as_mut() {
        handle.subscribers = handle.subscribers.saturating_add(1);
        return Ok(());
    }

    let interval_ms = interval_ms.unwrap_or(5_000).clamp(1_000, 60_000);
    let id = MOLE_STATUS_WATCH_ID.fetch_add(1, Ordering::Relaxed);
    let stop = Arc::new(AtomicBool::new(false));
    let pid = Arc::new(Mutex::new(None));
    *state = Some(MoleStatusWatchHandle {
        id,
        subscribers: 1,
        stop: Arc::clone(&stop),
        pid: Arc::clone(&pid),
    });
    drop(state);

    std::thread::spawn(move || {
        let result = run_mole_status_watch(&app, interval_ms, &stop, &pid);
        if let Err(error) = result {
            let _ = app.emit_all(MOLE_STATUS_WATCH_ERROR_EVENT, error);
        }
        clear_mole_status_watch(id);
    });
    Ok(())
}

/// Release one status stream subscription and terminate Mole when unused.
#[tauri::command]
pub fn mole_status_watch_stop() -> Result<(), String> {
    let mut state = mole_status_watch_state()
        .lock()
        .map_err(|_| "Mole status watch state is unavailable".to_string())?;
    let Some(handle) = state.as_mut() else {
        return Ok(());
    };
    if handle.subscribers > 1 {
        handle.subscribers -= 1;
        return Ok(());
    }

    handle.stop.store(true, Ordering::Relaxed);
    let pid = handle.pid.lock().ok().and_then(|value| *value);
    *state = None;
    drop(state);
    if let Some(pid) = pid {
        terminate_status_pid(pid);
    }
    Ok(())
}

fn run_mole_status_watch(
    app: &AppHandle,
    interval_ms: u64,
    stop: &Arc<AtomicBool>,
    pid: &Arc<Mutex<Option<u32>>>,
) -> Result<(), String> {
    let interval = if interval_ms % 1_000 == 0 {
        format!("{}s", interval_ms / 1_000)
    } else {
        format!("{interval_ms}ms")
    };
    let mut command = mole_command()?;
    configure_status_process(&mut command);
    let mut child = command
        .args(["status", "--watch", "--interval", &interval, "-json"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Failed to start Mole status watch: {error}"))?;
    if let Ok(mut value) = pid.lock() {
        *value = Some(child.id());
    }
    if stop.load(Ordering::Relaxed) {
        terminate_status_process(&mut child);
        if let Ok(mut value) = pid.lock() {
            *value = None;
        }
        return Ok(());
    }

    let Some(stdout) = child.stdout.take() else {
        terminate_status_process(&mut child);
        return Err("Mole status watch did not provide stdout".to_string());
    };
    let reader = BufReader::new(stdout);
    let mut emitted = false;
    let read_result = (|| -> Result<(), String> {
        for line in reader.lines() {
            if stop.load(Ordering::Relaxed) {
                break;
            }
            let line =
                line.map_err(|error| format!("Failed to read Mole status watch: {error}"))?;
            if line.trim().is_empty() {
                continue;
            }
            let payload = serde_json::from_str::<Value>(&line)
                .map_err(|error| format!("Failed to parse Mole status watch JSON: {error}"))?;
            emitted = true;
            let _ = app.emit_all(MOLE_STATUS_WATCH_EVENT, payload);
        }
        Ok(())
    })();

    let exit_status = if stop.load(Ordering::Relaxed) || read_result.is_err() {
        terminate_status_process(&mut child);
        None
    } else {
        Some(
            child
                .wait()
                .map_err(|error| format!("Failed to stop Mole status watch: {error}"))?,
        )
    };
    if let Ok(mut value) = pid.lock() {
        *value = None;
    }
    if let Some(status) = exit_status {
        if !status.success() {
            return Err(format!("Mole status watch exited with {status}"));
        }
        if !emitted {
            return Err("Mole status watch returned no metrics".to_string());
        }
    }
    read_result
}

fn clear_mole_status_watch(id: u64) {
    if let Ok(mut state) = mole_status_watch_state().lock() {
        if state.as_ref().map(|handle| handle.id) == Some(id) {
            *state = None;
        }
    }
}

fn configure_status_process(command: &mut Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
}

fn terminate_status_process(child: &mut Child) {
    let pid = child.id().to_string();
    #[cfg(unix)]
    {
        let process_group = format!("-{pid}");
        let _ = Command::new("/bin/kill")
            .args(["-TERM", &process_group])
            .status();
        std::thread::sleep(std::time::Duration::from_millis(100));
        let _ = Command::new("/bin/kill")
            .args(["-KILL", &process_group])
            .status();
    }
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid, "/T", "/F"])
            .status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn terminate_status_pid(pid: u32) {
    #[cfg(unix)]
    {
        let process_group = format!("-{pid}");
        let _ = Command::new("/bin/kill")
            .args(["-TERM", &process_group])
            .status();
        std::thread::sleep(std::time::Duration::from_millis(100));
        let _ = Command::new("/bin/kill")
            .args(["-KILL", &process_group])
            .status();
    }
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status();
    }
}
