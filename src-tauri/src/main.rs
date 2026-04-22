#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ai;
mod deepclean;
mod duplicates;
mod organizer;
mod pty;
mod watch;

use ai::{AIProvider, classify_file_stream};
use duplicates::DuplicateGroup;
use organizer::{scan_files, scan_folders, move_files, move_folders, undo_moves, group_similar_files, FileItem, FolderItem, Category, MoveRecord, OrganizeOutcome};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use tauri::{AppHandle, State, Window};
use watch::WatchManager;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ScanResult {
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
    status: String, // "scanning", "thinking", "classified", "grouping", "error"
    thinking: Option<String>,
    category: Option<String>,
}

/// 整理阶段进度（移动文件 / 文件夹时由后端 emit）
#[derive(Clone, Serialize)]
struct OrganizeProgressEvent {
    current: usize,
    total: usize,
    path: String,
    /// "files" | "folders"
    phase: String,
}

#[derive(Clone, Serialize)]
struct DuplicateScanProgress {
    current: usize,
    total: usize,
}

#[tauri::command]
async fn check_ollama(host: String) -> bool {
    let url = format!("{}/api/tags", host);
    match reqwest::get(&url).await {
        Ok(resp) => resp.status().is_success(),
        Err(_) => false,
    }
}

#[tauri::command]
async fn test_api_connection(provider: AIProvider) -> bool {
    ai::test_connection(&provider).await
}

#[tauri::command]
async fn scan_directory(
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

    // 第一阶段：规则优先分类；疑难才调用 AI（当开启 use_ai 时）
    for (index, file) in files.into_iter().enumerate() {
        // 发送开始扫描事件
        let _ = window.emit("scan-progress", ScanProgressEvent {
            current: index + 1,
            total,
            file_name: file.name.clone(),
            status: "scanning".to_string(),
            thinking: None,
            category: None,
        });

        let (rule_cat, rule_reason, rule_method) = classify_by_rules(&file, &categories);
        let is_hard = is_hard_case(&file, &rule_cat, &categories);
        let should_call_ai = use_ai && (!ai_only_hard_cases || is_hard);

        let (category, reason, method) = if should_call_ai {
            match classify_file_stream(&file, &ai_provider, &categories, |thinking| {
                let _ = window.emit("scan-progress", ScanProgressEvent {
                    current: index + 1,
                    total,
                    file_name: file.name.clone(),
                    status: "thinking".to_string(),
                    thinking: Some(thinking),
                    category: None,
                });
            })
            .await
            {
                Ok((cat, reason)) => {
                    let _ = window.emit("scan-progress", ScanProgressEvent {
                        current: index + 1,
                        total,
                        file_name: file.name.clone(),
                        status: "classified".to_string(),
                        thinking: None,
                        category: Some(cat.clone()),
                    });
                    (cat, reason, "ai".to_string())
                }
                Err(e) => {
                    let _ = window.emit("scan-progress", ScanProgressEvent {
                        current: index + 1,
                        total,
                        file_name: file.name.clone(),
                        status: "error".to_string(),
                        thinking: Some(format!("AI 错误: {}", e)),
                        category: Some(rule_cat.clone()),
                    });
                    (rule_cat, format!("AI 分类失败：{}", e), "fallback".to_string())
                }
            }
        } else {
            let _ = window.emit("scan-progress", ScanProgressEvent {
                current: index + 1,
                total,
                file_name: file.name.clone(),
                status: "classified".to_string(),
                thinking: None,
                category: Some(rule_cat.clone()),
            });
            (rule_cat, rule_reason, rule_method)
        };

        results.push(ScanResult {
            name: file.name,
            path: file.path,
            size: file.size,
            extension: file.extension,
            category,
            sub_folder: None, // 稍后填充
            reason,
            method,
        });
    }

    // 第二阶段：相似度分组
    let _ = window.emit("scan-progress", ScanProgressEvent {
        current: total,
        total,
        file_name: "正在分析文件相似度...".to_string(),
        status: "grouping".to_string(),
        thinking: None,
        category: None,
    });

    let file_categories: Vec<(String, String)> = results
        .iter()
        .map(|r| (r.path.clone(), r.category.clone()))
        .collect();
    
    let sub_folders = group_similar_files(&file_categories);
    
    // 更新子文件夹信息
    for result in &mut results {
        if let Some(sub) = sub_folders.get(&result.path) {
            result.sub_folder = sub.clone();
        }
    }

    // 第三阶段：组级复用（多数投票统一相似组的分类，提升一致性）
    apply_group_majority(&mut results);

    Ok(results)
}

fn classify_by_rules(file: &FileItem, categories: &[Category]) -> (String, String, String) {
    // 1) 扩展名命中
    let ext_lower = file.extension.to_lowercase();
    if !ext_lower.is_empty() {
        for cat in categories {
            if cat.extensions.iter().any(|e| e.to_lowercase() == ext_lower) {
                return (cat.name.clone(), "基于扩展名规则".to_string(), "rule".to_string());
            }
        }
    }

    // 2) 文件名关键词命中
    let name_lower = file.name.to_lowercase();
    for cat in categories {
        for kw in &cat.keywords {
            let kw_lower = kw.to_lowercase();
            if !kw_lower.is_empty() && name_lower.contains(&kw_lower) {
                return (cat.name.clone(), format!("文件名包含关键词：{}", kw), "rule".to_string());
            }
        }
    }

    // 3) 目录名强提示（仅当规则未命中时使用；偏向速度/成本优先）
    if let Some(dir_cat) = classify_by_directory_hint(&file.path, categories) {
        return (dir_cat, "基于目录名提示规则".to_string(), "rule".to_string());
    }

    ("其他".to_string(), "规则未命中".to_string(), "rule".to_string())
}

fn classify_by_directory_hint(file_path: &str, categories: &[Category]) -> Option<String> {
    let parent_name = Path::new(file_path)
        .parent()
        .and_then(|p| p.file_name())
        .map(|s| s.to_string_lossy().to_lowercase())?;

    // Screenshots / 截图
    let screenshot_hints = [
        "screenshots",
        "screenshot",
        "screen shots",
        "截图",
        "屏幕截图",
        "截屏",
    ];
    if screenshot_hints.iter().any(|h| parent_name.contains(h)) {
        if let Some(cat) = categories.iter().find(|c| c.name == "图片") {
            return Some(cat.name.clone());
        }
    }

    // Screen recordings / 录屏
    let recording_hints = [
        "screen recordings",
        "screen recording",
        "recordings",
        "录屏",
        "屏幕录制",
        "录制",
    ];
    if recording_hints.iter().any(|h| parent_name.contains(h)) {
        if let Some(cat) = categories.iter().find(|c| c.name == "视频") {
            return Some(cat.name.clone());
        }
    }

    // Camera photos / 相机
    let photo_hints = ["dcim", "camera", "photos", "相机", "照片"];
    if photo_hints.iter().any(|h| parent_name.contains(h)) {
        if let Some(cat) = categories.iter().find(|c| c.name == "图片") {
            return Some(cat.name.clone());
        }
    }

    None
}

#[cfg(test)]
mod main_tests {
    use super::classify_by_rules;
    use super::Category;
    use crate::organizer::FileItem;

    fn minimal_categories() -> Vec<Category> {
        vec![
            Category { name: "图片".to_string(), icon: "🖼️".to_string(), extensions: vec![".png".to_string()], keywords: vec!["截图".to_string()] },
            Category { name: "视频".to_string(), icon: "🎬".to_string(), extensions: vec![".mp4".to_string()], keywords: vec!["录屏".to_string()] },
            Category { name: "其他".to_string(), icon: "📁".to_string(), extensions: vec![], keywords: vec![] },
        ]
    }

    #[test]
    fn directory_hint_classifies_screenshots_as_images() {
        let cats = minimal_categories();
        let file = FileItem {
            name: "IMG_0001".to_string(),
            path: "/Users/me/Screenshots/IMG_0001".to_string(),
            size: 1,
            extension: "".to_string(),
        };

        let (cat, _reason, method) = classify_by_rules(&file, &cats);
        assert_eq!(cat, "图片");
        assert_eq!(method, "rule");
    }
}

fn is_hard_case(file: &FileItem, rule_category: &str, categories: &[Category]) -> bool {
    // 疑难条件（速度/成本优先：宁可少问 AI）
    if rule_category == "其他" {
        return true;
    }

    let ext = file.extension.to_lowercase();
    if ext.is_empty() {
        return true;
    }

    // “多义扩展名”集合：尽量不要靠规则强行判定
    let ambiguous = [
        ".bin", ".dat", ".tmp", ".log", ".bak", ".cache", ".part", ".download", ".crdownload",
    ];
    if ambiguous.iter().any(|e| *e == ext) {
        return true;
    }

    // 如果扩展名没在任何分类里出现，也算疑难（可能需要 AI）
    let ext_known = categories
        .iter()
        .any(|c| c.extensions.iter().any(|e| e.to_lowercase() == ext));
    if !ext_known {
        return true;
    }

    false
}

fn apply_group_majority(results: &mut [ScanResult]) {
    // group key: (category, sub_folder) is too late because category is what we might change.
    // We group by subFolder only; None means no group.
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

        // Count categories, ignore "其他" to avoid locking in unknown.
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
                // Only downgrade method to group when it wasn't AI (AI should remain explicit)
                if results[i].method != "ai" {
                    results[i].method = "group".to_string();
                }
            }
        }
    }
}

#[tauri::command]
async fn organize_files(
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
async fn scan_folders_cmd(
    directory: String,
    categories: Vec<Category>,
) -> Result<Vec<FolderItem>, String> {
    scan_folders(&directory, &categories).map_err(|e| e.to_string())
}

#[tauri::command]
async fn organize_folders(
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
async fn undo_organize(records: Vec<MoveRecord>) -> Result<Vec<String>, String> {
    undo_moves(&records).map_err(|e| e.to_string())
}

#[tauri::command]
fn find_duplicates_cmd(
    window: Window,
    directory: String,
    recursive: bool,
    exclude_patterns: Vec<String>,
) -> Result<Vec<DuplicateGroup>, String> {
    duplicates::find_duplicates(&directory, recursive, &exclude_patterns, |cur, total| {
        let _ = window.emit(
            "duplicate-scan-progress",
            DuplicateScanProgress { current: cur, total },
        );
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn watch_set_paths(paths: Vec<String>, app: AppHandle, state: State<WatchManager>) -> Result<(), String> {
    state.restart(app, paths);
    Ok(())
}

// ── Deep Clean (Mole integration) ──

#[tauri::command]
async fn mole_check() -> deepclean::MoleStatus {
    deepclean::check_mole().await
}

fn main() {
    tauri::Builder::default()
        .manage(WatchManager::default())
        .manage(pty::PtyManager::new())
        .invoke_handler(tauri::generate_handler![
            check_ollama,
            test_api_connection,
            scan_directory,
            organize_files,
            scan_folders_cmd,
            organize_folders,
            undo_organize,
            find_duplicates_cmd,
            watch_set_paths,
            mole_check,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
