use super::types::ReviewedInstaller;
use std::{
    collections::{HashMap, HashSet},
    io::Read,
    path::PathBuf,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

pub(super) struct Review {
    pub items: Vec<ReviewedInstaller>,
    pub script: PathBuf,
    window: String,
    issued_at: Instant,
}
static REVIEWS: OnceLock<Mutex<HashMap<String, Review>>> = OnceLock::new();

pub(super) fn issue(
    items: Vec<ReviewedInstaller>,
    script: PathBuf,
    window: &str,
) -> Result<String, String> {
    let mut bytes = [0_u8; 24];
    std::fs::File::open("/dev/urandom")
        .and_then(|mut file| file.read_exact(&mut bytes))
        .map_err(|_| "Cannot create an installer review token")?;
    let token = hex::encode(bytes);
    let mut reviews = REVIEWS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| "Installer review state is unavailable")?;
    reviews.retain(|_, review| review.issued_at.elapsed() < Duration::from_secs(600));
    if reviews.len() >= 100 {
        return Err("Too many pending installer reviews".to_string());
    }
    reviews.insert(
        token.clone(),
        Review {
            items,
            script,
            window: window.to_string(),
            issued_at: Instant::now(),
        },
    );
    Ok(token)
}

pub(super) fn consume(token: &str, window: &str, paths: &[String]) -> Result<Review, String> {
    let mut reviews = REVIEWS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| "Installer review state is unavailable")?;
    let mut review = reviews
        .remove(token)
        .ok_or("Installer preview expired or was already used; scan again")?;
    if review.window != window || review.issued_at.elapsed() >= Duration::from_secs(600) {
        return Err(
            "Installer preview expired or belongs to another window; scan again".to_string(),
        );
    }
    let selected: HashSet<_> = paths.iter().collect();
    if selected.is_empty()
        || selected.len() != paths.len()
        || !selected
            .iter()
            .all(|path| review.items.iter().any(|item| &item.item.path == *path))
    {
        return Err("Installer selection does not match the reviewed scan; scan again".to_string());
    }
    review
        .items
        .retain(|item| selected.contains(&item.item.path));
    Ok(review)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mole_installer::types::MoleInstallerItem;
    fn fixture() -> Vec<ReviewedInstaller> {
        vec![ReviewedInstaller {
            item: MoleInstallerItem {
                path: "/tmp/App.dmg".into(),
                name: "App.dmg".into(),
                size: 10,
                source: "Downloads".into(),
            },
            identity: "1:2:3".into(),
        }]
    }
    #[test]
    fn tokens_are_single_use_and_bound_to_window_and_reviewed_paths() {
        let paths = vec!["/tmp/App.dmg".to_string()];
        let token = issue(fixture(), "/tmp/script".into(), "main").unwrap();
        assert!(consume(&token, "main", &paths).is_ok());
        assert!(consume(&token, "main", &paths).is_err());
        let token = issue(fixture(), "/tmp/script".into(), "main").unwrap();
        assert!(consume(&token, "other", &paths).is_err());
        let token = issue(fixture(), "/tmp/script".into(), "main").unwrap();
        assert!(consume(&token, "main", &["/tmp/NotReviewed.pkg".into()]).is_err());
    }
}
