use super::super::types::AgentCleanupPolicy;
use super::{
    command_error, directory_size, inspect_ref, parse_prune_item_id, parse_ref_item_id, run_git,
    scan_unreachable_objects, validate_repository, PRUNE_ITEM_PREFIX, REF_ITEM_PREFIX,
};
use std::{path::Path, process::Command};

pub fn is_git_item_id(id: &str) -> bool {
    id.starts_with(REF_ITEM_PREFIX) || id.starts_with(PRUNE_ITEM_PREFIX)
}

pub fn execute_item(
    id: &str,
    home: &Path,
    policy: &AgentCleanupPolicy,
    now: i64,
) -> Result<(String, u64, String), String> {
    if id.starts_with(REF_ITEM_PREFIX) {
        execute_ref(id, home, policy, now)
    } else if id.starts_with(PRUNE_ITEM_PREFIX) {
        execute_prune(id, home, policy, now)
    } else {
        Err("Unknown Git cleanup item".to_string())
    }
}

fn execute_ref(
    id: &str,
    home: &Path,
    policy: &AgentCleanupPolicy,
    now: i64,
) -> Result<(String, u64, String), String> {
    let payload = parse_ref_item_id(id)?;
    let repository = validate_repository(home, Path::new(&payload.git_dir))?;
    let Some(item) = inspect_ref(&repository, &payload.refname, policy, now) else {
        return Err("Codex internal ref no longer exists".to_string());
    };
    if !item.eligible {
        return Err(item.reason);
    }
    let output = Command::new("git")
        .args([
            "--git-dir",
            repository.git_dir.to_str().unwrap_or_default(),
            "update-ref",
            "-d",
            &payload.refname,
        ])
        .output()
        .map_err(|error| format!("Failed to remove Git ref: {error}"))?;
    if !output.status.success() {
        return Err(command_error("git update-ref", &output.stderr));
    }
    Ok((
        item.path,
        item.size,
        "Removed Codex internal Git ref".to_string(),
    ))
}

fn execute_prune(
    id: &str,
    home: &Path,
    policy: &AgentCleanupPolicy,
    now: i64,
) -> Result<(String, u64, String), String> {
    let payload = parse_prune_item_id(id)?;
    let repository = validate_repository(home, Path::new(&payload.git_dir))?;
    let Some(item) = scan_unreachable_objects(&repository, policy, now) else {
        return Err("No unreachable Git objects remain".to_string());
    };
    if !item.eligible {
        return Err(item.reason);
    }
    let before = directory_size(&repository.git_dir.join("objects"));
    run_git(
        &repository.git_dir,
        &[
            "reflog",
            "expire",
            "--all",
            "--expire=now",
            "--expire-unreachable=now",
        ],
    )?;
    run_git(&repository.git_dir, &["gc", "--prune=now", "--quiet"])?;
    let after = directory_size(&repository.git_dir.join("objects"));
    Ok((
        item.path,
        before.saturating_sub(after),
        "Expired reflogs and pruned unreachable Git objects".to_string(),
    ))
}
