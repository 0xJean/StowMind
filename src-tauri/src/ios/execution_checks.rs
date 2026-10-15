use super::layout::layout_matches;
use super::types::{IosExecutionSession, IosExecutionStatus, IosLayoutSnapshot, IosOperation};

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
