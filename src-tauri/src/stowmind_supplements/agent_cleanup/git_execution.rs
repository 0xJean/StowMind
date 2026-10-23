use super::super::types::AgentCleanupPolicy;
use super::{
    command_error, inspect_ref, parse_prune_item_id, parse_ref_item_id, run_git,
    scan_unreachable_objects, validate_repository, PRUNE_ITEM_PREFIX, REF_ITEM_PREFIX,
};
use super::{objects, safety};
use std::{path::Path, process::Command};

pub fn is_git_item_id(id: &str) -> bool {
    id.starts_with(REF_ITEM_PREFIX) || id.starts_with(PRUNE_ITEM_PREFIX)
}

pub fn execute_item(
    id: &str,
    home: &Path,
    policy: &AgentCleanupPolicy,
    now: i64,
) -> Result<(String, Option<u64>, String), String> {
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
) -> Result<(String, Option<u64>, String), String> {
    let payload = parse_ref_item_id(id)?;
    let repository = validate_repository(home, Path::new(&payload.git_dir))?;
    let Some(item) = inspect_ref(
        &repository,
        &payload.refname,
        policy,
        now,
        safety::git_process_running_fresh(&repository),
    ) else {
        return Err("Codex internal ref no longer exists".to_string());
    };
    if !item.eligible {
        return Err(item.reason);
    }
    let Some(current_oid) = super::ref_oid(&repository, &payload.refname) else {
        return Err("Codex internal ref no longer exists".to_string());
    };
    if current_oid != payload.expected_oid {
        return Err("Codex internal ref changed since preview; scan again".to_string());
    }
    let output = Command::new("git")
        .args([
            "--git-dir",
            repository.git_dir.to_str().unwrap_or_default(),
            "update-ref",
            "-d",
            &payload.refname,
            &payload.expected_oid,
        ])
        .output()
        .map_err(|error| format!("Failed to remove Git ref: {error}"))?;
    if !output.status.success() {
        return Err(command_error("git update-ref", &output.stderr));
    }
    Ok((
        item.path,
        Some(item.size),
        "Removed Codex internal Git ref".to_string(),
    ))
}

fn execute_prune(
    id: &str,
    home: &Path,
    policy: &AgentCleanupPolicy,
    now: i64,
) -> Result<(String, Option<u64>, String), String> {
    let payload = parse_prune_item_id(id)?;
    let repository = validate_repository(home, Path::new(&payload.git_dir))?;
    let Some(item) = scan_unreachable_objects(
        &repository,
        policy,
        now,
        safety::git_process_running_fresh(&repository),
    ) else {
        return Err("No unreachable Git objects remain".to_string());
    };
    if !item.eligible {
        return Err(item.reason);
    }
    let before = objects::directory_size(&repository.git_dir.join("objects"))?;
    let expiration = safety::git_expiration_arg(policy, now);
    let expiration_unreachable = expiration.clone();
    run_git(
        &repository.git_dir,
        &[
            "reflog",
            "expire",
            "--all",
            &format!("--expire={expiration}"),
            &format!("--expire-unreachable={expiration_unreachable}"),
        ],
    )?;
    run_git(
        &repository.git_dir,
        &["gc", &format!("--prune={expiration}"), "--quiet"],
    )?;
    // Cleanup has already completed. Preserve that fact if the later size
    // measurement fails, rather than inviting a retry of the destructive step.
    let (size, message) = match objects::directory_size(&repository.git_dir.join("objects")) {
        Ok(after) => (Some(before.saturating_sub(after)), "Expired reflogs and pruned unreachable Git objects".to_string()),
        Err(error) => (None, format!("Expired reflogs and pruned unreachable Git objects; processed size is unknown: {error}")),
    };
    Ok((item.path, size, message))
}
