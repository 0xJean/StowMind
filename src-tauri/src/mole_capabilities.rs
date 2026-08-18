use crate::mole_utils::{
    current_platform, locate_mole_executable, mo_cmd, mole_command, strip_ansi,
};
use serde::Serialize;
use std::process::Command;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoleCapabilityProbe {
    pub command: String,
    pub success: bool,
    pub output_excerpt: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoleAppUpdateCapability {
    pub platform: String,
    pub mo_command: String,
    pub mo_executable: Option<String>,
    pub cli_exposed: bool,
    pub json_exposed: bool,
    pub command: Option<String>,
    pub status: String,
    pub message: String,
    pub probes: Vec<MoleCapabilityProbe>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoleWindowsCompatCheck {
    pub id: String,
    pub label: String,
    pub status: String,
    pub detail: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoleWindowsCompatReport {
    pub platform: String,
    pub validation_status: String,
    pub mo_command: String,
    pub mo_executable: Option<String>,
    pub checks: Vec<MoleWindowsCompatCheck>,
}

#[tauri::command]
pub async fn mole_app_update_capability_json() -> Result<MoleAppUpdateCapability, String> {
    let executable = locate_mole_executable()
        .ok()
        .map(|path| path.to_string_lossy().to_string());
    let probes = tokio::task::spawn_blocking(run_app_update_probes)
        .await
        .map_err(|e| format!("Failed to join Mole app update probe task: {e}"))?;

    let exposed_probe = probes.iter().find(|probe| {
        probe.success
            && has_app_update_hint(&probe.output_excerpt)
            && has_json_hint(&probe.output_excerpt)
    });

    let cli_exposed = exposed_probe.is_some();
    let json_exposed = cli_exposed;
    let command = exposed_probe.map(|probe| probe.command.clone());
    let status = if cli_exposed {
        "available"
    } else {
        "waiting_for_mole"
    }
    .to_string();
    let message = if cli_exposed {
        "Integrated app update scanning is available.".to_string()
    } else {
        "App update scanning will use local app information until integrated support is available."
            .to_string()
    };

    Ok(MoleAppUpdateCapability {
        platform: current_platform().to_string(),
        mo_command: mo_cmd().to_string(),
        mo_executable: executable,
        cli_exposed,
        json_exposed,
        command,
        status,
        message,
        probes,
    })
}

#[tauri::command]
pub fn mole_windows_compat_report() -> MoleWindowsCompatReport {
    let executable = locate_mole_executable()
        .ok()
        .map(|path| path.to_string_lossy().to_string());
    let platform = current_platform().to_string();
    let mut checks = Vec::new();

    checks.push(MoleWindowsCompatCheck {
        id: "mole_command".to_string(),
        label: "Mole executable discovery".to_string(),
        status: if executable.is_some() {
            "pass"
        } else {
            "blocked"
        }
        .to_string(),
        detail: executable
            .clone()
            .unwrap_or_else(|| format!("{} was not found in PATH", mo_cmd())),
    });

    checks.push(MoleWindowsCompatCheck {
        id: "windows_launcher".to_string(),
        label: "Windows launcher name".to_string(),
        status: if cfg!(target_os = "windows") {
            "pass"
        } else {
            "not_run"
        }
        .to_string(),
        detail: if cfg!(target_os = "windows") {
            "Backend commands use mo.cmd on Windows.".to_string()
        } else {
            "Not running on Windows; verify mo.cmd on a Windows machine.".to_string()
        },
    });

    checks.push(MoleWindowsCompatCheck {
        id: "path_separator".to_string(),
        label: "Path separator handling".to_string(),
        status: "pass".to_string(),
        detail: "Analyze drilldown and backend discovery accept both / and \\ separators."
            .to_string(),
    });

    checks.push(MoleWindowsCompatCheck {
        id: "powershell".to_string(),
        label: "PowerShell availability".to_string(),
        status: powershell_status(),
        detail: powershell_detail(),
    });

    checks.push(MoleWindowsCompatCheck {
        id: "real_machine".to_string(),
        label: "Windows real-machine validation".to_string(),
        status: if cfg!(target_os = "windows") { "warn" } else { "not_run" }.to_string(),
        detail: if cfg!(target_os = "windows") {
            "Run Clean, Uninstall, Optimize, Analyze, HUD, and Console smoke tests on this Windows machine.".to_string()
        } else {
            "Pending: run the smoke checklist on a real Windows machine with the Mole Windows build installed.".to_string()
        },
    });

    let validation_status = if cfg!(target_os = "windows") {
        "ready_for_smoke_test"
    } else {
        "needs_windows_machine"
    }
    .to_string();

    MoleWindowsCompatReport {
        platform,
        validation_status,
        mo_command: mo_cmd().to_string(),
        mo_executable: executable,
        checks,
    }
}

fn run_app_update_probes() -> Vec<MoleCapabilityProbe> {
    let candidates: Vec<Vec<&str>> = vec![
        vec!["--help"],
        vec!["update", "--help"],
        vec!["update", "--json", "--help"],
        vec!["update", "--apps", "--help"],
        vec!["apps", "update", "--help"],
        vec!["app-update", "--help"],
    ];

    candidates
        .into_iter()
        .map(|args| run_probe(&args))
        .collect()
}

fn run_probe(args: &[&str]) -> MoleCapabilityProbe {
    let output = mole_command()
        .and_then(|mut command| command.args(args).output().map_err(|e| e.to_string()));
    let command = format!("{} {}", mo_cmd(), args.join(" "));
    match output {
        Ok(output) => {
            let raw = format!(
                "{}\n{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            MoleCapabilityProbe {
                command,
                success: output.status.success(),
                output_excerpt: excerpt(&strip_ansi(&raw)),
            }
        }
        Err(error) => MoleCapabilityProbe {
            command,
            success: false,
            output_excerpt: error.to_string(),
        },
    }
}

fn has_app_update_hint(value: &str) -> bool {
    let lower = value.to_lowercase();
    lower.contains("app update")
        || lower.contains("app updates")
        || lower.contains("app store")
        || lower.contains("sparkle")
        || lower.contains("electron")
}

fn has_json_hint(value: &str) -> bool {
    let lower = value.to_lowercase();
    lower.contains("-json") || lower.contains("--json") || lower.contains("json")
}

fn excerpt(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.chars().count() <= 500 {
        trimmed.to_string()
    } else {
        let end = trimmed
            .char_indices()
            .nth(500)
            .map(|(index, _)| index)
            .unwrap_or(trimmed.len());
        format!("{}...", &trimmed[..end])
    }
}

fn powershell_status() -> String {
    if !cfg!(target_os = "windows") {
        return "not_run".to_string();
    }
    match Command::new("powershell")
        .args(["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"])
        .output()
    {
        Ok(output) if output.status.success() => "pass".to_string(),
        Ok(_) => "warn".to_string(),
        Err(_) => "blocked".to_string(),
    }
}

fn powershell_detail() -> String {
    if cfg!(target_os = "windows") {
        "PowerShell is required for Mole's Windows installer and maintenance scripts.".to_string()
    } else {
        "Not running on Windows; PowerShell check is deferred.".to_string()
    }
}
