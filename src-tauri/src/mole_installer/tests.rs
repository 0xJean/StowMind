use super::{collect_installer_items, protocol, scripts};
use std::{
    fs,
    path::PathBuf,
    process::Command,
    sync::atomic::{AtomicU64, Ordering},
};

static NEXT: AtomicU64 = AtomicU64::new(0);
struct Fixture(PathBuf);
impl Fixture {
    fn new(source: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "stowmind-installer-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).unwrap();
        fs::write(path.join("installer.sh"), source).unwrap();
        Self(path)
    }
    fn script(&self) -> PathBuf {
        self.0.join("installer.sh")
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn failed_or_timed_out_collection_cannot_become_an_empty_success() {
    for code in [4, 124, 143] {
        let fixture = Fixture::new(&format!("INSTALLER_PATHS=(); mole_deletion_identity() {{ :; }}; collect_installers() {{ return {code}; }}"));
        assert!(collect_installer_items(&fixture.script()).is_err());
    }
    let fixture = Fixture::new(
        "INSTALLER_PATHS=(); mole_deletion_identity() { :; }; collect_installers() { return 1; }",
    );
    assert!(collect_installer_items(&fixture.script())
        .unwrap()
        .is_empty());
}

const EXECUTION_STUB: &str = r#"
reset_installer_delete_results() { total_deleted=0; total_size_freed_kb=0; total_delete_failed=0; }
build_installer_delete_plan() { INSTALLER_DELETE_IDENTITIES=("1:2:3"); }
execute_installer_delete_plan() { total_deleted=1; total_size_freed_kb=7; }
show_summary() { printf 'Removed %s installers\n' "$total_deleted"; }
"#;

#[test]
fn execution_keeps_mole_counters_in_the_parent_shell_without_running_real_cleanup() {
    let fixture = Fixture::new(EXECUTION_STUB);
    let path = fixture.0.join("quoted ' $(never-run).dmg");
    fs::write(&path, "fixture").unwrap();
    let output = Command::new("/bin/bash")
        .args([
            "-c",
            &scripts::execute_script(&fixture.script().to_string_lossy()),
            "fixture",
        ])
        .arg(&path)
        .args(["7", "1:2:3"])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let result = protocol::parse_outcome(&String::from_utf8_lossy(&output.stdout), true);
    assert_eq!(result.item_count, Some(1));
    assert_eq!(result.total_size, Some(7 * 1024));
    assert!(path.exists(), "the test stub must never delete the fixture");
}

#[test]
fn changed_review_identity_prevents_entering_the_mole_delete_function() {
    let fixture = Fixture::new(EXECUTION_STUB);
    let path = fixture.0.join("App.dmg");
    fs::write(&path, "fixture").unwrap();
    let output = Command::new("/bin/bash")
        .args([
            "-c",
            &scripts::execute_script(&fixture.script().to_string_lossy()),
            "fixture",
        ])
        .arg(&path)
        .args(["7", "1:999:3"])
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("changed since preview"));
    assert!(!String::from_utf8_lossy(&output.stdout).contains("Removed"));
}
