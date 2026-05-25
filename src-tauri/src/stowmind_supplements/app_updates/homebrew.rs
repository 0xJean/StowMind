use super::types::{StowmindSupplementAppUpdateItem, StowmindSupplementAppUpdateScan};
use serde::Deserialize;
use std::collections::HashMap;
use std::process::Command;

#[derive(Clone, Debug, Deserialize)]
struct BrewOutdated {
    casks: Vec<BrewOutdatedCask>,
}

#[derive(Clone, Debug, Deserialize)]
struct BrewOutdatedCask {
    name: String,
    installed_versions: Vec<String>,
    current_version: String,
}

pub fn enrich_versions(scan: &mut StowmindSupplementAppUpdateScan) {
    let Ok(outdated) = brew_outdated_casks() else {
        return;
    };
    let by_name = outdated
        .into_iter()
        .map(|item| (normalize(&item.name), item))
        .collect::<HashMap<_, _>>();

    for item in &mut scan.items {
        let Some(match_item) = find_match(item, &by_name) else {
            continue;
        };
        let installed = match_item
            .installed_versions
            .first()
            .cloned()
            .or_else(|| item.installed_version.clone());
        item.provider = "homebrew".to_string();
        item.update_status = "available".to_string();
        item.confidence = "brew_outdated_cask".to_string();
        item.installed_version = installed.clone();
        item.latest_version = Some(match_item.current_version.clone());
        item.detail = format!(
            "Homebrew cask update detected: {} -> {}.",
            installed.unwrap_or_else(|| "unknown".to_string()),
            match_item.current_version
        );
        item.action_kind = Some("brew_cask_upgrade".to_string());
        item.action_target = Some(match_item.name.clone());
        item.action_label = Some("更新".to_string());
    }
}

fn brew_outdated_casks() -> Result<Vec<BrewOutdatedCask>, String> {
    let output = Command::new("brew")
        .args(["outdated", "--cask", "--json=v2"])
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() && output.stdout.is_empty() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    let parsed: BrewOutdated = serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())?;
    Ok(parsed.casks)
}

fn find_match<'a>(
    item: &StowmindSupplementAppUpdateItem,
    by_name: &'a HashMap<String, BrewOutdatedCask>,
) -> Option<&'a BrewOutdatedCask> {
    let path_stem = path_stem(&item.path);
    let keys = [
        item.name.as_str(),
        item.bundle_id.as_deref().unwrap_or_default(),
        path_stem.as_deref().unwrap_or_default(),
    ];
    keys.iter().find_map(|key| by_name.get(&normalize(key)))
}

fn normalize(value: &str) -> String {
    value
        .trim()
        .trim_end_matches(".app")
        .to_lowercase()
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .collect()
}

fn path_stem(path: &str) -> Option<String> {
    std::path::Path::new(path)
        .file_stem()
        .map(|value| value.to_string_lossy().to_string())
}
