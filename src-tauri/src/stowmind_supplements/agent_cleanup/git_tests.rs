use super::{scan_repository, Repository};
use crate::stowmind_supplements::agent_cleanup::types::AgentCleanupPolicy;
use std::{
    fs,
    io::Write,
    process::{Command, Stdio},
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
