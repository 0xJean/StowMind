//! 监视用户指定目录，在防抖后通过 `watch-folder-change` 通知前端。

use notify::event::{EventKind, ModifyKind};
use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

#[derive(Clone, Serialize)]
pub struct WatchFolderChangePayload {
    pub paths: Vec<String>,
    pub kind: String,
}

pub struct WatchManager {
    stop: Mutex<Option<Arc<AtomicBool>>>,
    handle: Mutex<Option<JoinHandle<()>>>,
}

impl Default for WatchManager {
    fn default() -> Self {
        Self {
            stop: Mutex::new(None),
            handle: Mutex::new(None),
        }
    }
}

fn event_kind_label(kind: &EventKind) -> String {
    match kind {
        EventKind::Any => "any".to_string(),
        EventKind::Access(_) => "access".to_string(),
        EventKind::Create(_) => "create".to_string(),
        EventKind::Modify(m) => match m {
            ModifyKind::Name(_) => "rename".to_string(),
            _ => "modify".to_string(),
        },
        EventKind::Remove(_) => "remove".to_string(),
        EventKind::Other => "other".to_string(),
    }
}

fn run_watchers(app: AppHandle, roots: Vec<PathBuf>, stop: Arc<AtomicBool>) {
    let (tx, rx) = std::sync::mpsc::channel::<notify::Result<Event>>();

    let mut watchers: Vec<RecommendedWatcher> = Vec::new();
    for root in roots {
        if !root.exists() || !root.is_dir() {
            continue;
        }
        let tx = tx.clone();
        match RecommendedWatcher::new(
            move |res| {
                let _ = tx.send(res);
            },
            Config::default(),
        ) {
            Ok(mut w) => {
                if w.watch(&root, RecursiveMode::Recursive).is_ok() {
                    watchers.push(w);
                }
            }
            Err(_) => {}
        }
    }

    let debounce = Duration::from_secs(2);
    let mut last_emit: HashMap<PathBuf, Instant> = HashMap::new();

    while !stop.load(Ordering::SeqCst) {
        match rx.recv_timeout(Duration::from_millis(200)) {
            Ok(Ok(event)) => {
                if event.paths.is_empty() {
                    continue;
                }
                let kind = event_kind_label(&event.kind);
                let now = Instant::now();
                let mut emit_paths: Vec<String> = Vec::new();
                for p in &event.paths {
                    let emit = last_emit
                        .get(p)
                        .map(|t| now.duration_since(*t) >= debounce)
                        .unwrap_or(true);
                    if emit {
                        last_emit.insert(p.clone(), now);
                        emit_paths.push(p.to_string_lossy().to_string());
                    }
                }
                if emit_paths.is_empty() {
                    continue;
                }
                emit_paths.sort();
                emit_paths.dedup();
                let _ = app.emit_all(
                    "watch-folder-change",
                    WatchFolderChangePayload {
                        paths: emit_paths,
                        kind,
                    },
                );
            }
            Ok(Err(_)) => {}
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    drop(watchers);
}

impl WatchManager {
    pub fn restart(&self, app: AppHandle, paths: Vec<String>) {
        if let Some(s) = self.stop.lock().ok().and_then(|mut g| g.take()) {
            s.store(true, Ordering::SeqCst);
        }
        if let Ok(mut h) = self.handle.lock() {
            if let Some(join) = h.take() {
                let _ = join.join();
            }
        }

        let mut roots: Vec<PathBuf> = paths
            .into_iter()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .map(PathBuf::from)
            .collect();
        roots.sort();
        roots.dedup();

        if roots.is_empty() {
            return;
        }

        let stop = Arc::new(AtomicBool::new(false));
        if let Ok(mut g) = self.stop.lock() {
            *g = Some(stop.clone());
        }

        let join = std::thread::spawn(move || run_watchers(app, roots, stop));
        if let Ok(mut h) = self.handle.lock() {
            *h = Some(join);
        }
    }
}
