use super::{adapters::root_path, types::AgentRootSpec};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

/// A worktree is removable only when its linked gitdir is stale or it is no
/// longer listed by Git.  A normal repository with a `.git` directory is
/// always protected.
pub(super) fn is_orphaned_worktree(path: &Path) -> bool {
    let git_file = path.join(".git");
    if !git_file.is_file() {
        return false;
    }
    let Ok(contents) = fs::read_to_string(&git_file) else {
        return false;
    };
    let Some(gitdir) = contents
        .lines()
        .find_map(|line| line.strip_prefix("gitdir:").map(str::trim))
    else {
        return false;
    };
    let gitdir = PathBuf::from(gitdir);
    let gitdir = if gitdir.is_absolute() {
        gitdir
    } else {
        path.join(gitdir)
    };
    if !gitdir.exists() {
        return true;
    }
    let output = Command::new("git")
        .args([
            "-C",
            &path.to_string_lossy(),
            "worktree",
            "list",
            "--porcelain",
        ])
        .output();
    let Ok(output) = output else { return false };
    if !output.status.success() {
        return false;
    }
    let Some(candidate) = fs::canonicalize(path).ok() else {
        return false;
    };
    let listed = String::from_utf8_lossy(&output.stdout);
    !listed
        .lines()
        .filter_map(|line| line.strip_prefix("worktree "))
        .any(|listed_path| {
            fs::canonicalize(listed_path)
                .map(|listed| listed == candidate)
                .unwrap_or(false)
        })
}

pub(super) fn is_direct_child(path: &Path, home: &Path, spec: &AgentRootSpec) -> bool {
    let root_path = root_path(home, spec);
    let Ok(root_metadata) = fs::symlink_metadata(&root_path) else {
        return false;
    };
    if root_metadata.file_type().is_symlink() {
        return false;
    }
    let Ok(root) = fs::canonicalize(root_path) else {
        return false;
    };
    let Ok(candidate) = fs::canonicalize(path) else {
        return false;
    };
    if spec.scan_self {
        return candidate == root;
    }
    candidate.parent() == Some(root.as_path())
}

/// Lock/pid artifacts and directories containing one are active runtime state.
/// We inspect only a shallow part of an allow-listed item; this keeps the scan
/// bounded and prevents a lock deep in an unrelated project from becoming a
/// deletion signal.
pub(super) fn has_active_lock(path: &Path) -> bool {
    for entry in walkdir::WalkDir::new(path)
        .follow_links(false)
        .max_depth(2)
        .into_iter()
        .flatten()
    {
        let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
        if name == "lock" || name.ends_with(".lock") || name.ends_with(".pid") {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::is_orphaned_worktree;
    use std::fs;

    #[test]
    fn stale_gitdir_is_orphaned_but_plain_directory_is_not() {
        let root = std::env::temp_dir().join("stowmind-agent-worktree-test");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        assert!(!is_orphaned_worktree(&root));
        fs::write(root.join(".git"), "gitdir: ../missing-worktree-gitdir\n").unwrap();
        assert!(is_orphaned_worktree(&root));
        let _ = fs::remove_dir_all(root);
    }
}
