use super::bridge::{collect_child_output, execution_ready, scan_ready};
use std::process::{Command, Stdio};
use std::time::Duration;

#[test]
fn read_only_scan_does_not_require_accessibility() {
    let ready = scan_ready(true, true, true, true, true);
    assert!(ready);
    assert!(!execution_ready(ready, false));
}

#[test]
fn read_only_scan_requires_screen_capture_and_ready_content() {
    assert!(!scan_ready(true, true, true, true, false));
    assert!(!scan_ready(true, true, false, true, true));
}

#[cfg(unix)]
#[test]
fn helper_output_larger_than_pipe_buffer_is_drained_while_running() {
    let child = Command::new("/bin/sh")
        .args(["-c", "head -c 131072 /dev/zero | tr '\\0' x"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("large-output helper should start");

    let output = collect_child_output(child, Duration::from_secs(3))
        .expect("large output should not deadlock");
    assert!(output.status.success());
    assert_eq!(output.stdout.len(), 131_072);
}
