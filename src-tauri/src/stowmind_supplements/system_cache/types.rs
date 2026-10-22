use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};

pub(super) const TARGET_PATH: &str = "/Library/Caches/com.apple.iconservices.store";
pub(super) const TARGET_PARENT: &str = "/Library/Caches";
pub(super) const ANOMALY_THRESHOLD: u64 = 10 * 1024 * 1024 * 1024;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ScanStatus {
    Complete,
    NotFound,
    PermissionDenied,
    TimedOut,
    Partial,
    Unsupported,
    Error,
}

#[derive(Clone, Debug, Serialize)]
pub struct SystemCacheReport {
    pub source: &'static str,
    pub target_id: &'static str,
    pub path: &'static str,
    pub scanned_at: i64,
    pub status: ScanStatus,
    pub size_bytes: Option<u64>,
    pub modified_at: Option<i64>,
    pub authorized: bool,
    pub anomaly: Option<bool>,
    pub threshold_bytes: u64,
    pub message: String,
    pub mole_supported: bool,
    pub mole_message: String,
    pub review_token: Option<String>,
}

impl SystemCacheReport {
    pub(super) fn new(status: ScanStatus, message: impl Into<String>, authorized: bool) -> Self {
        Self {
            source: "stowmind_supplement",
            target_id: "iconservices",
            path: TARGET_PATH,
            scanned_at: epoch_now(),
            status,
            size_bytes: None,
            modified_at: None,
            authorized,
            anomaly: None,
            threshold_bytes: ANOMALY_THRESHOLD,
            message: message.into(),
            mole_supported: false,
            mole_message: String::new(),
            review_token: None,
        }
    }

    pub(super) fn set_size(&mut self, size: u64) {
        self.size_bytes = Some(size);
        self.anomaly = Some(size >= ANOMALY_THRESHOLD);
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct SystemCacheOutcome {
    pub source: &'static str,
    pub before: SystemCacheReport,
    pub after: SystemCacheReport,
    pub success: bool,
    pub attempted: bool,
    pub errors: Vec<String>,
    /// A before/after directory-size observation, not an OS free-space claim.
    pub measured_delta_bytes: Option<i64>,
    pub completed_at: i64,
}

pub(super) fn epoch_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default()
}
