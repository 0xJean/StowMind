use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct MoleAnalyzeResult {
    pub path: String,
    #[serde(default)]
    pub overview: bool,
    #[serde(default)]
    pub entries: Vec<MoleAnalyzeEntry>,
    #[serde(default)]
    pub large_files: Vec<MoleAnalyzeEntry>,
    #[serde(default)]
    pub warnings: Vec<String>,
    pub total_size: u64,
    pub total_files: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct MoleAnalyzeEntry {
    pub name: String,
    pub path: String,
    pub size: u64,
    #[serde(default)]
    pub is_dir: bool,
    #[serde(default)]
    pub last_access: Option<String>,
}

const MAX_ANALYZE_ENTRIES: usize = 1_500;
const MAX_ANALYZE_LARGE_FILES: usize = 100;

pub fn compact_analyze_result(mut result: MoleAnalyzeResult) -> MoleAnalyzeResult {
    if result.entries.len() > MAX_ANALYZE_ENTRIES {
        result.entries.sort_by(|a, b| b.size.cmp(&a.size));
        result.entries.truncate(MAX_ANALYZE_ENTRIES);
        result.overview = true;
    }

    if result.large_files.len() > MAX_ANALYZE_LARGE_FILES {
        result.large_files.sort_by(|a, b| b.size.cmp(&a.size));
        result.large_files.truncate(MAX_ANALYZE_LARGE_FILES);
    }

    result
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoleAnalyzeProgress {
    pub run_id: String,
    pub path: String,
    pub phase: String,
    pub stream: Option<String>,
    pub line: Option<String>,
    pub elapsed_secs: u64,
    pub current: Option<usize>,
    pub total: Option<usize>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoleAnalyzePartial {
    pub run_id: String,
    pub result: MoleAnalyzeResult,
}
