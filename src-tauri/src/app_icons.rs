#![allow(unexpected_cfgs)]

use crate::stowmind_db::open_app_db;
use rusqlite::{params, OptionalExtension};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

#[cfg(target_os = "macos")]
mod platform {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use objc::runtime::Object;
    use objc::{class, msg_send, sel, sel_impl};

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct NSSize {
        width: f64,
        height: f64,
    }

    pub fn app_icon_data_url(path: &str) -> Option<String> {
        let bytes = app_icon_png(path)?;
        Some(format!("data:image/png;base64,{}", STANDARD.encode(bytes)))
    }

    fn app_icon_png(path: &str) -> Option<Vec<u8>> {
        let path = path.trim();
        if path.is_empty() {
            return None;
        }

        unsafe {
            let pool: *mut Object = msg_send![class!(NSAutoreleasePool), new];
            let result = app_icon_png_inner(path);
            let _: () = msg_send![pool, drain];
            result
        }
    }

    unsafe fn app_icon_png_inner(path: &str) -> Option<Vec<u8>> {
        let ns_path = ns_string(path)?;
        let workspace: *mut Object = msg_send![class!(NSWorkspace), sharedWorkspace];
        let image: *mut Object = msg_send![workspace, iconForFile: ns_path];
        let _: () = msg_send![ns_path, release];

        if image.is_null() {
            return None;
        }

        let size = NSSize {
            width: 64.0,
            height: 64.0,
        };
        let _: () = msg_send![image, setSize: size];

        let tiff_data: *mut Object = msg_send![image, TIFFRepresentation];
        if tiff_data.is_null() {
            return None;
        }

        let bitmap: *mut Object = msg_send![class!(NSBitmapImageRep), imageRepWithData: tiff_data];
        if bitmap.is_null() {
            return None;
        }

        let properties: *mut Object = msg_send![class!(NSDictionary), dictionary];
        let png_data: *mut Object =
            msg_send![bitmap, representationUsingType: 4usize properties: properties];
        if png_data.is_null() {
            return None;
        }

        let length: usize = msg_send![png_data, length];
        let bytes: *const u8 = msg_send![png_data, bytes];
        if length == 0 || bytes.is_null() {
            return None;
        }

        Some(std::slice::from_raw_parts(bytes, length).to_vec())
    }

    unsafe fn ns_string(value: &str) -> Option<*mut Object> {
        let string: *mut Object = msg_send![class!(NSString), alloc];
        let string: *mut Object = msg_send![
            string,
            initWithBytes: value.as_ptr()
            length: value.len()
            encoding: 4usize
        ];
        if string.is_null() {
            None
        } else {
            Some(string)
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    pub fn app_icon_data_url(_: &str) -> Option<String> {
        None
    }
}

pub use platform::app_icon_data_url;

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppIconDataUrlResult {
    pub path: String,
    pub icon_data_url: Option<String>,
}

#[tauri::command]
pub async fn app_icon_data_url_batch_json(
    app: AppHandle,
    paths: Vec<String>,
) -> Result<Vec<AppIconDataUrlResult>, String> {
    tokio::task::spawn_blocking(move || load_app_icon_batch(app, paths))
        .await
        .map_err(|e| format!("Failed to finish app icon task: {e}"))?
}

fn load_app_icon_batch(
    app: AppHandle,
    paths: Vec<String>,
) -> Result<Vec<AppIconDataUrlResult>, String> {
    let mut conn = open_app_icon_cache_db(&app)?;
    let paths = dedupe_paths(paths);
    let mut resolved = HashMap::<String, Option<String>>::new();
    let mut missing = Vec::<(String, i64)>::new();

    for path in &paths {
        let cache_stamp = app_icon_cache_stamp(path);
        match load_cached_icon(&conn, path, cache_stamp)? {
            Some(icon_data_url) => {
                resolved.insert(path.clone(), icon_data_url);
            }
            None => missing.push((path.clone(), cache_stamp)),
        }
    }

    let generated = generate_missing_icons(&missing);
    save_generated_icons(&mut conn, &generated)?;
    for (path, _, icon_data_url) in generated {
        resolved.insert(path, icon_data_url);
    }

    Ok(paths
        .into_iter()
        .map(|path| AppIconDataUrlResult {
            icon_data_url: resolved.remove(&path).unwrap_or(None),
            path,
        })
        .collect())
}

fn open_app_icon_cache_db(app: &AppHandle) -> Result<rusqlite::Connection, String> {
    let conn = open_app_db(app)?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS app_icon_cache (
          path TEXT PRIMARY KEY,
          cache_stamp INTEGER NOT NULL,
          icon_data_url TEXT,
          updated_at_epoch INTEGER NOT NULL
        );",
    )
    .map_err(|e| format!("Failed to initialize app icon cache: {e}"))?;
    Ok(conn)
}

fn load_cached_icon(
    conn: &rusqlite::Connection,
    path: &str,
    cache_stamp: i64,
) -> Result<Option<Option<String>>, String> {
    conn.query_row(
        "SELECT icon_data_url FROM app_icon_cache WHERE path = ?1 AND cache_stamp = ?2",
        params![path, cache_stamp],
        |row| row.get::<_, Option<String>>(0),
    )
    .optional()
    .map_err(|e| format!("Failed to read app icon cache: {e}"))
}

fn save_generated_icons(
    conn: &mut rusqlite::Connection,
    icons: &[(String, i64, Option<String>)],
) -> Result<(), String> {
    if icons.is_empty() {
        return Ok(());
    }
    let updated_at_epoch = unix_epoch();
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to begin app icon cache write: {e}"))?;
    {
        let mut statement = tx
            .prepare(
                "INSERT INTO app_icon_cache (path, cache_stamp, icon_data_url, updated_at_epoch)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(path) DO UPDATE SET
                   cache_stamp = excluded.cache_stamp,
                   icon_data_url = excluded.icon_data_url,
                   updated_at_epoch = excluded.updated_at_epoch",
            )
            .map_err(|e| format!("Failed to prepare app icon cache write: {e}"))?;
        for (path, cache_stamp, icon_data_url) in icons {
            statement
                .execute(params![path, cache_stamp, icon_data_url, updated_at_epoch])
                .map_err(|e| format!("Failed to write app icon cache: {e}"))?;
        }
    }
    tx.commit()
        .map_err(|e| format!("Failed to commit app icon cache: {e}"))
}

fn generate_missing_icons(missing: &[(String, i64)]) -> Vec<(String, i64, Option<String>)> {
    let mut icons = Vec::new();
    for chunk in missing.chunks(4) {
        icons.extend(std::thread::scope(|scope| {
            let handles = chunk
                .iter()
                .map(|(path, cache_stamp)| {
                    scope.spawn(move || (path.clone(), *cache_stamp, app_icon_data_url(path)))
                })
                .collect::<Vec<_>>();
            handles
                .into_iter()
                .filter_map(|handle| handle.join().ok())
                .collect::<Vec<_>>()
        }));
    }
    icons
}

fn dedupe_paths(paths: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    paths
        .into_iter()
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty() && seen.insert(path.clone()))
        .collect()
}

fn app_icon_cache_stamp(path: &str) -> i64 {
    let path = Path::new(path);
    let mut candidates = vec![path.to_path_buf()];
    candidates.push(path.join("Contents").join("Info.plist"));
    candidates.push(path.join("Contents").join("Resources"));

    candidates
        .into_iter()
        .filter_map(modified_millis)
        .max()
        .unwrap_or(0)
}

fn modified_millis(path: PathBuf) -> Option<i64> {
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
    modified
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_millis()).ok())
}

fn unix_epoch() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_secs()).ok())
        .unwrap_or(0)
}
