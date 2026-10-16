use super::{
    build_preview, contains_protected_descendant, epoch_now, inspect_item, protected_artifact_name,
    scan, scan_limit_marker, MAX_ITEM_ENTRIES,
};
use crate::stowmind_supplements::agent_cleanup::types::{
    AgentCleanupPolicy, AgentRootSpec, CleanupCategory,
};
use std::{fs, path::Path, process::Command};

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
    fs::create_dir_all(home.join("Library/Application Support/Codex/Crashpad/pending")).unwrap();
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
        item.category == "temporary" && item.path.ends_with("Crashpad/pending/report.dmp")
    }));
    let _ = fs::remove_dir_all(home);
}

#[cfg(unix)]
fn set_old_mtime(path: &Path) {
    let status = Command::new("touch")
        .args(["-t", "202001010000", path.to_string_lossy().as_ref()])
        .status()
        .expect("touch is available on Unix test hosts");
    assert!(status.success());
}

#[cfg(unix)]
#[test]
fn crashpad_entries_use_each_file_age_when_directory_contains_new_and_old_dumps() {
    let root = std::env::temp_dir().join("stowmind-crashpad-mixed-test");
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).unwrap();
    let old = root.join("old.dmp");
    let fresh = root.join("fresh.dmp");
    fs::write(&old, "old").unwrap();
    set_old_mtime(&old);
    fs::write(&fresh, "fresh").unwrap();

    let spec = AgentRootSpec {
        agent_id: "test-agent",
        category: CleanupCategory::Temporary,
        relative_path: "Crashpad/pending",
        scan_self: false,
    };
    let policy = AgentCleanupPolicy {
        min_age_days: 1,
        ..Default::default()
    };
    let now = epoch_now();
    let old_item = inspect_item(&old, &spec, &policy, now).unwrap();
    let fresh_item = inspect_item(&fresh, &spec, &policy, now).unwrap();
    assert!(
        old_item.eligible,
        "old dump should be eligible independently"
    );
    assert!(fresh_item.protected, "fresh dump must remain protected");
    assert_ne!(old_item.modified_at, fresh_item.modified_at);
    assert!(!old_item.path.ends_with("Crashpad/pending"));
    assert!(!fresh_item.path.ends_with("Crashpad/pending"));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn over_limit_scan_marker_is_protected_and_not_selectable() {
    let spec = AgentRootSpec {
        agent_id: "codex",
        category: CleanupCategory::Temporary,
        relative_path: "Crashpad/pending",
        scan_self: false,
    };
    let marker = scan_limit_marker(
        Path::new("/tmp/Codex/Crashpad/pending"),
        &spec,
        MAX_ITEM_ENTRIES as u64,
    );
    assert!(marker.protected);
    assert!(!marker.eligible);
    assert!(!marker.default_selected);
    assert!(marker.id.starts_with("scan-limit:"));
    assert!(marker.reason.contains("remaining files are protected"));
}

#[test]
fn empty_preview_has_no_protected_items() {
    let preview = build_preview(AgentCleanupPolicy::default(), Vec::new(), Vec::new(), 1);
    assert!(preview.protected.is_empty());
}
