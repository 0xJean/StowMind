use super::{
    format_clean_process_failure, parse_clean_preview,
    summary::{MoleCleanScanStatus as Scan, MoleCleanSummaryStatus as Summary},
};

#[test]
fn captured_mole_160_lower_bound_summary_keeps_its_totals() {
    // Captured from the StowMind 1.2.0 system-clean screen. This exact ending
    // previously failed the regex and became 0 B / 0 items / 0 categories.
    // A local read-only diagnostic can supply the complete capture without
    // checking private paths into the repository. CI uses the redacted ending.
    let local_capture = std::env::var_os("STOWMIND_CLEAN_RAW_FIXTURE")
        .map(|path| std::fs::read_to_string(path).expect("read local clean capture"));
    let preview = parse_clean_preview(
        local_capture
            .as_deref()
            .unwrap_or(include_str!("fixtures/mole-1.60-at-least.txt")),
    );
    assert_eq!(preview.potential_space, Some(33_178_622_362));
    assert_eq!(preview.item_count, Some(890));
    assert_eq!(preview.category_count, Some(6));
    assert_eq!(preview.summary_status, Summary::AtLeast);
    assert_eq!(preview.scan_status, Scan::Complete);
}

#[test]
fn legacy_exact_summary_and_sections_are_preserved() {
    let preview = parse_clean_preview(include_str!("fixtures/legacy-complete.txt"));
    assert_eq!(preview.potential_space, Some(21_013_127_496));
    assert_eq!(preview.item_count, Some(1050));
    assert_eq!(preview.category_count, Some(50));
    assert_eq!(preview.summary_status, Summary::Exact);
    assert_eq!(preview.scan_status, Scan::Complete);
    assert_eq!(preview.sections.len(), 2);
    assert_eq!(preview.sections[0].title, "User essentials");
    assert_eq!(preview.sections[0].items[0].count, Some(187));
    assert_eq!(preview.sections[0].items[0].size, Some(9_502_615_142));
    assert_eq!(preview.sections[1].items[2].status, "ok");
}

#[test]
fn ansi_redraws_and_case_do_not_erase_lower_bound_counts() {
    let preview = parse_clean_preview("\x1b[32mDry run complete - no changes made\x1b[0m\r\n\x1b[33mPotential space: AT LEAST 1.25 gb\x1b[0m | Items: 1,234 | Categories: 6\r\n");
    assert_eq!(preview.potential_space, Some(1_342_177_280));
    assert_eq!(preview.item_count, Some(1234));
    assert_eq!(preview.summary_status, Summary::AtLeast);
}

#[test]
fn unknown_space_keeps_valid_independent_counts() {
    for space in ["Unknown", "Partially measured", "about 1GB", "1PB", "-1GB"] {
        let preview = parse_clean_preview(&format!(
            "Dry run complete - no changes made\nPotential space: {space} | Items: 890 | Categories: 6\n"
        ));
        assert_eq!(preview.potential_space, None, "{space}");
        assert_eq!(preview.item_count, Some(890));
        assert_eq!(preview.category_count, Some(6));
        assert_eq!(preview.summary_status, Summary::Unavailable);
    }
}

#[test]
fn missing_or_invalid_counts_are_unknown_not_zero() {
    let preview = parse_clean_preview("Potential space: At least 0B | Items: unavailable");
    assert_eq!(preview.potential_space, Some(0));
    assert_eq!(preview.item_count, None);
    assert_eq!(preview.category_count, None);
    assert_eq!(preview.summary_status, Summary::AtLeast);
    assert_eq!(preview.scan_status, Scan::Unknown);
}

#[test]
fn missing_summary_never_becomes_a_successful_zero_result() {
    let preview = parse_clean_preview("➤ User essentials\n  → Cache 3 items, 2GB dry\n");
    assert_eq!(preview.potential_space, None);
    assert_eq!(preview.item_count, None);
    assert_eq!(preview.category_count, None);
    assert_eq!(preview.summary_status, Summary::Unavailable);
    assert_eq!(preview.scan_status, Scan::Unknown);
    assert_eq!(preview.sections[0].items[0].size, Some(2_147_483_648));
    let json = serde_json::to_value(preview).unwrap();
    assert!(json["potential_space"].is_null());
    assert_eq!(json["summary_status"], "unavailable");
}

#[test]
fn explicit_empty_result_is_zero_only_after_successful_completion() {
    for message in [
        "No significant reclaimable space detected, system already clean.",
        "No additional reclaimable space detected.",
    ] {
        let preview = parse_clean_preview(&format!(
            "Dry run complete - no changes made\n{message}\nFree space: 34.9GB"
        ));
        assert_eq!(preview.potential_space, Some(0));
        assert_eq!(preview.item_count, Some(0));
        assert_eq!(preview.category_count, Some(0));
        assert_eq!(preview.summary_status, Summary::Exact);
        let unfinished = parse_clean_preview(message);
        assert_eq!(unfinished.potential_space, None);
    }
}

#[test]
fn cancelled_and_incomplete_scans_preserve_known_totals_without_claiming_completion() {
    for status in ["incomplete", "cancelled", "interrupted"] {
        let preview = parse_clean_preview(&format!(
            "Dry run {status}\nPotential space: At least 1GB | Items: 12 | Categories: 2\n"
        ));
        assert_eq!(preview.potential_space, Some(1_073_741_824));
        assert_eq!(preview.scan_status, Scan::Incomplete);
        assert_eq!(preview.summary_status, Summary::AtLeast);
    }
}

#[test]
fn last_summary_block_wins_over_provisional_or_repeated_totals() {
    let preview = parse_clean_preview(
        "Potential space: 0.00GB\rPotential space: At least 2GB | Items: 2 | Categories: 1\n",
    );
    assert_eq!(preview.potential_space, Some(2_147_483_648));
    let final_incomplete = parse_clean_preview("Dry run complete\nPotential space: 2GB | Items: 2 | Categories: 1\nDry run incomplete\nRemaining cleanup was skipped.\n");
    assert_eq!(final_incomplete.potential_space, None);
    assert_eq!(final_incomplete.item_count, None);
    assert_eq!(final_incomplete.scan_status, Scan::Incomplete);
}

#[test]
fn overflowing_or_malformed_numbers_do_not_report_zero_or_maximum_size() {
    let preview = parse_clean_preview("Potential space: 999999999999999999999999999TB | Items: 18446744073709551616 | Categories: 1,23\n");
    assert_eq!(preview.potential_space, None);
    assert_eq!(preview.item_count, None);
    assert_eq!(preview.category_count, None);
}

#[test]
fn process_failures_keep_exit_code_and_output() {
    assert_eq!(
        format_clean_process_failure(Some(2), "permission denied"),
        "mo clean --dry-run failed with exit code 2\npermission denied"
    );
    assert_eq!(
        format_clean_process_failure(None, ""),
        "mo clean --dry-run failed with exit code unknown"
    );
}
