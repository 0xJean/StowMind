use std::collections::HashSet;
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::process::Command;

pub fn mo_cmd() -> &'static str {
    if cfg!(target_os = "windows") {
        "mo.cmd"
    } else {
        "mo"
    }
}

pub fn mole_command() -> Result<Command, String> {
    Ok(command_with_runtime_path(locate_mole_executable()?))
}

pub fn mole_tokio_command() -> Result<tokio::process::Command, String> {
    let mut command = tokio::process::Command::new(locate_mole_executable()?);
    command.env("PATH", runtime_path());
    Ok(command)
}

pub fn command_with_runtime_path<S: AsRef<OsStr>>(program: S) -> Command {
    let mut command = Command::new(program);
    command.env("PATH", runtime_path());
    command
}

pub fn runtime_path() -> OsString {
    let mut entries = Vec::new();
    if let Some(path) = std::env::var_os("PATH") {
        entries.extend(std::env::split_paths(&path));
    }

    if cfg!(target_os = "macos") {
        entries.extend([
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/opt/homebrew/sbin"),
            PathBuf::from("/usr/local/bin"),
            PathBuf::from("/usr/local/sbin"),
            PathBuf::from("/usr/bin"),
            PathBuf::from("/bin"),
            PathBuf::from("/usr/sbin"),
            PathBuf::from("/sbin"),
        ]);
    } else if cfg!(unix) {
        entries.extend([
            PathBuf::from("/usr/local/bin"),
            PathBuf::from("/usr/bin"),
            PathBuf::from("/bin"),
            PathBuf::from("/usr/sbin"),
            PathBuf::from("/sbin"),
        ]);
    }

    let mut seen = HashSet::new();
    entries.retain(|entry| seen.insert(entry.to_string_lossy().to_string()));

    std::env::join_paths(entries).unwrap_or_else(|_| OsString::from(default_runtime_path()))
}

pub fn locate_mole_script(script_name: &str) -> Result<PathBuf, String> {
    let mut roots = Vec::new();

    if let Ok(exe_path) = locate_mole_executable() {
        let mut current = exe_path.as_path();
        for _ in 0..6 {
            if let Some(parent) = current.parent() {
                roots.push(parent.to_path_buf());
                current = parent;
            } else {
                break;
            }
        }
    }

    roots.push(PathBuf::from("/opt/homebrew/opt/mole/libexec"));
    roots.push(PathBuf::from("/usr/local/opt/mole/libexec"));

    let candidate_names = candidate_script_names(script_name);
    let search_dirs = [
        "",
        "bin",
        "lib",
        "lib/check",
        "windows",
        "windows/bin",
        "windows/lib",
        "windows/lib/check",
    ];

    let mut seen_roots = HashSet::new();
    for root in roots {
        let root_key = root.to_string_lossy().to_string();
        if !seen_roots.insert(root_key) {
            continue;
        }

        for relative_dir in search_dirs {
            for candidate_name in &candidate_names {
                let candidate = if relative_dir.is_empty() {
                    root.join(candidate_name)
                } else {
                    root.join(relative_dir).join(candidate_name)
                };
                if candidate.is_file() {
                    return Ok(candidate);
                }
            }
        }
    }

    Err(format!(
        "Could not locate Mole {script_name}. Install Mole via Homebrew, the Windows branch, or use Mole Console."
    ))
}

pub fn locate_mole_executable() -> Result<PathBuf, String> {
    for candidate in mole_executable_candidates() {
        if is_candidate_file(&candidate) {
            return Ok(candidate);
        }
    }

    let locator = if cfg!(target_os = "windows") {
        "where"
    } else {
        "which"
    };
    let output = command_with_runtime_path(locator)
        .arg(mo_cmd())
        .output()
        .map_err(|e| format!("Failed to locate Mole executable: {e}"))?;

    if !output.status.success() {
        return Err(mole_not_found_message());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(|line| PathBuf::from(line.trim_matches('"')))
        .ok_or_else(mole_not_found_message)
}

pub fn current_platform() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

pub fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

pub fn unit_to_bytes(amount: f64, unit: &str) -> u64 {
    let multiplier = match unit {
        "KB" => 1024_f64,
        "MB" => 1024_f64.powi(2),
        "GB" => 1024_f64.powi(3),
        "TB" => 1024_f64.powi(4),
        _ => 1_f64,
    };
    (amount * multiplier).round() as u64
}

pub fn strip_ansi(raw: &str) -> String {
    match regex::Regex::new(r"\x1b\[[0-9;?]*[ -/]*[@-~]") {
        Ok(re) => re.replace_all(raw, "").to_string(),
        Err(_) => raw.to_string(),
    }
}

fn candidate_script_names(script_name: &str) -> Vec<String> {
    let mut names = vec![script_name.to_string()];

    if let Some(base) = script_name.strip_suffix(".sh") {
        names.push(format!("{base}.ps1"));
        names.push(format!("{base}.cmd"));
    }

    if let Some(base) = script_name.strip_suffix(".ps1") {
        names.push(format!("{base}.sh"));
        names.push(format!("{base}.cmd"));
    }

    names
}

fn mole_executable_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    for key in ["STOWMIND_MO_PATH", "MO_PATH"] {
        if let Some(value) = std::env::var_os(key) {
            candidates.push(PathBuf::from(value));
        }
    }

    for path_dir in std::env::split_paths(&runtime_path()) {
        candidates.push(path_dir.join(mo_cmd()));
    }

    if cfg!(target_os = "macos") {
        candidates.extend([
            PathBuf::from("/opt/homebrew/bin/mo"),
            PathBuf::from("/usr/local/bin/mo"),
            PathBuf::from("/opt/homebrew/opt/mole/bin/mo"),
            PathBuf::from("/usr/local/opt/mole/bin/mo"),
        ]);
    }

    let mut seen = HashSet::new();
    candidates
        .into_iter()
        .filter(|path| seen.insert(path.to_string_lossy().to_string()))
        .collect()
}

fn is_candidate_file(path: &Path) -> bool {
    path.is_file()
}

fn default_runtime_path() -> &'static str {
    if cfg!(target_os = "macos") {
        "/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/local/sbin:/usr/bin:/bin:/usr/sbin:/sbin"
    } else if cfg!(target_os = "windows") {
        ""
    } else {
        "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
    }
}

fn mole_not_found_message() -> String {
    if cfg!(target_os = "macos") {
        "Mole executable not found. StowMind checked PATH, /opt/homebrew/bin/mo, and /usr/local/bin/mo. Install Mole or set STOWMIND_MO_PATH.".to_string()
    } else {
        "Mole executable not found in PATH. Install Mole or set STOWMIND_MO_PATH.".to_string()
    }
}
