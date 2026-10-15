use super::super::classification::category_for_name;
use super::super::safety::MIN_AUTOMATION_CONFIDENCE;
use super::super::types::{IosAppIdentity, IosLayoutSnapshot};
use std::collections::{HashMap, HashSet};

pub(super) fn normalized_name(name: &str) -> String {
    name.to_lowercase()
        .chars()
        .filter(|character| character.is_alphanumeric())
        .collect()
}

pub(super) fn safe_position(app: &IosAppIdentity) -> Option<(usize, usize, usize)> {
    let (page, row, column) = (app.current_page?, app.current_row?, app.current_column?);
    (page < 100 && row < 6 && column < 4).then_some((page, row, column))
}

pub(super) fn original_occupied_slots(
    snapshot: &IosLayoutSnapshot,
) -> HashSet<(usize, usize, usize)> {
    snapshot
        .apps
        .iter()
        .filter_map(safe_position)
        .chain(
            snapshot
                .folders
                .iter()
                .map(|folder| (folder.page, folder.row, folder.column)),
        )
        .collect()
}

/// Protect ambiguous visual identities and pages whose unlocated/overlapping
/// contents prevent us from identifying an empty target slot reliably.
pub(super) fn protected_ids(snapshot: &IosLayoutSnapshot) -> HashSet<String> {
    let mut id_counts = HashMap::new();
    let mut name_counts = HashMap::new();
    let mut slot_counts = HashMap::new();
    let mut page_counts = HashMap::new();
    let mut unsafe_pages = HashSet::new();
    let folder_members = snapshot
        .folders
        .iter()
        .flat_map(|folder| folder.app_ids.iter().map(String::as_str))
        .collect::<HashSet<_>>();
    let dock = snapshot
        .dock
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();

    for page in &snapshot.pages {
        *page_counts.entry(page.index).or_insert(0) += 1;
        if page.has_widgets {
            unsafe_pages.insert(page.index);
        }
    }
    for app in &snapshot.apps {
        *id_counts.entry(app.id.as_str()).or_insert(0) += 1;
        *name_counts.entry(normalized_name(&app.name)).or_insert(0) += 1;
        if !app.in_dock && app.folder_name.is_none() && !folder_members.contains(app.id.as_str()) {
            if let Some(position) = safe_position(app) {
                *slot_counts.entry(position).or_insert(0) += 1;
            } else if let Some(page) = app.current_page {
                unsafe_pages.insert(page);
            }
        }
    }
    for folder in &snapshot.folders {
        *slot_counts
            .entry((folder.page, folder.row, folder.column))
            .or_insert(0) += 1;
        if folder.page >= 100 || folder.row >= 6 || folder.column >= 4 {
            unsafe_pages.insert(folder.page);
        }
    }
    for page in &snapshot.pages {
        if page.app_ids.iter().any(|id| {
            let matching = snapshot
                .apps
                .iter()
                .filter(|app| app.id == *id)
                .collect::<Vec<_>>();
            matching.is_empty()
                || matching.iter().any(|app| {
                    !app.in_dock
                        && app.folder_name.is_none()
                        && !folder_members.contains(id.as_str())
                        && safe_position(app)
                            .map(|(index, _, _)| index != page.index)
                            .unwrap_or(true)
                })
        }) {
            unsafe_pages.insert(page.index);
        }
    }
    for ((page, _, _), count) in slot_counts {
        if count > 1 {
            unsafe_pages.insert(page);
        }
    }

    snapshot
        .apps
        .iter()
        .filter(|app| {
            let name = normalized_name(&app.name);
            app.id.trim().is_empty()
                || id_counts[app.id.as_str()] != 1
                || name.is_empty()
                || name_counts[&name] != 1
                || app.sensitive
                || category_for_name(&app.name).1
                || !app.confidence.is_finite()
                || !(MIN_AUTOMATION_CONFIDENCE..=1.0).contains(&app.confidence)
                || app.in_dock
                || dock.contains(app.id.as_str())
                || app.folder_name.is_some()
                || folder_members.contains(app.id.as_str())
                || safe_position(app)
                    .map(|(page, _, _)| {
                        unsafe_pages.contains(&page) || page_counts.get(&page) != Some(&1)
                    })
                    .unwrap_or(true)
        })
        .map(|app| app.id.clone())
        .collect()
}
