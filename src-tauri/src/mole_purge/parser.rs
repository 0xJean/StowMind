use super::types::{MoleExecuteOutcome, MolePurgeItem};
use crate::mole_utils::strip_ansi;
use regex::Regex;

const FIELD_SEP: char = '\x1f';
const RECORD_SEP: char = '\x1e';
pub(super) const COMPLETE_RECORD: &str = "STOWMIND_PURGE_SCAN_COMPLETE";

pub(super) fn parse_records(raw: &str, include_empty: bool) -> Result<Vec<MolePurgeItem>, String> {
    let mut items = Vec::new();
    let mut complete = false;
    for record in raw.split(RECORD_SEP).filter(|part| !part.trim().is_empty()) {
        let record = record.trim_end_matches(['\r', '\n']);
        if record == COMPLETE_RECORD {
            complete = true;
            continue;
        }
        let (path, size) = record
            .split_once(FIELD_SEP)
            .ok_or_else(|| "Mole purge returned an invalid preview record".to_string())?;
        if !std::path::Path::new(path).is_absolute() || complete {
            return Err("Mole purge returned an invalid preview path or record order".to_string());
        }
        let size = if size == "unknown" {
            None
        } else {
            Some(
                size.parse()
                    .map_err(|_| "Mole purge returned an invalid size".to_string())?,
            )
        };
        // An unreadable size is not an empty artifact.
        if include_empty || size != Some(0) {
            items.push(MolePurgeItem {
                path: path.to_string(),
                size,
            });
        }
    }
    if !complete {
        return Err("Mole purge scan did not report completion".to_string());
    }
    items.sort_by(|left, right| left.path.cmp(&right.path));
    items.dedup_by(|left, right| left.path == right.path);
    Ok(items)
}

pub(super) fn preview_size(items: &[MolePurgeItem]) -> (Option<u64>, String) {
    let known: Vec<u64> = items.iter().filter_map(|item| item.size).collect();
    let total = known
        .iter()
        .try_fold(0_u64, |total, size| total.checked_add(*size));
    if total.is_none() || (known.is_empty() && !items.is_empty()) {
        (None, "unknown".to_string())
    } else if known.len() != items.len() {
        (total, "at_least".to_string())
    } else {
        (total, "estimated".to_string())
    }
}

pub(super) fn parse_outcome(raw: &str, success: bool) -> MoleExecuteOutcome {
    let clean = strip_ansi(raw).replace('\r', "\n");
    let heading =
        Regex::new(r"(?im)^\s*(Purge complete|Purge incomplete|Dry run[^\n]*|Purge cancelled)\s*$")
            .unwrap();
    let heading = heading.captures_iter(&clean).last();
    let block = heading
        .as_ref()
        .map(|value| &clean[value.get(0).unwrap().end()..])
        .unwrap_or(&clean);
    let heading = heading.as_ref().map(|value| value[1].to_ascii_lowercase());
    let no_candidates = clean.lines().any(|line| {
        line.contains("Great! No old project artifacts to clean")
            || line.trim() == "No artifacts found to purge"
    });
    let cancelled = clean
        .lines()
        .any(|line| matches!(line.trim(), "No items selected" | "Purge cancelled"));
    let outcome = match heading.as_deref() {
        Some("purge complete") if success => "completed",
        Some("purge incomplete") => "incomplete",
        Some("purge cancelled") => "cancelled",
        Some(value) if value.starts_with("dry run") => "unknown",
        _ if !success => "failed",
        _ if no_candidates => "no_candidates",
        _ if cancelled => "cancelled",
        _ => "unknown",
    };
    let mut result = MoleExecuteOutcome {
        item_count: None,
        total_size: None,
        size_kind: "unknown".to_string(),
        outcome: outcome.to_string(),
        raw_output: clean.clone(),
    };
    if heading
        .as_deref()
        .is_some_and(|value| value.starts_with("dry run"))
    {
        return result;
    }
    let stats = Regex::new(r"(?im)^\s*(Estimated space freed|Space freed):\s*([^\n]+)$").unwrap();
    if let Some(captures) = stats.captures_iter(block).last() {
        let mut fields = captures[2].split('|');
        let space = fields.next().unwrap_or_default().trim();
        let pattern = Regex::new(r"(?i)^(?:(at\s+least)\s+)?([0-9]+(?:\.[0-9]+)?)\s*([KMGT]?B)(?:\s*\+\s*(\d+)\s+unmeasured)?$").unwrap();
        if let Some(value) = pattern.captures(space) {
            result.total_size = parse_size(&value[2], &value[3]);
            if result.total_size.is_some() {
                result.size_kind =
                    if value.get(1).is_some() || value.get(4).is_some_and(|v| v.as_str() != "0") {
                        "at_least"
                    } else if captures[1].eq_ignore_ascii_case("Estimated space freed") {
                        "estimated"
                    } else {
                        "reported_freed"
                    }
                    .to_string();
            }
        }
        for field in fields {
            if let Some((key, value)) = field.split_once(':') {
                if key.trim().eq_ignore_ascii_case("Items") {
                    result.item_count = value.trim().parse().ok();
                }
            }
        }
    } else if outcome == "no_candidates"
        || outcome == "cancelled"
        || (outcome == "completed"
            && block
                .lines()
                .any(|line| line.trim() == "No artifacts were removed."))
    {
        result.item_count = Some(0);
        result.total_size = Some(0);
        result.size_kind = "reported_freed".to_string();
    }
    result
}

fn parse_size(amount: &str, unit: &str) -> Option<u64> {
    let power = match unit.to_ascii_uppercase().as_str() {
        "KB" => 1,
        "MB" => 2,
        "GB" => 3,
        "TB" => 4,
        _ => 0,
    };
    let bytes = amount.parse::<f64>().ok()? * 1024_f64.powi(power);
    (bytes.is_finite() && bytes < u64::MAX as f64).then(|| bytes.round() as u64)
}
