//! Agent Cleanup supplement.  The implementation is split into adapters,
//! scanning and worktree safety so each policy surface stays reviewable.

mod adapters;
mod scanner;
mod types;
mod worktree;

use crate::stowmind_supplements::safe_trash;
use scanner::{epoch_now, home_dir, inspect_item, refresh_process_cache, scan};
use std::path::PathBuf;
use types::{
    AgentCleanupAction, AgentCleanupExecuteRequest, AgentCleanupPolicy, AgentCleanupResult,
    MAX_EXECUTE_ITEMS,
};

#[tauri::command]
pub async fn agent_cleanup_scan(
    retention_days: Option<u64>,
) -> Result<types::AgentCleanupPreview, String> {
    let retention_days = retention_days.unwrap_or(7).min(types::MAX_MIN_AGE_DAYS);
    tokio::task::spawn_blocking(move || {
        let home = home_dir().ok_or_else(|| "Home directory is unavailable".to_string())?;
        Ok(scan(
            &home,
            AgentCleanupPolicy {
                min_age_days: retention_days,
                ..Default::default()
            }
            .normalized(),
            epoch_now(),
        ))
    })
    .await
    .map_err(|error| format!("Failed to join Agent Cleanup scan: {error}"))?
}

#[tauri::command]
pub async fn agent_cleanup_execute(
    request: AgentCleanupExecuteRequest,
) -> Result<AgentCleanupResult, String> {
    tokio::task::spawn_blocking(move || execute(request))
        .await
        .map_err(|error| format!("Failed to join Agent Cleanup execution: {error}"))?
}

fn execute(request: AgentCleanupExecuteRequest) -> Result<AgentCleanupResult, String> {
    if !request.confirmed {
        return Err("Agent Cleanup requires explicit confirmation".to_string());
    }
    if request.item_ids.is_empty() {
        return Err("At least one Agent Cleanup item is required".to_string());
    }
    if request.item_ids.len() > MAX_EXECUTE_ITEMS {
        return Err(format!(
            "Agent Cleanup is limited to {MAX_EXECUTE_ITEMS} items per run"
        ));
    }
    let home = home_dir().ok_or_else(|| "Home directory is unavailable".to_string())?;
    let policy = AgentCleanupPolicy {
        min_age_days: request.retention_days.min(types::MAX_MIN_AGE_DAYS),
        ..Default::default()
    }
    .normalized();
    refresh_process_cache();
    let now = epoch_now();
    let mut actions = Vec::with_capacity(request.item_ids.len());
    let mut freed_bytes: u64 = 0;

    for item_id in request.item_ids {
        let path = PathBuf::from(item_id.trim());
        let path_text = path.to_string_lossy().to_string();
        let Some(spec) = adapters::adapter_specs()
            .iter()
            .find(|spec| worktree::is_direct_child(&path, &home, spec))
        else {
            actions.push(skipped(
                path_text,
                "Path is outside the Agent Cleanup allow-list",
            ));
            continue;
        };
        let Some(item) = inspect_item(&path, spec, &policy, now) else {
            actions.push(skipped(
                path_text,
                "Path is unavailable or no longer eligible",
            ));
            continue;
        };
        if !item.eligible {
            actions.push(skipped_with_size(item.path, item.size, item.reason));
            continue;
        }
        match safe_trash::move_path_to_trash(&path) {
            Ok(_) => {
                freed_bytes = freed_bytes.saturating_add(item.size);
                actions.push(AgentCleanupAction {
                    path: item.path,
                    size_bytes: item.size,
                    success: true,
                    message: "Moved to system trash".to_string(),
                });
            }
            Err(error) => actions.push(skipped_with_size(item.path, item.size, error)),
        }
    }
    let removed_count = actions.iter().filter(|action| action.success).count() as u64;
    let skipped_count = actions.len() as u64 - removed_count;
    let errors = actions
        .iter()
        .filter(|action| !action.success)
        .map(|action| format!("{}: {}", action.path, action.message))
        .collect();
    Ok(AgentCleanupResult {
        source: "stowmind_supplement".to_string(),
        removed_count,
        freed_bytes,
        skipped_count,
        errors,
        completed_at: Some(epoch_now().to_string()),
        actions,
    })
}

fn skipped(path: String, message: &str) -> AgentCleanupAction {
    skipped_with_size(path, 0, message.to_string())
}

fn skipped_with_size(path: String, size_bytes: u64, message: String) -> AgentCleanupAction {
    AgentCleanupAction {
        path,
        size_bytes,
        success: false,
        message,
    }
}

#[cfg(test)]
mod tests {
    use super::{execute, AgentCleanupExecuteRequest};

    #[test]
    fn execution_requires_confirmation() {
        let error = execute(AgentCleanupExecuteRequest {
            item_ids: vec!["/tmp/nope".to_string()],
            retention_days: 7,
            confirmed: false,
        })
        .unwrap_err();
        assert!(error.contains("confirmation"));
    }

    #[test]
    fn execution_rejects_empty_selection() {
        let error = execute(AgentCleanupExecuteRequest {
            item_ids: Vec::new(),
            retention_days: 7,
            confirmed: true,
        })
        .unwrap_err();
        assert!(error.contains("item"));
    }

    #[test]
    fn execute_request_accepts_frontend_camel_case_fields() {
        let request: AgentCleanupExecuteRequest = serde_json::from_value(serde_json::json!({
            "itemIds": ["/tmp/cache"],
            "retentionDays": 30,
            "confirmed": true
        }))
        .unwrap();

        assert_eq!(request.item_ids, vec!["/tmp/cache"]);
        assert_eq!(request.retention_days, 30);
        assert!(request.confirmed);
    }
}
