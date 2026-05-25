use crate::mole_utils::mole_command;
use serde::{Deserialize, Serialize};

/// Mole 安装状态
#[derive(Clone, Serialize)]
pub struct MoleStatus {
    pub installed: bool,
    pub version: Option<String>,
    /// "macos" | "windows" | "linux"
    pub platform: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct MoleStatusMetrics {
    pub collected_at: String,
    pub host: String,
    pub platform: String,
    pub uptime: String,
    pub procs: u64,
    pub hardware: MoleHardware,
    pub health_score: i64,
    pub health_score_msg: String,
    pub cpu: MoleCpu,
    pub memory: MoleMemory,
    pub disks: Vec<MoleDisk>,
    pub trash_size: u64,
    pub disk_io: MoleDiskIo,
    pub network: Vec<MoleNetwork>,
    pub batteries: Vec<MoleBattery>,
    pub top_processes: Vec<MoleProcess>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct MoleHardware {
    pub model: String,
    pub cpu_model: String,
    pub total_ram: String,
    pub disk_size: String,
    pub os_version: String,
    #[serde(default)]
    pub refresh_rate: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct MoleCpu {
    pub usage: f64,
    pub load1: f64,
    pub load5: f64,
    pub load15: f64,
    pub core_count: u64,
    pub logical_cpu: u64,
    #[serde(default)]
    pub per_core: Vec<f64>,
    #[serde(default)]
    pub per_core_estimated: bool,
    #[serde(default)]
    pub p_core_count: u64,
    #[serde(default)]
    pub e_core_count: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct MoleMemory {
    pub used: u64,
    pub total: u64,
    pub used_percent: f64,
    pub swap_used: u64,
    pub swap_total: u64,
    pub cached: u64,
    pub pressure: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct MoleDisk {
    pub mount: String,
    pub device: String,
    pub used: u64,
    pub total: u64,
    pub used_percent: f64,
    pub fstype: String,
    pub external: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct MoleDiskIo {
    pub read_rate: f64,
    pub write_rate: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct MoleNetwork {
    pub name: String,
    pub rx_rate_mbs: f64,
    pub tx_rate_mbs: f64,
    pub ip: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct MoleBattery {
    pub percent: f64,
    pub status: String,
    pub time_left: String,
    pub health: String,
    pub cycle_count: u64,
    pub capacity: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct MoleProcess {
    pub pid: u64,
    pub name: String,
    pub command: String,
    pub cpu: f64,
    pub memory: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct MoleStatusMetricsExtra {
    #[serde(default)]
    pub gpu: Vec<serde_json::Value>,
    #[serde(default)]
    pub trash_approx: bool,
    #[serde(default)]
    pub network_history: serde_json::Value,
    #[serde(default)]
    pub thermal: serde_json::Value,
    #[serde(default)]
    pub proxy: serde_json::Value,
    #[serde(default)]
    pub bluetooth: Vec<serde_json::Value>,
    #[serde(default)]
    pub process_watch: serde_json::Value,
    #[serde(default)]
    pub process_alerts: Vec<serde_json::Value>,
    #[serde(default)]
    pub sensors: serde_json::Value,
}

/// 获取当前平台标识
fn current_platform() -> String {
    if cfg!(target_os = "macos") {
        "macos".to_string()
    } else if cfg!(target_os = "windows") {
        "windows".to_string()
    } else {
        "linux".to_string()
    }
}

/// 检测 mole 是否已安装
#[tauri::command]
pub async fn mole_check() -> MoleStatus {
    let platform = current_platform();
    let result = tokio::task::spawn_blocking(|| -> Result<std::process::Output, String> {
        mole_command()?
            .arg("--version")
            .output()
            .map_err(|e| e.to_string())
    })
    .await;

    match result {
        Ok(Ok(output)) if output.status.success() => {
            let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let version = extract_version(&raw);
            MoleStatus {
                installed: true,
                version,
                platform,
            }
        }
        _ => MoleStatus {
            installed: false,
            version: None,
            platform,
        },
    }
}

/// 使用 Mole 的真实 JSON 输出获取系统状态。
#[tauri::command]
pub async fn mole_status_json() -> Result<MoleStatusMetrics, String> {
    let output = tokio::task::spawn_blocking(|| -> Result<std::process::Output, String> {
        mole_command()?
            .args(["status", "-json"])
            .output()
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("Failed to join status task: {e}"))?
    .map_err(|e| format!("Failed to run mo status -json: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if stderr.is_empty() { stdout } else { stderr };
        return Err(if detail.is_empty() {
            "mo status -json failed".to_string()
        } else {
            detail
        });
    }

    let stdout = String::from_utf8(output.stdout)
        .map_err(|e| format!("Mole status output is not valid UTF-8: {e}"))?;
    serde_json::from_str::<MoleStatusMetrics>(&stdout)
        .map_err(|e| format!("Failed to parse Mole status JSON: {e}"))
}

#[tauri::command]
pub async fn mole_status_raw_json() -> Result<serde_json::Value, String> {
    let output = tokio::task::spawn_blocking(|| -> Result<std::process::Output, String> {
        mole_command()?
            .args(["status", "-json"])
            .output()
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("Failed to join status task: {e}"))?
    .map_err(|e| format!("Failed to run mo status -json: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if stderr.is_empty() { stdout } else { stderr };
        return Err(if detail.is_empty() {
            "mo status -json failed".to_string()
        } else {
            detail
        });
    }

    let stdout = String::from_utf8(output.stdout)
        .map_err(|e| format!("Mole status output is not valid UTF-8: {e}"))?;
    serde_json::from_str::<serde_json::Value>(&stdout)
        .map_err(|e| format!("Failed to parse Mole status JSON: {e}"))
}

/// 从 "Mole version 1.35.0 macOS: ..." 中提取 "1.35.0"
fn extract_version(raw: &str) -> Option<String> {
    let re = regex::Regex::new(r"(\d+\.\d+\.\d+)").ok()?;
    re.find(raw).map(|m| m.as_str().to_string())
}
