use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

/// 解析为绝对、规范化路径（Windows 下可统一大小写与 `\\?\` 长路径前缀，减少「同一路径不同字符串」问题）
fn resolve_existing_dir(directory: &str) -> Result<PathBuf, std::io::Error> {
    let p = Path::new(directory);
    if !p.exists() || !p.is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "目录不存在",
        ));
    }
    fs::canonicalize(p)
}

/// `path` 是否等于 `base` 或位于其下（Windows 下按组件比较且忽略大小写，避免 `starts_with` 误判）
fn path_is_within(base: &Path, path: &Path) -> bool {
    let b: Vec<_> = base.components().collect();
    let p: Vec<_> = path.components().collect();
    if p.len() < b.len() {
        return false;
    }
    for i in 0..b.len() {
        if !path_component_eq(&b[i], &p[i]) {
            return false;
        }
    }
    true
}

fn path_component_eq(a: &std::path::Component<'_>, b: &std::path::Component<'_>) -> bool {
    #[cfg(windows)]
    {
        a.as_os_str().to_string_lossy().to_lowercase() == b.as_os_str().to_string_lossy().to_lowercase()
    }
    #[cfg(not(windows))]
    {
        a == b
    }
}

/// 分类/子文件夹名在 Windows 上不能含 <>:"/\|?* 等；禁止 `.` / `..`；避免保留设备名。
fn sanitize_segment(raw: &str) -> Option<String> {
    let t = raw.trim();
    if t.is_empty() || t == "." || t == ".." {
        return None;
    }
    let invalid = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
    let mut out = String::new();
    for c in t.chars() {
        if c < ' ' || invalid.contains(&c) {
            out.push('_');
        } else {
            out.push(c);
        }
    }
    let out = out.trim_end_matches('.').trim().to_string();
    if out.is_empty() {
        return None;
    }
    let upper: String = out.chars().map(|c| c.to_ascii_uppercase()).collect();
    const RESERVED: &[&str] = &[
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
        "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    if RESERVED.iter().any(|r| upper == *r) {
        return Some(format!("_{}", out));
    }
    Some(out)
}

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

/// 将常见 I/O 失败归类为带标签的说明（权限 / 占用 / 路径 / 云盘占位 / 其他），便于用户排查。
pub fn classify_io_error_msg(e: &std::io::Error) -> String {
    let detail = e.to_string();
    #[cfg(windows)]
    {
        if let Some(code) = e.raw_os_error() {
            match code {
                5 => {
                    return format!("[权限] 拒绝访问（Access denied）— {detail}");
                }
                32 | 33 => {
                    return format!("[占用] 文件正被使用或已锁定 — {detail}");
                }
                145 => {
                    return format!("[占用] 目录非空或无法删除 — {detail}");
                }
                2 => {
                    return format!("[路径] 找不到文件 — {detail}");
                }
                3 => {
                    return format!("[路径] 找不到路径 — {detail}");
                }
                123 | 161 => {
                    return format!("[路径] 文件名或路径非法 — {detail}");
                }
                206 => {
                    return format!("[路径] 文件名或扩展名过长 — {detail}");
                }
                // ERROR_CLOUD_FILE_NOT_AVAILABLE — OneDrive 等「仅联机」常见
                362 => {
                    return format!(
                        "[云盘] 仅联机或云文件尚未就绪（可在资源管理器中打开本文件以下载）— {detail}"
                    );
                }
                _ => {}
            }
        }
    }
    #[cfg(unix)]
    {
        if let Some(code) = e.raw_os_error() {
            match code {
                1 | 13 => {
                    return format!("[权限] 无权限 — {detail}");
                }
                2 => {
                    return format!("[路径] 找不到文件 — {detail}");
                }
                16 | 26 => {
                    return format!("[占用] 资源忙或文件被占用 — {detail}");
                }
                36 => {
                    return format!("[路径] 路径过长 — {detail}");
                }
                _ => {}
            }
        }
    }
    match e.kind() {
        ErrorKind::PermissionDenied => format!("[权限] {detail}"),
        ErrorKind::NotFound => format!("[路径] 不存在 — {detail}"),
        ErrorKind::AlreadyExists => format!("[冲突] 已存在 — {detail}"),
        ErrorKind::InvalidInput => format!("[参数] 无效输入 — {detail}"),
        _ => format!("[其他] {detail}"),
    }
}

fn format_path_io_error(path: &str, e: &std::io::Error) -> String {
    format!("{} — {}", path, classify_io_error_msg(e))
}

fn sanitize_backup_session_id(s: &str) -> String {
    let t: String = s
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .take(80)
        .collect();
    if t.is_empty() {
        "backup".to_string()
    } else {
        t
    }
}

/// 将 `source`（须在 `base` 下）复制到 `backup_root/<session>/相对路径`（文件或整个文件夹）。
fn copy_to_backup(base: &Path, source: &Path, backup_root: &Path, session: &str) -> Result<(), std::io::Error> {
    let sid = sanitize_backup_session_id(session);
    let rel = source.strip_prefix(base).map_err(|_| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "path not under base directory")
    })?;
    let dest = backup_root.join(&sid).join(rel);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }
    if source.is_dir() {
        copy_dir_recursive(source, &dest)?;
    } else {
        fs::copy(source, &dest)?;
    }
    Ok(())
}

/// 备份根目录不得位于待整理目录之内，避免把备份写进即将被打乱的目录树。
fn validate_backup_root(base: &Path, backup_root: &Path) -> Result<(), std::io::Error> {
    if base == backup_root || path_is_within(base, backup_root) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "备份目录不能位于待整理文件夹内部",
        ));
    }
    Ok(())
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

/// 路径是否命中排除规则（子串匹配，不区分大小写）
pub fn path_matches_exclude(path: &Path, patterns: &[String]) -> bool {
    if patterns.is_empty() {
        return false;
    }
    let normalized = path.to_string_lossy().replace('\\', "/").to_lowercase();
    for pat in patterns {
        let p = pat.trim();
        if p.is_empty() {
            continue;
        }
        if normalized.contains(&p.to_lowercase()) {
            return true;
        }
    }
    false
}

/// `recursive == false` 时仅扫描当前目录下直接文件；为 true 时递归子目录内所有文件。
pub fn scan_files(
    directory: &str,
    show_temp_files: bool,
    recursive: bool,
    exclude_patterns: &[String],
) -> Result<Vec<FileItem>, std::io::Error> {
    let mut files = Vec::new();
    let path = Path::new(directory);

    if !path.exists() || !path.is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "目录不存在",
        ));
    }

    let walker = WalkDir::new(path).min_depth(1);
    let walker = if recursive {
        walker
    } else {
        walker.max_depth(1)
    };

    for entry in walker.into_iter().filter_map(|e| e.ok()) {
        let entry_path = entry.path();

        if !entry_path.is_file() {
            continue;
        }

        if path_matches_exclude(entry_path, exclude_patterns) {
            continue;
        }

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

/// 整理结果：成功的移动 + 每项失败原因（不再因单项失败而回滚已成功项）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrganizeOutcome {
    pub moves: Vec<MoveRecord>,
    pub errors: Vec<String>,
}

/// 移动文件夹到对应分类目录（单项失败仅记录，不影响已成功项）
/// `dry_run` 为 true 时不创建目录、不移动，仅返回计划中的 `moves`。
/// `on_progress`：`(当前序号, 总数, 当前路径)`，在每一轮处理开始前调用。
pub fn move_folders<F>(
    directory: &str,
    folders: &[FolderItem],
    dry_run: bool,
    backup_root: Option<&Path>,
    backup_session_id: Option<&str>,
    mut on_progress: F,
) -> Result<OrganizeOutcome, std::io::Error>
where
    F: FnMut(usize, usize, &str),
{
    let base_path = resolve_existing_dir(directory)?;
    let backup_plan: Option<(PathBuf, String)> = if dry_run {
        None
    } else {
        match (backup_root, backup_session_id) {
            (Some(br), Some(sid)) if !br.as_os_str().is_empty() && !sid.trim().is_empty() => {
                let p = fs::canonicalize(br)?;
                if !p.is_dir() {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::NotFound,
                        "备份目录不存在或不是文件夹",
                    ));
                }
                validate_backup_root(&base_path, &p)?;
                Some((p, sid.to_string()))
            }
            _ => None,
        }
    };
    let total = folders.len().max(1);
    let mut moves: Vec<MoveRecord> = Vec::new();
    let mut errors: Vec<String> = Vec::new();

    for (i, folder) in folders.iter().enumerate() {
        on_progress(i + 1, total, folder.path.as_str());
        if folder.category.is_empty() || folder.category == "其他" {
            continue;
        }
        if folder.name == folder.category {
            continue;
        }

        let Some(cat) = sanitize_segment(&folder.category) else {
            errors.push(format!("{}: 分类名无效，已跳过", folder.path));
            continue;
        };

        let source = Path::new(&folder.path);
        if !source.exists() {
            errors.push(format!("{}: 源文件夹不存在", folder.path));
            continue;
        }
        let source = match fs::canonicalize(source) {
            Ok(p) => p,
            Err(e) => {
                errors.push(format_path_io_error(&folder.path, &e));
                continue;
            }
        };
        if !path_is_within(&base_path, &source) {
            errors.push(format!("{}: 不在所选目录内", folder.path));
            continue;
        }

        let category_dir = base_path.join(&cat);
        if source == category_dir
            || path_is_within(&category_dir, &source)
            || path_is_within(&source, &category_dir)
        {
            continue;
        }

        if !dry_run && !category_dir.exists() {
            if let Err(e) = fs::create_dir_all(&category_dir) {
                errors.push(format!(
                    "{} — 创建分类目录失败：{}",
                    folder.path,
                    classify_io_error_msg(&e)
                ));
                continue;
            }
        }

        let mut target = category_dir.join(&folder.name);
        let mut counter = 1;
        while target.exists() {
            target = category_dir.join(format!("{}_{}", folder.name, counter));
            counter += 1;
        }

        if dry_run {
            moves.push(MoveRecord {
                from: source.to_string_lossy().to_string(),
                to: target.to_string_lossy().to_string(),
            });
            continue;
        }

        if let Some((ref br, ref sid)) = backup_plan {
            if let Err(e) = copy_to_backup(&base_path, &source, br, sid.as_str()) {
                errors.push(format!(
                    "{} — 备份失败，已跳过移动：{}",
                    folder.path,
                    classify_io_error_msg(&e)
                ));
                continue;
            }
        }

        if let Err(e) = safe_move(&source, &target) {
            errors.push(format_path_io_error(&folder.path, &e));
            continue;
        }
        moves.push(MoveRecord {
            from: source.to_string_lossy().to_string(),
            to: target.to_string_lossy().to_string(),
        });
    }

    Ok(OrganizeOutcome { moves, errors })
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

/// `dry_run` 为 true 时不创建目录、不移动，仅返回计划中的 `moves`。
/// `on_progress`：`(当前序号, 总数, 当前路径)`，在每一轮处理开始前调用。
pub fn move_files<F>(
    directory: &str,
    _files: &[FileItem],
    categories: &[(String, String, Option<String>)], // (path, category, sub_folder)
    dry_run: bool,
    backup_root: Option<&Path>,
    backup_session_id: Option<&str>,
    mut on_progress: F,
) -> Result<OrganizeOutcome, std::io::Error>
where
    F: FnMut(usize, usize, &str),
{
    let base_path = resolve_existing_dir(directory)?;
    let backup_plan: Option<(PathBuf, String)> = if dry_run {
        None
    } else {
        match (backup_root, backup_session_id) {
            (Some(br), Some(sid)) if !br.as_os_str().is_empty() && !sid.trim().is_empty() => {
                let p = fs::canonicalize(br)?;
                if !p.is_dir() {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::NotFound,
                        "备份目录不存在或不是文件夹",
                    ));
                }
                validate_backup_root(&base_path, &p)?;
                Some((p, sid.to_string()))
            }
            _ => None,
        }
    };
    let total = categories.len().max(1);
    let mut moves: Vec<MoveRecord> = Vec::new();
    let mut errors: Vec<String> = Vec::new();

    for (i, (file_path, category, sub_folder)) in categories.iter().enumerate() {
        on_progress(i + 1, total, file_path.as_str());
        if category.is_empty() {
            continue;
        }

        let Some(cat) = sanitize_segment(category) else {
            errors.push(format!("{}: 分类名无效，已跳过", file_path));
            continue;
        };

        let source = Path::new(file_path);
        if !source.exists() {
            errors.push(format!("{}: 源文件不存在", file_path));
            continue;
        }
        let source = match fs::canonicalize(source) {
            Ok(p) => p,
            Err(e) => {
                errors.push(format_path_io_error(file_path, &e));
                continue;
            }
        };
        if !path_is_within(&base_path, &source) {
            errors.push(format!("{}: 不在所选目录内", file_path));
            continue;
        }

        let category_dir = if let Some(sub) = sub_folder {
            if let Some(s) = sanitize_segment(sub) {
                base_path.join(&cat).join(&s)
            } else {
                base_path.join(&cat)
            }
        } else {
            base_path.join(&cat)
        };

        if !dry_run && !category_dir.exists() {
            if let Err(e) = fs::create_dir_all(&category_dir) {
                errors.push(format!(
                    "{} — 创建分类目录失败：{}",
                    file_path,
                    classify_io_error_msg(&e)
                ));
                continue;
            }
        }

        let file_name = match source.file_name() {
            Some(n) => n,
            None => {
                errors.push(format!("{}: 无效的文件名", file_path));
                continue;
            }
        };

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

        if dry_run {
            moves.push(MoveRecord {
                from: source.to_string_lossy().to_string(),
                to: target.to_string_lossy().to_string(),
            });
            continue;
        }

        if let Some((ref br, ref sid)) = backup_plan {
            if let Err(e) = copy_to_backup(&base_path, &source, br, sid.as_str()) {
                errors.push(format!(
                    "{} — 备份失败，已跳过移动：{}",
                    file_path,
                    classify_io_error_msg(&e)
                ));
                continue;
            }
        }

        if let Err(e) = safe_move(&source, &target) {
            errors.push(format_path_io_error(file_path, &e));
            continue;
        }
        moves.push(MoveRecord {
            from: source.to_string_lossy().to_string(),
            to: target.to_string_lossy().to_string(),
        });
    }

    Ok(OrganizeOutcome { moves, errors })
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
            errors.push(format!(
                "{} → {} — {}",
                rec.to,
                rec.from,
                classify_io_error_msg(&e)
            ));
        }
    }
    Ok(errors)
}

#[cfg(test)]
mod tests {
    use super::{classify_io_error_msg, group_similar_files, sanitize_segment};

    #[test]
    fn sanitize_segment_strips_windows_invalid_chars() {
        assert_eq!(sanitize_segment("图片").as_deref(), Some("图片"));
        assert_eq!(sanitize_segment("a:b").as_deref(), Some("a_b"));
        assert_eq!(sanitize_segment(".."), None);
        assert_eq!(sanitize_segment("CON").as_deref(), Some("_CON"));
    }

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

    #[cfg(unix)]
    #[test]
    fn classify_io_maps_unix_eacces() {
        let e = std::io::Error::from_raw_os_error(13);
        assert!(classify_io_error_msg(&e).contains("[权限]"));
    }

    #[cfg(windows)]
    #[test]
    fn classify_io_maps_windows_access_denied() {
        let e = std::io::Error::from_raw_os_error(5);
        assert!(classify_io_error_msg(&e).contains("[权限]"));
    }

    #[cfg(windows)]
    #[test]
    fn classify_io_maps_cloud_placeholder_code() {
        let e = std::io::Error::from_raw_os_error(362);
        assert!(classify_io_error_msg(&e).contains("[云盘]"));
    }
}
