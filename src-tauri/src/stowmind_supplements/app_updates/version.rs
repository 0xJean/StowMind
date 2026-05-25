use std::cmp::Ordering;

pub fn compare_versions(installed: &str, latest: &str) -> Ordering {
    let left = version_parts(installed);
    let right = version_parts(latest);
    for index in 0..left.len().max(right.len()) {
        let a = left.get(index).map(String::as_str).unwrap_or("0");
        let b = right.get(index).map(String::as_str).unwrap_or("0");
        let ordering = match (a.parse::<u64>(), b.parse::<u64>()) {
            (Ok(a), Ok(b)) => a.cmp(&b),
            _ => a.cmp(b),
        };
        if ordering != Ordering::Equal {
            return ordering;
        }
    }
    Ordering::Equal
}

pub fn version_parts(value: &str) -> Vec<String> {
    value
        .split(|ch: char| !ch.is_ascii_alphanumeric())
        .filter(|part| !part.is_empty())
        .map(|part| part.to_ascii_lowercase())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::compare_versions;
    use std::cmp::Ordering;

    #[test]
    fn compares_numeric_versions() {
        assert_eq!(compare_versions("1.9.0", "1.10.0"), Ordering::Less);
        assert_eq!(compare_versions("2.0", "2.0.0"), Ordering::Equal);
        assert_eq!(compare_versions("3.1", "3.0.9"), Ordering::Greater);
    }
}
