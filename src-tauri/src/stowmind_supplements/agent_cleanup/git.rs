//! Git metadata cleanup for local coding-agent repositories.
//!
//! Codex turn-diff refs and unreachable objects are scanned only in the
//! current repository and directly configured Agent worktrees.

use super::{
    adapters::{adapter_specs, root_path},
    scanner::{agent_process_running, any_agent_process_running},
    types::{AgentCleanupAgent, AgentCleanupItem, AgentCleanupPolicy, CleanupCategory},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    process::Command,
};

#[path = "git_execution.rs"]
mod execution;
#[path = "git_objects.rs"]
mod objects;
#[path = "git_safety.rs"]
mod safety;
#[cfg(test)]
#[path = "git_tests.rs"]
mod tests;

pub(super) use execution::{execute_item, is_git_item_id};
use objects::{git_scan_error, object_stats, unreachable_object_ids};
use safety::{git_process_running, has_git_lock, modified_at, old_enough};

const INTERNAL_REF_PREFIX: &str = "refs/codex/turn-diffs/";
const REF_ITEM_PREFIX: &str = "git-ref:";
const PRUNE_ITEM_PREFIX: &str = "git-prune:";
const MAX_GIT_ITEMS: usize = 100_000;

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct Repository {
    root: PathBuf,
    git_dir: PathBuf,
}

#[derive(Debug, Deserialize, Serialize)]
struct RefItemPayload {
    git_dir: String,
    refname: String,
    /// Object id observed during the preview. Execution supplies this as the
    /// expected old value so a stale preview cannot delete a changed ref.
    expected_oid: String,
}

#[derive(Debug, Deserialize, Serialize)]
struct PruneItemPayload {
    git_dir: String,
}

pub(super) fn scan(home: &Path, policy: &AgentCleanupPolicy, now: i64) -> Vec<AgentCleanupItem> {
    repositories(home)
        .into_iter()
        .flat_map(|repository| scan_repository(&repository, policy, now))
        .collect()
}

pub(super) fn augment_agent_summaries(agents: &mut [AgentCleanupAgent], home: &Path) {
    let Some(codex) = agents.iter_mut().find(|agent| agent.id == "codex") else {
        return;
    };
    for repository in repositories(home) {
        let root = repository.git_dir.to_string_lossy().to_string();
        if !codex.roots.iter().any(|existing| existing == &root) {
            codex.roots.push(root);
        }
    }
    codex.available = !codex.roots.is_empty();
    codex.detected = codex.available;
}

fn scan_repository(
    repository: &Repository,
    policy: &AgentCleanupPolicy,
    now: i64,
) -> Vec<AgentCleanupItem> {
    // Process inspection is shared by all items in a repository. Running
    // `ps` once per ref would make large Codex ref histories unnecessarily
    // expensive to preview.
    let git_process_active = git_process_running(repository);
    let mut items = scan_codex_refs(repository, policy, now, git_process_active);
    if let Some(item) = scan_unreachable_objects(repository, policy, now, git_process_active) {
        items.push(item);
    }
    items
}

fn scan_codex_refs(
    repository: &Repository,
    policy: &AgentCleanupPolicy,
    now: i64,
    git_process_active: bool,
) -> Vec<AgentCleanupItem> {
    let output = git_output(
        &repository.git_dir,
        &["for-each-ref", "--format=%(refname)", INTERNAL_REF_PREFIX],
    );
    let output = match output {
        Ok(output) => output,
        Err(reason) => {
            return vec![git_scan_error(
                repository,
                CleanupCategory::CodexRefs,
                now,
                reason,
            )]
        }
    };
    output
        .lines()
        .take(MAX_GIT_ITEMS)
        .filter_map(|refname| {
            inspect_ref(repository, refname.trim(), policy, now, git_process_active)
        })
        .collect()
}

fn inspect_ref(
    repository: &Repository,
    refname: &str,
    policy: &AgentCleanupPolicy,
    now: i64,
    git_process_active: bool,
) -> Option<AgentCleanupItem> {
    if !is_allowed_ref(refname) {
        return None;
    }
    let expected_oid = ref_oid(repository, refname)?;
    let (size, modified_at) = ref_metadata(repository, refname, now);
    let age_ok = old_enough(modified_at, policy, now);
    let (eligible, reason) = if agent_process_running("codex") {
        (
            false,
            "Codex is active; internal refs are protected".to_string(),
        )
    } else if !age_ok {
        (
            false,
            format!(
                "Retained because it is newer than {} days",
                policy.min_age_days
            ),
        )
    } else if any_agent_process_running() {
        (
            false,
            "An Agent process is active; internal refs are protected".to_string(),
        )
    } else if git_process_active {
        (
            false,
            "A Git process is active for this repository; internal refs are protected".to_string(),
        )
    } else if has_git_lock(&repository.git_dir) {
        (
            false,
            "An active Git lock is present; repository state is protected".to_string(),
        )
    } else if !policy.include_git_metadata {
        (false, "Retained by the Git metadata policy".to_string())
    } else {
        (true, "Eligible Codex internal turn-diff ref".to_string())
    };
    let display = format!("{} ({refname})", repository.git_dir.display());
    Some(AgentCleanupItem {
        id: ref_item_id(&repository.git_dir, refname, &expected_oid),
        agent: "codex".to_string(),
        category: CleanupCategory::CodexRefs.as_str().to_string(),
        path: display,
        size,
        size_status: "complete".to_string(),
        entry_count: 1,
        modified_at,
        eligible,
        default_selected: eligible,
        protected: !eligible,
        reason,
    })
}

fn scan_unreachable_objects(
    repository: &Repository,
    policy: &AgentCleanupPolicy,
    now: i64,
    git_process_active: bool,
) -> Option<AgentCleanupItem> {
    let object_ids = match unreachable_object_ids(&repository.git_dir) {
        Ok(ids) => ids,
        Err(reason) => {
            return Some(git_scan_error(
                repository,
                CleanupCategory::GitUnreachable,
                now,
                reason,
            ))
        }
    };
    if object_ids.is_empty() {
        return None;
    }
    let truncated = object_ids.len() > MAX_GIT_ITEMS;
    let (object_count, object_bytes) = match object_stats(
        &repository.git_dir,
        &object_ids[..object_ids.len().min(MAX_GIT_ITEMS)],
    ) {
        Ok(stats) => stats,
        Err(reason) => {
            return Some(git_scan_error(
                repository,
                CleanupCategory::GitUnreachable,
                now,
                reason,
            ))
        }
    };
    let modified_at = object_store_modified_at(&repository.git_dir).unwrap_or(now);
    let age_ok = old_enough(modified_at, policy, now);
    let clean = repository_is_clean(repository);
    let (eligible, reason) = if agent_process_running("codex") {
        (
            false,
            "Codex is active; Git object cleanup is protected".to_string(),
        )
    } else if any_agent_process_running() {
        (
            false,
            "An Agent process is active; Git object cleanup is protected".to_string(),
        )
    } else if git_process_active {
        (
            false,
            "A Git process is active for this repository; object cleanup is protected".to_string(),
        )
    } else if has_git_lock(&repository.git_dir) {
        (
            false,
            "An active Git lock is present; object cleanup is protected".to_string(),
        )
    } else if !clean {
        (
            false,
            "The repository has tracked changes; object cleanup is protected".to_string(),
        )
    } else if !age_ok {
        (
            false,
            format!(
                "Retained because the object store is newer than {} days",
                policy.min_age_days
            ),
        )
    } else if truncated {
        (
            false,
            format!(
                "More than {MAX_GIT_ITEMS} unreachable objects found; manual Git inspection is required"
            ),
        )
    } else if !policy.include_git_metadata {
        (false, "Retained by the Git metadata policy".to_string())
    } else {
        (
            true,
            "Unreachable Git objects; explicit confirmation will expire reflogs and prune them"
                .to_string(),
        )
    };
    let count_label = if truncated {
        format!("at least {object_count}")
    } else {
        object_count.to_string()
    };
    Some(AgentCleanupItem {
        id: prune_item_id(&repository.git_dir),
        agent: "codex".to_string(),
        category: CleanupCategory::GitUnreachable.as_str().to_string(),
        path: format!(
            "{} ({count_label} unreachable Git object(s))",
            repository.git_dir.display()
        ),
        size: object_bytes,
        size_status: if truncated { "partial" } else { "complete" }.to_string(),
        entry_count: object_count,
        modified_at,
        eligible,
        // Git pruning is deliberately opt-in even when it is eligible.
        default_selected: false,
        protected: !eligible,
        reason,
    })
}

fn repositories(home: &Path) -> Vec<Repository> {
    let mut found = HashMap::new();
    if let Ok(current) = std::env::current_dir() {
        if let Some(repository) = repository_for_path(&current) {
            found.insert(repository.git_dir.clone(), repository);
        }
    }
    for spec in adapter_specs()
        .iter()
        .filter(|spec| spec.category == CleanupCategory::Worktrees)
    {
        let root = root_path(home, spec);
        let Ok(entries) = fs::read_dir(root) else {
            continue;
        };
        for entry in entries.flatten() {
            if entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
                if let Some(repository) = repository_for_path(&entry.path()) {
                    found.insert(repository.git_dir.clone(), repository);
                }
            }
        }
    }
    found.into_values().collect()
}

fn repository_for_path(path: &Path) -> Option<Repository> {
    let root = git_output_from_path(path, &["rev-parse", "--show-toplevel"])?;
    let common = git_output_from_path(path, &["rev-parse", "--git-common-dir"])?;
    let root = fs::canonicalize(root.trim()).ok()?;
    let common_path = PathBuf::from(common.trim());
    let git_dir = fs::canonicalize(if common_path.is_absolute() {
        common_path
    } else {
        path.join(common_path)
    })
    .ok()?;
    Some(Repository { root, git_dir })
}

fn validate_repository(home: &Path, candidate: &Path) -> Result<Repository, String> {
    let candidate =
        fs::canonicalize(candidate).map_err(|_| "Git directory is unavailable".to_string())?;
    repositories(home)
        .into_iter()
        .find(|repository| repository.git_dir == candidate)
        .ok_or_else(|| "Git directory is outside the Agent Cleanup allow-list".to_string())
}

fn git_output(git_dir: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .arg("--git-dir")
        .arg(git_dir)
        .args(args)
        .output()
        .map_err(|error| format!("Failed to run Git: {error}"))?;
    if !output.status.success() {
        return Err(command_error("git", &output.stderr));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn git_output_from_path(path: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(args)
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).into_owned())
}

fn run_git(git_dir: &Path, args: &[&str]) -> Result<(), String> {
    let output = Command::new("git")
        .arg("--git-dir")
        .arg(git_dir)
        .args(args)
        .output()
        .map_err(|error| format!("Failed to run Git: {error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(command_error("git", &output.stderr))
    }
}

fn command_error(command: &str, stderr: &[u8]) -> String {
    let detail = String::from_utf8_lossy(stderr).trim().to_string();
    if detail.is_empty() {
        format!("{command} failed")
    } else {
        format!("{command} failed: {detail}")
    }
}

fn ref_metadata(repository: &Repository, refname: &str, fallback: i64) -> (u64, i64) {
    let loose = repository.git_dir.join(refname);
    let path = if loose.is_file() {
        loose
    } else {
        repository.git_dir.join("packed-refs")
    };
    fs::symlink_metadata(path)
        .ok()
        .and_then(|metadata| modified_at(&metadata).map(|modified| (metadata.len(), modified)))
        .unwrap_or((0, fallback))
}

fn ref_oid(repository: &Repository, refname: &str) -> Option<String> {
    let oid = git_output(&repository.git_dir, &["rev-parse", "--verify", refname])
        .ok()?
        .trim()
        .to_string();
    is_valid_object_id(&oid).then_some(oid)
}

fn is_valid_object_id(value: &str) -> bool {
    (40..=128).contains(&value.len())
        && value.len() % 2 == 0
        && value.chars().all(|character| character.is_ascii_hexdigit())
}

fn repository_is_clean(repository: &Repository) -> bool {
    git_output_from_path(
        &repository.root,
        &["status", "--porcelain=v1", "--untracked-files=no"],
    )
    .map(|output| output.trim().is_empty())
    .unwrap_or(false)
}

fn object_store_modified_at(git_dir: &Path) -> Option<i64> {
    modified_at(&fs::symlink_metadata(git_dir.join("objects")).ok()?)
}

fn ref_item_id(git_dir: &Path, refname: &str, expected_oid: &str) -> String {
    format!(
        "{REF_ITEM_PREFIX}{}",
        serde_json::to_string(&RefItemPayload {
            git_dir: git_dir.to_string_lossy().into_owned(),
            refname: refname.to_string(),
            expected_oid: expected_oid.to_string(),
        })
        .unwrap_or_default()
    )
}

fn prune_item_id(git_dir: &Path) -> String {
    format!(
        "{PRUNE_ITEM_PREFIX}{}",
        serde_json::to_string(&PruneItemPayload {
            git_dir: git_dir.to_string_lossy().into_owned(),
        })
        .unwrap_or_default()
    )
}

fn parse_ref_item_id(id: &str) -> Result<RefItemPayload, String> {
    serde_json::from_str(id.strip_prefix(REF_ITEM_PREFIX).unwrap_or_default())
        .map_err(|_| "Invalid Codex ref item id".to_string())
}

fn parse_prune_item_id(id: &str) -> Result<PruneItemPayload, String> {
    serde_json::from_str(id.strip_prefix(PRUNE_ITEM_PREFIX).unwrap_or_default())
        .map_err(|_| "Invalid Git prune item id".to_string())
}

fn is_allowed_ref(refname: &str) -> bool {
    refname.starts_with(INTERNAL_REF_PREFIX)
        && !refname.contains("..")
        && !refname.contains('\0')
        && !refname.ends_with('/')
}
