use crate::mole_utils::shell_quote;

pub(super) fn collect_script(script: &str) -> String {
    format!(
        r#"export MOLE_TEST_MODE=1
source {} || exit $?
declare -F collect_installers mole_deletion_identity >/dev/null || exit 64
status=0
collect_installers >/dev/null || status=$?
case "$status" in
  0) ;;
  1) [[ ${{#INSTALLER_PATHS[@]}} -eq 0 ]] || exit 65 ;;
  *) printf 'Mole installer scan failed (status %s)\n' "$status" >&2; exit "$status" ;;
esac
printf 'STOWMIND_INSTALLERS_V1\x1e'
for i in "${{!INSTALLER_PATHS[@]}}"; do
  [[ ! -L "${{INSTALLER_PATHS[$i]}}" && -f "${{INSTALLER_PATHS[$i]}}" ]] || exit 66
  identity=$(mole_deletion_identity "${{INSTALLER_PATHS[$i]}}") || exit $?
  printf '%s\x1f%s\x1f%s\x1f%s\x1e' "${{INSTALLER_PATHS[$i]}}" "${{INSTALLER_SIZES[$i]}}" "${{INSTALLER_SOURCES[$i]}}" "$identity"
done
printf 'STOWMIND_INSTALLERS_END\x1e'
"#,
        shell_quote(script)
    )
}

pub(super) fn execute_script(script: &str) -> String {
    format!(
        r#"export MOLE_TEST_MODE=1
source {} || exit $?
declare -F reset_installer_delete_results build_installer_delete_plan execute_installer_delete_plan show_summary >/dev/null || exit 64
[[ "${{MOLE_DRY_RUN:-0}}" != 1 ]] || exit 65
INSTALLER_PATHS=(); INSTALLER_SIZES=(); INSTALLER_SOURCES=(); expected=(); indices=()
while [[ $# -gt 0 ]]; do
  [[ $# -ge 3 ]] || exit 66
  [[ -f "$1" && ! -L "$1" ]] || exit 67
  indices+=("${{#INSTALLER_PATHS[@]}}")
  INSTALLER_PATHS+=("$1"); INSTALLER_SIZES+=("$2"); INSTALLER_SOURCES+=("StowMind"); expected+=("$3")
  shift 3
done
reset_installer_delete_results
status=0
build_installer_delete_plan "${{indices[@]}}" || status=$?
if [[ $status -eq 0 ]]; then
  [[ ${{#INSTALLER_DELETE_IDENTITIES[@]}} -eq ${{#expected[@]}} ]] || exit 68
  for i in "${{!expected[@]}}"; do
    [[ "${{INSTALLER_DELETE_IDENTITIES[$i]}}" == "${{expected[$i]}}" ]] || {{ printf 'Installer changed since preview; scan again\n' >&2; exit 69; }}
  done
  # Mole owns deletion and rechecks reviewed identity and size immediately before it.
  # A pipeline would lose Mole's counters in a subshell; keep this in this shell.
  execute_installer_delete_plan || status=$?
fi
show_summary
printf '\nSTOWMIND_INSTALLER_RESULT_V1\x1f%s\x1f%s\x1f%s\x1f%s\x1e\n' "$total_deleted" "$total_size_freed_kb" "$total_delete_failed" "$status"
exit "$status"
"#,
        shell_quote(script)
    )
}
