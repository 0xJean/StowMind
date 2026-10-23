use super::process_tree::{PendingCleanup, ProcessTree};
use super::{MaintenanceError, RunContext};
use std::{
    collections::VecDeque,
    io::{Read, Write},
    process::{Command, Output, Stdio},
    time::{Duration, Instant},
};

pub(crate) const OUTPUT_LIMIT: usize = 1024 * 1024;
const INPUT_LIMIT: usize = 4 * 1024 * 1024;
const POLL: Duration = Duration::from_millis(20);
const TERM_GRACE: Duration = Duration::from_millis(500);
const CLEANUP_LIMIT: Duration = Duration::from_secs(3);

pub(crate) struct ProcessOutput {
    pub output: Output,
    pub output_truncated: bool,
}
impl std::fmt::Debug for ProcessOutput {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ProcessOutput")
            .field("status", &self.output.status)
            .field("stdout_bytes", &self.output.stdout.len())
            .field("stderr_bytes", &self.output.stderr.len())
            .field("output_truncated", &self.output_truncated)
            .finish()
    }
}
impl ProcessOutput {
    pub fn text(&self) -> String {
        let prefix = if self.output_truncated {
            "[Earlier output truncated; retaining the tail]\n"
        } else {
            ""
        };
        format!(
            "{}{}\n{}",
            prefix,
            String::from_utf8_lossy(&self.output.stdout),
            String::from_utf8_lossy(&self.output.stderr)
        )
    }
    pub fn failure(&self, message: impl Into<String>) -> MaintenanceError {
        let mut error = MaintenanceError::new("failed", message);
        error.raw_output = self.text();
        error.output_truncated = self.output_truncated;
        error.process_started = true;
        error
    }
}

struct Drain<R> {
    stream: R,
    bytes: VecDeque<u8>,
    truncated: bool,
    eof: bool,
}
impl<R: Read> Drain<R> {
    fn new(stream: R) -> Self {
        Self {
            stream,
            bytes: VecDeque::new(),
            truncated: false,
            eof: false,
        }
    }
    fn pump(&mut self) -> std::io::Result<()> {
        // Alternate streams and cancellation checks even under sustained output.
        let mut buffer = [0_u8; 8192];
        for _ in 0..32 {
            match self.stream.read(&mut buffer) {
                Ok(0) => {
                    self.eof = true;
                    break;
                }
                Ok(count) => {
                    let excess = self
                        .bytes
                        .len()
                        .saturating_add(count)
                        .saturating_sub(OUTPUT_LIMIT);
                    if excess > 0 {
                        self.bytes.drain(..excess);
                        self.truncated = true;
                    }
                    self.bytes.extend(&buffer[..count]);
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => break,
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(error) => return Err(error),
            }
        }
        Ok(())
    }
}

#[cfg(unix)]
fn nonblocking(fd: &impl std::os::fd::AsRawFd) -> std::io::Result<()> {
    let descriptor = fd.as_raw_fd();
    let flags = unsafe { libc::fcntl(descriptor, libc::F_GETFL) };
    if flags < 0 || unsafe { libc::fcntl(descriptor, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0
    {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(unix)]
fn child_exited(pid: u32) -> std::io::Result<bool> {
    // Observe exit without reaping: descendants may still hold either pipe.
    let mut info: libc::siginfo_t = unsafe { std::mem::zeroed() };
    let result = unsafe {
        libc::waitid(
            libc::P_PID,
            pid,
            &mut info,
            libc::WEXITED | libc::WNOHANG | libc::WNOWAIT,
        )
    };
    if result < 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(info.si_signo != 0)
}

impl RunContext {
    #[cfg(unix)]
    pub fn run(
        &self,
        command: &mut Command,
        input: Option<&[u8]>,
    ) -> Result<ProcessOutput, MaintenanceError> {
        use std::os::unix::process::CommandExt;
        self.check()?;
        if input.is_some_and(|bytes| bytes.len() > INPUT_LIMIT) {
            return Err("Maintenance confirmation input is too large".into());
        }
        command
            .process_group(0)
            .stdin(if input.is_some() {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = command.spawn().map_err(|error| {
            MaintenanceError::new(
                "failed",
                format!("Cannot start maintenance process: {error}"),
            )
        })?;
        let mut tree = ProcessTree::new(child.id());
        let stdout = child.stdout.take().expect("piped stdout");
        let stderr = child.stderr.take().expect("piped stderr");
        let mut stdin = child.stdin.take();
        let configure = nonblocking(&stdout)
            .and_then(|_| nonblocking(&stderr))
            .and_then(|_| stdin.as_ref().map(nonblocking).unwrap_or(Ok(())));
        if let Err(error) = configure {
            let mut pending = PendingCleanup::new(child, tree);
            let cleanup = pending.retry();
            let mut failure = MaintenanceError::new(
                "failed",
                format!("Cannot configure maintenance output: {error}"),
            );
            failure.process_started = true;
            if cleanup.is_err() {
                self.hold_cleanup(pending);
                failure.cleanup_pending = true;
            }
            return Err(failure);
        }
        let mut out = Drain::new(stdout);
        let mut err = Drain::new(stderr);
        let mut failure = None;
        let mut input_offset = 0;
        let mut stop_started = None;
        let mut last_tree_check = Instant::now() - Duration::from_secs(1);
        let mut tree_alive = true;
        loop {
            if let (Some(pipe), Some(bytes)) = (stdin.as_mut(), input) {
                if input_offset == bytes.len() {
                    stdin = None;
                } else {
                    match pipe.write(&bytes[input_offset..bytes.len().min(input_offset + 8192)]) {
                        Ok(count) => input_offset += count,
                        Err(error)
                            if error.kind() == std::io::ErrorKind::WouldBlock
                                || error.kind() == std::io::ErrorKind::Interrupted => {}
                        Err(error) if error.kind() == std::io::ErrorKind::BrokenPipe => {
                            stdin = None
                        }
                        Err(error) => {
                            failure.get_or_insert_with(|| {
                                MaintenanceError::new(
                                    "failed",
                                    format!("Cannot write maintenance input: {error}"),
                                )
                            });
                            stdin = None;
                        }
                    }
                }
            }
            if let Err(error) = out.pump().and_then(|_| err.pump()) {
                failure.get_or_insert_with(|| {
                    MaintenanceError::new(
                        "failed",
                        format!("Cannot read maintenance output: {error}"),
                    )
                });
            }
            if let Err(error) = self.check() {
                failure.get_or_insert(error);
            }
            let exited = child_exited(child.id()).unwrap_or(false);
            if last_tree_check.elapsed() >= Duration::from_millis(100)
                || (exited && out.eof && err.eof)
            {
                match tree.poll() {
                    Ok(alive) => tree_alive = alive,
                    Err(error) => {
                        failure.get_or_insert_with(|| MaintenanceError::new("failed", error));
                    }
                }
                last_tree_check = Instant::now();
            }
            // Success requires both completed output and no live descendants.
            if exited && out.eof && err.eof && !tree_alive {
                let status = child
                    .wait()
                    .map_err(|error| MaintenanceError::new("failed", error.to_string()))?;
                let output = ProcessOutput {
                    output: Output {
                        status,
                        stdout: out.bytes.into(),
                        stderr: err.bytes.into(),
                    },
                    output_truncated: out.truncated || err.truncated,
                };
                if let Some(mut error) = failure {
                    error.process_started = true;
                    error.raw_output = output.text();
                    error.output_truncated = output.output_truncated;
                    return Err(error);
                }
                return Ok(output);
            }
            if failure.is_some() || (exited && out.eof && err.eof) {
                if failure.is_none() {
                    failure = Some(MaintenanceError::new("failed", "Maintenance parent exited while background work was still running; its result is unconfirmed"));
                }
                let stopped_at = *stop_started.get_or_insert_with(|| {
                    let _ = tree.signal(libc::SIGTERM);
                    Instant::now()
                });
                if stopped_at.elapsed() >= TERM_GRACE {
                    let _ = tree.signal(libc::SIGKILL);
                }
                if stopped_at.elapsed() >= CLEANUP_LIMIT {
                    let mut error = failure.unwrap_or_else(|| {
                        MaintenanceError::new("failed", "Maintenance descendants did not exit")
                    });
                    error.code = "failed".to_string();
                    error.message = format!(
                        "{}; worker exit is unconfirmed, retry cancellation",
                        error.message
                    );
                    error.process_started = true;
                    error.output_truncated = out.truncated || err.truncated;
                    error.raw_output = format!(
                        "{}\n{}",
                        String::from_utf8_lossy(&out.bytes.into_iter().collect::<Vec<_>>()),
                        String::from_utf8_lossy(&err.bytes.into_iter().collect::<Vec<_>>())
                    );
                    error.cleanup_pending = true;
                    self.hold_cleanup(PendingCleanup::new(child, tree));
                    return Err(error);
                }
            }
            std::thread::sleep(POLL);
        }
    }

    #[cfg(not(unix))]
    pub fn run(
        &self,
        _command: &mut Command,
        _input: Option<&[u8]>,
    ) -> Result<ProcessOutput, MaintenanceError> {
        self.check()?;
        Err("Bounded maintenance process supervision requires Unix on this platform".into())
    }
}
