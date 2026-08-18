use super::types::{IosExecutionSession, IosLayoutPlan, IosLayoutSnapshot};
use crate::stowmind_db::open_app_db;
use rusqlite::{params, Connection};
use serde::{de::DeserializeOwned, Serialize};
use tauri::AppHandle;

fn init(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS ios_snapshots (
            id TEXT PRIMARY KEY,
            captured_at TEXT NOT NULL,
            payload TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ios_plans (
            id TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            payload TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ios_execution_sessions (
            id TEXT PRIMARY KEY,
            updated_at TEXT NOT NULL,
            payload TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ios_preferences (
            key TEXT PRIMARY KEY,
            payload TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        "#,
    )
    .map_err(|error| format!("无法初始化 iOS 整理数据库：{error}"))
}

fn encode<T: Serialize>(value: &T) -> Result<String, String> {
    serde_json::to_string(value).map_err(|error| format!("无法保存 iOS 整理数据：{error}"))
}

fn decode<T: DeserializeOwned>(payload: String) -> Result<T, String> {
    serde_json::from_str(&payload).map_err(|error| format!("无法读取 iOS 整理数据：{error}"))
}

pub fn save_snapshot(app: &AppHandle, snapshot: &IosLayoutSnapshot) -> Result<(), String> {
    let conn = open_app_db(app)?;
    init(&conn)?;
    conn.execute(
        "INSERT OR REPLACE INTO ios_snapshots (id, captured_at, payload) VALUES (?1, ?2, ?3)",
        params![snapshot.id, snapshot.captured_at, encode(snapshot)?],
    )
    .map_err(|error| format!("无法保存 iOS 布局快照：{error}"))?;
    Ok(())
}

pub fn get_snapshot(app: &AppHandle, id: &str) -> Result<IosLayoutSnapshot, String> {
    let conn = open_app_db(app)?;
    init(&conn)?;
    let payload: String = conn
        .query_row(
            "SELECT payload FROM ios_snapshots WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|error| format!("找不到 iOS 布局快照：{error}"))?;
    decode(payload)
}

pub fn save_plan(app: &AppHandle, plan: &IosLayoutPlan) -> Result<(), String> {
    let conn = open_app_db(app)?;
    init(&conn)?;
    conn.execute(
        "INSERT OR REPLACE INTO ios_plans (id, created_at, payload) VALUES (?1, ?2, ?3)",
        params![plan.id, plan.created_at, encode(plan)?],
    )
    .map_err(|error| format!("无法保存 iOS 整理方案：{error}"))?;
    Ok(())
}

pub fn get_plan(app: &AppHandle, id: &str) -> Result<IosLayoutPlan, String> {
    let conn = open_app_db(app)?;
    init(&conn)?;
    let payload: String = conn
        .query_row(
            "SELECT payload FROM ios_plans WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|error| format!("找不到 iOS 整理方案：{error}"))?;
    decode(payload)
}

pub fn save_session(app: &AppHandle, session: &IosExecutionSession) -> Result<(), String> {
    let conn = open_app_db(app)?;
    init(&conn)?;
    conn.execute(
        "INSERT OR REPLACE INTO ios_execution_sessions (id, updated_at, payload) VALUES (?1, ?2, ?3)",
        params![session.id, session.updated_at, encode(session)?],
    )
    .map_err(|error| format!("无法保存 iOS 执行记录：{error}"))?;
    Ok(())
}

pub fn get_session(app: &AppHandle, id: &str) -> Result<IosExecutionSession, String> {
    let conn = open_app_db(app)?;
    init(&conn)?;
    let payload: String = conn
        .query_row(
            "SELECT payload FROM ios_execution_sessions WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|error| format!("找不到 iOS 执行记录：{error}"))?;
    decode(payload)
}
