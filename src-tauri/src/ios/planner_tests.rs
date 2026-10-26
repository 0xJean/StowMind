use super::super::safety::validate_plan_against_snapshot;
use super::super::types::{
    IosAppIdentity, IosFolderSnapshot, IosLayoutPlan, IosLayoutSnapshot, IosOperation,
    IosPageSnapshot, IosPlanRequest,
};
use super::{create_plan, create_restore_plan};
use std::collections::HashSet;

fn app(id: &str, name: &str, page: usize, slot: usize) -> IosAppIdentity {
    IosAppIdentity {
        id: id.to_string(),
        name: name.to_string(),
        bundle_id: None,
        category: "其他".to_string(),
        sensitive: false,
        confidence: 1.0,
        source: "test".to_string(),
        current_page: Some(page),
        current_row: Some(slot / 4),
        current_column: Some(slot % 4),
        in_dock: false,
        folder_name: None,
    }
}

fn snapshot(apps: Vec<IosAppIdentity>) -> IosLayoutSnapshot {
    let page_count = apps
        .iter()
        .filter_map(|app| app.current_page)
        .max()
        .unwrap_or(0)
        + 1;
    let pages = (0..page_count)
        .map(|index| IosPageSnapshot {
            index,
            app_ids: apps
                .iter()
                .filter(|app| {
                    app.current_page == Some(index) && !app.in_dock && app.folder_name.is_none()
                })
                .map(|app| app.id.clone())
                .collect(),
            has_widgets: false,
        })
        .collect();
    IosLayoutSnapshot {
        id: "snapshot".to_string(),
        captured_at: "0".to_string(),
        device_name: None,
        apps,
        folders: Vec::new(),
        pages,
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

async fn plan(snapshot: &IosLayoutSnapshot, template: &str) -> IosLayoutPlan {
    let request = IosPlanRequest {
        snapshot_id: snapshot.id.clone(),
        template: template.to_string(),
        use_ai: false,
        ai_only_hard_cases: true,
        ai_provider: None,
    };
    let plan = create_plan(snapshot, &request).await;
    validate_plan_against_snapshot(&plan, snapshot)
        .expect("generated plan must pass the safety gate");
    plan
}

fn moves(plan: &IosLayoutPlan) -> Vec<(&str, usize, usize)> {
    plan.operations
        .iter()
        .map(|operation| match operation {
            IosOperation::MoveApp {
                app_id,
                from_page,
                to_page,
                to_row,
                to_column,
                ..
            } => {
                assert!(
                    from_page.abs_diff(*to_page) <= 3,
                    "automatic moves are limited to three page flips"
                );
                (app_id.as_str(), *to_page, to_row * 4 + to_column)
            }
            _ => panic!("planner emitted an unsupported automatic operation"),
        })
        .collect()
}

#[tokio::test]
async fn same_page_plan_fills_original_empty_slots_and_passes_safety_gate() {
    let snapshot = snapshot(vec![
        app("notes", "Notes", 0, 2),
        app("calendar", "Calendar", 0, 5),
    ]);
    let plan = plan(&snapshot, "efficiency").await;
    assert_eq!(moves(&plan), vec![("calendar", 0, 0), ("notes", 0, 1)]);
}

#[tokio::test]
async fn category_folder_suggestion_does_not_disable_same_page_moves() {
    let snapshot = snapshot(vec![
        app("notes", "Notes", 0, 4),
        app("calendar", "Calendar", 0, 5),
        app("notion", "Notion", 0, 6),
    ]);
    let plan = plan(&snapshot, "efficiency").await;
    assert_eq!(
        moves(&plan),
        vec![("calendar", 0, 0), ("notes", 0, 1), ("notion", 0, 2)]
    );
    assert!(plan
        .warnings
        .iter()
        .any(|warning| warning.contains("人工创建文件夹")));
}

#[tokio::test]
async fn template_prioritizes_work_apps_when_filling_work_page() {
    let snapshot = snapshot(vec![
        app("telegram", "Telegram", 0, 4),
        app("slack", "Slack", 0, 5),
    ]);
    let plan = plan(&snapshot, "work").await;
    assert_eq!(moves(&plan), vec![("slack", 0, 0), ("telegram", 0, 1)]);
}

#[tokio::test]
async fn missing_target_page_keeps_app_on_its_page() {
    let snapshot = snapshot(vec![app("slack", "Slack", 0, 4)]);
    let plan = plan(&snapshot, "efficiency").await;
    assert_eq!(moves(&plan), vec![("slack", 0, 0)]);
    assert!(plan
        .warnings
        .iter()
        .any(|warning| warning.contains("目标页不存在")));
}

#[tokio::test]
async fn cross_page_moves_take_the_last_icon_and_append_to_the_target_page() {
    // Page 0 is packed; Slack belongs on the work page but is not last.
    let snapshot = snapshot(vec![
        app("notes", "Notes", 0, 0),
        app("slack", "Slack", 0, 1),
        app("calendar", "Calendar", 0, 2),
        app("github", "GitHub", 1, 0),
    ]);
    let plan = plan(&snapshot, "efficiency").await;
    assert_eq!(
        moves(&plan),
        vec![
            ("slack", 0, 2),
            ("slack", 1, 1),
            // The work page is sorted next, while it is still visible.
            ("slack", 1, 0),
            ("calendar", 0, 0),
        ]
    );
}

#[tokio::test]
async fn full_page_is_reordered_by_reflow() {
    let names = [
        "Maps",
        "Notes",
        "Telegram",
        "Calendar",
        "Reminders",
        "Files",
        "Weather",
        "Clock",
        "Camera",
        "Photos",
        "Music",
        "Podcasts",
        "Books",
        "News",
        "Stocks",
        "Health",
        "Fitness",
        "Home",
        "Shortcuts",
        "Contacts",
        "Phone",
        "Mail",
        "Messages",
        "Safari",
    ];
    let apps = names
        .iter()
        .enumerate()
        .map(|(slot, name)| app(&name.to_lowercase(), name, 0, slot))
        .collect::<Vec<_>>();
    let snapshot = snapshot(apps);
    let plan = plan(&snapshot, "minimal").await;
    assert!(
        !plan.operations.is_empty(),
        "a packed page must still be reorderable"
    );
    let target = super::super::safety::snapshot_after_operations(&snapshot, &plan.operations)
        .expect("plan must replay");
    assert_eq!(
        target.pages[0].app_ids.len(),
        24,
        "no icon may leave a full page"
    );
    let mut ids = target
        .apps
        .iter()
        .map(|app| app.id.clone())
        .collect::<Vec<_>>();
    ids.sort();
    let mut before = snapshot
        .apps
        .iter()
        .map(|app| app.id.clone())
        .collect::<Vec<_>>();
    before.sort();
    assert_eq!(ids, before, "reordering never removes an App");
}

#[tokio::test]
async fn reflow_never_shifts_protected_icons() {
    let mut wallet = app("wallet", "Wallet", 0, 1);
    wallet.sensitive = true;
    let snapshot = snapshot(vec![
        app("maps", "Maps", 0, 0),
        wallet,
        app("notes", "Notes", 0, 2),
        app("calendar", "Calendar", 0, 3),
    ]);
    let plan = plan(&snapshot, "efficiency").await;
    assert_eq!(moves(&plan), vec![("calendar", 0, 2)]);
}

#[tokio::test]
async fn duplicate_visual_names_are_protected_even_with_different_ids() {
    let snapshot = snapshot(vec![
        app("notes-a", "Notes", 0, 2),
        app("notes-b", " Notes! ", 0, 3),
        app("calendar", "Calendar", 0, 4),
    ]);
    let plan = plan(&snapshot, "efficiency").await;
    assert_eq!(moves(&plan), vec![("calendar", 0, 0)]);
    assert!(plan.protected_app_ids.contains(&"notes-a".to_string()));
    assert!(plan.protected_app_ids.contains(&"notes-b".to_string()));
}

#[tokio::test]
async fn duplicate_ids_cannot_generate_repeated_actions() {
    let snapshot = snapshot(vec![
        app("duplicate", "Notes", 0, 2),
        app("duplicate", "Calendar", 0, 3),
    ]);
    let plan = plan(&snapshot, "efficiency").await;
    assert!(plan.operations.is_empty());
}

#[tokio::test]
async fn vacated_slots_are_reused_after_simulation() {
    let snapshot = snapshot(vec![
        app("notes", "Notes", 0, 1),
        app("calendar", "Calendar", 0, 2),
        app("notion", "Notion", 0, 3),
    ]);
    let plan = plan(&snapshot, "efficiency").await;
    assert_eq!(moves(&plan), vec![("calendar", 0, 0), ("notion", 0, 2)]);
}

#[tokio::test]
async fn packed_page_reorders_without_leaving_holes() {
    let snapshot = snapshot(vec![
        app("notes", "Notes", 0, 0),
        app("calendar", "Calendar", 0, 1),
    ]);
    let plan = plan(&snapshot, "efficiency").await;
    assert_eq!(moves(&plan), vec![("calendar", 0, 0)]);
}

#[tokio::test]
async fn protected_apps_and_folder_slots_stay_untouched() {
    let mut low_confidence = app("uncertain", "Calendar", 0, 6);
    low_confidence.confidence = 0.5;
    let mut snapshot = snapshot(vec![
        app("safe", "Notes", 0, 7),
        app("wallet", "Wallet", 0, 2),
        app("folder-app", "Notion", 0, 3),
        app("dock-app", "Telegram", 0, 4),
        app("widget-app", "Slack", 1, 4),
        low_confidence,
    ]);
    snapshot.folders.push(IosFolderSnapshot {
        name: "文件夹".to_string(),
        page: 0,
        row: 0,
        column: 0,
        app_ids: vec!["folder-app".to_string()],
    });
    snapshot.dock.push("dock-app".to_string());
    snapshot.pages[1].has_widgets = true;
    let plan = plan(&snapshot, "efficiency").await;
    assert_eq!(moves(&plan), vec![("safe", 0, 1)]);
    assert_eq!(plan.protected_app_ids.len(), 5);
}

#[tokio::test]
async fn unclear_page_occupancy_blocks_automatic_moves() {
    for invalid_row in [None, Some(9)] {
        let mut uncertain = app("uncertain", "Calendar", 0, 7);
        uncertain.current_row = invalid_row;
        let snapshot = snapshot(vec![app("notes", "Notes", 0, 6), uncertain]);
        assert!(plan(&snapshot, "efficiency").await.operations.is_empty());
    }
    let overlap = snapshot(vec![
        app("notes", "Notes", 0, 6),
        app("calendar", "Calendar", 0, 6),
    ]);
    assert!(plan(&overlap, "efficiency").await.operations.is_empty());
}

#[tokio::test]
async fn page_membership_without_a_located_identity_cannot_define_empty_slots() {
    let mut snapshot = snapshot(vec![app("notes", "Notes", 0, 6)]);
    snapshot.pages[0].app_ids.push("unlocated".to_string());
    assert!(plan(&snapshot, "efficiency").await.operations.is_empty());

    let mut unlocated = app("unlocated", "Calendar", 0, 7);
    unlocated.current_page = None;
    snapshot.apps.push(unlocated);
    assert!(plan(&snapshot, "efficiency").await.operations.is_empty());
}

#[tokio::test]
async fn generated_actions_have_unique_apps_and_original_empty_targets() {
    let snapshot = snapshot(vec![
        app("notes", "Notes", 0, 4),
        app("calendar", "Calendar", 0, 8),
        app("telegram", "Telegram", 0, 12),
        app("maps", "地图", 0, 16),
    ]);
    let plan = plan(&snapshot, "efficiency").await;
    assert_eq!(plan.operations.len(), 4);
    let targets = moves(&plan);
    assert_eq!(
        targets
            .iter()
            .map(|(_, page, slot)| (page, slot))
            .collect::<HashSet<_>>()
            .len(),
        targets.len()
    );
    assert_eq!(
        targets
            .iter()
            .map(|(id, _, _)| id)
            .collect::<HashSet<_>>()
            .len(),
        targets.len()
    );
    for (_, page, slot) in targets {
        assert!(!snapshot.apps.iter().any(|app| {
            app.current_page == Some(page)
                && app.current_row == Some(slot / 4)
                && app.current_column == Some(slot % 4)
        }));
    }
}

#[test]
fn restore_reuses_newly_vacated_slots() {
    let current = snapshot(vec![
        app("notes", "Notes", 0, 1),
        app("calendar", "Calendar", 0, 2),
    ]);
    let mut target = snapshot(vec![
        app("notes", "Notes", 0, 0),
        app("calendar", "Calendar", 0, 1),
    ]);
    target.id = "target".to_string();
    let plan = create_restore_plan(&current, &target);
    validate_plan_against_snapshot(&plan, &current).unwrap();
    assert_eq!(moves(&plan), vec![("notes", 0, 0), ("calendar", 0, 1)]);
    assert!(plan.warnings.is_empty());
}

#[test]
fn restore_keeps_unknown_pages_and_free_page_swaps_manual() {
    let current = snapshot(vec![
        app("notes", "Notes", 0, 1),
        app("calendar", "Calendar", 0, 2),
    ]);
    for target in [
        snapshot(vec![
            app("notes", "Notes", 1, 1),
            app("calendar", "Calendar", 1, 2),
        ]),
        snapshot(vec![
            app("notes", "Notes", 0, 2),
            app("calendar", "Calendar", 0, 1),
        ]),
    ] {
        let plan = create_restore_plan(&current, &target);
        validate_plan_against_snapshot(&plan, &current).unwrap();
        assert!(plan.operations.is_empty());
    }
}

#[test]
fn restore_rejects_ambiguous_target_names_or_positions() {
    let current = snapshot(vec![
        app("notes", "Notes", 0, 5),
        app("calendar", "Calendar", 0, 6),
    ]);
    for target in [
        snapshot(vec![
            app("notes", "Notes", 0, 0),
            app("calendar", "Notes!", 0, 1),
        ]),
        snapshot(vec![
            app("notes", "Notes", 0, 0),
            app("calendar", "Calendar", 0, 0),
        ]),
    ] {
        let plan = create_restore_plan(&current, &target);
        validate_plan_against_snapshot(&plan, &current).unwrap();
        assert!(plan.operations.is_empty());
    }
}
