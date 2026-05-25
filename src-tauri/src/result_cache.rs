use crate::stowmind_db::open_app_db;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultCacheSnapshot {
    pub key: String,
    pub schema_version: u32,
    pub updated_at: String,
    pub payload: serde_json::Value,
}

#[tauri::command]
pub fn result_cache_load(
    app: AppHandle,
    key: String,
) -> Result<Option<ResultCacheSnapshot>, String> {
    let conn = open_result_cache_db(&app)?;
    let row = conn
        .query_row(
            "SELECT key, schema_version, updated_at, payload FROM result_snapshots WHERE key = ?1",
            params![key],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, u32>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .optional()
        .map_err(|e| format!("Failed to load result cache: {e}"))?;

    let Some((key, schema_version, updated_at, payload_raw)) = row else {
        return Ok(None);
    };
    let payload = serde_json::from_str::<serde_json::Value>(&payload_raw)
        .map_err(|e| format!("Result cache is invalid JSON: {e}"))?;

    Ok(Some(ResultCacheSnapshot {
        key,
        schema_version,
        updated_at,
        payload,
    }))
}

#[tauri::command]
pub fn result_cache_save(app: AppHandle, snapshot: ResultCacheSnapshot) -> Result<(), String> {
    let conn = open_result_cache_db(&app)?;
    let payload = serde_json::to_string(&snapshot.payload)
        .map_err(|e| format!("Failed to encode result cache: {e}"))?;

    conn.execute(
        "INSERT INTO result_snapshots (key, schema_version, updated_at, payload)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(key) DO UPDATE SET
           schema_version = excluded.schema_version,
           updated_at = excluded.updated_at,
           payload = excluded.payload",
        params![
            snapshot.key,
            snapshot.schema_version,
            snapshot.updated_at,
            payload
        ],
    )
    .map_err(|e| format!("Failed to save result cache: {e}"))?;

    Ok(())
}

#[tauri::command]
pub fn result_cache_delete(app: AppHandle, key: String) -> Result<(), String> {
    let conn = open_result_cache_db(&app)?;
    conn.execute("DELETE FROM result_snapshots WHERE key = ?1", params![key])
        .map_err(|e| format!("Failed to delete result cache: {e}"))?;
    Ok(())
}

fn open_result_cache_db(app: &AppHandle) -> Result<rusqlite::Connection, String> {
    let conn = open_app_db(app)?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS result_snapshots (
          key TEXT PRIMARY KEY,
          schema_version INTEGER NOT NULL,
          updated_at TEXT NOT NULL,
          payload TEXT NOT NULL
        );",
    )
    .map_err(|e| format!("Failed to initialize result cache: {e}"))?;
    Ok(conn)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn result_snapshot_serializes_to_camel_case() {
        let snapshot = ResultCacheSnapshot {
            key: "test".to_string(),
            schema_version: 2,
            updated_at: "2026-05-21T00:00:00.000Z".to_string(),
            payload: serde_json::json!({ "ok": true }),
        };

        let encoded = serde_json::to_value(snapshot).unwrap();
        assert_eq!(encoded["schemaVersion"], 2);
        assert_eq!(encoded["updatedAt"], "2026-05-21T00:00:00.000Z");
    }
}
