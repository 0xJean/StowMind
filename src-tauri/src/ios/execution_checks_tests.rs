use super::*;
use crate::ios::layout::snapshot_after_operations;
use serde_json::json;

fn baseline() -> IosLayoutSnapshot {
    serde_json::from_value(json!({
        "id": "source", "capturedAt": "0", "deviceName": null,
        "apps": [
            {"id": "a", "name": "Alpha", "category": "其他", "sensitive": false,
             "confidence": 1.0, "source": "test", "currentPage": 0, "currentRow": 0,
             "currentColumn": 1, "inDock": false},
            {"id": "b", "name": "Beta", "category": "其他", "sensitive": false,
             "confidence": 1.0, "source": "test", "currentPage": 1, "currentRow": 0,
             "currentColumn": 2, "inDock": false}
        ],
        "pages": [{"index": 0, "appIds": ["a"], "hasWidgets": false},
                  {"index": 1, "appIds": ["b"], "hasWidgets": false}],
        "folders": [], "dock": [], "inventoryHash": "", "confidence": 1.0,
        "source": "test", "scanScope": "homeScreenPages", "inventoryComplete": false
    }))
    .unwrap()
}

fn visible(source: &IosLayoutSnapshot, page: usize) -> IosLayoutSnapshot {
    let mut actual = source.clone();
    actual.scan_scope = "visibleMirrorPage".to_string();
    actual.pages.retain(|item| item.index == page);
    actual.pages[0].index = 0;
    actual.apps.retain(|app| app.current_page == Some(page));
    actual
        .apps
        .iter_mut()
        .for_each(|app| app.current_page = Some(0));
    actual
}

fn operation() -> IosOperation {
    IosOperation::MoveApp {
        app_id: "b".into(),
        from_page: 1,
        from_row: 0,
        from_column: 2,
        to_page: 1,
        to_row: 0,
        to_column: 0,
    }
}

#[test]
fn visible_page_is_compared_to_its_planned_page() {
    let source = baseline();
    assert!(matches_expected_page(
        &source,
        &visible(&source, 1),
        &operation()
    ));
    assert!(!matches_expected_page(
        &source,
        &visible(&source, 0),
        &operation()
    ));
    assert!(matches_another_page(&source, &visible(&source, 0)));
}

#[test]
fn a_move_requires_the_new_position_even_when_app_set_is_unchanged() {
    let source = baseline();
    let target = snapshot_after_operations(&source, &[operation()]).unwrap();
    assert!(!matches_expected_page(
        &target,
        &visible(&source, 1),
        &operation()
    ));
    assert!(matches_expected_page(
        &target,
        &visible(&target, 1),
        &operation()
    ));
}

#[test]
fn mismatched_scope_widgets_and_duplicate_apps_cannot_match() {
    let source = baseline();
    let actual = visible(&source, 1);
    let mut changed = actual.clone();
    changed.scan_scope = "partialHomeScreenPages".into();
    assert!(!matches_expected_page(&source, &changed, &operation()));
    changed = actual.clone();
    changed.pages[0].has_widgets = true;
    assert!(!matches_expected_page(&source, &changed, &operation()));
    changed = actual.clone();
    changed.apps.push(changed.apps[0].clone());
    assert!(!matches_expected_page(&source, &changed, &operation()));
    changed = actual;
    changed.apps[0].current_column = Some(3);
    assert!(!matches_another_page(&source, &changed));
}

fn cross_page_operation() -> IosOperation {
    // `a` is the last (only) icon on page 0; page 1 has a free slot 0.
    IosOperation::MoveApp {
        app_id: "a".into(),
        from_page: 0,
        from_row: 0,
        from_column: 1,
        to_page: 1,
        to_row: 0,
        to_column: 0,
    }
}

#[test]
fn cross_page_checkpoint_verifies_the_landing_page() {
    let source = baseline();
    let target = snapshot_after_operations(&source, &[cross_page_operation()]).unwrap();
    let landed = visible(&target, 1);
    assert!(matches_expected_target_page(
        &target,
        &landed,
        &cross_page_operation()
    ));
    // The source page is no longer what the mirror shows after the drag.
    assert!(!matches_expected_page(
        &target,
        &landed,
        &cross_page_operation()
    ));
    assert!(!matches_expected_target_page(
        &target,
        &visible(&source, 1),
        &cross_page_operation()
    ));
}

#[test]
fn action_context_only_allows_reflow_into_an_occupied_packed_run() {
    let source = baseline();
    let context = action_context(&source, &cross_page_operation());
    assert_eq!(context["allowReflow"], json!(false));
    assert_eq!(context["expectedTargetAppIds"], json!(["b"]));
    let same_page = action_context(&source, &operation());
    assert_eq!(same_page["allowReflow"], json!(false));
    assert_eq!(same_page["expectedTargetAppIds"], json!([]));

    let mut packed = source.clone();
    packed.apps[1].current_page = Some(0);
    packed.apps[1].current_column = Some(0);
    packed.pages[0].app_ids.push("b".into());
    packed.pages[1].app_ids.clear();
    let reorder = IosOperation::MoveApp {
        app_id: "a".into(),
        from_page: 0,
        from_row: 0,
        from_column: 1,
        to_page: 0,
        to_row: 0,
        to_column: 0,
    };
    assert_eq!(
        action_context(&packed, &reorder)["allowReflow"],
        json!(true)
    );
}

fn session(status: IosExecutionStatus) -> IosExecutionSession {
    IosExecutionSession {
        id: "session".into(),
        plan_id: "plan".into(),
        status,
        current_index: 1,
        total: 1,
        error: None,
        guidance_message: None,
        guidance_can_resume: true,
        last_verified_snapshot_id: None,
        created_at: "0".into(),
        updated_at: "0".into(),
    }
}

#[test]
fn cancellation_wins_over_late_completion_failure_or_guidance() {
    for status in [
        IosExecutionStatus::Running,
        IosExecutionStatus::Completed,
        IosExecutionStatus::Failed,
        IosExecutionStatus::Paused,
    ] {
        let mut session = session(status);
        apply_control_state(&mut session, true, true);
        assert_eq!(session.status, IosExecutionStatus::Cancelled);
        assert!(!session.guidance_can_resume);
        assert_eq!(session.current_index, 1);
    }
}

#[test]
fn pause_preserves_verified_cursor_and_does_not_make_uncertain_results_resumable() {
    let mut completed = session(IosExecutionStatus::Completed);
    apply_control_state(&mut completed, false, true);
    assert_eq!(completed.status, IosExecutionStatus::Paused);
    assert_eq!(completed.current_index, 1);
    let mut failed = session(IosExecutionStatus::Failed);
    failed.guidance_can_resume = false;
    apply_control_state(&mut failed, false, true);
    assert_eq!(failed.status, IosExecutionStatus::Failed);
    assert!(!failed.guidance_can_resume);
    let mut guidance = session(IosExecutionStatus::Paused);
    guidance.guidance_can_resume = false;
    apply_control_state(&mut guidance, false, true);
    assert!(!guidance.guidance_can_resume);
}
