use super::layout::layout_matches;
use super::layout_model::{slot_of, LayoutState};
use super::types::{IosExecutionSession, IosExecutionStatus, IosLayoutSnapshot, IosOperation};
use serde_json::{json, Value};

pub fn apply_control_state(session: &mut IosExecutionSession, cancelled: bool, paused: bool) {
    if cancelled {
        session.status = IosExecutionStatus::Cancelled;
        session.error = Some("执行已停止".to_string());
        session.guidance_can_resume = false;
    } else if paused
        && matches!(
            session.status,
            IosExecutionStatus::Running | IosExecutionStatus::Completed
        )
    {
        session.status = IosExecutionStatus::Paused;
        session.guidance_message = Some("执行已由用户暂停".to_string());
        session.guidance_can_resume = true;
    }
}

fn page_layout_matches(
    expected: &IosLayoutSnapshot,
    actual: &IosLayoutSnapshot,
    page: usize,
) -> bool {
    if actual.scan_scope != "visibleMirrorPage"
        || actual.pages.len() != 1
        || actual.pages[0].index != 0
    {
        return false;
    }
    let mut projected = expected.clone();
    projected.pages.retain(|item| item.index == page);
    if projected.pages.len() != 1 || projected.pages[0].app_ids.is_empty() {
        return false;
    }
    projected.pages[0].index = 0;
    projected
        .apps
        .retain(|app| app.current_page == Some(page) || app.in_dock);
    for app in &mut projected.apps {
        if app.current_page == Some(page) {
            app.current_page = Some(0);
        }
    }
    projected.folders.retain(|folder| folder.page == page);
    for folder in &mut projected.folders {
        folder.page = 0;
    }
    layout_matches(&projected, actual)
}

pub fn matches_expected_page(
    expected: &IosLayoutSnapshot,
    actual: &IosLayoutSnapshot,
    operation: &IosOperation,
) -> bool {
    let IosOperation::MoveApp { from_page, .. } = operation else {
        return false;
    };
    page_layout_matches(expected, actual, *from_page)
}

/// After a drag the mirror shows the page the App landed on.
pub fn matches_expected_target_page(
    expected: &IosLayoutSnapshot,
    actual: &IosLayoutSnapshot,
    operation: &IosOperation,
) -> bool {
    let IosOperation::MoveApp { to_page, .. } = operation else {
        return false;
    };
    page_layout_matches(expected, actual, *to_page)
}

/// Extra evidence the helper needs for one drag, derived from the verified
/// layout before the action. `allowReflow` is only set for a drag into the
/// occupied run of a packed page, which the grid model has already accepted.
pub fn action_context(expected_before: &IosLayoutSnapshot, operation: &IosOperation) -> Value {
    let IosOperation::MoveApp {
        app_id,
        from_page,
        to_page,
        to_row,
        to_column,
        ..
    } = operation
    else {
        return json!({});
    };
    let state = LayoutState::from_snapshot(expected_before);
    let target_occupied = slot_of(*to_row, *to_column)
        .and_then(|slot| state.page(*to_page)?.occupant(slot).cloned())
        .is_some();
    let mut target_ids = state
        .page(*to_page)
        .map(|page| {
            page.apps()
                .filter(|(_, id)| *id != app_id)
                .map(|(_, id)| id.to_string())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    target_ids.sort();
    json!({
        "allowReflow": from_page == to_page && target_occupied,
        "expectedTargetAppIds": if from_page == to_page { Vec::new() } else { target_ids },
    })
}

pub fn matches_another_page(expected: &IosLayoutSnapshot, actual: &IosLayoutSnapshot) -> bool {
    expected
        .pages
        .iter()
        .filter(|page| page_layout_matches(expected, actual, page.index))
        .count()
        == 1
}

#[cfg(test)]
#[path = "execution_checks_tests.rs"]
mod tests;
