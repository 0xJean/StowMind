#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_binary="$(mktemp "${TMPDIR:-/tmp}/stowmind-ios-evidence.XXXXXX")"
trap 'rm -f "$test_binary"' EXIT
swiftc \
  "${repository_root}/src-tauri/ios-helper/input_cancellation.swift" \
  "${repository_root}/src-tauri/ios-helper/recognition_evidence.swift" \
  "${repository_root}/scripts/tests/ios-helper-evidence.swift" \
  -o "${test_binary}"
"${test_binary}"
