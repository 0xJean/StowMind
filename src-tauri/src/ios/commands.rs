use super::bridge;
use super::execution::{now_string, run_execution, session_id, IosExecutionManager};
use super::inventory_scope::require_all_home_screen_pages;
use super::mirror_preview::IosMirrorPreviewManager;
use super::planner;
use super::safety::{
    inventory_hash, inventory_matches, layout_hash, snapshot_after_operations,
    validate_plan_against_snapshot,
};
use super::storage;
use super::types::{
    IosExecutionRequest, IosExecutionSession, IosExecutionStatus, IosLayoutPlan,
    IosMirrorPreviewRequest, IosPlanRequest, IosSnapshotRequest,
};
use tauri::{AppHandle, State, Window};

#[tauri::command]
pub fn ios_set_organizer_active(
    app: AppHandle,
    manager: State<'_, IosExecutionManager>,
    active: bool,
    generation: u64,
) -> Result<(), String> {
    manager.set_organizer_active(active, generation, |session_id| {
        let mut session = storage::get_session(&app, session_id)?;
        if matches!(
            session.status,
            IosExecutionStatus::Completed
                | IosExecutionStatus::Failed
                | IosExecutionStatus::Cancelled
        ) {
            return Ok(());
        }
        session.status = IosExecutionStatus::Cancelled;
        session.error = Some("已离开 iPhone 整理页面，执行已停止".to_string());
        session.guidance_can_resume = false;
        session.updated_at = now_string();
        storage::save_session(&app, &session)
    })
}

#[tauri::command]
pub async fn ios_capabilities(
    app: AppHandle,
) -> Result<super::types::IosDeviceCapabilities, String> {
    let probe_app = app.clone();
    tokio::task::spawn_blocking(move || bridge::capabilities(&probe_app))
        .await
        .map_err(|error| format!("无法完成 iPhone 镜像能力检查：{error}"))?
}

#[tauri::command]
pub async fn ios_open_mirroring() -> Result<(), String> {
    bridge::open_mirroring()
}

#[tauri::command]
pub async fn ios_reveal_current_app() -> Result<(), String> {
    bridge::reveal_current_app()
}

#[tauri::command]
pub async fn ios_open_permission_settings(permission: String) -> Result<(), String> {
    bridge::open_permission_settings(&permission)
}

#[tauri::command]
pub async fn ios_request_permission(app: AppHandle, permission: String) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || bridge::request_permission(&app, &permission))
        .await
        .map_err(|error| format!("无法完成权限请求任务：{error}"))?
}

#[tauri::command]
pub async fn ios_set_mirror_preview(
    window: Window,
    app: AppHandle,
    manager: State<'_, IosMirrorPreviewManager>,
    request: IosMirrorPreviewRequest,
) -> Result<(), String> {
    manager.update_preview(&app, &window, request)
}

#[tauri::command]
pub async fn ios_stop_mirror_preview(
    manager: State<'_, IosMirrorPreviewManager>,
) -> Result<(), String> {
    manager.stop_preview()
}

#[tauri::command]
pub async fn ios_enter_mirror_interaction(
    window: Window,
    app: AppHandle,
    manager: State<'_, IosMirrorPreviewManager>,
    execution: State<'_, IosExecutionManager>,
) -> Result<(), String> {
    execution.with_idle_input(|| manager.enter_interaction(&app, &window))
}

#[tauri::command]
pub async fn ios_exit_mirror_interaction(
    window: Window,
    manager: State<'_, IosMirrorPreviewManager>,
) -> Result<(), String> {
    manager.exit_interaction(&window)
}

#[tauri::command]
pub async fn ios_capture_snapshot(
    app: AppHandle,
    request: IosSnapshotRequest,
) -> Result<super::types::IosLayoutSnapshot, String> {
    let capture_app = app.clone();
    let mut snapshot = tokio::task::spawn_blocking(move || {
        bridge::capture_snapshot(&capture_app, request.device_name)
    })
    .await
    .map_err(|error| format!("无法完成 iPhone 镜像快照任务：{error}"))??;
    snapshot.inventory_hash = inventory_hash(&snapshot.apps);
    snapshot.layout_hash = layout_hash(&snapshot);
    storage::save_snapshot(&app, &snapshot)?;
    Ok(snapshot)
}

#[tauri::command]
pub async fn ios_scan_inventory(
    window: Window,
    app: AppHandle,
    manager: State<'_, IosExecutionManager>,
    request: IosSnapshotRequest,
) -> Result<super::types::IosLayoutSnapshot, String> {
    let _inventory = manager.claim_inventory()?;
    let _ = window.emit(
        "ios-scan-progress",
        serde_json::json!({
            "current": 0,
            "total": 100,
            "message": "正在定位 iPhone 镜像窗口"
        }),
    );
    let scan_app = app.clone();
    let mut snapshot =
        tokio::task::spawn_blocking(move || bridge::scan_inventory(&scan_app, request.device_name))
            .await
            .map_err(|error| format!("无法完成 iPhone 主屏幕盘点任务：{error}"))??;
    let _ = window.emit(
        "ios-scan-progress",
        serde_json::json!({
            "current": 70,
            "total": 100,
            "message": "正在校验可观测 App 清单"
        }),
    );
    manager.with_control_lock(|cancelled, _| {
        if cancelled {
            return Err("盘点已停止，请重新盘点后继续".to_string());
        }
        snapshot.inventory_hash = inventory_hash(&snapshot.apps);
        snapshot.layout_hash = layout_hash(&snapshot);
        storage::save_snapshot(&app, &snapshot)
    })??;
    let _ = window.emit(
        "ios-scan-progress",
        serde_json::json!({
            "current": 100,
            "total": 100,
            "message": format!("只读盘点完成：{} 个主屏幕页面", snapshot.pages.len())
        }),
    );
    Ok(snapshot)
}

#[tauri::command]
pub async fn ios_cancel_inventory(manager: State<'_, IosExecutionManager>) -> Result<bool, String> {
    manager.cancel_inventory()
}

#[tauri::command]
pub async fn ios_create_plan(
    window: Window,
    app: AppHandle,
    request: IosPlanRequest,
) -> Result<IosLayoutPlan, String> {
    let snapshot = storage::get_snapshot(&app, &request.snapshot_id)?;
    require_all_home_screen_pages(&snapshot)?;
    let mut plan = planner::create_plan(&snapshot, &request).await;
    validate_plan_against_snapshot(&plan, &snapshot)?;
    plan.target_layout_hash =
        Some(snapshot_after_operations(&snapshot, &plan.operations)?.layout_hash);
    storage::save_plan(&app, &plan)?;
    let _ = window.emit("ios-plan-ready", &plan);
    Ok(plan)
}

#[tauri::command]
pub async fn ios_start_execution(
    window: Window,
    app: AppHandle,
    manager: State<'_, IosExecutionManager>,
    request: IosExecutionRequest,
) -> Result<IosExecutionSession, String> {
    let generation = manager.request_generation()?;
    let plan = storage::get_plan(&app, &request.plan_id)?;
    let snapshot = storage::get_snapshot(&app, &plan.source_snapshot_id)?;
    require_all_home_screen_pages(&snapshot)?;
    validate_plan_against_snapshot(&plan, &snapshot)?;
    if plan.operations.is_empty() {
        return Err("整理方案没有可执行动作".to_string());
    }
    bridge::require_execution_ready(&app)?;

    let session = IosExecutionSession {
        id: session_id(),
        plan_id: plan.id.clone(),
        status: IosExecutionStatus::Pending,
        current_index: 0,
        total: plan.operations.len(),
        error: None,
        guidance_message: None,
        guidance_can_resume: false,
        last_verified_snapshot_id: None,
        created_at: now_string(),
        updated_at: now_string(),
    };
    storage::save_session(&app, &session)?;
    run_execution(window, app, session, plan, &manager, generation).await
}

#[tauri::command]
pub async fn ios_resume_execution(
    window: Window,
    app: AppHandle,
    manager: State<'_, IosExecutionManager>,
    session_id: String,
) -> Result<IosExecutionSession, String> {
    let generation = manager.request_generation()?;
    let session = storage::get_session(&app, &session_id)?;
    if session.status != IosExecutionStatus::Paused {
        return Err("只有已暂停的执行会话可以继续".to_string());
    }
    if !session.guidance_can_resume {
        return Err("当前步骤需要重新盘点后生成新方案，不能直接继续".to_string());
    }
    bridge::require_execution_ready(&app)?;
    let plan = storage::get_plan(&app, &session.plan_id)?;
    run_execution(window, app, session, plan, &manager, generation).await
}

#[tauri::command]
pub async fn ios_pause_execution(
    window: Window,
    app: AppHandle,
    manager: State<'_, IosExecutionManager>,
    session_id: String,
) -> Result<IosExecutionSession, String> {
    let session = storage::get_session(&app, &session_id)?;
    if matches!(
        session.status,
        IosExecutionStatus::Completed | IosExecutionStatus::Failed | IosExecutionStatus::Cancelled
    ) {
        return Ok(session);
    }
    manager.request_pause(&session.id)?;
    let session = manager.with_control_lock(|cancelled, _| {
        let mut session = storage::get_session(&app, &session_id)?;
        if !matches!(
            session.status,
            IosExecutionStatus::Completed
                | IosExecutionStatus::Failed
                | IosExecutionStatus::Cancelled
        ) {
            session.status = if cancelled {
                IosExecutionStatus::Cancelled
            } else {
                IosExecutionStatus::Paused
            };
            session.guidance_message = Some("执行已由用户暂停".to_string());
            session.guidance_can_resume = !cancelled;
            session.updated_at = now_string();
            storage::save_session(&app, &session)?;
        }
        Ok::<_, String>(session)
    })??;
    let _ = window.emit("ios-execution-paused", &session);
    Ok(session)
}

#[tauri::command]
pub async fn ios_cancel_execution(
    app: AppHandle,
    manager: State<'_, IosExecutionManager>,
    session_id: String,
) -> Result<IosExecutionSession, String> {
    manager.request_cancel(&session_id);
    manager.with_control_lock(|_, _| {
        let mut session = storage::get_session(&app, &session_id)?;
        if !matches!(
            session.status,
            IosExecutionStatus::Completed
                | IosExecutionStatus::Failed
                | IosExecutionStatus::Cancelled
        ) {
            session.status = IosExecutionStatus::Cancelled;
            session.guidance_can_resume = false;
            session.updated_at = now_string();
            storage::save_session(&app, &session)?;
        }
        Ok(session)
    })?
}

#[tauri::command]
pub async fn ios_prepare_restore(
    app: AppHandle,
    current_snapshot_id: String,
    target_snapshot_id: String,
) -> Result<IosLayoutPlan, String> {
    let current = storage::get_snapshot(&app, &current_snapshot_id)?;
    let target = storage::get_snapshot(&app, &target_snapshot_id)?;
    require_all_home_screen_pages(&current)?;
    require_all_home_screen_pages(&target)?;
    if !inventory_matches(&current.apps, &target.apps) {
        return Err("当前可观测 App 集合与目标快照不一致，不能生成恢复方案".to_string());
    }
    let mut plan = planner::create_restore_plan(&current, &target);
    validate_plan_against_snapshot(&plan, &current)?;
    plan.target_layout_hash =
        Some(snapshot_after_operations(&current, &plan.operations)?.layout_hash);
    storage::save_plan(&app, &plan)?;
    Ok(plan)
}
