#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ai;
mod ai_commands;
mod app_icons;
mod dashboard_cache;
mod deepclean;
mod duplicates;
mod hud;
mod hud_position;
mod ios;
mod macos_dock;
mod mole_analyze;
mod mole_capabilities;
mod mole_clean;
mod mole_clean_execute_pty;
mod mole_clean_pty;
mod mole_doctor;
mod mole_installer;
mod mole_optimize;
mod mole_optimize_execute;
mod mole_purge;
mod mole_uninstall;
mod mole_utils;
mod organize_commands;
mod organize_rules;
mod organizer;
mod pty;
mod result_cache;
mod stowmind_db;
mod stowmind_supplements;
mod system_settings;
mod watch;

use duplicates::DuplicateGroup;
use hud::{handle_tray_event, register_shortcut, HUD_POPOVER_LABEL, HUD_WINDOW_LABEL};
use tauri::{AppHandle, Manager, State, Window};
use watch::WatchManager;

#[tauri::command]
async fn find_duplicates_cmd(
    window: Window,
    directory: String,
    recursive: bool,
    exclude_patterns: Vec<String>,
) -> Result<Vec<DuplicateGroup>, String> {
    tokio::task::spawn_blocking(move || {
        duplicates::find_duplicates(&directory, recursive, &exclude_patterns, |progress| {
            let _ = window.emit("duplicate-scan-progress", progress);
        })
    })
    .await
    .map_err(|e| format!("Failed to join duplicate scan task: {e}"))?
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn watch_set_paths(
    paths: Vec<String>,
    app: AppHandle,
    state: State<WatchManager>,
) -> Result<(), String> {
    state.restart(app, paths);
    Ok(())
}

fn main() {
    let builder = tauri::Builder::default()
        .manage(WatchManager::default())
        .manage(ios::execution::IosExecutionManager::default())
        .manage(ios::mirror_preview::IosMirrorPreviewManager::default())
        .manage(pty::PtyManager::new())
        .manage(mole_analyze::MoleAnalyzeManager::default())
        .manage(mole_clean_pty::MoleCleanPtyManager::default())
        .on_system_tray_event(handle_tray_event)
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                app.set_activation_policy(tauri::ActivationPolicy::Regular);
            }

            if let Some(window) = app.get_window("main") {
                hud::restore_main_window_size(&app.handle());
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            macos_dock::install_reopen_handler(&app.handle());

            let _ = hud::ensure_popover_window(&app.handle());

            let tray = hud::build_tray();
            let _ = tray.build(app)?;
            register_shortcut(&app.handle());
            ios::execution::register_emergency_shortcut(&app.handle());
            Ok(())
        })
        .on_window_event(|event| {
            if event.window().label() != HUD_WINDOW_LABEL
                && event.window().label() != HUD_POPOVER_LABEL
            {
                return;
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event.event() {
                api.prevent_close();
                let window = event.window();
                let _ = window.hide();
                return;
            }
            match event.event() {
                tauri::WindowEvent::Moved(position) => {
                    hud_position::remember_hud_window_position(event.window(), *position);
                }
                tauri::WindowEvent::Resized(size) => {
                    hud::remember_main_window_size(event.window(), *size);
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            ai_commands::check_ollama,
            ai_commands::test_api_connection,
            ai_commands::ai_test_provider,
            organize_commands::scan_directory,
            organize_commands::organize_files,
            organize_commands::scan_folders_cmd,
            organize_commands::organize_folders,
            organize_commands::undo_organize,
            ios::commands::ios_capabilities,
            ios::commands::ios_open_mirroring,
            ios::commands::ios_reveal_current_app,
            ios::commands::ios_open_permission_settings,
            ios::commands::ios_request_permission,
            ios::commands::ios_set_mirror_preview,
            ios::commands::ios_stop_mirror_preview,
            ios::commands::ios_enter_mirror_interaction,
            ios::commands::ios_exit_mirror_interaction,
            ios::commands::ios_capture_snapshot,
            ios::commands::ios_scan_inventory,
            ios::commands::ios_create_plan,
            ios::commands::ios_start_execution,
            ios::commands::ios_resume_execution,
            ios::commands::ios_pause_execution,
            ios::commands::ios_cancel_execution,
            ios::commands::ios_prepare_restore,
            find_duplicates_cmd,
            watch_set_paths,
            dashboard_cache::dashboard_cache_load,
            dashboard_cache::dashboard_cache_save,
            result_cache::result_cache_load,
            result_cache::result_cache_save,
            result_cache::result_cache_delete,
            app_icons::app_icon_data_url_batch_json,
            deepclean::mole_check,
            deepclean::mole_status_json,
            deepclean::mole_status_raw_json,
            mole_analyze::process::mole_analyze_json,
            mole_analyze::mole_analyze_json_stream,
            mole_analyze::manager::mole_analyze_cancel,
            mole_purge::mole_purge_preview,
            mole_purge::mole_purge_execute,
            mole_doctor::mole_doctor_json,
            mole_capabilities::mole_app_update_capability_json,
            mole_capabilities::mole_windows_compat_report,
            mole_clean::mole_clean_preview,
            mole_clean::mole_clean_preview_stream,
            mole_clean_execute_pty::mole_clean_execute_pty,
            mole_clean_pty::mole_clean_preview_pty,
            mole_clean_pty::mole_clean_preview_pty_submit_interaction,
            mole_clean_pty::mole_clean_preview_pty_cancel,
            mole_installer::mole_installer_preview,
            mole_installer::mole_installer_execute,
            mole_optimize::mole_optimize_health_json,
            mole_optimize_execute::mole_optimize_execute,
            mole_uninstall::mole_uninstall_list_json,
            mole_uninstall::mole_uninstall_preview,
            mole_uninstall::mole_uninstall_execute,
            hud::hud_set_tray_labels,
            hud::hud_apply_tray_config,
            hud::hud_set_shortcut,
            hud::hud_open_popover,
            hud::hud_start_dragging,
            hud::hud_apply_window_mode,
            hud_position::hud_remember_position,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            stowmind_supplements::app_updates::stowmind_supplement_app_update_scan,
            stowmind_supplements::app_updates::stowmind_supplement_app_update_action,
            stowmind_supplements::safe_trash::stowmind_supplement_move_to_trash,
            system_settings::system_settings_state,
            system_settings::set_system_launch_at_login,
            system_settings::open_system_settings,
        ]);

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
