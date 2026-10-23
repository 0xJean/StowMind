use super::types::{MoleInstallerExecuteOutcome, MoleInstallerItem, ReviewedInstaller};
use std::{collections::HashSet, path::Path};

const FIELD: char = '\x1f';
const RECORD: char = '\x1e';

pub(super) fn parse_records(raw: &str) -> Result<Vec<ReviewedInstaller>, String> {
    let clean = crate::mole_utils::strip_ansi(raw);
    let body = clean
        .trim()
        .strip_prefix("STOWMIND_INSTALLERS_V1\x1e")
        .and_then(|body| body.strip_suffix("STOWMIND_INSTALLERS_END\x1e"))
        .ok_or("Installer scan returned an incomplete or unsupported result; scan again")?;
    let mut items = Vec::new();
    let mut seen = HashSet::new();
    for record in body.split_terminator(RECORD) {
        let fields: Vec<_> = record.split(FIELD).collect();
        if fields.len() != 4 || !Path::new(fields[0]).is_absolute() || fields[0].contains('\n') {
            return Err("Installer scan returned an invalid path record".to_string());
        }
        let size = fields[1]
            .parse()
            .map_err(|_| "Installer scan returned an unknown file size")?;
        if fields[3].is_empty() || !seen.insert(fields[0].to_string()) {
            return Err("Installer scan returned missing identity or duplicate paths".to_string());
        }
        items.push(ReviewedInstaller {
            item: MoleInstallerItem {
                path: fields[0].to_string(),
                name: Path::new(fields[0])
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string(),
                size,
                source: fields[2].to_string(),
            },
            identity: fields[3].to_string(),
        });
    }
    Ok(items)
}

pub(super) fn parse_outcome(raw: &str, exit_success: bool) -> MoleInstallerExecuteOutcome {
    let clean = crate::mole_utils::strip_ansi(raw);
    let parsed = clean.lines().rev().find_map(|line| {
        let line = line
            .trim()
            .strip_prefix("STOWMIND_INSTALLER_RESULT_V1\x1f")?
            .strip_suffix(RECORD)?;
        let fields: Vec<_> = line.split(FIELD).collect();
        if fields.len() != 4 {
            return None;
        }
        let count = fields[0].parse::<u64>().ok()?;
        let bytes = fields[1].parse::<u64>().ok()?.checked_mul(1024)?;
        let failed = fields[2].parse::<u64>().ok()?;
        let status = fields[3].parse::<u32>().ok()?;
        Some((count, bytes, failed, status))
    });
    let (item_count, total_size, failed_count, status) = match parsed {
        Some((count, bytes, failed, 0)) if exit_success && failed == 0 => {
            (Some(count), Some(bytes), Some(failed), "success")
        }
        Some((count, bytes, failed, _)) => (
            Some(count),
            Some(bytes),
            Some(failed),
            if count > 0 { "partial" } else { "failed" },
        ),
        None => (None, None, None, "unknown"),
    };
    // Keep the user-readable Mole report without exposing transport markers.
    let raw_output = clean
        .lines()
        .filter(|line| !line.starts_with("STOWMIND_INSTALLER_RESULT_V1"))
        .collect::<Vec<_>>()
        .join("\n");
    MoleInstallerExecuteOutcome {
        item_count,
        total_size,
        failed_count,
        status,
        raw_output,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn empty_is_only_known_after_a_complete_scan_frame() {
        assert!(parse_records("").is_err());
        assert!(parse_records("STOWMIND_INSTALLERS_V1\x1e").is_err());
        assert!(
            parse_records("STOWMIND_INSTALLERS_V1\x1eSTOWMIND_INSTALLERS_END\x1e")
                .unwrap()
                .is_empty()
        );
    }
    #[test]
    fn corrupt_records_are_not_silently_dropped_to_zero() {
        let record = "STOWMIND_INSTALLERS_V1\x1e/tmp/A.dmg\x1funknown\x1fDownloads\x1f1:2:3\x1eSTOWMIND_INSTALLERS_END\x1e";
        assert!(parse_records(record).is_err());
        let items = parse_records(&record.replace("unknown", "0")).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].item.size, 0);
    }
    #[test]
    fn outcome_distinguishes_confirmed_zero_unknown_and_partial() {
        let unknown = parse_outcome("No installers were removed", true);
        assert_eq!(unknown.item_count, None);
        let zero = parse_outcome("STOWMIND_INSTALLER_RESULT_V1\x1f0\x1f0\x1f0\x1f0\x1e", true);
        assert_eq!(zero.item_count, Some(0));
        assert_eq!(zero.total_size, Some(0));
        let partial = parse_outcome(
            "STOWMIND_INSTALLER_RESULT_V1\x1f2\x1f1024\x1f1\x1f3\x1e",
            false,
        );
        assert_eq!(partial.status, "partial");
        assert_eq!(partial.item_count, Some(2));
        assert_eq!(partial.total_size, Some(1_048_576));
    }
}
