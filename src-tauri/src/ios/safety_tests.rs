use super::*;

fn app(id: &str) -> IosAppIdentity {
    IosAppIdentity {
        id: id.to_string(),
        name: id.to_string(),
        bundle_id: None,
        category: "其他".to_string(),
        sensitive: false,
        confidence: 1.0,
        source: "test".to_string(),
        current_page: Some(0),
        current_row: Some(0),
        current_column: Some(0),
        in_dock: false,
        folder_name: None,
    }
}

fn snapshot() -> IosLayoutSnapshot {
    let first = app("first");
    let mut second = app("second");
    second.current_column = Some(2);
    IosLayoutSnapshot {
        id: "snapshot".to_string(),
        captured_at: "0".to_string(),
        device_name: None,
        apps: vec![first, second],
        folders: Vec::new(),
        pages: vec![super::super::types::IosPageSnapshot {
            index: 0,
            app_ids: vec!["first".to_string(), "second".to_string()],
            has_widgets: false,
        }],
        dock: Vec::new(),
        inventory_hash: String::new(),
        layout_hash: String::new(),
        confidence: 1.0,
        source: "test".to_string(),
        scan_scope: "homeScreenPages".to_string(),
        inventory_complete: true,
        warnings: Vec::new(),
        window_bounds: None,
    }
}

fn movement(id: &str, from: usize, to: usize) -> IosOperation {
    IosOperation::MoveApp {
        app_id: id.to_string(),
        from_page: 0,
        from_row: from / 4,
        from_column: from % 4,
        to_page: 0,
        to_row: to / 4,
        to_column: to % 4,
    }
}

fn plan(operations: Vec<IosOperation>) -> IosLayoutPlan {
    IosLayoutPlan {
        id: "plan".to_string(),
        source_snapshot_id: "snapshot".to_string(),
        template: "efficiency".to_string(),
        use_ai: false,
        operations,
        target_layout_hash: None,
        warnings: Vec::new(),
        protected_app_ids: Vec::new(),
        created_at: "0".to_string(),
        restore_target_snapshot_id: None,
    }
}

fn assert_rejected(plan: &IosLayoutPlan, snapshot: &IosLayoutSnapshot, reason: &str) {
    let error = validate_plan_against_snapshot(plan, snapshot).expect_err("unsafe plan must fail");
    assert!(error.contains(reason), "unexpected safety failure: {error}");
}

#[test]
fn inventory_hash_is_order_independent() {
    assert_eq!(
        inventory_hash(&[app("a"), app("b")]),
        inventory_hash(&[app("b"), app("a")])
    );
}

#[test]
fn inventory_mismatch_is_detected() {
    assert!(!inventory_matches(&[app("a")], &[app("b")]));
}

#[test]
fn forbidden_delete_words_are_blocked() {
    assert!(contains_forbidden_text("Delete App"));
    assert!(contains_forbidden_text("删除应用"));
    assert!(contains_forbidden_text("Remove from Home Screen"));
    assert!(!contains_forbidden_text("Move app"));
}

#[test]
fn destructive_operation_variants_cannot_deserialize() {
    for operation in [
        r#"{"type":"deleteApp","appId":"a"}"#,
        r#"{"type":"uninstall","appId":"a"}"#,
        r#"{"type":"removeFromHomeScreen","appId":"a"}"#,
        r#"{"type":"hidePage","page":0}"#,
        r#"{"type":"hideApp","appId":"a"}"#,
        r#"{"type":"resetLayout"}"#,
        r#"{"type":"modifyWidget","page":0}"#,
    ] {
        assert!(serde_json::from_str::<IosOperation>(operation).is_err());
    }
}

#[test]
fn protected_app_cannot_appear_in_plan() {
    let mut snapshot = snapshot();
    snapshot.apps[0].sensitive = true;
    assert_rejected(
        &plan(vec![movement("first", 0, 1)]),
        &snapshot,
        "Protected App",
    );
}

#[test]
fn occupied_move_target_is_rejected() {
    assert_rejected(
        &plan(vec![movement("first", 0, 2)]),
        &snapshot(),
        "already occupied",
    );
}

#[test]
fn unique_same_page_move_to_original_empty_slot_is_accepted() {
    validate_plan_against_snapshot(&plan(vec![movement("first", 0, 1)]), &snapshot()).unwrap();
}

#[test]
fn duplicate_visual_name_and_duplicate_id_are_rejected() {
    let plan = plan(vec![movement("first", 0, 1)]);
    let mut duplicate_name = snapshot();
    duplicate_name.apps[1].name = " First! ".to_string();
    assert_rejected(&plan, &duplicate_name, "name is not unique");
    let mut duplicate_id = snapshot();
    duplicate_id.apps[1].id = "first".to_string();
    assert_rejected(&plan, &duplicate_id, "identity is missing or ambiguous");
}

#[test]
fn non_finite_and_out_of_range_confidence_is_rejected() {
    let plan = plan(vec![movement("first", 0, 1)]);
    for confidence in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY, -0.1, 0.89, 1.1] {
        let mut snapshot = snapshot();
        snapshot.apps[0].confidence = confidence;
        assert_rejected(&plan, &snapshot, "Low-confidence App");
    }
}

#[test]
fn overlapping_and_unlocated_page_contents_are_rejected() {
    let plan = plan(vec![movement("first", 0, 1)]);
    let mut overlapping = snapshot();
    overlapping.apps[1].current_column = Some(0);
    assert_rejected(&plan, &overlapping, "overlapping App");
    let mut unlocated = snapshot();
    unlocated.apps[1].current_row = None;
    assert!(validate_plan_against_snapshot(&plan, &unlocated).is_err());
}

#[test]
fn folder_occupied_destination_is_rejected() {
    let mut snapshot = snapshot();
    snapshot
        .folders
        .push(super::super::types::IosFolderSnapshot {
            name: "工具".to_string(),
            page: 0,
            row: 0,
            column: 1,
            app_ids: Vec::new(),
        });
    assert_rejected(
        &plan(vec![movement("first", 0, 1)]),
        &snapshot,
        "already occupied",
    );
}

#[test]
fn folder_membership_metadata_prevents_false_source_overlap() {
    let mut snapshot = snapshot();
    snapshot
        .folders
        .push(super::super::types::IosFolderSnapshot {
            name: "工具".to_string(),
            page: 0,
            row: 0,
            column: 2,
            app_ids: vec!["second".to_string()],
        });
    validate_plan_against_snapshot(&plan(vec![movement("first", 0, 1)]), &snapshot).unwrap();
    assert_rejected(
        &plan(vec![movement("second", 2, 1)]),
        &snapshot,
        "folder Apps",
    );
}

#[test]
fn missing_or_unlocated_page_membership_cannot_establish_empty_targets() {
    let plan = plan(vec![movement("first", 0, 1)]);
    let mut snapshot = snapshot();
    snapshot.pages[0].app_ids.push("unknown".to_string());
    assert!(validate_plan_against_snapshot(&plan, &snapshot).is_err());
    let mut unknown = app("unknown");
    unknown.current_page = None;
    snapshot.apps.push(unknown);
    assert!(validate_plan_against_snapshot(&plan, &snapshot).is_err());
}

#[test]
fn repeated_app_and_shared_destination_are_rejected() {
    for operations in [
        vec![movement("first", 0, 1), movement("first", 0, 3)],
        vec![movement("first", 0, 1), movement("second", 2, 1)],
    ] {
        assert_rejected(
            &plan(operations),
            &snapshot(),
            "repeat an App or destination",
        );
    }
}

#[test]
fn vacated_source_is_not_an_automatic_target() {
    assert_rejected(
        &plan(vec![movement("first", 0, 1), movement("second", 2, 0)]),
        &snapshot(),
        "already occupied",
    );
}

#[test]
fn legacy_cross_page_folder_and_dock_plans_cannot_execute() {
    let mut cross_page = movement("first", 0, 1);
    if let IosOperation::MoveApp { to_page, .. } = &mut cross_page {
        *to_page = 1;
    }
    assert_rejected(&plan(vec![cross_page]), &snapshot(), "same-page");
    assert_rejected(
        &plan(vec![movement("first", 0, 0)]),
        &snapshot(),
        "same-page",
    );
    for operation in [
        IosOperation::CreateFolder {
            page: 0,
            row: 0,
            column: 0,
            name: "工具".to_string(),
            app_ids: vec!["first".to_string(), "second".to_string()],
        },
        IosOperation::RenameFolder {
            page: 0,
            row: 0,
            column: 0,
            from: "工具".to_string(),
            to: "效率".to_string(),
        },
        IosOperation::MoveToDock {
            app_id: "first".to_string(),
            from_page: 0,
            from_row: 0,
            from_column: 0,
            dock_index: 0,
        },
    ] {
        let plan = plan(vec![operation]);
        validate_plan(&plan).expect("legacy variants still have valid schemas");
        assert_rejected(&plan, &snapshot(), "尚不支持");
    }
}

#[test]
fn invalid_execution_cursor_is_rejected_without_overflow() {
    let plan = plan(vec![movement("first", 0, 1)]);
    assert_eq!(validate_batch(&plan, 0).unwrap().len(), 1);
    assert!(validate_batch(&plan, 1).unwrap().is_empty());
    assert!(validate_batch(&plan, 2).is_err());
    assert!(validate_batch(&plan, usize::MAX).is_err());
}

#[test]
fn unknown_fields_cannot_extend_a_whitelisted_operation() {
    for field in ["deleteApp", "longPress", "screenX", "hidePage"] {
        let mut value = serde_json::to_value(movement("first", 0, 1)).unwrap();
        value
            .as_object_mut()
            .unwrap()
            .insert(field.to_string(), serde_json::json!(true));
        assert!(
            serde_json::from_value::<IosOperation>(value).is_err(),
            "accepted field {field}"
        );
    }
}
