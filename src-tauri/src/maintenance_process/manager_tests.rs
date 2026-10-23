//! Manager ownership regressions use the same harmless process fixtures.
use super::*;
use std::sync::{atomic::AtomicBool, Arc};

#[cfg(unix)]
#[test]
fn closing_the_owning_window_recovers_retained_cleanup_without_a_live_ui() {
    use std::os::unix::process::CommandExt;
    let manager = MaintenanceManager::default();
    let context = manager
        .begin("main", "window-close-pending", Duration::from_secs(5))
        .unwrap();
    let mut fixture = Fixture::new();
    let mut command = fixture.command("printf '%s\\n' \"$$\" > \"$1\"; exec sleep 20");
    command
        .process_group(0)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let child = command.spawn().unwrap();
    let pids = fixture.ready();
    context.hold_cleanup_for_test(child, Arc::new(AtomicBool::new(true)));
    drop(context);
    manager.cancel_window("secondary");
    thread::sleep(Duration::from_millis(30));
    assert!(
        pids.iter().all(|pid| running(*pid)),
        "Another window cannot recover or signal this worker"
    );
    manager.cancel_window("main");
    let deadline = Instant::now() + Duration::from_secs(4);
    while pids.iter().any(|pid| running(*pid)) {
        assert!(
            Instant::now() < deadline,
            "Window-close cancellation did not stop its retained worker"
        );
        thread::sleep(Duration::from_millis(20));
    }
    manager
        .wait_finished("main", "window-close-pending", Duration::from_secs(1))
        .unwrap();
    assert!(manager
        .begin("main", "after-window-close", Duration::from_secs(1))
        .is_ok());
}

#[test]
fn cancellation_before_registration_prevents_the_process_from_starting() {
    let manager = MaintenanceManager::default();
    manager.cancel("main", "cancel-before-register").unwrap();
    manager
        .wait_finished("main", "cancel-before-register", Duration::from_millis(20))
        .unwrap();
    let error = manager
        .begin("main", "cancel-before-register", Duration::from_secs(1))
        .err()
        .unwrap();
    assert_eq!(error.code, "cancelled");
    assert!(!error.process_started);
    assert!(manager
        .begin("main", "fresh-after-tombstone", Duration::from_secs(1))
        .is_ok());
}

#[test]
fn windows_cannot_cancel_or_wait_on_another_windows_run() {
    let manager = MaintenanceManager::default();
    let context = manager
        .begin("main", "window-owned", Duration::from_secs(1))
        .unwrap();
    assert_eq!(
        manager
            .cancel("secondary", "window-owned")
            .err()
            .unwrap()
            .code,
        "invalid_run"
    );
    assert_eq!(
        manager
            .wait_finished("secondary", "window-owned", Duration::from_millis(10))
            .err()
            .unwrap()
            .code,
        "invalid_run"
    );
    context.check().unwrap();
    manager.cancel_window("secondary");
    context.check().unwrap();
    manager.cancel_window("main");
    assert_eq!(context.check().err().unwrap().code, "cancelled");
}

#[test]
fn duplicate_and_global_busy_requests_preserve_the_original_owner() {
    let manager = MaintenanceManager::default();
    let context = manager
        .begin("main", "original-owner", Duration::from_secs(1))
        .unwrap();
    assert_eq!(
        manager
            .begin("main", "original-owner", Duration::from_secs(1))
            .err()
            .unwrap()
            .code,
        "invalid_run"
    );
    assert_eq!(
        manager
            .begin("main", "different-id", Duration::from_secs(1))
            .err()
            .unwrap()
            .code,
        "busy"
    );
    assert_eq!(
        manager
            .begin("secondary", "other-window", Duration::from_secs(1))
            .err()
            .unwrap()
            .code,
        "busy"
    );
    context.check().unwrap();
    assert!(manager
        .wait_finished("main", "original-owner", Duration::from_millis(5))
        .is_err());
    drop(context);
    manager
        .wait_finished("main", "original-owner", Duration::from_millis(20))
        .unwrap();
    assert_eq!(
        manager
            .begin("main", "original-owner", Duration::from_secs(1))
            .err()
            .unwrap()
            .code,
        "invalid_run"
    );
    assert!(manager
        .begin("main", "next-owner", Duration::from_secs(1))
        .is_ok());
}

#[test]
fn cancellation_even_before_spawn_does_not_turn_exit_zero_into_success() {
    let manager = MaintenanceManager::default();
    let context = manager
        .begin("main", "cancel-before-spawn", Duration::from_secs(1))
        .unwrap();
    manager.cancel("main", "cancel-before-spawn").unwrap();
    let error = context
        .run(&mut shell("printf should-not-execute; exit 0"), None)
        .err()
        .unwrap();
    assert_eq!(error.code, "cancelled");
    assert!(!error.process_started);
    assert!(error.raw_output.is_empty());
}

#[test]
fn spawn_failure_does_not_claim_execution_or_poison_future_runs() {
    let manager = MaintenanceManager::default();
    let context = manager
        .begin("main", "spawn-failure", Duration::from_secs(1))
        .unwrap();
    let error = context
        .run(&mut Command::new("/does-not-exist/stowmind-fixture"), None)
        .err()
        .unwrap();
    assert_eq!(error.code, "failed");
    assert!(!error.process_started);
    drop(context);
    manager
        .wait_finished("main", "spawn-failure", Duration::from_millis(50))
        .unwrap();
    assert!(manager
        .begin("main", "after-spawn-failure", Duration::from_secs(1))
        .is_ok());
}

#[cfg(unix)]
#[test]
fn unconfirmed_cleanup_retains_global_ownership_after_context_drop_until_retry_succeeds() {
    use std::os::unix::process::CommandExt;
    let manager = MaintenanceManager::default();
    let context = manager
        .begin("main", "pending-cleanup", Duration::from_secs(5))
        .unwrap();
    let mut fixture = Fixture::new();
    let mut command = fixture.command("printf '%s\\n' \"$$\" > \"$1\"; exec sleep 20");
    command
        .process_group(0)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let child = command.spawn().unwrap();
    let pids = fixture.ready();
    let allowed = Arc::new(AtomicBool::new(false));
    context.hold_cleanup_for_test(child, allowed.clone());
    drop(context);
    let error = manager
        .wait_finished("main", "pending-cleanup", Duration::from_millis(20))
        .err()
        .unwrap();
    assert_eq!(error.code, "failed");
    assert!(error.cleanup_pending);
    assert!(
        pids.iter().all(|pid| running(*pid)),
        "Injected failed cleanup must not fake an exit"
    );
    assert_eq!(
        manager
            .begin("main", "premature-replacement", Duration::from_secs(1))
            .err()
            .unwrap()
            .code,
        "busy"
    );
    assert_eq!(
        manager
            .cancel("secondary", "pending-cleanup")
            .err()
            .unwrap()
            .code,
        "invalid_run"
    );
    manager.cancel("main", "pending-cleanup").unwrap();
    assert!(
        manager
            .wait_finished("main", "pending-cleanup", Duration::from_millis(20))
            .err()
            .unwrap()
            .cleanup_pending
    );
    allowed.store(true, Ordering::SeqCst);
    manager
        .wait_finished("main", "pending-cleanup", Duration::from_secs(4))
        .unwrap();
    assert!(
        pids.into_iter().all(|pid| !running(pid)),
        "A successful retry confirms and reaps the actual child"
    );
    assert!(manager
        .begin("main", "after-pending-recovered", Duration::from_secs(1))
        .is_ok());
}
