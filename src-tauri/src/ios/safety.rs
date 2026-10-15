use super::types::{IosAppIdentity, IosLayoutPlan, IosLayoutSnapshot, IosOperation};
use std::collections::{HashMap, HashSet};

pub use super::layout::{layout_hash, snapshot_after_operations};

pub const MAX_BATCH_ACTIONS: usize = 3;
pub const MIN_AUTOMATION_CONFIDENCE: f32 = 0.90;
const MAX_PAGE_INDEX: usize = 99;
const MAX_HOME_ROW: usize = 5;
const MAX_HOME_COLUMN: usize = 3;
const MAX_DOCK_INDEX: usize = 3;
const ALLOWED_TEMPLATES: &[&str] = &["efficiency", "minimal", "work", "privacy", "restore"];

fn validate_grid(page: usize, row: usize, column: usize) -> Result<(), String> {
    if page > MAX_PAGE_INDEX || row > MAX_HOME_ROW || column > MAX_HOME_COLUMN {
        return Err("Home Screen coordinates are outside the safe grid".to_string());
    }
    Ok(())
}

pub fn validate_operation(operation: &IosOperation) -> Result<(), String> {
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
            if app_id.trim().is_empty() {
                return Err("App identity is required".to_string());
            }
            validate_grid(*from_page, *from_row, *from_column)?;
            validate_grid(*to_page, *to_row, *to_column)?;
        }
        IosOperation::MoveToDock {
            app_id,
            from_page,
            from_row,
            from_column,
            dock_index,
        } => {
            if app_id.trim().is_empty() {
                return Err("App identity is required".to_string());
            }
            validate_grid(*from_page, *from_row, *from_column)?;
            if *dock_index > MAX_DOCK_INDEX {
                return Err("Dock coordinates are outside the safe grid".to_string());
            }
        }
        IosOperation::CreateFolder {
            page,
            row,
            column,
            name,
            app_ids,
        } => {
            if name.trim().is_empty() || app_ids.len() < 2 {
                return Err("A folder needs a name and at least two apps".to_string());
            }
            validate_grid(*page, *row, *column)?;
            if contains_forbidden_text(name) {
                return Err("Folder name contains a forbidden destructive term".to_string());
            }
            let unique = app_ids.iter().collect::<HashSet<_>>();
            if unique.len() != app_ids.len() {
                return Err("A folder cannot contain duplicate App identities".to_string());
            }
        }
        IosOperation::RenameFolder {
            page,
            row,
            column,
            from,
            to,
        } => {
            if from.trim().is_empty() || to.trim().is_empty() {
                return Err("Folder names cannot be empty".to_string());
            }
            validate_grid(*page, *row, *column)?;
            if contains_forbidden_text(from) || contains_forbidden_text(to) {
                return Err("Folder name contains a forbidden destructive term".to_string());
            }
        }
    }
    Ok(())
}

pub fn validate_plan(plan: &IosLayoutPlan) -> Result<(), String> {
    if plan.id.trim().is_empty() || plan.source_snapshot_id.trim().is_empty() {
        return Err("Plan identity is required".to_string());
    }
    if !ALLOWED_TEMPLATES.contains(&plan.template.as_str()) {
        return Err("Unknown iPhone layout template".to_string());
    }

    for operation in &plan.operations {
        validate_operation(operation)?;
    }

    Ok(())
}

pub fn validate_plan_against_snapshot(
    plan: &IosLayoutPlan,
    snapshot: &IosLayoutSnapshot,
) -> Result<(), String> {
    validate_plan(plan)?;
    if plan.source_snapshot_id != snapshot.id {
        return Err("Plan source does not match the stored snapshot".to_string());
    }
    let protected = plan.protected_app_ids.iter().collect::<HashSet<_>>();
    if protected
        .iter()
        .any(|id| !snapshot.apps.iter().any(|app| &app.id == *id))
    {
        return Err("Protected App is missing from the source snapshot".to_string());
    }
    let normalized = |name: &str| {
        name.to_lowercase()
            .chars()
            .filter(|character| character.is_alphanumeric())
            .collect::<String>()
    };
    let mut moved = HashSet::new();
    let mut destinations = HashSet::new();
    for operation in &plan.operations {
        // Serialized variants remain a whitelist, but the current helper only
        // supports same-page moves. Reject legacy/handcrafted unsupported plans.
        let IosOperation::MoveApp {
            app_id,
            from_page,
            from_row,
            from_column,
            to_page,
            to_row,
            to_column,
        } = operation
        else {
            return Err("此方案包含尚不支持的自动动作，请重新生成方案".to_string());
        };
        if from_page != to_page || (from_row, from_column) == (to_row, to_column) {
            return Err("Only non-empty same-page moves can be automated".to_string());
        }
        if !moved.insert(app_id) || !destinations.insert((to_page, to_row, to_column)) {
            return Err("A plan cannot repeat an App or destination".to_string());
        }
        let candidates = snapshot
            .apps
            .iter()
            .filter(|app| app.id == *app_id)
            .collect::<Vec<_>>();
        if candidates.len() != 1 {
            return Err("Plan App identity is missing or ambiguous".to_string());
        }
        let app = candidates[0];
        let name = normalized(&app.name);
        if name.is_empty()
            || snapshot
                .apps
                .iter()
                .filter(|other| normalized(&other.name) == name)
                .count()
                != 1
        {
            return Err("App name is not unique in the source snapshot".to_string());
        }
        if protected.contains(&app.id)
            || app.sensitive
            || super::classification::category_for_name(&app.name).1
        {
            return Err(format!("Protected App cannot be moved: {}", app.name));
        }
        if app.in_dock
            || snapshot.dock.contains(app_id)
            || app.folder_name.is_some()
            || snapshot
                .folders
                .iter()
                .any(|folder| folder.app_ids.contains(app_id))
        {
            return Err("Dock and folder Apps cannot be automated".to_string());
        }
        if !app.confidence.is_finite()
            || !(MIN_AUTOMATION_CONFIDENCE..=1.0).contains(&app.confidence)
        {
            return Err(format!(
                "Low-confidence App cannot be automated: {}",
                app.name
            ));
        }
        if app.current_page != Some(*from_page)
            || app.current_row != Some(*from_row)
            || app.current_column != Some(*from_column)
        {
            return Err(format!(
                "Plan source position no longer matches App: {}",
                app.name
            ));
        }
        let pages = snapshot
            .pages
            .iter()
            .filter(|page| page.index == *from_page)
            .collect::<Vec<_>>();
        if pages.len() != 1 || pages[0].has_widgets {
            return Err("Source page is missing, ambiguous or contains widgets".to_string());
        }
        if pages[0].app_ids.iter().any(|id| {
            !snapshot.apps.iter().any(|other| {
                other.id == *id
                    && other.current_page == Some(*from_page)
                    && other.current_row.is_some()
                    && other.current_column.is_some()
            })
        }) {
            return Err("Page contains an unknown or unlocated App identity".to_string());
        }
        // Ambiguous or unlocated contents cannot establish a safe empty slot.
        let mut occupied = HashSet::new();
        for other in snapshot.apps.iter().filter(|other| {
            other.current_page == Some(*from_page)
                && !other.in_dock
                && other.folder_name.is_none()
                && !snapshot
                    .folders
                    .iter()
                    .any(|folder| folder.app_ids.contains(&other.id))
        }) {
            let (Some(row), Some(column)) = (other.current_row, other.current_column) else {
                return Err("Page contains an App without a reliable position".to_string());
            };
            validate_grid(*from_page, row, column)?;
            if !occupied.insert((row, column)) {
                return Err("Page contains overlapping App positions".to_string());
            }
        }
        for folder in snapshot
            .folders
            .iter()
            .filter(|folder| folder.page == *from_page)
        {
            validate_grid(folder.page, folder.row, folder.column)?;
            if !occupied.insert((folder.row, folder.column)) {
                return Err("Page contains overlapping folder positions".to_string());
            }
        }
        if occupied.contains(&(*to_row, *to_column)) {
            return Err("Move target is already occupied in the source snapshot".to_string());
        }
    }
    Ok(())
}

pub fn inventory_hash(apps: &[IosAppIdentity]) -> String {
    let mut ids: Vec<&str> = apps.iter().map(|app| app.id.as_str()).collect();
    ids.sort_unstable();
    let mut hash = 1469598103934665603u64;
    for byte in ids.join("\n").as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(1099511628211);
    }
    format!("{hash:016x}")
}

pub fn inventory_matches(before: &[IosAppIdentity], after: &[IosAppIdentity]) -> bool {
    let counts = |apps: &[IosAppIdentity]| {
        let mut out = HashMap::<String, usize>::new();
        for app in apps {
            *out.entry(app.id.clone()).or_default() += 1;
        }
        out
    };
    counts(before) == counts(after)
}

pub fn validate_batch(plan: &IosLayoutPlan, start: usize) -> Result<&[IosOperation], String> {
    let end = start
        .saturating_add(MAX_BATCH_ACTIONS)
        .min(plan.operations.len());
    let batch = plan
        .operations
        .get(start..end)
        .ok_or_else(|| "Invalid execution cursor".to_string())?;
    for operation in batch {
        validate_operation(operation)?;
    }
    Ok(batch)
}

pub fn contains_forbidden_text(text: &str) -> bool {
    let normalized = text.to_lowercase();
    [
        "delete app",
        "remove app",
        "remove from home screen",
        "hide page",
        "hide app",
        "reset home screen",
        "reset home screen layout",
        "uninstall",
        "删除 app",
        "删除应用",
        "卸载",
        "移除应用",
        "移除 app",
        "隐藏应用",
        "隐藏 app",
        "从主屏幕移除",
        "移出主屏幕",
        "隐藏页面",
        "重置主屏幕",
    ]
    .iter()
    .any(|term| normalized.contains(term))
}

#[cfg(test)]
#[path = "safety_tests.rs"]
mod tests;
