use serde::Serialize;

#[derive(Clone, Serialize)]
pub(crate) struct MaintenanceError {
    pub code: String,
    pub message: String,
    pub raw_output: String,
    pub output_truncated: bool,
    pub cleanup_pending: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub partial_result: Option<serde_json::Value>,
    #[serde(skip)]
    pub process_started: bool,
}

impl std::fmt::Debug for MaintenanceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MaintenanceError")
            .field("code", &self.code)
            .field("message", &self.message)
            .field("output_bytes", &self.raw_output.len())
            .field("output_truncated", &self.output_truncated)
            .field("cleanup_pending", &self.cleanup_pending)
            .field("process_started", &self.process_started)
            .finish()
    }
}

impl MaintenanceError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_string(),
            message: message.into(),
            raw_output: String::new(),
            output_truncated: false,
            cleanup_pending: false,
            partial_result: None,
            process_started: false,
        }
    }

    pub fn partial<T: Serialize>(mut self, result: &T) -> Self {
        if self.process_started {
            self.partial_result = serde_json::to_value(result).ok();
        }
        self
    }
}

impl From<String> for MaintenanceError {
    fn from(message: String) -> Self {
        Self::new("failed", message)
    }
}

impl From<&str> for MaintenanceError {
    fn from(message: &str) -> Self {
        Self::new("failed", message)
    }
}
