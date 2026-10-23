use std::{
    collections::HashMap,
    io::Read,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

pub(super) struct Review {
    root: String,
    pub root_identity: String,
    pub items: Vec<(String, String)>,
    pub script: PathBuf,
    include_empty: bool,
    window: String,
    created: Instant,
}

static REVIEWS: OnceLock<Mutex<HashMap<String, Review>>> = OnceLock::new();
const TTL: Duration = Duration::from_secs(15 * 60);

pub(super) fn invalidate(window: &str) -> Result<(), String> {
    REVIEWS
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| "Purge review lock unavailable")?
        .retain(|_, entry| entry.window != window);
    Ok(())
}

pub(super) fn issue(
    root: &str,
    items: &[super::types::MolePurgeItem],
    script: &Path,
    include_empty: bool,
    window: &str,
) -> Result<String, String> {
    let root_identity = identity(root)?;
    let items = items
        .iter()
        .map(|item| {
            let path = std::fs::canonicalize(&item.path)
                .map_err(|_| "Purge candidate became unavailable")?;
            if path == Path::new(root) || !path.starts_with(root) || path != Path::new(&item.path) {
                return Err("Purge candidate path changed; scan again".to_string());
            }
            Ok((item.path.clone(), identity(&item.path)?))
        })
        .collect::<Result<Vec<_>, String>>()?;
    let mut random = [0_u8; 24];
    std::fs::File::open("/dev/urandom")
        .and_then(|mut file| file.read_exact(&mut random))
        .map_err(|_| "Cannot create a secure purge review token".to_string())?;
    let token = hex::encode(random);
    let mut reviews = REVIEWS
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| "Purge review lock unavailable")?;
    reviews.retain(|_, entry| entry.created.elapsed() < TTL && entry.window != window);
    reviews.insert(
        token.clone(),
        Review {
            root: root.to_string(),
            root_identity,
            items,
            script: script.to_path_buf(),
            include_empty,
            window: window.to_string(),
            created: Instant::now(),
        },
    );
    Ok(token)
}

pub(super) fn consume(
    token: &str,
    root: &str,
    include_empty: bool,
    window: &str,
) -> Result<Review, String> {
    let review = REVIEWS
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| "Purge review lock unavailable")?
        .remove(token)
        .ok_or_else(|| "Purge preview expired or is unavailable; scan again".to_string())?;
    if review.created.elapsed() >= TTL
        || review.root != root
        || review.include_empty != include_empty
        || review.window != window
    {
        return Err("Purge scope changed; scan again before cleaning".to_string());
    }
    if identity(root)? != review.root_identity {
        return Err("Purge root changed since preview; scan again".to_string());
    }
    for (path, expected) in &review.items {
        if identity(path)? != *expected {
            return Err("Purge candidate changed since preview; scan again".to_string());
        }
    }
    Ok(review)
}

#[cfg(unix)]
fn identity(path: &str) -> Result<String, String> {
    use std::os::unix::fs::MetadataExt;
    let metadata =
        std::fs::symlink_metadata(path).map_err(|_| "Purge candidate became unavailable")?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("Purge only accepts reviewed directories".to_string());
    }
    Ok(format!(
        "{}:{}:{}",
        metadata.dev(),
        metadata.ino(),
        metadata.mtime()
    ))
}

#[cfg(not(unix))]
fn identity(_path: &str) -> Result<String, String> {
    Err("Purge directory identity checks require Unix".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn review_is_single_use_and_bound_to_root_options_and_window() {
        let dir =
            std::env::temp_dir().join(format!("stowmind-purge-review-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let root = std::fs::canonicalize(&dir).unwrap();
        let root = root.to_str().unwrap();
        let issue = || {
            super::issue(
                root,
                &[],
                Path::new("/tmp/purge.sh"),
                false,
                "purge-review-test",
            )
            .unwrap()
        };
        let token = issue();
        assert!(consume(&token, root, true, "purge-review-test").is_err());
        assert!(consume(&token, root, false, "purge-review-test").is_err());
        let token = issue();
        assert!(consume(&token, "/tmp/b", false, "purge-review-test").is_err());
        let token = issue();
        assert!(consume(&token, root, false, "other-window").is_err());
        let token = issue();
        assert!(consume(&token, root, false, "purge-review-test").is_ok());
        assert!(consume(&token, root, false, "purge-review-test").is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
