use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};

pub const SOURCE: &str = "stowmind_supplement";
pub const OPERATION: &str = "app_update_scan";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StowmindSupplementAppUpdateItem {
    pub name: String,
    pub path: String,
    pub bundle_id: Option<String>,
    pub installed_version: Option<String>,
    pub latest_version: Option<String>,
    pub provider: String,
    pub update_status: String,
    pub confidence: String,
    pub feed_url: Option<String>,
    pub detail: String,
    pub action_kind: Option<String>,
    pub action_target: Option<String>,
    pub action_label: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StowmindSupplementAppUpdateScan {
    pub source: String,
    pub operation: String,
    pub platform: String,
    pub generated_at_epoch: u64,
    pub scan_status: String,
    pub message: String,
    pub directories: Vec<String>,
    pub scanned_apps: usize,
    pub update_candidates: usize,
    pub app_store_apps: usize,
    pub sparkle_apps: usize,
    pub electron_apps: usize,
    pub items: Vec<StowmindSupplementAppUpdateItem>,
}

pub fn empty_scan(
    platform: String,
    status: &str,
    message: &str,
) -> StowmindSupplementAppUpdateScan {
    StowmindSupplementAppUpdateScan {
        source: SOURCE.to_string(),
        operation: OPERATION.to_string(),
        platform,
        generated_at_epoch: unix_epoch(),
        scan_status: status.to_string(),
        message: message.to_string(),
        directories: Vec::new(),
        scanned_apps: 0,
        update_candidates: 0,
        app_store_apps: 0,
        sparkle_apps: 0,
        electron_apps: 0,
        items: Vec::new(),
    }
}

pub fn refresh_counts(scan: &mut StowmindSupplementAppUpdateScan) {
    scan.scanned_apps = scan.items.len();
    scan.update_candidates = scan
        .items
        .iter()
        .filter(|item| item.update_status == "available")
        .count();
    scan.app_store_apps = scan
        .items
        .iter()
        .filter(|item| item.provider == "app_store")
        .count();
    scan.sparkle_apps = scan
        .items
        .iter()
        .filter(|item| item.provider == "sparkle")
        .count();
    scan.electron_apps = scan
        .items
        .iter()
        .filter(|item| item.provider == "electron")
        .count();
}

pub fn unix_epoch() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}
