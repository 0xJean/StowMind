use super::{
    adapters::{adapter_specs, agent_summaries, category_enabled, root_path},
    git,
    measurement::{measure_item, MAX_ITEM_ENTRIES},
    types::{
        AgentCleanupItem, AgentCleanupPolicy, AgentCleanupPreview, AgentCleanupProtected,
        AgentCleanupSummary, CleanupCategory,
    },
    worktree::{has_active_lock, is_orphaned_worktree},
};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};
use walkdir::WalkDir;

const PROCESS_CACHE_TTL_SECS: u64 = 2;
static PROCESS_CACHE: OnceLock<Mutex<HashMap<String, (std::time::Instant, bool)>>> =
    OnceLock::new();

pub(super) fn scan(home: &Path, policy: AgentCleanupPolicy, now: i64) -> AgentCleanupPreview {
    let specs = adapter_specs();
    let mut items = Vec::new();
    for spec in specs {
        let root = root_path(home, spec);
        let metadata = match fs::symlink_metadata(&root) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => {
                items.push(scan_error_marker(&root, spec, &error.to_string()));
                continue;
            }
        };
        if metadata.file_type().is_symlink() {
            continue;
        }
        if spec.scan_self {
            if let Some(item) = inspect_item(&root, spec, &policy, now) {
                items.push(item);
            } else {
                items.push(scan_error_marker(
                    &root,
                    spec,
                    "Metadata could not be inspected",
                ));
            }
            continue;
        }
        if !metadata.is_dir() {
            continue;
        }
        let entries = match fs::read_dir(&root) {
            Ok(entries) => entries,
            Err(error) => {
                items.push(scan_error_marker(&root, spec, &error.to_string()));
                continue;
            }
        };
        let mut root_items = Vec::new();
        let mut scanned_entries = 0usize;
        let mut truncated = false;
        let mut scan_error = None;
        for entry in entries {
            if scanned_entries >= MAX_ITEM_ENTRIES {
                // A large Crashpad directory can contain millions of dumps.
                // Stop at a hard bound and surface a protected marker instead
                // of presenting an incomplete scan as safe to clean.
                truncated = true;
                break;
            }
            scanned_entries += 1;
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) => {
                    scan_error = Some(error.to_string());
                    break;
                }
            };
            let path = entry.path();
            let kind = match entry.file_type() {
                Ok(kind) => kind,
                Err(error) => {
                    scan_error = Some(error.to_string());
                    break;
                }
            };
            if kind.is_symlink() {
                continue;
            }
            if let Some(item) = inspect_item(&path, spec, &policy, now) {
                root_items.push(item);
            } else {
                scan_error = Some("An entry changed or could not be inspected".to_string());
                break;
            }
        }
        if let Some(error) = scan_error {
            items.push(scan_error_marker(&root, spec, &error));
        } else if truncated {
            // Do not mix a partial list of executable entries with the
            // protected marker. A user must receive a complete preview before
            // any item from this root can be selected for cleanup.
            items.push(scan_limit_marker(&root, spec, scanned_entries as u64));
        } else {
            items.extend(root_items);
        }
    }
    items.extend(git::scan(home, &policy, now));
    let mut agents = agent_summaries(specs, home);
    git::augment_agent_summaries(&mut agents, home);
    build_preview(policy, agents, items, now)
}

fn scan_error_marker(
    root: &Path,
    spec: &super::types::AgentRootSpec,
    error: &str,
) -> AgentCleanupItem {
    let mut item = scan_limit_marker(root, spec, 0);
    item.id = format!("scan-error:{}", root.display());
    item.reason = format!("Scan incomplete; files remain protected: {error}");
    item
}

/// Build a non-selectable marker when an allow-listed directory exceeds the
/// bounded scan budget.  The marker is intentionally not executable: deleting
/// the directory would defeat per-file retention checks for Crashpad dumps.
fn scan_limit_marker(
    root: &Path,
    spec: &super::types::AgentRootSpec,
    scanned_entries: u64,
) -> AgentCleanupItem {
    let path = root.to_string_lossy().to_string();
    let modified_at = fs::symlink_metadata(root)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default();
    AgentCleanupItem {
        id: format!("scan-limit:{path}"),
        agent: spec.agent_id.to_string(),
        category: spec.category.as_str().to_string(),
        path,
        size: 0,
        size_status: "unavailable".to_string(),
        entry_count: scanned_entries,
        modified_at,
        eligible: false,
        default_selected: false,
        protected: true,
        reason: format!(
            "Scan stopped after {MAX_ITEM_ENTRIES} entries; remaining files are protected and require manual inspection"
        ),
    }
}

pub(super) fn inspect_item(
    path: &Path,
    spec: &super::types::AgentRootSpec,
    policy: &AgentCleanupPolicy,
    now: i64,
) -> Option<AgentCleanupItem> {
    let metadata = fs::symlink_metadata(path).ok()?;
    if metadata.file_type().is_symlink() {
        return None;
    }
    let modified_at = metadata
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_secs() as i64;
    let measurement = measure_item(path);
    let size = measurement.bytes;
    let entry_count = measurement.entries;
    let mut protected = false;
    let mut reason = String::new();
    let age_ok =
        now.saturating_sub(modified_at) >= policy.min_age_days.saturating_mul(86_400) as i64;
    if !measurement.complete {
        protected = true;
        reason = "Size measurement is incomplete; scan limits or unreadable entries require manual inspection".to_string();
    } else if protected_artifact_name(path) || contains_protected_descendant(path) {
        protected = true;
        reason = "Protected application state or credentials".to_string();
    } else if !age_ok {
        protected = true;
        reason = format!(
            "Retained because it is newer than {} days",
            policy.min_age_days
        );
    } else if agent_process_running(spec.agent_id) {
        protected = true;
        reason = "Agent process is active; runtime state is protected".to_string();
    } else if has_active_lock(path) {
        protected = true;
        reason = "Active lock or process state is protected".to_string();
    } else if spec.category == CleanupCategory::Worktrees && !is_orphaned_worktree(path) {
        protected = true;
        reason = "Active or registered Git worktree is protected".to_string();
    } else if !category_enabled(spec.category, policy) {
        protected = true;
        reason = "Retained by the category policy".to_string();
    }
    if reason.is_empty() {
        reason = if entry_count >= MAX_ITEM_ENTRIES as u64 {
            format!(
                "Eligible large artifact; inspected at least {MAX_ITEM_ENTRIES} entries; reported size is a lower bound"
            )
        } else {
            "Eligible cache/log/temp artifact".to_string()
        };
    }
    let path_text = path.to_string_lossy().to_string();
    Some(AgentCleanupItem {
        id: path_text.clone(),
        agent: spec.agent_id.to_string(),
        category: spec.category.as_str().to_string(),
        path: path_text,
        size,
        size_status: if measurement.complete {
            "complete"
        } else {
            "partial"
        }
        .to_string(),
        entry_count,
        modified_at,
        eligible: !protected,
        default_selected: !protected,
        protected,
        reason,
    })
}

pub(super) fn build_preview(
    policy: AgentCleanupPolicy,
    mut agents: Vec<super::types::AgentCleanupAgent>,
    items: Vec<AgentCleanupItem>,
    scanned_at: i64,
) -> AgentCleanupPreview {
    for agent in &mut agents {
        let belonging = items.iter().filter(|item| item.agent == agent.id);
        let (count, size) = belonging.fold((0_u64, 0_u64), |(count, size), item| {
            (count + 1, size.saturating_add(item.size))
        });
        agent.item_count = count;
        agent.total_size = items
            .iter()
            .filter(|item| item.agent == agent.id)
            .all(|item| item.size_status == "complete")
            .then_some(size);
    }
    let protected = items
        .iter()
        .filter(|item| item.protected)
        .map(|item| AgentCleanupProtected {
            path: item.path.clone(),
            agent: item.agent.clone(),
            reason: item.reason.clone(),
        })
        .collect::<Vec<_>>();
    let summary = AgentCleanupSummary {
        candidate_count: items.len() as u64,
        eligible_count: items.iter().filter(|item| item.eligible).count() as u64,
        protected_count: protected.len() as u64,
        total_size_bytes: items
            .iter()
            .all(|item| item.size_status == "complete")
            .then(|| items.iter().map(|item| item.size).sum()),
        reclaimable_size_bytes: items
            .iter()
            .filter(|item| item.eligible)
            .map(|item| item.size)
            .sum(),
    };
    AgentCleanupPreview {
        source: "stowmind_supplement".to_string(),
        scanned_at,
        retention_days: policy.min_age_days,
        agents,
        items,
        protected,
        summary,
    }
}

fn protected_artifact_name(path: &Path) -> bool {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    matches!(
        name.as_str(),
        "cookies"
            | "login data"
            | "local state"
            | "indexeddb"
            | "partitions"
            | "workspaces"
            | "credentials"
            | "credentials.json"
            | "config.json"
            | "settings.json"
            | "auth"
            | "auth.json"
            | "token"
            | "token.json"
            | ".env"
            | "oauth"
            | "generated_images"
            | "daemon.log"
    ) || name.contains("session")
        || name.contains("credential")
}

fn contains_protected_descendant(path: &Path) -> bool {
    if !path.is_dir() {
        return false;
    }
    WalkDir::new(path)
        .follow_links(false)
        .max_depth(8)
        .into_iter()
        .flatten()
        .take(MAX_ITEM_ENTRIES)
        .skip(1)
        .any(|entry| !entry.file_type().is_symlink() && protected_artifact_name(entry.path()))
}

pub(super) fn agent_process_running(agent_id: &str) -> bool {
    let cache = PROCESS_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(entries) = cache.lock() {
        if let Some((checked_at, active)) = entries.get(agent_id) {
            if checked_at.elapsed().as_secs() < PROCESS_CACHE_TTL_SECS {
                return *active;
            }
        }
    }
    let (_process_name, process_pattern) = match agent_id {
        "codex" => ("codex", "(^|/|[[:space:]])codex([._[:space:]/-]|$)"),
        "opencode" => ("opencode", "(^|/|[[:space:]])opencode([._[:space:]/-]|$)"),
        "claude_code" => ("claude", "(^|/|[[:space:]])claude([._[:space:]/-]|$)"),
        "kiro" => ("kiro", "(^|/|[[:space:]])kiro([._[:space:]/-]|$)"),
        "devin" => ("devin", "(^|/|[[:space:]])devin([._[:space:]/-]|$)"),
        "cursor" => ("cursor", "(^|/|[[:space:]])cursor([._[:space:]/-]|$)"),
        "windsurf" => ("windsurf", "(^|/|[[:space:]])windsurf([._[:space:]/-]|$)"),
        "gemini" => ("gemini", "(^|/|[[:space:]])(gemini|agy)([._[:space:]/-]|$)"),
        "antigravity" => (
            "antigravity",
            "(^|/|[[:space:]])antigravity([._[:space:]/-]|$)",
        ),
        "continue" => ("continue", "(^|/|[[:space:]])continue([._[:space:]/-]|$)"),
        "copilot" => (
            "copilot",
            "(^|/|[[:space:]])(copilot|github-copilot)([._[:space:]/-]|$)",
        ),
        "amazon_q" => ("q", "^q$"),
        "cline" => ("cline", "(^|/|[[:space:]])cline([._[:space:]/-]|$)"),
        "goose" => ("goose", "(^|/|[[:space:]])goose([._[:space:]/-]|$)"),
        _ => return false,
    };

    #[cfg(target_os = "windows")]
    let active = Command::new("tasklist")
        .args(["/FO", "CSV", "/NH"])
        .output()
        .map(|output| {
            let process_list = String::from_utf8_lossy(&output.stdout).to_ascii_lowercase();
            if agent_id == "amazon_q" {
                process_list.contains("amazon-q")
                    || process_list.contains("qchat")
                    || process_list.contains("q.exe")
            } else {
                process_list.contains(_process_name)
            }
        })
        .unwrap_or(false);

    #[cfg(not(target_os = "windows"))]
    let active = if agent_id == "amazon_q" {
        ["q", "qchat", "chat_cli"].into_iter().any(|name| {
            Command::new("pgrep")
                .args(["-ix", name])
                .output()
                .map(|output| output.status.success())
                .unwrap_or(false)
        })
    } else {
        Command::new("pgrep")
            .args(["-if", process_pattern])
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false)
    };
    if let Ok(mut entries) = cache.lock() {
        entries.insert(agent_id.to_string(), (std::time::Instant::now(), active));
    }
    active
}

/// Git metadata can be written by any coding Agent, not only Codex. Keep the
/// repository protected while one of the supported Agent processes is active.
pub(super) fn any_agent_process_running() -> bool {
    [
        "codex",
        "opencode",
        "claude_code",
        "kiro",
        "devin",
        "cursor",
        "windsurf",
        "gemini",
        "antigravity",
        "continue",
        "copilot",
        "amazon_q",
        "cline",
        "goose",
    ]
    .into_iter()
    .any(agent_process_running)
}

pub(super) fn refresh_process_cache() {
    if let Some(cache) = PROCESS_CACHE.get() {
        if let Ok(mut entries) = cache.lock() {
            entries.clear();
        }
    }
}

pub(super) fn epoch_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

pub(super) fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
}

#[cfg(test)]
#[path = "scanner_tests.rs"]
mod tests;
