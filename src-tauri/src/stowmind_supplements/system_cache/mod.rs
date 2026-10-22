//! Fixed-path system-cache diagnostics; destructive work stays in Mole.
mod probe;
mod process_tree;
mod pty;
mod review;
mod scripts;
mod types;

use crate::mole_clean_pty::MoleCleanPtyManager;
use std::{
    path::Path,
    sync::{Mutex, OnceLock},
};
use tauri::{State, Window};
use types::{epoch_now, ScanStatus, SystemCacheOutcome, SystemCacheReport, TARGET_PATH};

static OPERATION: OnceLock<Mutex<()>> = OnceLock::new();

#[tauri::command]
pub async fn system_cache_scan() -> Result<SystemCacheReport, String> {
    tokio::task::spawn_blocking(|| decorate(probe::scan()))
        .await
        .map_err(|error| format!("Cannot finish system cache scan: {error}"))
}

#[tauri::command]
pub async fn system_cache_review(
    window: Window,
    run_id: String,
    state: State<'_, MoleCleanPtyManager>,
) -> Result<SystemCacheReport, String> {
    validate_run_id(&run_id)?;
    if !cfg!(target_os = "macos") {
        return Ok(decorate(probe::scan()));
    }
    let manager = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        let _guard = OPERATION.get_or_init(|| Mutex::new(())).try_lock().map_err(|_| "A system cache operation is already running")?;
        let before = probe::physical_identities(Path::new(TARGET_PATH));
        let protocol = pty::run(&window, &run_id, &manager, scripts::review_script(), false);
        let mut report = decorate(report_from_protocol(&protocol, "review"));
        if protocol.failure.is_some() || protocol.termination_uncertain {
            report.status = if protocol.failure.as_deref().unwrap_or("").contains("timed out") { ScanStatus::TimedOut } else { ScanStatus::Error };
            report.size_bytes = None;
            report.anomaly = None;
            report.message = protocol.failure.clone().unwrap_or_else(|| "Cannot confirm the review subprocess has stopped".to_string());
            return Ok(report);
        }
        if let (Ok(before), Ok(after), Ok(adapter)) = (before, probe::physical_identities(Path::new(TARGET_PATH)), scripts::locate_adapter()) {
            if report.status == ScanStatus::Complete && report.authorized && report.size_bytes.is_some() {
                let measured_id = protocol.measurements.get("review").and_then(|measurement| measurement.identity.as_ref());
                if review::identities_match(&before, &after) && measured_id == after.last() {
                    report.review_token = Some(review::issue(&report, after, adapter, window.label())?);
                } else {
                    report.status = ScanStatus::Partial;
                    report.size_bytes = None;
                    report.anomaly = None;
                    report.message = "The icon cache changed during review; administrator review is required again".to_string();
                }
            }
        }
        Ok(report)
    }).await.map_err(|error| format!("Cannot finish administrator cache review: {error}"))?
}

#[tauri::command]
pub async fn system_cache_clean(
    window: Window,
    run_id: String,
    review_token: String,
    confirmed: bool,
    state: State<'_, MoleCleanPtyManager>,
) -> Result<SystemCacheOutcome, String> {
    validate_run_id(&run_id)?;
    if !confirmed {
        return Err("System cache cleanup requires explicit confirmation".to_string());
    }
    let review = review::consume(&review_token, window.label())?;
    let manager = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        let _guard = OPERATION.get_or_init(|| Mutex::new(())).try_lock().map_err(|_| "A system cache operation is already running")?;
        if scripts::locate_adapter()? != review.adapter {
            return Err("The selected Mole runtime changed since review; administrator review is required again".to_string());
        }
        let current = probe::physical_identities(Path::new(TARGET_PATH))?;
        if !review::identities_match(&review.identities, &current) {
            return Err("The icon cache changed since review; administrator review is required again".to_string());
        }
        let script = scripts::clean_script(&review.adapter, &current, review.report.size_bytes.ok_or("Missing reviewed cache size")?)?;
        let protocol = pty::run(&window, &run_id, &manager, script, true);
        let before = if protocol.measurements.contains_key("before") { decorate(report_from_protocol(&protocol, "before")) } else { review.report };
        // A stopped shell cannot produce an authorized after record. Still
        // re-probe without another prompt and preserve unknowns rather than
        // discard an operation that may already have changed the directory.
        let after = if protocol.termination_uncertain {
            SystemCacheReport::new(ScanStatus::Error, "Cannot confirm all cleanup subprocesses have stopped; the size remains unknown", false)
        } else if protocol.measurements.contains_key("after") { decorate(report_from_protocol(&protocol, "after")) } else { decorate(probe::scan()) };
        Ok(outcome(before, after, protocol))
    }).await.map_err(|error| format!("Cannot finish system cache cleanup: {error}"))?
}

fn validate_run_id(run_id: &str) -> Result<(), String> {
    if run_id.is_empty()
        || run_id.len() > 128
        || !run_id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        Err("Invalid system cache operation ID".to_string())
    } else {
        Ok(())
    }
}

fn decorate(mut report: SystemCacheReport) -> SystemCacheReport {
    match scripts::locate_adapter() {
        Ok(_) => {
            report.mole_supported = true;
            report.mole_message =
                "Scoped icon cache cleanup is available through the selected Mole runtime"
                    .to_string();
        }
        Err(error) => report.mole_message = error,
    }
    report
}

fn report_from_protocol(protocol: &pty::Protocol, phase: &str) -> SystemCacheReport {
    let Some(measurement) = protocol.measurements.get(phase) else {
        let status = if protocol
            .failure
            .as_deref()
            .unwrap_or("")
            .contains("timed out")
        {
            ScanStatus::TimedOut
        } else {
            ScanStatus::Error
        };
        return SystemCacheReport::new(
            status,
            protocol
                .failure
                .as_deref()
                .unwrap_or("The cache measurement did not finish; the size remains unknown"),
            protocol.authorized,
        );
    };
    let status = match measurement.status.as_str() {
        "complete" => ScanStatus::Complete,
        "not_found" => ScanStatus::NotFound,
        "permission_denied" => ScanStatus::PermissionDenied,
        "partial" => ScanStatus::Partial,
        _ => ScanStatus::Error,
    };
    let mut report = SystemCacheReport::new(
        status,
        format!("Cache measurement: {}", measurement.status),
        protocol.authorized,
    );
    if report.status == ScanStatus::Complete {
        if let Some(size) = measurement.size_bytes {
            report.set_size(size);
        }
    }
    report.modified_at = measurement.identity.as_ref().map(|id| id.modified);
    report
}

fn observed_size(report: &SystemCacheReport) -> Option<u64> {
    match report.status {
        ScanStatus::Complete => report.size_bytes,
        ScanStatus::NotFound => Some(0),
        _ => None,
    }
}

fn outcome(
    before: SystemCacheReport,
    after: SystemCacheReport,
    protocol: pty::Protocol,
) -> SystemCacheOutcome {
    let mut errors = protocol.failure.into_iter().collect::<Vec<_>>();
    if protocol.action.as_deref() != Some("0") {
        if let Some(refusal) = protocol.refusal {
            errors.push(refusal);
        }
        errors.push(match protocol.action.as_deref() {
            Some("stale_review") => "Cache size or identity changed since review; Mole cleanup was skipped".to_string(),
            Some("mole_unavailable") => "Mole's scoped cleanup or whitelist could not be loaded; cleanup was skipped".to_string(),
            Some(code) => format!("Mole refused or could not complete icon cache cleanup (status {code}); its protection rules were preserved"),
            None => "Mole cleanup did not report completion; cleanup may be partial".to_string(),
        });
    }
    if !matches!(after.status, ScanStatus::Complete | ScanStatus::NotFound) {
        errors.push(
            "Post-cleanup measurement is incomplete; the size difference is unknown".to_string(),
        );
    }
    if !protocol.attempted
        || !protocol.authorized
        || before.status != ScanStatus::Complete
        || before.size_bytes.is_none_or(|size| size == 0)
    {
        errors.push(
            "Mole cleanup was not completed after an authorized, confirmed cache measurement"
                .to_string(),
        );
    }
    let measured_delta_bytes = observed_size(&before)
        .zip(observed_size(&after))
        .and_then(|(before, after)| i64::try_from(i128::from(before) - i128::from(after)).ok());
    SystemCacheOutcome {
        source: "mole",
        before,
        after,
        success: errors.is_empty(),
        attempted: protocol.attempted,
        errors,
        measured_delta_bytes,
        completed_at: epoch_now(),
    }
}

#[cfg(test)]
mod tests;
