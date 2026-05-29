#!/bin/bash
# Sets CFBundleVersion in a target Info.plist to a monotonically-increasing value.
#
# Target-agnostic: works for ANY target's BUILT product plist (iPhone HOST app,
# embedded Watch app, …). Wire it as an Xcode Run Script Build Phase and pass
# the BUILT product plist so the SOURCE plist is never churned (no git diff):
#   "${TARGET_BUILD_DIR}/${INFOPLIST_PATH}"
#
# WHY (two distinct payoffs):
#   1. App Store Connect monotonicity — ASC rejects an upload whose
#      CFBundleVersion is <= the previous upload's (ITMS-90478). The iPhone HOST
#      app froze at CFBundleVersion=1, so the 2nd TestFlight upload was rejected.
#      Stamping a Unix timestamp every build guarantees each archive is strictly
#      higher than the last → ASC accepts it automatically.
#   2. Apple Watch dev-iteration sync — the paired-iPhone Watch sync service
#      caches the installed Watch app keyed by CFBundleVersion; a fresh value
#      makes it auto-push the new bundle instead of serving cached old code (see
#      skill xcodebuild-watchos-realdevice-install Trap 3).
#
# Usage:
#   scripts/bump-cfbundle-version.sh <plist-path> [value] [label]
#
#   <plist-path>  Required. Path to the Info.plist to mutate (pass the BUILT
#                 product plist, NOT the source).
#   [value]       Optional. The CFBundleVersion to set. Defaults to the current
#                 Unix timestamp (`date +%s`) — monotonic across builds, never
#                 collides, well under any practical ceiling.
#   [label]       Optional. Cosmetic prefix for the echo line (e.g. "host",
#                 "watch"). Defaults to "bump-cfbundle-version".
#
# Examples:
#   # Standalone test against a COPY (never the real source plist):
#   cp "ios/TrainingLog/Info.plist" /tmp/copy.plist
#   scripts/bump-cfbundle-version.sh /tmp/copy.plist
#
#   # As an Xcode Build Phase (any target, after the Sources/Resources phase):
#   scripts/bump-cfbundle-version.sh "${TARGET_BUILD_DIR}/${INFOPLIST_PATH}"
#
# Monotonic guarantee: a Unix timestamp only ever increases over wall-clock
# time. Two builds in the same second would collide; pass an explicit [value]
# if you need sub-second uniqueness. Human-paced rebuilds are always seconds
# apart, so the default is sufficient.

set -euo pipefail

PLIST_BUDDY=/usr/libexec/PlistBuddy

PLIST_PATH="${1:-}"
VALUE="${2:-$(date +%s)}"
LABEL="${3:-bump-cfbundle-version}"

if [ -z "$PLIST_PATH" ]; then
  echo "error: missing plist path argument" >&2
  echo "usage: $0 <plist-path> [value] [label]" >&2
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

echo "$LABEL: CFBundleVersion $OLD_VALUE -> $VALUE  ($PLIST_PATH, $ORIG_FMT)"
