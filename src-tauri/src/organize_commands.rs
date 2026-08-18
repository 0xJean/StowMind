use crate::ai::{classify_file_stream, AIProvider, MIN_AI_CLASSIFICATION_CONFIDENCE};
use crate::organize_rules::{classify_by_rules, is_hard_case};
use crate::organizer::{
    group_similar_files, move_files, move_folders, scan_files, scan_folders, undo_moves, Category,
    FileItem, FolderItem, MoveRecord, OrganizeOutcome,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use tauri::Window;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanResult {
    name: String,
    path: String,
    size: u64,
    extension: String,
    category: String,
    #[serde(rename = "subFolder")]
    sub_folder: Option<String>,
    reason: String,
    method: String,
}

#[derive(Clone, Serialize)]
struct ScanProgressEvent {
    current: usize,
    total: usize,
    file_name: String,
    status: String,
    thinking: Option<String>,
    category: Option<String>,
}

#[derive(Clone, Serialize)]
struct OrganizeProgressEvent {
    current: usize,
    total: usize,
    path: String,
    phase: String,
}

#[tauri::command]
pub async fn scan_directory(
    window: Window,
    directory: String,
    use_ai: bool,
    ai_only_hard_cases: bool,
    ai_provider: AIProvider,
    categories: Vec<Category>,
    show_temp_files: bool,
    recursive: bool,
    exclude_patterns: Vec<String>,
) -> Result<Vec<ScanResult>, String> {
    let files = scan_files(&directory, show_temp_files, recursive, &exclude_patterns)
        .map_err(|e| e.to_string())?;
    let total = files.len();
    let mut results = Vec::new();

    for (index, file) in files.into_iter().enumerate() {
        let _ = window.emit(
            "scan-progress",
            ScanProgressEvent {
                current: index + 1,
                total,
                file_name: file.name.clone(),
                status: "scanning".to_string(),
                thinking: None,
                category: None,
            },
        );

        let (rule_cat, rule_reason, rule_method) = classify_by_rules(&file, &categories);
        let is_hard = is_hard_case(&file, &rule_cat, &categories);
        let should_call_ai = use_ai && (!ai_only_hard_cases || is_hard);

        let (category, reason, method) = if should_call_ai {
            match classify_file_stream(&file, &ai_provider, &categories, |thinking| {
                let _ = window.emit(
                    "scan-progress",
                    ScanProgressEvent {
                        current: index + 1,
                        total,
                        file_name: file.name.clone(),
                        status: "thinking".to_string(),
                        thinking: Some(thinking),
                        category: None,
                    },
                );
            })
            .await
            {
                Ok(suggestion) if suggestion.confidence >= MIN_AI_CLASSIFICATION_CONFIDENCE => {
                    let reason = format!(
                        "AI 智能分类（{}%）：{}",
                        (suggestion.confidence * 100.0).round() as u8,
                        suggestion.reason
                    );
                    let _ = window.emit(
                        "scan-progress",
                        ScanProgressEvent {
                            current: index + 1,
                            total,
                            file_name: file.name.clone(),
                            status: "classified".to_string(),
                            thinking: None,
                            category: Some(suggestion.category.clone()),
                        },
                    );
                    (suggestion.category, reason, "ai".to_string())
                }
                Ok(suggestion) => {
                    let confidence = (suggestion.confidence * 100.0).round() as u8;
                    let reason = format!(
                        "AI 置信度仅 {}%，已回退规则分类：{}",
                        confidence, rule_reason
                    );
                    let _ = window.emit(
                        "scan-progress",
                        ScanProgressEvent {
                            current: index + 1,
                            total,
                            file_name: file.name.clone(),
                            status: "classified".to_string(),
                            thinking: None,
                            category: Some(rule_cat.clone()),
                        },
                    );
                    (rule_cat, reason, "fallback".to_string())
                }
                Err(e) => {
                    let _ = window.emit(
                        "scan-progress",
                        ScanProgressEvent {
                            current: index + 1,
                            total,
                            file_name: file.name.clone(),
                            status: "error".to_string(),
                            thinking: Some(format!("AI 错误: {}", e)),
                            category: Some(rule_cat.clone()),
                        },
                    );
                    (
                        rule_cat,
                        format!("AI 分类失败：{}", e),
                        "fallback".to_string(),
                    )
                }
            }
        } else {
            let _ = window.emit(
                "scan-progress",
                ScanProgressEvent {
                    current: index + 1,
                    total,
                    file_name: file.name.clone(),
                    status: "classified".to_string(),
                    thinking: None,
                    category: Some(rule_cat.clone()),
                },
            );
            (rule_cat, rule_reason, rule_method)
        };

        results.push(ScanResult {
            name: file.name,
            path: file.path,
            size: file.size,
            extension: file.extension,
            category,
            sub_folder: None,
            reason,
            method,
        });
    }

    let _ = window.emit(
        "scan-progress",
        ScanProgressEvent {
            current: total,
            total,
            file_name: "正在分析文件相似度...".to_string(),
            status: "grouping".to_string(),
            thinking: None,
            category: None,
        },
    );

    let file_categories: Vec<(String, String)> = results
        .iter()
        .map(|r| (r.path.clone(), r.category.clone()))
        .collect();
    let sub_folders = group_similar_files(&file_categories);

    for result in &mut results {
        if let Some(sub) = sub_folders.get(&result.path) {
            result.sub_folder = sub.clone();
        }
    }

    apply_group_majority(&mut results);

    Ok(results)
}

fn apply_group_majority(results: &mut [ScanResult]) {
    let mut groups: HashMap<String, Vec<usize>> = HashMap::new();
    for (idx, r) in results.iter().enumerate() {
        if let Some(sub) = &r.sub_folder {
            groups.entry(sub.clone()).or_default().push(idx);
        }
    }

    for (_sub, indices) in groups {
        if indices.len() < 3 {
            continue;
        }

        let mut counts: HashMap<String, usize> = HashMap::new();
        for &i in &indices {
            let cat = results[i].category.clone();
            if cat == "其他" {
                continue;
            }
            *counts.entry(cat).or_insert(0) += 1;
        }

        let (winner, winner_count) = match counts.into_iter().max_by_key(|(_, c)| *c) {
            Some(v) => v,
            None => continue,
        };

        let ratio = winner_count as f64 / indices.len() as f64;
        if ratio < 0.6 {
            continue;
        }

        for &i in &indices {
            if results[i].category != winner {
                results[i].category = winner.clone();
                results[i].reason = "相似组多数投票统一分类".to_string();
                if results[i].method != "ai" {
                    results[i].method = "group".to_string();
                }
            }
        }
    }
}

#[tauri::command]
pub async fn organize_files(
    window: Window,
    directory: String,
    files: Vec<ScanResult>,
    dry_run: bool,
    backup_directory: Option<String>,
    backup_session_id: Option<String>,
) -> Result<OrganizeOutcome, String> {
    let categories: Vec<(String, String, Option<String>)> = files
        .iter()
        .map(|f| (f.path.clone(), f.category.clone(), f.sub_folder.clone()))
        .collect();

    let items: Vec<FileItem> = files
        .into_iter()
        .map(|f| FileItem {
            name: f.name,
            path: f.path,
            size: f.size,
            extension: f.extension,
        })
        .collect();

    let backup_root = backup_directory.as_deref().map(Path::new);
    let backup_sid = backup_session_id.as_deref();

    move_files(
        &directory,
        &items,
        &categories,
        dry_run,
        backup_root,
        backup_sid,
        |cur, total, path| {
            let _ = window.emit(
                "organize-progress",
                OrganizeProgressEvent {
                    current: cur,
                    total,
                    path: path.to_string(),
                    phase: "files".to_string(),
                },
            );
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn scan_folders_cmd(
    directory: String,
    categories: Vec<Category>,
) -> Result<Vec<FolderItem>, String> {
    scan_folders(&directory, &categories).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn organize_folders(
    window: Window,
    directory: String,
    folders: Vec<FolderItem>,
    dry_run: bool,
    backup_directory: Option<String>,
    backup_session_id: Option<String>,
) -> Result<OrganizeOutcome, String> {
    let backup_root = backup_directory.as_deref().map(Path::new);
    let backup_sid = backup_session_id.as_deref();

    move_folders(
        &directory,
        &folders,
        dry_run,
        backup_root,
        backup_sid,
        |cur, total, path| {
            let _ = window.emit(
                "organize-progress",
                OrganizeProgressEvent {
                    current: cur,
                    total,
                    path: path.to_string(),
                    phase: "folders".to_string(),
                },
            );
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn undo_organize(records: Vec<MoveRecord>) -> Result<Vec<String>, String> {
    undo_moves(&records).map_err(|e| e.to_string())
}
