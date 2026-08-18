use crate::organizer::{Category, FileItem};
use std::path::Path;

pub fn classify_by_rules(file: &FileItem, categories: &[Category]) -> (String, String, String) {
    let extension = file.extension.to_lowercase();
    if !extension.is_empty() {
        for category in categories {
            if category
                .extensions
                .iter()
                .any(|candidate| candidate.to_lowercase() == extension)
            {
                return (
                    category.name.clone(),
                    "基于扩展名规则".to_string(),
                    "rule".to_string(),
                );
            }
        }
    }

    let name = file.name.to_lowercase();
    for category in categories {
        for keyword in &category.keywords {
            let candidate = keyword.to_lowercase();
            if !candidate.is_empty() && name.contains(&candidate) {
                return (
                    category.name.clone(),
                    format!("文件名包含关键词：{}", keyword),
                    "rule".to_string(),
                );
            }
        }
    }

    if let Some(category) = classify_by_directory_hint(&file.path, categories) {
        return (
            category,
            "基于目录名提示规则".to_string(),
            "rule".to_string(),
        );
    }

    (
        "其他".to_string(),
        "规则未命中".to_string(),
        "rule".to_string(),
    )
}

fn classify_by_directory_hint(file_path: &str, categories: &[Category]) -> Option<String> {
    let parent_name = Path::new(file_path)
        .parent()
        .and_then(|parent| parent.file_name())
        .map(|name| name.to_string_lossy().to_lowercase())?;

    let screenshot_hints = [
        "screenshots",
        "screenshot",
        "screen shots",
        "截图",
        "屏幕截图",
        "截屏",
    ];
    if screenshot_hints
        .iter()
        .any(|hint| parent_name.contains(hint))
    {
        if let Some(category) = categories.iter().find(|category| category.name == "图片") {
            return Some(category.name.clone());
        }
    }

    let recording_hints = [
        "screen recordings",
        "screen recording",
        "recordings",
        "录屏",
        "屏幕录制",
        "录制",
    ];
    if recording_hints
        .iter()
        .any(|hint| parent_name.contains(hint))
    {
        if let Some(category) = categories.iter().find(|category| category.name == "视频") {
            return Some(category.name.clone());
        }
    }

    let photo_hints = ["dcim", "camera", "photos", "相机", "照片"];
    if photo_hints.iter().any(|hint| parent_name.contains(hint)) {
        if let Some(category) = categories.iter().find(|category| category.name == "图片") {
            return Some(category.name.clone());
        }
    }

    None
}

pub fn is_hard_case(file: &FileItem, rule_category: &str, categories: &[Category]) -> bool {
    if rule_category == "其他" {
        return true;
    }

    let extension = file.extension.to_lowercase();
    if extension.is_empty() {
        return true;
    }

    let ambiguous = [
        ".bin",
        ".dat",
        ".tmp",
        ".log",
        ".bak",
        ".cache",
        ".part",
        ".download",
        ".crdownload",
    ];
    if ambiguous.iter().any(|candidate| *candidate == extension) {
        return true;
    }

    !categories.iter().any(|category| {
        category
            .extensions
            .iter()
            .any(|candidate| candidate.to_lowercase() == extension)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn minimal_categories() -> Vec<Category> {
        vec![
            Category {
                name: "图片".to_string(),
                icon: "🖼️".to_string(),
                extensions: vec![".png".to_string()],
                keywords: vec!["截图".to_string()],
            },
            Category {
                name: "视频".to_string(),
                icon: "🎬".to_string(),
                extensions: vec![".mp4".to_string()],
                keywords: vec!["录屏".to_string()],
            },
            Category {
                name: "其他".to_string(),
                icon: "📁".to_string(),
                extensions: vec![],
                keywords: vec![],
            },
        ]
    }

    #[test]
    fn directory_hint_classifies_screenshots_as_images() {
        let categories = minimal_categories();
        let file = FileItem {
            name: "IMG_0001".to_string(),
            path: "/Users/me/Screenshots/IMG_0001".to_string(),
            size: 1,
            extension: "".to_string(),
        };

        let (category, _reason, method) = classify_by_rules(&file, &categories);
        assert_eq!(category, "图片");
        assert_eq!(method, "rule");
    }
}
