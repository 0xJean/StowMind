use super::{
    adapter_roots::ADAPTER_ROOTS,
    types::{AgentCleanupAgent, AgentRootSpec, CleanupCategory},
};
use std::path::{Path, PathBuf};

pub(super) fn adapter_specs() -> &'static [AgentRootSpec] {
    ADAPTER_ROOTS
}

pub(super) fn root_path(home: &Path, spec: &AgentRootSpec) -> PathBuf {
    match spec.relative_path {
        "$TMPDIR/kiro-log" => std::env::temp_dir().join("kiro-log"),
        "$TMPDIR/qlog" => std::env::temp_dir().join("qlog"),
        relative_path => home.join(relative_path),
    }
}

pub(super) fn agent_summaries(specs: &[AgentRootSpec], home: &Path) -> Vec<AgentCleanupAgent> {
    [
        ("codex", "Codex"),
        ("opencode", "OpenCode"),
        ("claude_code", "Claude Code"),
        ("kiro", "Kiro"),
        ("devin", "Devin"),
        ("cursor", "Cursor"),
        ("windsurf", "Windsurf"),
        ("gemini", "Gemini CLI / Antigravity"),
        ("antigravity", "Antigravity"),
        ("continue", "Continue"),
        ("copilot", "GitHub Copilot CLI"),
        ("amazon_q", "Amazon Q Developer"),
        ("cline", "Cline"),
        ("goose", "Goose"),
    ]
    .into_iter()
    .map(|(id, name)| {
        let roots = specs
            .iter()
            .filter(|spec| spec.agent_id == id)
            .map(|spec| root_path(home, spec))
            .filter(|path| path.exists())
            .map(|path| path.to_string_lossy().to_string())
            .collect::<Vec<_>>();
        AgentCleanupAgent {
            id: id.to_string(),
            name: name.to_string(),
            available: !roots.is_empty(),
            detected: !roots.is_empty(),
            roots,
            item_count: 0,
            total_size: 0,
        }
    })
    .collect()
}

pub(super) fn category_enabled(
    category: CleanupCategory,
    policy: &super::types::AgentCleanupPolicy,
) -> bool {
    match category {
        CleanupCategory::Cache => policy.include_cache,
        CleanupCategory::Logs => policy.include_logs,
        CleanupCategory::Temporary => policy.include_temporary,
        CleanupCategory::Worktrees => policy.include_orphaned_worktrees,
        CleanupCategory::CodexRefs | CleanupCategory::GitUnreachable => policy.include_git_metadata,
    }
}

#[cfg(test)]
mod tests {
    use super::{adapter_specs, root_path};
    use std::path::Path;

    #[test]
    fn dynamic_log_roots_resolve_to_the_system_temp_directory() {
        let home = Path::new("/tmp/stowmind-agent-home");
        for relative_path in ["$TMPDIR/kiro-log", "$TMPDIR/qlog"] {
            let spec = adapter_specs()
                .iter()
                .find(|spec| spec.relative_path == relative_path)
                .expect("dynamic log root is registered");
            assert_eq!(
                root_path(home, spec),
                std::env::temp_dir().join(relative_path.trim_start_matches("$TMPDIR/"))
            );
        }
    }
}
