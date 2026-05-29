---
name: xcodebuild-watchos-realdevice-install
description: Build + install a React Native + watchOS embedded app to a paired iPhone + Apple Watch from CLI. Triggers — "裝到 Watch", "install to iPhone real device", "Watch app 沒更新", "xcodebuild install 沒推到 device", or any time we need to deploy new Watch SwiftUI to the user's wrist for smoke. Owns paths under `ios/TrainingLog.xcworkspace`, `~/Library/Developer/Xcode/DerivedData/TrainingLog-*/`, and the `xcrun devicectl` / `xcrun xctrace` device chain.
---

# xcodebuild watchOS real-device install

## When to use

User wants to push the latest `ios/TrainingLog Watch Watch App/*.swift` to their physical Apple Watch (paired with their iPhone) for smoke. e.g. just shipped D14/D15/D16 SwiftUI, just changed ContentView.swift root, just need to verify a Picker change on wrist.

If only iPhone-side TS changes (no Watch Swift touched), Metro packager + Reload JS is enough — skip this skill.

## The booby traps (validated 2026-05-29 morning, ~45 min lost; Trap 4 added 2026-05-29 afternoon)

### Trap 1 — `xcodebuild ... install` does NOT push to device

`xcodebuild -scheme TrainingLog -destination 'id=<iphone>' install` prints `** INSTALL SUCCEEDED **` but only **stages** the .app at:

```
~/Library/Developer/Xcode/DerivedData/TrainingLog-*/Build/Intermediates.noindex/ArchiveIntermediates/TrainingLog/InstallationBuildProductsLocation/Applications/TrainingLog.app
```

The artifact never reaches the iPhone. `xcrun devicectl device info apps --device <id> | grep -i training` returns empty. User sees old version.

**Fix**: after `xcodebuild install` succeeds (or even after just `xcodebuild build`), follow with:

```bash
xcrun devicectl device install app \
  --device <iphone-udid> \
  "<DerivedData>/Build/Intermediates.noindex/ArchiveIntermediates/TrainingLog/InstallationBuildProductsLocation/Applications/TrainingLog.app"
```

Success output looks like:
```
App installed:
? bundleID: com.lisonchang.TrainingLog
? installationURL: file:///private/var/containers/Bundle/Application/<uuid>/TrainingLog.app/
```

Confirm via `xcrun devicectl device info apps --device <iphone-udid> | grep -i training`.

### Trap 2 — incremental build SKIPS Watch target

> If you can't find the symbol in the main binary, see Trap 4 — debug builds split it out.

If the iPhone host target has no new `.ts/.tsx/.m/.swift` touched, `xcodebuild install` decides the cached host app is fine and **never invokes Watch target compile** — even when `ios/TrainingLog Watch Watch App/*.swift` was just cherry-picked.

Symptom: `grep -E "(SwiftCompile|Watch Watch App)" build.log` → **0 matches**. The embedded `.app/Watch/TrainingLog Watch Watch App.app/TrainingLog Watch Watch App` binary timestamp may update from codesign step, but `nm -arch arm64 <binary> | grep PickerRootView` shows only `_Preview` symbols → production ContentView still references old `dev_smoke` UI from previous build.

**Diagnostic**: check `.o` timestamps at:
```
~/Library/Developer/Xcode/DerivedData/TrainingLog-*/Build/Intermediates.noindex/ArchiveIntermediates/TrainingLog/IntermediateBuildFilesPath/TrainingLog.build/Debug-watchos/TrainingLog Watch Watch App.build/Objects-normal/arm64/<View>.o
```
If `FinishPageView.o`/`DotsMenuView.o`/`WatchSettingsView.o` don't exist there (only `arm64_32` or `Debug-watchsimulator`), Watch target was skipped.

**Fix**: force-clean rebuild:
```bash
cd ios
xcodebuild -workspace TrainingLog.xcworkspace -scheme TrainingLog \
  -configuration Debug \
  -destination 'id=<iphone-udid>' \
  -allowProvisioningUpdates \
  clean install
```

`clean install` forces every target (incl. Pods) to recompile. Costs 5-10 min vs 30-60s incremental. Verify success by counting Watch SwiftCompile entries:
```bash
grep -cE "SwiftCompile.*Watch Watch App" build.log
# expect ≥ 20 (Watch target has ~24 .swift files)
```

Then Trap 1 still applies — must `devicectl install` after `clean install`.

### Trap 3 — Apple Watch sync uses aggressive cache

Even after iPhone host app contains fresh embedded Watch bundle, the **Apple Watch sync service** on iPhone won't push it to Watch if it thinks "this version" was already installed (same `CFBundleVersion`). User sees old Watch UI.

**Symptoms tier-1**: Toggle OFF/ON in iPhone Apple Watch app → still old version. Even uninstall + reinstall via Apple Watch app UI → same old version.

**Fix (nuclear, ~3-5 min)**:
1. Long-press iPhone TrainingLog icon → **"刪除 App"** (must be Delete App, NOT just "從主畫面移除")
2. iPhone Apple Watch app → 我的手錶 → TrainingLog Watch → 滑到底 → **[移除 App]**
3. Confirm Watch home (Crown press) — TrainingLog icon should vanish
4. From CLI: `devicectl install` again (host app gone = sync service sees true new install)
5. Apple Watch app → 我的手錶 → 可用的 APP → TrainingLog Watch → **[安裝]**
6. Wait 1-3 min, Watch icon reappears, launch — should be fresh build

### Trap 4 — Xcode 16+ debug builds split binary into stub + `.debug.dylib`

For watchOS Debug builds (and possibly iphoneos too), Xcode 16+ emits two files instead of one:

- A tiny launcher stub at `TrainingLog Watch Watch App.app/TrainingLog Watch Watch App` (~200KB, mostly empty `__cstring` section)
- The actual Swift code in a sibling `TrainingLog Watch Watch App.app/TrainingLog Watch Watch App.debug.dylib` (~6-7MB)

This breaks the "verify binary contains symbol X" sanity check from Trap 2 — running `nm` or `strings` on the main binary returns ~0 useful matches even when the build was correct. You'll waste time thinking the build is broken when it's actually fine.

**Fix** — grep the `.debug.dylib` instead:

```bash
strings "$APP/Watch/TrainingLog Watch Watch App.app/TrainingLog Watch Watch App.debug.dylib" \
  | grep -i 'YourSymbolHere'
```

Or check both at once:

```bash
find "$APP" -name "*.debug.dylib" -exec strings {} \; | grep -i 'YourSymbolHere'
```

Validated 2026-05-29 ~14:00 during D29+D30 NEW-Q50 ship. The `.debug.dylib` is automatically embedded into the iPhone `.app/Watch/` bundle and installs cleanly via `devicectl` — **users don't need to do anything special**. This trap is purely a *verification* gotcha for the developer; don't waste time rebuilding the wrong file.

This is a Release-vs-Debug build difference; Release builds may still produce a single combined binary.

## End-to-end recipe

```bash
# 0. Pre-flight — confirm devices connected
xcrun xctrace list devices 2>&1 | grep -iE "iPhone|Watch" | grep -v Simulator

# 1. Clean rebuild (forces Watch target compile per Trap 2)
cd /path/to/repo/ios
xcodebuild -workspace TrainingLog.xcworkspace -scheme TrainingLog \
  -configuration Debug \
  -destination 'id=<iphone-udid>' \
  -allowProvisioningUpdates \
  clean install 2>&1 | tee /tmp/watch-build.log

# 2. Verify Watch target really compiled
grep -cE "SwiftCompile.*Watch Watch App" /tmp/watch-build.log
# expect ≥ 20

# 3. Push to iPhone for real (per Trap 1)
APP_PATH="<DerivedData>/Build/Intermediates.noindex/ArchiveIntermediates/TrainingLog/InstallationBuildProductsLocation/Applications/TrainingLog.app"
xcrun devicectl device install app --device <iphone-udid> "$APP_PATH"

# 4. Verify iPhone really has it
xcrun devicectl device info apps --device <iphone-udid> | grep -i training

# 5. Launch on iPhone
xcrun devicectl device process launch --device <iphone-udid> com.lisonchang.TrainingLog

# 6. If user has old Watch app installed → instruct nuclear delete per Trap 3
```

## When something looks wrong, verify in this order

1. **Did host iPhone really get the install?**
   `xcrun devicectl device info apps --device <id> | grep -i training` — empty = Trap 1
2. **Did Watch target actually compile?**
   `find <DerivedData>/.../Debug-watchos/.../Objects-normal/arm64 -name "<NewestView>.o"` — empty = Trap 2
3. **Does the binary contain production refs (not just Preview)?**
   `nm -arch arm64 <Watch binary> | grep PickerRootView | grep -v Preview | head` — empty = Trap 2 again (incremental cache)
4. **Does Apple Watch sync see new bundle?**
   `xcrun devicectl device info apps --device <watch-id> | grep -i training` — if shows old `Bundle Version`, Trap 3

## RN-side caveat (related but not the same trap)

If the user opens the app and sees React Native red error page `No script URL provided`, that's Metro packager missing, NOT this skill's territory. Fix: `npx expo start --dev-client` from repo root (LAN-reachable from iPhone) → iPhone tap **Reload JS**. This is per-launch and unrelated to Watch binary state.

## Cost of skipping this skill

2026-05-29 morning: ~45 min lost iterating "rebuild → user reports old Watch UI → re-investigate". Three full xcodebuild rounds (07:12, 07:36, 07:50) all printed `** INSTALL SUCCEEDED **` while iPhone had no app installed. Only at 08:00 did `devicectl install` solve Trap 1, and only after clean build at 07:50 was Watch target actually compiled (Trap 2). User then hit Trap 3 (cached old Watch UI) until iPhone host app was fully deleted at 08:30.

Don't repeat. Start with `clean install` + `devicectl install` from the start when shipping new Watch Swift code to wrist.
