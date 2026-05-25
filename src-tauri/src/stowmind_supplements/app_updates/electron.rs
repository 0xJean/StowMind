use super::types::{StowmindSupplementAppUpdateItem, StowmindSupplementAppUpdateScan};
use super::version::compare_versions;
use futures_util::future::join_all;
use regex::Regex;
use std::cmp::Ordering;
use std::path::Path;
use std::time::Duration;

const MAX_ELECTRON_CHECKS: usize = 24;

#[derive(Clone, Debug)]
struct ElectronFeed {
    provider: String,
    url: String,
}

pub async fn enrich_versions(scan: &mut StowmindSupplementAppUpdateScan) {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(6))
        .user_agent("StowMind supplement Electron update scanner")
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            scan.message = format!(
                "{} Electron network client unavailable: {error}",
                scan.message
            );
            return;
        }
    };

    let feeds = scan
        .items
        .iter()
        .enumerate()
        .filter_map(|(index, item)| {
            if item.provider != "electron" {
                return None;
            }
            let feed = electron_feed(&item.path)?;
            Some((
                index,
                feed,
                item.installed_version.clone().unwrap_or_default(),
            ))
        })
        .take(MAX_ELECTRON_CHECKS)
        .collect::<Vec<_>>();

    let checks = feeds.into_iter().map(|(index, feed, installed)| {
        let client = client.clone();
        async move {
            let result = fetch_latest(&client, &feed, &installed).await;
            (index, feed.provider, result)
        }
    });

    for (index, provider, result) in join_all(checks).await {
        if let Some(item) = scan.items.get_mut(index) {
            match result {
                Ok(latest) => apply_result(item, &provider, latest),
                Err(error) => {
                    item.update_status = "blocked".to_string();
                    item.confidence = "electron_feed_unreachable".to_string();
                    item.detail = format!(
                        "In-app updater was detected, but version check could not finish: {error}"
                    );
                }
            }
        }
    }
}

fn electron_feed(app_path: &str) -> Option<ElectronFeed> {
    let body = std::fs::read_to_string(
        Path::new(app_path)
            .join("Contents")
            .join("Resources")
            .join("app-update.yml"),
    )
    .ok()?;
    let provider = yaml_value(&body, "provider").unwrap_or_else(|| "generic".to_string());
    match provider.as_str() {
        "github" => {
            let owner = yaml_value(&body, "owner")?;
            let repo = yaml_value(&body, "repo")?;
            Some(ElectronFeed {
                provider,
                url: format!(
                    "https://github.com/{owner}/{repo}/releases/latest/download/latest-mac.yml"
                ),
            })
        }
        "generic" => {
            let url = yaml_value(&body, "url")?;
            Some(ElectronFeed {
                provider,
                url: format!("{}/latest-mac.yml", url.trim_end_matches('/')),
            })
        }
        _ => None,
    }
}

async fn fetch_latest(
    client: &reqwest::Client,
    feed: &ElectronFeed,
    installed: &str,
) -> Result<Option<String>, String> {
    let body = client
        .get(&feed.url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;
    let latest = yaml_value(&body, "version").or_else(|| parse_release_name(&body));
    if latest
        .as_deref()
        .is_some_and(|value| !installed.is_empty() && value == installed)
    {
        return Ok(latest);
    }
    Ok(latest)
}

fn apply_result(
    item: &mut StowmindSupplementAppUpdateItem,
    provider: &str,
    latest: Option<String>,
) {
    item.latest_version = latest.clone();
    match (item.installed_version.as_deref(), latest.as_deref()) {
        (Some(installed), Some(latest)) => match compare_versions(installed, latest) {
            Ordering::Less => {
                item.update_status = "available".to_string();
                item.confidence = format!("electron_{provider}_feed");
                item.detail = format!("New version found: {installed} -> {latest}.");
            }
            Ordering::Equal | Ordering::Greater => {
                item.update_status = "current".to_string();
                item.confidence = format!("electron_{provider}_feed");
                item.detail = "No newer version was found.".to_string();
            }
        },
        (_, Some(latest)) => {
            item.update_status = "unknown".to_string();
            item.confidence = format!("electron_{provider}_feed");
            item.detail =
                format!("Latest version detected: {latest}; installed version is unavailable.");
        }
        _ => {
            item.update_status = "unknown".to_string();
            item.confidence = "electron_feed_checked".to_string();
            item.detail = "Update source was reachable, but no latest version marker was detected."
                .to_string();
        }
    }
}

fn yaml_value(body: &str, key: &str) -> Option<String> {
    let pattern = format!(r#"(?m)^\s*{}\s*:\s*['"]?([^'"\r\n#]+)"#, regex::escape(key));
    Regex::new(&pattern)
        .ok()?
        .captures(body)?
        .get(1)
        .map(|value| value.as_str().trim().to_string())
        .filter(|value| !value.is_empty())
}

fn parse_release_name(body: &str) -> Option<String> {
    yaml_value(body, "releaseName")
}

#[cfg(test)]
mod tests {
    use super::yaml_value;

    #[test]
    fn parses_yaml_values() {
        let body = "owner: ipfs\nrepo: ipfs-desktop\nprovider: github\n";
        assert_eq!(yaml_value(body, "owner").as_deref(), Some("ipfs"));
        assert_eq!(yaml_value(body, "repo").as_deref(), Some("ipfs-desktop"));
    }
}
