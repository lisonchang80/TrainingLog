#!/bin/bash
# Backward-compatible shim — delegates to the target-agnostic
# scripts/bump-cfbundle-version.sh.
#
# Kept so the existing Watch target "Bump Watch CFBundleVersion" Run Script
# Build Phase (which invokes this path) is NOT regressed. New wiring should call
# bump-cfbundle-version.sh directly.
#
# Usage (unchanged):
#   scripts/bump-watch-build-number.sh <plist-path> [value]
#
# See bump-cfbundle-version.sh for the full rationale (ASC monotonicity +
# Watch sync cache; skill xcodebuild-watchos-realdevice-install Trap 3).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Forward only the args actually provided. Passing an explicit empty "" for the
# optional [value] would defeat bump-cfbundle-version.sh's `${2:-$(date +%s)}`
# default (an empty string is "set", so the default never kicks in). We must
# supply [value] when forwarding [label], so synthesize the timestamp here when
# the caller omitted [value] — preserving the original default behavior.
PLIST_PATH="${1:-}"
VALUE="${2:-$(date +%s)}"
exec "$SCRIPT_DIR/bump-cfbundle-version.sh" "$PLIST_PATH" "$VALUE" "bump-watch-build-number"
