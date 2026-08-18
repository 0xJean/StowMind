#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "iOS mirror helper is macOS-only; skipping."
  exit 0
fi

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_files=("${root}/src-tauri/ios-helper/"*.swift)
output_dir="${root}/src-tauri/binaries"
mkdir -p "${output_dir}"

deployment_target="${MACOSX_DEPLOYMENT_TARGET:-15.0}"
requested_archs="${IOS_HELPER_ARCHS:-universal}"
archs=("${requested_archs}")
if [[ "${requested_archs}" == "universal" ]]; then
  archs=(arm64 x86_64)
fi

temporary_outputs=()
for arch in "${archs[@]}"; do
  target="${arch}-apple-macosx${deployment_target}"
  output="${output_dir}/stowmind-ios-helper-${arch}"
  swiftc -O -target "${target}" \
    -framework AppKit \
    -framework CoreImage \
    -framework CoreMedia \
    -framework CoreVideo \
    -framework Metal \
    -framework QuartzCore \
    -framework Vision \
    -framework ApplicationServices \
    -framework CoreGraphics \
    -framework ScreenCaptureKit \
    -o "${output}" \
    "${source_files[@]}"
  temporary_outputs+=("${output}")
done

if [[ "${#temporary_outputs[@]}" -gt 1 ]]; then
  lipo -create "${temporary_outputs[@]}" -output "${output_dir}/stowmind-ios-helper"
else
  cp "${temporary_outputs[0]}" "${output_dir}/stowmind-ios-helper"
fi

chmod 755 "${output_dir}/stowmind-ios-helper"

helper_bundle_id="${IOS_HELPER_BUNDLE_ID:-com.stowmind.app.ios-helper}"
if [[ -n "${APPLE_SIGNING_IDENTITY:-}" ]]; then
  if ! security find-identity -v -p codesigning | grep -Fq "\"${APPLE_SIGNING_IDENTITY}\""; then
    echo "Signing identity not available for iOS mirror helper: ${APPLE_SIGNING_IDENTITY}" >&2
    exit 1
  fi
  codesign --force --options runtime --timestamp \
    --identifier "${helper_bundle_id}" \
    --sign "${APPLE_SIGNING_IDENTITY}" \
    "${output_dir}/stowmind-ios-helper"
  codesign --verify --strict --all-architectures "${output_dir}/stowmind-ios-helper"
elif [[ "${STOWMIND_ADHOC_SIGN_HELPER:-0}" == "1" ]]; then
  codesign --force \
    --identifier "${helper_bundle_id}" \
    --sign - \
    "${output_dir}/stowmind-ios-helper"
  codesign --verify --strict --all-architectures "${output_dir}/stowmind-ios-helper"
fi

echo "Built ${output_dir}/stowmind-ios-helper"
