//! Bounded, cancellable native maintenance operations. One run owns all phases.
mod error;
mod manager;
mod process;
mod process_tree;
#[cfg(test)]
mod tests;

pub(crate) use error::MaintenanceError;
pub(crate) use manager::{MaintenanceManager, RunContext};
#[cfg(test)]
pub(crate) use process::OUTPUT_LIMIT;
use std::time::Duration;
use tauri::{State, Window};

pub(crate) const LIST_TIMEOUT: Duration = Duration::from_secs(90);
pub(crate) const PREVIEW_TIMEOUT: Duration = Duration::from_secs(180);
pub(crate) const EXECUTE_TIMEOUT: Duration = Duration::from_secs(600);

#[tauri::command]
pub async fn maintenance_cancel(
    window: Window,
    state: State<'_, MaintenanceManager>,
    run_id: String,
) -> Result<(), MaintenanceError> {
    let manager = state.inner().clone();
    let window = window.label().to_string();
    manager.cancel(&window, &run_id)?;
    tokio::task::spawn_blocking(move || {
        manager.wait_finished(&window, &run_id, Duration::from_secs(10))
    })
    .await
    .map_err(|error| {
        MaintenanceError::new(
            "failed",
            format!("Cannot join maintenance cancellation: {error}"),
        )
    })?
}
