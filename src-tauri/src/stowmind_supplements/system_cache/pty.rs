use super::probe::PathIdentity;
use crate::{
    mole_clean::MoleCleanPreviewOutput,
    mole_clean_pty::{MoleCleanInteractionRequest, MoleCleanPtyManager},
    mole_utils::runtime_path,
};
use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, PtySize};
use std::{
    collections::HashMap,
    io::Read,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::Window;

const PASSWORD_PROMPT: &str = "[StowMind cache review] Password:";

#[derive(Clone, Debug)]
pub(super) struct Measurement {
    pub status: String,
    pub size_bytes: Option<u64>,
    pub identity: Option<PathIdentity>,
}

#[derive(Default, Debug)]
pub(super) struct Protocol {
    pub authorized: bool,
    pub attempted: bool,
    pub measurements: HashMap<String, Measurement>,
    pub action: Option<String>,
    pub stage: String,
    pub failure: Option<String>,
    pub refusal: Option<String>,
    pub termination_uncertain: bool,
    termination_result: Option<Arc<Mutex<Option<Result<(), String>>>>>,
    pending: String,
    prompt_sent: bool,
}

impl Protocol {
    /// Deliberately do not retain or emit raw terminal output. In particular,
    /// credentials and sudo diagnostics never enter progress/history logs.
    fn feed(&mut self, bytes: &[u8]) -> bool {
        if self.pending.len() + bytes.len() > 16384 {
            self.pending.clear();
        }
        self.pending
            .push_str(&String::from_utf8_lossy(bytes).replace('\r', ""));
        let mut password_prompt = false;
        while let Some(index) = self.pending.find('\n') {
            let line = self.pending[..index].to_string();
            self.pending = self.pending[index + 1..].to_string();
            if line.contains(PASSWORD_PROMPT) && !self.prompt_sent {
                password_prompt = true;
            }
            self.prompt_sent = false;
            self.record(&line);
        }
        if self.pending.contains(PASSWORD_PROMPT) && !self.prompt_sent {
            self.prompt_sent = true;
            password_prompt = true;
        }
        password_prompt
    }

    fn record(&mut self, line: &str) {
        // Only fixed explanations are retained, never arbitrary Mole/sudo text.
        let lower = line.to_ascii_lowercase();
        if lower.contains("mutable ancestor")
            || lower.contains("mutable-ancestor")
            || lower.contains("writable ancestor")
        {
            self.refusal = Some(
                "Mole refused privileged removal because an ancestor directory is writable"
                    .to_string(),
            );
        } else if lower.contains("whitelist")
            && (lower.contains("skip") || lower.contains("protect"))
        {
            self.refusal =
                Some("Mole preserved the cache under the configured whitelist".to_string());
        } else if lower.contains("permission denied") || lower.contains("operation not permitted") {
            self.refusal =
                Some("Mole could not remove the cache with the available permissions".to_string());
        }
        let fields = line.trim().split('|').collect::<Vec<_>>();
        match fields.as_slice() {
            ["__STOWMIND_POLICY__", "whitelist"] => self.refusal = Some("Mole preserved the cache under the configured whitelist".to_string()),
            ["__STOWMIND_POLICY__", "mutable_parent"] => self.refusal = Some("Mole refused privileged removal because an ancestor directory is writable; its user-level fallback could not complete cleanup".to_string()),
            ["__STOWMIND_AUTH__", "complete"] => self.authorized = true,
            ["__STOWMIND_AUTH__", "failed"] => {
                self.attempted = false;
                self.failure =
                    Some("Administrator authorization failed or was cancelled".to_string());
            }
            ["__STOWMIND_STAGE__", stage] => self.stage = stage.to_string(),
            ["__STOWMIND_ATTEMPT__", "started"] => self.attempted = true,
            ["__STOWMIND_ACTION__", kind, result] => {
                self.action = Some(result.to_string());
                if *kind == "not_attempted" {
                    self.attempted = false;
                }
            }
            ["__STOWMIND_CACHE__", phase, status, kb, identity] => {
                let identity = PathIdentity::parse(identity);
                let size_bytes = if *status == "complete" && identity.is_some() {
                    kb.parse::<u64>().ok().and_then(|kb| kb.checked_mul(1024))
                } else {
                    None
                };
                self.measurements.insert(
                    phase.to_string(),
                    Measurement {
                        status: if *status == "complete" && size_bytes.is_none() {
                            "error".to_string()
                        } else {
                            status.to_string()
                        },
                        size_bytes,
                        identity,
                    },
                );
            }
            _ => {}
        }
    }
}

#[derive(Debug)]
struct GroupKiller {
    pid: Option<u32>,
    inner: Box<dyn ChildKiller + Send + Sync>,
    cancelled: Arc<AtomicBool>,
    termination: Arc<Mutex<Option<Result<(), String>>>>,
}

impl ChildKiller for GroupKiller {
    fn kill(&mut self) -> std::io::Result<()> {
        self.cancelled.store(true, Ordering::SeqCst);
        let mut termination = self
            .termination
            .lock()
            .map_err(|_| std::io::Error::other("Cannot confirm cache subprocess termination"))?;
        if termination.is_none() {
            *termination = Some(
                self.pid
                    .map(super::process_tree::terminate_tree)
                    .unwrap_or(Ok(())),
            );
        }
        let result = termination.as_ref().cloned().unwrap_or(Ok(()));
        drop(termination);
        self.inner.kill().and(result.map_err(std::io::Error::other))
    }

    fn clone_killer(&self) -> Box<dyn ChildKiller + Send + Sync> {
        Box::new(Self {
            pid: self.pid,
            inner: self.inner.clone_killer(),
            cancelled: Arc::clone(&self.cancelled),
            termination: Arc::clone(&self.termination),
        })
    }
}

struct SessionGuard {
    manager: MoleCleanPtyManager,
    run_id: String,
}
impl Drop for SessionGuard {
    fn drop(&mut self) {
        self.manager.remove(&self.run_id);
    }
}

struct ChildGuard {
    child: Box<dyn Child + Send + Sync>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    reaped: bool,
}
impl Drop for ChildGuard {
    fn drop(&mut self) {
        if !self.reaped {
            let _ = self.killer.kill();
            let _ = self.child.wait();
        }
    }
}

pub(super) fn run(
    window: &Window,
    run_id: &str,
    manager: &MoleCleanPtyManager,
    script: String,
    can_cleanup: bool,
) -> Protocol {
    let mut protocol = Protocol::default();
    if manager.is_cancelled(run_id) {
        protocol.failure = Some("Cache operation was cancelled".to_string());
        return protocol;
    }
    let result = run_inner(window, run_id, manager, script, can_cleanup, &mut protocol);
    if let Err(error) = result {
        protocol.failure = Some(error);
    }
    if let Some(termination) = &protocol.termination_result {
        protocol.termination_uncertain = termination
            .lock()
            .map(|state| matches!(*state, Some(Err(_))))
            .unwrap_or(true);
    }
    protocol
}

fn run_inner(
    window: &Window,
    run_id: &str,
    manager: &MoleCleanPtyManager,
    script: String,
    can_cleanup: bool,
    protocol: &mut Protocol,
) -> Result<(), String> {
    let pair = native_pty_system()
        .openpty(PtySize {
            rows: 40,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("Cannot open administrator authorization terminal: {error}"))?;
    let mut command = CommandBuilder::new("/bin/bash");
    command.args(["--noprofile", "--norc", "-c", &script]);
    command.env_clear();
    for key in ["HOME", "USER", "LOGNAME"] {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }
    command.env("PATH", runtime_path());
    command.env("TERM", "xterm-256color");
    command.env("LANG", "C");
    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| format!("Cannot start cache operation: {error}"))?;
    let cancelled = Arc::new(AtomicBool::new(false));
    let termination = Arc::new(Mutex::new(None));
    protocol.termination_result = Some(Arc::clone(&termination));
    let mut killer = GroupKiller {
        pid: child.process_id(),
        inner: child.clone_killer(),
        cancelled: Arc::clone(&cancelled),
        termination: Arc::clone(&termination),
    };
    let mut child = ChildGuard {
        child,
        killer: killer.clone_killer(),
        reaped: false,
    };
    // A spawned cleanup shell may already have reached Mole before a terminal
    // setup/read failure. Preserve a conservative attempt in that case.
    protocol.attempted = can_cleanup;
    drop(pair.slave);
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| error.to_string())?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| error.to_string())?;
    manager.insert(run_id.to_string(), writer, killer.clone_killer())?;
    let _guard = SessionGuard {
        manager: manager.clone(),
        run_id: run_id.to_string(),
    };
    let (sender, receiver) = mpsc::sync_channel(16);
    std::thread::spawn(move || {
        let mut buffer = [0_u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(size) => {
                    if sender.send(buffer[..size].to_vec()).is_err() {
                        return;
                    }
                }
            }
        }
    });
    let started = Instant::now();
    let mut phase_started = started;
    let mut last_stage = String::new();
    let mut status = None;
    let mut done = false;
    loop {
        match receiver.recv_timeout(Duration::from_millis(100)) {
            Ok(chunk) => {
                if protocol.feed(&chunk) {
                    let _ = window.emit("mole-clean-interaction-request", MoleCleanInteractionRequest {
                    run_id: run_id.to_string(), prompt: "Administrator access is required to inspect or clean the fixed icon cache directory".to_string(), kind: "password".to_string(),
                });
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => done = true,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
        if protocol.stage != last_stage {
            last_stage.clone_from(&protocol.stage);
            phase_started = Instant::now();
            let line = match protocol.stage.as_str() {
                "authenticate" => "Requesting administrator authorization",
                "review" => "Measuring the icon cache with administrator access",
                "before" => "Rechecking the reviewed cache identity and size",
                "clean" => "Applying Mole's scoped cache cleanup and protection rules",
                "after" => "Measuring the cache after the cleanup attempt",
                _ => "Inspecting the fixed icon cache directory",
            };
            let _ = window.emit(
                "mole-clean-preview-output",
                MoleCleanPreviewOutput {
                    run_id: run_id.to_string(),
                    stream: "pty".to_string(),
                    line: line.to_string(),
                },
            );
        }
        if status.is_none() {
            status = child.child.try_wait().map_err(|error| error.to_string())?;
        }
        if status.is_some() && done {
            break;
        }
        if cancelled.load(Ordering::SeqCst) || manager.is_cancelled(run_id) {
            let _ = killer.kill();
            protocol.termination_uncertain = termination
                .lock()
                .map(|state| matches!(*state, Some(Err(_))))
                .unwrap_or(true);
            return Err("Cache operation was cancelled; cleanup may be partial".to_string());
        }
        let limit = if protocol.stage == "clean" { 900 } else { 120 };
        if phase_started.elapsed() > Duration::from_secs(limit)
            || started.elapsed() > Duration::from_secs(1200)
        {
            let _ = killer.kill();
            protocol.termination_uncertain = termination
                .lock()
                .map(|state| matches!(*state, Some(Err(_))))
                .unwrap_or(true);
            return Err(
                "Cache operation timed out; measurements or cleanup may be partial".to_string(),
            );
        }
    }
    child.reaped = true;
    if !status.map(|status| status.success()).unwrap_or(false) {
        return Err(protocol
            .failure
            .clone()
            .unwrap_or_else(|| "Cache operation exited before completion".to_string()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::Protocol;

    #[test]
    fn parser_preserves_unknowns_and_rejects_invalid_complete_records() {
        let mut protocol = Protocol::default();
        protocol.feed(b"__STOWMIND_CACHE__|review|partial|270000000|1:2:3\n");
        assert_eq!(protocol.measurements["review"].size_bytes, None);
        protocol.feed(b"__STOWMIND_CACHE__|after|complete|2|bad-identity\n");
        assert_eq!(protocol.measurements["after"].status, "error");
        assert_eq!(protocol.measurements["after"].size_bytes, None);
    }

    #[test]
    fn parser_handles_chunked_prompts_without_retaining_credentials() {
        let mut protocol = Protocol::default();
        assert!(!protocol.feed(b"[StowMind cache re"));
        assert!(protocol.feed(b"view] Password: "));
        assert!(!protocol.feed(b""));
        protocol
            .feed(b"\n__STOWMIND_AUTH__|complete\n__STOWMIND_CACHE__|review|complete|1|1:2:3\n");
        assert!(protocol.authorized);
        assert_eq!(protocol.measurements["review"].size_bytes, Some(1024));
        assert!(protocol.pending.is_empty());
    }
}
