use super::{
    summary::parse_clean_summary,
    types::{MoleCleanItem, MoleCleanPreview, MoleCleanSection},
};
use crate::mole_utils::{strip_ansi, unit_to_bytes};

pub(crate) fn parse_clean_preview(raw: &str) -> MoleCleanPreview {
    let clean = strip_ansi(raw).replace("\r\n", "\n").replace('\r', "\n");
    let mut sections = Vec::new();
    let mut current: Option<MoleCleanSection> = None;

    for line in clean.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.chars().all(|c| c == '=') {
            continue;
        }

        if let Some(title) = parse_clean_section_title(trimmed) {
            if let Some(section) = current.take() {
                sections.push(section);
            }
            current = Some(MoleCleanSection {
                title,
                items: Vec::new(),
            });
            continue;
        }

        if let Some(item) = parse_clean_item(trimmed) {
            if let Some(section) = current.as_mut() {
                section.items.push(item);
            }
        }
    }

    if let Some(section) = current {
        sections.push(section);
    }

    let summary = parse_clean_summary(&clean);

    MoleCleanPreview {
        potential_space: summary.potential_space,
        item_count: summary.item_count,
        category_count: summary.category_count,
        summary_status: summary.summary_status,
        scan_status: summary.scan_status,
        sections,
        raw_output: clean,
    }
}

fn parse_clean_section_title(line: &str) -> Option<String> {
    line.strip_prefix('➤')
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .map(ToString::to_string)
}

fn parse_clean_item(line: &str) -> Option<MoleCleanItem> {
    let status = match line.chars().next()? {
        '→' => "dry_run",
        '✓' => "ok",
        '◎' => "skipped",
        '☞' => "advice",
        '•' => "info",
        '↳' => "detail",
        _ => return None,
    };

    let label = line
        .char_indices()
        .nth(1)
        .map(|(idx, _)| line[idx..].trim())
        .unwrap_or("")
        .to_string();

    if label.is_empty() {
        return None;
    }

    let size = extract_clean_size(&label);
    let count = extract_clean_count(&label);

    Some(MoleCleanItem {
        label,
        size,
        count,
        status: status.to_string(),
    })
}

fn extract_clean_size(label: &str) -> Option<u64> {
    let patterns = [
        r"(?i)(?:at least|about|clean|would clean|Reclaimable:)\s*([0-9]+(?:\.[0-9]+)?)\s*([KMGT]?B)",
        r",\s*([0-9]+(?:\.[0-9]+)?)\s*([KMGT]?B)\s*dry",
        r"\b([0-9]+(?:\.[0-9]+)?)\s*([KMGT]?B)\s*dry",
    ];

    for pattern in patterns {
        let re = match regex::Regex::new(pattern) {
            Ok(re) => re,
            Err(_) => continue,
        };
        if let Some(caps) = re.captures(label) {
            let amount = caps.get(1)?.as_str().parse::<f64>().ok()?;
            let unit = caps.get(2)?.as_str();
            return Some(unit_to_bytes(amount, unit));
        }
    }

    None
}

fn extract_clean_count(label: &str) -> Option<u64> {
    let re = regex::Regex::new(r"\b(\d+)\s+items?\b").ok()?;
    re.captures(label)
        .and_then(|caps| caps.get(1))
        .and_then(|m| m.as_str().parse::<u64>().ok())
}
