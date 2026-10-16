use super::{
    adapters::{adapter_specs, agent_summaries, category_enabled, root_path},
    git,
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

const MAX_ITEM_ENTRIES: usize = 100_000;
const PROCESS_CACHE_TTL_SECS: u64 = 2;
static PROCESS_CACHE: OnceLock<Mutex<HashMap<String, (std::time::Instant, bool)>>> =
    OnceLock::new();

pub(super) fn scan(home: &Path, policy: AgentCleanupPolicy, now: i64) -> AgentCleanupPreview {
    let specs = adapter_specs();
    let mut items = Vec::new();
    for spec in specs {
        let root = root_path(home, spec);
        if fs::symlink_metadata(&root)
            .map(|metadata| metadata.file_type().is_symlink())
            .unwrap_or(false)
        {
            continue;
        }
        if spec.scan_self {
            if root.exists() {
                if let Some(item) = inspect_item(&root, spec, &policy, now) {
                    items.push(item);
                }
            }
            continue;
        }
        if !root.is_dir() {
            continue;
        }
        let Ok(entries) = fs::read_dir(&root) else {
            continue;
        };
        for entry in entries.flatten().take(MAX_ITEM_ENTRIES) {
            let path = entry.path();
            if entry
                .file_type()
                .map(|kind| kind.is_symlink())
                .unwrap_or(true)
            {
                continue;
            }
            if let Some(item) = inspect_item(&path, spec, &policy, now) {
                items.push(item);
            }
        }
    }
    items.extend(git::scan(home, &policy, now));
    let mut agents = agent_summaries(specs, home);
    git::augment_agent_summaries(&mut agents, home);
    build_preview(policy, agents, items, now)
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
    let (size, entry_count) = item_size(path);
    let mut protected = false;
    let mut reason = String::new();
    let age_ok =
        now.saturating_sub(modified_at) >= policy.min_age_days.saturating_mul(86_400) as i64;
    if protected_artifact_name(path) || contains_protected_descendant(path) {
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
        agent.total_size = size;
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
        total_size_bytes: items.iter().map(|item| item.size).sum(),
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

pub(super) fn refresh_process_cache() {
    if let Some(cache) = PROCESS_CACHE.get() {
        if let Ok(mut entries) = cache.lock() {
            entries.clear();
        }
    }
}

fn item_size(path: &Path) -> (u64, u64) {
    let mut size: u64 = 0;
    let mut count: u64 = 0;
    for entry in WalkDir::new(path)
        .follow_links(false)
        .max_depth(8)
        .into_iter()
        .flatten()
        .take(MAX_ITEM_ENTRIES)
    {
        if entry.file_type().is_symlink() {
            continue;
        }
        count += 1;
        if let Ok(metadata) = entry.metadata() {
            size = size.saturating_add(metadata.len());
        }
    }
    (size, count)
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
mod tests {
    use super::{build_preview, contains_protected_descendant, protected_artifact_name, scan};
    use crate::stowmind_supplements::agent_cleanup::types::AgentCleanupPolicy;
    use std::fs;

    #[test]
    fn sensitive_application_state_is_protected_by_name() {
        assert!(protected_artifact_name(std::path::Path::new("Cookies")));
        assert!(protected_artifact_name(std::path::Path::new(
            "session.json"
        )));
        assert!(!protected_artifact_name(std::path::Path::new("old-cache")));
    }

    #[test]
    fn nested_sensitive_state_protects_the_whole_candidate() {
        let root = std::env::temp_dir().join("stowmind-agent-sensitive-test");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("nested/IndexedDB")).unwrap();
        assert!(contains_protected_descendant(&root));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn scan_uses_leaf_roots_and_reports_missing_agents() {
        let home = std::env::temp_dir().join("stowmind-agent-scan-test");
        let _ = fs::remove_dir_all(&home);
        fs::create_dir_all(home.join(".codex/cache/old")).unwrap();
        fs::write(home.join(".codex/cache/old/payload"), "x").unwrap();
        fs::create_dir_all(home.join("Library/Application Support/Codex/Crashpad/pending"))
            .unwrap();
        fs::write(
            home.join("Library/Application Support/Codex/Crashpad/pending/report.dmp"),
            "x",
        )
        .unwrap();
        fs::create_dir_all(home.join(".continue/index")).unwrap();
        fs::write(home.join(".continue/index/index.sqlite"), "x").unwrap();
        fs::create_dir_all(home.join(".copilot/logs")).unwrap();
        fs::write(home.join(".copilot/logs/process.log"), "x").unwrap();
        fs::create_dir_all(home.join(".gemini/antigravity-cli/log")).unwrap();
        fs::write(home.join(".gemini/antigravity-cli/log/cli.log"), "x").unwrap();
        fs::create_dir_all(home.join(".cline/data/logs")).unwrap();
        fs::write(home.join(".cline/data/logs/cline.log"), "x").unwrap();
        fs::create_dir_all(home.join(".local/state/goose/logs")).unwrap();
        fs::write(home.join(".local/state/goose/logs/cli.log"), "x").unwrap();
        let preview = scan(
            &home,
            AgentCleanupPolicy {
                min_age_days: 0,
                ..Default::default()
            },
            super::epoch_now(),
        );
        assert!(preview
            .agents
            .iter()
            .any(|agent| agent.id == "codex" && agent.available));
        for agent_id in [
            "opencode",
            "kiro",
            "devin",
            "windsurf",
            "gemini",
            "antigravity",
            "continue",
            "copilot",
            "amazon_q",
            "cline",
            "goose",
        ] {
            assert!(preview.agents.iter().any(|agent| agent.id == agent_id));
        }
        for agent_id in ["continue", "copilot", "gemini", "cline", "goose"] {
            assert!(preview
                .agents
                .iter()
                .any(|agent| agent.id == agent_id && agent.available));
        }
        assert!(preview.items.iter().any(|item| item.category == "cache"));
        assert!(preview.items.iter().any(|item| {
            item.category == "temporary" && item.path.ends_with("Crashpad/pending")
        }));
        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn empty_preview_has_no_protected_items() {
        let preview = build_preview(AgentCleanupPolicy::default(), Vec::new(), Vec::new(), 1);
        assert!(preview.protected.is_empty());
    }
}
