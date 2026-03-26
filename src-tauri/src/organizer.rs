use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use walkdir::WalkDir;

/// Move a file or directory, falling back to recursive copy + delete when
/// `fs::rename` fails (e.g. cross-device moves returning EXDEV).
fn safe_move(from: &Path, to: &Path) -> Result<(), std::io::Error> {
    match fs::rename(from, to) {
        Ok(()) => Ok(()),
        Err(e) if is_cross_device(&e) => {
            if from.is_dir() {
                copy_dir_recursive(from, to)?;
            } else {
                fs::copy(from, to)?;
            }
            if from.is_dir() {
                fs::remove_dir_all(from)?;
            } else {
                fs::remove_file(from)?;
            }
            Ok(())
        }
        Err(e) => Err(e),
    }
}

fn is_cross_device(e: &std::io::Error) -> bool {
    if let Some(code) = e.raw_os_error() {
        #[cfg(unix)]
        { return code == 18; } // EXDEV
        #[cfg(windows)]
        { return code == 17; } // ERROR_NOT_SAME_DEVICE
    }
    false
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), std::io::Error> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let target = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_recursive(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileItem {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub extension: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderItem {
    pub name: String,
    pub path: String,
    pub category: String,
    #[serde(rename = "fileCount")]
    pub file_count: usize,
    #[serde(rename = "totalSize")]
    pub total_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Category {
    pub name: String,
    pub icon: String,
    pub extensions: Vec<String>,
    pub keywords: Vec<String>,
}

pub fn scan_files(directory: &str, show_temp_files: bool) -> Result<Vec<FileItem>, std::io::Error> {
    let mut files = Vec::new();
    let path = Path::new(directory);

    if !path.exists() || !path.is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "目录不存在",
        ));
    }

    for entry in WalkDir::new(path).max_depth(1).into_iter().filter_map(|e| e.ok()) {
        let entry_path = entry.path();
        
        if entry_path == path {
            continue;
        }

        if entry_path.is_file() {
            let name = entry_path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();

            // 跳过系统文件
            if name == "desktop.ini" || name == "Thumbs.db" || name == ".DS_Store" {
                continue;
            }

            // 跳过隐藏文件（以 . 开头，但不是临时文件）
            if name.starts_with('.') && !name.starts_with(".~") && !name.starts_with("._") {
                continue;
            }

            // 检查是否为临时/缓存文件
            let is_temp_file = is_temporary_file(&name);
            
            // 如果不显示临时文件且当前是临时文件，跳过
            if !show_temp_files && is_temp_file {
                continue;
            }

            let extension = entry_path
                .extension()
                .map(|e| format!(".{}", e.to_string_lossy()))
                .unwrap_or_default();

            let metadata = entry_path.metadata()?;

            files.push(FileItem {
                name,
                path: entry_path.to_string_lossy().to_string(),
                size: metadata.len(),
                extension,
            });
        }
    }

    Ok(files)
}

/// 判断是否为临时/缓存文件
fn is_temporary_file(name: &str) -> bool {
    let name_lower = name.to_lowercase();
    
    // Office 临时文件
    if name.starts_with(".~") || name.starts_with("~$") || name.starts_with("._") {
        return true;
    }
    
    // 常见临时文件扩展名
    if name_lower.ends_with(".tmp") || 
       name_lower.ends_with(".temp") ||
       name_lower.ends_with(".bak") ||
       name_lower.ends_with(".swp") ||
       name_lower.ends_with(".swo") ||
       name_lower.ends_with(".cache") ||
       name_lower.ends_with(".log") {
        return true;
    }
    
    // macOS 临时文件
    if name == ".localized" || name.starts_with("._") {
        return true;
    }
    
    false
}

/// 扫描子文件夹并分类
pub fn scan_folders(directory: &str, categories: &[Category]) -> Result<Vec<FolderItem>, std::io::Error> {
    let mut folders = Vec::new();
    let path = Path::new(directory);

    if !path.exists() || !path.is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "目录不存在",
        ));
    }

    for entry in WalkDir::new(path).max_depth(1).into_iter().filter_map(|e| e.ok()) {
        let entry_path = entry.path();
        
        if entry_path == path {
            continue;
        }

        if entry_path.is_dir() {
            let name = entry_path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();

            // 跳过隐藏文件夹和系统文件夹
            if name.starts_with('.') || name == "node_modules" || name == "__pycache__" {
                continue;
            }

            // 统计文件夹内容
            let (file_count, total_size, extensions) = analyze_folder_contents(entry_path);
            
            // 根据内容分类文件夹
            let category = classify_folder(&name, &extensions, categories);

            folders.push(FolderItem {
                name,
                path: entry_path.to_string_lossy().to_string(),
                category,
                file_count,
                total_size,
            });
        }
    }

    Ok(folders)
}

/// 分析文件夹内容，返回 (文件数, 总大小, 扩展名统计)
fn analyze_folder_contents(folder_path: &Path) -> (usize, u64, HashMap<String, usize>) {
    let mut file_count = 0;
    let mut total_size = 0u64;
    let mut extensions: HashMap<String, usize> = HashMap::new();

    for entry in WalkDir::new(folder_path).into_iter().filter_map(|e| e.ok()) {
        if entry.path().is_file() {
            file_count += 1;
            if let Ok(metadata) = entry.metadata() {
                total_size += metadata.len();
            }
            if let Some(ext) = entry.path().extension() {
                let ext_str = format!(".{}", ext.to_string_lossy().to_lowercase());
                *extensions.entry(ext_str).or_insert(0) += 1;
            }
        }
    }

    (file_count, total_size, extensions)
}

/// 根据文件夹名称和内容分类
fn classify_folder(name: &str, extensions: &HashMap<String, usize>, categories: &[Category]) -> String {
    let name_lower = name.to_lowercase();
    
    // 首先检查文件夹名称是否匹配关键词
    for cat in categories {
        for keyword in &cat.keywords {
            if name_lower.contains(&keyword.to_lowercase()) {
                return cat.name.clone();
            }
        }
    }
    
    // 然后根据内容中最多的扩展名类型分类
    if !extensions.is_empty() {
        let mut category_counts: HashMap<String, usize> = HashMap::new();
        
        for (ext, count) in extensions {
            for cat in categories {
                if cat.extensions.iter().any(|e| e.to_lowercase() == *ext) {
                    *category_counts.entry(cat.name.clone()).or_insert(0) += count;
                    break;
                }
            }
        }
        
        // 找出文件数最多的分类
        if let Some((category, _)) = category_counts.into_iter().max_by_key(|(_, count)| *count) {
            return category;
        }
    }
    
    "其他".to_string()
}

/// 一次成功的移动操作记录
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MoveRecord {
    pub from: String,
    pub to: String,
}

/// 移动文件夹到对应分类目录（带回滚：出错时自动还原已移动项）
pub fn move_folders(directory: &str, folders: &[FolderItem]) -> Result<Vec<MoveRecord>, std::io::Error> {
    let base_path = Path::new(directory);
    let mut done: Vec<MoveRecord> = Vec::new();

    let result = (|| -> Result<(), std::io::Error> {
        for folder in folders {
            if folder.category.is_empty() || folder.category == "其他" {
                continue;
            }
            if folder.name == folder.category {
                continue;
            }

            let source = Path::new(&folder.path);
            if !source.exists() {
                continue;
            }

            let category_dir = base_path.join(&folder.category);
            if source == category_dir || source.starts_with(&category_dir) || category_dir.starts_with(source) {
                continue;
            }

            if !category_dir.exists() {
                fs::create_dir_all(&category_dir)?;
            }

            let mut target = category_dir.join(&folder.name);
            let mut counter = 1;
            while target.exists() {
                target = category_dir.join(format!("{}_{}", folder.name, counter));
                counter += 1;
            }

            safe_move(source, &target)?;
            done.push(MoveRecord {
                from: source.to_string_lossy().to_string(),
                to: target.to_string_lossy().to_string(),
            });
        }
        Ok(())
    })();

    if let Err(e) = result {
        rollback_moves(&done);
        return Err(e);
    }

    Ok(done)
}

/// 提取文件名的基础部分（去除数字后缀、日期等）
pub fn extract_base_name(filename: &str) -> String {
    // 去掉扩展名
    let name_without_ext = Path::new(filename)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| filename.to_string());
    
    // 移除常见的数字后缀模式
    let patterns = [
        // 日期时间模式
        r"[-_]?\d{4}[-_]?\d{2}[-_]?\d{2}[-_T]?\d{0,6}",
        // 序号模式
        r"[-_\s]?\(?\d+\)?$",
        r"[-_]\d+$",
        // 版本号
        r"[-_]?v\d+(\.\d+)*",
        // 时间戳
        r"[-_]?\d{10,13}$",
        // 截图模式
        r"[-_]?screenshot[-_]?\d*",
        r"[-_]?屏幕截图[-_]?\d*",
        // UUID 部分
        r"[-_]?[a-f0-9]{8}(-[a-f0-9]{4}){0,3}",
    ];
    
    let mut result = name_without_ext.to_lowercase();
    
    for pattern in patterns {
        if let Ok(re) = regex::Regex::new(pattern) {
            result = re.replace_all(&result, "").to_string();
        }
    }
    
    // 清理多余的分隔符
    let result = result.trim_matches(|c| c == '-' || c == '_' || c == ' ');
    
    // 如果结果太短，返回原始名称的前缀
    if result.len() < 2 {
        return name_without_ext.chars().take(10).collect::<String>().to_lowercase();
    }
    
    result.to_string()
}

/// 计算两个字符串的相似度 (0.0 - 1.0)
pub fn similarity(s1: &str, s2: &str) -> f64 {
    if s1 == s2 {
        return 1.0;
    }
    if s1.is_empty() || s2.is_empty() {
        return 0.0;
    }
    
    let s1_lower = s1.to_lowercase();
    let s2_lower = s2.to_lowercase();
    
    // 检查是否有共同前缀
    let common_prefix_len = s1_lower
        .chars()
        .zip(s2_lower.chars())
        .take_while(|(a, b)| a == b)
        .count();
    
    let max_len = s1.len().max(s2.len());
    let prefix_ratio = common_prefix_len as f64 / max_len as f64;
    
    // 如果共同前缀超过 50%，认为相似
    if prefix_ratio > 0.5 {
        return prefix_ratio;
    }
    
    // 使用 Levenshtein 距离的简化版本
    let distance = levenshtein_distance(&s1_lower, &s2_lower);
    let max_len = s1.len().max(s2.len()) as f64;
    
    1.0 - (distance as f64 / max_len)
}

/// 计算 Levenshtein 编辑距离
fn levenshtein_distance(s1: &str, s2: &str) -> usize {
    let s1_chars: Vec<char> = s1.chars().collect();
    let s2_chars: Vec<char> = s2.chars().collect();
    let len1 = s1_chars.len();
    let len2 = s2_chars.len();
    
    if len1 == 0 { return len2; }
    if len2 == 0 { return len1; }
    
    let mut matrix = vec![vec![0usize; len2 + 1]; len1 + 1];
    
    for i in 0..=len1 { matrix[i][0] = i; }
    for j in 0..=len2 { matrix[0][j] = j; }
    
    for i in 1..=len1 {
        for j in 1..=len2 {
            let cost = if s1_chars[i-1] == s2_chars[j-1] { 0 } else { 1 };
            matrix[i][j] = (matrix[i-1][j] + 1)
                .min(matrix[i][j-1] + 1)
                .min(matrix[i-1][j-1] + cost);
        }
    }
    
    matrix[len1][len2]
}

/// 对同一分类下的文件进行相似度分组，返回子文件夹名称
pub fn group_similar_files(files: &[(String, String)]) -> HashMap<String, Option<String>> {
    // files: Vec<(file_path, category)>
    // 返回: HashMap<file_path, Option<sub_folder>>
    
    let mut result: HashMap<String, Option<String>> = HashMap::new();
    
    // 按分类分组
    let mut by_category: HashMap<String, Vec<String>> = HashMap::new();
    for (path, category) in files {
        by_category.entry(category.clone()).or_default().push(path.clone());
    }
    
    // 对每个分类内的文件进行相似度分组
    for (_category, paths) in by_category {
        if paths.len() < 3 {
            // 文件太少，不分组
            for path in paths {
                result.insert(path, None);
            }
            continue;
        }
        
        // 提取基础名称
        let base_names: Vec<(String, String)> = paths
            .iter()
            .map(|p| {
                let filename = Path::new(p)
                    .file_name()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();
                (p.clone(), extract_base_name(&filename))
            })
            .collect();
        
        // 分组：相似的文件放在一起
        let mut groups: Vec<Vec<String>> = Vec::new();
        let mut assigned: Vec<bool> = vec![false; base_names.len()];
        
        for i in 0..base_names.len() {
            if assigned[i] {
                continue;
            }
            
            let mut group = vec![base_names[i].0.clone()];
            assigned[i] = true;
            
            for j in (i + 1)..base_names.len() {
                if assigned[j] {
                    continue;
                }
                
                // 检查相似度
                let sim = similarity(&base_names[i].1, &base_names[j].1);
                if sim > 0.6 {
                    group.push(base_names[j].0.clone());
                    assigned[j] = true;
                }
            }
            
            groups.push(group);
        }
        
        // 为每个组分配子文件夹名称
        for group in groups {
            if group.len() >= 3 {
                // 找到组内文件的共同基础名称
                let first_file = Path::new(&group[0])
                    .file_name()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();
                let base = extract_base_name(&first_file);
                
                // 生成子文件夹名称
                let sub_folder = if base.chars().count() > 20 {
                    let short_base: String = base.chars().take(20).collect();
                    format!("{}...", short_base)
                } else if base.is_empty() {
                    "相似文件".to_string()
                } else {
                    format!("{}_系列", base)
                };
                
                for path in group {
                    result.insert(path, Some(sub_folder.clone()));
                }
            } else {
                // 组太小，不创建子文件夹
                for path in group {
                    result.insert(path, None);
                }
            }
        }
    }
    
    result
}

pub fn move_files(
    directory: &str,
    _files: &[FileItem],
    categories: &[(String, String, Option<String>)], // (path, category, sub_folder)
) -> Result<Vec<MoveRecord>, std::io::Error> {
    let base_path = Path::new(directory);
    let mut done: Vec<MoveRecord> = Vec::new();

    let result = (|| -> Result<(), std::io::Error> {
        for (file_path, category, sub_folder) in categories {
            if category.is_empty() {
                continue;
            }

            let source = Path::new(file_path);
            if !source.exists() {
                continue;
            }

            let category_dir = if let Some(sub) = sub_folder {
                base_path.join(category).join(sub)
            } else {
                base_path.join(category)
            };

            if !category_dir.exists() {
                fs::create_dir_all(&category_dir)?;
            }

            let file_name = source
                .file_name()
                .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "无效的文件名"))?;

            let mut target = category_dir.join(file_name);

            let mut counter = 1;
            while target.exists() {
                let stem = source
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();
                let ext = source
                    .extension()
                    .map(|e| format!(".{}", e.to_string_lossy()))
                    .unwrap_or_default();
                target = category_dir.join(format!("{}_{}{}", stem, counter, ext));
                counter += 1;
            }

            safe_move(source, &target)?;
            done.push(MoveRecord {
                from: source.to_string_lossy().to_string(),
                to: target.to_string_lossy().to_string(),
            });
        }
        Ok(())
    })();

    if let Err(e) = result {
        rollback_moves(&done);
        return Err(e);
    }

    Ok(done)
}

/// 尽力逆向还原已移动的文件/文件夹（不抛出错误，仅日志）
fn rollback_moves(records: &[MoveRecord]) {
    for rec in records.iter().rev() {
        let to_path = Path::new(&rec.to);
        let from_path = Path::new(&rec.from);
        if to_path.exists() {
            if let Some(parent) = from_path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            if let Err(e) = safe_move(to_path, from_path) {
                eprintln!("[rollback] failed to restore {} -> {}: {}", rec.to, rec.from, e);
            }
        }
    }
}

/// 撤销一批移动操作（供前端 undo 调用）
pub fn undo_moves(records: &[MoveRecord]) -> Result<Vec<String>, std::io::Error> {
    let mut errors: Vec<String> = Vec::new();
    for rec in records.iter().rev() {
        let to_path = Path::new(&rec.to);
        let from_path = Path::new(&rec.from);
        if !to_path.exists() {
            errors.push(format!("文件不存在，无法撤销: {}", rec.to));
            continue;
        }
        if let Some(parent) = from_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Err(e) = safe_move(to_path, from_path) {
            errors.push(format!("{} -> {}: {}", rec.to, rec.from, e));
        }
    }
    Ok(errors)
}

#[cfg(test)]
mod tests {
    use super::group_similar_files;

    #[test]
    fn group_similar_files_handles_multibyte_names_without_panic() {
        let files = vec![
            (
                "/tmp/jimeng-镜头从手机屏幕画面快速向后拉远，屏幕中的k线和人脸迅速缩小并模糊。随后，画面平滑-01.mp4".to_string(),
                "视频".to_string(),
            ),
            (
                "/tmp/jimeng-镜头从手机屏幕画面快速向后拉远，屏幕中的k线和人脸迅速缩小并模糊。随后，画面平滑-02.mp4".to_string(),
                "视频".to_string(),
            ),
            (
                "/tmp/jimeng-镜头从手机屏幕画面快速向后拉远，屏幕中的k线和人脸迅速缩小并模糊。随后，画面平滑-03.mp4".to_string(),
                "视频".to_string(),
            ),
        ];

        let result = group_similar_files(&files);
        let key = files[0].0.clone();
        let sub = result.get(&key).and_then(|v| v.clone());

        assert!(sub.is_some());
        assert!(!sub.unwrap().is_empty());
    }
}
