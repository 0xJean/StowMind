//! Track the owned group and observed descendants before their parent exits.
use std::{
    collections::HashMap,
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};

#[derive(Clone, Debug)]
struct Process {
    pid: i32,
    parent: i32,
    group: i32,
    started: String,
    zombie: bool,
}
impl Process {
    fn matches(&self, other: &Self) -> bool {
        self.pid == other.pid && self.started == other.started
    }
}

pub(super) struct ProcessTree {
    root: i32,
    tracked: HashMap<i32, Process>,
}

fn snapshot() -> Result<HashMap<i32, Process>, String> {
    let output = Command::new("/bin/ps")
        .args(["-axo", "pid=,ppid=,pgid=,stat=,lstart="])
        .stdin(Stdio::null())
        .output()
        .map_err(|error| format!("Cannot inspect maintenance processes: {error}"))?;
    if !output.status.success() {
        return Err("Cannot inspect maintenance processes".to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let fields: Vec<_> = line.split_whitespace().collect();
            if fields.len() < 9 {
                return None;
            }
            let process = Process {
                pid: fields[0].parse().ok()?,
                parent: fields[1].parse().ok()?,
                group: fields[2].parse().ok()?,
                zombie: fields[3].starts_with('Z'),
                started: fields[4..].join(" "),
            };
            Some((process.pid, process))
        })
        .collect())
}

impl ProcessTree {
    pub fn new(root: u32) -> Self {
        Self {
            root: root as i32,
            tracked: HashMap::new(),
        }
    }

    fn refresh(&mut self) -> Result<HashMap<i32, Process>, String> {
        let current = snapshot()?;
        if self.tracked.is_empty() {
            let root = current
                .get(&self.root)
                .ok_or("Maintenance process identity is unavailable")?;
            if root.parent != std::process::id() as i32 || root.group != self.root {
                return Err(
                    "Maintenance worker does not own its expected process group".to_string()
                );
            }
            self.tracked.insert(self.root, root.clone());
        }
        let root_matches = self
            .tracked
            .get(&self.root)
            .zip(current.get(&self.root))
            .is_some_and(|(old, now)| old.matches(now));
        loop {
            let additions: Vec<_> = current
                .values()
                .filter(|process| {
                    !self.tracked.contains_key(&process.pid)
                        && ((root_matches && process.group == self.root)
                            || self
                                .tracked
                                .get(&process.parent)
                                .zip(current.get(&process.parent))
                                .is_some_and(|(old, now)| old.matches(now)))
                })
                .cloned()
                .collect();
            if additions.is_empty() {
                break;
            }
            self.tracked
                .extend(additions.into_iter().map(|process| (process.pid, process)));
        }
        Ok(current)
    }

    pub fn poll(&mut self) -> Result<bool, String> {
        let current = self.refresh()?;
        Ok(self.tracked.values().any(|old| {
            current
                .get(&old.pid)
                .is_some_and(|now| old.matches(now) && !now.zombie)
        }))
    }

    pub fn signal(&mut self, signal: i32) -> Result<(), String> {
        let current = self.refresh()?;
        #[cfg(unix)]
        {
            // A held, unreaped group leader prevents PGID reuse during the run.
            if self
                .tracked
                .get(&self.root)
                .zip(current.get(&self.root))
                .is_some_and(|(old, now)| old.matches(now))
            {
                unsafe {
                    libc::kill(-self.root, signal);
                }
            }
            // Timeout wrappers can create independent groups. Signal only
            // descendants whose identities still match the running snapshot.
            for old in self.tracked.values() {
                if let Some(now) = current
                    .get(&old.pid)
                    .filter(|now| old.matches(now) && !now.zombie)
                {
                    unsafe {
                        libc::kill(now.pid, signal);
                    }
                }
            }
        }
        Ok(())
    }
}

/// An unconfirmed kill retains ownership and blocks new maintenance work. A
/// later cancel request retries recovery; it must not report success early.
pub(super) struct PendingCleanup {
    pub child: Child,
    pub tree: ProcessTree,
    #[cfg(test)]
    pub allow_cleanup: Option<std::sync::Arc<std::sync::atomic::AtomicBool>>,
}
impl PendingCleanup {
    pub fn new(child: Child, tree: ProcessTree) -> Self {
        Self {
            child,
            tree,
            #[cfg(test)]
            allow_cleanup: None,
        }
    }
    pub fn retry(&mut self) -> Result<(), String> {
        #[cfg(test)]
        if self
            .allow_cleanup
            .as_ref()
            .is_some_and(|allowed| !allowed.load(std::sync::atomic::Ordering::SeqCst))
        {
            return Err("Fixture cleanup is not yet confirmed".to_string());
        }
        self.tree.signal(libc::SIGTERM)?;
        let start = Instant::now();
        loop {
            if !self.tree.poll()? {
                return self
                    .child
                    .try_wait()
                    .map_err(|error| error.to_string())?
                    .map(|_| ())
                    .ok_or_else(|| "Maintenance worker has not exited".to_string());
            }
            if start.elapsed() >= Duration::from_millis(250) {
                self.tree.signal(libc::SIGKILL)?;
            }
            if start.elapsed() >= Duration::from_secs(2) {
                return Err("Maintenance descendants are still running; cancellation could not be confirmed".to_string());
            }
            std::thread::sleep(Duration::from_millis(40));
        }
    }
}
