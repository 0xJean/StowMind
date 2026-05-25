use crate::stowmind_db::open_app_db;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

const DASHBOARD_KEY: &str = "home";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardCacheSnapshot {
    pub schema_version: u32,
    pub updated_at: String,
    pub payload: serde_json::Value,
}

#[tauri::command]
pub fn dashboard_cache_load(app: AppHandle) -> Result<Option<DashboardCacheSnapshot>, String> {
    let conn = open_db(&app)?;
    let row = conn
        .query_row(
            "SELECT schema_version, updated_at, payload FROM dashboard_snapshots WHERE key = ?1",
            params![DASHBOARD_KEY],
            |row| {
                let payload_raw: String = row.get(2)?;
                Ok((row.get::<_, u32>(0)?, row.get::<_, String>(1)?, payload_raw))
            },
        )
        .optional()
        .map_err(|e| format!("Failed to load dashboard cache: {e}"))?;

    let Some((schema_version, updated_at, payload_raw)) = row else {
        return Ok(None);
    };
    let payload = serde_json::from_str::<serde_json::Value>(&payload_raw)
        .map_err(|e| format!("Dashboard cache is invalid JSON: {e}"))?;

    Ok(Some(DashboardCacheSnapshot {
        schema_version,
        updated_at,
        payload,
    }))
}

#[tauri::command]
pub fn dashboard_cache_save(
    app: AppHandle,
    snapshot: DashboardCacheSnapshot,
) -> Result<(), String> {
    let conn = open_db(&app)?;
    let payload = serde_json::to_string(&snapshot.payload)
        .map_err(|e| format!("Failed to encode dashboard cache: {e}"))?;

    conn.execute(
        "INSERT INTO dashboard_snapshots (key, schema_version, updated_at, payload)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(key) DO UPDATE SET
           schema_version = excluded.schema_version,
           updated_at = excluded.updated_at,
           payload = excluded.payload",
        params![
            DASHBOARD_KEY,
            snapshot.schema_version,
            snapshot.updated_at,
            payload
        ],
    )
    .map_err(|e| format!("Failed to save dashboard cache: {e}"))?;

    Ok(())
}

fn open_db(app: &AppHandle) -> Result<Connection, String> {
    let conn = open_app_db(app)?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS dashboard_snapshots (
          key TEXT PRIMARY KEY,
          schema_version INTEGER NOT NULL,
          updated_at TEXT NOT NULL,
          payload TEXT NOT NULL
        );",
    )
    .map_err(|e| format!("Failed to initialize dashboard cache: {e}"))?;
    Ok(conn)
}
