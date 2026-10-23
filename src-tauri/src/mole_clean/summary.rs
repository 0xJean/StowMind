use regex::Regex;
use serde::Serialize;
use std::sync::OnceLock;

/// Accuracy of the reported potential bytes. Missing measurements remain null;
/// they must never be displayed as a successful zero-byte scan.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MoleCleanSummaryStatus {
    Exact,
    AtLeast,
    Unavailable,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MoleCleanScanStatus {
    Complete,
    Incomplete,
    Unknown,
}

pub(super) struct CleanSummary {
    pub potential_space: Option<u64>,
    pub item_count: Option<u64>,
    pub category_count: Option<u64>,
    pub summary_status: MoleCleanSummaryStatus,
    pub scan_status: MoleCleanScanStatus,
}

pub(super) fn parse_clean_summary(raw: &str) -> CleanSummary {
    static HEADING: OnceLock<Regex> = OnceLock::new();
    static POTENTIAL: OnceLock<Regex> = OnceLock::new();
    let heading = HEADING.get_or_init(|| {
        Regex::new(
            r"(?im)^[ \t]*Dry[ \t]+run[ \t]+(complete|incomplete|cancelled|interrupted)\b[^\r\n]*",
        )
        .expect("static clean heading pattern")
    });
    let potential = POTENTIAL.get_or_init(|| {
        Regex::new(r"(?im)^[ \t]*Potential[ \t]+space[ \t]*:[ \t]*([^\r\n]*)$")
            .expect("static clean summary pattern")
    });
    // PTY output can contain redraws or an earlier provisional total. Only the
    // final completion block belongs to this result.
    let (scan_status, final_block) = match heading.captures_iter(raw).last() {
        Some(captures) => (
            if captures[1].eq_ignore_ascii_case("complete") {
                MoleCleanScanStatus::Complete
            } else {
                MoleCleanScanStatus::Incomplete
            },
            &raw[captures.get(0).expect("matched heading").end()..],
        ),
        None => (MoleCleanScanStatus::Unknown, raw),
    };
    let mut summary = CleanSummary {
        potential_space: None,
        item_count: None,
        category_count: None,
        summary_status: MoleCleanSummaryStatus::Unavailable,
        scan_status,
    };

    if let Some(captures) = potential.captures_iter(final_block).last() {
        let mut fields = captures[1].split('|');
        let (bytes, accuracy) = parse_space(fields.next().unwrap_or_default().trim());
        summary.potential_space = bytes;
        summary.summary_status = accuracy;
        // Mole omits zero-count fields in some output variants. Absence alone
        // is not sufficient evidence for zero, so each field is optional.
        for field in fields {
            if let Some((label, value)) = field.split_once(':') {
                match label.trim().to_ascii_lowercase().as_str() {
                    "items" => summary.item_count = parse_count(value.trim()),
                    "categories" => summary.category_count = parse_count(value.trim()),
                    _ => {}
                }
            }
        }
    } else if scan_status == MoleCleanScanStatus::Complete
        && final_block.lines().any(|line| {
            matches!(
                line.trim(),
                "No significant reclaimable space detected, system already clean."
                    | "No additional reclaimable space detected."
            )
        })
    {
        // These are Mole's explicit successful empty-result messages.
        summary.potential_space = Some(0);
        summary.item_count = Some(0);
        summary.category_count = Some(0);
        summary.summary_status = MoleCleanSummaryStatus::Exact;
    }
    summary
}

fn parse_space(value: &str) -> (Option<u64>, MoleCleanSummaryStatus) {
    static SPACE: OnceLock<Regex> = OnceLock::new();
    let pattern = SPACE.get_or_init(|| {
        Regex::new(r"(?i)^(?:(at\s+least)\s+)?([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?)\s*([KMGT]?B)$")
            .expect("static clean space pattern")
    });
    let Some(captures) = pattern.captures(value) else {
        return (None, MoleCleanSummaryStatus::Unavailable);
    };
    let amount = captures[2].replace(',', "").parse::<f64>().ok();
    let multiplier = match captures[3].to_ascii_uppercase().as_str() {
        "KB" => 1024_f64,
        "MB" => 1024_f64.powi(2),
        "GB" => 1024_f64.powi(3),
        "TB" => 1024_f64.powi(4),
        _ => 1_f64,
    };
    let bytes = amount
        .map(|value| value * multiplier)
        .filter(|value| value.is_finite() && *value < u64::MAX as f64)
        .map(|value| value.round() as u64);
    let accuracy = if bytes.is_none() {
        MoleCleanSummaryStatus::Unavailable
    } else if captures.get(1).is_some() {
        MoleCleanSummaryStatus::AtLeast
    } else {
        MoleCleanSummaryStatus::Exact
    };
    (bytes, accuracy)
}

fn parse_count(value: &str) -> Option<u64> {
    static COUNT: OnceLock<Regex> = OnceLock::new();
    let pattern = COUNT
        .get_or_init(|| Regex::new(r"^[0-9]+(?:,[0-9]{3})*$").expect("static clean count pattern"));
    pattern
        .is_match(value)
        .then(|| value.replace(',', "").parse().ok())
        .flatten()
}
