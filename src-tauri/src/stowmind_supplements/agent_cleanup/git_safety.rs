//! Concurrency, HEAD and retention guards for Git metadata cleanup.

use super::super::types::AgentCleanupPolicy;
use super::Repository;
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, OnceLock,
    },
    time::{Instant, UNIX_EPOCH},
};
use walkdir::WalkDir;

const GIT_PROCESS_CACHE_TTL_MS: u128 = 250;
static GIT_PROCESS_CACHE: OnceLock<Mutex<HashMap<String, (Instant, bool)>>> = OnceLock::new();
static NEXT_HEAD_LOCK: AtomicU64 = AtomicU64::new(0);

pub(super) struct WorktreeHeadGuard {
    locks: Vec<(PathBuf, Vec<u8>)>,
}

impl WorktreeHeadGuard {
    fn acquire(&mut self, git_dir: &Path) -> Result<(), String> {
        let path = git_dir.join("HEAD.lock");
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|error| format!("Cannot lock worktree HEAD; cleanup is blocked: {error}"))?;
        let marker = format!(
            "stowmind-head-guard:{}:{}\n",
            std::process::id(),
            NEXT_HEAD_LOCK.fetch_add(1, Ordering::Relaxed)
        )
        .into_bytes();
        if let Err(error) = file.write_all(&marker) {
            drop(file);
            let _ = fs::remove_file(path);
            return Err(format!("Cannot initialize worktree HEAD lock: {error}"));
        }
        self.locks.push((path, marker));
        Ok(())
    }
}

impl Drop for WorktreeHeadGuard {
    fn drop(&mut self) {
        for (path, marker) in self.locks.iter().rev() {
            // Never remove another writer's lock if our file was replaced.
            if fs::symlink_metadata(path)
                .map(|metadata| metadata.file_type().is_file())
                .unwrap_or(false)
                && fs::read(path).ok().as_ref() == Some(marker)
            {
                let _ = fs::remove_file(path);
            }
        }
    }
}

/// Even a Codex-namespaced ref can be used as HEAD or an intermediate symbolic
/// link by a worktree. Deleting it would break that HEAD and write its reflog.
/// Hold each HEAD lock through deletion, so a concurrent Git writer cannot
/// switch HEAD onto the candidate after the read-only symbolic-chain check.
pub(super) fn protect_worktree_heads(
    repository: &Repository,
    refname: &str,
) -> Result<WorktreeHeadGuard, String> {
    let mut git_dirs = vec![repository.git_dir.clone()];
    match fs::read_dir(repository.git_dir.join("worktrees")) {
        Ok(entries) => {
            for entry in entries {
                let entry =
                    entry.map_err(|error| format!("Cannot inspect worktree HEADs: {error}"))?;
                let kind = entry
                    .file_type()
                    .map_err(|error| format!("Cannot inspect worktree HEADs: {error}"))?;
                if kind.is_symlink() {
                    return Err("Cannot safely inspect symbolic worktree metadata".to_string());
                }
                if kind.is_dir() {
                    git_dirs.push(entry.path());
                }
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("Cannot inspect worktree HEADs: {error}")),
    }
    let mut guard = WorktreeHeadGuard { locks: Vec::new() };
    for git_dir in &git_dirs {
        guard.acquire(git_dir)?;
    }
    for git_dir in git_dirs {
        let mut current = "HEAD".to_string();
        let mut seen = HashSet::new();
        loop {
            // Be conservative on case-insensitive ref storage (macOS/Windows).
            if current.eq_ignore_ascii_case(refname) {
                return Err("Codex ref is used by a worktree HEAD; cleanup is blocked".to_string());
            }
            if !seen.insert(current.clone()) || seen.len() > 32 {
                return Err("Cannot safely resolve worktree HEAD symbolic chain".to_string());
            }
            let output = Command::new("git")
                .arg("--git-dir")
                .arg(&git_dir)
                .args(["symbolic-ref", "--quiet", "--no-recurse", &current])
                .output()
                .map_err(|error| format!("Cannot inspect worktree HEAD: {error}"))?;
            match output.status.code() {
                // A detached HEAD or the direct ref at the end of the chain.
                Some(1) => break,
                Some(0) => {
                    current = String::from_utf8(output.stdout)
                        .map_err(|_| "Invalid worktree HEAD reference encoding".to_string())?
                        .trim()
                        .to_string();
                    if current.is_empty() {
                        return Err("Cannot resolve worktree HEAD reference".to_string());
                    }
                }
                _ => return Err(super::command_error("git symbolic-ref", &output.stderr)),
            }
        }
    }
    Ok(guard)
}

pub(super) fn has_git_lock(git_dir: &Path) -> bool {
    WalkDir::new(git_dir)
        .follow_links(false)
        .max_depth(5)
        .into_iter()
        .flatten()
        .any(|entry| {
            let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
            name.ends_with(".lock")
        })
}

/// Detect an active Git process that references this repository. Git's lock
/// files cover many writers, but reads, fsck, and GC can still be active
/// without one. The result is cached briefly because a scan can inspect many
/// refs in one repository.
pub(super) fn git_process_running(repository: &Repository) -> bool {
    let key = repository.git_dir.to_string_lossy().into_owned();
    let cache = GIT_PROCESS_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(entries) = cache.lock() {
        if let Some((checked_at, active)) = entries.get(&key) {
            if checked_at.elapsed().as_millis() < GIT_PROCESS_CACHE_TTL_MS {
                return *active;
            }
        }
    }
    let active = detect_git_process(repository);
    if let Ok(mut entries) = cache.lock() {
        entries.insert(key, (Instant::now(), active));
    }
    active
}

/// Recheck immediately before a destructive Git operation. The preview cache
/// is useful for bounded scans, but execution must not rely on a result that
/// could already be stale by the time the confirmation is handled.
pub(super) fn git_process_running_fresh(repository: &Repository) -> bool {
    let active = detect_git_process(repository);
    let key = repository.git_dir.to_string_lossy().into_owned();
    let cache = GIT_PROCESS_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(mut entries) = cache.lock() {
        entries.insert(key, (Instant::now(), active));
    }
    active
}

#[cfg(unix)]
fn detect_git_process(repository: &Repository) -> bool {
    let Ok(output) = Command::new("ps").args(["-axo", "pid=,command="]).output() else {
        return false;
    };
    let git_dir = repository.git_dir.to_string_lossy();
    let root = repository.root.to_string_lossy();
    let own_pid = std::process::id().to_string();
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            let (pid, command) = trimmed.split_once(char::is_whitespace)?;
            (pid.trim() != own_pid).then_some(command.trim())
        })
        .any(|command| {
            let executable = command.split_whitespace().next().unwrap_or_default();
            let name = Path::new(executable)
                .file_name()
                .map(|value| value.to_string_lossy().to_ascii_lowercase())
                .unwrap_or_default();
            let is_git = name == "git" || name == "git.exe" || name.starts_with("git-");
            is_git && (command.contains(git_dir.as_ref()) || command.contains(root.as_ref()))
        })
}

#[cfg(windows)]
fn detect_git_process(_repository: &Repository) -> bool {
    // `tasklist` does not expose command arguments. Treat any running git.exe
    // as active so a repository cannot be pruned while another Git operation
    // is in progress; this is conservative but safe.
    Command::new("tasklist")
        .args(["/FI", "IMAGENAME eq git.exe", "/NH"])
        .output()
        .map(|output| {
            output.status.success()
                && String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .any(|line| line.to_ascii_lowercase().contains("git.exe"))
        })
        .unwrap_or(false)
}

#[cfg(not(any(unix, windows)))]
fn detect_git_process(_repository: &Repository) -> bool {
    false
}

pub(super) fn modified_at(metadata: &fs::Metadata) -> Option<i64> {
    metadata
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_secs() as i64)
}

pub(super) fn old_enough(modified_at: i64, policy: &AgentCleanupPolicy, now: i64) -> bool {
    now.saturating_sub(modified_at) >= retention_seconds(policy.min_age_days)
}

fn retention_seconds(days: u64) -> i64 {
    days.saturating_mul(86_400).min(i64::MAX as u64) as i64
}

/// Git's date parser accepts `@<unix-seconds>`. Passing an explicit cutoff,
/// instead of `now`, preserves the configured retention window for both
/// reflog expiry and object pruning.
pub(super) fn git_expiration_arg(policy: &AgentCleanupPolicy, now: i64) -> String {
    format!(
        "@{}",
        now.saturating_sub(retention_seconds(policy.min_age_days))
    )
}
