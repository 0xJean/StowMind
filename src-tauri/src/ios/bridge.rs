use super::types::{
    IosActionResult, IosDeviceCapabilities, IosLayoutSnapshot, IosMirrorConnectionState,
    IosWindowBounds,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::Ordering;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager};

#[path = "helper_process.rs"]
mod helper_process;
#[cfg(test)]
pub(super) use helper_process::collect_child_output;
pub(super) use helper_process::collect_child_output_cancellable;

static HELPER_REQUEST_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HelperRequest {
    operation: String,
    payload: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HelperResponse {
    ok: bool,
    payload: Option<Value>,
    error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HelperCapabilities {
    accessibility_granted: bool,
    screen_recording_granted: bool,
    #[serde(default)]
    mirror_window_found: bool,
    #[serde(default)]
    mirror_content_ready: Option<bool>,
    #[serde(default)]
    mirror_connection_state: Option<IosMirrorConnectionState>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HelperPermissionResult {
    granted: bool,
}

pub fn helper_path(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(path) = std::env::var("STOWMIND_IOS_HELPER") {
        let candidate = PathBuf::from(path);
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    let mut candidates = Vec::new();
    if let Some(resource_dir) = app.path_resolver().resource_dir() {
        candidates.push(resource_dir.join("binaries/stowmind-ios-helper"));
        candidates.push(resource_dir.join("stowmind-ios-helper"));
    }
    if let Ok(executable) = std::env::current_exe() {
        if let Some(parent) = executable.parent() {
            candidates.push(parent.join("stowmind-ios-helper"));
            candidates.push(parent.join("../Resources/binaries/stowmind-ios-helper"));
        }
    }
    candidates.push(PathBuf::from("src-tauri/binaries/stowmind-ios-helper"));
    candidates.push(PathBuf::from("binaries/stowmind-ios-helper"));

    candidates.into_iter().find(|candidate| candidate.is_file())
}

pub fn helper_available(app: &AppHandle) -> bool {
    helper_path(app).is_some()
}

fn current_app_bundle_path() -> Option<PathBuf> {
    let executable = std::env::current_exe().ok()?;
    executable
        .ancestors()
        .find(|path| path.extension().is_some_and(|extension| extension == "app"))
        .map(PathBuf::from)
}

pub fn reveal_current_app() -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Err("显示当前 StowMind 仅支持 macOS".to_string());
    }
    let app_path =
        current_app_bundle_path().ok_or_else(|| "当前进程不在 macOS App 包中".to_string())?;
    Command::new("open")
        .arg("-R")
        .arg(&app_path)
        .status()
        .map_err(|error| format!("无法在 Finder 中显示当前 StowMind：{error}"))?
        .success()
        .then_some(())
        .ok_or_else(|| "无法在 Finder 中显示当前 StowMind".to_string())
}

pub fn mirror_running() -> bool {
    ["com.apple.ScreenContinuity", "iPhone Mirroring"]
        .iter()
        .any(|pattern| {
            Command::new("pgrep")
                .args(["-f", pattern])
                .output()
                .map(|output| output.status.success())
                .unwrap_or(false)
        })
}

pub fn open_mirroring() -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Err("iPhone 镜像整理仅支持 macOS".to_string());
    }
    Command::new("open")
        .args(["-b", "com.apple.ScreenContinuity"])
        .status()
        .map_err(|error| format!("无法打开 iPhone 镜像：{error}"))?
        .success()
        .then_some(())
        .ok_or_else(|| "无法打开 iPhone 镜像".to_string())
}

pub fn open_permission_settings(permission: &str) -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Err("iPhone 镜像权限设置仅支持 macOS".to_string());
    }
    let url = match permission {
        "accessibility" => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
        }
        "screenRecording" => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
        }
        _ => return Err("不支持的 iPhone 镜像权限设置".to_string()),
    };
    Command::new("open")
        .arg(url)
        .status()
        .map_err(|error| format!("无法打开系统设置：{error}"))?
        .success()
        .then_some(())
        .ok_or_else(|| "无法打开系统设置".to_string())
}

pub fn request_permission(app: &AppHandle, permission: &str) -> Result<bool, String> {
    match permission {
        "accessibility" | "screenRecording" => {}
        _ => return Err("不支持的 iPhone 镜像权限请求".to_string()),
    }
    request::<HelperPermissionResult>(
        app,
        "requestPermission",
        json!({ "permission": permission }),
    )
    .map(|result| result.granted)
}

pub(super) fn scan_ready(
    supported: bool,
    mirror_window: bool,
    mirror_content_ready: bool,
    helper: bool,
    screen_recording: bool,
) -> bool {
    supported && mirror_window && mirror_content_ready && helper && screen_recording
}

pub(super) fn execution_ready(scan_ready: bool, accessibility: bool) -> bool {
    scan_ready && accessibility
}

pub fn capabilities(app: &AppHandle) -> Result<IosDeviceCapabilities, String> {
    let supported = cfg!(target_os = "macos");
    let helper = helper_available(app);
    let helper_capabilities = helper
        .then(|| request::<HelperCapabilities>(app, "capabilities", json!({})))
        .transpose()
        .map_err(|error| {
            format!("无法检查 iPhone 镜像状态，请刷新重试；当前无法判断权限是否已授权：{error}")
        })?;
    let mirror_window = helper_capabilities
        .as_ref()
        .map(|value| value.mirror_window_found)
        .unwrap_or_else(mirror_running);
    let reported_content_ready = helper_capabilities
        .as_ref()
        .and_then(|value| value.mirror_content_ready)
        .unwrap_or(false);
    let mirror_connection_state = helper_capabilities
        .as_ref()
        .and_then(|value| value.mirror_connection_state)
        .unwrap_or_else(|| {
            if !mirror_window {
                IosMirrorConnectionState::Unavailable
            } else if reported_content_ready {
                IosMirrorConnectionState::Ready
            } else {
                IosMirrorConnectionState::Blocked
            }
        });
    let mirror_content_ready =
        reported_content_ready && mirror_connection_state == IosMirrorConnectionState::Ready;
    let accessibility = helper_capabilities
        .as_ref()
        .map(|value| value.accessibility_granted)
        .unwrap_or(false);
    let screen_recording = helper_capabilities
        .as_ref()
        .map(|value| value.screen_recording_granted)
        .unwrap_or(false);
    let debug_build = cfg!(debug_assertions);
    let app_bundle_path = current_app_bundle_path().map(|path| path.to_string_lossy().to_string());
    let app_bundle_name = current_app_bundle_path()
        .and_then(|path| {
            path.file_stem()
                .map(|name| name.to_string_lossy().to_string())
        })
        .unwrap_or_else(|| "StowMind".to_string());
    let scan_ready = scan_ready(
        supported,
        mirror_window,
        mirror_content_ready,
        helper,
        screen_recording,
    );
    let execution_ready = execution_ready(scan_ready, accessibility);

    let message = if !supported {
        Some("iPhone 镜像整理仅支持 macOS".to_string())
    } else if !mirror_window {
        Some("请打开 iPhone 镜像并保持 iPhone 锁定".to_string())
    } else if !helper {
        Some("镜像辅助组件未安装，当前只能使用引导模式".to_string())
    } else if !screen_recording {
        Some(if debug_build {
            format!(
                "当前调试版 {app_bundle_name} 尚未获得屏幕录制权限。系统设置中的已安装版 StowMind 授权不会自动应用到此调试包；请授权当前调试 App，完成后重启。"
            )
        } else {
            "需要在系统设置中允许 StowMind 录制屏幕，以便只读识别镜像内容".to_string()
        })
    } else if mirror_connection_state == IosMirrorConnectionState::Paused {
        Some("iPhone 镜像连接已暂停，请在镜像窗口中恢复连接后重新盘点".to_string())
    } else if !mirror_content_ready {
        Some("iPhone 正在使用中，请锁定 iPhone 并等待镜像显示主屏幕".to_string())
    } else {
        None
    };
    let execution_message = if let Some(message) = message.as_ref() {
        Some(message.clone())
    } else if !accessibility {
        Some(if debug_build {
            format!(
                "只读盘点已可用；开始辅助执行前，请在辅助功能设置中允许当前调试版 {app_bundle_name}，完成后重启。"
            )
        } else {
            "只读盘点已可用；开始辅助执行前，需要允许 StowMind 控制 iPhone 镜像".to_string()
        })
    } else {
        None
    };

    Ok(IosDeviceCapabilities {
        platform_supported: supported,
        mirror_running: mirror_window,
        mirror_content_ready,
        mirror_connection_state,
        accessibility_granted: accessibility,
        screen_recording_granted: screen_recording,
        helper_available: helper,
        scan_ready,
        execution_ready,
        debug_build,
        app_bundle_path,
        message,
        execution_message,
    })
}

pub fn require_execution_ready(app: &AppHandle) -> Result<(), String> {
    let capabilities = capabilities(app)?;
    if capabilities.execution_ready {
        return Ok(());
    }
    Err(capabilities
        .execution_message
        .unwrap_or_else(|| "iPhone 镜像尚未满足辅助执行条件".to_string()))
}

pub fn request<T: DeserializeOwned>(
    app: &AppHandle,
    operation: &str,
    payload: Value,
) -> Result<T, String> {
    let _guard = HELPER_REQUEST_LOCK
        .lock()
        .map_err(|_| "无法锁定 iPhone 镜像辅助组件".to_string())?;
    let manager = if matches!(operation, "executeAction" | "scanInventory") {
        Some(
            app.try_state::<super::execution_manager::IosExecutionManager>()
                .ok_or_else(|| "无法读取 iPhone 安全停止状态".to_string())?,
        )
    } else {
        None
    };
    let cancelled = manager.as_ref().map(|manager| &manager.cancelled);
    if cancelled.is_some_and(|flag| flag.load(Ordering::SeqCst)) {
        return Err("镜像操作已取消，未启动输入动作".to_string());
    }
    let helper = helper_path(app)
        .ok_or_else(|| "镜像辅助组件不可用，请先安装正式 macOS 构建".to_string())?;
    let input = serde_json::to_string(&HelperRequest {
        operation: operation.to_string(),
        payload,
    })
    .map_err(|error| format!("无法编码镜像请求：{error}"))?;

    let mut child = Command::new(helper)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("无法启动镜像辅助组件：{error}"))?;

    if let Some(stdin) = child.stdin.as_mut() {
        use std::io::Write;
        if let Err(error) = stdin.write_all(format!("{input}\n").as_bytes()) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("无法发送镜像请求：{error}"));
        }
    }
    drop(child.stdin.take());

    let timeout = match operation {
        "scanInventory" => Duration::from_secs(180),
        "requestPermission" => Duration::from_secs(120),
        _ => Duration::from_secs(30),
    };
    let output = collect_child_output_cancellable(child, timeout, cancelled)?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let response: HelperResponse = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("镜像辅助组件返回了无效响应：{error}"))?;
    if !response.ok {
        return Err(response
            .error
            .unwrap_or_else(|| "镜像辅助组件执行失败".to_string()));
    }

    let payload = response
        .payload
        .ok_or_else(|| "镜像辅助组件没有返回数据".to_string())?;
    serde_json::from_value(payload).map_err(|error| format!("无法解析镜像响应：{error}"))
}

pub fn capture_snapshot(
    app: &AppHandle,
    device_name: Option<String>,
) -> Result<IosLayoutSnapshot, String> {
    request(
        app,
        "captureSnapshot",
        json!({
            "deviceName": device_name,
            "includeOcr": true,
        }),
    )
}

pub fn scan_inventory(
    app: &AppHandle,
    device_name: Option<String>,
) -> Result<IosLayoutSnapshot, String> {
    let capabilities = capabilities(app)?;
    if !capabilities.scan_ready {
        return Err(capabilities
            .message
            .unwrap_or_else(|| "iPhone 镜像尚未满足只读盘点条件".to_string()));
    }
    if capabilities.accessibility_granted {
        return request(
            app,
            "scanInventory",
            json!({
                "deviceName": device_name,
                "includeOcr": true,
            }),
        );
    }

    let mut snapshot = capture_snapshot(app, device_name)?;
    snapshot.warnings.push(
        "辅助功能尚未被当前 StowMind 构建识别，本次仅盘点当前可见页面；未发送点击、滑动或拖拽事件。"
            .to_string(),
    );
    Ok(snapshot)
}

pub fn execute_action(
    app: &AppHandle,
    action: &Value,
    snapshot_id: &str,
    expected_window: Option<&IosWindowBounds>,
) -> Result<IosActionResult, String> {
    request(
        app,
        "executeAction",
        json!({
            "action": action,
            "snapshotId": snapshot_id,
            "expectedWindow": expected_window,
            "maxDurationMs": Duration::from_secs(20).as_millis(),
        }),
    )
}
