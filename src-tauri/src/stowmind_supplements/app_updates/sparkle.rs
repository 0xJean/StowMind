use super::types::StowmindSupplementAppUpdateItem;
use super::types::StowmindSupplementAppUpdateScan;
use super::version::compare_versions;
use futures_util::future::join_all;
use regex::Regex;
use std::{cmp::Ordering, time::Duration};

const MAX_SPARKLE_FEEDS: usize = 16;

pub async fn enrich_versions(scan: &mut StowmindSupplementAppUpdateScan) {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .user_agent("StowMind supplement app update scanner")
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            scan.message = format!(
                "{} Sparkle network client unavailable: {error}",
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
            let url = item.feed_url.as_ref()?;
            if url.starts_with("http://") || url.starts_with("https://") {
                Some((
                    index,
                    url.clone(),
                    item.installed_version.clone().unwrap_or_default(),
                ))
            } else {
                None
            }
        })
        .take(MAX_SPARKLE_FEEDS)
        .collect::<Vec<_>>();

    let checks = feeds.into_iter().map(|(index, url, installed)| {
        let client = client.clone();
        async move {
            let result = fetch_latest(&client, &url, &installed).await;
            (index, result)
        }
    });

    for (index, result) in join_all(checks).await {
        if let Some(item) = scan.items.get_mut(index) {
            match result {
                Ok(latest) => apply_result(item, latest),
                Err(error) => {
                    item.update_status = "blocked".to_string();
                    item.confidence = "feed_unreachable".to_string();
                    item.detail = format!("Built-in updater could not be checked: {error}");
                }
            }
        }
    }
}

async fn fetch_latest(
    client: &reqwest::Client,
    url: &str,
    installed: &str,
) -> Result<Option<String>, String> {
    let body = client
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;
    let latest = parse_version(&body);
    if latest
        .as_deref()
        .is_some_and(|value| !installed.is_empty() && value == installed)
    {
        return Ok(latest);
    }
    Ok(latest)
}

fn apply_result(item: &mut StowmindSupplementAppUpdateItem, latest: Option<String>) {
    item.latest_version = latest.clone();
    match (item.installed_version.as_deref(), latest.as_deref()) {
        (Some(installed), Some(latest)) => match compare_versions(installed, latest) {
            Ordering::Less => {
                item.update_status = "available".to_string();
                item.confidence = "sparkle_appcast".to_string();
                item.detail = format!("New version found: {installed} -> {latest}.");
            }
            Ordering::Equal | Ordering::Greater => {
                item.update_status = "current".to_string();
                item.confidence = "sparkle_appcast".to_string();
                item.detail = "No newer version was found.".to_string();
            }
        },
        (_, Some(latest)) => {
            item.update_status = "unknown".to_string();
            item.confidence = "sparkle_appcast".to_string();
            item.detail =
                format!("Latest version detected: {latest}; installed version is unavailable.");
        }
        _ => {
            item.update_status = "unknown".to_string();
            item.confidence = "feed_checked".to_string();
            item.detail =
                "Update source was reachable, but no version marker was detected.".to_string();
        }
    }
}

fn parse_version(body: &str) -> Option<String> {
    let patterns = [
        r#"sparkle:shortVersionString\s*=\s*"([^"]+)""#,
        r#"<sparkle:shortVersionString>([^<]+)</sparkle:shortVersionString>"#,
        r#"sparkle:version\s*=\s*"([^"]+)""#,
        r#"<sparkle:version>([^<]+)</sparkle:version>"#,
    ];
    patterns.iter().find_map(|pattern| {
        Regex::new(pattern)
            .ok()?
            .captures(body)?
            .get(1)
            .map(|value| value.as_str().trim().to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::parse_version;

    #[test]
    fn parses_sparkle_short_version() {
        let body = r#"<enclosure sparkle:shortVersionString="2.4.1" sparkle:version="241" />"#;
        assert_eq!(parse_version(body).as_deref(), Some("2.4.1"));
    }
}
