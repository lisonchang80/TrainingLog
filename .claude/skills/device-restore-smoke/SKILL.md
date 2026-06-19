---
name: device-restore-smoke
description: >
  Real-device smoke for backup / restore / boot-recovery flows on a physical
  iPhone, where the truth lives in the app sandbox not the screen. Trigger
  words: 'restore device smoke', '中斷還原實機', 'backup 實機驗', 'iCloud 還原
  實機', '🟠-1 device', 'kill-window restore'. Covers: pulling + inspecting the
  app's Documents/SQLite via `devicectl device copy from --domain-type
  appDataContainer`, distinguishing silent-heal vs gate-restore by disk
  signature, widening a sub-second restore kill-window with a temp sleep,
  cold-relaunch (NOT Reload JS) to re-run mount-effect boot logic, and the
  Documents-not-in-Files-app caveat. Files: src/services/restoreService.ts,
  components/restore-gate.tsx, components/database-provider.tsx,
  src/services/jsonExport.ts, src/services/restoreDepsWiring.ts.
---

# Device restore / backup / boot-recovery smoke

For slice-15-family flows (iCloud backup, restore engine, 🟠-1 boot self-heal,
JSON export) the **device screen lies** — a restore swap is sub-second, a
self-heal is invisible, and "F didn't come back" can be correct behavior. The
ground truth is the files in the app sandbox. This skill is how to read them and
how to force the timing.

Validated 2026-06-19 (TrainingLog device smoke): this is what caught the 🟠-1
RestoreGate-shadow bug (`11f54d6`) that sim + jest both missed.

## The judgment tool — pull the app sandbox with devicectl

The single most useful move. Read-only, doesn't touch the device.

```bash
# iPhone UDID: xcrun xctrace list devices | grep -i iphone | grep -v Simulator
rm -rf /tmp/TL-sqlite && xcrun devicectl device copy from \
  --device <iphone-udid> \
  --domain-type appDataContainer \
  --domain-identifier com.lisonchang.TrainingLog \
  --source Documents/SQLite \
  --destination /tmp/TL-sqlite
ls -la /tmp/TL-sqlite/
sqlite3 /tmp/TL-sqlite/traininglog.db "SELECT id,name FROM template ORDER BY id;"
```

- The `Failed to load provisioning paramter list ... No provider was found.`
  warning is **harmless** — the file still copies (`File received from Device`).
- `--source` is a path RELATIVE to the container root (`Documents/SQLite`,
  `Documents/traininglog-export-<ms>.json`); a directory pulls recursively.
- Live DB = `traininglog.db`; restore artifacts also live in `Documents/SQLite/`:
  `pre-restore-<ms>.sqlite` (executeRestore step-1 self-backup),
  `restore-in-progress.sqlite` (🟠-1 crash marker),
  `backup-snapshot-<ms>.sqlite` (backupService snapshot).

### Disk signatures — what happened, without watching the screen

| State on disk | Meaning |
|---|---|
| live present, marker gone, **NEW pre-restore copy** | a full `executeRestore` ran (gate→還原 or Settings restore) |
| live present, marker gone, **NO new pre-restore copy** | 🟠-1 **silent self-heal** ran (heal copies marker→live, makes no pre-restore) |
| **no live**, marker present | mid-restore kill-window state (delete done, copy-in not) — exactly what 🟠-1 protects |
| new `backup-snapshot` after a cold launch | app reached **normal operation** (auto-backup needs the DB open) → boot got past the gate |

⭐ A self-heal and a manual gate-restore both end at "live present, marker gone".
The **new-pre-restore-copy** is the tell-tale that separates them.

## Forcing the timing

### Sub-second kill-window → widen with a temp sleep
A real device DB is small; the destructive swap window (between delete-live and
copy-in) is sub-second — you cannot hit it by hand. Temporarily insert a delay
in `executeRestore` (`src/services/restoreService.ts`) BETWEEN the clear-old
step and the copy-in step:

```ts
console.warn('[restore] ⚠️ TEMP 6s kill-window OPEN — force-kill NOW');
await new Promise((r) => setTimeout(r, 6000));
```

Pure JS → Metro **Reload JS** picks it up, no rebuild. `git checkout
src/services/restoreService.ts` to remove when done (never commit it; pre-commit
hook would run but it must not ship).

### Cold-relaunch, NOT Reload JS
Boot-recovery / RestoreGate logic lives in a `useEffect(() => {...}, [])` MOUNT
probe. **Fast Refresh / Reload JS hot-swaps without remounting** → the mount
effect doesn't re-run → the heal/gate logic doesn't fire. To exercise it you
need a fresh JS context:

```bash
xcrun devicectl device process launch --device <udid> --terminate-existing com.lisonchang.TrainingLog
# kill mid-restore (during the widened window):
xcrun devicectl device process terminate --device <udid> com.lisonchang.TrainingLog
```

A genuine cold launch also re-fetches the current Metro bundle, so it picks up
any fix you just made.

## Caveats that bite

- **Documents is NOT in the Files app** unless `ios/TrainingLog/Info.plist` has
  `UIFileSharingEnabled` + `LSSupportsOpeningDocumentsInPlace` (TrainingLog has
  neither; JSON-export Share Sheet is deferred). So "open the exported JSON on
  the phone" is impossible — verify by reading the success Alert's `file://`
  path, then `devicectl copy from` it to the Mac.
- **🟠-1 rolls back to PRE-RESTORE, it does not finish the interrupted restore.**
  If you delete template F, then restore a backup that HAS F, then kill mid-swap
  → recovery restores the *pre-restore* state (F still deleted). That is CORRECT.
  To get F you re-run the restore to completion. Don't read "F absent" as a fail.
- **Boot order**: `RestoreGate` mounts ABOVE `DatabaseProvider`
  (`app/_layout.tsx`). Any boot-time DB recovery must run inside / before
  RestoreGate's mount probe — code placed only in DatabaseProvider is shadowed
  whenever the live DB is missing (RestoreGate gates first). This was the
  `11f54d6` bug. `recoverInterruptedRestore` now runs at the TOP of RestoreGate's
  mount probe, before its `dbExists` check.

## Why device-only (sim + jest can't)
- jest tests `recoverInterruptedRestore` in isolation → never sees RestoreGate
  shadowing it (a component-render integration the node-env harness can't run).
- sim can't reproduce a process-kill mid-swap reliably, and has no real iCloud.
- Per `feedback_sim-smoke-first`: verify all iPhone-side UI on the simulator
  first, so the scarce device session is spent only on these data-safety paths.

## Companion skills
- `xcodebuild-watchos-realdevice-install` — when a fix DOES touch `ios/**/*.swift`
  (this skill's flows are JS-only → Reload JS / cold-launch, never a rebuild).
  Pre-check: `git diff --stat main...<branch> -- '*.swift' 'ios/**'` empty ⇒ no
  rebuild.
- `ios-simulator-smoke` / `sim-db-seed-smoke` — the iPhone-side-first half.
