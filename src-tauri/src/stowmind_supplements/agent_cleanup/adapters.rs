use super::types::{AgentCleanupAgent, AgentRootSpec, CleanupCategory};
use std::path::{Path, PathBuf};

// Every entry is a leaf directory or a single log file. We never scan an
// agent home, Application Support root or browser profile wholesale: session
// stores, credentials, workspaces and browser state stay outside this list.
macro_rules! root {
    ($agent:literal, $category:expr, $path:literal) => {
        AgentRootSpec {
            agent_id: $agent,
            category: $category,
            relative_path: $path,
            scan_self: false,
        }
    };
    (file $agent:literal, $category:expr, $path:literal) => {
        AgentRootSpec {
            agent_id: $agent,
            category: $category,
            relative_path: $path,
            scan_self: true,
        }
    };
}

pub(super) const ADAPTER_ROOTS: &[AgentRootSpec] = &[
    root!("codex", CleanupCategory::Cache, ".codex/cache"),
    root!(
        "codex",
        CleanupCategory::Cache,
        ".codex/ambient-suggestions"
    ),
    root!("codex", CleanupCategory::Temporary, ".codex/.tmp"),
    root!("codex", CleanupCategory::Worktrees, ".codex/worktrees"),
    root!(
        "codex",
        CleanupCategory::Cache,
        "Library/Application Support/Codex/Cache"
    ),
    root!(
        "codex",
        CleanupCategory::Cache,
        "Library/Application Support/Codex/CachedData"
    ),
    root!(
        "codex",
        CleanupCategory::Cache,
        "Library/Application Support/Codex/Code Cache"
    ),
    root!(
        "codex",
        CleanupCategory::Cache,
        "Library/Application Support/Codex/GPUCache"
    ),
    root!(
        "codex",
        CleanupCategory::Cache,
        "Library/Application Support/Codex/DawnGraphiteCache"
    ),
    root!(
        "codex",
        CleanupCategory::Cache,
        "Library/Application Support/Codex/DawnWebGPUCache"
    ),
    root!(
        "codex",
        CleanupCategory::Cache,
        "Library/Application Support/Codex/GraphiteDawnCache"
    ),
    root!(
        file "codex",
        CleanupCategory::Temporary,
        "Library/Application Support/Codex/Crashpad/pending"
    ),
    root!(
        "codex",
        CleanupCategory::Logs,
        "Library/Logs/com.openai.codex"
    ),
    root!("opencode", CleanupCategory::Cache, ".cache/opencode"),
    root!(
        "opencode",
        CleanupCategory::Logs,
        ".local/share/opencode/log"
    ),
    root!(
        "opencode",
        CleanupCategory::Cache,
        "Library/Application Support/ai.opencode.desktop/Cache"
    ),
    root!(
        "opencode",
        CleanupCategory::Cache,
        "Library/Application Support/ai.opencode.desktop/Code Cache"
    ),
    root!(
        "opencode",
        CleanupCategory::Cache,
        "Library/Application Support/ai.opencode.desktop/GPUCache"
    ),
    root!(
        "opencode",
        CleanupCategory::Cache,
        "Library/Application Support/ai.opencode.desktop/DawnGraphiteCache"
    ),
    root!(
        "opencode",
        CleanupCategory::Cache,
        "Library/Application Support/ai.opencode.desktop/DawnWebGPUCache"
    ),
    root!(
        "opencode",
        CleanupCategory::Logs,
        "Library/Application Support/ai.opencode.desktop/logs"
    ),
    root!(
        file "opencode",
        CleanupCategory::Temporary,
        "Library/Application Support/ai.opencode.desktop/Crashpad/pending"
    ),
    root!("claude_code", CleanupCategory::Cache, ".claude/cache"),
    root!("claude_code", CleanupCategory::Cache, ".claude/paste-cache"),
    root!(
        "claude_code",
        CleanupCategory::Temporary,
        ".claude/shell-snapshots"
    ),
    root!("claude_code", CleanupCategory::Logs, ".claude/debug"),
    root!(file "claude_code", CleanupCategory::Logs, ".claude/daemon.log"),
    root!(
        "claude_code",
        CleanupCategory::Worktrees,
        ".claude/worktrees"
    ),
    root!(
        "claude_code",
        CleanupCategory::Cache,
        "Library/Application Support/Claude/Cache"
    ),
    root!(
        "claude_code",
        CleanupCategory::Cache,
        "Library/Application Support/Claude/CachedData"
    ),
    root!(
        "claude_code",
        CleanupCategory::Cache,
        "Library/Application Support/Claude/Code Cache"
    ),
    root!(
        "claude_code",
        CleanupCategory::Cache,
        "Library/Application Support/Claude/GPUCache"
    ),
    root!(
        "claude_code",
        CleanupCategory::Cache,
        "Library/Application Support/Claude/DawnGraphiteCache"
    ),
    root!(
        "claude_code",
        CleanupCategory::Cache,
        "Library/Application Support/Claude/DawnWebGPUCache"
    ),
    root!(
        "claude_code",
        CleanupCategory::Cache,
        "Library/Application Support/Claude/GraphiteDawnCache"
    ),
    root!(
        "claude_code",
        CleanupCategory::Cache,
        "Library/Application Support/Claude/GPUPersistentCache"
    ),
    root!(
        "claude_code",
        CleanupCategory::Cache,
        "Library/Application Support/Claude/fcache"
    ),
    root!(
        file "claude_code",
        CleanupCategory::Temporary,
        "Library/Application Support/Claude/Crashpad/pending"
    ),
    root!("claude_code", CleanupCategory::Logs, "Library/Logs/Claude"),
    root!(
        "kiro",
        CleanupCategory::Cache,
        "Library/Application Support/Kiro/Cache"
    ),
    root!(
        "kiro",
        CleanupCategory::Cache,
        "Library/Application Support/Kiro/CachedData"
    ),
    root!("kiro", CleanupCategory::Logs, "$TMPDIR/kiro-log"),
    root!(
        "kiro",
        CleanupCategory::Cache,
        "Library/Application Support/Kiro/Code Cache"
    ),
    root!(
        "kiro",
        CleanupCategory::Cache,
        "Library/Application Support/Kiro/GPUCache"
    ),
    root!(
        "kiro",
        CleanupCategory::Cache,
        "Library/Application Support/Kiro/DawnGraphiteCache"
    ),
    root!(
        "kiro",
        CleanupCategory::Cache,
        "Library/Application Support/Kiro/DawnWebGPUCache"
    ),
    root!(
        "kiro",
        CleanupCategory::Logs,
        "Library/Application Support/Kiro/logs"
    ),
    root!(
        file "kiro",
        CleanupCategory::Temporary,
        "Library/Application Support/Kiro/Crashpad/pending"
    ),
    root!(
        "devin",
        CleanupCategory::Cache,
        "Library/Application Support/Devin/Cache"
    ),
    root!(
        "devin",
        CleanupCategory::Cache,
        "Library/Application Support/Devin/CachedData"
    ),
    root!(
        "devin",
        CleanupCategory::Cache,
        "Library/Application Support/Devin/Code Cache"
    ),
    root!(
        "devin",
        CleanupCategory::Cache,
        "Library/Application Support/Devin/GPUCache"
    ),
    root!(
        "devin",
        CleanupCategory::Cache,
        "Library/Application Support/Devin/DawnGraphiteCache"
    ),
    root!(
        "devin",
        CleanupCategory::Cache,
        "Library/Application Support/Devin/DawnWebGPUCache"
    ),
    root!(
        "devin",
        CleanupCategory::Logs,
        "Library/Application Support/Devin/logs"
    ),
    root!(
        file "devin",
        CleanupCategory::Temporary,
        "Library/Application Support/Devin/Crashpad/pending"
    ),
    root!("devin", CleanupCategory::Cache, ".cache/devin/cli"),
    root!(
        "devin",
        CleanupCategory::Logs,
        ".local/share/devin/cli/logs"
    ),
    root!("cursor", CleanupCategory::Cache, ".cursor/cache"),
    root!("cursor", CleanupCategory::Cache, ".cursor/Cache"),
    root!("cursor", CleanupCategory::Logs, ".cursor/logs"),
    root!("cursor", CleanupCategory::Temporary, ".cursor/tmp"),
    root!("cursor", CleanupCategory::Worktrees, ".cursor/worktrees"),
    root!(
        "cursor",
        CleanupCategory::Cache,
        "Library/Application Support/Cursor/Cache"
    ),
    root!(
        "cursor",
        CleanupCategory::Cache,
        "Library/Application Support/Cursor/CachedData"
    ),
    root!(
        "cursor",
        CleanupCategory::Cache,
        "Library/Application Support/Cursor/Code Cache"
    ),
    root!(
        "cursor",
        CleanupCategory::Cache,
        "Library/Application Support/Cursor/GPUCache"
    ),
    root!(
        "cursor",
        CleanupCategory::Cache,
        "Library/Application Support/Cursor/DawnGraphiteCache"
    ),
    root!(
        file "cursor",
        CleanupCategory::Temporary,
        "Library/Application Support/Cursor/Crashpad/pending"
    ),
    root!(
        "windsurf",
        CleanupCategory::Cache,
        "Library/Application Support/Windsurf/Cache"
    ),
    root!(
        "windsurf",
        CleanupCategory::Cache,
        "Library/Application Support/Windsurf/Code Cache"
    ),
    root!(
        "windsurf",
        CleanupCategory::Cache,
        "Library/Application Support/Windsurf/GPUCache"
    ),
    root!(
        "windsurf",
        CleanupCategory::Cache,
        "Library/Application Support/Windsurf/DawnGraphiteCache"
    ),
    root!(
        "windsurf",
        CleanupCategory::Cache,
        "Library/Application Support/Windsurf/DawnWebGPUCache"
    ),
    root!(
        "windsurf",
        CleanupCategory::Logs,
        "Library/Application Support/Windsurf/logs"
    ),
    root!(
        file "windsurf",
        CleanupCategory::Temporary,
        "Library/Application Support/Windsurf/Crashpad/pending"
    ),
];

pub(super) fn adapter_specs() -> &'static [AgentRootSpec] {
    ADAPTER_ROOTS
}

pub(super) fn root_path(home: &Path, spec: &AgentRootSpec) -> PathBuf {
    if spec.relative_path == "$TMPDIR/kiro-log" {
        std::env::temp_dir().join("kiro-log")
    } else {
        home.join(spec.relative_path)
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
    }
}
