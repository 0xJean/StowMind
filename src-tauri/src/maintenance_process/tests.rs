//! Regression fixtures exercise the real runner, never Mole or user data.
use super::{MaintenanceManager, OUTPUT_LIMIT};
use std::{
    fs,
    path::PathBuf,
    process::{Command, Stdio},
    sync::atomic::{AtomicU64, Ordering},
    thread,
    time::{Duration, Instant},
};

fn shell(script: &str) -> Command {
    let mut command = Command::new("/bin/sh");
    command.args(["-c", script]);
    command
}

fn process_field(pid: u32, field: &str) -> Option<String> {
    let output = Command::new("/bin/ps")
        .args(["-o", field, "-p", &pid.to_string()])
        .stdin(Stdio::null())
        .output()
        .ok()?;
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (output.status.success() && !value.is_empty()).then_some(value)
}

fn running(pid: u32) -> bool {
    process_field(pid, "stat=").is_some_and(|state| !state.starts_with('Z'))
}

struct Fixture {
    directory: PathBuf,
    owned: Vec<(u32, String)>,
}

impl Fixture {
    fn new() -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let directory = std::env::temp_dir().join(format!(
            "stowmind-maintenance-fixture-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::SeqCst)
        ));
        fs::create_dir(&directory).unwrap();
        Self {
            directory,
            owned: Vec::new(),
        }
    }

    fn command(&self, script: &str) -> Command {
        let mut command = shell(script);
        command
            .arg("maintenance-fixture")
            .arg(self.directory.join("ready"));
        command
    }

    fn ready(&mut self) -> Vec<u32> {
        let deadline = Instant::now() + Duration::from_secs(4);
        loop {
            if let Ok(value) = fs::read_to_string(self.directory.join("ready")) {
                let pids = value
                    .split_whitespace()
                    .map(str::parse::<u32>)
                    .collect::<Result<Vec<_>, _>>();
                if let Ok(pids) = pids {
                    if !pids.is_empty() {
                        for pid in &pids {
                            if let Some(identity) = process_field(*pid, "lstart=") {
                                self.owned.push((*pid, identity));
                            }
                        }
                        return pids;
                    }
                }
            }
            assert!(
                Instant::now() < deadline,
                "harmless process fixture did not become ready"
            );
            thread::sleep(Duration::from_millis(10));
        }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        // Only our fixture identities may be signalled, including on assertion
        // failure. Never kill an unrelated PID recycled after a fast exit.
        for (pid, identity) in &self.owned {
            if process_field(*pid, "lstart=").as_ref() == Some(identity) && running(*pid) {
                let _ = Command::new("/bin/kill")
                    .args(["-KILL", "--", &pid.to_string()])
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status();
            }
        }
        let _ = fs::remove_dir_all(&self.directory);
    }
}

struct Sentinel(std::process::Child);
impl Drop for Sentinel {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

#[test]
fn both_full_pipes_are_drained_and_bounded_tails_are_preserved() {
    let manager = MaintenanceManager::default();
    let context = manager
        .begin("main", "concurrent-pipes", Duration::from_secs(6))
        .unwrap();
    let length = OUTPUT_LIMIT + 128 * 1024;
    let script = format!("(head -c {length} /dev/zero; printf STDOUT-END) & (head -c {length} /dev/zero; printf STDERR-END) >&2 & wait");
    let started = Instant::now();
    let result = context.run(&mut shell(&script), None).unwrap();
    assert!(result.output.status.success());
    assert!(result.output_truncated);
    assert!(result.output.stdout.len() <= OUTPUT_LIMIT);
    assert!(result.output.stderr.len() <= OUTPUT_LIMIT);
    assert!(result.output.stdout.ends_with(b"STDOUT-END"));
    assert!(result.output.stderr.ends_with(b"STDERR-END"));
    assert!(started.elapsed() < Duration::from_secs(5));
}

#[test]
fn large_stdin_and_both_output_pipes_do_not_deadlock_each_other() {
    let manager = MaintenanceManager::default();
    let context = manager
        .begin("main", "stdin-stdout-stderr", Duration::from_secs(12))
        .unwrap();
    let payload = vec![b'x'; OUTPUT_LIMIT + 128 * 1024];
    let script = format!(
        "(head -c {} /dev/zero; printf STDERR-END) >&2 & cat; wait; printf STDOUT-END",
        payload.len()
    );
    let result = context.run(&mut shell(&script), Some(&payload)).unwrap();
    assert!(result.output.status.success());
    assert!(result.output_truncated);
    assert!(result.output.stdout.ends_with(b"STDOUT-END"));
    assert!(result.output.stderr.ends_with(b"STDERR-END"));
}

#[test]
fn a_parent_exiting_first_cannot_leave_descendants_holding_pipes_forever() {
    let manager = MaintenanceManager::default();
    let context = manager
        .begin("main", "orphan-pipe", Duration::from_millis(300))
        .unwrap();
    let mut fixture = Fixture::new();
    let mut command =
        fixture.command("sleep 20 & printf '%s\\n' \"$!\" > \"$1\"; printf parent-exited; exit 0");
    let started = Instant::now();
    let worker = thread::spawn(move || {
        let result = context.run(&mut command, None);
        drop(context);
        result
    });
    let pids = fixture.ready();
    let result = worker.join().unwrap();
    let error = result
        .err()
        .expect("An exited parent must not bypass the pipe-drain deadline");
    assert_eq!(error.code, "timeout");
    assert!(error.raw_output.contains("parent-exited"));
    assert!(started.elapsed() < Duration::from_secs(5));
    assert!(
        pids.into_iter().all(|pid| !running(pid)),
        "Pipe-owning descendants must be stopped before the lane is released"
    );
    manager
        .wait_finished("main", "orphan-pipe", Duration::from_millis(50))
        .unwrap();
    assert!(manager
        .begin("main", "after-orphan", Duration::from_secs(1))
        .is_ok());
}

#[test]
fn cancellation_escalates_past_ignored_term_and_preserves_an_unrelated_process() {
    let manager = MaintenanceManager::default();
    let context = manager
        .begin("main", "ignore-term", Duration::from_secs(8))
        .unwrap();
    let mut fixture = Fixture::new();
    let mut command = fixture.command("trap '' TERM; printf '%s\\n' \"$$\" > \"$1\"; printf worker-ready; while :; do sleep 0.05; done");
    let mut sentinel = Sentinel(Command::new("/bin/sleep").arg("20").spawn().unwrap());
    let worker = thread::spawn(move || {
        let result = context.run(&mut command, None);
        drop(context);
        result
    });
    let pids = fixture.ready();
    let started = Instant::now();
    manager.cancel("main", "ignore-term").unwrap();
    manager
        .wait_finished("main", "ignore-term", Duration::from_secs(6))
        .unwrap();
    let result = worker.join().unwrap();
    let error = result.err().unwrap();
    let sentinel_alive = sentinel.0.try_wait().unwrap().is_none();
    assert_eq!(error.code, "cancelled");
    assert!(error.raw_output.contains("worker-ready"));
    assert!(started.elapsed() < Duration::from_secs(6));
    assert!(pids.into_iter().all(|pid| !running(pid)));
    assert!(
        sentinel_alive,
        "Cancelling a maintenance process must not signal unrelated processes"
    );
    assert!(manager
        .begin("main", "after-cancel", Duration::from_secs(1))
        .is_ok());
}

#[test]
fn forcibly_stopping_descendants_after_parent_exit_is_never_green_success() {
    let manager = MaintenanceManager::default();
    let context = manager
        .begin("main", "unfinished-descendant", Duration::from_secs(5))
        .unwrap();
    let mut fixture = Fixture::new();
    let mut command = fixture.command("sleep 20 >/dev/null 2>&1 & printf '%s\\n' \"$!\" > \"$1\"; sleep 0.25; printf parent-success; exit 0");
    let worker = thread::spawn(move || {
        let result = context.run(&mut command, None);
        drop(context);
        result
    });
    let pids = fixture.ready();
    let error = worker.join().unwrap().err().expect(
        "Terminating unfinished descendants is an uncertain action, regardless of parent exit(0)",
    );
    assert_eq!(error.code, "failed");
    assert!(error.process_started);
    assert!(error.raw_output.contains("parent-success"));
    assert!(pids.into_iter().all(|pid| !running(pid)));
    manager
        .wait_finished("main", "unfinished-descendant", Duration::from_millis(50))
        .unwrap();
}

#[test]
fn all_phases_share_one_deadline_and_timeout_releases_the_lane_after_drop() {
    let manager = MaintenanceManager::default();
    let context = manager
        .begin("main", "shared-deadline", Duration::from_secs(2))
        .unwrap();
    context.run(&mut shell("printf phase-one"), None).unwrap();
    // Consume the first phase's budget without assuming how fast process-table
    // sampling runs when the complete suite executes fixtures in parallel.
    let next_phase = context.deadline - Duration::from_millis(200);
    thread::sleep(next_phase.saturating_duration_since(Instant::now()));
    let started = Instant::now();
    let error = context
        .run(&mut shell("sleep 0.4; printf phase-two"), None)
        .err()
        .unwrap();
    assert_eq!(error.code, "timeout");
    assert!(error.process_started);
    assert!(started.elapsed() < Duration::from_secs(3));
    assert_eq!(
        manager
            .begin("main", "premature-next", Duration::from_secs(1))
            .err()
            .unwrap()
            .code,
        "busy"
    );
    drop(context);
    manager
        .wait_finished("main", "shared-deadline", Duration::from_millis(50))
        .unwrap();
    assert!(manager
        .begin("main", "after-timeout", Duration::from_secs(1))
        .is_ok());
}

#[path = "manager_tests.rs"]
mod manager_tests;

#[test]
fn oversized_confirmation_input_is_rejected_before_spawn() {
    let manager = MaintenanceManager::default();
    let context = manager
        .begin("main", "bounded-input", Duration::from_secs(1))
        .unwrap();
    let payload = vec![b'x'; 4 * 1024 * 1024 + 1];
    let error = context
        .run(&mut shell("printf must-not-run"), Some(&payload))
        .err()
        .unwrap();
    assert_eq!(error.code, "failed");
    assert!(!error.process_started);
    assert!(error.raw_output.is_empty());
}
