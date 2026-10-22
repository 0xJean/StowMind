use super::types::{ScanStatus, SystemCacheReport, TARGET_PATH};
use std::{
    fs,
    io::Read,
    path::Path,
    process::{Child, Command, Stdio},
    sync::mpsc,
    time::{Duration, Instant},
};

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct PathIdentity {
    pub device: u64,
    pub inode: u64,
    pub modified: i64,
}

impl PathIdentity {
    pub(super) fn short(&self) -> String {
        format!("{}:{}", self.device, self.inode)
    }

    pub(super) fn parse(value: &str) -> Option<Self> {
        let fields = value.split(':').collect::<Vec<_>>();
        if fields.len() != 3 {
            return None;
        }
        Some(Self {
            device: fields[0].parse().ok()?,
            inode: fields[1].parse().ok()?,
            modified: fields[2].parse().ok()?,
        })
    }
}

/// Every ancestor must remain physical. The target identity binds the review;
/// Mole performs its own ownership/ACL policy again at its final deletion sink.
pub(super) fn physical_identities(path: &Path) -> Result<Vec<PathIdentity>, IdentityError> {
    let mut identities = Vec::new();
    let mut current = std::path::PathBuf::from("/");
    for component in path.components() {
        current.push(component);
        let metadata = fs::symlink_metadata(&current).map_err(|error| IdentityError {
            permission_denied: error.kind() == std::io::ErrorKind::PermissionDenied,
            message: format!("Cannot verify {}: {error}", current.display()),
        })?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(IdentityError {
                permission_denied: false,
                message: format!("Refusing a symlink or non-directory: {}", current.display()),
            });
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            identities.push(PathIdentity {
                device: metadata.dev(),
                inode: metadata.ino(),
                modified: metadata.mtime(),
            });
        }
        #[cfg(not(unix))]
        return Err(IdentityError {
            permission_denied: false,
            message: "System cache identity checks require macOS".to_string(),
        });
    }
    Ok(identities)
}

#[derive(Debug)]
pub(super) struct IdentityError {
    pub permission_denied: bool,
    pub message: String,
}

impl From<IdentityError> for String {
    fn from(error: IdentityError) -> String {
        error.message
    }
}

pub(super) fn scan() -> SystemCacheReport {
    if !cfg!(target_os = "macos") {
        return SystemCacheReport::new(
            ScanStatus::Unsupported,
            "System cache inspection is available on macOS",
            false,
        );
    }
    let path = Path::new(TARGET_PATH);
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return SystemCacheReport::new(
                ScanStatus::NotFound,
                "The icon cache directory is not present",
                false,
            );
        }
        Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
            return SystemCacheReport::new(
                ScanStatus::PermissionDenied,
                "Administrator access is required to inspect this cache; the size remains unknown",
                false,
            );
        }
        _ => {}
    }
    let before = match physical_identities(path) {
        Ok(identities) => identities,
        Err(error) => {
            return SystemCacheReport::new(
                if error.permission_denied {
                    ScanStatus::PermissionDenied
                } else {
                    ScanStatus::Error
                },
                error.message,
                false,
            )
        }
    };
    let mut command = Command::new("/usr/bin/du");
    command.args(["-skP", TARGET_PATH]).env("LC_ALL", "C");
    let result = bounded_output(command, Duration::from_secs(30));
    let mut report = match result {
        Ok(output) => report_from_du(&output.text, output.success, output.timed_out, false),
        Err(error) => SystemCacheReport::new(ScanStatus::Error, error, false),
    };
    let after = physical_identities(path);
    // A vanished nested file must never classify the entire root as absent.
    if report.status != ScanStatus::Complete
        && matches!(fs::symlink_metadata(path), Err(error) if error.kind() == std::io::ErrorKind::NotFound)
    {
        report.status = ScanStatus::NotFound;
        report.message = "The icon cache directory is not present".to_string();
    }
    if report.status == ScanStatus::Complete
        && !after
            .as_ref()
            .map(|after| super::review::identities_match(&before, after))
            .unwrap_or(false)
    {
        report.status = ScanStatus::Partial;
        report.size_bytes = None;
        report.anomaly = None;
        report.message = "The cache changed during sizing; the size remains unknown".to_string();
    }
    report.modified_at = after.ok().and_then(|ids| ids.last().map(|id| id.modified));
    report
}

pub(super) fn report_from_du(
    raw: &str,
    success: bool,
    timed_out: bool,
    authorized: bool,
) -> SystemCacheReport {
    let (status, message) = if timed_out {
        (
            ScanStatus::TimedOut,
            "Cache sizing reached its time limit; the size remains unknown",
        )
    } else if !success
        && (raw.contains("Permission denied")
            || raw.contains("Operation not permitted")
            || raw.contains("a password is required"))
    {
        (
            ScanStatus::PermissionDenied,
            "Administrator access is required to inspect this cache; the size remains unknown",
        )
    } else if !success {
        (
            ScanStatus::Partial,
            "The directory could not be fully inspected; the size remains unknown",
        )
    } else {
        (
            ScanStatus::Complete,
            "Complete measurement of allocated directory size",
        )
    };
    let mut report = SystemCacheReport::new(status, message, authorized);
    if report.status == ScanStatus::Complete {
        let lines = raw
            .lines()
            .filter(|line| !line.trim().is_empty())
            .collect::<Vec<_>>();
        let size = (lines.len() == 1)
            .then(|| lines[0].split_once('\t'))
            .flatten()
            .filter(|(_, path)| *path == TARGET_PATH)
            .and_then(|(kb, _)| kb.trim().parse::<u64>().ok())
            .and_then(|kb| kb.checked_mul(1024));
        match size {
            Some(size) => report.set_size(size),
            None => {
                report.status = ScanStatus::Error;
                report.message =
                    "Cache size output was invalid; the size remains unknown".to_string();
            }
        }
    }
    report
}

pub(super) struct ProcessOutput {
    pub text: String,
    pub success: bool,
    pub timed_out: bool,
}

struct ProbeChild {
    child: Child,
    reaped: bool,
}
impl std::ops::Deref for ProbeChild {
    type Target = Child;
    fn deref(&self) -> &Child {
        &self.child
    }
}
impl std::ops::DerefMut for ProbeChild {
    fn deref_mut(&mut self) -> &mut Child {
        &mut self.child
    }
}
impl Drop for ProbeChild {
    fn drop(&mut self) {
        if !self.reaped {
            terminate(&mut self.child);
        }
    }
}

/// Drain both pipes concurrently and bound memory as well as wall-clock time.
pub(super) fn bounded_output(
    mut command: Command,
    timeout: Duration,
) -> Result<ProcessOutput, String> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let child = command
        .spawn()
        .map_err(|error| format!("Cannot start cache probe: {error}"))?;
    let mut child = ProbeChild {
        child,
        reaped: false,
    };
    let (sender, receiver) = mpsc::sync_channel(16);
    let pipes: Vec<Box<dyn Read + Send>> = vec![
        Box::new(child.stdout.take().unwrap()),
        Box::new(child.stderr.take().unwrap()),
    ];
    for mut pipe in pipes {
        let sender = sender.clone();
        std::thread::spawn(move || {
            let mut buffer = [0_u8; 4096];
            loop {
                match pipe.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(size) => {
                        if sender.send(buffer[..size].to_vec()).is_err() {
                            return;
                        }
                    }
                }
            }
        });
    }
    drop(sender);
    let start = Instant::now();
    let mut bytes = Vec::new();
    let mut status = None;
    let mut timed_out = false;
    loop {
        match receiver.recv_timeout(Duration::from_millis(50)) {
            Ok(chunk) => {
                let remaining = 65536usize.saturating_sub(bytes.len());
                bytes.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
            }
            Err(mpsc::RecvTimeoutError::Disconnected) if status.is_some() => break,
            _ => {}
        }
        if status.is_none() {
            status = child.try_wait().map_err(|error| error.to_string())?;
        }
        if start.elapsed() > timeout {
            timed_out = true;
            terminate(&mut child);
            break;
        }
    }
    child.reaped = true;
    Ok(ProcessOutput {
        text: String::from_utf8_lossy(&bytes).into_owned(),
        success: status.map(|s| s.success()).unwrap_or(false),
        timed_out,
    })
}

fn terminate(child: &mut Child) {
    let _ = super::process_tree::terminate_tree(child.id());
    let _ = child.kill();
    let _ = child.wait();
}
