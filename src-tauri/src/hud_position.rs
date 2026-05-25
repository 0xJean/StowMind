use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, Position, Window};

const HUD_POSITION_FILE: &str = "hud-position.json";

#[derive(Clone, Copy, Debug, serde::Deserialize, serde::Serialize)]
struct SavedHudPosition {
    x: i32,
    y: i32,
}

impl From<PhysicalPosition<i32>> for SavedHudPosition {
    fn from(position: PhysicalPosition<i32>) -> Self {
        Self {
            x: position.x,
            y: position.y,
        }
    }
}

impl From<SavedHudPosition> for PhysicalPosition<i32> {
    fn from(position: SavedHudPosition) -> Self {
        PhysicalPosition::new(position.x, position.y)
    }
}

fn hud_position_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path_resolver()
        .app_config_dir()
        .map(|dir| dir.join(HUD_POSITION_FILE))
}

fn load_saved_hud_position(app: &AppHandle) -> Option<SavedHudPosition> {
    let path = hud_position_path(app)?;
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str::<SavedHudPosition>(&raw).ok()
}

fn save_hud_position(app: &AppHandle, position: SavedHudPosition) -> Result<(), String> {
    let Some(path) = hud_position_path(app) else {
        return Ok(());
    };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create HUD position directory: {e}"))?;
    }
    let raw = serde_json::to_string(&position)
        .map_err(|e| format!("Failed to encode HUD position: {e}"))?;
    std::fs::write(path, raw).map_err(|e| format!("Failed to save HUD position: {e}"))
}

pub fn remember_hud_window_position(window: &Window, position: PhysicalPosition<i32>) {
    if window.label() != crate::hud::HUD_POPOVER_LABEL {
        return;
    }
    let _ = save_hud_position(&window.app_handle(), position.into());
}

pub fn restore_hud_window_position_or_center(app: &AppHandle, window: &Window) {
    if let Some(position) = load_saved_hud_position(app) {
        let physical: PhysicalPosition<i32> = position.into();
        if position_is_visible(window, physical) {
            let _ = window.set_position(Position::Physical(physical));
            return;
        }
    }
    let _ = window.center();
}

fn position_is_visible(window: &Window, position: PhysicalPosition<i32>) -> bool {
    let Ok(Some(monitor)) = window.current_monitor() else {
        return true;
    };
    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    let window_size = window
        .outer_size()
        .unwrap_or_else(|_| PhysicalSize::new(420, 720));
    let max_x = monitor_position.x + monitor_size.width as i32;
    let max_y = monitor_position.y + monitor_size.height as i32;
    let visible_width = (window_size.width as i32 / 3).max(80);
    let visible_height = 80;

    position.x + visible_width >= monitor_position.x
        && position.y + visible_height >= monitor_position.y
        && position.x < max_x
        && position.y < max_y
}

#[tauri::command]
pub fn hud_remember_position(window: Window) -> Result<(), String> {
    if window.label() != crate::hud::HUD_POPOVER_LABEL {
        return Ok(());
    }
    let position = window
        .outer_position()
        .map_err(|e| format!("Failed to read HUD position: {e}"))?;
    save_hud_position(&window.app_handle(), position.into())
}
