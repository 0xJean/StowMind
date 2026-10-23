use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
pub struct MolePurgePreview {
    pub root: String,
    pub requested_root: String,
    pub include_empty: bool,
    pub items: Vec<MolePurgeItem>,
    pub total_size: Option<u64>,
    pub size_kind: String,
    pub scan_status: String,
    pub review_token: Option<String>,
    pub raw_output: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct MolePurgeItem {
    pub path: String,
    pub size: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
pub struct MoleExecuteOutcome {
    pub item_count: Option<u64>,
    pub total_size: Option<u64>,
    pub size_kind: String,
    pub outcome: String,
    pub raw_output: String,
}
