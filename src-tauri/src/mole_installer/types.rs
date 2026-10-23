use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
pub struct MoleInstallerPreview {
    pub items: Vec<MoleInstallerItem>,
    pub total_size: u64,
    pub scan_status: &'static str,
    pub review_token: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct MoleInstallerItem {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub source: String,
}

#[derive(Clone, Debug)]
pub(super) struct ReviewedInstaller {
    pub item: MoleInstallerItem,
    pub identity: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct MoleInstallerExecuteOutcome {
    pub item_count: Option<u64>,
    pub total_size: Option<u64>,
    pub failed_count: Option<u64>,
    pub status: &'static str,
    pub raw_output: String,
}
