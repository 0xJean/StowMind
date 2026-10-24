//! Regression coverage for the actual guarded deletion command. Reflogs are
//! compared as bytes because `git reflog` hides invalid zero-to-zero records.

use super::{
    execution::delete_codex_ref, safety::protect_worktree_heads, scan_repository, tests::temp_repo,
    Repository,
};
use crate::stowmind_supplements::agent_cleanup::types::AgentCleanupPolicy;
use std::{collections::BTreeMap, fs, path::Path, process::Command};

const CODEX_REF: &str = "refs/codex/turn-diffs/reviewed";
const OTHER_CODEX_REF: &str = "refs/codex/turn-diffs/retained";

struct Fixture(Repository);

impl Fixture {
    fn new() -> Self {
        let fixture = Self(temp_repo());
        git(&fixture.0, &["branch", "-M", "main"]);
        git(&fixture.0, &["config", "core.logAllRefUpdates", "always"]);
        git(&fixture.0, &["branch", "retained-branch"]);
        git(
            &fixture.0,
            &["tag", "-a", "v-fixture", "-m", "Retained release tag"],
        );
        fixture
    }

    fn add_tree_refs(&self) -> String {
        let tree = git(&self.0, &["rev-parse", "HEAD^{tree}"]);
        for name in [CODEX_REF, OTHER_CODEX_REF] {
            git(&self.0, &["update-ref", name, &tree]);
        }
        tree
    }

    fn add_linked_worktree(&self) -> Repository {
        let root = self.0.root.join("linked-worktree");
        let path = root.to_str().unwrap();
        git(&self.0, &["worktree", "add", "--detach", path, "HEAD"]);
        let git_dir = std::path::PathBuf::from(git(
            &self.0,
            &["-C", path, "rev-parse", "--absolute-git-dir"],
        ));
        Repository { root, git_dir }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        // Each fixture owns an atomically reserved temporary repository.
        let _ = fs::remove_dir_all(&self.0.root);
    }
}

fn git(repository: &Repository, args: &[&str]) -> String {
    let output = Command::new("git")
        .args(args)
        .current_dir(&repository.root)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap().trim().to_string()
}

fn collect_files(root: &Path, directory: &Path, output: &mut BTreeMap<String, Vec<u8>>) {
    if !directory.exists() {
        return;
    }
    for entry in fs::read_dir(directory).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            collect_files(root, &path, output);
        } else {
            output.insert(
                path.strip_prefix(root)
                    .unwrap()
                    .components()
                    .map(|component| component.as_os_str().to_string_lossy())
                    .collect::<Vec<_>>()
                    .join("/"),
                fs::read(path).unwrap(),
            );
        }
    }
}

#[derive(Debug, PartialEq)]
struct MetadataSnapshot {
    head: Vec<u8>,
    refs: BTreeMap<String, String>,
    logs: BTreeMap<String, Vec<u8>>,
}

impl MetadataSnapshot {
    fn read(repository: &Repository) -> Self {
        let refs = git(
            repository,
            &[
                "for-each-ref",
                "--format=%(refname) %(objectname) %(symref)",
            ],
        )
        .lines()
        .map(|line| {
            let (name, value) = line.split_once(' ').unwrap();
            (name.to_string(), value.to_string())
        })
        .collect();
        let log_directory = repository.git_dir.join("logs");
        let mut logs = BTreeMap::new();
        collect_files(&log_directory, &log_directory, &mut logs);
        Self {
            head: fs::read(repository.git_dir.join("HEAD")).unwrap(),
            refs,
            logs,
        }
    }

    fn without_reviewed_ref(mut self) -> Self {
        assert!(self.refs.remove(CODEX_REF).is_some());
        self.logs.remove(CODEX_REF);
        self
    }
}

fn scan(repository: &Repository) {
    let items = scan_repository(
        repository,
        &AgentCleanupPolicy {
            min_age_days: 0,
            ..Default::default()
        },
        crate::stowmind_supplements::agent_cleanup::scanner::epoch_now(),
    );
    assert!(items
        .iter()
        .any(|item| item.category == "codex_internal_ref"));
}

#[test]
fn scanning_codex_refs_preserves_all_refs_and_reflog_bytes() {
    let fixture = Fixture::new();
    fixture.add_tree_refs();
    let before = MetadataSnapshot::read(&fixture.0);
    assert!(before.logs.contains_key("HEAD"));
    assert!(before.logs.contains_key("refs/heads/main"));
    scan(&fixture.0);
    assert_eq!(MetadataSnapshot::read(&fixture.0), before);
}

fn assert_tree_ref_deletion_preserves_protected_metadata(packed: bool) {
    let fixture = Fixture::new();
    let tree = fixture.add_tree_refs();
    if packed {
        git(&fixture.0, &["pack-refs", "--all"]);
        assert!(!fixture.0.git_dir.join(CODEX_REF).exists());
    } else {
        assert!(fixture.0.git_dir.join(CODEX_REF).is_file());
    }
    let before = MetadataSnapshot::read(&fixture.0);
    assert!(before.logs.contains_key(CODEX_REF));
    delete_codex_ref(&fixture.0, CODEX_REF, &tree).unwrap();
    assert_eq!(
        MetadataSnapshot::read(&fixture.0),
        before.without_reviewed_ref()
    );
}

#[test]
fn deleting_loose_codex_tree_ref_preserves_head_branches_tags_and_logs() {
    assert_tree_ref_deletion_preserves_protected_metadata(false);
}

#[test]
fn deleting_packed_codex_tree_ref_preserves_head_branches_tags_and_logs() {
    assert_tree_ref_deletion_preserves_protected_metadata(true);
}

#[test]
fn stale_oid_deletion_preserves_changed_ref_and_all_reflog_bytes() {
    let fixture = Fixture::new();
    let stale_tree = fixture.add_tree_refs();
    git(&fixture.0, &["update-ref", CODEX_REF, "HEAD"]);
    let before = MetadataSnapshot::read(&fixture.0);
    assert!(delete_codex_ref(&fixture.0, CODEX_REF, &stale_tree).is_err());
    assert_eq!(MetadataSnapshot::read(&fixture.0), before);
}

#[test]
fn locked_ref_deletion_preserves_refs_logs_and_existing_lock() {
    let fixture = Fixture::new();
    let tree = fixture.add_tree_refs();
    let lock = fixture.0.git_dir.join(format!("{CODEX_REF}.lock"));
    fs::write(&lock, b"owned by another writer").unwrap();
    let before = MetadataSnapshot::read(&fixture.0);
    assert!(delete_codex_ref(&fixture.0, CODEX_REF, &tree).is_err());
    assert_eq!(MetadataSnapshot::read(&fixture.0), before);
    assert_eq!(fs::read(lock).unwrap(), b"owned by another writer");
}

#[test]
fn deletion_rejects_protected_refs_and_invalid_oids_without_changing_metadata() {
    let fixture = Fixture::new();
    fixture.add_tree_refs();
    let before = MetadataSnapshot::read(&fixture.0);
    for refname in ["refs/heads/main", "refs/tags/v-fixture", "HEAD"] {
        let oid = git(&fixture.0, &["rev-parse", "--verify", refname]);
        assert!(delete_codex_ref(&fixture.0, refname, &oid).is_err());
    }
    for oid in ["not-an-object-id", "", "1234567890abcdef"] {
        assert!(delete_codex_ref(&fixture.0, CODEX_REF, oid).is_err());
    }
    assert_eq!(MetadataSnapshot::read(&fixture.0), before);
}

#[test]
fn symbolic_codex_ref_deletion_preserves_main_and_release_tag_targets() {
    for target in ["refs/heads/main", "refs/tags/v-fixture"] {
        let fixture = Fixture::new();
        git(&fixture.0, &["symbolic-ref", CODEX_REF, target]);
        let oid = git(&fixture.0, &["rev-parse", "--verify", target]);
        let before = MetadataSnapshot::read(&fixture.0);
        assert!(before.refs[CODEX_REF].ends_with(&format!(" {target}")));
        delete_codex_ref(&fixture.0, CODEX_REF, &oid).unwrap();
        assert!(!fixture.0.git_dir.join(CODEX_REF).exists());
        assert_eq!(
            MetadataSnapshot::read(&fixture.0),
            before.without_reviewed_ref()
        );
    }
}

#[test]
fn deleting_codex_ref_used_directly_by_head_is_rejected_without_metadata_changes() {
    let fixture = Fixture::new();
    let oid = git(&fixture.0, &["rev-parse", "HEAD"]);
    git(&fixture.0, &["update-ref", CODEX_REF, &oid]);
    git(&fixture.0, &["symbolic-ref", "HEAD", CODEX_REF]);
    let before = MetadataSnapshot::read(&fixture.0);

    assert!(delete_codex_ref(&fixture.0, CODEX_REF, &oid).is_err());

    assert_eq!(MetadataSnapshot::read(&fixture.0), before);
    assert_eq!(git(&fixture.0, &["rev-parse", "HEAD"]), oid);
}

#[test]
fn deleting_codex_alias_in_head_chain_is_rejected_without_metadata_changes() {
    let fixture = Fixture::new();
    let oid = git(&fixture.0, &["rev-parse", "HEAD"]);
    git(&fixture.0, &["symbolic-ref", CODEX_REF, "refs/heads/main"]);
    git(&fixture.0, &["symbolic-ref", "HEAD", CODEX_REF]);
    let before = MetadataSnapshot::read(&fixture.0);

    assert!(delete_codex_ref(&fixture.0, CODEX_REF, &oid).is_err());

    assert_eq!(MetadataSnapshot::read(&fixture.0), before);
    assert_eq!(git(&fixture.0, &["rev-parse", "HEAD"]), oid);
}

#[test]
fn deleting_codex_ref_used_by_linked_worktree_preserves_both_heads_and_logs() {
    let fixture = Fixture::new();
    let oid = git(&fixture.0, &["rev-parse", "HEAD"]);
    git(&fixture.0, &["update-ref", CODEX_REF, &oid]);
    let linked = fixture.add_linked_worktree();
    git(&linked, &["symbolic-ref", "HEAD", CODEX_REF]);
    let linked_git_dir = &linked.git_dir;
    let linked_head = fs::read(linked_git_dir.join("HEAD")).unwrap();
    let mut linked_logs = BTreeMap::new();
    collect_files(
        &linked_git_dir,
        &linked_git_dir.join("logs"),
        &mut linked_logs,
    );
    assert!(linked_logs.contains_key("logs/HEAD"));
    let before = MetadataSnapshot::read(&fixture.0);

    assert!(delete_codex_ref(&fixture.0, CODEX_REF, &oid).is_err());

    assert_eq!(MetadataSnapshot::read(&fixture.0), before);
    assert_eq!(fs::read(linked_git_dir.join("HEAD")).unwrap(), linked_head);
    let mut logs_after = BTreeMap::new();
    collect_files(
        &linked_git_dir,
        &linked_git_dir.join("logs"),
        &mut logs_after,
    );
    assert_eq!(logs_after, linked_logs);
    assert_eq!(git(&linked, &["rev-parse", "HEAD"]), oid);
}

#[test]
fn head_guard_blocks_concurrent_switches_and_releases_all_owned_locks() {
    let fixture = Fixture::new();
    fixture.add_tree_refs();
    let linked = fixture.add_linked_worktree();
    let before = MetadataSnapshot::read(&fixture.0);
    let linked_before = MetadataSnapshot::read(&linked);
    let guard = protect_worktree_heads(&fixture.0, CODEX_REF).unwrap();
    for repository in [&fixture.0, &linked] {
        assert!(repository.git_dir.join("HEAD.lock").is_file());
        let output = Command::new("git")
            .arg("--git-dir")
            .arg(&repository.git_dir)
            .args(["symbolic-ref", "HEAD", CODEX_REF])
            .output()
            .unwrap();
        assert!(!output.status.success());
    }
    assert_eq!(MetadataSnapshot::read(&fixture.0), before);
    assert_eq!(MetadataSnapshot::read(&linked), linked_before);
    drop(guard);
    assert!(!fixture.0.git_dir.join("HEAD.lock").exists());
    assert!(!linked.git_dir.join("HEAD.lock").exists());
    assert_eq!(MetadataSnapshot::read(&fixture.0), before);
    assert_eq!(MetadataSnapshot::read(&linked), linked_before);
}

#[test]
fn preexisting_head_lock_is_preserved_and_partial_acquisition_is_released() {
    for lock_linked_worktree in [false, true] {
        let fixture = Fixture::new();
        fixture.add_tree_refs();
        let linked = fixture.add_linked_worktree();
        let existing_lock = if lock_linked_worktree {
            linked.git_dir.join("HEAD.lock")
        } else {
            fixture.0.git_dir.join("HEAD.lock")
        };
        fs::write(&existing_lock, b"another writer owns this lock").unwrap();
        let before = MetadataSnapshot::read(&fixture.0);
        let linked_before = MetadataSnapshot::read(&linked);

        assert!(protect_worktree_heads(&fixture.0, CODEX_REF).is_err());

        assert_eq!(
            fs::read(existing_lock).unwrap(),
            b"another writer owns this lock"
        );
        assert_eq!(MetadataSnapshot::read(&fixture.0), before);
        assert_eq!(MetadataSnapshot::read(&linked), linked_before);
        let other_lock = if lock_linked_worktree {
            fixture.0.git_dir.join("HEAD.lock")
        } else {
            linked.git_dir.join("HEAD.lock")
        };
        assert!(!other_lock.exists());
    }
}

#[test]
fn head_alias_with_different_case_is_rejected_without_metadata_changes() {
    let fixture = Fixture::new();
    let oid = git(&fixture.0, &["rev-parse", "HEAD"]);
    git(&fixture.0, &["update-ref", CODEX_REF, &oid]);
    // This names the same stored ref on a case-insensitive filesystem. On a
    // case-sensitive filesystem the guard must still reject conservatively.
    git(
        &fixture.0,
        &["symbolic-ref", "HEAD", "refs/codex/turn-diffs/REVIEWED"],
    );
    let before = MetadataSnapshot::read(&fixture.0);
    assert!(delete_codex_ref(&fixture.0, CODEX_REF, &oid).is_err());
    assert_eq!(MetadataSnapshot::read(&fixture.0), before);
    assert!(!fixture.0.git_dir.join("HEAD.lock").exists());
}

#[test]
fn head_guard_drop_preserves_a_lock_replaced_by_another_writer() {
    let fixture = Fixture::new();
    fixture.add_tree_refs();
    let before = MetadataSnapshot::read(&fixture.0);
    let guard = protect_worktree_heads(&fixture.0, CODEX_REF).unwrap();
    let lock = fixture.0.git_dir.join("HEAD.lock");
    fs::write(&lock, b"replacement writer").unwrap();
    drop(guard);
    assert_eq!(fs::read(lock).unwrap(), b"replacement writer");
    assert_eq!(MetadataSnapshot::read(&fixture.0), before);
}

#[test]
fn scanning_and_successful_or_failed_deletion_do_not_create_disabled_reflogs() {
    let fixture = Fixture::new();
    git(&fixture.0, &["config", "core.logAllRefUpdates", "false"]);
    let logs = fixture.0.git_dir.join("logs");
    fs::remove_dir_all(&logs).unwrap();
    let tree = fixture.add_tree_refs();
    let before = MetadataSnapshot::read(&fixture.0);
    scan(&fixture.0);
    assert_eq!(MetadataSnapshot::read(&fixture.0), before);
    assert!(!logs.exists());

    let wrong_oid = git(&fixture.0, &["rev-parse", "HEAD"]);
    assert!(delete_codex_ref(&fixture.0, CODEX_REF, &wrong_oid).is_err());
    assert_eq!(MetadataSnapshot::read(&fixture.0), before);
    assert!(!logs.exists());

    let lock = fixture.0.git_dir.join(format!("{CODEX_REF}.lock"));
    fs::write(&lock, b"another writer").unwrap();
    assert!(delete_codex_ref(&fixture.0, CODEX_REF, &tree).is_err());
    assert_eq!(MetadataSnapshot::read(&fixture.0), before);
    assert!(!logs.exists());
    fs::remove_file(lock).unwrap();

    delete_codex_ref(&fixture.0, CODEX_REF, &tree).unwrap();
    assert_eq!(
        MetadataSnapshot::read(&fixture.0),
        before.without_reviewed_ref()
    );
    assert!(!logs.exists());
}
