use super::*;

fn active_manager() -> IosExecutionManager {
    let manager = IosExecutionManager::default();
    manager.set_organizer_active(true, 1, |_| Ok(())).unwrap();
    manager
}

#[test]
fn stale_lifecycle_cleanup_cannot_deactivate_a_new_page_generation() {
    let manager = IosExecutionManager::default();
    manager.set_organizer_active(true, 1, |_| Ok(())).unwrap();
    manager.set_organizer_active(false, 2, |_| Ok(())).unwrap();
    manager.set_organizer_active(true, 3, |_| Ok(())).unwrap();
    manager.set_organizer_active(false, 2, |_| Ok(())).unwrap();
    assert_eq!(manager.request_generation().unwrap(), 3);
    let inventory = manager.claim_inventory().unwrap();
    drop(inventory);
}

#[test]
fn lifecycle_deactivation_marks_an_active_session_cancelled() {
    let manager = active_manager();
    manager.claim("session").unwrap();
    let mut persisted = None;
    manager
        .set_organizer_active(false, 2, |session_id| {
            persisted = Some(session_id.to_string());
            Ok(())
        })
        .unwrap();
    assert_eq!(persisted.as_deref(), Some("session"));
    assert!(manager.cancelled.load(Ordering::SeqCst));
    assert!(manager.claim_for_generation("session", 1).is_err());
}

#[test]
fn inventory_stop_only_cancels_an_owned_inventory() {
    let manager = active_manager();
    assert!(!manager.cancel_inventory().unwrap());
    assert!(!manager.cancelled.load(Ordering::SeqCst));
    manager.claim("execution").unwrap();
    assert!(!manager.cancel_inventory().unwrap());
    assert!(!manager.cancelled.load(Ordering::SeqCst));
    manager.request_pause("execution").unwrap();
    manager.running.store(false, Ordering::SeqCst);
    assert!(!manager.cancel_inventory().unwrap());
    assert!(!manager.cancelled.load(Ordering::SeqCst));
}

#[test]
fn inventory_stop_keeps_reservation_until_helper_returns() {
    let manager = active_manager();
    let inventory = manager.claim_inventory().unwrap();
    assert!(manager.cancel_inventory().unwrap());
    assert!(manager.cancelled.load(Ordering::SeqCst));
    assert!(manager.claim_inventory().is_err());
    assert!(manager.claim("execution").is_err());
    drop(inventory);
    assert!(!manager.cancel_inventory().unwrap());
    let next = manager.claim_inventory().unwrap();
    assert!(!manager.cancelled.load(Ordering::SeqCst));
    drop(next);
}

#[test]
fn interaction_requires_runner_exit_but_allows_paused_guidance() {
    let manager = active_manager();
    let entered = AtomicBool::new(false);
    let enter = || {
        entered.store(true, Ordering::SeqCst);
        Ok(())
    };
    let inventory = manager.claim_inventory().unwrap();
    assert!(manager.with_idle_input(enter).is_err());
    assert!(!entered.load(Ordering::SeqCst));
    drop(inventory);
    manager.claim("execution").unwrap();
    manager.request_pause("execution").unwrap();
    assert!(manager.with_idle_input(enter).is_err());
    assert!(!entered.load(Ordering::SeqCst));
    manager.running.store(false, Ordering::SeqCst);
    assert!(manager.with_idle_input(enter).is_ok());
    assert!(entered.load(Ordering::SeqCst));
}

#[test]
fn paused_flag_does_not_allow_overlapping_runners() {
    let manager = active_manager();
    manager.claim("a").unwrap();
    manager.request_pause("a").unwrap();
    assert!(manager.claim("a").is_err());
    assert!(manager.claim("b").is_err());
    manager.running.store(false, Ordering::SeqCst);
    manager.claim("a").unwrap();
}

#[test]
fn cancel_cannot_admit_a_new_runner_until_old_action_exits() {
    let manager = active_manager();
    manager.claim("a").unwrap();
    manager.request_pause("a").unwrap();
    manager.request_cancel("a");
    assert!(manager.claim("b").is_err());
    assert!(manager.cancelled.load(Ordering::SeqCst));
    manager.clear("a");
    manager.running.store(false, Ordering::SeqCst);
    manager.claim("b").unwrap();
}

#[test]
fn inventory_reservation_excludes_execution_and_other_scans() {
    let manager = active_manager();
    let inventory = manager.claim_inventory().unwrap();
    assert!(manager.claim("a").is_err());
    assert!(manager.claim_inventory().is_err());
    drop(inventory);
    manager.claim("a").unwrap();
    assert!(manager.claim_inventory().is_err());
}

#[test]
fn paused_execution_requires_cancellation_before_inventory() {
    let manager = active_manager();
    manager.claim("a").unwrap();
    manager.request_pause("a").unwrap();
    manager.running.store(false, Ordering::SeqCst);
    assert!(manager.claim_inventory().is_err());
    manager.request_cancel("a");
    assert!(manager.claim_inventory().is_ok());
}

#[test]
fn cancelled_runner_must_exit_before_inventory_can_start() {
    let manager = active_manager();
    manager.claim("a").unwrap();
    manager.request_pause("a").unwrap();
    manager.request_cancel("a");
    assert!(manager.claim_inventory().is_err());
    manager.clear("a");
    assert!(manager.claim_inventory().is_err());
    manager.running.store(false, Ordering::SeqCst);
    assert!(manager.claim_inventory().is_ok());
}

#[test]
fn inventory_drop_preserves_stop_flags() {
    let manager = active_manager();
    let inventory = manager.claim_inventory().unwrap();
    manager.cancel_active();
    drop(inventory);
    assert!(manager.cancelled.load(Ordering::SeqCst));
    assert!(!manager.running.load(Ordering::SeqCst));
}

#[test]
fn a_new_inventory_clears_only_a_previous_stop_request() {
    let manager = active_manager();
    assert!(manager.cancel_active().is_none());
    assert!(manager.cancelled.load(Ordering::SeqCst));
    let inventory = manager.claim_inventory().unwrap();
    assert!(!manager.cancelled.load(Ordering::SeqCst));
    assert!(manager.cancel_active().is_none());
    assert!(manager.cancelled.load(Ordering::SeqCst));
    drop(inventory);
    assert!(manager.cancelled.load(Ordering::SeqCst));
}

#[test]
fn stale_session_requests_cannot_reset_new_session_flags() {
    let manager = active_manager();
    manager.claim("new").unwrap();
    manager.request_pause("new").unwrap();
    manager.clear("old");
    manager.request_cancel("old");
    assert!(manager.paused.load(Ordering::SeqCst));
    assert!(!manager.cancelled.load(Ordering::SeqCst));
    manager.request_cancel("new");
    assert!(manager.request_pause("new").is_err());
    assert!(manager.cancelled.load(Ordering::SeqCst));
}

#[test]
fn stale_resume_cannot_resurrect_a_cancelled_paused_session() {
    let manager = active_manager();
    manager.claim("a").unwrap();
    manager.request_pause("a").unwrap();
    manager.running.store(false, Ordering::SeqCst);
    manager.request_cancel("a");
    assert!(manager.claim("a").is_err());
    manager.claim("b").unwrap();
}

#[test]
fn cancellation_while_paused_runner_returns_does_not_strand_ownership() {
    let manager = active_manager();
    manager.claim("a").unwrap();
    manager.request_pause("a").unwrap();
    manager.request_cancel("a");
    assert!(manager.claim_inventory().is_err());
    manager.running.store(false, Ordering::SeqCst);
    assert!(manager.claim_inventory().is_ok());
    assert!(manager.claim("a").is_err());
}

#[test]
fn persistence_observes_control_flags_in_cancel_pause_order() {
    let manager = active_manager();
    manager.claim("a").unwrap();
    manager.request_pause("a").unwrap();
    assert_eq!(
        manager
            .with_control_lock(|cancelled, paused| (cancelled, paused))
            .unwrap(),
        (false, true)
    );
    manager.request_cancel("a");
    assert_eq!(
        manager
            .with_control_lock(|cancelled, paused| (cancelled, paused))
            .unwrap(),
        (true, false)
    );
}
