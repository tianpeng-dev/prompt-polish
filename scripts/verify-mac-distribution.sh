#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "$0")/.." && pwd)"
version="$(node -p "require('$project_root/package.json').version")"
app_path="${1:-$project_root/release/mac-arm64/精炼台.app}"
zip_path="${2:-$project_root/release/JingLianTai-$version-mac-arm64.zip}"
temporary_parent="${3:-$project_root/.work}"
mkdir -p "$temporary_parent"
temporary_root="$(mktemp -d "$temporary_parent/mac-verification-XXXXXX")"
trap 'rm -rf "$temporary_root"' EXIT

verify_app() {
  local candidate="$1"
  local signature_info

  codesign --verify --deep --strict --verbose=4 "$candidate"
  signature_info="$(codesign -dvvv "$candidate" 2>&1)"
  grep -q '^Signature=adhoc$' <<<"$signature_info"
  grep -q '^TeamIdentifier=not set$' <<<"$signature_info"
  grep -q '^Sealed Resources version=2' <<<"$signature_info"
}

[[ -d "$app_path" ]] || { echo "未找到 macOS 应用：$app_path" >&2; exit 1; }
[[ -f "$zip_path" ]] || { echo "未找到 macOS 安装包：$zip_path" >&2; exit 1; }

verify_app "$app_path"
ditto -x -k "$zip_path" "$temporary_root"
xattr -cr "$temporary_root/精炼台.app"
verify_app "$temporary_root/精炼台.app"

echo "macOS 完整临时签名与最终 ZIP 校验通过。"
