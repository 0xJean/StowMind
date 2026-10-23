use crate::deepclean;
mod parser;
use crate::maintenance_process::{
    MaintenanceError, MaintenanceManager, RunContext, PREVIEW_TIMEOUT,
};
use crate::mole_utils::{current_platform, mole_command};
use parser::{
    bytes_to_gb, output_text, parse_optimize_preview, parse_uptime_days, primary_disk_snapshot,
};
use serde::Serialize;
use tauri::{State, Window};

#[derive(Clone, Debug, Serialize)]
pub struct MoleOptimizeHealth {
    pub output_truncated: bool,
    pub health_score: Option<i64>,
    pub health_score_msg: String,
    pub memory_used_gb: Option<f64>,
    pub memory_total_gb: Option<f64>,
    pub disk_used_gb: Option<f64>,
    pub disk_total_gb: Option<f64>,
    pub disk_used_percent: Option<f64>,
    pub uptime_days: Option<f64>,
    pub active_whitelist: Vec<String>,
    pub optimizations: Vec<MoleOptimizationItem>,
    pub raw_output: String,
    pub platform: String,
    pub preview_status: String,
    pub planned_count: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
pub struct MoleOptimizationItem {
    pub category: String,
    pub name: String,
    pub description: String,
    pub action: String,
    pub safe: bool,
}

#[derive(Clone, Debug)]
pub(crate) struct OptimizePreview {
    pub(crate) preview_status: String,
    pub(crate) planned_count: Option<u64>,
    memory_used_gb: Option<f64>,
    memory_total_gb: Option<f64>,
    disk_used_gb: Option<f64>,
    disk_total_gb: Option<f64>,
    disk_used_percent: Option<f64>,
    uptime_days: Option<f64>,
    active_whitelist: Vec<String>,
    optimizations: Vec<MoleOptimizationItem>,
    raw_output: String,
}

#[tauri::command]
pub async fn mole_optimize_health_json(
    window: Window,
    state: State<'_, MaintenanceManager>,
    run_id: String,
) -> Result<MoleOptimizeHealth, MaintenanceError> {
    let run = state.begin(window.label(), &run_id, PREVIEW_TIMEOUT)?;
    tokio::task::spawn_blocking(move || {
        let preview = run_optimize_preview(&run)?;
        // Auxiliary health collection shares the same cancellation and deadline.
        let mut command = mole_command()?;
        let captured = run.run(command.args(["status", "-json"]), None)?;
        if captured.output_truncated {
            return Err(captured.failure("Mole health output was truncated; scan again"));
        }
        let status = if captured.output.status.success() {
            serde_json::from_slice::<deepclean::MoleStatusMetrics>(&captured.output.stdout).ok()
        } else {
            None
        };
        run.check()?;
        Ok(build_optimize_health(status, preview))
    })
    .await
    .map_err(|error| {
        MaintenanceError::new("failed", format!("Cannot join optimize preview: {error}"))
    })?
}

pub(crate) fn run_optimize_preview(run: &RunContext) -> Result<OptimizePreview, MaintenanceError> {
    let mut command = mole_command()?;
    let captured = run.run(command.args(["optimize", "--dry-run"]), None)?;
    if captured.output_truncated {
        return Err(captured.failure("Optimize preview was truncated; execution is blocked"));
    }
    let output = captured.output;
    let raw_output = output_text(&output);
    let mut preview = parse_optimize_preview(&raw_output);
    if !output.status.success() {
        preview.preview_status = "incomplete".to_string();
    }

    if !output.status.success() && preview.optimizations.is_empty() {
        return Err(if raw_output.trim().is_empty() {
            "mo optimize --dry-run failed".to_string()
        } else {
            raw_output
        }
        .into());
    }

    run.check()?;
    Ok(preview)
}

fn build_optimize_health(
    status: Option<deepclean::MoleStatusMetrics>,
    preview: OptimizePreview,
) -> MoleOptimizeHealth {
    let platform = status
        .as_ref()
        .map(|status| status.platform.clone())
        .filter(|platform| !platform.trim().is_empty())
        .unwrap_or_else(|| current_platform().to_string());

    let health_score = status.as_ref().map(|status| status.health_score);
    let health_score_msg = status
        .as_ref()
        .map(|status| status.health_score_msg.clone())
        .filter(|msg| !msg.trim().is_empty())
        .unwrap_or_else(|| "Mole status unavailable".to_string());

    let (memory_used_gb, memory_total_gb) = status
        .as_ref()
        .map(|status| {
            (
                Some(bytes_to_gb(status.memory.used)),
                (status.memory.total > 0).then(|| bytes_to_gb(status.memory.total)),
            )
        })
        .unwrap_or_else(|| {
            (
                preview.memory_used_gb,
                preview.memory_total_gb.filter(|value| *value > 0.0),
            )
        });

    let (disk_used_gb, disk_total_gb, disk_used_percent) = status
        .as_ref()
        .and_then(primary_disk_snapshot)
        .map(|disk| {
            (
                Some(bytes_to_gb(disk.used)),
                (disk.total > 0).then(|| bytes_to_gb(disk.total)),
                (disk.total > 0).then_some(disk.used_percent),
            )
        })
        .unwrap_or_else(|| {
            (
                preview.disk_used_gb,
                preview.disk_total_gb.filter(|value| *value > 0.0),
                preview
                    .disk_used_percent
                    .filter(|_| preview.disk_total_gb.is_some_and(|total| total > 0.0)),
            )
        });

    let uptime_days = status
        .as_ref()
        .and_then(|status| parse_uptime_days(&status.uptime))
        .or(preview.uptime_days);

    MoleOptimizeHealth {
        output_truncated: false,
        health_score,
        health_score_msg,
        memory_used_gb,
        memory_total_gb,
        disk_used_gb,
        disk_total_gb,
        disk_used_percent,
        uptime_days,
        active_whitelist: preview.active_whitelist,
        optimizations: preview.optimizations,
        raw_output: preview.raw_output,
        platform,
        preview_status: preview.preview_status,
        planned_count: preview.planned_count,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn failed_preview_does_not_fabricate_zero_health_or_a_complete_plan() {
        let preview = parse_optimize_preview("➤ Cache check\n→ Could not inspect cache\n");
        assert_eq!(preview.preview_status, "incomplete");
        assert_eq!(preview.planned_count, None);
        let health = build_optimize_health(None, preview);
        assert_eq!(health.health_score, None);
        assert_eq!(health.memory_total_gb, None);
        assert_eq!(health.disk_used_percent, None);
        assert_eq!(health.uptime_days, None);
    }
    #[test]
    fn explicit_zero_plan_remains_zero_instead_of_section_count() {
        let preview = parse_optimize_preview("➤ Healthy cache\n✓ Already healthy\nDry Run Complete, No Changes Made\nWould apply 0 optimizations\n");
        assert_eq!(preview.preview_status, "complete");
        assert_eq!(preview.planned_count, Some(0));
        assert_eq!(preview.optimizations.len(), 1);
    }
}
