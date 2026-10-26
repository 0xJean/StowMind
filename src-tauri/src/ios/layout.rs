use super::layout_model::{slot_of, LayoutState};
#[cfg(test)]
use super::types::IosAppIdentity;
use super::types::{IosLayoutSnapshot, IosOperation};
use serde_json::{json, Value};

fn layout_value(snapshot: &IosLayoutSnapshot) -> Value {
    // OCR can return apps and folder members in a different order between
    // scans. Coordinates and container membership are the authoritative
    // layout data, so sort the order-insensitive collections before hashing.
    let mut apps = snapshot
        .apps
        .iter()
        .map(|app| {
            json!({
                "id": app.id,
                "currentPage": app.current_page,
                "currentRow": app.current_row,
                "currentColumn": app.current_column,
                "inDock": app.in_dock,
                "folderName": app.folder_name,
            })
        })
        .collect::<Vec<_>>();
    apps.sort_by(|left, right| left.to_string().cmp(&right.to_string()));

    let mut pages = snapshot
        .pages
        .iter()
        .map(|page| {
            let mut app_ids = page.app_ids.clone();
            app_ids.sort();
            json!({
                "index": page.index,
                "appIds": app_ids,
                "hasWidgets": page.has_widgets,
            })
        })
        .collect::<Vec<_>>();
    pages.sort_by(|left, right| left.to_string().cmp(&right.to_string()));

    let mut folders = snapshot
        .folders
        .iter()
        .map(|folder| {
            let mut app_ids = folder.app_ids.clone();
            app_ids.sort();
            json!({
                "name": folder.name,
                "page": folder.page,
                "row": folder.row,
                "column": folder.column,
                "appIds": app_ids,
            })
        })
        .collect::<Vec<_>>();
    folders.sort_by(|left, right| left.to_string().cmp(&right.to_string()));

    json!({
        "apps": apps,
        "pages": pages,
        "folders": folders,
        // Dock order is meaningful, unlike the order in OCR collections.
        "dock": snapshot.dock,
    })
}

fn fnv1a_hash(value: &str) -> String {
    let mut hash = 1469598103934665603u64;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(1099511628211);
    }
    format!("{hash:016x}")
}

/// Return a stable fingerprint for the observable Home Screen layout.
///
/// The existing `inventory_hash` intentionally only describes App identity
/// and remains useful for detecting missing/extra Apps. This fingerprint also
/// includes each App's page/slot, Dock membership, folder membership, page
/// metadata, folder structure and Dock order.
pub fn layout_hash(snapshot: &IosLayoutSnapshot) -> String {
    fnv1a_hash(&layout_value(snapshot).to_string())
}

pub fn layout_matches(before: &IosLayoutSnapshot, after: &IosLayoutSnapshot) -> bool {
    layout_value(before) == layout_value(after)
}

fn remove_from_pages(snapshot: &mut IosLayoutSnapshot, app_id: &str) {
    for page_snapshot in &mut snapshot.pages {
        page_snapshot.app_ids.retain(|id| id != app_id);
    }
}

/// Apply already completed operations to a source snapshot. This is used by
/// the executor to verify a checkpoint against the layout that the plan has
/// actually produced, rather than merely checking that the App set survived.
pub fn snapshot_after_operations(
    source: &IosLayoutSnapshot,
    operations: &[IosOperation],
) -> Result<IosLayoutSnapshot, String> {
    let mut expected = source.clone();
    for operation in operations {
        match operation {
            IosOperation::MoveApp {
                app_id,
                from_page,
                from_row,
                from_column,
                to_page,
                to_row,
                to_column,
            } => {
                // Use the same reflow model as the planner and safety gate,
                // so checkpoints expect neighbours shifted by SpringBoard.
                let slot = |row: usize, column: usize| {
                    slot_of(row, column).ok_or_else(|| {
                        "Home Screen coordinates are outside the safe grid".to_string()
                    })
                };
                let mut state = LayoutState::from_snapshot(&expected);
                state.apply_move(
                    app_id,
                    (*from_page, slot(*from_row, *from_column)?),
                    (*to_page, slot(*to_row, *to_column)?),
                    &|_| false,
                )?;
                state.write_back(&mut expected);
            }
            IosOperation::MoveToDock {
                app_id, dock_index, ..
            } => {
                let app = expected
                    .apps
                    .iter_mut()
                    .find(|app| app.id == *app_id)
                    .ok_or_else(|| format!("Plan references an unknown App: {app_id}"))?;
                app.current_page = None;
                app.current_row = None;
                app.current_column = None;
                app.in_dock = true;
                app.folder_name = None;
                remove_from_pages(&mut expected, app_id);
                expected.dock.retain(|id| id != app_id);
                let index = (*dock_index).min(expected.dock.len());
                expected.dock.insert(index, app_id.clone());
            }
            IosOperation::CreateFolder {
                page,
                row,
                column,
                name,
                app_ids,
            } => {
                expected.folders.retain(|folder| {
                    !(folder.page == *page && folder.row == *row && folder.column == *column)
                });
                expected.folders.push(super::types::IosFolderSnapshot {
                    name: name.clone(),
                    page: *page,
                    row: *row,
                    column: *column,
                    app_ids: app_ids.clone(),
                });
                for app_id in app_ids {
                    if let Some(app) = expected.apps.iter_mut().find(|app| app.id == *app_id) {
                        app.current_page = None;
                        app.current_row = None;
                        app.current_column = None;
                        app.in_dock = false;
                        app.folder_name = Some(name.clone());
                    }
                    remove_from_pages(&mut expected, app_id);
                }
            }
            IosOperation::RenameFolder {
                page,
                row,
                column,
                from,
                to,
            } => {
                let folder = expected
                    .folders
                    .iter_mut()
                    .find(|folder| {
                        folder.page == *page
                            && folder.row == *row
                            && folder.column == *column
                            && folder.name == *from
                    })
                    .ok_or_else(|| "Plan references an unknown folder".to_string())?;
                folder.name = to.clone();
                for app_id in &folder.app_ids {
                    if let Some(app) = expected.apps.iter_mut().find(|app| app.id == *app_id) {
                        app.folder_name = Some(to.clone());
                    }
                }
            }
        }
    }
    expected.layout_hash = layout_hash(&expected);
    Ok(expected)
}

#[cfg(test)]
mod tests {
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

    fn snapshot(apps: Vec<IosAppIdentity>) -> IosLayoutSnapshot {
        IosLayoutSnapshot {
            id: "snapshot".to_string(),
            captured_at: "0".to_string(),
            device_name: None,
            apps,
            folders: Vec::new(),
            pages: vec![super::super::types::IosPageSnapshot {
                index: 0,
                app_ids: vec!["a".to_string(), "b".to_string()],
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

    #[test]
    fn layout_hash_includes_app_coordinates_and_container_membership() {
        let first = snapshot(vec![app("a"), app("b")]);
        let mut moved = first.clone();
        moved.apps[0].current_column = Some(1);
        assert_ne!(layout_hash(&first), layout_hash(&moved));

        moved = first.clone();
        moved.apps[0].folder_name = Some("Work".to_string());
        assert_ne!(layout_hash(&first), layout_hash(&moved));

        moved = first.clone();
        moved.dock.push("a".to_string());
        assert_ne!(layout_hash(&first), layout_hash(&moved));
    }

    #[test]
    fn layout_matches_ignores_capture_order_but_keeps_layout() {
        let first = snapshot(vec![app("a"), app("b")]);
        let mut reordered = first.clone();
        reordered.apps.reverse();
        reordered.pages[0].app_ids.reverse();
        assert!(layout_matches(&first, &reordered));

        reordered.apps[1].current_column = Some(1);
        assert!(!layout_matches(&first, &reordered));
    }

    #[test]
    fn snapshot_after_operations_updates_layout() {
        let mut second = app("b");
        second.current_column = Some(1);
        let first = snapshot(vec![app("a"), second]);
        let expected = snapshot_after_operations(
            &first,
            &[IosOperation::MoveApp {
                app_id: "a".to_string(),
                from_page: 0,
                from_row: 0,
                from_column: 0,
                to_page: 0,
                to_row: 0,
                to_column: 1,
            }],
        )
        .expect("operation should produce an expected layout");
        // A packed page reflows: the neighbour shifts into the vacated slot.
        assert_eq!(expected.apps[0].current_column, Some(1));
        assert_eq!(expected.apps[1].current_column, Some(0));
        assert_ne!(layout_hash(&first), expected.layout_hash);
        assert_eq!(expected.pages[0].app_ids, ["b", "a"]);
    }
}
