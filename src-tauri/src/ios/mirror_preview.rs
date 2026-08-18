use super::bridge::{self, helper_path};
use super::types::{IosMirrorPreviewRequest, IosWindowBounds};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, LogicalPosition, LogicalSize, PhysicalPosition, PhysicalSize, Window};

const COMPANION_MIN_WIDTH: f64 = 400.0;
const COMPANION_MIN_HEIGHT: f64 = 600.0;
const APP_MIN_WIDTH: f64 = 1100.0;
const APP_MIN_HEIGHT: f64 = 680.0;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PreviewHelperRequest<'a> {
    operation: &'a str,
    payload: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreviewHelperResponse {
    ok: bool,
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MirrorInteractionLayout {
    companion_bounds: IosWindowBounds,
}

struct PreviewProcess {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl PreviewProcess {
    fn spawn(app: &AppHandle) -> Result<Self, String> {
        let helper = helper_path(app).ok_or_else(|| "iPhone 实时预览组件不可用".to_string())?;
        let mut child = Command::new(helper)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| format!("无法启动 iPhone 实时预览组件：{error}"))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "iPhone 实时预览组件没有输入通道".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "iPhone 实时预览组件没有响应通道".to_string())?;
        Ok(Self {
            child,
            stdin,
            stdout: BufReader::new(stdout),
        })
    }

    fn send(&mut self, operation: &str, payload: Value) -> Result<(), String> {
        if let Some(status) = self
            .child
            .try_wait()
            .map_err(|error| format!("无法检查 iPhone 实时预览组件：{error}"))?
        {
            return Err(format!("iPhone 实时预览组件已退出：{status}"));
        }
        let request = serde_json::to_string(&PreviewHelperRequest { operation, payload })
            .map_err(|error| format!("无法编码 iPhone 实时预览请求：{error}"))?;
        writeln!(self.stdin, "{request}")
            .and_then(|_| self.stdin.flush())
            .map_err(|error| format!("无法发送 iPhone 实时预览请求：{error}"))?;

        let mut line = String::new();
        let bytes = self
            .stdout
            .read_line(&mut line)
            .map_err(|error| format!("无法读取 iPhone 实时预览响应：{error}"))?;
        if bytes == 0 {
            return Err("iPhone 实时预览组件未返回响应".to_string());
        }
        let response: PreviewHelperResponse = serde_json::from_str(&line)
            .map_err(|error| format!("iPhone 实时预览组件返回了无效响应：{error}"))?;
        if response.ok {
            Ok(())
        } else {
            Err(response
                .error
                .unwrap_or_else(|| "无法启动 iPhone 实时预览".to_string()))
        }
    }

    fn stop(mut self) {
        let _ = self.send("stopMirrorPreview", json!({}));
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for PreviewProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[derive(Clone, Copy)]
struct SavedWindowPlacement {
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    resizable: bool,
}

#[derive(Default)]
pub struct IosMirrorPreviewManager {
    process: Mutex<Option<PreviewProcess>>,
    interaction: Mutex<Option<SavedWindowPlacement>>,
}

impl IosMirrorPreviewManager {
    pub fn update_preview(
        &self,
        app: &AppHandle,
        window: &Window,
        request: IosMirrorPreviewRequest,
    ) -> Result<(), String> {
        request.validate()?;
        let host_window_id = host_window_id(window)?;
        let mut process = self
            .process
            .lock()
            .map_err(|_| "无法锁定 iPhone 实时预览状态".to_string())?;
        if process.is_none() {
            *process = Some(PreviewProcess::spawn(app)?);
        }
        let payload = json!({
            "hostPid": std::process::id(),
            "hostWindowId": host_window_id,
            "hostFocused": window.is_focused().unwrap_or(false),
            "offsetX": request.offset_x,
            "offsetY": request.offset_y,
            "width": request.width,
            "height": request.height,
        });
        let result = process
            .as_mut()
            .ok_or_else(|| "iPhone 实时预览组件没有启动".to_string())?
            .send("setMirrorPreview", payload);
        if result.is_err() {
            if let Some(process) = process.take() {
                process.stop();
            }
        }
        result
    }

    pub fn stop_preview(&self) -> Result<(), String> {
        let process = self
            .process
            .lock()
            .map_err(|_| "无法锁定 iPhone 实时预览状态".to_string())?
            .take();
        if let Some(process) = process {
            process.stop();
        }
        Ok(())
    }

    pub fn enter_interaction(&self, app: &AppHandle, window: &Window) -> Result<(), String> {
        self.stop_preview()?;
        let mut interaction = self
            .interaction
            .lock()
            .map_err(|_| "无法锁定 iPhone 镜像交互状态".to_string())?;
        if interaction.is_some() {
            return Ok(());
        }
        let layout: MirrorInteractionLayout =
            bridge::request(app, "showMirrorInteraction", json!({}))?;
        validate_companion_bounds(&layout.companion_bounds)?;
        let saved = SavedWindowPlacement {
            position: window
                .outer_position()
                .map_err(|error| format!("无法读取 StowMind 窗口位置：{error}"))?,
            size: window
                .outer_size()
                .map_err(|error| format!("无法读取 StowMind 窗口尺寸：{error}"))?,
            resizable: window.is_resizable().unwrap_or(true),
        };
        if let Err(error) = apply_companion_window(window, &layout.companion_bounds) {
            let _ = restore_window(window, saved);
            return Err(error);
        }
        *interaction = Some(saved);
        Ok(())
    }

    pub fn exit_interaction(&self, window: &Window) -> Result<(), String> {
        let saved = self
            .interaction
            .lock()
            .map_err(|_| "无法锁定 iPhone 镜像交互状态".to_string())?
            .take();
        if let Some(saved) = saved {
            restore_window(window, saved)?;
        }
        Ok(())
    }
}

fn validate_companion_bounds(bounds: &IosWindowBounds) -> Result<(), String> {
    let values = [bounds.x, bounds.y, bounds.width, bounds.height];
    if values.iter().any(|value| !value.is_finite()) {
        return Err("iPhone 交互伴随窗口包含无效坐标".to_string());
    }
    if !(COMPANION_MIN_WIDTH..=640.0).contains(&bounds.width)
        || !(COMPANION_MIN_HEIGHT..=900.0).contains(&bounds.height)
    {
        return Err("iPhone 交互伴随窗口尺寸不安全".to_string());
    }
    Ok(())
}

fn apply_companion_window(window: &Window, bounds: &IosWindowBounds) -> Result<(), String> {
    window
        .set_min_size(Some(LogicalSize::new(
            COMPANION_MIN_WIDTH,
            COMPANION_MIN_HEIGHT,
        )))
        .map_err(|error| format!("无法设置 iPhone 伴随窗口最小尺寸：{error}"))?;
    window
        .set_size(LogicalSize::new(bounds.width, bounds.height))
        .map_err(|error| format!("无法调整 iPhone 伴随窗口尺寸：{error}"))?;
    window
        .set_position(LogicalPosition::new(bounds.x, bounds.y))
        .map_err(|error| format!("无法移动 iPhone 伴随窗口：{error}"))?;
    window
        .set_resizable(false)
        .map_err(|error| format!("无法锁定 iPhone 伴随窗口尺寸：{error}"))?;
    window
        .set_always_on_top(true)
        .map_err(|error| format!("无法保持 iPhone 伴随窗口可见：{error}"))?;
    window
        .show()
        .and_then(|_| window.unminimize())
        .map_err(|error| format!("无法显示 iPhone 伴随窗口：{error}"))
}

fn restore_window(window: &Window, saved: SavedWindowPlacement) -> Result<(), String> {
    window
        .set_always_on_top(false)
        .map_err(|error| format!("无法恢复 StowMind 窗口层级：{error}"))?;
    window
        .set_min_size(Some(LogicalSize::new(
            COMPANION_MIN_WIDTH,
            COMPANION_MIN_HEIGHT,
        )))
        .map_err(|error| format!("无法准备恢复 StowMind 窗口：{error}"))?;
    window
        .set_size(saved.size)
        .map_err(|error| format!("无法恢复 StowMind 窗口尺寸：{error}"))?;
    window
        .set_position(saved.position)
        .map_err(|error| format!("无法恢复 StowMind 窗口位置：{error}"))?;
    window
        .set_resizable(saved.resizable)
        .map_err(|error| format!("无法恢复 StowMind 窗口缩放状态：{error}"))?;
    window
        .set_min_size(Some(LogicalSize::new(APP_MIN_WIDTH, APP_MIN_HEIGHT)))
        .map_err(|error| format!("无法恢复 StowMind 最小窗口尺寸：{error}"))
}

#[cfg(target_os = "macos")]
#[allow(unexpected_cfgs)]
fn host_window_id(window: &Window) -> Result<u32, String> {
    use objc::runtime::Object;
    use objc::{msg_send, sel, sel_impl};

    let ns_window = window
        .ns_window()
        .map_err(|error| format!("无法读取 StowMind 主窗口：{error}"))?
        as *mut Object;
    let number: isize = unsafe { msg_send![ns_window, windowNumber] };
    u32::try_from(number).map_err(|_| "StowMind 主窗口编号无效".to_string())
}

#[cfg(not(target_os = "macos"))]
fn host_window_id(_: &Window) -> Result<u32, String> {
    Err("iPhone 实时预览仅支持 macOS".to_string())
}

#[cfg(test)]
mod tests {
    use super::IosMirrorPreviewRequest;

    #[test]
    fn preview_bounds_reject_invalid_or_unbounded_values() {
        let valid = IosMirrorPreviewRequest {
            offset_x: 120.0,
            offset_y: 80.0,
            width: 280.0,
            height: 610.0,
        };
        assert!(valid.validate().is_ok());
        assert!(IosMirrorPreviewRequest {
            width: f64::NAN,
            ..valid
        }
        .validate()
        .is_err());
        assert!(IosMirrorPreviewRequest {
            width: 100.0,
            ..valid
        }
        .validate()
        .is_err());
        assert!(IosMirrorPreviewRequest {
            offset_x: 10_000.0,
            ..valid
        }
        .validate()
        .is_err());
    }
}
