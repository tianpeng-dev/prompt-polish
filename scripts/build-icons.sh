#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$project_root/.work"
temporary_root="$(mktemp -d "$project_root/.work/icons-XXXXXX")"
iconset="$temporary_root/app-icon.iconset"
mkdir -p "$iconset"
trap 'rm -rf "$temporary_root"' EXIT

qlmanage -t -s 1024 -o "$temporary_root" "$project_root/assets/app-icon.svg" >/dev/null 2>&1
source_png="$temporary_root/app-icon.svg.png"

if [[ ! -f "$source_png" ]]; then
  echo "无法从 SVG 生成应用图标。" >&2
  exit 1
fi

sips -z 16 16 "$source_png" --out "$iconset/icon_16x16.png" >/dev/null
sips -z 32 32 "$source_png" --out "$iconset/icon_16x16@2x.png" >/dev/null
sips -z 32 32 "$source_png" --out "$iconset/icon_32x32.png" >/dev/null
sips -z 64 64 "$source_png" --out "$iconset/icon_32x32@2x.png" >/dev/null
sips -z 128 128 "$source_png" --out "$iconset/icon_128x128.png" >/dev/null
sips -z 256 256 "$source_png" --out "$iconset/icon_128x128@2x.png" >/dev/null
sips -z 256 256 "$source_png" --out "$iconset/icon_256x256.png" >/dev/null
sips -z 512 512 "$source_png" --out "$iconset/icon_256x256@2x.png" >/dev/null
sips -z 512 512 "$source_png" --out "$iconset/icon_512x512.png" >/dev/null
cp "$source_png" "$iconset/icon_512x512@2x.png"

iconutil -c icns "$iconset" -o "$project_root/assets/app-icon.icns"
sips -z 512 512 "$source_png" --out "$project_root/assets/app-icon.png" >/dev/null

sips -z 18 18 -s format png "$project_root/assets/tray-icon.svg" \
  --out "$project_root/assets/tray-iconTemplate.png" >/dev/null
sips -z 36 36 -s format png "$project_root/assets/tray-icon.svg" \
  --out "$project_root/assets/tray-iconTemplate@2x.png" >/dev/null
sips -z 32 32 -s format png "$project_root/assets/tray-icon-win.svg" \
  --out "$project_root/assets/tray-icon-win.png" >/dev/null
