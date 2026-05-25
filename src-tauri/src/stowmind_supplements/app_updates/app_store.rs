use super::types::{StowmindSupplementAppUpdateItem, StowmindSupplementAppUpdateScan};
use super::version::compare_versions;
use futures_util::future::join_all;
use serde::Deserialize;
use std::cmp::Ordering;
use std::time::Duration;

const MAX_APP_STORE_CHECKS: usize = 32;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppStoreLookup {
    result_count: usize,
    results: Vec<AppStoreApp>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppStoreApp {
    version: Option<String>,
    track_view_url: Option<String>,
}

pub async fn enrich_versions(scan: &mut StowmindSupplementAppUpdateScan) {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(6))
        .user_agent("StowMind supplement App Store update scanner")
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            scan.message = format!(
                "{} App Store network client unavailable: {error}",
                scan.message
            );
            return;
        }
    };

    let lookups = scan
        .items
        .iter()
        .enumerate()
        .filter_map(|(index, item)| {
            if item.provider != "app_store" {
                return None;
            }
            let bundle_id = item.bundle_id.as_ref()?.clone();
            let installed = item.installed_version.clone().unwrap_or_default();
            Some((index, bundle_id, installed))
        })
        .take(MAX_APP_STORE_CHECKS)
        .collect::<Vec<_>>();

    let checks = lookups.into_iter().map(|(index, bundle_id, installed)| {
        let client = client.clone();
        async move {
            let result = fetch_latest(&client, &bundle_id, &installed).await;
            (index, result)
        }
    });

    for (index, result) in join_all(checks).await {
        if let Some(item) = scan.items.get_mut(index) {
            match result {
                Ok(result) => apply_result(item, result),
                Err(error) => {
                    item.update_status = "blocked".to_string();
                    item.confidence = "app_store_lookup_unreachable".to_string();
                    item.detail = format!(
                        "App Store app was detected, but version check could not finish: {error}"
                    );
                }
            }
        }
    }
}

async fn fetch_latest(
    client: &reqwest::Client,
    bundle_id: &str,
    _installed: &str,
) -> Result<Option<AppStoreApp>, String> {
    let url = format!("https://itunes.apple.com/lookup?bundleId={bundle_id}");
    let lookup = client
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<AppStoreLookup>()
        .await
        .map_err(|e| e.to_string())?;
    if lookup.result_count == 0 {
        return Ok(None);
    }
    Ok(lookup.results.into_iter().next())
}

fn apply_result(item: &mut StowmindSupplementAppUpdateItem, result: Option<AppStoreApp>) {
    let Some(result) = result else {
        item.update_status = "unknown".to_string();
        item.confidence = "app_store_lookup_empty".to_string();
        item.detail =
            "App Store receipt was detected, but lookup returned no matching app.".to_string();
        return;
    };

    item.latest_version = result.version.clone();
    item.feed_url = result.track_view_url.clone();
    if let Some(url) = result.track_view_url.clone() {
        item.action_kind = Some("open_url".to_string());
        item.action_target = Some(url);
        item.action_label = Some("App Store".to_string());
    }
    match (item.installed_version.as_deref(), result.version.as_deref()) {
        (Some(installed), Some(latest)) => match compare_versions(installed, latest) {
            Ordering::Less => {
                item.update_status = "available".to_string();
                item.confidence = "app_store_lookup".to_string();
                item.detail = format!("New App Store version found: {installed} -> {latest}.");
            }
            Ordering::Equal | Ordering::Greater => {
                item.update_status = "current".to_string();
                item.confidence = "app_store_lookup".to_string();
                item.detail = "No newer App Store version was found.".to_string();
            }
        },
        (_, Some(latest)) => {
            item.update_status = "unknown".to_string();
            item.confidence = "app_store_lookup".to_string();
            item.detail = format!(
                "App Store latest version detected: {latest}; installed version is unavailable."
            );
        }
        _ => {
            item.update_status = "unknown".to_string();
            item.confidence = "app_store_lookup".to_string();
            item.detail =
                "App Store lookup succeeded, but no version marker was detected.".to_string();
        }
    }
}
