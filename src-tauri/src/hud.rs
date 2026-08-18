use tauri::{
    AppHandle, CustomMenuItem, GlobalShortcutManager, LogicalSize, Manager, PhysicalSize,
    SystemTray, SystemTrayEvent, SystemTrayMenu, SystemTrayMenuItem, Window, WindowBuilder,
    WindowUrl,
};

pub const HUD_WINDOW_LABEL: &str = "main";
pub const HUD_POPOVER_LABEL: &str = "hud-popover";
pub const HUD_TOGGLE_EVENT: &str = "hud-toggle";
pub const HUD_TRAY_ID: &str = "stowmind-tray";
pub const HUD_SHORTCUT: &str = "CmdOrCtrl+Shift+H";
const DEFAULT_APP_WIDTH: f64 = 1280.0;
const DEFAULT_APP_HEIGHT: f64 = 820.0;
const MIN_APP_WIDTH: f64 = 1100.0;
const MIN_APP_HEIGHT: f64 = 680.0;
const COMPACT_HUD_WIDTH: f64 = 560.0;
const COMPACT_HUD_HEIGHT: f64 = 640.0;
const POPOVER_HUD_WIDTH: f64 = 420.0;
const POPOVER_HUD_HEIGHT: f64 = 720.0;
const WINDOW_STATE_FILE: &str = "window-state.json";

#[derive(Clone, Copy, Debug, serde::Deserialize, serde::Serialize)]
struct SavedWindowState {
    width: f64,
    height: f64,
}

impl SavedWindowState {
    fn clamped(self) -> Self {
        Self {
            width: self.width.clamp(MIN_APP_WIDTH, 2400.0),
            height: self.height.clamp(MIN_APP_HEIGHT, 1800.0),
        }
    }
}

#[cfg(target_os = "macos")]
#[allow(unexpected_cfgs)]
fn apply_activation_policy(_: &AppHandle, hide_dock_icon: bool) {
    use objc::runtime::Object;
    use objc::{class, msg_send, sel, sel_impl};

    let policy: isize = if hide_dock_icon { 1 } else { 0 };
    unsafe {
        let app: *mut Object = msg_send![class!(NSApplication), sharedApplication];
        let _: bool = msg_send![app, setActivationPolicy: policy];
        if !hide_dock_icon {
            let _: () = msg_send![app, activateIgnoringOtherApps: true];
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn apply_activation_policy(_: &AppHandle, _: bool) {}

pub fn show_dashboard(app: &AppHandle) {
    if let Some(window) = app.get_window(HUD_WINDOW_LABEL) {
        let _ = restore_app_window_size(app, &window);
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn default_app_size() -> SavedWindowState {
    SavedWindowState {
        width: DEFAULT_APP_WIDTH,
        height: DEFAULT_APP_HEIGHT,
    }
}

fn compact_app_size() -> SavedWindowState {
    SavedWindowState {
        width: COMPACT_HUD_WIDTH,
        height: COMPACT_HUD_HEIGHT,
    }
}

fn popover_size() -> SavedWindowState {
    SavedWindowState {
        width: POPOVER_HUD_WIDTH,
        height: POPOVER_HUD_HEIGHT,
    }
}

fn window_state_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path_resolver()
        .app_config_dir()
        .map(|dir| dir.join(WINDOW_STATE_FILE))
}

fn load_saved_window_state(app: &AppHandle) -> SavedWindowState {
    let Some(path) = window_state_path(app) else {
        return default_app_size();
    };
    let Ok(raw) = std::fs::read_to_string(path) else {
        return default_app_size();
    };
    serde_json::from_str::<SavedWindowState>(&raw)
        .map(SavedWindowState::clamped)
        .unwrap_or_else(|_| default_app_size())
}

fn save_window_state(app: &AppHandle, state: SavedWindowState) -> Result<(), String> {
    let Some(path) = window_state_path(app) else {
        return Ok(());
    };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create window state directory: {e}"))?;
    }
    let raw = serde_json::to_string(&state.clamped())
        .map_err(|e| format!("Failed to encode window state: {e}"))?;
    std::fs::write(path, raw).map_err(|e| format!("Failed to save window state: {e}"))
}

fn apply_window_size(window: &Window, state: SavedWindowState) -> Result<(), String> {
    window
        .set_size(LogicalSize::new(state.width, state.height))
        .map_err(|e| format!("Failed to update window size: {e}"))
}

fn restore_app_window_size(app: &AppHandle, window: &Window) -> Result<(), String> {
    let state = load_saved_window_state(app);
    window
        .set_min_size(Some(LogicalSize::new(MIN_APP_WIDTH, MIN_APP_HEIGHT)))
        .map_err(|e| format!("Failed to restore app minimum size: {e}"))?;
    window
        .set_resizable(true)
        .map_err(|e| format!("Failed to restore app resizability: {e}"))?;
    apply_window_size(window, state)?;
    window
        .set_decorations(true)
        .map_err(|e| format!("Failed to restore HUD decorations: {e}"))?;
    window
        .set_always_on_top(false)
        .map_err(|e| format!("Failed to restore HUD z-order: {e}"))?;
    Ok(())
}

pub fn restore_main_window_size(app: &AppHandle) {
    if let Some(window) = app.get_window(HUD_WINDOW_LABEL) {
        let _ = restore_app_window_size(app, &window);
    }
}

pub fn remember_main_window_size(window: &Window, size: PhysicalSize<u32>) {
    if window.label() != HUD_WINDOW_LABEL {
        return;
    }
    if matches!(window.is_resizable(), Ok(false)) {
        return;
    }
    let Ok(scale_factor) = window.scale_factor() else {
        return;
    };
    let logical = size.to_logical::<f64>(scale_factor);
    let state = SavedWindowState {
        width: logical.width,
        height: logical.height,
    };
    if state.width < MIN_APP_WIDTH || state.height < MIN_APP_HEIGHT {
        return;
    }
    let _ = save_window_state(&window.app_handle(), state);
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HudTrayLabels {
    pub open_hud: String,
    pub open_clean: String,
    pub open_uninstall: String,
    pub open_optimize: String,
    pub open_analyze: String,
    pub open_status: String,
    pub open_organize: String,
    pub open_console: String,
    pub open_settings: String,
    pub quit: String,
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HudTrayConfig {
    pub labels: HudTrayLabels,
    pub title: String,
    pub tooltip: String,
}

pub fn build_tray() -> SystemTray {
    SystemTray::new()
        .with_id(HUD_TRAY_ID)
        .with_tooltip("StowMind")
        .with_menu(build_tray_menu(&default_tray_labels()))
}

fn default_tray_labels() -> HudTrayLabels {
    HudTrayLabels {
        open_hud: "Open HUD".to_string(),
        open_clean: "Clean".to_string(),
        open_uninstall: "Uninstall".to_string(),
        open_optimize: "Optimize".to_string(),
        open_analyze: "Analyze".to_string(),
        open_status: "Open Status".to_string(),
        open_organize: "AI Organize".to_string(),
        open_console: "Mole Console".to_string(),
        open_settings: "Settings".to_string(),
        quit: "Quit".to_string(),
    }
}

fn build_tray_menu(labels: &HudTrayLabels) -> SystemTrayMenu {
    SystemTrayMenu::new()
        .add_item(CustomMenuItem::new("hud", labels.open_hud.clone()))
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(CustomMenuItem::new("clean", labels.open_clean.clone()))
        .add_item(CustomMenuItem::new(
            "uninstall",
            labels.open_uninstall.clone(),
        ))
        .add_item(CustomMenuItem::new(
            "optimize",
            labels.open_optimize.clone(),
        ))
        .add_item(CustomMenuItem::new("analyze", labels.open_analyze.clone()))
        .add_item(CustomMenuItem::new("status", labels.open_status.clone()))
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(CustomMenuItem::new(
            "organize",
            labels.open_organize.clone(),
        ))
        .add_item(CustomMenuItem::new("console", labels.open_console.clone()))
        .add_item(CustomMenuItem::new(
            "settings",
            labels.open_settings.clone(),
        ))
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(CustomMenuItem::new("quit", labels.quit.clone()))
}

pub fn register_shortcut(app: &AppHandle) {
    let _ = register_shortcut_with_accelerator(app, HUD_SHORTCUT);
}

fn register_shortcut_with_accelerator(app: &AppHandle, shortcut: &str) -> Result<(), String> {
    let handle = app.clone();
    let mut manager = app.global_shortcut_manager();
    manager
        .register(shortcut, move || {
            let app = handle.clone();
            toggle_hud(&app);
        })
        .map_err(|e| format!("Failed to register HUD shortcut: {e}"))
}

pub fn show_route(app: &AppHandle, route: &str) {
    if let Some(window) = app.get_window(HUD_WINDOW_LABEL) {
        if route != "/hud" {
            let _ = restore_app_window_size(app, &window);
        }
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        let _ = app.emit_to(HUD_WINDOW_LABEL, HUD_TOGGLE_EVENT, format!("route:{route}"));
    }
}

pub fn ensure_popover_window(app: &AppHandle) -> Result<(), String> {
    if app.get_window(HUD_POPOVER_LABEL).is_some() {
        return Ok(());
    }

    let window = WindowBuilder::new(app, HUD_POPOVER_LABEL, WindowUrl::App("index.html".into()))
        .title("StowMind HUD")
        .inner_size(POPOVER_HUD_WIDTH, POPOVER_HUD_HEIGHT)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .build()
        .map_err(|e| format!("Failed to create HUD popover: {e}"))?;

    crate::hud_position::restore_hud_window_position_or_center(app, &window);
    Ok(())
}

fn show_hud_popover(app: &AppHandle) {
    if app.get_window(HUD_POPOVER_LABEL).is_none() {
        let _ = ensure_popover_window(app);
    }

    if let Some(window) = app.get_window(HUD_POPOVER_LABEL) {
        let _ = apply_window_size(&window, popover_size());
        let _ = window.set_decorations(false);
        let _ = window.set_always_on_top(true);
        let _ = window.set_skip_taskbar(true);
        crate::hud_position::restore_hud_window_position_or_center(app, &window);
        let _ = app.emit_to(HUD_POPOVER_LABEL, HUD_TOGGLE_EVENT, "hud");
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    } else {
        show_route(app, "/hud");
    }
}

pub fn toggle_hud(app: &AppHandle) {
    let Some(window) = app.get_window(HUD_POPOVER_LABEL) else {
        show_hud_popover(app);
        return;
    };

    match window.is_visible() {
        Ok(true) => {
            let _ = window.hide();
        }
        _ => show_hud_popover(app),
    }
}

pub fn handle_tray_event(app: &AppHandle, event: SystemTrayEvent) {
    match event {
        SystemTrayEvent::LeftClick { .. } => toggle_hud(app),
        SystemTrayEvent::MenuItemClick { id, .. } => match id.as_ref() {
            "hud" => toggle_hud(app),
            "clean" => show_route(app, "/clean"),
            "uninstall" => show_route(app, "/apps"),
            "optimize" => show_route(app, "/optimize"),
            "analyze" => show_route(app, "/analyze"),
            "status" => show_route(app, "/status"),
            "organize" => show_route(app, "/organize"),
            "console" => show_route(app, "/deepclean"),
            "settings" => show_route(app, "/settings"),
            "quit" => app.exit(0),
            _ => {}
        },
        _ => {}
    }
}

#[tauri::command]
pub fn hud_set_tray_labels(app: AppHandle, labels: HudTrayLabels) -> Result<(), String> {
    let tray = app
        .tray_handle_by_id(HUD_TRAY_ID)
        .ok_or_else(|| "StowMind tray not found".to_string())?;
    tray.set_menu(build_tray_menu(&labels))
        .map_err(|e| format!("Failed to update tray menu: {e}"))
}

#[tauri::command]
pub fn hud_apply_tray_config(app: AppHandle, config: HudTrayConfig) -> Result<(), String> {
    let tray = app
        .tray_handle_by_id(HUD_TRAY_ID)
        .ok_or_else(|| "StowMind tray not found".to_string())?;
    tray.set_menu(build_tray_menu(&config.labels))
        .map_err(|e| format!("Failed to update tray menu: {e}"))?;
    tray.set_title(config.title.trim())
        .map_err(|e| format!("Failed to update tray title: {e}"))?;
    tray.set_tooltip(config.tooltip.trim())
        .map_err(|e| format!("Failed to update tray tooltip: {e}"))
}

#[tauri::command]
pub fn hud_set_shortcut(app: AppHandle, shortcut: String) -> Result<String, String> {
    let next = shortcut.trim();
    if next.is_empty() {
        return Err("Shortcut is required".to_string());
    }

    let mut manager = app.global_shortcut_manager();
    let _ = manager.unregister_all();
    drop(manager);
    register_shortcut_with_accelerator(&app, next)?;
    Ok(next.to_string())
}

#[tauri::command]
pub fn hud_open_popover(app: AppHandle) -> Result<(), String> {
    ensure_popover_window(&app)?;
    show_hud_popover(&app);
    Ok(())
}

#[tauri::command]
pub fn hud_start_dragging(window: Window) -> Result<(), String> {
    window
        .start_dragging()
        .map_err(|e| format!("Failed to start dragging HUD window: {e}"))
}

#[tauri::command]
pub fn hud_apply_window_mode(
    app: AppHandle,
    window: Window,
    compact: bool,
    always_on_top: bool,
    hide_dock_icon: bool,
    center: Option<bool>,
) -> Result<(), String> {
    let should_center = center.unwrap_or(false);
    let popover = window.label() == HUD_POPOVER_LABEL;
    if !popover {
        apply_activation_policy(&app, hide_dock_icon);
    }
    if popover {
        apply_window_size(&window, popover_size())?;
        window
            .set_min_size(Some(LogicalSize::new(
                POPOVER_HUD_WIDTH,
                POPOVER_HUD_HEIGHT,
            )))
            .map_err(|e| format!("Failed to set HUD minimum size: {e}"))?;
        window
            .set_resizable(false)
            .map_err(|e| format!("Failed to update HUD resizability: {e}"))?;
        window
            .set_decorations(false)
            .map_err(|e| format!("Failed to update HUD decorations: {e}"))?;
        window
            .set_always_on_top(true)
            .map_err(|e| format!("Failed to update HUD z-order: {e}"))?;
        if should_center {
            crate::hud_position::restore_hud_window_position_or_center(&app, &window);
        }
    } else if compact {
        apply_window_size(&window, compact_app_size())?;
        window
            .set_min_size(Some(LogicalSize::new(
                COMPACT_HUD_WIDTH,
                COMPACT_HUD_HEIGHT,
            )))
            .map_err(|e| format!("Failed to set HUD minimum size: {e}"))?;
        window
            .set_resizable(false)
            .map_err(|e| format!("Failed to update HUD resizability: {e}"))?;
        window
            .set_decorations(false)
            .map_err(|e| format!("Failed to update HUD decorations: {e}"))?;
        window
            .set_always_on_top(always_on_top)
            .map_err(|e| format!("Failed to update HUD z-order: {e}"))?;
        if should_center {
            let _ = window.center();
        }
    } else {
        restore_app_window_size(&app, &window)?;
        if should_center {
            let _ = window.center();
        }
    }
    window
        .set_skip_taskbar(hide_dock_icon || popover)
        .map_err(|e| format!("Failed to update taskbar visibility: {e}"))?;
    Ok(())
}
