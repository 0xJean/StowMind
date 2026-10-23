use super::{
    parser::{parse_outcome, parse_records, preview_size, COMPLETE_RECORD},
    scripts,
};

#[test]
fn current_mole_estimate_with_unmeasured_items_is_not_exact_freed_space() {
    // Mole 1.60 bin/purge.sh summary: measured preview sizes remain estimates.
    let result = parse_outcome(
        "Purge complete\nEstimated space freed: 42.50MB + 2 unmeasured | Items: 3 | Free: 500Gi\n",
        true,
    );
    assert_eq!(result.item_count, Some(3));
    assert_eq!(result.total_size, Some(44_564_480));
    assert_eq!(result.size_kind, "at_least");
    assert_eq!(result.outcome, "completed");
    let result = parse_outcome(
        "Purge complete\nEstimated space freed: 42.50MB | Items: 3\n",
        true,
    );
    assert_eq!(result.size_kind, "estimated");
}

#[test]
fn legacy_reported_freed_size_is_still_recognized() {
    let result = parse_outcome(
        "Purge complete\nSpace freed: 42.50MB | Items: 3 | Free: 500Gi\n",
        true,
    );
    assert_eq!(result.item_count, Some(3));
    assert_eq!(result.total_size, Some(44_564_480));
    assert_eq!(result.size_kind, "reported_freed");
}

#[test]
fn incomplete_nonzero_exit_keeps_confirmed_items_and_estimate() {
    let result = parse_outcome("Purge incomplete\nEstimated space freed: At least 1GB | Items: 2\nSome artifacts were skipped or could not be processed.\n", false);
    assert_eq!(result.outcome, "incomplete");
    assert_eq!(result.item_count, Some(2));
    assert_eq!(result.size_kind, "at_least");
}

#[test]
fn unknown_summary_does_not_return_zero_or_a_preview_estimate() {
    let result = parse_outcome(
        "Purge complete\nEstimated space freed: Partially measured | Items: 3\n",
        true,
    );
    assert_eq!(result.total_size, None);
    assert_eq!(result.item_count, Some(3));
    assert_eq!(result.size_kind, "unknown");
    let result = parse_outcome("unrecognized output", true);
    assert_eq!(result.item_count, None);
    assert_eq!(result.total_size, None);
    assert_eq!(result.outcome, "unknown");
}

#[test]
fn dry_run_output_is_never_counted_as_execution() {
    let result = parse_outcome(
        "Dry run complete - no changes made\nWould free approximately: 2GB | Items: 3\n",
        true,
    );
    assert_eq!(result.item_count, None);
    assert_eq!(result.total_size, None);
    assert_eq!(result.outcome, "unknown");
}

#[test]
fn explicit_noop_remains_zero_without_falling_back_to_preview() {
    for raw in [
        "Purge complete\nNo artifacts were removed.\n",
        "Great! No old project artifacts to clean\n",
        "No items selected\n",
    ] {
        let result = parse_outcome(raw, true);
        assert_eq!(result.item_count, Some(0));
        assert_eq!(result.total_size, Some(0));
    }
    let result = parse_outcome("Purge requires confirmation.", false);
    assert_eq!(result.outcome, "failed");
    assert_eq!(result.item_count, None);
}

#[test]
fn preview_requires_completion_and_keeps_unknown_sizes() {
    let raw = format!(
        "/tmp/project/target\x1funknown\x1e/tmp/project/empty\x1f0\x1e{COMPLETE_RECORD}\x1e"
    );
    let items = parse_records(&raw, false).unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].size, None);
    assert_eq!(preview_size(&items), (None, "unknown".to_string()));
    assert_eq!(parse_records(&raw, true).unwrap().len(), 2);
    assert!(parse_records("/tmp/project/target\x1f4096\x1e", false).is_err());
    assert!(parse_records("", false).is_err());
    assert!(parse_records(&format!("junk\x1e{COMPLETE_RECORD}\x1e"), false).is_err());
}

#[test]
fn mixed_known_and_unknown_preview_is_a_lower_bound() {
    let items = parse_records(
        &format!("/tmp/a\x1f4096\x1e/tmp/b\x1funknown\x1e{COMPLETE_RECORD}\x1e"),
        false,
    )
    .unwrap();
    assert_eq!(preview_size(&items), (Some(4096), "at_least".to_string()));
}

#[test]
fn script_quotes_scope_and_requires_moles_noninteractive_confirmation() {
    let script = scripts::execute("/tmp/Mole's/purge.sh", "/tmp/project's $(inert)", true);
    assert!(script.contains("MOLE_PURGE_YES=1"));
    assert!(script.contains("MOLE_PURGE_INCLUDE_EMPTY=1"));
    assert!(script.contains("PURGE_SEARCH_PATHS=('/tmp/project'\\''s $(inert)')"));
    assert!(!script.contains("MOLE_TEST_MODE=1"));
}

#[test]
fn failed_scan_cannot_produce_a_successful_empty_preview() {
    // Run only a fixture adapter. No installed Mole source, scan or cleanup is
    // called. Its failure must propagate before the completion record is sent.
    let dir =
        std::env::temp_dir().join(format!("stowmind-purge-script-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let fixture = dir.join("purge.sh");
    std::fs::write(
        &fixture,
        "set -euo pipefail\nscan_purge_targets() { return 124; }\n",
    )
    .unwrap();
    let output = std::process::Command::new("/bin/bash")
        .arg("-c")
        .arg(scripts::collect(
            fixture.to_str().unwrap(),
            dir.to_str().unwrap(),
            false,
        ))
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(124));
    assert!(!String::from_utf8_lossy(&output.stdout).contains(COMPLETE_RECORD));
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn execution_fixture_restricts_inventory_and_final_guard_to_reviewed_identities() {
    let dir = std::env::temp_dir().join(format!(
        "stowmind-purge-boundary-test-{}",
        std::process::id()
    ));
    std::fs::create_dir_all(dir.join("reviewed")).unwrap();
    std::fs::create_dir_all(dir.join("new-after-preview")).unwrap();
    let fixture = dir.join("purge.sh");
    std::fs::write(&fixture, r#"set -euo pipefail
changed=''; protected=0
mole_deletion_identity() { if [[ "$1" == "$changed" ]]; then printf '1:9:3'; else printf '1:2:3'; fi; }
_mole_purge_final_remove_guard() { [[ "$protected" == 0 ]]; }
scan_purge_targets() { printf 'UNREVIEWED ORIGINAL SCAN'; exit 90; }
start_purge() { :; }
perform_purge() {
  scan_purge_targets "${PURGE_SEARCH_PATHS[0]}" "$scratch/candidates"
  [[ $(wc -l < "$scratch/candidates") -eq 1 ]] || exit 91
  [[ $(cat "$scratch/candidates") == "${reviewed_paths[0]}" ]] || exit 92
  _mole_purge_final_remove_guard "${reviewed_paths[0]}" || exit 93
  if _mole_purge_final_remove_guard "${PURGE_SEARCH_PATHS[0]}/new-after-preview"; then exit 94; fi
  protected=1
  if _mole_purge_final_remove_guard "${reviewed_paths[0]}"; then exit 95; fi
  protected=0; changed="${reviewed_paths[0]}"
  if _mole_purge_final_remove_guard "${reviewed_paths[0]}"; then exit 96; fi
  printf 'REVIEW BOUNDARY VERIFIED'
}

"#).unwrap();
    // The fixture only checks function decisions. No delete function exists.
    let output = std::process::Command::new("/bin/bash")
        .arg("-c")
        .arg(scripts::execute(
            fixture.to_str().unwrap(),
            dir.to_str().unwrap(),
            false,
        ))
        .arg("test")
        .arg("1:2:3")
        .arg(dir.join("reviewed"))
        .arg("1:2:3")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "status {:?}: {}",
        output.status.code(),
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        String::from_utf8_lossy(&output.stdout),
        "REVIEW BOUNDARY VERIFIED"
    );
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn disappeared_candidate_fails_preview_instead_of_becoming_complete_zero() {
    let dir = std::env::temp_dir().join(format!(
        "stowmind-purge-missing-test-{}",
        std::process::id()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let fixture = dir.join("purge.sh");
    std::fs::write(
        &fixture,
        "set -euo pipefail\nscan_purge_targets() { printf '%s/gone\\n' \"$1\" > \"$2\"; }\n",
    )
    .unwrap();
    let output = std::process::Command::new("/bin/bash")
        .arg("-c")
        .arg(scripts::collect(
            fixture.to_str().unwrap(),
            dir.to_str().unwrap(),
            false,
        ))
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(66));
    assert!(!String::from_utf8_lossy(&output.stdout).contains(COMPLETE_RECORD));
    std::fs::remove_dir_all(dir).unwrap();
}
