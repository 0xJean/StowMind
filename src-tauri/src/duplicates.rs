//! 按大小分组后对同尺寸文件做 SHA-256 全文件哈希，找出重复文件组。

use crate::organizer::path_matches_exclude;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::File;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize)]
pub struct DuplicateGroup {
    pub size: u64,
    pub hash: String,
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateScanProgress {
    pub phase: DuplicateScanPhase,
    pub current: usize,
    pub total: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DuplicateScanPhase {
    Collecting,
    Hashing,
    Finalizing,
}

impl DuplicateScanProgress {
    fn new(phase: DuplicateScanPhase, current: usize, total: usize) -> Self {
        Self {
            phase,
            current,
            total,
        }
    }
}

fn hash_file(path: &Path) -> io::Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 1024 * 64];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

/// 扫描目录内文件，返回「内容完全相同（同哈希）」且至少 2 个路径的组。
pub fn find_duplicates(
    directory: &str,
    recursive: bool,
    exclude_patterns: &[String],
    mut on_progress: impl FnMut(DuplicateScanProgress),
) -> Result<Vec<DuplicateGroup>, io::Error> {
    let root = Path::new(directory);
    if !root.exists() || !root.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "目录不存在或不是文件夹",
        ));
    }

    let mut files: Vec<(PathBuf, u64)> = Vec::new();
    let walker = WalkDir::new(root).min_depth(1);
    let walker = if recursive {
        walker
    } else {
        walker.max_depth(1)
    };

    let mut visited = 0usize;
    let mut last_collect_emit = Instant::now();
    on_progress(DuplicateScanProgress::new(
        DuplicateScanPhase::Collecting,
        0,
        0,
    ));
    for entry in walker.into_iter().filter_map(|e| e.ok()) {
        visited += 1;
        if visited == 1 || last_collect_emit.elapsed() >= Duration::from_millis(120) {
            on_progress(DuplicateScanProgress::new(
                DuplicateScanPhase::Collecting,
                visited,
                0,
            ));
            last_collect_emit = Instant::now();
        }
        let p = entry.path();
        if !p.is_file() {
            continue;
        }
        if path_matches_exclude(p, exclude_patterns) {
            continue;
        }
        let meta = entry.metadata()?;
        let size = meta.len();
        files.push((p.to_path_buf(), size));
    }
    on_progress(DuplicateScanProgress::new(
        DuplicateScanPhase::Collecting,
        visited,
        visited,
    ));

    let mut by_size: HashMap<u64, Vec<PathBuf>> = HashMap::new();
    for (path, size) in files {
        by_size.entry(size).or_default().push(path);
    }

    let mut buckets: Vec<Vec<PathBuf>> = by_size.into_values().filter(|v| v.len() > 1).collect();

    buckets.sort_by(|a, b| b.len().cmp(&a.len()));

    let mut out: Vec<DuplicateGroup> = Vec::new();
    let mut done = 0usize;
    let hash_total: usize = buckets.iter().map(|b| b.len()).sum();
    on_progress(DuplicateScanProgress::new(
        DuplicateScanPhase::Hashing,
        0,
        hash_total,
    ));
    let mut last_hash_emit = Instant::now();

    for bucket in buckets {
        let mut by_hash: HashMap<String, Vec<PathBuf>> = HashMap::new();
        for path in bucket {
            done += 1;
            if done == 1
                || done == hash_total
                || last_hash_emit.elapsed() >= Duration::from_millis(120)
            {
                on_progress(DuplicateScanProgress::new(
                    DuplicateScanPhase::Hashing,
                    done,
                    hash_total,
                ));
                last_hash_emit = Instant::now();
            }
            match hash_file(&path) {
                Ok(h) => {
                    by_hash.entry(h).or_default().push(path);
                }
                Err(_) => {}
            }
        }
        for (hash, paths) in by_hash {
            if paths.len() < 2 {
                continue;
            }
            let mut ps: Vec<String> = paths
                .into_iter()
                .map(|p| p.to_string_lossy().to_string())
                .collect();
            ps.sort();
            let size = std::fs::metadata(Path::new(&ps[0]))
                .map(|m| m.len())
                .unwrap_or(0);
            out.push(DuplicateGroup {
                size,
                hash,
                paths: ps,
            });
        }
    }

    on_progress(DuplicateScanProgress::new(
        DuplicateScanPhase::Finalizing,
        done,
        hash_total,
    ));
    out.sort_by(|a, b| b.paths.len().cmp(&a.paths.len()));
    Ok(out)
}
