use serde::Serialize;
use std::process::Command;

/// Mole 安装状态
#[derive(Clone, Serialize)]
pub struct MoleStatus {
    pub installed: bool,
    pub version: Option<String>,
    /// "macos" | "windows" | "linux"
    pub platform: String,
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

/// 获取 mo 命令名（Windows 上是 mo.cmd）
fn mo_cmd() -> &'static str {
    if cfg!(target_os = "windows") {
        "mo.cmd"
    } else {
        "mo"
    }
}

/// 检测 mole 是否已安装
pub async fn check_mole() -> MoleStatus {
    let platform = current_platform();
    let result = tokio::task::spawn_blocking(|| {
        Command::new(mo_cmd()).arg("--version").output()
    })
    .await;

    match result {
        Ok(Ok(output)) if output.status.success() => {
            let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let version = extract_version(&raw);
            MoleStatus { installed: true, version, platform }
        }
        _ => MoleStatus { installed: false, version: None, platform },
    }
}

/// 从 "Mole version 1.35.0 macOS: ..." 中提取 "1.35.0"
fn extract_version(raw: &str) -> Option<String> {
    let re = regex::Regex::new(r"(\d+\.\d+\.\d+)").ok()?;
    re.find(raw).map(|m| m.as_str().to_string())
}
