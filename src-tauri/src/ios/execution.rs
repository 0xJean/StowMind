use super::bridge;
use super::safety::{
    contains_forbidden_text, inventory_hash, inventory_matches, validate_batch,
    validate_plan_against_snapshot,
};
use super::storage;
use super::types::{
    IosExecutionSession, IosExecutionStatus, IosLayoutPlan, IosProgressEvent, IosWindowBounds,
};
use serde_json::to_value;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, GlobalShortcutManager, Manager, Window};

#[derive(Default)]
pub struct IosExecutionManager {
    active_session: Mutex<Option<String>>,
    paused: AtomicBool,
    cancelled: AtomicBool,
}

impl IosExecutionManager {
    fn claim(&self, session_id: &str) -> Result<(), String> {
        if let Ok(mut active) = self.active_session.lock() {
            if let Some(current) = active.as_deref() {
                if current != session_id {
                    return Err("另一个 iPhone 整理会话正在运行".to_string());
                }
                if !self.paused.load(Ordering::SeqCst) {
                    return Err("该 iPhone 整理会话已经在运行".to_string());
                }
            }
            *active = Some(session_id.to_string());
        } else {
            return Err("无法锁定 iPhone 整理会话".to_string());
        }
        self.paused.store(false, Ordering::SeqCst);
        self.cancelled.store(false, Ordering::SeqCst);
        Ok(())
    }

    fn clear(&self, session_id: &str) {
        if let Ok(mut active) = self.active_session.lock() {
            if active.as_deref() == Some(session_id) {
                *active = None;
            }
        }
        self.paused.store(false, Ordering::SeqCst);
        self.cancelled.store(false, Ordering::SeqCst);
    }

    fn release_cancelled(&self, session_id: &str) {
        if let Ok(mut active) = self.active_session.lock() {
            if active.as_deref() == Some(session_id) {
                *active = None;
            }
        }
        self.paused.store(false, Ordering::SeqCst);
        self.cancelled.store(true, Ordering::SeqCst);
    }

    fn active_id(&self) -> Option<String> {
        self.active_session
            .lock()
            .ok()
            .and_then(|value| value.clone())
    }

    pub fn request_pause(&self, session_id: &str) -> Result<(), String> {
        if self.active_id().as_deref() != Some(session_id) {
            return Err("找不到正在运行的 iPhone 整理会话".to_string());
        }
        self.paused.store(true, Ordering::SeqCst);
        Ok(())
    }

    pub fn request_cancel(&self, session_id: &str) {
        if self.active_id().as_deref() != Some(session_id) {
            return;
        }
        self.cancelled.store(true, Ordering::SeqCst);
        if self.paused.load(Ordering::SeqCst) {
            self.release_cancelled(session_id);
        }
    }
}

pub fn register_emergency_shortcut(app: &AppHandle) {
    let handle = app.clone();
    let _ = app
        .global_shortcut_manager()
        .register("CommandOrControl+Shift+Escape", move || {
            let manager = handle.state::<IosExecutionManager>();
            manager.cancelled.store(true, Ordering::SeqCst);
            if let Some(session_id) = manager.active_id() {
                if let Ok(mut session) = storage::get_session(&handle, &session_id) {
                    session.status = IosExecutionStatus::Cancelled;
                    session.error = Some("已通过紧急停止快捷键终止".to_string());
                    session.updated_at = now_string();
                    let _ = storage::save_session(&handle, &session);
                }
                if manager.paused.load(Ordering::SeqCst) {
                    manager.release_cancelled(&session_id);
                }
            }
        });
}

pub fn now_string() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

pub fn session_id() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    format!("ios-session-{millis}")
}

fn emit_progress(window: &Window, session: &IosExecutionSession, message: String) {
    let _ = window.emit(
        "ios-execution-progress",
        IosProgressEvent {
            session_id: session.id.clone(),
            current: session.current_index,
            total: session.total,
            status: format!("{:?}", session.status).to_lowercase(),
            message,
        },
    );
}

fn windows_match(expected: Option<&IosWindowBounds>, actual: Option<&IosWindowBounds>) -> bool {
    let (Some(expected), Some(actual)) = (expected, actual) else {
        return false;
    };
    let tolerance = 2.0;
    (expected.x - actual.x).abs() <= tolerance
        && (expected.y - actual.y).abs() <= tolerance
        && (expected.width - actual.width).abs() <= tolerance
        && (expected.height - actual.height).abs() <= tolerance
}

fn snapshot_contains_forbidden_text(snapshot: &super::types::IosLayoutSnapshot) -> bool {
    contains_forbidden_text(&snapshot.warnings.join("\n"))
        || snapshot
            .apps
            .iter()
            .any(|app| contains_forbidden_text(&app.name))
}

fn pause_for_guidance(
    window: &Window,
    app: &AppHandle,
    manager: &IosExecutionManager,
    session: &mut IosExecutionSession,
    message: String,
    can_resume: bool,
) -> Result<IosExecutionSession, String> {
    session.status = IosExecutionStatus::Paused;
    session.guidance_message = Some(message);
    session.guidance_can_resume = can_resume;
    session.updated_at = now_string();
    manager.paused.store(true, Ordering::SeqCst);
    storage::save_session(app, session)?;
    let _ = window.emit("ios-execution-paused", &*session);
    Ok(session.clone())
}

fn fail_execution(
    window: &Window,
    app: &AppHandle,
    manager: &IosExecutionManager,
    session: &mut IosExecutionSession,
    message: String,
) -> Result<IosExecutionSession, String> {
    session.status = IosExecutionStatus::Failed;
    session.error = Some(message.clone());
    session.guidance_can_resume = false;
    session.updated_at = now_string();
    storage::save_session(app, session)?;
    manager.clear(&session.id);
    let _ = window.emit("ios-execution-failed", &*session);
    Err(message)
}

fn stop_if_requested(
    app: &AppHandle,
    manager: &IosExecutionManager,
    session: &mut IosExecutionSession,
) -> Result<bool, String> {
    if !manager.cancelled.load(Ordering::SeqCst) {
        return Ok(false);
    }
    session.status = IosExecutionStatus::Cancelled;
    session.error = Some("执行已停止".to_string());
    session.updated_at = now_string();
    storage::save_session(app, session)?;
    manager.clear(&session.id);
    Ok(true)
}

pub async fn run_execution(
    window: Window,
    app: AppHandle,
    mut session: IosExecutionSession,
    plan: IosLayoutPlan,
    manager: &IosExecutionManager,
) -> Result<IosExecutionSession, String> {
    let baseline = storage::get_snapshot(&app, &plan.source_snapshot_id)?;
    validate_plan_against_snapshot(&plan, &baseline)?;
    manager.claim(&session.id)?;
    session.status = IosExecutionStatus::Running;
    session.error = None;
    session.guidance_message = None;
    session.guidance_can_resume = false;
    session.updated_at = now_string();
    storage::save_session(&app, &session)?;
    emit_progress(&window, &session, "开始执行前检查".to_string());

    while session.current_index < plan.operations.len() {
        if stop_if_requested(&app, manager, &mut session)? {
            return Ok(session);
        }
        if manager.paused.load(Ordering::SeqCst) {
            return pause_for_guidance(
                &window,
                &app,
                manager,
                &mut session,
                "执行已由用户暂停".to_string(),
                true,
            );
        }

        let current = storage::get_session(&app, &session.id)?;
        match current.status {
            IosExecutionStatus::Paused => {
                manager.paused.store(true, Ordering::SeqCst);
                return Ok(current);
            }
            IosExecutionStatus::Cancelled => {
                manager.cancelled.store(true, Ordering::SeqCst);
                manager.clear(&session.id);
                return Ok(current);
            }
            _ => {}
        }

        let mut preflight = match bridge::capture_snapshot(&app, None) {
            Ok(value) => value,
            Err(error) => {
                return fail_execution(
                    &window,
                    &app,
                    manager,
                    &mut session,
                    format!("动作前安全检查失败：{error}"),
                )
            }
        };
        preflight.inventory_hash = inventory_hash(&preflight.apps);
        if snapshot_contains_forbidden_text(&preflight) {
            return pause_for_guidance(
                &window,
                &app,
                manager,
                &mut session,
                "检测到删除、移除、隐藏或重置菜单，已暂停且不会点击菜单项".to_string(),
                false,
            );
        }
        if !windows_match(
            baseline.window_bounds.as_ref(),
            preflight.window_bounds.as_ref(),
        ) {
            return pause_for_guidance(
                &window,
                &app,
                manager,
                &mut session,
                "iPhone 镜像窗口已移动或缩放，请确认窗口后重新盘点".to_string(),
                false,
            );
        }
        if !preflight_matches_expected_page(
            &baseline,
            &preflight,
            &plan.operations[session.current_index],
        ) {
            return pause_for_guidance(
                &window,
                &app,
                manager,
                &mut session,
                "当前可观测 App 清单与方案来源不一致，请重新盘点".to_string(),
                false,
            );
        }

        let batch = validate_batch(&plan, session.current_index)?;
        for operation in batch {
            if stop_if_requested(&app, manager, &mut session)? {
                return Ok(session);
            }
            if manager.paused.load(Ordering::SeqCst) {
                return pause_for_guidance(
                    &window,
                    &app,
                    manager,
                    &mut session,
                    "执行已由用户暂停".to_string(),
                    true,
                );
            }

            let payload = to_value(operation).map_err(|error| error.to_string())?;
            let outcome = match bridge::execute_action(
                &app,
                &payload,
                &plan.source_snapshot_id,
                baseline.window_bounds.as_ref(),
            ) {
                Ok(value) => value,
                Err(error) => {
                    return fail_execution(
                        &window,
                        &app,
                        manager,
                        &mut session,
                        format!("镜像辅助动作失败：{error}"),
                    )
                }
            };
            if outcome.requires_guidance {
                return pause_for_guidance(
                    &window,
                    &app,
                    manager,
                    &mut session,
                    outcome
                        .message
                        .unwrap_or_else(|| "此动作需要人工确认".to_string()),
                    outcome.can_resume,
                );
            }
            if !outcome.performed && !outcome.already_satisfied {
                return fail_execution(
                    &window,
                    &app,
                    manager,
                    &mut session,
                    "辅助组件没有确认动作完成，已停止".to_string(),
                );
            }

            session.current_index += 1;
            session.guidance_message = None;
            session.updated_at = now_string();
            storage::save_session(&app, &session)?;
            emit_progress(
                &window,
                &session,
                format!("已完成第 {} 个安全动作", session.current_index),
            );
        }

        let mut checkpoint = match bridge::capture_snapshot(&app, None) {
            Ok(value) => value,
            Err(error) => {
                return fail_execution(
                    &window,
                    &app,
                    manager,
                    &mut session,
                    format!("动作后验证截图失败：{error}"),
                )
            }
        };
        checkpoint.inventory_hash = inventory_hash(&checkpoint.apps);
        if snapshot_contains_forbidden_text(&checkpoint) {
            return pause_for_guidance(
                &window,
                &app,
                manager,
                &mut session,
                "动作后检测到删除或移除菜单，已暂停且不会点击菜单项".to_string(),
                false,
            );
        }
        if !windows_match(
            baseline.window_bounds.as_ref(),
            checkpoint.window_bounds.as_ref(),
        ) {
            return pause_for_guidance(
                &window,
                &app,
                manager,
                &mut session,
                "执行过程中镜像窗口发生变化，已暂停".to_string(),
                false,
            );
        }
        if !preflight_matches_expected_page(
            &baseline,
            &checkpoint,
            &plan.operations[session.current_index.saturating_sub(1)],
        ) {
            return fail_execution(
                &window,
                &app,
                manager,
                &mut session,
                "执行后可观测 App 集合发生变化，已禁止继续".to_string(),
            );
        }

        storage::save_snapshot(&app, &checkpoint)?;
        session.last_verified_snapshot_id = Some(checkpoint.id);
        storage::save_session(&app, &session)?;
    }

    session.status = IosExecutionStatus::Completed;
    session.updated_at = now_string();
    storage::save_session(&app, &session)?;
    manager.clear(&session.id);
    let _ = window.emit("ios-execution-completed", &session);
    Ok(session)
}

fn operation_page(operation: &super::types::IosOperation) -> usize {
    match operation {
        super::types::IosOperation::MoveApp { from_page, .. }
        | super::types::IosOperation::MoveToDock { from_page, .. } => *from_page,
        super::types::IosOperation::CreateFolder { page, .. }
        | super::types::IosOperation::RenameFolder { page, .. } => *page,
    }
}

fn preflight_matches_expected_page(
    baseline: &super::types::IosLayoutSnapshot,
    actual: &super::types::IosLayoutSnapshot,
    operation: &super::types::IosOperation,
) -> bool {
    if baseline.scan_scope == actual.scan_scope {
        return inventory_matches(&baseline.apps, &actual.apps);
    }

    let expected_page = operation_page(operation);
    let expected = baseline
        .apps
        .iter()
        .filter(|app| {
            app.current_page == Some(expected_page) && !app.in_dock && app.folder_name.is_none()
        })
        .cloned()
        .collect::<Vec<_>>();
    inventory_matches(&expected, &actual.apps)
}
