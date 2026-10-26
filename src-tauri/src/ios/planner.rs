use super::classification::{
    category_for_name, classify_with_ai, is_hard_case, preserve_sensitive,
};
use super::safety::MIN_AUTOMATION_CONFIDENCE;
use super::types::{IosLayoutPlan, IosLayoutSnapshot, IosOperation, IosPlanRequest};
use crate::ai::MIN_AI_CLASSIFICATION_CONFIDENCE;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::time::{SystemTime, UNIX_EPOCH};

#[path = "planner_support.rs"]
mod support;
use support::{normalized_name, protected_ids, safe_position};

#[path = "planner_moves.rs"]
mod moves;
use super::layout_model::MAX_PLAN_OPERATIONS;
use moves::MovePlanner;

fn preview_names(names: &[String]) -> String {
    let mut sorted = names.to_vec();
    sorted.sort();
    let shown = sorted
        .iter()
        .take(5)
        .cloned()
        .collect::<Vec<_>>()
        .join("、");
    if sorted.len() > 5 {
        format!("{shown} 等")
    } else {
        shown
    }
}

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

    let protected_set: HashSet<&str> = protected.iter().map(String::as_str).collect();
    let by_id = apps
        .iter()
        .map(|app| (app.id.as_str(), app))
        .collect::<HashMap<_, _>>();
    let locked = |id: &str| {
        protected_set.contains(id)
            || by_id
                .get(id)
                .map(|app| app.in_dock || app.confidence < MIN_AUTOMATION_CONFIDENCE)
                .unwrap_or(true)
    };
    let mut mover = MovePlanner::new(snapshot, &locked);

    let mut category_counts = BTreeMap::<(usize, String), usize>::new();
    let mut desired = HashMap::new();
    let mut unreachable = Vec::new();
    for app in apps.iter().filter(|app| !locked(&app.id)) {
        *category_counts
            .entry((
                template.category_priority(&app.category),
                app.category.clone(),
            ))
            .or_default() += 1;
        let Some(from_page) = app.current_page else {
            continue;
        };
        let target = template.page_for_category(&app.category);
        if target == from_page || !mover.has_page(from_page) {
            continue;
        }
        if mover.has_page(target) {
            desired.insert(app.id.clone(), target);
        } else {
            unreachable.push(app.name.clone());
        }
    }
    for ((_, category), count) in &category_counts {
        if *count >= template.folder_threshold() && category != "其他" {
            warnings.push(format!(
                "{category} 类共 {count} 个 App，建议人工创建文件夹后重新盘点；本次只移动图标位置"
            ));
        }
    }
    if !unreachable.is_empty() {
        warnings.push(format!(
            "{} 个 App 的目标页不存在或包含组件，保留在原页并只做同页整理：{}",
            unreachable.len(),
            preview_names(&unreachable)
        ));
    }

    mover.relocate(&desired);
    let stranded = desired
        .iter()
        .filter(|(id, page)| mover.position_of(id).map(|(at, _)| at) != Some(**page))
        .filter_map(|(id, _)| by_id.get(id.as_str()).map(|app| app.name.clone()))
        .collect::<Vec<_>>();
    if !stranded.is_empty() {
        warnings.push(format!(
            "{} 个 App 暂时无法自动跨页（目标页已满、超过 3 页，或会挤动受保护图标），已保留在原页：{}",
            stranded.len(),
            preview_names(&stranded)
        ));
    }
    let rank = |id: &str| {
        by_id
            .get(id)
            .map(|app| {
                (
                    template.category_priority(&app.category),
                    normalized_name(&app.name),
                )
            })
            .unwrap_or((usize::MAX, String::new()))
    };
    mover.reorder(&rank);
    if mover.truncated {
        warnings.push(format!(
            "动作较多，本次只生成前 {MAX_PLAN_OPERATIONS} 步；执行完成后请重新盘点并生成方案继续整理"
        ));
    }
    let operations = mover.operations;

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
        warnings.push(
            "当前布局已符合模板，或剩余调整都会挤动受保护图标；请按建议人工调整后重新盘点"
                .to_string(),
        );
    } else {
        let cross_page = operations
            .iter()
            .filter(|operation| matches!(operation, IosOperation::MoveApp { from_page, to_page, .. } if from_page != to_page))
            .count();
        warnings.push(format!(
            "本次共 {} 步（其中跨页 {} 步）：排满的页面按顺序重排，跨页只移动页面最后一个图标并放到目标页末尾；如需切换页面会暂停提示",
            operations.len(),
            cross_page
        ));
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
    let mut warnings = Vec::new();

    let mut protected = protected_ids(current);
    protected.extend(protected_ids(target));
    // Keep the protection list valid even if called with mismatched snapshots;
    // the command boundary rejects inventory mismatches before planning.
    protected.retain(|id| current.apps.iter().any(|app| app.id == *id));
    let current_by_id = current
        .apps
        .iter()
        .map(|app| (app.id.as_str(), app))
        .collect::<HashMap<_, _>>();
    let locked = |id: &str| {
        protected.contains(id)
            || current_by_id
                .get(id)
                .map(|app| app.in_dock || app.confidence < MIN_AUTOMATION_CONFIDENCE)
                .unwrap_or(true)
    };
    let mut mover = MovePlanner::new(current, &locked);
    let mut goals = Vec::new();

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
        if safe_position(app).is_none() {
            warnings.push(format!("无法恢复 {} 的当前位置", app.name));
            continue;
        }
        let Some((to_page, to_row, to_column)) = safe_position(target_app) else {
            warnings.push(format!("目标快照没有 {} 的位置", app.name));
            continue;
        };
        goals.push((to_page, to_row * 4 + to_column, app));
    }
    // Fill targets in reading order; a few passes let earlier moves vacate
    // slots or reflow neighbours that later goals depend on.
    goals.sort_by_key(|(page, slot, _)| (*page, *slot));
    for _ in 0..4 {
        let mut progressed = false;
        for (page, slot, app) in &goals {
            let Some(at) = mover.position_of(&app.id) else {
                continue;
            };
            if at != (*page, *slot) && mover.push(&app.id, at, (*page, *slot)) {
                progressed = true;
            }
        }
        if !progressed {
            break;
        }
    }
    for (page, slot, app) in &goals {
        if mover.position_of(&app.id) != Some((*page, *slot)) {
            warnings.push(format!(
                "{} 无法安全自动恢复到第 {} 页第 {} 行第 {} 列；请人工调整后重新盘点",
                app.name,
                page + 1,
                slot / 4 + 1,
                slot % 4 + 1
            ));
        }
    }
    let operations = mover.operations;

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
