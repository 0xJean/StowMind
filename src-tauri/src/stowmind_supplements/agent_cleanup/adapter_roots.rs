use super::types::{AgentRootSpec, CleanupCategory};

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
    // Crashpad's pending directory can contain millions of independent dump
    // files.  Keep the directory itself allow-listed, but scan and remove
    // individual entries so a fresh dump cannot make an old directory look
    // safe to delete as a whole.
    root!(
        "codex",
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
        "opencode",
        CleanupCategory::Temporary,
        "Library/Application Support/ai.opencode.desktop/Crashpad/pending"
    ),
    root!(
        file "gemini",
        CleanupCategory::Logs,
        ".gemini/antigravity-cli/cli.log"
    ),
    root!(
        "gemini",
        CleanupCategory::Logs,
        ".gemini/antigravity-cli/log"
    ),
    root!(
        file "gemini",
        CleanupCategory::Temporary,
        ".gemini/antigravity-cli/crashes"
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
        "claude_code",
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
        "kiro",
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
        "devin",
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
        "cursor",
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
        "windsurf",
        CleanupCategory::Temporary,
        "Library/Application Support/Windsurf/Crashpad/pending"
    ),
    root!(
        "antigravity",
        CleanupCategory::Cache,
        "Library/Application Support/Antigravity/Cache"
    ),
    root!(
        "antigravity",
        CleanupCategory::Cache,
        "Library/Application Support/Antigravity/CachedData"
    ),
    root!(
        "antigravity",
        CleanupCategory::Cache,
        "Library/Application Support/Antigravity/CachedExtensionVSIXs"
    ),
    root!(
        "antigravity",
        CleanupCategory::Cache,
        "Library/Application Support/Antigravity/Code Cache"
    ),
    root!(
        "antigravity",
        CleanupCategory::Cache,
        "Library/Application Support/Antigravity/GPUCache"
    ),
    root!(
        "antigravity",
        CleanupCategory::Cache,
        "Library/Application Support/Antigravity/DawnGraphiteCache"
    ),
    root!(
        "antigravity",
        CleanupCategory::Cache,
        "Library/Application Support/Antigravity/DawnWebGPUCache"
    ),
    root!(
        "antigravity",
        CleanupCategory::Logs,
        "Library/Application Support/Antigravity/logs"
    ),
    root!(
        "antigravity",
        CleanupCategory::Temporary,
        "Library/Application Support/Antigravity/Crashpad/pending"
    ),
    root!("continue", CleanupCategory::Cache, ".continue/index"),
    root!("continue", CleanupCategory::Cache, ".continue/.utils"),
    root!("copilot", CleanupCategory::Logs, ".copilot/logs"),
    root!(
        "copilot",
        CleanupCategory::Logs,
        "Library/Logs/GitHubCopilot"
    ),
    root!(
        "copilot",
        CleanupCategory::Cache,
        "Library/Caches/copilot/marketplaces"
    ),
    root!("amazon_q", CleanupCategory::Logs, "$TMPDIR/qlog"),
    root!("cline", CleanupCategory::Logs, ".cline/data/logs"),
    root!("goose", CleanupCategory::Logs, ".local/state/goose/logs"),
    root!(
        "goose",
        CleanupCategory::Logs,
        "Library/Application Support/Goose/logs"
    ),
];
