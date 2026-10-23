use super::summary::{MoleCleanScanStatus, MoleCleanSummaryStatus};
use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
pub struct MoleCleanPreview {
    pub potential_space: Option<u64>,
    pub item_count: Option<u64>,
    pub category_count: Option<u64>,
    pub summary_status: MoleCleanSummaryStatus,
    pub scan_status: MoleCleanScanStatus,
    pub sections: Vec<MoleCleanSection>,
    pub raw_output: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct MoleCleanSection {
    pub title: String,
    pub items: Vec<MoleCleanItem>,
}

#[derive(Clone, Debug, Serialize)]
pub struct MoleCleanItem {
    pub label: String,
    pub size: Option<u64>,
    pub count: Option<u64>,
    pub status: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct MoleCleanPreviewOutput {
    pub run_id: String,
    pub stream: String,
    pub line: String,
}
