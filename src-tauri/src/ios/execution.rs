use super::bridge;
use super::execution_checks::{
    action_context, apply_control_state, matches_another_page, matches_expected_page,
    matches_expected_target_page,
};
use super::inventory_scope::require_all_home_screen_pages;
use super::safety::{
    contains_forbidden_text, inventory_hash, layout_hash, snapshot_after_operations,
    validate_batch, validate_plan_against_snapshot,
};
use super::storage;
use super::types::{
    IosExecutionSession, IosExecutionStatus, IosLayoutPlan, IosProgressEvent, IosWindowBounds,
};
use serde_json::to_value;
use std::sync::atomic::Ordering;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Window};

pub use super::execution_manager::{register_emergency_shortcut, IosExecutionManager};

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

fn save_execution_session(
    app: &AppHandle,
    manager: &IosExecutionManager,
    session: &mut IosExecutionSession,
) -> Result<(), String> {
    manager.with_control_lock(|cancelled, paused| {
        let was_cancelled = storage::get_session(app, &session.id)
            .map(|saved| saved.status == IosExecutionStatus::Cancelled)
            .unwrap_or(false);
        apply_control_state(session, cancelled || was_cancelled, paused);
        storage::save_session(app, session)
    })?
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
    save_execution_session(app, manager, session)?;
    if session.status == IosExecutionStatus::Paused {
        let _ = window.emit("ios-execution-paused", &*session);
    }
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
    save_execution_session(app, manager, session)?;
    manager.clear(&session.id);
    if session.status == IosExecutionStatus::Cancelled {
        return Ok(session.clone());
    }
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
    save_execution_session(app, manager, session)?;
    manager.clear(&session.id);
    Ok(true)
}

pub async fn run_execution(
    window: Window,
    app: AppHandle,
    session: IosExecutionSession,
    plan: IosLayoutPlan,
    manager: &IosExecutionManager,
    generation: u64,
) -> Result<IosExecutionSession, String> {
    let baseline = storage::get_snapshot(&app, &plan.source_snapshot_id)?;
    require_all_home_screen_pages(&baseline)?;
    validate_plan_against_snapshot(&plan, &baseline)?;
    if session.plan_id != plan.id
        || session.total != plan.operations.len()
        || session.current_index > session.total
        || plan.operations.is_empty()
    {
        return Err("执行进度与已保存方案不一致，请重新生成方案".to_string());
    }
    let target = snapshot_after_operations(&baseline, &plan.operations)?;
    if plan.target_layout_hash.as_deref() != Some(target.layout_hash.as_str()) {
        return Err("方案缺少可靠的目标布局，请重新生成方案".to_string());
    }
    manager.claim_for_generation(&session.id, generation)?;
    let result =
        run_claimed_execution(&window, &app, session.clone(), &plan, &baseline, manager).await;
    if !matches!(&result, Ok(value) if value.status == IosExecutionStatus::Paused && value.guidance_can_resume)
    {
        manager.clear(&session.id);
    }
    if let Err(error) = &result {
        // Even persistence failures must release the runner. An uncertain action
        // must never be retried using the previous execution cursor.
        let mut failed = storage::get_session(&app, &session.id).unwrap_or(session);
        failed.status = IosExecutionStatus::Failed;
        failed.error = Some(error.clone());
        failed.guidance_can_resume = false;
        failed.updated_at = now_string();
        let _ = save_execution_session(&app, manager, &mut failed);
        let _ = window.emit("ios-execution-failed", &failed);
    }
    manager.running.store(false, Ordering::SeqCst);
    result
}

async fn run_claimed_execution(
    window: &Window,
    app: &AppHandle,
    mut session: IosExecutionSession,
    plan: &IosLayoutPlan,
    baseline: &super::types::IosLayoutSnapshot,
    manager: &IosExecutionManager,
) -> Result<IosExecutionSession, String> {
    session.status = IosExecutionStatus::Running;
    session.error = None;
    session.guidance_message = None;
    session.guidance_can_resume = false;
    session.updated_at = now_string();
    save_execution_session(&app, manager, &mut session)?;
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
        preflight.layout_hash = layout_hash(&preflight);
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
        let expected_before =
            snapshot_after_operations(&baseline, &plan.operations[..session.current_index])
                .map_err(|error| format!("无法构造动作前布局校验：{error}"))?;
        if !matches_expected_page(
            &expected_before,
            &preflight,
            &plan.operations[session.current_index],
        ) {
            let can_switch = matches_another_page(&expected_before, &preflight);
            let message = if can_switch {
                let super::types::IosOperation::MoveApp { from_page, .. } =
                    &plan.operations[session.current_index]
                else {
                    unreachable!()
                };
                format!(
                    "请在真实镜像中切换到第 {} 页并手动进入编辑模式，然后继续",
                    from_page + 1
                )
            } else {
                "当前 App 位置或识别结果与方案不一致，请重新盘点".to_string()
            };
            return pause_for_guidance(&window, &app, manager, &mut session, message, can_switch);
        }

        let batch = validate_batch(&plan, session.current_index)?;
        // SpringBoard may shift neighbouring icons after one drag. Verify the
        // entire visible page before allowing the next action.
        for operation in batch.iter().take(1) {
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
            let context = action_context(&expected_before, operation);
            let action_result = bridge::execute_action(
                &app,
                &payload,
                &context,
                &plan.source_snapshot_id,
                baseline.window_bounds.as_ref(),
            );
            // Cancellation can arrive while the helper is acting. Never let a
            // late completion or guidance result revive a cancelled session.
            if stop_if_requested(&app, manager, &mut session)? {
                return Ok(session);
            }
            let outcome = match action_result {
                Ok(value) => value,
                Err(error) => {
                    return fail_execution(
                        &window,
                        &app,
                        manager,
                        &mut session,
                        format!("无法确认镜像动作结果，已停止且不会重试；请重新盘点：{error}"),
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
            save_execution_session(&app, manager, &mut session)?;
            emit_progress(
                &window,
                &session,
                format!("已完成第 {} 个安全动作", session.current_index),
            );
        }

        let checkpoint_result = bridge::capture_snapshot(&app, None);
        if stop_if_requested(&app, manager, &mut session)? {
            return Ok(session);
        }
        let mut checkpoint = match checkpoint_result {
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
        checkpoint.layout_hash = layout_hash(&checkpoint);
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
        let expected_after =
            snapshot_after_operations(&baseline, &plan.operations[..session.current_index])
                .map_err(|error| format!("无法构造动作后布局校验：{error}"))?;
        if !matches_expected_target_page(
            &expected_after,
            &checkpoint,
            &plan.operations[session.current_index.saturating_sub(1)],
        ) {
            return fail_execution(
                &window,
                &app,
                manager,
                &mut session,
                "执行后 App 位置或识别结果与目标布局不一致，已停止；请重新盘点".to_string(),
            );
        }

        storage::save_snapshot(&app, &checkpoint)?;
        session.last_verified_snapshot_id = Some(checkpoint.id);
        save_execution_session(&app, manager, &mut session)?;
        if manager.paused.load(Ordering::SeqCst) {
            return pause_for_guidance(
                &window,
                &app,
                manager,
                &mut session,
                "执行已由用户暂停，当前动作的位置已验证".to_string(),
                true,
            );
        }
    }

    if stop_if_requested(&app, manager, &mut session)? {
        return Ok(session);
    }
    session.status = IosExecutionStatus::Completed;
    session.updated_at = now_string();
    save_execution_session(&app, manager, &mut session)?;
    if session.status == IosExecutionStatus::Completed {
        manager.clear(&session.id);
        let _ = window.emit("ios-execution-completed", &session);
    } else if session.status == IosExecutionStatus::Paused {
        let _ = window.emit("ios-execution-paused", &session);
    }
    Ok(session)
}
