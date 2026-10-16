//! Git object enumeration and size accounting for Agent Cleanup.

use super::MAX_GIT_ITEMS;
use std::{
    io::Write,
    path::Path,
    process::{Command, Stdio},
};
use walkdir::WalkDir;

pub(super) fn unreachable_object_ids(git_dir: &Path) -> Vec<String> {
    let Ok(output) = Command::new("git")
        .arg("--git-dir")
        .arg(git_dir)
        .args([
            "fsck",
            "--full",
            "--unreachable",
            "--no-reflogs",
            "--no-progress",
        ])
        .output()
    else {
        return Vec::new();
    };
    let mut output_text = String::from_utf8_lossy(&output.stdout).into_owned();
    output_text.push_str(&String::from_utf8_lossy(&output.stderr));
    output_text
        .lines()
        .take(MAX_GIT_ITEMS + 1)
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            if fields.next() != Some("unreachable") {
                return None;
            }
            let _object_type = fields.next()?;
            fields.next().map(str::to_string)
        })
        .filter(|id| id.len() >= 40 && id.chars().all(|character| character.is_ascii_hexdigit()))
        .collect()
}

pub(super) fn object_stats(git_dir: &Path, object_ids: &[String]) -> (u64, u64) {
    let mut child = match Command::new("git")
        .arg("--git-dir")
        .arg(git_dir)
        .args([
            "cat-file",
            "--batch-check=%(objectname) %(objecttype) %(objectsize)",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(_) => return (0, 0),
    };
    if let Some(mut input) = child.stdin.take() {
        let _ = input.write_all(object_ids.join("\n").as_bytes());
        let _ = input.write_all(b"\n");
    }
    let Ok(output) = child.wait_with_output() else {
        return (0, 0);
    };
    let mut count = 0_u64;
    let mut bytes = 0_u64;
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let fields = line.split_whitespace().collect::<Vec<_>>();
        if fields.len() >= 3 && fields[1] != "missing" {
            count += 1;
            bytes = bytes.saturating_add(fields[2].parse::<u64>().unwrap_or(0));
        }
    }
    (count, bytes)
}

pub(super) fn directory_size(path: &Path) -> u64 {
    WalkDir::new(path)
        .follow_links(false)
        .into_iter()
        .flatten()
        .filter(|entry| entry.file_type().is_file())
        .filter_map(|entry| entry.metadata().ok().map(|metadata| metadata.len()))
        .sum()
}
