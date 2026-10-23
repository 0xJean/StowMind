use super::{find_duplicates, DuplicateScanPhase};
use std::fs;

fn fixture(name: &str) -> std::path::PathBuf {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = std::env::temp_dir().join(format!("stowmind-duplicates-{name}-{stamp}"));
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("a"), "same bytes").unwrap();
    fs::write(root.join("b"), "same bytes").unwrap();
    root
}

#[test]
fn failed_hash_read_is_an_error_instead_of_a_false_empty_success() {
    let root = fixture("changed");
    let result = find_duplicates(root.to_str().unwrap(), true, &[], |progress| {
        if matches!(progress.phase, DuplicateScanPhase::Hashing) && progress.current == 0 {
            fs::remove_file(root.join("a")).unwrap();
        }
    });
    assert!(result.is_err());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn a_complete_scan_keeps_valid_file_sizes_and_exclusions() {
    let root = fixture("complete");
    fs::create_dir(root.join("excluded")).unwrap();
    fs::write(root.join("excluded/c"), "same bytes").unwrap();
    let result =
        find_duplicates(root.to_str().unwrap(), true, &["excluded".into()], |_| {}).unwrap();
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].size, 10);
    assert_eq!(result[0].paths.len(), 2);
    fs::remove_dir_all(root).unwrap();
}
