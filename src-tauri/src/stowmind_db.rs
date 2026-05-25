use rusqlite::Connection;
use tauri::AppHandle;

const DB_FILE: &str = "stowmind.sqlite3";

pub fn open_app_db(app: &AppHandle) -> Result<Connection, String> {
    let dir = app
        .path_resolver()
        .app_data_dir()
        .ok_or_else(|| "Failed to resolve app data directory".to_string())?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create app data directory: {e}"))?;

    Connection::open(dir.join(DB_FILE))
        .map_err(|e| format!("Failed to open StowMind SQLite cache: {e}"))
}
