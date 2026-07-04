#!/bin/bash
# Paired-simulator Watch⇄iPhone smoke environment doctor.
#
# The paired-sim WCSession environment is fast but fragile (see skill
# watchos-simulator-smoke §PAIRED-SIM): single-sided watch reboots wipe the
# phone-side wcd "watch app installed" registration (WCErrorDomain 7006 →
# every phone→watch push dies silently), and sim-HK degrades after repeated
# workout cycles. This script turns the hand-run recovery recipe into one
# command.
#
#   scripts/sim-wc-smoke-env.sh status   # health report, no changes
#   scripts/sim-wc-smoke-env.sh reset    # full recovery: reinstall watch app,
#                                        # reboot BOTH sims, relaunch both apps
#
# Override defaults via env: PHONE_UDID / WATCH_UDID / WATCH_APP / PHONE_APP.
# Validated 2026-07-04 (reset sequence = the only recipe that clears 7006;
# over-install without uninstall does NOT re-trigger the registration event).

set -euo pipefail

PHONE_UDID="${PHONE_UDID:-6CA1EB12-83DF-4F83-AC12-25C6F665C2C2}"   # iPhone 17
WATCH_UDID="${WATCH_UDID:-52DD8CD0-7D8C-4953-B248-5361AB614BBC}"   # Watch S11 46mm
REPO="$(cd "$(dirname "$0")/.." && pwd)"
WATCH_APP="${WATCH_APP:-$REPO/ios/build/simsmoke-watch/Build/Products/Debug-watchsimulator/TrainingLog Watch Watch App.app}"
PHONE_BUNDLE="com.lisonchang.TrainingLog"
WATCH_BUNDLE="com.lisonchang.TrainingLog.watchkitapp"

status() {
  echo "== pair =="
  xcrun simctl list pairs | sed -n '2,4p'
  echo "== booted =="
  xcrun simctl list devices booted | grep -E "iPhone|Watch" || echo "  (none booted)"
  echo "== apps =="
  xcrun simctl get_app_container "$PHONE_UDID" "$PHONE_BUNDLE" data >/dev/null 2>&1 \
    && echo "  phone app: installed" || echo "  phone app: MISSING"
  xcrun simctl get_app_container "$WATCH_UDID" "$WATCH_BUNDLE" data >/dev/null 2>&1 \
    && echo "  watch app: installed" || echo "  watch app: MISSING"
  # 2-minute window: right after a reset, older windows still show the
  # PRE-reset failure burst and read as a false alarm.
  echo "== 7006 (phone→watch push death) in last 2m =="
  local n
  n=$(xcrun simctl spawn "$PHONE_UDID" log show --last 2m \
      --predicate 'process == "TrainingLog" AND eventMessage CONTAINS "not installed"' \
      --style compact 2>/dev/null | grep -c "not installed" || true)
  if [ "${n:-0}" -gt 0 ]; then
    echo "  ⚠️  $n hits — phone→watch lanes are DEAD. Run: $0 reset"
  else
    echo "  ✅ clean"
  fi
}

reset() {
  [ -d "$WATCH_APP" ] || { echo "watch app build not found: $WATCH_APP"; exit 1; }
  echo "1/5 uninstall + reinstall watch app (forces wcd registration event)…"
  xcrun simctl uninstall "$WATCH_UDID" "$WATCH_BUNDLE" 2>/dev/null || true
  xcrun simctl install "$WATCH_UDID" "$WATCH_APP"
  echo "2/5 shutdown BOTH (never reboot the watch alone)…"
  xcrun simctl shutdown "$PHONE_UDID" 2>/dev/null || true
  xcrun simctl shutdown "$WATCH_UDID" 2>/dev/null || true
  sleep 2
  echo "3/5 boot BOTH…"
  xcrun simctl boot "$PHONE_UDID"
  xcrun simctl boot "$WATCH_UDID" 2>/dev/null || true
  xcrun simctl bootstatus "$PHONE_UDID" -b >/dev/null
  xcrun simctl bootstatus "$WATCH_UDID" -b >/dev/null
  sleep 8
  echo "4/5 launch watch app first, then phone app…"
  xcrun simctl launch "$WATCH_UDID" "$WATCH_BUNDLE"
  sleep 4
  xcrun simctl launch "$PHONE_UDID" "$PHONE_BUNDLE"
  sleep 12
  echo "5/5 verify…"
  status
  echo ""
  echo "Note: watch seen-once flags were wiped by the reinstall — the"
  echo "first-launch carousel will show once; dismiss with ✕."
}

case "${1:-status}" in
  status) status ;;
  reset)  reset ;;
  *) echo "usage: $0 [status|reset]"; exit 1 ;;
esac
