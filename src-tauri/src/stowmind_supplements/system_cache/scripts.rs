use super::{
    probe::PathIdentity,
    types::{TARGET_PARENT, TARGET_PATH},
};
use crate::mole_utils::{locate_selected_mole_script, shell_quote};
use sha2::{Digest, Sha256};
use std::{fs, path::PathBuf};

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct MoleAdapter {
    common: PathBuf,
    whitelist: PathBuf,
    fingerprints: Vec<(PathBuf, Vec<u8>)>,
}

pub(super) fn locate_adapter() -> Result<MoleAdapter, String> {
    adapter_from_clean(locate_selected_mole_script("clean.sh")?)
}

fn adapter_from_clean(clean: PathBuf) -> Result<MoleAdapter, String> {
    let clean =
        fs::canonicalize(clean).map_err(|_| "Cannot resolve the selected Mole clean command")?;
    let runtime = clean
        .parent()
        .and_then(|bin| bin.parent())
        .ok_or_else(|| "Cannot identify the selected Mole runtime".to_string())?
        .to_path_buf();
    let common = fs::canonicalize(runtime.join("lib/core/common.sh"))
        .map_err(|_| "Cannot resolve the selected Mole common library")?;
    let whitelist = fs::canonicalize(runtime.join("lib/manage/whitelist.sh"))
        .map_err(|_| "Cannot resolve the selected Mole whitelist library")?;
    let system = fs::read_to_string(runtime.join("lib/clean/system.sh"))
        .map_err(|_| "The selected Mole does not expose its system-cache rules".to_string())?;
    let operations = fs::read_to_string(runtime.join("lib/core/file_ops.sh"))
        .map_err(|_| "The selected Mole does not expose safe system-cache removal".to_string())?;
    if !common.is_file()
        || !whitelist.is_file()
        || !system.contains(TARGET_PATH)
        || !operations.contains("safe_sudo_remove()")
        || !operations.contains("_mole_path_matches_identity()")
        || !operations.contains("_mole_privileged_path_has_mutable_ancestor()")
    {
        return Err(
            "The selected Mole lacks the required scoped cache rule or final identity guard"
                .to_string(),
        );
    }
    let mut fingerprints = Vec::new();
    for path in [
        clean,
        common.clone(),
        whitelist.clone(),
        runtime.join("lib/core/file_ops.sh"),
        runtime.join("lib/clean/system.sh"),
    ] {
        let path = fs::canonicalize(path).map_err(|_| "Cannot bind the selected Mole runtime")?;
        let bytes = fs::read(&path).map_err(|_| "Cannot inspect the selected Mole runtime")?;
        fingerprints.push((path, Sha256::digest(&bytes).to_vec()));
    }
    Ok(MoleAdapter {
        common,
        whitelist,
        fingerprints,
    })
}

const AUTH: &str = r#"
set -u
set -o pipefail
export LC_ALL=C LANG=C
# Passwords may only be submitted after sudo emits its fixed prompt. Keep PTY
# echo disabled for the whole operation, including authentication failure.
/bin/stty -echo || exit 70
if [[ "$EUID" -eq 0 ]]; then exit 70; fi
printf '__STOWMIND_STAGE__|authenticate\n'
if ! /usr/bin/sudo -v -p '[StowMind cache review] Password: '; then
    printf '\n__STOWMIND_AUTH__|failed\n'
    exit 77
fi
printf '\n__STOWMIND_AUTH__|complete\n'
"#;

const MEASUREMENT: &str = r#"
measure_cache() {
    local phase="$1" output="" rc=0 before_id="" after_id="" size_kb=""
    MEASURE_STATUS=error MEASURE_KB='' MEASURE_ID=''
    printf '__STOWMIND_STAGE__|%s\n' "$phase"
    if /usr/bin/sudo -n /bin/test -L "$cache_path"; then
        printf '__STOWMIND_CACHE__|%s|error||\n' "$phase"
        return
    fi
    before_id=$(/usr/bin/sudo -n /usr/bin/stat -f '%d:%i:%m' "$cache_path" 2>&1) || rc=$?
    if [[ $rc -ne 0 ]]; then
        case "$before_id" in
            *'No such file or directory'*) MEASURE_STATUS=not_found ;;
            *'Permission denied'*|*'Operation not permitted'*|*'a password is required'*) MEASURE_STATUS=permission_denied ;;
            *) MEASURE_STATUS=error ;;
        esac
        printf '__STOWMIND_CACHE__|%s|%s||\n' "$phase" "$MEASURE_STATUS"
        return
    fi
    output=$(/usr/bin/sudo -n /usr/bin/du -skP "$cache_path" 2>&1 | /usr/bin/head -c 65536) || rc=$?
    if [[ $rc -ne 0 ]]; then
        case "$output" in
            *'Permission denied'*|*'Operation not permitted'*|*'a password is required'*) MEASURE_STATUS=permission_denied ;;
            *) MEASURE_STATUS=partial ;;
        esac
    elif [[ "$output" != *$'\n'* && "$output" == *$'\t'"$cache_path" ]]; then
        size_kb="${output%%$'\t'*}"
        if [[ "$size_kb" =~ ^[0-9]+$ ]]; then
            after_id=$(/usr/bin/sudo -n /usr/bin/stat -f '%d:%i:%m' "$cache_path" 2>/dev/null) || after_id=''
            if [[ "$before_id" == "$after_id" && "$after_id" =~ ^[0-9]+:[0-9]+:[0-9]+$ ]]; then
                MEASURE_STATUS=complete MEASURE_KB="$size_kb" MEASURE_ID="$after_id"
            else
                MEASURE_STATUS=partial
            fi
        fi
    fi
    printf '__STOWMIND_CACHE__|%s|%s|%s|%s\n' "$phase" "$MEASURE_STATUS" "$MEASURE_KB" "$MEASURE_ID"
}
"#;

pub(super) fn review_script() -> String {
    format!(
        "{AUTH}\ncache_path={}\n{MEASUREMENT}\nmeasure_cache review\n",
        shell_quote(TARGET_PATH)
    )
}

pub(super) fn clean_script(
    adapter: &MoleAdapter,
    identities: &[PathIdentity],
    size_bytes: u64,
) -> Result<String, String> {
    let target = identities
        .last()
        .ok_or("Missing reviewed target identity")?;
    let parent = identities
        .iter()
        .rev()
        .nth(1)
        .ok_or("Missing reviewed parent identity")?;
    let target_full = format!("{}:{}:{}", target.device, target.inode, target.modified);
    let setup = format!(
        r#"
cache_path={path}
expected_identity={expected_identity}
expected_size_kb={size_kb}
{measurement}
measure_cache before
if [[ "$MEASURE_STATUS" != complete || "$MEASURE_ID" != "$expected_identity" || "$MEASURE_KB" != "$expected_size_kb" ]]; then
    printf '__STOWMIND_ACTION__|not_attempted|stale_review\n'
    measure_cache after
    exit 0
fi
# Mole is sourced as the invoking user. Only Mole's own final-sink operation
# requests sudo; no user-writable library is evaluated as root.
if ! source {common}; then
    printf '__STOWMIND_ACTION__|not_attempted|mole_unavailable\n'
    measure_cache after
    exit 0
fi
if ! source {whitelist}; then
    printf '__STOWMIND_ACTION__|not_attempted|mole_unavailable\n'
    measure_cache after
    exit 0
fi
if ! declare -F safe_sudo_remove >/dev/null || ! declare -F _mole_path_matches_identity >/dev/null || ! declare -F _mole_privileged_path_has_mutable_ancestor >/dev/null || ! load_whitelist clean; then
    printf '__STOWMIND_ACTION__|not_attempted|mole_unavailable\n'
    measure_cache after
    exit 0
fi
unset MOLE_DRY_RUN
DRY_RUN=false
export MOLE_CURRENT_COMMAND=clean
# Observe policy for a bounded explanation; the final Mole operation repeats
# every guard and remains solely responsible for deciding whether to remove.
if is_path_whitelisted "$cache_path"; then printf '__STOWMIND_POLICY__|whitelist\n'; fi
if _mole_privileged_path_has_mutable_ancestor "$cache_path"; then printf '__STOWMIND_POLICY__|mutable_parent\n'; fi
printf '__STOWMIND_STAGE__|clean\n'
printf '__STOWMIND_ATTEMPT__|started\n'
cleanup_rc=0
safe_sudo_remove "$cache_path" "$expected_size_kb" "" {parent_path} {parent_id} {target_id} || cleanup_rc=$?
printf '__STOWMIND_ACTION__|attempted|%s\n' "$cleanup_rc"
measure_cache after
exit 0
"#,
        path = shell_quote(TARGET_PATH),
        expected_identity = shell_quote(&target_full),
        size_kb = size_bytes / 1024,
        measurement = MEASUREMENT,
        common = shell_quote(&adapter.common.to_string_lossy()),
        whitelist = shell_quote(&adapter.whitelist.to_string_lossy()),
        parent_path = shell_quote(TARGET_PARENT),
        parent_id = shell_quote(&parent.short()),
        target_id = shell_quote(&target.short())
    );
    Ok(format!("{AUTH}\n{setup}"))
}

#[cfg(test)]
pub(super) fn fixture_adapter() -> MoleAdapter {
    MoleAdapter {
        common: PathBuf::from("/tmp/Mole 'fixture'/lib/core/common.sh"),
        whitelist: PathBuf::from("/tmp/Mole 'fixture'/lib/manage/whitelist.sh"),
        fingerprints: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::Write,
        process::{Command, Stdio},
    };

    fn runtime_fixture() -> PathBuf {
        let random = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "stowmind-mole 'fixture'-{}-{random}",
            std::process::id()
        ));
        for dir in ["bin", "lib/core", "lib/manage", "lib/clean"] {
            fs::create_dir_all(root.join(dir)).unwrap();
        }
        fs::write(root.join("bin/clean.sh"), "# fixture clean entry").unwrap();
        fs::write(
            root.join("lib/core/common.sh"),
            r#"set -euo pipefail
safe_sudo_remove() { printf '%s\n' "$@" > "$HOME/removal-args"; return 1; }
_mole_path_matches_identity() { return 0; }
_mole_privileged_path_has_mutable_ancestor() { return 1; }
is_path_whitelisted() { return 1; }
"#,
        )
        .unwrap();
        fs::write(root.join("lib/manage/whitelist.sh"), "set -euo pipefail\nload_whitelist() { printf '%s' \"$1\" > \"$HOME/whitelist-mode\"; }\n").unwrap();
        fs::write(root.join("lib/core/file_ops.sh"), "safe_sudo_remove() {}\n_mole_path_matches_identity() {}\n_mole_privileged_path_has_mutable_ancestor() {}\n").unwrap();
        fs::write(root.join("lib/clean/system.sh"), TARGET_PATH).unwrap();
        root
    }

    #[test]
    fn selected_runtime_is_bound_to_canonical_files_and_their_contents() {
        let root = runtime_fixture();
        let adapter = adapter_from_clean(root.join("bin/clean.sh")).unwrap();
        assert!(adapter.common.is_absolute());
        assert_eq!(
            adapter,
            adapter_from_clean(root.join("bin/clean.sh")).unwrap()
        );
        fs::write(root.join("lib/manage/whitelist.sh"), "# upgraded runtime").unwrap();
        assert_ne!(
            adapter,
            adapter_from_clean(root.join("bin/clean.sh")).unwrap()
        );
        fs::write(root.join("lib/core/file_ops.sh"), "safe_sudo_remove() {}\n").unwrap();
        assert!(adapter_from_clean(root.join("bin/clean.sh")).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn normal_user_mole_source_keeps_whitelist_and_rechecks_after_refusal() {
        let root = runtime_fixture();
        let adapter = adapter_from_clean(root.join("bin/clean.sh")).unwrap();
        let identities = [
            PathIdentity {
                device: 1,
                inode: 2,
                modified: 3,
            },
            PathIdentity {
                device: 1,
                inode: 4,
                modified: 5,
            },
        ];
        let fake_measurement = r#"measure_cache() {
MEASURE_STATUS=complete MEASURE_KB=4 MEASURE_ID=1:4:5
printf '__STOWMIND_CACHE__|%s|complete|4|1:4:5\n' "$1"
}
"#;
        // Replace only read-only/auth platform adapters in the test. The
        // generated Mole source, whitelist, guard and removal call stay intact.
        let script = clean_script(&adapter, &identities, 4096)
            .unwrap()
            .replace(AUTH, "")
            .replace(MEASUREMENT, fake_measurement);
        let output = Command::new("/bin/bash")
            .args(["--noprofile", "--norc", "-c", &script])
            .env_clear()
            .env("HOME", &root)
            .env("PATH", "/usr/bin:/bin")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let output = String::from_utf8(output.stdout).unwrap();
        assert!(output.contains("__STOWMIND_ACTION__|attempted|1"));
        assert!(output.contains("__STOWMIND_CACHE__|after|complete"));
        assert_eq!(
            fs::read_to_string(root.join("whitelist-mode")).unwrap(),
            "clean"
        );
        assert_eq!(
            fs::read_to_string(root.join("removal-args"))
                .unwrap()
                .lines()
                .collect::<Vec<_>>(),
            [TARGET_PATH, "4", "", TARGET_PARENT, "1:2", "1:4"]
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn generated_scripts_are_valid_bash_and_keep_mole_safety_guards() {
        let identities = [
            PathIdentity {
                device: 1,
                inode: 2,
                modified: 3,
            },
            PathIdentity {
                device: 1,
                inode: 4,
                modified: 5,
            },
        ];
        let clean = clean_script(&fixture_adapter(), &identities, 4096).unwrap();
        assert!(clean.contains("safe_sudo_remove \"$cache_path\" \"$expected_size_kb\" \"\" '/Library/Caches' '1:2' '1:4'"));
        assert!(clean.contains("load_whitelist clean"));
        assert!(clean.contains("declare -F _mole_privileged_path_has_mutable_ancestor"));
        assert!(clean.contains("head -c 65536"));
        assert!(!clean.contains("sudo source"));
        assert!(!clean.contains("rm -rf"));
        assert!(!clean.contains("mo clean"));
        for script in [review_script(), clean] {
            let mut syntax = Command::new("/bin/bash")
                .args(["--noprofile", "--norc", "-n"])
                .stdin(Stdio::piped())
                .spawn()
                .unwrap();
            syntax
                .stdin
                .take()
                .unwrap()
                .write_all(script.as_bytes())
                .unwrap();
            assert!(syntax.wait().unwrap().success());
        }
    }
}
