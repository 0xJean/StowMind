use super::{
    outcome, probe, pty,
    types::{ScanStatus, SystemCacheReport, TARGET_PATH},
    validate_run_id,
};
use std::{
    process::Command,
    time::{Duration, Instant},
};

fn report(status: ScanStatus, size: Option<u64>) -> SystemCacheReport {
    let mut report = SystemCacheReport::new(status, "fixture", true);
    if let Some(size) = size {
        report.set_size(size);
    }
    report
}

fn completed() -> pty::Protocol {
    let mut protocol = pty::Protocol::default();
    protocol.authorized = true;
    protocol.attempted = true;
    protocol.action = Some("0".to_string());
    protocol
}

#[test]
fn incomplete_du_output_never_becomes_an_empty_or_complete_cache() {
    let raw = format!("du: {TARGET_PATH}/entry: Permission denied\n270000000\t{TARGET_PATH}\n");
    let result = probe::report_from_du(&raw, false, false, false);
    assert_eq!(result.status, ScanStatus::PermissionDenied);
    assert_eq!(result.size_bytes, None);
    assert_eq!(result.anomaly, None);
    let nested_missing =
        format!("du: {TARGET_PATH}/entry: No such file or directory\n20\t{TARGET_PATH}\n");
    assert_eq!(
        probe::report_from_du(&nested_missing, false, false, false).status,
        ScanStatus::Partial
    );
    assert_eq!(
        probe::report_from_du(&raw, true, true, false).status,
        ScanStatus::TimedOut
    );
}

#[test]
fn complete_du_records_require_a_single_fixed_target_and_checked_size() {
    let result = probe::report_from_du(&format!("1024\t{TARGET_PATH}\n"), true, false, false);
    assert_eq!(result.size_bytes, Some(1024 * 1024));
    for raw in [
        format!("1024\t/tmp/other\n"),
        format!("{}\t{TARGET_PATH}\n", u64::MAX),
        format!("0\t{TARGET_PATH}\n1\t{TARGET_PATH}\n"),
    ] {
        let result = probe::report_from_du(&raw, true, false, false);
        assert_eq!(result.status, ScanStatus::Error);
        assert_eq!(result.size_bytes, None);
    }
}

#[test]
fn measurements_preserve_growth_unknowns_and_missing_targets() {
    let grown = outcome(
        report(ScanStatus::Complete, Some(1024)),
        report(ScanStatus::Complete, Some(2048)),
        completed(),
    );
    assert!(grown.success);
    assert_eq!(grown.measured_delta_bytes, Some(-1024));
    let gone = outcome(
        report(ScanStatus::Complete, Some(1024)),
        report(ScanStatus::NotFound, None),
        completed(),
    );
    assert!(gone.success);
    assert_eq!(gone.measured_delta_bytes, Some(1024));
    let unknown = outcome(
        report(ScanStatus::Complete, Some(1024)),
        report(ScanStatus::PermissionDenied, None),
        completed(),
    );
    assert!(!unknown.success);
    assert_eq!(unknown.measured_delta_bytes, None);
}

#[test]
fn no_authorization_or_no_attempt_cannot_report_success() {
    for (authorized, attempted) in [(false, true), (true, false)] {
        let mut protocol = completed();
        protocol.authorized = authorized;
        protocol.attempted = attempted;
        let result = outcome(
            report(ScanStatus::Complete, Some(1024)),
            report(ScanStatus::Complete, Some(0)),
            protocol,
        );
        assert!(!result.success);
    }
    let mut protocol = completed();
    protocol.action = Some("1".into());
    protocol.refusal = Some("Mole preserved the configured whitelist".into());
    let result = outcome(
        report(ScanStatus::Complete, Some(1024)),
        report(ScanStatus::Complete, Some(1024)),
        protocol,
    );
    assert!(!result.success);
    assert!(result.attempted);
    assert!(result
        .errors
        .iter()
        .any(|error| error.contains("whitelist")));
}

#[test]
fn run_ids_do_not_accept_terminal_or_shell_input() {
    assert!(validate_run_id("cache-123_test").is_ok());
    for id in ["", "../path", "bad\ninput", "$(id)"] {
        assert!(validate_run_id(id).is_err());
    }
}

#[test]
fn bounded_probe_drains_both_pipes_and_caps_memory() {
    let mut command = Command::new("/bin/bash");
    command.args([
        "--noprofile",
        "--norc",
        "-c",
        "for ((i=0;i<20000;i++)); do printf 'stdout data\n'; printf 'stderr data\n' >&2; done",
    ]);
    let result = probe::bounded_output(command, Duration::from_secs(10)).unwrap();
    assert!(result.success);
    assert!(!result.timed_out);
    assert_eq!(result.text.len(), 65536);
}

#[test]
fn bounded_probe_times_out_without_waiting_for_long_child() {
    let mut command = Command::new("/bin/bash");
    command.args(["--noprofile", "--norc", "-c", "/bin/sleep 30 & wait"]);
    let started = Instant::now();
    let result = probe::bounded_output(command, Duration::from_millis(100)).unwrap();
    assert!(result.timed_out);
    assert!(started.elapsed() < Duration::from_secs(10));
}
