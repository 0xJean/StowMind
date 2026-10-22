use super::{probe::PathIdentity, scripts::MoleAdapter, types::SystemCacheReport};
use std::{
    collections::HashMap,
    io::Read,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

#[derive(Clone, Debug)]
pub(super) struct Review {
    pub report: SystemCacheReport,
    pub identities: Vec<PathIdentity>,
    pub adapter: MoleAdapter,
    window: String,
    issued_at: Instant,
}

static REVIEWS: OnceLock<Mutex<HashMap<String, Review>>> = OnceLock::new();

pub(super) fn issue(
    report: &SystemCacheReport,
    identities: Vec<PathIdentity>,
    adapter: MoleAdapter,
    window: &str,
) -> Result<String, String> {
    if report.status != super::types::ScanStatus::Complete
        || !report.authorized
        || report.size_bytes.is_none()
        || !report.mole_supported
        || identities.is_empty()
    {
        return Err("A complete authorized measurement and supported Mole runtime are required before cleanup review".to_string());
    }
    let mut random = [0_u8; 24];
    std::fs::File::open("/dev/urandom")
        .and_then(|mut file| file.read_exact(&mut random))
        .map_err(|_| "Cannot create a secure cache review token".to_string())?;
    let token = hex::encode(random);
    let mut reviews = REVIEWS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| "Cache review state is unavailable".to_string())?;
    reviews.retain(|_, review| review.issued_at.elapsed() < Duration::from_secs(600));
    if reviews.len() >= 100 {
        return Err("Too many pending cache reviews".to_string());
    }
    reviews.insert(
        token.clone(),
        Review {
            report: report.clone(),
            identities,
            adapter,
            window: window.to_string(),
            issued_at: Instant::now(),
        },
    );
    Ok(token)
}

pub(super) fn consume(token: &str, window: &str) -> Result<Review, String> {
    let mut reviews = REVIEWS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| "Cache review state is unavailable".to_string())?;
    let review = reviews
        .remove(token)
        .ok_or("The cache review is missing or has already been used; review again")?;
    if review.window != window || review.issued_at.elapsed() >= Duration::from_secs(600) {
        return Err(
            "The cache review expired or belongs to another window; review again".to_string(),
        );
    }
    Ok(review)
}

pub(super) fn identities_match(reviewed: &[PathIdentity], current: &[PathIdentity]) -> bool {
    if reviewed.len() != current.len() || reviewed.is_empty() {
        return false;
    }
    reviewed
        .iter()
        .zip(current)
        .enumerate()
        .all(|(index, (old, new))| {
            old.device == new.device
                && old.inode == new.inode
                && (index + 1 != reviewed.len() || old.modified == new.modified)
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (SystemCacheReport, Vec<PathIdentity>, MoleAdapter) {
        let mut report =
            SystemCacheReport::new(super::super::types::ScanStatus::Complete, "fixture", true);
        report.set_size(1024);
        report.mole_supported = true;
        (
            report,
            vec![PathIdentity {
                device: 1,
                inode: 2,
                modified: 3,
            }],
            super::super::scripts::fixture_adapter(),
        )
    }

    #[test]
    fn review_tokens_are_opaque_single_use_and_bound_to_the_window() {
        let (report, ids, adapter) = fixture();
        let token = issue(&report, ids.clone(), adapter.clone(), "main").unwrap();
        assert_eq!(token.len(), 48);
        assert!(consume(&token, "main").is_ok());
        assert!(consume(&token, "main").is_err());
        let token = issue(&report, ids, adapter, "main").unwrap();
        assert!(consume(&token, "other-window").is_err());
        assert!(consume(&token, "main").is_err());
    }

    #[test]
    fn expired_or_incomplete_reviews_cannot_authorize_cleanup() {
        let (mut report, ids, adapter) = fixture();
        let token = issue(&report, ids.clone(), adapter.clone(), "expiry-test").unwrap();
        REVIEWS
            .get()
            .unwrap()
            .lock()
            .unwrap()
            .get_mut(&token)
            .unwrap()
            .issued_at = Instant::now() - Duration::from_secs(601);
        assert!(consume(&token, "expiry-test").is_err());
        report.authorized = false;
        assert!(issue(&report, ids.clone(), adapter.clone(), "main").is_err());
        report.authorized = true;
        report.size_bytes = None;
        assert!(issue(&report, ids.clone(), adapter.clone(), "main").is_err());
        report.size_bytes = Some(1024);
        report.mole_supported = false;
        assert!(issue(&report, ids, adapter, "main").is_err());
    }

    #[test]
    fn replaced_ancestors_or_modified_targets_invalidate_review() {
        let parent = PathIdentity {
            device: 1,
            inode: 2,
            modified: 3,
        };
        let target = PathIdentity {
            device: 1,
            inode: 4,
            modified: 5,
        };
        let original = vec![parent, target];
        let mut changed = original.clone();
        changed[0].modified += 1;
        assert!(
            identities_match(&original, &changed),
            "unrelated changes to a cache sibling are not a new parent identity"
        );
        changed[0].inode += 1;
        assert!(!identities_match(&original, &changed));
        changed = original.clone();
        changed[1].modified += 1;
        assert!(!identities_match(&original, &changed));
    }
}
