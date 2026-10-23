use super::process_tree::PendingCleanup;
use super::MaintenanceError;
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Condvar, Mutex,
    },
    time::{Duration, Instant},
};

const RETENTION: Duration = Duration::from_secs(3600);
const MAX_ENTRIES: usize = 4096;

struct Entry {
    window: String,
    created: Instant,
    cancelled: AtomicBool,
    finished: Mutex<bool>,
    changed: Condvar,
    cleanup: Mutex<Option<PendingCleanup>>,
}

#[derive(Clone, Default)]
pub(crate) struct MaintenanceManager {
    entries: Arc<Mutex<HashMap<String, Arc<Entry>>>>,
}

pub(crate) struct RunContext {
    entry: Arc<Entry>,
    pub(super) deadline: Instant,
}

fn validate_id(run_id: &str) -> Result<(), MaintenanceError> {
    if run_id.is_empty()
        || run_id.len() > 128
        || !run_id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-_".contains(&c))
    {
        return Err(MaintenanceError::new(
            "invalid_run",
            "Invalid maintenance run identifier",
        ));
    }
    Ok(())
}

impl MaintenanceManager {
    pub fn begin(
        &self,
        window: &str,
        run_id: &str,
        timeout: Duration,
    ) -> Result<RunContext, MaintenanceError> {
        validate_id(run_id)?;
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| "Maintenance state is unavailable")?;
        entries.retain(|_, entry| {
            entry.created.elapsed() < RETENTION
                || !*entry
                    .finished
                    .lock()
                    .unwrap_or_else(|error| error.into_inner())
        });
        if let Some(entry) = entries.get(run_id) {
            if entry.window != window {
                return Err(MaintenanceError::new(
                    "invalid_run",
                    "Maintenance run belongs to another window",
                ));
            }
            return Err(if entry.cancelled.load(Ordering::SeqCst) {
                MaintenanceError::new(
                    "cancelled",
                    "Maintenance operation was cancelled before it started",
                )
            } else {
                MaintenanceError::new("invalid_run", "Maintenance run identifier was already used")
            });
        }
        if entries.values().any(|entry| {
            !*entry
                .finished
                .lock()
                .unwrap_or_else(|error| error.into_inner())
        }) {
            return Err(MaintenanceError::new(
                "busy",
                "Another maintenance operation is still running",
            ));
        }
        if entries.len() >= MAX_ENTRIES {
            return Err(MaintenanceError::new(
                "busy",
                "Too many recent maintenance requests",
            ));
        }
        let entry = Arc::new(Entry {
            window: window.to_string(),
            created: Instant::now(),
            cancelled: AtomicBool::new(false),
            finished: Mutex::new(false),
            changed: Condvar::new(),
            cleanup: Mutex::new(None),
        });
        entries.insert(run_id.to_string(), entry.clone());
        Ok(RunContext {
            entry,
            deadline: Instant::now() + timeout,
        })
    }

    pub fn cancel(&self, window: &str, run_id: &str) -> Result<(), MaintenanceError> {
        validate_id(run_id)?;
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| "Maintenance state is unavailable")?;
        if let Some(entry) = entries.get(run_id) {
            if entry.window != window {
                return Err(MaintenanceError::new(
                    "invalid_run",
                    "Maintenance run belongs to another window",
                ));
            }
            entry.cancelled.store(true, Ordering::SeqCst);
        } else {
            // Cancellation can arrive before the matching command is registered.
            if entries.len() >= MAX_ENTRIES {
                return Err(MaintenanceError::new(
                    "busy",
                    "Too many recent maintenance requests",
                ));
            }
            entries.insert(
                run_id.to_string(),
                Arc::new(Entry {
                    window: window.to_string(),
                    created: Instant::now(),
                    cancelled: AtomicBool::new(true),
                    finished: Mutex::new(true),
                    changed: Condvar::new(),
                    cleanup: Mutex::new(None),
                }),
            );
        }
        Ok(())
    }

    pub fn cancel_window(&self, window: &str) {
        let runs = if let Ok(entries) = self.entries.lock() {
            entries
                .iter()
                .filter(|(_, entry)| {
                    entry.window == window
                        && !*entry
                            .finished
                            .lock()
                            .unwrap_or_else(|error| error.into_inner())
                })
                .map(|(id, entry)| {
                    entry.cancelled.store(true, Ordering::SeqCst);
                    id.clone()
                })
                .collect::<Vec<_>>()
        } else {
            Vec::new()
        };
        for run_id in runs {
            let manager = self.clone();
            let window = window.to_string();
            // Window destruction has no UI left to retry a retained cleanup.
            // Recover it off the event loop and only release confirmed exits.
            std::thread::spawn(move || {
                let _ = manager.wait_finished(&window, &run_id, Duration::from_secs(10));
            });
        }
    }

    pub fn wait_finished(
        &self,
        window: &str,
        run_id: &str,
        timeout: Duration,
    ) -> Result<(), MaintenanceError> {
        let entry = self
            .entries
            .lock()
            .map_err(|_| "Maintenance state is unavailable")?
            .get(run_id)
            .cloned()
            .ok_or_else(|| MaintenanceError::new("invalid_run", "Unknown maintenance run"))?;
        if entry.window != window {
            return Err(MaintenanceError::new(
                "invalid_run",
                "Maintenance run belongs to another window",
            ));
        }
        let deadline = Instant::now() + timeout;
        loop {
            let mut cleanup = entry
                .cleanup
                .lock()
                .map_err(|_| "Maintenance cleanup state is unavailable")?;
            if let Some(pending) = cleanup.as_mut() {
                match pending.retry() {
                    Ok(()) => {
                        *cleanup = None;
                        *entry.finished.lock().unwrap_or_else(|e| e.into_inner()) = true;
                        entry.changed.notify_all();
                    }
                    Err(message) => {
                        let mut error = MaintenanceError::new("failed", message);
                        error.cleanup_pending = true;
                        return Err(error);
                    }
                }
            }
            drop(cleanup);
            let finished = entry
                .finished
                .lock()
                .map_err(|_| "Maintenance completion state is unavailable")?;
            if *finished {
                return Ok(());
            }
            if Instant::now() >= deadline {
                let mut error = MaintenanceError::new(
                    "failed",
                    "Cancellation is pending; the maintenance worker has not confirmed exit",
                );
                error.cleanup_pending = true;
                return Err(error);
            }
            drop(
                entry
                    .changed
                    .wait_timeout(finished, Duration::from_millis(100))
                    .map_err(|_| "Maintenance completion state is unavailable")?,
            );
        }
    }
}

impl RunContext {
    #[cfg(test)]
    pub fn hold_cleanup_for_test(&self, child: std::process::Child, allowed: Arc<AtomicBool>) {
        let tree = super::process_tree::ProcessTree::new(child.id());
        let mut pending = PendingCleanup::new(child, tree);
        pending.allow_cleanup = Some(allowed);
        self.hold_cleanup(pending);
    }
    pub(super) fn hold_cleanup(&self, pending: PendingCleanup) {
        *self
            .entry
            .cleanup
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = Some(pending);
        self.entry.changed.notify_all();
    }
    pub fn check(&self) -> Result<(), MaintenanceError> {
        if self
            .entry
            .cleanup
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .is_some()
        {
            let mut error =
                MaintenanceError::new("failed", "Maintenance worker exit is still unconfirmed");
            error.cleanup_pending = true;
            return Err(error);
        }
        if self.entry.cancelled.load(Ordering::SeqCst) {
            Err(MaintenanceError::new(
                "cancelled",
                "Maintenance operation was cancelled; review any partial result before retrying",
            ))
        } else if Instant::now() >= self.deadline {
            Err(MaintenanceError::new("timeout", "Maintenance operation exceeded its time limit; review any partial result before retrying"))
        } else {
            Ok(())
        }
    }
}

impl Drop for RunContext {
    fn drop(&mut self) {
        if self
            .entry
            .cleanup
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .is_some()
        {
            self.entry.changed.notify_all();
            return;
        }
        let mut finished = self
            .entry
            .finished
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        *finished = true;
        self.entry.changed.notify_all();
    }
}
