//! Stop a scoped worker, including Mole timeout helpers in separate groups.
//! Never request sudo or signal a process merely because its PID was reused.
use std::{
    collections::HashMap,
    process::{Command, Stdio},
    time::{Duration, Instant},
};

#[derive(Clone, Debug)]
struct Process {
    pid: u32,
    parent: u32,
    group: u32,
    state: String,
    started: String,
}

impl Process {
    fn same_process(&self, other: &Self) -> bool {
        self.pid == other.pid && self.started == other.started
    }

    fn alive(&self) -> bool {
        !self.state.starts_with('Z')
    }
}

fn snapshot() -> Result<HashMap<u32, Process>, String> {
    let output = Command::new("/bin/ps")
        .args(["-axo", "pid=,ppid=,pgid=,stat=,lstart="])
        .stdin(Stdio::null())
        .output()
        .map_err(|error| format!("Cannot inspect cache worker processes: {error}"))?;
    if !output.status.success() {
        return Err("Cannot inspect cache worker processes".to_string());
    }
    Ok(parse_snapshot(&String::from_utf8_lossy(&output.stdout)))
}

fn parse_snapshot(text: &str) -> HashMap<u32, Process> {
    text.lines()
        .filter_map(|line| {
            let fields = line.split_whitespace().collect::<Vec<_>>();
            if fields.len() < 9 {
                return None;
            }
            let process = Process {
                pid: fields[0].parse().ok()?,
                parent: fields[1].parse().ok()?,
                group: fields[2].parse().ok()?,
                state: fields[3].to_string(),
                started: fields[4..].join(" "),
            };
            Some((process.pid, process))
        })
        .collect()
}

fn protected_root(root: u32, processes: &HashMap<u32, Process>) -> bool {
    if root <= 1 {
        return true;
    }
    let mut current = std::process::id();
    // A malformed or cyclic process table must not authorize a group signal.
    for _ in 0..processes.len() + 1 {
        if current == root {
            return true;
        }
        let Some(process) = processes.get(&current) else {
            return false;
        };
        if process.parent <= 1 {
            return false;
        }
        current = process.parent;
    }
    true
}

fn discover(tracked: &mut HashMap<u32, Process>, current: &HashMap<u32, Process>) {
    loop {
        let additions = current
            .values()
            .filter(|process| {
                !tracked.contains_key(&process.pid)
                    && tracked
                        .get(&process.parent)
                        .zip(current.get(&process.parent))
                        .map(|(old, now)| old.same_process(now))
                        .unwrap_or(false)
            })
            .cloned()
            .collect::<Vec<_>>();
        if additions.is_empty() {
            break;
        }
        tracked.extend(additions.into_iter().map(|process| (process.pid, process)));
    }
}

fn signal(signal: &str, target: String) {
    let _ = Command::new("/bin/kill")
        .args([signal, "--", &target])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

fn remaining(tracked: &HashMap<u32, Process>, current: &HashMap<u32, Process>) -> Vec<Process> {
    tracked
        .values()
        .filter_map(|old| {
            current
                .get(&old.pid)
                .filter(|now| old.same_process(now) && now.alive())
                .cloned()
        })
        .collect()
}

struct StoppedRoot(Process);
impl Drop for StoppedRoot {
    fn drop(&mut self) {
        // Keep error paths from leaving the worker stopped indefinitely. The
        // owner also reaps it; this guard only handles our temporary STOP.
        if snapshot()
            .ok()
            .and_then(|table| table.get(&self.0.pid).cloned())
            .map(|now| self.0.same_process(&now) && now.alive())
            .unwrap_or(false)
        {
            signal("-KILL", self.0.pid.to_string());
        }
    }
}

/// Preserve descendant identities before terminating their owner. Sending TERM
/// to sudo/timeout helpers first gives them time to forward it to privileged
/// children. A stopped root cannot begin another cleanup stage meanwhile.
/// Callers must treat an error as an unconfirmed cancellation and must not
/// measure an after state while a privileged descendant may still be running.
pub(super) fn terminate_tree(root: u32) -> Result<(), String> {
    #[cfg(not(unix))]
    {
        let _ = root;
        return Err("Process tree cancellation requires Unix".to_string());
    }
    #[cfg(unix)]
    {
        let initial = snapshot()?;
        if protected_root(root, &initial) {
            return Err("Refusing to stop the application or an ancestor process".to_string());
        }
        let Some(worker) = initial.get(&root).cloned() else {
            return Ok(());
        };
        let mut tracked = HashMap::from([(root, worker.clone())]);
        discover(&mut tracked, &initial);
        signal("-STOP", root.to_string());
        let _stopped_root = StoppedRoot(worker);
        let mut terminated = HashMap::<u32, String>::new();
        let grace = Instant::now();
        loop {
            let current = snapshot()?;
            discover(&mut tracked, &current);
            let live = remaining(&tracked, &current);
            let descendants = live
                .iter()
                .filter(|process| process.pid != root)
                .collect::<Vec<_>>();
            for process in &descendants {
                if terminated.get(&process.pid) != Some(&process.started) {
                    signal("-TERM", process.pid.to_string());
                    terminated.insert(process.pid, process.started.clone());
                }
            }
            if descendants.is_empty() || grace.elapsed() >= Duration::from_millis(2500) {
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        let current = snapshot()?;
        discover(&mut tracked, &current);
        // Only signal a group when every current member is an identified
        // descendant. This also refuses the app's own or any reused group.
        let live = remaining(&tracked, &current);
        let mut groups = live.iter().map(|process| process.group).collect::<Vec<_>>();
        groups.sort_unstable();
        groups.dedup();
        for group in groups {
            if group <= 1 {
                continue;
            }
            let safe = current
                .values()
                .filter(|process| process.group == group)
                .all(|process| {
                    tracked
                        .get(&process.pid)
                        .map(|old| old.same_process(process))
                        .unwrap_or(false)
                });
            if safe {
                signal("-KILL", format!("-{group}"));
            }
        }
        for process in &live {
            signal("-KILL", process.pid.to_string());
        }
        let deadline = Instant::now() + Duration::from_secs(1);
        loop {
            let current = snapshot()?;
            if remaining(&tracked, &current).is_empty() {
                return Ok(());
            }
            if Instant::now() >= deadline {
                return Err("Cache worker descendants may still be running; cancellation could not be confirmed".to_string());
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::{fs, os::unix::process::CommandExt, path::PathBuf};

    fn fixture_command(mode: &str, ready: &std::path::Path) -> Command {
        let mut command = Command::new(std::env::current_exe().unwrap());
        let fixture = concat!(module_path!(), "::cancellation_fixture");
        let fixture = fixture.split_once("::").unwrap().1;
        command
            .args(["--ignored", "--exact", fixture, "--nocapture"])
            .env("STOWMIND_CANCEL_FIXTURE", mode)
            .env("STOWMIND_CANCEL_READY", ready)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        command.process_group(0);
        command
    }

    #[test]
    #[ignore = "subprocess fixture, invoked by the cancellation regression test"]
    fn cancellation_fixture() {
        let Ok(mode) = std::env::var("STOWMIND_CANCEL_FIXTURE") else {
            return;
        };
        let ready = PathBuf::from(std::env::var_os("STOWMIND_CANCEL_READY").unwrap());
        if mode == "root" {
            let _helper = fixture_command("helper", &ready).spawn().unwrap();
        } else {
            let mut command = Command::new("/bin/sleep");
            command.arg("30").process_group(0);
            let leaf = command.spawn().unwrap();
            fs::write(&ready, format!("{} {}", std::process::id(), leaf.id())).unwrap();
        }
        std::thread::sleep(Duration::from_secs(30));
    }

    #[test]
    fn cancellation_stops_independent_group_grandchild_and_preserves_unrelated_process() {
        let ready = std::env::temp_dir().join(format!(
            "stowmind-cancel-{}-{:?}",
            std::process::id(),
            Instant::now()
        ));
        let mut worker = fixture_command("root", &ready).spawn().unwrap();
        let mut sentinel_command = Command::new("/bin/sleep");
        sentinel_command.arg("30").process_group(0);
        let mut sentinel = sentinel_command.spawn().unwrap();
        let result = (|| {
            let start = Instant::now();
            let ids = loop {
                if let Ok(contents) = fs::read_to_string(&ready) {
                    break contents;
                }
                if start.elapsed() > Duration::from_secs(5) {
                    return Err("fixture was not ready".to_string());
                }
                std::thread::sleep(Duration::from_millis(20));
            };
            let ids = ids
                .split_whitespace()
                .map(|pid| pid.parse::<u32>().unwrap())
                .collect::<Vec<_>>();
            let before = snapshot()?;
            assert_ne!(before[&ids[0]].group, before[&worker.id()].group);
            assert_ne!(before[&ids[1]].group, before[&ids[0]].group);
            terminate_tree(worker.id())?;
            let after = snapshot()?;
            for pid in ids {
                assert!(!after.get(&pid).map(Process::alive).unwrap_or(false));
            }
            assert!(sentinel.try_wait().unwrap().is_none());
            assert!(after.contains_key(&std::process::id()));
            Ok::<_, String>(())
        })();
        let _ = terminate_tree(worker.id());
        let _ = worker.wait();
        let _ = sentinel.kill();
        let _ = sentinel.wait();
        let _ = fs::remove_file(ready);
        result.unwrap();
    }

    #[test]
    fn application_and_ancestors_are_never_valid_cancellation_roots() {
        let table = snapshot().unwrap();
        assert!(protected_root(std::process::id(), &table));
        assert!(protected_root(table[&std::process::id()].parent, &table));
        assert!(protected_root(1, &table));
    }
}
