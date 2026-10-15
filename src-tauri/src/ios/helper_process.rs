use std::io::Read;
use std::process::{Child, ExitStatus};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

const POLL_INTERVAL: Duration = Duration::from_millis(25);
const CANCELLATION_GRACE: Duration = Duration::from_millis(1_500);
const CANCELLED_MESSAGE: &str = "镜像操作已取消，实际结果可能未确认；请重新盘点，不要重试旧方案";

#[derive(Debug)]
pub(crate) struct HelperProcessOutput {
    pub(crate) status: ExitStatus,
    pub(crate) stdout: Vec<u8>,
    pub(crate) stderr: Vec<u8>,
}

fn read_child_stream<R>(
    mut stream: R,
    name: &'static str,
) -> thread::JoinHandle<Result<Vec<u8>, String>>
where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        let mut output = Vec::new();
        stream
            .read_to_end(&mut output)
            .map_err(|error| format!("无法读取镜像辅助组件{name}：{error}"))?;
        Ok(output)
    })
}

fn join_child_stream(
    reader: thread::JoinHandle<Result<Vec<u8>, String>>,
    name: &str,
) -> Result<Vec<u8>, String> {
    reader
        .join()
        .map_err(|_| format!("镜像辅助组件{name}读取线程异常"))?
}

#[cfg(target_os = "macos")]
fn request_cooperative_stop(child: &mut Child) {
    extern "C" {
        fn kill(pid: i32, signal: i32) -> i32;
    }
    let Ok(pid) = i32::try_from(child.id()) else {
        let _ = child.kill();
        return;
    };
    // macOS SIGUSR1. The helper stops input and releases a held mouse button.
    // Called only after try_wait returned None: this owned child has not been
    // reaped, so its PID cannot have been recycled for an unrelated process.
    if unsafe { kill(pid, 30) } != 0 {
        let _ = child.kill();
    }
}

#[cfg(not(target_os = "macos"))]
fn request_cooperative_stop(child: &mut Child) {
    let _ = child.kill();
}

#[cfg(test)]
pub(crate) fn collect_child_output(
    child: Child,
    timeout: Duration,
) -> Result<HelperProcessOutput, String> {
    collect_child_output_cancellable(child, timeout, None)
}

pub(crate) fn collect_child_output_cancellable(
    mut child: Child,
    timeout: Duration,
    cancelled: Option<&AtomicBool>,
) -> Result<HelperProcessOutput, String> {
    let (Some(stdout), Some(stderr)) = (child.stdout.take(), child.stderr.take()) else {
        let _ = child.kill();
        let _ = child.wait();
        return Err("镜像辅助组件未提供标准输出或错误输出".to_string());
    };
    let stdout_reader = read_child_stream(stdout, "响应");
    let stderr_reader = read_child_stream(stderr, "诊断信息");
    let started = Instant::now();
    let mut stop_started = None;
    let mut failure = None;

    let status = loop {
        // Always reap/check before signalling. In particular an already exited
        // child must never receive a signal via a possibly recycled PID.
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) => {}
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                break Err(format!("无法检查镜像辅助组件状态：{error}"));
            }
        }

        let requested = cancelled.is_some_and(|flag| flag.load(Ordering::SeqCst));
        if requested && failure.is_none() {
            failure = Some(CANCELLED_MESSAGE.to_string());
            stop_started = Some(Instant::now());
            request_cooperative_stop(&mut child);
        }
        if let Some(stopped_at) = stop_started {
            if stopped_at.elapsed() >= CANCELLATION_GRACE {
                let _ = child.kill();
                break child
                    .wait()
                    .map_err(|error| format!("无法终止镜像辅助组件：{error}"));
            }
        } else if started.elapsed() >= timeout {
            failure = Some(format!(
                "镜像辅助组件超时（{} 秒），无法确认动作结果；请重新盘点，不要重试旧方案",
                timeout.as_secs()
            ));
            stop_started = Some(Instant::now());
            request_cooperative_stop(&mut child);
        }
        thread::sleep(POLL_INTERVAL);
    };

    // Drain both pipes even on a failed/uncertain action, and never treat a
    // cooperative exit(0) after cancellation as a successful operation.
    let stdout = join_child_stream(stdout_reader, "响应");
    let stderr = join_child_stream(stderr_reader, "诊断信息");
    if cancelled.is_some_and(|flag| flag.load(Ordering::SeqCst)) {
        return Err(CANCELLED_MESSAGE.to_string());
    }
    if let Some(error) = failure {
        return Err(error);
    }
    Ok(HelperProcessOutput {
        status: status?,
        stdout: stdout?,
        stderr: stderr?,
    })
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::process::{Command, Stdio};

    #[cfg(unix)]
    fn ready_child(script: &str) -> std::process::Child {
        let mut child = Command::new("/bin/sh")
            .args(["-c", script])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("test child should start");
        let mut stdout = child.stdout.take().unwrap();
        let mut marker = [0u8; 1];
        stdout
            .read_exact(&mut marker)
            .expect("test child should become ready");
        assert_eq!(marker, [b'R']);
        child.stdout = Some(stdout);
        child
    }

    #[cfg(unix)]
    #[test]
    fn cancellation_while_child_is_running_stops_without_waiting_for_timeout() {
        let child = ready_child("printf R; while :; do :; done");
        let cancelled = AtomicBool::new(false);
        let started = Instant::now();
        let result = std::thread::scope(|scope| {
            scope.spawn(|| {
                std::thread::sleep(Duration::from_millis(80));
                cancelled.store(true, Ordering::SeqCst);
            });
            collect_child_output_cancellable(child, Duration::from_secs(10), Some(&cancelled))
        });
        assert!(result.unwrap_err().contains("已取消"));
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[cfg(unix)]
    #[test]
    fn cancellation_after_child_is_reaped_is_uncertain_without_signalling_again() {
        let mut child = ready_child("printf R; exit 0");
        assert!(child.wait().unwrap().success());
        let result = collect_child_output_cancellable(
            child,
            Duration::from_secs(1),
            Some(&AtomicBool::new(true)),
        );
        assert!(result.unwrap_err().contains("已取消"));
    }

    #[cfg(unix)]
    #[test]
    fn completed_child_is_still_collected_normally() {
        let mut child = ready_child("printf R; printf complete; exit 0");
        assert!(child.wait().unwrap().success());
        let output = collect_child_output_cancellable(
            child,
            Duration::from_secs(1),
            Some(&AtomicBool::new(false)),
        )
        .unwrap();
        assert!(output.status.success());
        assert_eq!(output.stdout, b"complete");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn cooperative_cancellation_exit_zero_is_never_reported_as_success() {
        let child = ready_child("trap 'exit 0' USR1; printf R; while :; do :; done");
        let started = Instant::now();
        let result = collect_child_output_cancellable(
            child,
            Duration::from_secs(10),
            Some(&AtomicBool::new(true)),
        );
        assert!(result.unwrap_err().contains("已取消"));
        assert!(started.elapsed() < Duration::from_millis(1_400));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn unresponsive_child_is_killed_after_cooperative_grace_period() {
        let child = ready_child("trap '' USR1; printf R; while :; do :; done");
        let started = Instant::now();
        let result = collect_child_output_cancellable(
            child,
            Duration::from_secs(10),
            Some(&AtomicBool::new(true)),
        );
        assert!(result.unwrap_err().contains("已取消"));
        assert!(started.elapsed() >= Duration::from_millis(1_500));
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[cfg(unix)]
    #[test]
    fn helper_timeout_is_uncertain_and_never_replayed() {
        let child = ready_child("printf R; while :; do :; done");
        let error = collect_child_output(child, Duration::from_millis(50)).unwrap_err();
        assert!(error.contains("超时"));
        assert!(error.contains("不要重试旧方案"));
    }
}
