use super::manager::MoleAnalyzeManager;
use super::process::{
    emit_analyze_heartbeat, emit_analyze_progress, run_mole_analyze_quiet, CANCELLED_ERROR,
};
use super::types::{MoleAnalyzeEntry, MoleAnalyzePartial, MoleAnalyzeResult};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Instant;
use tauri::Window;

#[derive(Clone)]
struct RootScanTarget {
    path: PathBuf,
    name: String,
    is_dir: bool,
    size: u64,
}

pub async fn analyze_system_root(
    window: Window,
    manager: MoleAnalyzeManager,
    run_id: &str,
    started_at: Instant,
) -> Result<MoleAnalyzeResult, String> {
    let targets = collect_root_scan_targets("/")?;
    if targets.is_empty() {
        return Err("No root folders were found for analysis".to_string());
    }

    let mut entries = Vec::new();
    let mut large_files = Vec::new();
    let mut warnings = Vec::new();
    let mut total_size = 0_u64;
    let mut total_files = 0_u64;
    let total = targets.len();

    for (index, target) in targets.into_iter().enumerate() {
        let current = index + 1;
        if manager.is_cancelled(run_id) {
            return Err(CANCELLED_ERROR.to_string());
        }

        if !target.is_dir {
            entries.push(root_file_entry(&target));
            total_size = total_size.saturating_add(target.size);
            total_files = total_files.saturating_add(1);
            continue;
        }

        match run_root_segment(
            window.clone(),
            manager.clone(),
            run_id,
            &target,
            started_at,
            current,
            total,
        )
        .await
        {
            Ok(result) => {
                entries.push(root_dir_entry(&target, result.total_size));
                total_size = total_size.saturating_add(result.total_size);
                total_files = total_files.saturating_add(result.total_files);
                large_files.extend(result.large_files);
                warnings.extend(result.warnings);
                emit_partial_result(
                    &window,
                    run_id,
                    entries.clone(),
                    large_files.clone(),
                    warnings.clone(),
                    total_size,
                    total_files,
                );
            }
            Err(error) if manager.is_cancelled(run_id) || error == CANCELLED_ERROR => {
                return Err(CANCELLED_ERROR.to_string());
            }
            Err(error) => {
                let path = target.path.to_string_lossy().to_string();
                let warning = format!("{path}: {error}");
                warnings.push(warning.clone());
                emit_analyze_progress(
                    &window,
                    run_id,
                    "/",
                    "segmentFailed",
                    Some("stderr"),
                    Some(&warning),
                    started_at,
                    Some(current),
                    Some(total),
                );
                emit_partial_result(
                    &window,
                    run_id,
                    entries.clone(),
                    large_files.clone(),
                    warnings.clone(),
                    total_size,
                    total_files,
                );
            }
        }
    }

    if entries.is_empty() && !warnings.is_empty() {
        return Err(format!(
            "No root folders could be analyzed. {}",
            warnings.join("; ")
        ));
    }

    entries.sort_by(|a, b| b.size.cmp(&a.size));
    large_files.sort_by(|a, b| b.size.cmp(&a.size));
    large_files.truncate(50);

    emit_analyze_progress(
        &window, run_id, "/", "parsing", None, None, started_at, None, None,
    );
    emit_analyze_progress(
        &window, run_id, "/", "finished", None, None, started_at, None, None,
    );

    Ok(MoleAnalyzeResult {
        path: "/".to_string(),
        overview: false,
        entries,
        large_files,
        warnings,
        total_size,
        total_files,
    })
}

fn emit_partial_result(
    window: &Window,
    run_id: &str,
    mut entries: Vec<MoleAnalyzeEntry>,
    mut large_files: Vec<MoleAnalyzeEntry>,
    warnings: Vec<String>,
    total_size: u64,
    total_files: u64,
) {
    entries.sort_by(|a, b| b.size.cmp(&a.size));
    large_files.sort_by(|a, b| b.size.cmp(&a.size));
    large_files.truncate(50);

    let _ = window.emit(
        "mole-analyze-partial",
        MoleAnalyzePartial {
            run_id: run_id.to_string(),
            result: MoleAnalyzeResult {
                path: "/".to_string(),
                overview: false,
                entries,
                large_files,
                warnings,
                total_size,
                total_files,
            },
        },
    );
}

async fn run_root_segment(
    window: Window,
    manager: MoleAnalyzeManager,
    run_id: &str,
    target: &RootScanTarget,
    started_at: Instant,
    current: usize,
    total: usize,
) -> Result<MoleAnalyzeResult, String> {
    let path = target.path.to_string_lossy().to_string();
    emit_analyze_progress(
        &window,
        run_id,
        "/",
        "segmentStarted",
        None,
        Some(&path),
        started_at,
        Some(current),
        Some(total),
    );

    let running = Arc::new(AtomicBool::new(true));
    let heartbeat = tokio::spawn(emit_analyze_heartbeat(
        window.clone(),
        run_id.to_string(),
        "/".to_string(),
        Some(path.clone()),
        started_at,
        running.clone(),
        Some(current),
        Some(total),
    ));

    let result = run_mole_analyze_quiet(manager.clone(), run_id, &path).await;
    running.store(false, Ordering::Relaxed);
    let _ = heartbeat.await;

    let result = result?;
    emit_analyze_progress(
        &window,
        run_id,
        "/",
        "segmentFinished",
        None,
        Some(&path),
        started_at,
        Some(current),
        Some(total),
    );
    Ok(result)
}

fn root_dir_entry(target: &RootScanTarget, size: u64) -> MoleAnalyzeEntry {
    MoleAnalyzeEntry {
        name: target.name.clone(),
        path: target.path.to_string_lossy().to_string(),
        size,
        is_dir: true,
        last_access: None,
    }
}

fn root_file_entry(target: &RootScanTarget) -> MoleAnalyzeEntry {
    MoleAnalyzeEntry {
        name: target.name.clone(),
        path: target.path.to_string_lossy().to_string(),
        size: target.size,
        is_dir: false,
        last_access: None,
    }
}

fn collect_root_scan_targets(root: &str) -> Result<Vec<RootScanTarget>, String> {
    let mut targets = Vec::new();
    let entries = fs::read_dir(root).map_err(|e| format!("Failed to read system root: {e}"))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read system root entry: {e}"))?;
        let path = entry.path();
        if should_skip_root_path(&path) {
            continue;
        }

        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        if metadata.file_type().is_symlink() {
            continue;
        }

        let name = entry.file_name().to_string_lossy().trim().to_string();
        if name.is_empty() {
            continue;
        }

        let is_dir = metadata.is_dir();
        targets.push(RootScanTarget {
            path,
            name,
            is_dir,
            size: if is_dir { 0 } else { metadata.len() },
        });
    }

    targets.sort_by(|a, b| {
        root_priority(&a.path)
            .cmp(&root_priority(&b.path))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(targets)
}

fn root_priority(path: &Path) -> usize {
    const PRIORITY: &[&str] = &[
        "/Applications",
        "/Users",
        "/Library",
        "/System",
        "/private",
        "/usr",
        "/opt",
        "/bin",
        "/sbin",
    ];
    let path = path.to_string_lossy();
    PRIORITY
        .iter()
        .position(|candidate| path == *candidate)
        .unwrap_or(PRIORITY.len())
}

fn should_skip_root_path(path: &Path) -> bool {
    let path = path.to_string_lossy();
    #[cfg(target_os = "macos")]
    {
        matches!(
            path.as_ref(),
            "/Volumes" | "/dev" | "/home" | "/net" | "/Network" | "/cores"
        )
    }
    #[cfg(not(target_os = "macos"))]
    {
        matches!(path.as_ref(), "/dev" | "/proc" | "/run" | "/sys")
    }
}
