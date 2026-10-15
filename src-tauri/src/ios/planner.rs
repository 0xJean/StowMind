use super::classification::{
    category_for_name, classify_with_ai, is_hard_case, preserve_sensitive,
};
use super::safety::MIN_AUTOMATION_CONFIDENCE;
use super::types::{
    IosAppIdentity, IosLayoutPlan, IosLayoutSnapshot, IosOperation, IosPlanRequest,
};
use crate::ai::MIN_AI_CLASSIFICATION_CONFIDENCE;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::time::{SystemTime, UNIX_EPOCH};

#[path = "planner_support.rs"]
mod support;
use support::{normalized_name, original_occupied_slots, protected_ids, safe_position};

#[cfg(test)]
#[path = "planner_tests.rs"]
mod tests;

fn now_id(prefix: &str) -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    format!("{prefix}-{millis}")
}

fn now_string() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

#[derive(Clone, Copy)]
enum LayoutTemplate {
    Efficiency,
    Minimal,
    Work,
    Privacy,
}

impl LayoutTemplate {
    fn parse(value: &str) -> Self {
        match value {
            "minimal" => Self::Minimal,
            "work" => Self::Work,
            "privacy" => Self::Privacy,
            _ => Self::Efficiency,
        }
    }

    fn folder_threshold(self) -> usize {
        match self {
            Self::Minimal => 2,
            Self::Privacy => 4,
            Self::Efficiency | Self::Work => 3,
        }
    }

    fn page_for_category(self, category: &str) -> usize {
        match self {
            Self::Efficiency => match category {
                "通讯" | "效率" | "出行" => 0,
                "工作" | "AI" | "开发" => 1,
                _ => 2,
            },
            Self::Minimal => match category {
                "通讯" | "效率" => 0,
                _ => 1,
            },
            Self::Work => match category {
                "工作" | "AI" | "开发" | "通讯" => 0,
                "效率" | "出行" => 1,
                _ => 2,
            },
            Self::Privacy => match category {
                "通讯" | "效率" | "工作" | "AI" | "开发" => 0,
                "出行" | "购物" | "内容" => 1,
                _ => 2,
            },
        }
    }

    fn category_priority(self, category: &str) -> usize {
        let categories = match self {
            Self::Work => ["工作", "AI", "开发", "通讯", "效率", "出行", "购物", "内容"],
            _ => ["通讯", "效率", "工作", "AI", "开发", "出行", "购物", "内容"],
        };
        categories
            .iter()
            .position(|value| *value == category)
            .unwrap_or(categories.len())
    }
}

fn next_empty_slot(
    occupied: &HashSet<(usize, usize, usize)>,
    page: usize,
) -> Option<(usize, usize)> {
    for slot in 0..24 {
        let row = slot / 4;
        let column = slot % 4;
        if !occupied.contains(&(page, row, column)) {
            return Some((row, column));
        }
    }
    None
}

pub async fn create_plan(snapshot: &IosLayoutSnapshot, request: &IosPlanRequest) -> IosLayoutPlan {
    let mut apps = snapshot.apps.clone();
    let mut warnings = Vec::new();
    let template = LayoutTemplate::parse(&request.template);

    for app in &mut apps {
        let (rule_category, rule_sensitive) = category_for_name(&app.name);
        app.category = rule_category;
        app.sensitive = preserve_sensitive(app.sensitive, rule_sensitive);

        let should_use_ai = request.use_ai
            && request.ai_provider.is_some()
            && (!request.ai_only_hard_cases || is_hard_case(app));
        if should_use_ai {
            if let Some(provider) = request.ai_provider.as_ref() {
                match classify_with_ai(app, provider, &request.template).await {
                    Ok((suggestion, sensitive))
                        if suggestion.confidence >= MIN_AI_CLASSIFICATION_CONFIDENCE =>
                    {
                        app.category = suggestion.category;
                        app.sensitive = preserve_sensitive(app.sensitive, sensitive);
                        app.source = "ai".to_string();
                    }
                    Ok((suggestion, _)) => {
                        warnings.push(format!(
                            "AI 对 {} 的分类置信度仅 {}%，已回退到规则",
                            app.name,
                            (suggestion.confidence * 100.0).round() as u8
                        ));
                        app.source = "fallback".to_string();
                    }
                    Err(error) => {
                        warnings.push(format!("AI 分类失败：{}（已回退到规则）", app.name));
                        app.source = "fallback".to_string();
                        let _ = error;
                    }
                }
            }
        } else {
            app.source = "rule".to_string();
        }
    }

    if request.use_ai && request.ai_provider.is_none() {
        warnings.push("已开启 AI，但没有可用 AI 配置，已使用规则模式".to_string());
    }

    let widget_pages = snapshot
        .pages
        .iter()
        .filter(|page| page.has_widgets)
        .map(|page| page.index)
        .collect::<HashSet<_>>();
    let mut classified_snapshot = snapshot.clone();
    classified_snapshot.apps = apps.clone();
    let mut protected = protected_ids(&classified_snapshot)
        .into_iter()
        .collect::<Vec<_>>();
    protected.sort();
    protected.dedup();
    if !protected.is_empty() {
        warnings.push(format!(
            "已保护 {} 个敏感、同名、低置信度、位置不明确或受保护区域内的 App，不会移动",
            protected.len()
        ));
    }
    if !snapshot.inventory_complete && snapshot.scan_scope == "homeScreenPages" {
        warnings.push(
            "已覆盖全部主屏幕页面，但 App 资源库清单不完整；无页面坐标的 App 不会自动移动"
                .to_string(),
        );
    }
    if !widget_pages.is_empty() {
        warnings.push("包含组件的页面保持原样，组件及该页 App 均不会自动移动".to_string());
    }

    let low_confidence: Vec<_> = apps
        .iter()
        .filter(|app| app.confidence < MIN_AUTOMATION_CONFIDENCE)
        .map(|app| app.name.clone())
        .collect();
    if !low_confidence.is_empty() {
        warnings.push(format!(
            "{} 个 App 识别置信度不足，只能人工确认",
            low_confidence.len()
        ));
    }

    let dock_apps = apps.iter().filter(|app| app.in_dock).count();
    if dock_apps > 0 {
        warnings.push(format!(
            "{} 个 Dock App 保持原位；当前执行器不支持 Dock 调整，需人工完成",
            dock_apps
        ));
    }

    let mut operations = Vec::new();
    // Never reuse a source slot vacated by an earlier action: each target must
    // already be empty in the saved snapshot used by the execution safety gate.
    let mut occupied = original_occupied_slots(snapshot);
    let protected_set: HashSet<&str> = protected.iter().map(String::as_str).collect();

    let mut grouped: BTreeMap<(usize, usize, String), Vec<&IosAppIdentity>> = BTreeMap::new();
    for app in &apps {
        if protected_set.contains(app.id.as_str())
            || app.in_dock
            || app.confidence < MIN_AUTOMATION_CONFIDENCE
        {
            continue;
        }
        grouped
            .entry((
                template.page_for_category(&app.category),
                template.category_priority(&app.category),
                app.category.clone(),
            ))
            .or_default()
            .push(app);
    }

    for ((page, _, category), mut group) in grouped {
        if widget_pages.contains(&page) {
            warnings.push(format!(
                "目标第 {} 页包含组件，{} 类 App 保持原位",
                page + 1,
                category
            ));
            continue;
        }

        if group.len() >= template.folder_threshold() && category != "其他" {
            warnings.push(format!(
                "{} 类共 {} 个 App，建议人工创建文件夹后重新盘点；本次只整理该类别可安全移动的同页图标",
                category,
                group.len()
            ));
        }

        group.sort_by_key(|app| {
            (
                app.current_row,
                app.current_column,
                normalized_name(&app.name),
            )
        });
        for app in group {
            let Some(from_page) = app.current_page else {
                warnings.push(format!("无法确定 {} 的当前页面，需人工处理", app.name));
                continue;
            };
            if from_page != page {
                warnings.push(format!(
                    "{} 需要从第 {} 页移动到第 {} 页；当前执行器只支持同页移动，已跳过自动移动",
                    app.name,
                    from_page + 1,
                    page + 1
                ));
                continue;
            }
            let Some(from_row) = app.current_row else {
                warnings.push(format!("无法确定 {} 的当前行，需人工处理", app.name));
                continue;
            };
            let Some(from_column) = app.current_column else {
                warnings.push(format!("无法确定 {} 的当前列，需人工处理", app.name));
                continue;
            };
            let Some((to_row, to_column)) = next_empty_slot(&occupied, page) else {
                warnings.push(format!("第 {} 页没有足够的安全格位", page + 1));
                continue;
            };
            if (to_row, to_column) >= (from_row, from_column) {
                continue;
            }
            operations.push(IosOperation::MoveApp {
                app_id: app.id.clone(),
                from_page,
                from_row,
                from_column,
                to_page: page,
                to_row,
                to_column,
            });
            occupied.insert((page, to_row, to_column));
        }
    }

    for folder in &snapshot.folders {
        if widget_pages.contains(&folder.page)
            || folder
                .app_ids
                .iter()
                .any(|id| protected_set.contains(id.as_str()))
        {
            continue;
        }
        let mut categories = folder
            .app_ids
            .iter()
            .filter_map(|id| apps.iter().find(|app| &app.id == id))
            .map(|app| app.category.clone())
            .collect::<Vec<_>>();
        categories.sort();
        categories.dedup();
        if categories.len() == 1 {
            let category = categories.remove(0);
            if category != "其他" && category != folder.name {
                warnings.push(format!(
                    "文件夹「{}」建议重命名为「{}」；当前执行器不支持重命名，已跳过，请人工完成后重新盘点",
                    folder.name, category
                ));
            }
        }
    }

    if operations.is_empty() {
        warnings.push("当前没有可自动整理的同页前方空位；请按建议人工调整后重新盘点".to_string());
    } else {
        warnings.push(
            "本次按模板分类优先级填补同页已有空位；执行完成后可重新盘点，继续整理新产生的空位"
                .to_string(),
        );
    }

    IosLayoutPlan {
        id: now_id("ios-plan"),
        source_snapshot_id: snapshot.id.clone(),
        template: request.template.clone(),
        use_ai: request.use_ai,
        operations,
        target_layout_hash: None,
        warnings,
        protected_app_ids: protected,
        created_at: now_string(),
        restore_target_snapshot_id: None,
    }
}

pub fn create_restore_plan(
    current: &IosLayoutSnapshot,
    target: &IosLayoutSnapshot,
) -> IosLayoutPlan {
    let target_by_id = target
        .apps
        .iter()
        .map(|app| (app.id.as_str(), app))
        .collect::<HashMap<_, _>>();
    let mut operations = Vec::new();
    let mut warnings = Vec::new();

    let mut protected = protected_ids(current);
    protected.extend(protected_ids(target));
    // Keep the protection list valid even if called with mismatched snapshots;
    // the command boundary rejects inventory mismatches before planning.
    protected.retain(|id| current.apps.iter().any(|app| app.id == *id));
    let mut occupied = original_occupied_slots(current);

    for app in &current.apps {
        let Some(target_app) = target_by_id.get(app.id.as_str()) else {
            warnings.push(format!("目标快照缺少 {}，已跳过", app.name));
            continue;
        };
        if app.in_dock || target_app.in_dock {
            warnings.push(format!(
                "{} 需要调整 Dock 位置；当前执行器不支持 Dock 调整，已跳过自动恢复",
                app.name
            ));
            continue;
        }
        if protected.contains(&app.id) {
            warnings.push(format!("{} 属于受保护区域，恢复时保持原样", app.name));
            continue;
        }
        let Some((from_page, from_row, from_column)) = safe_position(app) else {
            warnings.push(format!("无法恢复 {} 的当前位置", app.name));
            continue;
        };
        let Some((to_page, to_row, to_column)) = safe_position(target_app) else {
            warnings.push(format!("目标快照没有 {} 的位置", app.name));
            continue;
        };
        if from_page != to_page {
            warnings.push(format!(
                "{} 需要从第 {} 页恢复到第 {} 页；当前执行器只支持同页移动，已跳过自动恢复",
                app.name,
                from_page + 1,
                to_page + 1
            ));
            continue;
        }
        if (from_page, from_row, from_column) != (to_page, to_row, to_column) {
            if occupied.contains(&(to_page, to_row, to_column)) {
                warnings.push(format!(
                    "{} 的原位置当前被占用或已分配；请人工腾出后重新盘点再恢复",
                    app.name
                ));
                continue;
            }
            operations.push(IosOperation::MoveApp {
                app_id: app.id.clone(),
                from_page,
                from_row,
                from_column,
                to_page,
                to_row,
                to_column,
            });
            occupied.insert((to_page, to_row, to_column));
        }
    }

    let mut protected_app_ids = protected.into_iter().collect::<Vec<_>>();
    protected_app_ids.sort();

    IosLayoutPlan {
        id: now_id("ios-restore"),
        source_snapshot_id: current.id.clone(),
        template: "restore".to_string(),
        use_ai: false,
        operations,
        target_layout_hash: None,
        warnings,
        protected_app_ids,
        created_at: now_string(),
        restore_target_snapshot_id: Some(target.id.clone()),
    }
}
