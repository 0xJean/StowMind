use super::super::types::{IosAppIdentity, IosFolderSnapshot, IosLayoutSnapshot, IosPageSnapshot};
use super::*;

fn app(id: &str, page: usize, slot: usize) -> IosAppIdentity {
    IosAppIdentity {
        id: id.to_string(),
        name: id.to_string(),
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

fn snapshot(apps: Vec<IosAppIdentity>, pages: usize) -> IosLayoutSnapshot {
    let pages = (0..pages)
        .map(|index| IosPageSnapshot {
            index,
            app_ids: apps
                .iter()
                .filter(|app| app.current_page == Some(index))
                .map(|app| app.id.clone())
                .collect(),
            has_widgets: false,
        })
        .collect();
    IosLayoutSnapshot {
        id: "s".to_string(),
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

fn packed(count: usize) -> IosLayoutSnapshot {
    snapshot(
        (0..count)
            .map(|slot| app(&format!("a{slot}"), 0, slot))
            .collect(),
        1,
    )
}

fn unlocked(_: &str) -> bool {
    false
}

fn order(state: &LayoutState, page: usize) -> Vec<String> {
    state
        .page(page)
        .unwrap()
        .apps()
        .map(|(slot, id)| format!("{slot}:{id}"))
        .collect()
}

#[test]
fn full_page_reorder_reflows_only_the_shifted_range() {
    let source = packed(24);
    let mut state = LayoutState::from_snapshot(&source);
    assert_eq!(state.page(0).unwrap().mode(), PageMode::Packed);
    state.apply_move("a5", (0, 5), (0, 1), &unlocked).unwrap();
    let result = order(&state, 0);
    assert_eq!(
        &result[..7],
        ["0:a0", "1:a5", "2:a1", "3:a2", "4:a3", "5:a4", "6:a6"]
    );
    assert_eq!(state.page(0).unwrap().count(), 24);

    let mut written = source.clone();
    state.write_back(&mut written);
    let a1 = written.apps.iter().find(|app| app.id == "a1").unwrap();
    assert_eq!((a1.current_row, a1.current_column), (Some(0), Some(2)));
}

#[test]
fn reflow_cannot_shift_locked_apps_or_folders() {
    let source = packed(8);
    let mut state = LayoutState::from_snapshot(&source);
    let locked = |id: &str| id == "a3";
    assert!(state.apply_move("a6", (0, 6), (0, 1), &locked).is_err());
    assert!(state.apply_move("a3", (0, 3), (0, 0), &locked).is_err());
    state.apply_move("a6", (0, 6), (0, 4), &locked).unwrap();

    let mut with_folder = snapshot(
        vec![
            app("a0", 0, 0),
            app("a1", 0, 1),
            app("a2", 0, 2),
            app("a3", 0, 3),
            app("a5", 0, 5),
        ],
        1,
    );
    with_folder.folders.push(IosFolderSnapshot {
        name: "Work".to_string(),
        page: 0,
        row: 1,
        column: 0,
        app_ids: vec!["hidden".to_string()],
    });
    let mut state = LayoutState::from_snapshot(&with_folder);
    assert_eq!(state.page(0).unwrap().mode(), PageMode::Packed);
    assert!(state.apply_move("a3", (0, 3), (0, 0), &unlocked).is_ok());
    assert!(state.apply_move("a5", (0, 5), (0, 0), &unlocked).is_err());
}

#[test]
fn packed_page_rejects_ambiguous_drops_after_its_run() {
    let mut state = LayoutState::from_snapshot(&packed(5));
    assert!(state.apply_move("a1", (0, 1), (0, 9), &unlocked).is_err());
}

#[test]
fn free_page_reuses_vacated_slots_but_never_occupied_ones() {
    let source = snapshot(vec![app("a", 0, 0), app("b", 0, 3), app("c", 0, 6)], 1);
    let mut state = LayoutState::from_snapshot(&source);
    assert_eq!(state.page(0).unwrap().mode(), PageMode::Free);
    assert!(state.apply_move("c", (0, 6), (0, 3), &unlocked).is_err());
    state.apply_move("b", (0, 3), (0, 1), &unlocked).unwrap();
    state.apply_move("c", (0, 6), (0, 3), &unlocked).unwrap();
    assert_eq!(order(&state, 0), ["0:a", "1:b", "3:c"]);
}

#[test]
fn cross_page_moves_take_the_last_icon_and_append() {
    let source = snapshot(vec![app("a", 0, 0), app("b", 0, 1), app("c", 1, 0)], 2);
    let mut state = LayoutState::from_snapshot(&source);
    assert!(state.apply_move("a", (0, 0), (1, 1), &unlocked).is_err());
    assert!(state.apply_move("b", (0, 1), (1, 0), &unlocked).is_err());
    assert!(state.apply_move("b", (0, 1), (1, 5), &unlocked).is_err());
    state.apply_move("b", (0, 1), (1, 1), &unlocked).unwrap();
    assert_eq!(state.position_of("b"), Some((1, 1)));

    let mut written = source.clone();
    state.write_back(&mut written);
    assert_eq!(written.pages[0].app_ids, ["a"]);
    assert_eq!(written.pages[1].app_ids, ["c", "b"]);
}

#[test]
fn cross_page_moves_reject_full_unknown_and_distant_pages() {
    let mut apps = (0..24)
        .map(|slot| app(&format!("f{slot}"), 1, slot))
        .collect::<Vec<_>>();
    apps.push(app("x", 0, 0));
    let full = snapshot(apps, 2);
    let mut state = LayoutState::from_snapshot(&full);
    assert!(state.page(1).unwrap().arrival_slot().is_none());
    assert!(state.apply_move("x", (0, 0), (1, 23), &unlocked).is_err());

    let distant = snapshot(vec![app("x", 0, 0), app("y", 4, 0)], 5);
    let mut state = LayoutState::from_snapshot(&distant);
    assert!(state.apply_move("x", (0, 0), (4, 1), &unlocked).is_err());
    state.apply_move("x", (0, 0), (3, 0), &unlocked).unwrap();

    let mut gap = snapshot(vec![app("x", 0, 0), app("y", 2, 0)], 3);
    gap.pages.remove(1);
    let mut state = LayoutState::from_snapshot(&gap);
    assert!(state.apply_move("x", (0, 0), (2, 1), &unlocked).is_err());
}

#[test]
fn unreliable_pages_are_not_modelled() {
    let mut widgets = packed(3);
    widgets.pages[0].has_widgets = true;
    assert!(LayoutState::from_snapshot(&widgets).page(0).is_none());

    let overlap = snapshot(vec![app("a", 0, 0), app("b", 0, 0)], 1);
    assert!(LayoutState::from_snapshot(&overlap).page(0).is_none());

    let mut unlocated = packed(3);
    unlocated.apps[1].current_row = None;
    assert!(LayoutState::from_snapshot(&unlocated).page(0).is_none());

    let mut unknown = packed(3);
    unknown.pages[0].app_ids.push("ghost".to_string());
    assert!(LayoutState::from_snapshot(&unknown).page(0).is_none());
}
