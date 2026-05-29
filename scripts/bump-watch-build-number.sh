#!/bin/bash
# Sets CFBundleVersion in a target Info.plist to a monotonically-increasing value.
#
# WHY: The Apple Watch sync service on the paired iPhone caches the installed
# Watch app keyed by CFBundleVersion. If two builds share the same version,
# sync treats the new build as "already installed" and serves cached old code —
# forcing the manual "nuclear delete + reinstall" dance (see skill
# xcodebuild-watchos-realdevice-install Trap 3). Bumping CFBundleVersion every
# build makes sync see a fresh version and auto-push the new bundle.
#
# Usage:
#   scripts/bump-watch-build-number.sh <plist-path> [value]
#
#   <plist-path>  Required. Path to the Info.plist to mutate. When wired as an
#                 Xcode Run Script Build Phase on the Watch target, pass the
#                 BUILT product's plist so the SOURCE plist is never churned:
#                   "${TARGET_BUILD_DIR}/${INFOPLIST_PATH}"
#   [value]       Optional. The CFBundleVersion to set. Defaults to the current
#                 Unix timestamp (`date +%s`) — monotonic across builds, never
#                 collides, and stays well under the 2.1e9 watchOS Int32 ceiling
#                 until the year 2038 (CFBundleVersion is a string anyway, so
#                 even past 2038 it is fine; the Int32 note is only relevant to
#                 Swift epoch-ms casts, not this string field).
#
# Examples:
#   # Standalone test against a COPY (never the real source plist):
#   cp "ios/TrainingLog-Watch-Watch-App-Info.plist" /tmp/copy.plist
#   scripts/bump-watch-build-number.sh /tmp/copy.plist
#
#   # As an Xcode Build Phase (Watch target, after the Sources phase):
#   scripts/bump-watch-build-number.sh "${TARGET_BUILD_DIR}/${INFOPLIST_PATH}"
#
# Monotonic guarantee: a Unix timestamp only ever increases over wall-clock
# time. Two builds in the same second would collide; pass an explicit [value]
# (e.g. an injected git commit count or $CONFIGURATION_BUILD_DIR-derived
# counter) if you need sub-second uniqueness. For the Watch sync use case the
# default is sufficient — human-paced rebuilds are always seconds apart.

set -euo pipefail

PLIST_BUDDY=/usr/libexec/PlistBuddy

PLIST_PATH="${1:-}"
VALUE="${2:-$(date +%s)}"

if [ -z "$PLIST_PATH" ]; then
  echo "error: missing plist path argument" >&2
  echo "usage: $0 <plist-path> [value]" >&2
  exit 1
fi

if [ ! -f "$PLIST_PATH" ]; then
  echo "error: plist not found at $PLIST_PATH" >&2
  exit 1
fi

if [ ! -x "$PLIST_BUDDY" ]; then
  echo "error: PlistBuddy not found at $PLIST_BUDDY" >&2
  exit 1
fi

# Detect the original on-disk format so we can restore it after writing.
# Built-product Info.plists are BINARY; PlistBuddy always writes XML on save, so
# without this we'd silently convert the bundle plist to XML. Both formats are
# valid at runtime, but preserving binary keeps the output identical to what
# Xcode normally emits.
ORIG_FMT=binary1
if file "$PLIST_PATH" | grep -qi "XML"; then
  ORIG_FMT=xml1
fi

# Read the existing value (may be absent — GENERATE_INFOPLIST_FILE targets have
# CFBundleVersion injected from CURRENT_PROJECT_VERSION, so the SOURCE partial
# plist usually has no such key). Tolerate absence.
OLD_VALUE="$("$PLIST_BUDDY" -c "Print :CFBundleVersion" "$PLIST_PATH" 2>/dev/null || echo "<unset>")"

# Set if present, otherwise Add. PlistBuddy's Set fails on a missing key, so we
# branch on whether the read succeeded.
if [ "$OLD_VALUE" = "<unset>" ]; then
  "$PLIST_BUDDY" -c "Add :CFBundleVersion string $VALUE" "$PLIST_PATH"
else
  "$PLIST_BUDDY" -c "Set :CFBundleVersion $VALUE" "$PLIST_PATH"
fi

# Restore the original binary/xml format (PlistBuddy wrote XML).
plutil -convert "$ORIG_FMT" "$PLIST_PATH"

echo "bump-watch-build-number: CFBundleVersion $OLD_VALUE -> $VALUE  ($PLIST_PATH, $ORIG_FMT)"
