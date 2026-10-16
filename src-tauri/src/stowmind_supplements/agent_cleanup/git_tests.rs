use super::safety::git_expiration_arg;
use super::{parse_ref_item_id, ref_oid, scan_repository, Repository};
use crate::stowmind_supplements::agent_cleanup::types::AgentCleanupPolicy;
use std::{
    fs,
    io::Write,
    process::{Command, Stdio},
    thread::sleep,
    time::Duration,
    time::{SystemTime, UNIX_EPOCH},
};

fn temp_repo() -> Repository {
    let root = std::env::temp_dir().join(format!(
        "stowmind-agent-git-test-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(&root).unwrap();
    for args in [
        &["init", "-q"][..],
        &["config", "user.email", "test@example.com"][..],
        &["config", "user.name", "Test"][..],
    ] {
        assert!(Command::new("git")
            .args(args)
            .current_dir(&root)
            .status()
            .unwrap()
            .success());
    }
    fs::write(root.join("tracked"), "tracked").unwrap();
    for args in [&["add", "tracked"][..], &["commit", "-qm", "test"][..]] {
        assert!(Command::new("git")
            .args(args)
            .current_dir(&root)
            .status()
            .unwrap()
            .success());
    }
    let git_dir = fs::canonicalize(root.join(".git")).unwrap();
    Repository { root, git_dir }
}

#[test]
fn scans_codex_refs_and_unreachable_objects() {
    let repository = temp_repo();
    assert!(Command::new("git")
        .args(["update-ref", "refs/codex/turn-diffs/test", "HEAD"])
        .current_dir(&repository.root)
        .status()
        .unwrap()
        .success());
    let mut hash = Command::new("git")
        .args(["hash-object", "-w", "--stdin"])
        .current_dir(&repository.root)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .spawn()
        .unwrap();
    {
        let mut input = hash.stdin.take().unwrap();
        input.write_all(b"unreachable").unwrap();
    }
    assert!(hash.wait().unwrap().success());
    let items = scan_repository(
        &repository,
        &AgentCleanupPolicy {
            min_age_days: 0,
            ..Default::default()
        },
        crate::stowmind_supplements::agent_cleanup::scanner::epoch_now(),
    );
    assert!(items
        .iter()
        .any(|item| item.category == "codex_internal_ref"));
    assert!(items
        .iter()
        .any(|item| item.category == "git_unreachable_object"));
    let _ = fs::remove_dir_all(repository.root);
}

#[test]
fn protects_unreachable_objects_when_repository_has_tracked_changes() {
    let repository = temp_repo();
    fs::write(repository.root.join("tracked"), "changed").unwrap();
    let mut hash = Command::new("git")
        .args(["hash-object", "-w", "--stdin"])
        .current_dir(&repository.root)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .spawn()
        .unwrap();
    {
        let mut input = hash.stdin.take().unwrap();
        input.write_all(b"unreachable").unwrap();
    }
    assert!(hash.wait().unwrap().success());
    let items = scan_repository(
        &repository,
        &AgentCleanupPolicy {
            min_age_days: 0,
            ..Default::default()
        },
        crate::stowmind_supplements::agent_cleanup::scanner::epoch_now(),
    );
    let item = items
        .iter()
        .find(|item| item.category == "git_unreachable_object")
        .expect("unreachable object preview");
    assert!(item.protected);
    assert!(!item.reason.is_empty());
    let _ = fs::remove_dir_all(repository.root);
}

#[test]
fn ref_preview_records_expected_oid_and_retention_cutoff() {
    let repository = temp_repo();
    assert!(Command::new("git")
        .args(["update-ref", "refs/codex/turn-diffs/test", "HEAD"])
        .current_dir(&repository.root)
        .status()
        .unwrap()
        .success());
    let now = crate::stowmind_supplements::agent_cleanup::scanner::epoch_now();
    let items = scan_repository(
        &repository,
        &AgentCleanupPolicy {
            min_age_days: 0,
            ..Default::default()
        },
        now,
    );
    let item = items
        .iter()
        .find(|item| item.category == "codex_internal_ref")
        .expect("Codex ref preview");
    let payload = parse_ref_item_id(&item.id).expect("ref item payload");
    assert_eq!(payload.refname, "refs/codex/turn-diffs/test");
    assert_eq!(
        payload.expected_oid,
        ref_oid(&repository, &payload.refname).unwrap()
    );

    let policy = AgentCleanupPolicy {
        min_age_days: 7,
        ..Default::default()
    };
    assert_eq!(git_expiration_arg(&policy, 1_000_000), "@395200");
    let _ = fs::remove_dir_all(repository.root);
}

#[test]
fn git_update_ref_old_oid_guard_preserves_changed_ref() {
    let repository = temp_repo();
    let refname = "refs/codex/turn-diffs/race";
    assert!(Command::new("git")
        .args(["update-ref", refname, "HEAD"])
        .current_dir(&repository.root)
        .status()
        .unwrap()
        .success());
    let old_oid = ref_oid(&repository, refname).unwrap();
    let mut object = Command::new("git")
        .args(["hash-object", "-w", "--stdin"])
        .current_dir(&repository.root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    object
        .stdin
        .take()
        .unwrap()
        .write_all(b"new target")
        .unwrap();
    let output = object.wait_with_output().unwrap();
    assert!(output.status.success());
    let new_oid = String::from_utf8_lossy(&output.stdout).trim().to_string();
    assert!(Command::new("git")
        .args(["update-ref", refname, &new_oid])
        .current_dir(&repository.root)
        .status()
        .unwrap()
        .success());
    let result = Command::new("git")
        .args(["update-ref", "-d", refname, &old_oid])
        .current_dir(&repository.root)
        .output()
        .unwrap();
    assert!(!result.status.success(), "stale old OID must fail closed");
    assert_eq!(ref_oid(&repository, refname).unwrap(), new_oid);
    let _ = fs::remove_dir_all(repository.root);
}

#[cfg(unix)]
#[test]
fn protects_repository_while_git_process_is_active() {
    let repository = temp_repo();
    let git_dir = repository.git_dir.to_string_lossy().to_string();
    let mut child = Command::new("git")
        .args(["--git-dir", &git_dir, "cat-file", "--batch"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    sleep(Duration::from_millis(75));
    assert!(super::git_process_running(&repository));
    let _ = child.kill();
    let _ = child.wait();
    let _ = fs::remove_dir_all(repository.root);
}
