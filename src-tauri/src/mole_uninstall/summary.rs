use crate::mole_utils::unit_to_bytes;
use regex::Regex;

pub(super) fn parse_size_to_bytes(size: &str) -> Option<u64> {
    let re = Regex::new(r"(?i)^\s*([0-9]+(?:\.[0-9]+)?)\s*([KMGT]?B)\s*$").ok()?;
    let caps = re.captures(size)?;
    let amount = caps[1].parse::<f64>().ok()?;
    let unit = caps[2].to_ascii_uppercase();
    let bytes = amount
        * 1024_f64.powi(match unit.as_str() {
            "KB" => 1,
            "MB" => 2,
            "GB" => 3,
            "TB" => 4,
            _ => 0,
        });
    (bytes.is_finite() && bytes < u64::MAX as f64).then(|| unit_to_bytes(amount, &unit))
}

/// Only the requested operation's final summary is evidence. A dry run cannot
/// prove removal, and a missing byte field never means zero or the app's size.
pub(super) fn parse_uninstall_operation_summary(
    raw: &str,
    dry_run: bool,
) -> (Option<u64>, Option<u64>) {
    let prefix = if dry_run { "Would remove" } else { "Removed" };
    let re = Regex::new(&format!(r"(?im)^\s*{prefix}\s+(\d+)\s+apps?\b([^\r\n]*)$"))
        .expect("static uninstall summary");
    let Some(caps) = re.captures_iter(raw).last() else {
        return (None, None);
    };
    let count = caps[1].parse().ok();
    let verb = if dry_run { "would free" } else { "freed" };
    let size = Regex::new(&format!(
        r"(?i)^,\s*{verb}\s+([0-9]+(?:\.[0-9]+)?\s*[KMGT]?B)\b"
    ))
    .expect("static uninstall bytes");
    let bytes = size
        .captures(caps[2].trim())
        .and_then(|capture| parse_size_to_bytes(&capture[1]));
    (count, bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_requested_mode_and_preserves_known_zero() {
        assert_eq!(
            parse_uninstall_operation_summary("Would remove 1 app, would free 4KB: Example", true),
            (Some(1), Some(4096))
        );
        assert_eq!(
            parse_uninstall_operation_summary("Removed 0 apps, freed 0B", false),
            (Some(0), Some(0))
        );
        assert_eq!(
            parse_uninstall_operation_summary("Removed 2 apps, freed 1.5MB: A, B", false),
            (Some(2), Some(1_572_864))
        );
        assert_eq!(
            parse_uninstall_operation_summary("Would remove 9 apps, would free 9GB", false),
            (None, None)
        );
    }
    #[test]
    fn missing_and_partial_totals_are_not_app_size_fallbacks() {
        assert_eq!(
            parse_uninstall_operation_summary("Uninstall complete", false),
            (None, None)
        );
        assert_eq!(
            parse_uninstall_operation_summary("Removed 1 app: Example", false),
            (Some(1), None)
        );
        assert_eq!(
            parse_uninstall_operation_summary("Removed 1 app, freed Partially measured", false),
            (Some(1), None)
        );
        assert_eq!(
            parse_uninstall_operation_summary("Removed 2 apps, freed 3GB\nRemoved 1 app", false),
            (Some(1), None)
        );
        assert_eq!(parse_size_to_bytes("unknown"), None);
        assert_eq!(parse_size_to_bytes("0B"), Some(0));
        assert_eq!(parse_size_to_bytes("999999999999999999TB"), None);
    }
}
