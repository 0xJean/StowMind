use std::collections::{HashMap, HashSet};
use std::process::Command;
use std::sync::{Arc, Mutex};
use tauri::State;

#[derive(Clone, Default)]
pub struct MoleAnalyzeManager {
    inner: Arc<Mutex<MoleAnalyzeState>>,
}

#[derive(Default)]
struct MoleAnalyzeState {
    cancelled: HashSet<String>,
    pids: HashMap<String, u32>,
}

impl MoleAnalyzeManager {
    pub fn reset_run(&self, run_id: &str) {
        if let Ok(mut state) = self.inner.lock() {
            state.cancelled.remove(run_id);
            state.pids.remove(run_id);
        }
    }

    pub fn finish_run(&self, run_id: &str) {
        if let Ok(mut state) = self.inner.lock() {
            state.cancelled.remove(run_id);
            state.pids.remove(run_id);
        }
    }

    pub fn cancel(&self, run_id: &str) -> Option<u32> {
        if let Ok(mut state) = self.inner.lock() {
            state.cancelled.insert(run_id.to_string());
            return state.pids.get(run_id).copied();
        }
        None
    }

    pub fn is_cancelled(&self, run_id: &str) -> bool {
        self.inner
            .lock()
            .map(|state| state.cancelled.contains(run_id))
            .unwrap_or(false)
    }

    pub fn set_pid(&self, run_id: &str, pid: u32) {
        if let Ok(mut state) = self.inner.lock() {
            state.pids.insert(run_id.to_string(), pid);
        }
    }

    pub fn clear_pid(&self, run_id: &str) {
        if let Ok(mut state) = self.inner.lock() {
            state.pids.remove(run_id);
        }
    }
}

#[tauri::command]
pub fn mole_analyze_cancel(
    run_id: String,
    state: State<'_, MoleAnalyzeManager>,
) -> Result<(), String> {
    if let Some(pid) = state.cancel(&run_id) {
        let _ = terminate_pid(pid);
    }
    Ok(())
}

fn terminate_pid(pid: u32) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let status = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .status();

    #[cfg(not(target_os = "windows"))]
    let status = Command::new("kill")
        .args(["-TERM", &pid.to_string()])
        .status();

    status
        .map_err(|e| format!("Failed to cancel Mole analyze process: {e}"))
        .and_then(|status| {
            if status.success() {
                Ok(())
            } else {
                Err("Mole analyze process did not accept cancellation".to_string())
            }
        })
}
