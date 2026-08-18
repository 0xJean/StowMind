use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum IosMirrorConnectionState {
    Ready,
    Paused,
    Blocked,
    Unavailable,
}

impl Default for IosMirrorConnectionState {
    fn default() -> Self {
        Self::Unavailable
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IosDeviceCapabilities {
    pub platform_supported: bool,
    pub mirror_running: bool,
    pub mirror_content_ready: bool,
    pub mirror_connection_state: IosMirrorConnectionState,
    pub accessibility_granted: bool,
    pub screen_recording_granted: bool,
    pub helper_available: bool,
    pub scan_ready: bool,
    pub execution_ready: bool,
    pub debug_build: bool,
    pub app_bundle_path: Option<String>,
    pub message: Option<String>,
    pub execution_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IosWindowBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IosMirrorPreviewRequest {
    pub offset_x: f64,
    pub offset_y: f64,
    pub width: f64,
    pub height: f64,
}

impl IosMirrorPreviewRequest {
    pub fn validate(self) -> Result<(), String> {
        let values = [self.offset_x, self.offset_y, self.width, self.height];
        if values.iter().any(|value| !value.is_finite()) {
            return Err("iPhone 实时预览区域包含无效坐标".to_string());
        }
        if !(-500.0..=5_000.0).contains(&self.offset_x)
            || !(-500.0..=5_000.0).contains(&self.offset_y)
        {
            return Err("iPhone 实时预览区域超出 StowMind 窗口范围".to_string());
        }
        if !(220.0..=900.0).contains(&self.width) || !(420.0..=1_600.0).contains(&self.height) {
            return Err("iPhone 实时预览区域尺寸不安全".to_string());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IosAppIdentity {
    pub id: String,
    pub name: String,
    pub bundle_id: Option<String>,
    pub category: String,
    pub sensitive: bool,
    pub confidence: f32,
    pub source: String,
    pub current_page: Option<usize>,
    pub current_row: Option<usize>,
    pub current_column: Option<usize>,
    pub in_dock: bool,
    pub folder_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IosFolderSnapshot {
    pub name: String,
    pub page: usize,
    pub row: usize,
    pub column: usize,
    pub app_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IosPageSnapshot {
    pub index: usize,
    pub app_ids: Vec<String>,
    pub has_widgets: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IosLayoutSnapshot {
    pub id: String,
    pub captured_at: String,
    pub device_name: Option<String>,
    pub apps: Vec<IosAppIdentity>,
    pub folders: Vec<IosFolderSnapshot>,
    pub pages: Vec<IosPageSnapshot>,
    pub dock: Vec<String>,
    pub inventory_hash: String,
    pub confidence: f32,
    pub source: String,
    #[serde(default)]
    pub scan_scope: String,
    #[serde(default)]
    pub inventory_complete: bool,
    #[serde(default)]
    pub warnings: Vec<String>,
    #[serde(default)]
    pub window_bounds: Option<IosWindowBounds>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum IosOperation {
    MoveApp {
        #[serde(alias = "app_id")]
        app_id: String,
        #[serde(alias = "from_page")]
        from_page: usize,
        #[serde(alias = "from_row")]
        from_row: usize,
        #[serde(alias = "from_column")]
        from_column: usize,
        #[serde(alias = "to_page")]
        to_page: usize,
        #[serde(alias = "to_row")]
        to_row: usize,
        #[serde(alias = "to_column")]
        to_column: usize,
    },
    CreateFolder {
        page: usize,
        row: usize,
        column: usize,
        name: String,
        #[serde(alias = "app_ids")]
        app_ids: Vec<String>,
    },
    RenameFolder {
        page: usize,
        row: usize,
        column: usize,
        from: String,
        to: String,
    },
    MoveToDock {
        #[serde(alias = "app_id")]
        app_id: String,
        #[serde(alias = "from_page")]
        from_page: usize,
        #[serde(alias = "from_row")]
        from_row: usize,
        #[serde(alias = "from_column")]
        from_column: usize,
        #[serde(alias = "dock_index")]
        dock_index: usize,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IosLayoutPlan {
    pub id: String,
    pub source_snapshot_id: String,
    pub template: String,
    pub use_ai: bool,
    pub operations: Vec<IosOperation>,
    pub warnings: Vec<String>,
    pub protected_app_ids: Vec<String>,
    pub created_at: String,
    pub restore_target_snapshot_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum IosExecutionStatus {
    Pending,
    Running,
    Paused,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IosExecutionSession {
    pub id: String,
    pub plan_id: String,
    pub status: IosExecutionStatus,
    pub current_index: usize,
    pub total: usize,
    pub error: Option<String>,
    pub guidance_message: Option<String>,
    #[serde(default)]
    pub guidance_can_resume: bool,
    pub last_verified_snapshot_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IosPlanRequest {
    pub snapshot_id: String,
    pub template: String,
    pub use_ai: bool,
    pub ai_only_hard_cases: bool,
    pub ai_provider: Option<crate::ai::AIProvider>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IosExecutionRequest {
    pub plan_id: String,
}

#[cfg(test)]
mod tests {
    use super::IosOperation;

    #[test]
    fn operations_serialize_with_frontend_camel_case_fields() {
        let operation = IosOperation::MoveApp {
            app_id: "notes".to_string(),
            from_page: 0,
            from_row: 1,
            from_column: 2,
            to_page: 1,
            to_row: 2,
            to_column: 3,
        };

        let json = serde_json::to_value(operation).expect("operation should serialize");
        assert_eq!(json["type"], "moveApp");
        assert_eq!(json["appId"], "notes");
        assert_eq!(json["fromPage"], 0);
        assert_eq!(json["toColumn"], 3);
        assert!(json.get("app_id").is_none());
    }

    #[test]
    fn operations_still_read_pre_mvp_snake_case_payloads() {
        let json = r#"{
            "type":"moveToDock",
            "app_id":"notes",
            "from_page":0,
            "from_row":1,
            "from_column":2,
            "dock_index":3
        }"#;

        let operation = serde_json::from_str::<IosOperation>(json)
            .expect("legacy operation should deserialize");
        assert!(matches!(
            operation,
            IosOperation::MoveToDock {
                app_id,
                dock_index: 3,
                ..
            } if app_id == "notes"
        ));
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IosProgressEvent {
    pub session_id: String,
    pub current: usize,
    pub total: usize,
    pub status: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IosSnapshotRequest {
    pub device_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IosActionResult {
    pub performed: bool,
    pub already_satisfied: bool,
    pub requires_guidance: bool,
    #[serde(default)]
    pub can_resume: bool,
    pub message: Option<String>,
}
