//! Git object enumeration and size accounting for Agent Cleanup.

use super::super::types::{AgentCleanupItem, CleanupCategory};
use super::{command_error, is_valid_object_id, Repository, MAX_GIT_ITEMS};
use std::{
    io::Write,
    path::Path,
    process::{Command, Stdio},
    thread,
};
use walkdir::WalkDir;

pub(super) fn git_scan_error(
    repository: &Repository,
    category: CleanupCategory,
    now: i64,
    reason: String,
) -> AgentCleanupItem {
    AgentCleanupItem {
        id: format!(
            "git-scan-error:{}:{}",
            category.as_str(),
            repository.git_dir.display()
        ),
        agent: "codex".to_string(),
        category: category.as_str().to_string(),
        path: repository.git_dir.to_string_lossy().into_owned(),
        size: 0,
        size_status: "unavailable".to_string(),
        entry_count: 0,
        modified_at: now,
        eligible: false,
        default_selected: false,
        protected: true,
        reason: format!("Git scan is incomplete; cleanup is blocked: {reason}"),
    }
}

pub(super) fn unreachable_object_ids(git_dir: &Path) -> Result<Vec<String>, String> {
    let output = Command::new("git")
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
        .map_err(|error| format!("Failed to inspect unreachable Git objects: {error}"))?;
    if !output.status.success() {
        return Err(command_error("git fsck", &output.stderr));
    }
    let output_text = String::from_utf8(output.stdout)
        .map_err(|_| "Git object listing is not valid UTF-8".to_string())?;
    parse_unreachable_object_ids(&output_text)
}

pub(super) fn parse_unreachable_object_ids(raw: &str) -> Result<Vec<String>, String> {
    let mut ids = Vec::new();
    for line in raw.lines() {
        let fields = line.split_whitespace().collect::<Vec<_>>();
        if fields.first().copied() != Some("unreachable") {
            continue;
        }
        if fields.len() != 3 || !is_object_type(fields[1]) || !is_valid_object_id(fields[2]) {
            return Err("Git returned an invalid unreachable object record".to_string());
        }
        ids.push(fields[2].to_string());
        if ids.len() > MAX_GIT_ITEMS {
            break;
        }
    }
    Ok(ids)
}

pub(super) fn object_stats(git_dir: &Path, object_ids: &[String]) -> Result<(u64, u64), String> {
    if object_ids.is_empty() {
        return Ok((0, 0));
    }
    let mut child = Command::new("git")
        .arg("--git-dir")
        .arg(git_dir)
        .args([
            "cat-file",
            "--batch-check=%(objectname) %(objecttype) %(objectsize)",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Failed to measure Git objects: {error}"))?;
    let mut input = child.stdin.take().expect("configured Git stdin");
    let request = format!("{}\n", object_ids.join("\n"));
    // Drain output while writing: large repositories can fill both pipe buffers.
    let writer = thread::spawn(move || input.write_all(request.as_bytes()));
    let output = child.wait_with_output();
    let write_result = writer.join();
    let output = output.map_err(|error| format!("Failed to read Git object sizes: {error}"))?;
    if !output.status.success() {
        return Err(command_error("git cat-file", &output.stderr));
    }
    write_result
        .map_err(|_| "Git object request writer failed".to_string())?
        .map_err(|error| format!("Failed to request Git object sizes: {error}"))?;
    let output_text = String::from_utf8(output.stdout)
        .map_err(|_| "Git object sizes are not valid UTF-8".to_string())?;
    parse_object_stats(&output_text, object_ids)
}

pub(super) fn parse_object_stats(raw: &str, object_ids: &[String]) -> Result<(u64, u64), String> {
    let lines = raw.lines().collect::<Vec<_>>();
    if lines.len() != object_ids.len() {
        return Err("Git returned incomplete object size information".to_string());
    }
    let mut bytes = 0_u64;
    for (line, expected_id) in lines.iter().zip(object_ids) {
        let fields = line.split_whitespace().collect::<Vec<_>>();
        if fields.len() != 3 || fields[0] != expected_id || !is_object_type(fields[1]) {
            return Err("Git object size information is missing or invalid".to_string());
        }
        let size = fields[2]
            .parse::<u64>()
            .map_err(|_| "Git returned an invalid object size".to_string())?;
        bytes = bytes
            .checked_add(size)
            .ok_or_else(|| "Git object size exceeds the supported range".to_string())?;
    }
    Ok((object_ids.len() as u64, bytes))
}

fn is_object_type(value: &str) -> bool {
    matches!(value, "blob" | "tree" | "commit" | "tag")
}

pub(super) fn directory_size(path: &Path) -> Result<u64, String> {
    WalkDir::new(path)
        .follow_links(false)
        .into_iter()
        .try_fold(0_u64, |bytes, entry| {
            let entry =
                entry.map_err(|error| format!("Failed to inspect Git object storage: {error}"))?;
            if !entry.file_type().is_file() {
                return Ok(bytes);
            }
            let metadata = entry
                .metadata()
                .map_err(|error| format!("Failed to measure Git object storage: {error}"))?;
            bytes
                .checked_add(metadata.len())
                .ok_or_else(|| "Git object storage size exceeds the supported range".to_string())
        })
}
