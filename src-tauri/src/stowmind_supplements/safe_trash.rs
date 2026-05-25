//! StowMind supplement for Analyze delete.
//!
//! Mole does not currently expose a safe Analyze delete CLI / JSON API. This
//! adapter fills that UI gap by moving a user-confirmed path to the operating
//! system trash / recycle bin. It is not a Mole capability and must be presented
//! as `stowmind_supplement` in the UI.

use serde::Serialize;
use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Debug, Serialize)]
pub struct StowmindSupplementTrashResult {
    pub source: String,
    pub operation: String,
    pub original_path: String,
    pub trash_path: Option<String>,
    pub message: String,
}

#[tauri::command]
pub async fn stowmind_supplement_move_to_trash(
    path: String,
) -> Result<StowmindSupplementTrashResult, String> {
    tokio::task::spawn_blocking(move || move_to_trash(path))
        .await
        .map_err(|e| format!("Failed to finish trash operation: {e}"))?
}

fn move_to_trash(path: String) -> Result<StowmindSupplementTrashResult, String> {
    let original = validate_target(&path)?;
    let is_dir = original.is_dir();
    let trash_path = platform_trash(&original, is_dir)?;

    Ok(StowmindSupplementTrashResult {
        source: "stowmind_supplement".to_string(),
        operation: "move_to_trash".to_string(),
        original_path: original.to_string_lossy().to_string(),
        trash_path: trash_path
            .as_ref()
            .map(|path| path.to_string_lossy().to_string()),
        message: "Moved to system trash".to_string(),
    })
}

fn validate_target(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Path is required".to_string());
    }

    let target = PathBuf::from(trimmed);
    if !target.is_absolute() {
        return Err("Only absolute paths can be moved to trash".to_string());
    }

    let canonical =
        fs::canonicalize(&target).map_err(|e| format!("Failed to locate path for trash: {e}"))?;
    if is_protected_target(&canonical) {
        return Err(format!(
            "Refusing to trash protected top-level path: {}",
            canonical.display()
        ));
    }
    Ok(canonical)
}

fn is_protected_target(path: &Path) -> bool {
    if path.parent().is_none() || path.file_name().is_none() {
        return true;
    }

    if let Some(home) = home_dir() {
        if path == home {
            return true;
        }
    }

    let protected = [
        Path::new("/Applications"),
        Path::new("/Library"),
        Path::new("/System"),
        Path::new("/Users"),
        Path::new("/Volumes"),
    ];
    if protected.iter().any(|item| path == *item) {
        return true;
    }

    #[cfg(target_os = "windows")]
    {
        if path.components().count() <= 2 {
            return true;
        }
    }

    false
}

#[cfg(target_os = "macos")]
fn platform_trash(path: &Path, _is_dir: bool) -> Result<Option<PathBuf>, String> {
    let script = r#"
on run argv
  tell application "Finder"
    delete POSIX file (item 1 of argv)
  end tell
end run
"#;
    let output = Command::new("osascript")
        .args(["-e", script])
        .arg(path)
        .output();

    if let Ok(output) = output {
        if output.status.success() {
            return Ok(None);
        }
    }

    move_to_local_trash(path).map(Some)
}

#[cfg(target_os = "windows")]
fn platform_trash(path: &Path, is_dir: bool) -> Result<Option<PathBuf>, String> {
    let script = r#"
Add-Type -AssemblyName Microsoft.VisualBasic
$p = $args[0]
$isDir = $args[1] -eq 'true'
if ($isDir) {
  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)
} else {
  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)
}
"#;
    let output = Command::new("powershell.exe")
        .args([
            "-NoLogo",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .arg(path)
        .arg(if is_dir { "true" } else { "false" })
        .output()
        .map_err(|e| format!("Failed to invoke Windows recycle bin: {e}"))?;

    if output.status.success() {
        Ok(None)
    } else {
        Err(output_text(&output))
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn platform_trash(path: &Path, _is_dir: bool) -> Result<Option<PathBuf>, String> {
    if Command::new("gio")
        .args(["trash", path.to_string_lossy().as_ref()])
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
    {
        return Ok(None);
    }

    move_to_local_trash(path).map(Some)
}

fn move_to_local_trash(path: &Path) -> Result<PathBuf, String> {
    let trash_dir = home_dir()
        .ok_or_else(|| "Home directory is unavailable for trash".to_string())?
        .join(".Trash");
    fs::create_dir_all(&trash_dir).map_err(|e| format!("Failed to create trash directory: {e}"))?;

    let target = unique_trash_path(&trash_dir, path)?;
    fs::rename(path, &target).map_err(|e| format!("Failed to move item to trash: {e}"))?;
    Ok(target)
}

fn unique_trash_path(trash_dir: &Path, source: &Path) -> Result<PathBuf, String> {
    let file_name = source
        .file_name()
        .ok_or_else(|| "Path has no file name".to_string())?
        .to_string_lossy();
    let candidate = trash_dir.join(file_name.as_ref());
    if !candidate.exists() {
        return Ok(candidate);
    }

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    for index in 1..1000 {
        let next = trash_dir.join(format!("{file_name}.{stamp}.{index}"));
        if !next.exists() {
            return Ok(next);
        }
    }
    Err("Failed to allocate a unique trash path".to_string())
}

fn home_dir() -> Option<PathBuf> {
    env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("USERPROFILE").map(PathBuf::from))
}

#[cfg(target_os = "windows")]
fn output_text(output: &std::process::Output) -> String {
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if stderr.trim().is_empty() {
        stdout
    } else {
        format!("{stdout}\n{stderr}")
    }
}

#[cfg(test)]
mod tests {
    use super::{is_protected_target, unique_trash_path};
    use std::path::Path;

    #[test]
    fn rejects_root_paths() {
        assert!(is_protected_target(Path::new("/")));
        assert!(is_protected_target(Path::new("/Applications")));
    }

    #[test]
    fn creates_unique_fallback_name() {
        let trash = std::env::temp_dir().join("stowmind-trash-test");
        let _ = std::fs::create_dir_all(&trash);
        let source = trash.join("sample.log");
        let existing = trash.join("sample.log");
        std::fs::write(&existing, "x").unwrap();

        let unique = unique_trash_path(&trash, &source).unwrap();
        assert_ne!(unique, existing);
        let _ = std::fs::remove_file(existing);
        let _ = std::fs::remove_dir(trash);
    }
}
