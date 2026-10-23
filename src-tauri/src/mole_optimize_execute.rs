use crate::maintenance_process::{MaintenanceError, MaintenanceManager, EXECUTE_TIMEOUT};
use crate::mole_utils::{mole_command, strip_ansi};
use serde::Serialize;
use tauri::{State, Window};

#[derive(Clone, Debug, Serialize)]
pub struct MoleOptimizeExecuteOutcome {
    pub output_truncated: bool,
    pub applied_count: Option<u64>,
    pub summary_status: String,
    pub raw_output: String,
}

#[tauri::command]
pub async fn mole_optimize_execute(
    window: Window,
    state: State<'_, MaintenanceManager>,
    run_id: String,
) -> Result<MoleOptimizeExecuteOutcome, MaintenanceError> {
    let run = state.begin(window.label(), &run_id, EXECUTE_TIMEOUT)?;
    tokio::task::spawn_blocking(move || {
        let preview = crate::mole_optimize::run_optimize_preview(&run)?;
        if preview.preview_status != "complete" || preview.planned_count.is_none() {
            return Err(MaintenanceError::new(
                "failed",
                "Mole optimize preview is incomplete; execution is blocked",
            ));
        }
        let mut command = mole_command()?;
        let captured = match run.run(command.arg("optimize"), None) {
            Ok(output) => output,
            Err(error) => return Err(attach_optimize_partial(error)),
        };
        if !captured.output.status.success() {
            return Err(attach_optimize_partial(
                captured.failure("mo optimize failed"),
            ));
        }
        Ok(optimize_outcome(
            &captured.text(),
            captured.output_truncated,
        ))
    })
    .await
    .map_err(|error| {
        MaintenanceError::new("failed", format!("Cannot join optimize execution: {error}"))
    })?
}

fn optimize_outcome(raw_output: &str, output_truncated: bool) -> MoleOptimizeExecuteOutcome {
    let clean = strip_ansi(raw_output);
    MoleOptimizeExecuteOutcome {
        applied_count: parse_applied_count(&clean),
        summary_status: execution_summary_status(&clean).to_string(),
        raw_output: clean,
        output_truncated,
    }
}

fn attach_optimize_partial(error: MaintenanceError) -> MaintenanceError {
    let mut partial = optimize_outcome(&error.raw_output, error.output_truncated);
    // A report observed before interruption is evidence of partial work, never
    // evidence that every requested optimization completed.
    if partial.applied_count.is_some() {
        partial.summary_status = "partial".to_string();
    }
    error.partial(&partial)
}

fn parse_applied_count(raw: &str) -> Option<u64> {
    let re = regex::Regex::new(r"(?im)^\s*(?:Applied\s+(\d+)\s+optimizations?\b|(\d+)\s+optimizations?\s+(?:applied|completed|complete)\b)").expect("static optimize outcome");
    re.captures_iter(raw)
        .last()
        .and_then(|caps| caps.get(1).or_else(|| caps.get(2)))
        .and_then(|value| value.as_str().parse().ok())
}

fn execution_summary_status(raw: &str) -> &'static str {
    if parse_applied_count(raw).is_none() {
        return "unavailable";
    }
    let warnings = regex::Regex::new(r"(?im)\b([1-9][0-9]*)\s+(?:failed|need attention)\b")
        .expect("static optimize warnings");
    if warnings.is_match(raw) {
        "partial"
    } else {
        "complete"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn interrupted_execution_reports_actual_partial_work_only_after_spawn() {
        let mut error = MaintenanceError::new("cancelled", "cancelled");
        error.raw_output = "Applied 2 optimizations\n".to_string();
        assert!(attach_optimize_partial(error.clone())
            .partial_result
            .is_none());
        error.process_started = true;
        error.output_truncated = true;
        let partial = attach_optimize_partial(error).partial_result.unwrap();
        assert_eq!(partial["applied_count"], 2);
        assert_eq!(partial["summary_status"], "partial");
        assert_eq!(partial["output_truncated"], true);
        let mut unknown = MaintenanceError::new("timeout", "timeout");
        unknown.process_started = true;
        unknown.raw_output = "Would apply 7 optimizations\n".to_string();
        let partial = attach_optimize_partial(unknown).partial_result.unwrap();
        assert!(partial["applied_count"].is_null());
        assert_eq!(partial["summary_status"], "unavailable");
    }
    #[test]
    fn only_actual_reported_counts_authorize_success() {
        assert_eq!(parse_applied_count("Applied 0 optimizations"), Some(0));
        assert_eq!(parse_applied_count("23 optimizations completed"), Some(23));
        assert_eq!(parse_applied_count("Would apply 7 optimizations"), None);
        assert_eq!(parse_applied_count("Optimization Complete"), None);
        assert_eq!(
            execution_summary_status("Applied 3 optimizations\n1 failed | 2 need attention"),
            "partial"
        );
        assert_eq!(
            execution_summary_status("Would apply 3 optimizations"),
            "unavailable"
        );
        assert_eq!(
            parse_applied_count("Applied 8 optimizations\nApplied 0 optimizations"),
            Some(0)
        );
    }
}
