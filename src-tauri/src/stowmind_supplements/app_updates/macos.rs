#[cfg(not(target_os = "macos"))]
use super::types::empty_scan;
use super::types::StowmindSupplementAppUpdateScan;
#[cfg(target_os = "macos")]
use super::types::{
    refresh_counts, unix_epoch, StowmindSupplementAppUpdateItem, OPERATION, SOURCE,
};
use crate::mole_utils::current_platform;
#[cfg(target_os = "macos")]
use serde_json::Value;
#[cfg(target_os = "macos")]
use std::{
    collections::HashSet,
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};
#[cfg(target_os = "macos")]
use walkdir::WalkDir;

#[cfg(target_os = "macos")]
pub fn scan() -> Result<StowmindSupplementAppUpdateScan, String> {
    let directories = app_directories();
    let mut seen = HashSet::new();
    let mut items = Vec::new();

    for directory in &directories {
        if !directory.exists() {
            continue;
        }
        for app_path in discover_app_bundles(directory) {
            let canonical = fs::canonicalize(&app_path).unwrap_or(app_path);
            if !seen.insert(canonical.clone()) {
                continue;
            }
            if let Some(item) = read_app(&canonical) {
                items.push(item);
            }
        }
    }

    let mut scan = StowmindSupplementAppUpdateScan {
        source: SOURCE.to_string(),
        operation: OPERATION.to_string(),
        platform: current_platform().to_string(),
        generated_at_epoch: unix_epoch(),
        scan_status: "metadata_scanned".to_string(),
        message: "Scanned local app information for update sources.".to_string(),
        directories: directories
            .iter()
            .map(|path| path.to_string_lossy().to_string())
            .collect(),
        scanned_apps: items.len(),
        update_candidates: 0,
        app_store_apps: 0,
        sparkle_apps: 0,
        electron_apps: 0,
        items,
    };
    refresh_counts(&mut scan);
    Ok(scan)
}

#[cfg(not(target_os = "macos"))]
pub fn scan() -> Result<StowmindSupplementAppUpdateScan, String> {
    Ok(empty_scan(
        current_platform().to_string(),
        "unsupported",
        "macOS app bundle scanning is not available on this platform.",
    ))
}

#[cfg(target_os = "macos")]
fn app_directories() -> Vec<PathBuf> {
    let mut directories = vec![
        PathBuf::from("/Applications"),
        PathBuf::from("/System/Applications"),
    ];
    if let Some(home) = home_dir() {
        directories.push(home.join("Applications"));
    }
    directories
}

#[cfg(target_os = "macos")]
fn discover_app_bundles(directory: &Path) -> Vec<PathBuf> {
    WalkDir::new(directory)
        .max_depth(3)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_dir())
        .map(|entry| entry.into_path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "app"))
        .collect()
}

#[cfg(target_os = "macos")]
fn read_app(path: &Path) -> Option<StowmindSupplementAppUpdateItem> {
    let plist = read_plist_json(&path.join("Contents/Info.plist"))?;
    let name = plist_string(&plist, &["CFBundleDisplayName", "CFBundleName"]).or_else(|| {
        path.file_stem()
            .map(|name| name.to_string_lossy().to_string())
    })?;
    let bundle_id = plist_string(&plist, &["CFBundleIdentifier"]);
    let installed_version =
        plist_string(&plist, &["CFBundleShortVersionString", "CFBundleVersion"]);
    let feed_url = plist_string(&plist, &["SUFeedURL", "SUFeedURLForBeta"]);
    let app_store = path.join("Contents/_MASReceipt/receipt").exists();
    let electron = is_electron_app(path, &plist);
    let (provider, update_status, confidence, detail, action_kind, action_target, action_label) =
        initial_provider_state(
            app_store,
            feed_url.as_deref(),
            electron,
            &path.to_string_lossy(),
        );

    Some(StowmindSupplementAppUpdateItem {
        name,
        path: path.to_string_lossy().to_string(),
        bundle_id,
        installed_version,
        latest_version: None,
        provider,
        update_status,
        confidence,
        feed_url,
        detail,
        action_kind,
        action_target,
        action_label,
    })
}

#[cfg(target_os = "macos")]
fn read_plist_json(path: &Path) -> Option<Value> {
    let output = Command::new("plutil")
        .args(["-convert", "json", "-o", "-"])
        .arg(path)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    serde_json::from_slice(&output.stdout).ok()
}

#[cfg(target_os = "macos")]
fn is_electron_app(path: &Path, plist: &Value) -> bool {
    let frameworks = path.join("Contents/Frameworks");
    if frameworks.join("Electron Framework.framework").exists() {
        return true;
    }
    let resources = path.join("Contents/Resources");
    if resources.join("app.asar").exists() || resources.join("app-update.yml").exists() {
        return true;
    }
    let haystack = format!(
        "{} {}",
        plist_string(plist, &["NSPrincipalClass"]).unwrap_or_default(),
        plist_string(plist, &["CFBundleExecutable"]).unwrap_or_default()
    )
    .to_lowercase();
    haystack.contains("electron")
}

#[cfg(target_os = "macos")]
fn initial_provider_state(
    app_store: bool,
    feed_url: Option<&str>,
    electron: bool,
    path: &str,
) -> (
    String,
    String,
    String,
    String,
    Option<String>,
    Option<String>,
    Option<String>,
) {
    if feed_url.is_some() {
        return (
            "sparkle".to_string(),
            "checking".to_string(),
            "metadata_and_feed".to_string(),
            "Built-in updater detected; version check will run when reachable.".to_string(),
            Some("open_app".to_string()),
            Some(path.to_string()),
            Some("打开更新器".to_string()),
        );
    }
    if app_store {
        return (
            "app_store".to_string(),
            "unknown".to_string(),
            "metadata_only".to_string(),
            "App Store app detected; update availability may require App Store confirmation."
                .to_string(),
            Some("open_app_store".to_string()),
            None,
            Some("App Store".to_string()),
        );
    }
    if electron {
        return (
            "electron".to_string(),
            "unknown".to_string(),
            "metadata_only".to_string(),
            "In-app update channel detected; update availability may vary by vendor.".to_string(),
            Some("open_app".to_string()),
            Some(path.to_string()),
            Some("打开".to_string()),
        );
    }
    (
        "manual".to_string(),
        "unknown".to_string(),
        "metadata_only".to_string(),
        "No automatic update source was detected.".to_string(),
        Some("open_app".to_string()),
        Some(path.to_string()),
        Some("打开".to_string()),
    )
}

#[cfg(target_os = "macos")]
fn plist_string(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .filter_map(|key| json_string(value, key))
        .find(|value| !value.trim().is_empty())
}

#[cfg(target_os = "macos")]
fn json_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)?
        .as_str()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

#[cfg(target_os = "macos")]
fn home_dir() -> Option<PathBuf> {
    env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("USERPROFILE").map(PathBuf::from))
}
