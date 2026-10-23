use std::path::Path;
use walkdir::WalkDir;

pub(super) const MAX_ITEM_ENTRIES: usize = 100_000;

pub(super) struct ItemMeasurement {
    pub bytes: u64,
    pub entries: u64,
    pub complete: bool,
}

pub(super) fn measure_item(path: &Path) -> ItemMeasurement {
    let mut result = ItemMeasurement {
        bytes: 0,
        entries: 0,
        complete: true,
    };
    for entry in WalkDir::new(path).follow_links(false).max_depth(8) {
        if result.entries >= MAX_ITEM_ENTRIES as u64 {
            result.complete = false;
            break;
        }
        let Ok(entry) = entry else {
            result.complete = false;
            break;
        };
        if entry.file_type().is_symlink() {
            continue;
        }
        result.entries += 1;
        if entry.file_type().is_dir() {
            if entry.depth() == 8 {
                result.complete = false
            }
            continue;
        }
        match entry.metadata() {
            Ok(metadata) => result.bytes = result.bytes.saturating_add(metadata.len()),
            Err(_) => {
                result.complete = false;
                break;
            }
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::measure_item;
    use std::fs;

    #[test]
    fn inaccessible_or_missing_measurement_is_not_a_successful_zero() {
        let root =
            std::env::temp_dir().join(format!("stowmind-measure-missing-{}", std::process::id()));
        let result = measure_item(&root);
        assert!(!result.complete);
        assert_eq!(result.bytes, 0);
    }

    #[test]
    fn empty_directory_and_depth_limited_directory_are_distinct() {
        let root =
            std::env::temp_dir().join(format!("stowmind-measure-depth-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let empty = measure_item(&root);
        assert!(empty.complete);
        assert_eq!(empty.bytes, 0);
        let nested = root.join("a/b/c/d/e/f/g/h/i");
        fs::create_dir_all(&nested).unwrap();
        fs::write(nested.join("payload"), "unmeasured").unwrap();
        let partial = measure_item(&root);
        assert!(!partial.complete);
        fs::remove_dir_all(root).unwrap();
    }
}
