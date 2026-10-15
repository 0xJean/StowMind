use super::execution::now_string;
use super::storage;
use super::types::IosExecutionStatus;
use std::collections::HashSet;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::{AppHandle, GlobalShortcutManager, Manager};

#[derive(Default)]
struct ControlState {
    organizer_active: bool,
    organizer_generation: u64,
    active_session: Option<String>,
    inventory_active: bool,
    cancelled_sessions: HashSet<String>,
}

#[derive(Default)]
pub struct IosExecutionManager {
    control: Mutex<ControlState>,
    pub(super) running: AtomicBool,
    pub(super) paused: AtomicBool,
    pub(super) cancelled: AtomicBool,
}

/// Owns the input reservation for a complete inventory traversal, including
/// time spent awaiting a blocking helper. Dropping it never alters execution
/// pause/cancel requests.
pub struct IosInventoryGuard<'a> {
    manager: &'a IosExecutionManager,
}

impl Drop for IosInventoryGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut control) = self.manager.control.lock() {
            control.inventory_active = false;
            self.manager.running.store(false, Ordering::SeqCst);
        }
    }
}

impl IosExecutionManager {
    pub fn request_generation(&self) -> Result<u64, String> {
        let control = self
            .control
            .lock()
            .map_err(|_| "无法锁定 iPhone 操作状态".to_string())?;
        if !control.organizer_active {
            return Err("请返回 iPhone 整理页面后重新开始".to_string());
        }
        Ok(control.organizer_generation)
    }

    /// Keep the input gate, cancellation, and persistence in one critical section.
    /// The callback must not call another method that acquires the control lock.
    pub fn set_organizer_active(
        &self,
        active: bool,
        generation: u64,
        persist_cancelled: impl FnOnce(&str) -> Result<(), String>,
    ) -> Result<(), String> {
        let mut control = self
            .control
            .lock()
            .map_err(|_| "无法锁定 iPhone 操作状态".to_string())?;
        if generation <= control.organizer_generation {
            return Ok(());
        }
        control.organizer_generation = generation;
        control.organizer_active = active;
        if !active {
            let session = control.active_session.clone();
            self.cancel_locked(&mut control);
            if let Some(session_id) = session {
                persist_cancelled(&session_id)?;
            }
        }
        Ok(())
    }

    #[cfg(test)]
    fn claim(&self, session_id: &str) -> Result<(), String> {
        self.claim_for_generation(session_id, self.request_generation()?)
    }

    pub(super) fn claim_for_generation(
        &self,
        session_id: &str,
        generation: u64,
    ) -> Result<(), String> {
        if let Ok(mut control) = self.control.lock() {
            if !control.organizer_active || generation != control.organizer_generation {
                return Err("整理页面状态已变化，请返回页面后重新开始".to_string());
            }
            if control.cancelled_sessions.contains(session_id) {
                return Err("已取消的 iPhone 整理会话不能继续".to_string());
            }
            if let Some(current) = control.active_session.as_deref() {
                if current != session_id {
                    return Err("另一个 iPhone 整理会话正在运行".to_string());
                }
                if !self.paused.load(Ordering::SeqCst) {
                    return Err("该 iPhone 整理会话已经在运行".to_string());
                }
            }
            if self
                .running
                .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                .is_err()
            {
                return Err("上一个整理动作尚未停止，请稍后再继续".to_string());
            }
            control.active_session = Some(session_id.to_string());
            self.paused.store(false, Ordering::SeqCst);
            self.cancelled.store(false, Ordering::SeqCst);
        } else {
            return Err("无法锁定 iPhone 整理会话".to_string());
        }
        Ok(())
    }

    pub fn claim_inventory(&self) -> Result<IosInventoryGuard<'_>, String> {
        let mut control = self
            .control
            .lock()
            .map_err(|_| "无法锁定 iPhone 盘点会话".to_string())?;
        if !control.organizer_active {
            return Err("请返回 iPhone 整理页面后重新盘点".to_string());
        }
        if control.active_session.is_some()
            || self
                .running
                .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                .is_err()
        {
            return Err("整理或盘点尚未停止，请先结束当前会话再重新盘点".to_string());
        }
        control.inventory_active = true;
        self.cancelled.store(false, Ordering::SeqCst);
        Ok(IosInventoryGuard { manager: self })
    }

    pub fn cancel_inventory(&self) -> Result<bool, String> {
        let control = self
            .control
            .lock()
            .map_err(|_| "无法锁定 iPhone 盘点会话".to_string())?;
        if !control.inventory_active || control.active_session.is_some() {
            return Ok(false);
        }
        self.cancelled.store(true, Ordering::SeqCst);
        Ok(true)
    }

    pub fn with_idle_input<R>(
        &self,
        action: impl FnOnce() -> Result<R, String>,
    ) -> Result<R, String> {
        let control = self
            .control
            .lock()
            .map_err(|_| "无法锁定 iPhone 操作状态".to_string())?;
        if !control.organizer_active {
            return Err("请返回 iPhone 整理页面后再进入真实镜像交互".to_string());
        }
        if self.running.load(Ordering::SeqCst) {
            return Err(
                "盘点或整理动作尚未停止，请先停止或等待完成，再进入真实镜像交互".to_string(),
            );
        }
        action()
    }

    pub(super) fn clear(&self, session_id: &str) {
        if let Ok(mut control) = self.control.lock() {
            if control.active_session.as_deref() == Some(session_id) {
                control.active_session = None;
                self.paused.store(false, Ordering::SeqCst);
                self.cancelled.store(false, Ordering::SeqCst);
            }
        }
    }

    fn cancel_locked(&self, control: &mut ControlState) {
        if let Some(session_id) = control.active_session.as_ref() {
            control.cancelled_sessions.insert(session_id.clone());
        }
        self.cancelled.store(true, Ordering::SeqCst);
        // Release paused ownership even while its runner is returning, so a
        // cancel at that boundary cannot strand the active session. The running
        // reservation still blocks every new execution and inventory traversal.
        if self.paused.load(Ordering::SeqCst) {
            control.active_session = None;
            self.paused.store(false, Ordering::SeqCst);
        }
    }

    fn cancel_active(&self) -> Option<String> {
        let mut control = self.control.lock().ok()?;
        let session_id = control.active_session.clone();
        self.cancel_locked(&mut control);
        session_id
    }

    pub fn request_pause(&self, session_id: &str) -> Result<(), String> {
        let control = self
            .control
            .lock()
            .map_err(|_| "无法锁定 iPhone 整理会话".to_string())?;
        if control.active_session.as_deref() != Some(session_id)
            || self.cancelled.load(Ordering::SeqCst)
        {
            return Err("找不到正在运行的 iPhone 整理会话".to_string());
        }
        self.paused.store(true, Ordering::SeqCst);
        Ok(())
    }

    pub fn request_cancel(&self, session_id: &str) {
        if let Ok(mut control) = self.control.lock() {
            if control.active_session.as_deref() == Some(session_id) {
                self.cancel_locked(&mut control);
            }
        }
    }

    /// Serialize persistence with control requests. Arguments are cancelled,
    /// then paused. The callback must not call any manager method taking this
    /// same lock (including clear, request_pause and request_cancel).
    pub(super) fn with_control_lock<R>(
        &self,
        callback: impl FnOnce(bool, bool) -> R,
    ) -> Result<R, String> {
        let _control = self
            .control
            .lock()
            .map_err(|_| "无法锁定 iPhone 整理会话".to_string())?;
        Ok(callback(
            self.cancelled.load(Ordering::SeqCst),
            self.paused.load(Ordering::SeqCst),
        ))
    }
}

pub fn register_emergency_shortcut(app: &AppHandle) {
    let handle = app.clone();
    let _ = app
        .global_shortcut_manager()
        .register("CommandOrControl+Shift+Escape", move || {
            let manager = handle.state::<IosExecutionManager>();
            if let Some(session_id) = manager.cancel_active() {
                let cancelled_session = manager.with_control_lock(|_, _| {
                    let mut session = storage::get_session(&handle, &session_id).ok()?;
                    if matches!(
                        session.status,
                        IosExecutionStatus::Completed | IosExecutionStatus::Failed
                    ) {
                        return None;
                    }
                    session.status = IosExecutionStatus::Cancelled;
                    session.error = Some("已通过紧急停止快捷键终止".to_string());
                    session.guidance_can_resume = false;
                    session.updated_at = now_string();
                    storage::save_session(&handle, &session).ok()?;
                    Some(session)
                });
                if let Ok(Some(session)) = cancelled_session {
                    let _ = handle.emit_all("ios-execution-cancelled", session);
                }
            }
        });
}

#[cfg(test)]
#[path = "execution_manager_tests.rs"]
mod tests;
