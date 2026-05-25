pub mod manager;
pub mod process;
mod root;
mod types;

use std::time::Instant;
use tauri::{State, Window};

pub use manager::MoleAnalyzeManager;
use process::{emit_analyze_progress, run_mole_analyze_process, CANCELLED_ERROR};
use root::analyze_system_root;
use types::MoleAnalyzeResult;

#[tauri::command]
pub async fn mole_analyze_json_stream(
    window: Window,
    state: State<'_, MoleAnalyzeManager>,
    run_id: String,
    path: String,
) -> Result<MoleAnalyzeResult, String> {
    let target = path.trim().to_string();
    if target.is_empty() {
        return Err("Analyze path is required".to_string());
    }

    state.reset_run(&run_id);
    let started_at = Instant::now();
    emit_analyze_progress(
        &window, &run_id, &target, "started", None, None, started_at, None, None,
    );

    let result = if is_system_root(&target) {
        analyze_system_root(window.clone(), state.inner().clone(), &run_id, started_at).await
    } else {
        run_mole_analyze_process(
            window.clone(),
            state.inner().clone(),
            &run_id,
            &target,
            started_at,
        )
        .await
    };

    let was_cancelled = state.is_cancelled(&run_id);
    state.finish_run(&run_id);

    if was_cancelled {
        emit_analyze_progress(
            &window,
            &run_id,
            &target,
            "cancelled",
            None,
            None,
            started_at,
            None,
            None,
        );
        return Err(CANCELLED_ERROR.to_string());
    }

    result
}

fn is_system_root(path: &str) -> bool {
    let trimmed = path.trim();
    trimmed == "/" || trimmed == "\\"
}
