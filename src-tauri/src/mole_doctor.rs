use crate::deepclean;
use crate::mole_utils::{locate_mole_executable, mo_cmd, mole_command, mole_update_command};
use serde::Serialize;
use std::process::Command;

#[derive(Clone, Debug, Serialize)]
pub struct MoleDoctorCheck {
    pub title: String,
    pub detail: String,
    pub level: String,
    pub action: Option<String>,
    pub section: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct MoleDoctorResult {
    pub collected_at: String,
    pub platform: String,
    pub health_score: i64,
    pub health_score_msg: String,
    pub status: deepclean::MoleStatusMetrics,
    pub checks: Vec<MoleDoctorCheck>,
    pub update_available: bool,
    pub update_message: Option<String>,
    pub console_command: String,
    pub raw_output: String,
    pub runtime: MoleRuntimeInfo,
}

#[derive(Clone, Debug, Serialize)]
pub struct MoleRuntimeInfo {
    pub version: Option<String>,
    pub executable: Option<String>,
    pub install_method: String,
    pub update_source: String,
    pub update_command: String,
    pub capabilities: Vec<String>,
}

impl MoleRuntimeInfo {
    fn unavailable() -> Self {
        Self {
            version: None,
            executable: None,
            install_method: "unknown".to_string(),
            update_source: "unknown".to_string(),
            update_command: format!("{} update", mo_cmd()),
            capabilities: Vec::new(),
        }
    }
}

#[tauri::command]
pub async fn mole_doctor_json() -> Result<MoleDoctorResult, String> {
    let status_future = deepclean::mole_status_json();
    let check_future = tokio::task::spawn_blocking(run_mole_check);
    let (status_result, check_result) = tokio::join!(status_future, check_future);

    let status = status_result?;
    let check = check_result
        .map_err(|e| format!("Failed to join Mole doctor task: {e}"))?
        .unwrap_or_else(|error| MoleDoctorRun {
            checks: Vec::new(),
            update_available: false,
            update_message: None,
            raw_output: error,
            runtime: MoleRuntimeInfo::unavailable(),
        });

    Ok(MoleDoctorResult {
        collected_at: status.collected_at.clone(),
        platform: status.platform.clone(),
        health_score: status.health_score,
        health_score_msg: status.health_score_msg.clone(),
        status,
        checks: check.checks,
        update_available: check.update_available,
        update_message: check.update_message,
        console_command: doctor_console_command(),
        raw_output: check.raw_output,
        runtime: check.runtime,
    })
}

#[derive(Clone, Debug)]
struct MoleDoctorRun {
    checks: Vec<MoleDoctorCheck>,
    update_available: bool,
    update_message: Option<String>,
    raw_output: String,
    runtime: MoleRuntimeInfo,
}

fn doctor_console_command() -> String {
    mo_cmd().to_string()
}

fn run_mole_check() -> Result<MoleDoctorRun, String> {
    let executable = locate_mole_executable()?;
    let executable_text = executable.to_string_lossy().to_string();
    let version_output = run_mole_command(&["--version"])?;
    let version_text = output_text(&version_output);
    let version = extract_version(&version_text);
    let (install_method, update_source) = detect_install_method(&executable_text, &version_text);
    let update_command = mole_update_command().unwrap_or_else(|_| format!("{} update", mo_cmd()));
    let capabilities = probe_capabilities();
    let runtime = MoleRuntimeInfo {
        version: version.clone(),
        executable: Some(executable_text),
        install_method: install_method.to_string(),
        update_source: update_source.to_string(),
        update_command: update_command.clone(),
        capabilities,
    };

    let (update_available, update_message) = check_for_update(&runtime, version.as_deref());
    let mut checks = runtime_checks(&runtime, update_available, update_message.as_deref());
    if checks.is_empty() {
        checks.push(MoleDoctorCheck {
            title: "Mole runtime".to_string(),
            detail: "Mole was found, but no capability probe completed.".to_string(),
            level: "warning".to_string(),
            action: Some(update_command.clone()),
            section: "Mole runtime".to_string(),
        });
    }

    let raw_output = format_runtime_output(&runtime, update_message.as_deref());
    Ok(MoleDoctorRun {
        checks,
        update_available,
        update_message,
        raw_output,
        runtime,
    })
}

fn run_mole_command(args: &[&str]) -> Result<std::process::Output, String> {
    mole_command()?
        .args(args)
        .output()
        .map_err(|error| format!("Failed to run Mole {}: {error}", args.join(" ")))
}

fn extract_version(raw: &str) -> Option<String> {
    regex::Regex::new(r"(\d+\.\d+\.\d+)")
        .ok()?
        .find(raw)
        .map(|value| value.as_str().to_string())
}

fn detect_install_method(executable: &str, version_output: &str) -> (&'static str, &'static str) {
    let lower_path = executable.to_ascii_lowercase();
    let lower_output = version_output.to_ascii_lowercase();
    if lower_path.contains("/cellar/mole/")
        || lower_path.contains("\\cellar\\mole\\")
        || lower_output.contains("install: homebrew")
    {
        ("homebrew", "Homebrew formula (brew upgrade mole)")
    } else if lower_path.contains("/nix/store/") || lower_output.contains("install: nix") {
        ("nix", "Nix package manager (nix profile upgrade mole)")
    } else {
        (
            "manual",
            "Mole official installer / GitHub releases (mo update)",
        )
    }
}

fn probe_capabilities() -> Vec<String> {
    let specs: [(&str, &[&str], &[&str]); 10] = [
        ("clean", &["clean", "--help"], &["--dry-run"]),
        ("uninstall", &["uninstall", "--help"], &["--dry-run"]),
        ("optimize", &["optimize", "--help"], &["--dry-run"]),
        ("analyze_json", &["analyze", "--help"], &["--json"]),
        ("status_json", &["status", "--help"], &["--json"]),
        ("status_watch", &["status", "--help"], &["--watch"]),
        ("history_json", &["history", "--help"], &["--json"]),
        ("purge_dry_run", &["purge", "--help"], &["--dry-run"]),
        ("purge_yes", &["purge", "--help"], &["--yes"]),
        (
            "installer_dry_run",
            &["installer", "--help"],
            &["--dry-run"],
        ),
    ];

    specs
        .iter()
        .filter_map(|(name, args, needles)| {
            let output = run_mole_command(args).ok()?;
            if !output.status.success() {
                return None;
            }
            let text = output_text(&output).to_ascii_lowercase();
            needles
                .iter()
                .all(|needle| text.contains(&needle.to_ascii_lowercase()))
                .then(|| (*name).to_string())
        })
        .collect()
}

fn runtime_checks(
    runtime: &MoleRuntimeInfo,
    update_available: bool,
    update_message: Option<&str>,
) -> Vec<MoleDoctorCheck> {
    let section = "Mole runtime".to_string();
    let mut checks = vec![MoleDoctorCheck {
        title: "Mole executable".to_string(),
        detail: runtime
            .executable
            .clone()
            .unwrap_or_else(|| "Mole executable was not found".to_string()),
        level: if runtime.executable.is_some() {
            "success"
        } else {
            "destructive"
        }
        .to_string(),
        action: None,
        section: section.clone(),
    }];
    checks.push(MoleDoctorCheck {
        title: "Mole version and install method".to_string(),
        detail: format!(
            "{} · {}",
            runtime.version.as_deref().unwrap_or("unknown version"),
            runtime.install_method
        ),
        level: if runtime.version.is_some() {
            "success"
        } else {
            "warning"
        }
        .to_string(),
        action: None,
        section: section.clone(),
    });
    checks.push(MoleDoctorCheck {
        title: "Mole capabilities".to_string(),
        detail: if runtime.capabilities.is_empty() {
            "No supported Mole command capabilities were detected".to_string()
        } else {
            runtime.capabilities.join(", ")
        },
        level: if runtime.capabilities.is_empty() {
            "warning"
        } else {
            "success"
        }
        .to_string(),
        action: None,
        section: section.clone(),
    });
    checks.push(MoleDoctorCheck {
        title: "Mole updates".to_string(),
        detail: update_message
            .unwrap_or(
                "Update status could not be checked; the source is shown in the runtime details.",
            )
            .to_string(),
        level: if update_available {
            "warning"
        } else {
            "success"
        }
        .to_string(),
        action: Some(runtime.update_command.clone()),
        section,
    });
    checks
}

fn format_runtime_output(runtime: &MoleRuntimeInfo, update_message: Option<&str>) -> String {
    let capabilities = if runtime.capabilities.is_empty() {
        "none".to_string()
    } else {
        runtime.capabilities.join(", ")
    };
    format!(
        "Mole {}\nExecutable: {}\nInstall method: {}\nUpdate source: {}\nCapabilities: {}\n{}",
        runtime.version.as_deref().unwrap_or("unknown"),
        runtime.executable.as_deref().unwrap_or("unavailable"),
        runtime.install_method,
        runtime.update_source,
        capabilities,
        update_message.unwrap_or("Update status unavailable")
    )
}

fn check_for_update(runtime: &MoleRuntimeInfo, installed: Option<&str>) -> (bool, Option<String>) {
    let Some(installed) = installed else {
        return (false, Some("Mole version is unavailable.".to_string()));
    };

    let latest = match runtime.install_method.as_str() {
        "homebrew" => latest_homebrew_version(),
        "manual" => latest_github_version(),
        "nix" => None,
        _ => None,
    };
    let Some(latest) = latest else {
        return (
            false,
            Some(format!(
                "Mole {installed} · source: {} · run {} to update.",
                runtime.update_source, runtime.update_command
            )),
        );
    };
    if version_is_newer(installed, &latest) {
        (
            true,
            Some(format!(
                "Update {latest} available (installed {installed}); run {}.",
                runtime.update_command
            )),
        )
    } else {
        (
            false,
            Some(format!(
                "Mole {installed} is current; source: {}.",
                runtime.update_source
            )),
        )
    }
}

fn latest_homebrew_version() -> Option<String> {
    let output = Command::new("brew")
        .args(["info", "--json=v2", "--formula", "mole"])
        .env("HOMEBREW_NO_AUTO_UPDATE", "1")
        .env("HOMEBREW_NO_ENV_HINTS", "1")
        .env("NONINTERACTIVE", "1")
        .output()
        .ok()?;
    let value: serde_json::Value = serde_json::from_slice(&output.stdout).ok()?;
    value
        .get("formulae")?
        .as_array()?
        .iter()
        .find(|item| item.get("name").and_then(|name| name.as_str()) == Some("mole"))
        .and_then(|item| item.get("versions"))
        .and_then(|versions| versions.get("stable"))
        .and_then(|version| version.as_str())
        .map(ToString::to_string)
}

fn latest_github_version() -> Option<String> {
    let output = Command::new("curl")
        .args([
            "-fsSL",
            "--connect-timeout",
            "2",
            "--max-time",
            "4",
            "https://api.github.com/repos/tw93/mole/releases/latest",
        ])
        .output()
        .ok()?;
    let value: serde_json::Value = serde_json::from_slice(&output.stdout).ok()?;
    value
        .get("tag_name")
        .and_then(|tag| tag.as_str())
        .and_then(extract_version)
}

fn version_is_newer(installed: &str, latest: &str) -> bool {
    let parse = |value: &str| {
        value
            .split('.')
            .map(|part| part.parse::<u64>().unwrap_or(0))
            .collect::<Vec<_>>()
    };
    let left = parse(installed);
    let right = parse(latest);
    (0..left.len().max(right.len()))
        .map(|index| {
            (
                *left.get(index).unwrap_or(&0),
                *right.get(index).unwrap_or(&0),
            )
        })
        .find(|(a, b)| a != b)
        .map(|(a, b)| b > a)
        .unwrap_or(false)
}

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
    use super::{detect_install_method, extract_version, version_is_newer};

    #[test]
    fn detects_version_and_update_order() {
        assert_eq!(
            extract_version("Mole version 1.57.0 macOS"),
            Some("1.57.0".to_string())
        );
        assert!(version_is_newer("1.57.0", "1.60.0"));
        assert!(!version_is_newer("1.60.0", "1.60.0"));
        assert!(!version_is_newer("1.61.0", "1.60.0"));
    }

    #[test]
    fn identifies_supported_install_channels() {
        assert_eq!(
            detect_install_method("/opt/homebrew/Cellar/mole/1.57.0/bin/mo", "Mole 1.57.0"),
            ("homebrew", "Homebrew formula (brew upgrade mole)")
        );
        assert_eq!(
            detect_install_method("/nix/store/mole/bin/mo", "Mole 1.57.0"),
            ("nix", "Nix package manager (nix profile upgrade mole)")
        );
    }
}
