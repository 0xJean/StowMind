use super::parser::COMPLETE_RECORD;
use crate::mole_utils::shell_quote;

fn source_script(script: &str) -> String {
    format!(
        "export MOLE_SKIP_MAIN=1; scratch=$(mktemp -d) || exit 1; \
         export XDG_CACHE_HOME=\"$scratch\"; \
         source {} >/dev/null || exit $?; \
         trap 'type cleanup >/dev/null 2>&1 && cleanup || true; rm -rf -- \"$scratch\"' EXIT; \
         mkdir -p \"$scratch/mole\";",
        shell_quote(script)
    )
}

pub(super) fn collect(script: &str, root: &str, include_empty: bool) -> String {
    format!(
        "export MOLE_TEST_MODE=1 MO_NO_OPLOG=1 MOLE_PURGE_INCLUDE_EMPTY={}; \
         {} \
         scan_output=\"$scratch/scan\"; \
         : > \"$scratch/mole/purge_scanning\"; \
         if scan_purge_targets {} \"$scan_output\"; then :; else exit \"$?\"; fi; \
         while IFS= read -r item_path; do \
           [[ -n \"$item_path\" ]] || continue; [[ -d \"$item_path\" && ! -L \"$item_path\" ]] || exit 66; \
           size=unknown; \
           if size_output=$(run_with_timeout \"${{MOLE_TIMEOUT_DISK_VERIFY_SEC:-10}}\" du -sk \"$item_path\" 2>/dev/null); then \
             size_kb=$(printf '%s' \"$size_output\" | awk 'NR == 1 {{print $1}}'); \
             if [[ \"$size_kb\" =~ ^[0-9]+$ && ${{#size_kb}} -lt 15 ]]; then size=$((size_kb * 1024)); fi; \
           fi; \
           printf '%s\\x1f%s\\x1e' \"$item_path\" \"$size\"; \
         done < \"$scan_output\"; \
         printf '{}\\x1e'",
        if include_empty { "1" } else { "0" },
        source_script(script), shell_quote(root), COMPLETE_RECORD
    )
}

pub(super) fn execute(script: &str, root: &str, include_empty: bool) -> String {
    format!(
        r#"{}
declare -F mole_deletion_identity _mole_purge_final_remove_guard scan_purge_targets >/dev/null || exit 64
PURGE_SEARCH_PATHS=({})
reviewed_root="${{PURGE_SEARCH_PATHS[0]}}"
expected_root="$1"; shift
reviewed_paths=(); reviewed_ids=()
while [[ $# -gt 0 ]]; do
  [[ $# -ge 2 ]] || exit 65
  reviewed_paths+=("$1"); reviewed_ids+=("$2"); shift 2
done
[[ ${{#reviewed_paths[@]}} -gt 0 ]] || exit 66
_stowmind_reviewed_identity() {{
  local root_identity
  root_identity=$(mole_deletion_identity "$reviewed_root") || return 1
  [[ "${{root_identity%:*}}" == "${{expected_root%:*}}" ]] || return 1
  local i
  for i in "${{!reviewed_paths[@]}}"; do
    if [[ "$1" == "${{reviewed_paths[$i]}}" && ! -L "$1" && -d "$1" ]]; then
      [[ "$(mole_deletion_identity "$1")" == "${{reviewed_ids[$i]}}" ]]
      return $?
    fi
  done
  return 1
}}
# Supply only the native review inventory. Mole still applies its current
# whitelist, project protection, activity checks and final deletion checks.
scan_purge_targets() {{
  [[ "$1" == "$reviewed_root" ]] || return 1
  : > "$2"
  local path
  for path in "${{reviewed_paths[@]}}"; do
    _stowmind_reviewed_identity "$path" || return 1
    printf '%s\n' "$path" >> "$2" || return 1
  done
}}
eval "$(declare -f _mole_purge_final_remove_guard | sed '1s/_mole_purge_final_remove_guard/_stowmind_original_purge_guard/')"
_mole_purge_final_remove_guard() {{
  _stowmind_original_purge_guard "$@" || return $?
  _stowmind_reviewed_identity "$1"
}}
export MOLE_PURGE_INCLUDE_EMPTY={} MOLE_PURGE_YES=1
unset MOLE_DRY_RUN
start_purge
perform_purge"#,
        source_script(script),
        shell_quote(root),
        if include_empty { "1" } else { "0" }
    )
}
