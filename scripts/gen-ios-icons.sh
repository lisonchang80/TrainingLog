#!/bin/bash
# Generates iOS AppIcon set from a single 1024x1024 source PNG using macOS `sips`.
#
# Usage:
#   scripts/gen-ios-icons.sh [source-png]
#
# Defaults to the in-place 1024 marketing icon. The source MUST be RGB (no
# alpha) — Apple rejects icons with alpha channels.
#
# Output goes to ios/TrainingLog/Images.xcassets/AppIcon.appiconset/. The
# accompanying Contents.json references every generated file.
#
# Generated PNGs are auto-downscaled placeholders. A designer should replace
# the 1024 source with the final art and re-run this script.
#
# See docs/testflight/icon-spec.md for the full size table.

set -euo pipefail

OUT="ios/TrainingLog/Images.xcassets/AppIcon.appiconset"
SRC="${1:-$OUT/App-Icon-1024x1024@1x.png}"

if [ ! -f "$SRC" ]; then
  echo "error: source image not found at $SRC" >&2
  exit 1
fi

if [ ! -d "$OUT" ]; then
  echo "error: AppIcon.appiconset directory not found at $OUT" >&2
  exit 1
fi

# 13 spec sizes (the 1024 marketing icon is the source itself, kept in place).
# Format: "<pixel-size> <filename>"
SIZES=(
  "40 App-Icon-20x20@2x.png"
  "60 App-Icon-20x20@3x.png"
  "58 App-Icon-29x29@2x.png"
  "87 App-Icon-29x29@3x.png"
  "80 App-Icon-40x40@2x.png"
  "120 App-Icon-40x40@3x.png"
  "120 App-Icon-60x60@2x.png"
  "180 App-Icon-60x60@3x.png"
  "20 App-Icon-20x20@1x~ipad.png"
  "29 App-Icon-29x29@1x~ipad.png"
  "40 App-Icon-40x40@1x~ipad.png"
  "76 App-Icon-76x76@2x~ipad.png"
  "167 App-Icon-83.5x83.5@2x~ipad.png"
)

echo "Source: $SRC"
echo "Output: $OUT"
for entry in "${SIZES[@]}"; do
  px="${entry%% *}"
  name="${entry#* }"
  sips -z "$px" "$px" "$SRC" --out "$OUT/$name" -s format png >/dev/null
  printf "  %-44s %dx%d\n" "$name" "$px" "$px"
done

echo "Done. 1024 marketing icon left in place at $OUT/App-Icon-1024x1024@1x.png"
