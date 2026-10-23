use serde::{Deserialize, Serialize};

pub(super) const DEFAULT_MIN_AGE_DAYS: u64 = 7;
pub(super) const MAX_MIN_AGE_DAYS: u64 = 3650;
pub(super) const MAX_EXECUTE_ITEMS: usize = 1_000;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AgentCleanupPolicy {
    #[serde(default = "default_min_age_days")]
    pub min_age_days: u64,
    #[serde(default = "default_true")]
    pub include_cache: bool,
    #[serde(default = "default_true")]
    pub include_logs: bool,
    #[serde(default = "default_true")]
    pub include_temporary: bool,
    #[serde(default = "default_true")]
    pub include_orphaned_worktrees: bool,
    #[serde(default = "default_true")]
    pub include_git_metadata: bool,
}

impl Default for AgentCleanupPolicy {
    fn default() -> Self {
        Self {
            min_age_days: DEFAULT_MIN_AGE_DAYS,
            include_cache: true,
            include_logs: true,
            include_temporary: true,
            include_orphaned_worktrees: true,
            include_git_metadata: true,
        }
    }
}

impl AgentCleanupPolicy {
    pub(super) fn normalized(self) -> Self {
        Self {
            min_age_days: self.min_age_days.min(MAX_MIN_AGE_DAYS),
            ..self
        }
    }
}

fn default_min_age_days() -> u64 {
    DEFAULT_MIN_AGE_DAYS
}

fn default_true() -> bool {
    true
}

#[derive(Clone, Debug, Serialize)]
pub struct AgentCleanupAgent {
    pub id: String,
    pub name: String,
    pub available: bool,
    pub detected: bool,
    pub roots: Vec<String>,
    pub item_count: u64,
    pub total_size: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
pub struct AgentCleanupItem {
    pub id: String,
    pub agent: String,
    pub category: String,
    pub path: String,
    pub size: u64,
    pub size_status: String,
    pub entry_count: u64,
    pub modified_at: i64,
    pub eligible: bool,
    pub default_selected: bool,
    pub protected: bool,
    pub reason: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct AgentCleanupProtected {
    pub path: String,
    pub agent: String,
    pub reason: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct AgentCleanupSummary {
    pub candidate_count: u64,
    pub eligible_count: u64,
    pub protected_count: u64,
    pub total_size_bytes: Option<u64>,
    pub reclaimable_size_bytes: u64,
}

#[derive(Clone, Debug, Serialize)]
pub struct AgentCleanupPreview {
    pub source: String,
    pub scanned_at: i64,
    pub retention_days: u64,
    pub agents: Vec<AgentCleanupAgent>,
    pub items: Vec<AgentCleanupItem>,
    pub protected: Vec<AgentCleanupProtected>,
    pub summary: AgentCleanupSummary,
}

#[derive(Clone, Debug, Deserialize)]
pub struct AgentCleanupExecuteRequest {
    #[serde(default, alias = "paths", alias = "itemIds")]
    pub item_ids: Vec<String>,
    #[serde(default = "default_min_age_days", alias = "retentionDays")]
    pub retention_days: u64,
    #[serde(default)]
    pub confirmed: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct AgentCleanupAction {
    pub path: String,
    pub size_bytes: Option<u64>,
    pub size_status: AgentCleanupSizeStatus,
    pub success: bool,
    pub message: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentCleanupSizeStatus {
    Complete,
    Partial,
    Unavailable,
}

#[derive(Clone, Debug, Serialize)]
pub struct AgentCleanupResult {
    pub source: String,
    pub removed_count: u64,
    /// Logical bytes processed, including recoverable moves to Trash. This is
    /// not a measurement of physical disk space released.
    pub processed_bytes: Option<u64>,
    /// Partial bytes are a known lower bound, including when another
    /// successfully processed item could not be measured at all.
    pub processed_size_status: AgentCleanupSizeStatus,
    pub freed_bytes: Option<u64>,
    pub skipped_count: u64,
    pub errors: Vec<String>,
    pub completed_at: Option<String>,
    pub actions: Vec<AgentCleanupAction>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum CleanupCategory {
    Cache,
    Logs,
    Temporary,
    Worktrees,
    CodexRefs,
    GitUnreachable,
}

impl CleanupCategory {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            Self::Cache => "cache",
            Self::Logs => "log",
            Self::Temporary => "temporary",
            Self::Worktrees => "orphan_worktree",
            Self::CodexRefs => "codex_internal_ref",
            Self::GitUnreachable => "git_unreachable_object",
        }
    }
}

#[derive(Clone, Debug)]
pub(super) struct AgentRootSpec {
    pub(super) agent_id: &'static str,
    pub(super) category: CleanupCategory,
    pub(super) relative_path: &'static str,
    pub(super) scan_self: bool,
}
