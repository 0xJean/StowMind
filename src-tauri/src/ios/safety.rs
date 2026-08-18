use super::types::{IosAppIdentity, IosLayoutPlan, IosLayoutSnapshot, IosOperation};
use std::collections::{HashMap, HashSet};

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

fn operation_app_ids(operation: &IosOperation) -> Vec<&str> {
    match operation {
        IosOperation::MoveApp { app_id, .. } | IosOperation::MoveToDock { app_id, .. } => {
            vec![app_id.as_str()]
        }
        IosOperation::CreateFolder { app_ids, .. } => app_ids.iter().map(String::as_str).collect(),
        IosOperation::RenameFolder { .. } => Vec::new(),
    }
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

    let apps = snapshot
        .apps
        .iter()
        .map(|app| (app.id.as_str(), app))
        .collect::<HashMap<_, _>>();
    let protected = plan
        .protected_app_ids
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();
    let widget_pages = snapshot
        .pages
        .iter()
        .filter(|page| page.has_widgets)
        .map(|page| page.index)
        .collect::<HashSet<_>>();

    for protected_id in &protected {
        if !apps.contains_key(protected_id) {
            return Err("Protected App is missing from the source snapshot".to_string());
        }
    }

    for operation in &plan.operations {
        for app_id in operation_app_ids(operation) {
            let app = apps
                .get(app_id)
                .ok_or_else(|| "Plan references an App outside the source snapshot".to_string())?;
            if protected.contains(app_id) || app.sensitive {
                return Err(format!("Protected App cannot be moved: {}", app.name));
            }
            if app.folder_name.is_some()
                || app
                    .current_page
                    .map(|page| widget_pages.contains(&page))
                    .unwrap_or(false)
            {
                return Err(format!(
                    "App is inside a protected folder or widget page: {}",
                    app.name
                ));
            }
            if app.confidence < MIN_AUTOMATION_CONFIDENCE {
                return Err(format!(
                    "Low-confidence App cannot be automated: {}",
                    app.name
                ));
            }
        }

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
                let app = apps[app_id.as_str()];
                if app.in_dock
                    || app.current_page != Some(*from_page)
                    || app.current_row != Some(*from_row)
                    || app.current_column != Some(*from_column)
                {
                    return Err(format!(
                        "Plan source position no longer matches App: {}",
                        app.name
                    ));
                }
                if widget_pages.contains(to_page) {
                    return Err("Apps cannot be moved onto a widget page".to_string());
                }
                if (*from_page, *from_row, *from_column) != (*to_page, *to_row, *to_column)
                    && apps.values().any(|other| {
                        other.id != app.id
                            && !other.in_dock
                            && other.current_page == Some(*to_page)
                            && other.current_row == Some(*to_row)
                            && other.current_column == Some(*to_column)
                    })
                {
                    return Err(
                        "Move target is already occupied in the source snapshot".to_string()
                    );
                }
            }
            IosOperation::MoveToDock {
                app_id,
                from_page,
                from_row,
                from_column,
                dock_index,
            } => {
                let app = apps[app_id.as_str()];
                if app.in_dock
                    || app.current_page != Some(*from_page)
                    || app.current_row != Some(*from_row)
                    || app.current_column != Some(*from_column)
                {
                    return Err(format!(
                        "Plan source position no longer matches App: {}",
                        app.name
                    ));
                }
                if snapshot.dock.get(*dock_index).is_some() {
                    return Err("Move target Dock slot is already occupied".to_string());
                }
            }
            IosOperation::CreateFolder {
                page,
                row,
                column,
                app_ids,
                ..
            } => {
                if app_ids.iter().any(|id| apps[id.as_str()].in_dock) {
                    return Err("Dock Apps cannot be used to create a folder".to_string());
                }
                if widget_pages.contains(page) {
                    return Err("Folders cannot be created on a widget page".to_string());
                }
                if !app_ids.iter().any(|id| {
                    let app = apps[id.as_str()];
                    app.current_page == Some(*page)
                        && app.current_row == Some(*row)
                        && app.current_column == Some(*column)
                }) {
                    return Err("Folder anchor does not match a member App position".to_string());
                }
            }
            IosOperation::RenameFolder {
                page,
                row,
                column,
                from,
                ..
            } => {
                if widget_pages.contains(page) {
                    return Err("Folders on widget pages cannot be renamed".to_string());
                }
                let matches = snapshot.folders.iter().filter(|folder| {
                    folder.page == *page
                        && folder.row == *row
                        && folder.column == *column
                        && folder.name == *from
                });
                let matching_folders = matches.collect::<Vec<_>>();
                if matching_folders.len() != 1 {
                    return Err("Folder rename target is not unique".to_string());
                }
                if matching_folders[0].app_ids.iter().any(|id| {
                    apps.get(id.as_str())
                        .map(|app| app.sensitive || protected.contains(id.as_str()))
                        .unwrap_or(false)
                }) {
                    return Err("Folders containing protected Apps cannot be renamed".to_string());
                }
            }
        }
    }

    Ok(())
}

pub fn protected_apps(apps: &[IosAppIdentity]) -> Vec<String> {
    apps.iter()
        .filter(|app| app.sensitive)
        .map(|app| app.id.clone())
        .collect()
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
    let end = (start + MAX_BATCH_ACTIONS).min(plan.operations.len());
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
        "reset home screen",
        "reset home screen layout",
        "uninstall",
        "删除 app",
        "删除应用",
        "卸载",
        "移除应用",
        "从主屏幕移除",
        "移出主屏幕",
        "隐藏页面",
        "重置主屏幕",
    ]
    .iter()
    .any(|term| normalized.contains(term))
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
            r#"{"type":"resetLayout"}"#,
        ] {
            assert!(serde_json::from_str::<IosOperation>(operation).is_err());
        }
    }

    #[test]
    fn protected_app_cannot_appear_in_plan() {
        let mut protected = app("bank");
        protected.sensitive = true;
        let snapshot = IosLayoutSnapshot {
            id: "snapshot".to_string(),
            captured_at: "0".to_string(),
            device_name: None,
            apps: vec![protected],
            folders: Vec::new(),
            pages: Vec::new(),
            dock: Vec::new(),
            inventory_hash: String::new(),
            confidence: 1.0,
            source: "test".to_string(),
            scan_scope: "fixture".to_string(),
            inventory_complete: true,
            warnings: Vec::new(),
            window_bounds: None,
        };
        let plan = IosLayoutPlan {
            id: "plan".to_string(),
            source_snapshot_id: snapshot.id.clone(),
            template: "efficiency".to_string(),
            use_ai: false,
            operations: vec![IosOperation::MoveApp {
                app_id: "bank".to_string(),
                from_page: 0,
                from_row: 0,
                from_column: 0,
                to_page: 0,
                to_row: 0,
                to_column: 1,
            }],
            warnings: Vec::new(),
            protected_app_ids: vec!["bank".to_string()],
            created_at: "0".to_string(),
            restore_target_snapshot_id: None,
        };
        assert!(validate_plan_against_snapshot(&plan, &snapshot).is_err());
    }

    #[test]
    fn occupied_move_target_is_rejected() {
        let first = app("first");
        let mut second = app("second");
        second.current_column = Some(1);
        let snapshot = IosLayoutSnapshot {
            id: "snapshot".to_string(),
            captured_at: "0".to_string(),
            device_name: None,
            apps: vec![first.clone(), second],
            folders: Vec::new(),
            pages: vec![super::super::types::IosPageSnapshot {
                index: 0,
                app_ids: vec![first.id.clone(), "second".to_string()],
                has_widgets: false,
            }],
            dock: Vec::new(),
            inventory_hash: String::new(),
            confidence: 1.0,
            source: "test".to_string(),
            scan_scope: "fixture".to_string(),
            inventory_complete: true,
            warnings: Vec::new(),
            window_bounds: None,
        };
        let plan = IosLayoutPlan {
            id: "plan".to_string(),
            source_snapshot_id: snapshot.id.clone(),
            template: "efficiency".to_string(),
            use_ai: false,
            operations: vec![IosOperation::MoveApp {
                app_id: first.id,
                from_page: 0,
                from_row: 0,
                from_column: 0,
                to_page: 0,
                to_row: 0,
                to_column: 1,
            }],
            warnings: Vec::new(),
            protected_app_ids: Vec::new(),
            created_at: "0".to_string(),
            restore_target_snapshot_id: None,
        };
        assert!(validate_plan_against_snapshot(&plan, &snapshot).is_err());
    }
}
