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
# Debug build (per-file compile): expect ≥ 20 (Watch target has ~24 .swift files)
# Release build (WMO bundled compile): expect 2-4 (one CompileSwift + one
#   SwiftCompile line per architecture: arm64_32 + arm64). The SwiftCompile
#   line lists ALL .swift files in one invocation — DON'T panic at the low
#   count, scan for your file name inside that one line instead, or check
#   `<DerivedData>/.../Release-watchos/.../Objects-normal/arm64/*.o` for
#   per-file .o output. Validated 2026-05-29 evening — first WMO smoke
#   showed grep=1 and wasted 10 min debugging until checking the .o files.
```

Then Trap 1 still applies — must `devicectl install` after `clean install`.

**Gotcha**: also note `xcodebuild` end-of-build marker for clean install is
`** INSTALL SUCCEEDED **`, NOT `** BUILD SUCCEEDED **`. Monitor alternations
that grep only `BUILD SUCCEEDED|BUILD FAILED` will miss the success signal
and look like a hung build. Use `INSTALL SUCCEEDED|BUILD SUCCEEDED|BUILD FAILED|error:`
in any monitoring grep.

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

**Iteration tax (2026-05-29 late-evening validated, 10+ Trap 3 cycles in one session)**:

Trap 3 is required for EACH new Swift change to Watch target unless you also bump `CFBundleVersion` in `ios/TrainingLog Watch Watch App/Info.plist` (or the build setting `CURRENT_PROJECT_VERSION`). With same version, Apple Watch sync treats every iteration as "already installed" and serves cached old code — even though the iPhone host bundle is genuinely updated by `devicectl`.

Cost: each Trap 3 cycle = ~3-5 min user time (delete + delete + wait + install + wait). For a 10-fix-iteration debug session that's 30-50 min of wall clock burned on the dance alone.

**Mitigation (IMPLEMENTED 2026-05-29, slice 13d `slice/13d-cfbundle-autobump`)**: a Run Script Build Phase named **"Bump Watch CFBundleVersion"** now runs on the Watch target every build (`alwaysOutOfDate = 1`), after the Resources phase. It calls `scripts/bump-watch-build-number.sh "$TARGET_BUILD_DIR/$INFOPLIST_PATH"`, which sets `CFBundleVersion` in the **built product** Info.plist to the current Unix timestamp (monotonic). Source `Info.plist` + `CURRENT_PROJECT_VERSION` stay at `1` → **zero git churn**. Each build → higher version → Watch sync auto-pushes the fresh bundle → **Trap 3 nuclear-delete dance no longer needed** for routine Swift iteration.

- Script: `scripts/bump-cfbundle-version.sh` (target-agnostic, standalone, testable; takes `<plist-path> [value] [label]`, defaults to `date +%s`, preserves binary/xml plist format). `scripts/bump-watch-build-number.sh` is now a thin backward-compat shim delegating to it (so the Watch phase wiring is unchanged).
- pbxproj also flips `ENABLE_USER_SCRIPT_SANDBOXING` `YES→NO` on both Watch configs — sandboxing denied the phase's read/write of the product plist, and declaring the plist as an `outputPath` collides with Xcode's built-in Info.plist processing ("Multiple commands produce Info.plist"). Disabling matches the main TrainingLog target (already unsandboxed for RN scripts).
- Verified via `xcodebuild` (Xcode 26.4.1 / watchOS 26.4): two consecutive Watch builds → `CFBundleVersion 1 → 178007xxxx → 178007yyyy` (strictly increasing), `BUILD SUCCEEDED`, plist stays binary, `CFBundleShortVersionString` (marketing 1.0) untouched.

**HOST bump (IMPLEMENTED 2026-05-30, slice 13d `slice/13d-host-cfbundle-bump`)** — solves the *real TestFlight blocker*, NOT the Watch-sync dev loop:

The iPhone HOST app (`TrainingLog` target) `CFBundleVersion` was frozen at `1`. App Store Connect requires each upload's HOST build number to be strictly higher than the previous → the 2nd TestFlight upload was rejected with `ITMS-90478`. The Watch-only bump above does NOT cover the host, so it never fixed this.

A second Run Script Build Phase named **"Bump Host CFBundleVersion"** now runs on the HOST `TrainingLog` target every build (`alwaysOutOfDate = 1`), appended LAST (after "Embed Watch Content"). It calls `scripts/bump-cfbundle-version.sh "$TARGET_BUILD_DIR/$INFOPLIST_PATH" "" host`, stamping the built HOST product `Info.plist` `CFBundleVersion` with the current Unix timestamp. Mirrors the Watch phase exactly: **NO `outputPath`** (avoids "Multiple commands produce Info.plist"), writes the BUILT product only → source `ios/TrainingLog/Info.plist` + `CURRENT_PROJECT_VERSION` stay at `1`, **zero git churn**. `ENABLE_USER_SCRIPT_SANDBOXING = NO` added explicitly to both HOST configs (Debug + Release) so the phase can write the product plist (was relying on an unspecified inherited default; now explicit, matching Watch).

- One shared script covers BOTH targets (P3 answer: yes — the logic is plist-path-agnostic; only the cosmetic echo `label` differs).
- Verified standalone + via env-simulated build-phase invocation (real `$SRCROOT`/`$TARGET_BUILD_DIR`/`$INFOPLIST_PATH`, binary product plist): `CFBundleVersion 1 → 1780073277`, binary format + marketing `1.0.0` preserved, monotonic across consecutive runs. `plutil -lint project.pbxproj` → OK.
- **NOT yet confirmed by a real archive** (full RN/Expo iphoneos build needs `pod install` + Metro/Hermes + ~10 min; skipped overnight in a Pods-less worktree per env constraints). Morning archive-verify steps below.

**Morning HOST archive-verify (do before next TestFlight upload)**:
```bash
cd /Users/hao800922/code/TrainingLog/ios   # or merged worktree
pod install                                  # Pods are per-checkout
xcodebuild -workspace TrainingLog.xcworkspace -scheme TrainingLog \
  -configuration Release -sdk iphoneos -allowProvisioningUpdates \
  -archivePath /tmp/TL.xcarchive archive 2>&1 | tee /tmp/host-archive.log
# 1. Confirm the phase ran:
grep -i "host: CFBundleVersion" /tmp/host-archive.log     # expect: 1 -> 17800xxxxx
# 2. Confirm the archived HOST app plist carries the bumped value:
/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' \
  "/tmp/TL.xcarchive/Products/Applications/TrainingLog.app/Info.plist"
# 3. (optional) confirm embedded Watch also bumped:
/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' \
  "/tmp/TL.xcarchive/Products/Applications/TrainingLog.app/Watch/TrainingLog Watch Watch App.app/Info.plist"
# Then export IPA + upload — ASC should accept the strictly-higher host build.
```
Run two archives back-to-back to prove host monotonicity (V2 > V1) before trusting the ASC re-upload.

**Standalone test recipe** (never mutate the real source plist — works for either target's plist):
```bash
cp "ios/TrainingLog/Info.plist" /tmp/copy.plist            # host (or the Watch plist)
scripts/bump-cfbundle-version.sh /tmp/copy.plist "" host   # or call bump-watch-build-number.sh
/usr/libexec/PlistBuddy -c "Print :CFBundleVersion" /tmp/copy.plist
```

**Caveat**: the bump lands in the built product `Info.plist` *during the build/archive* — for the HOST that DOES flow into the exported IPA, which is exactly what satisfies App Store Connect's strictly-increasing build-number rule (`ITMS-90478`). `MARKETING_VERSION` (`CFBundleShortVersionString`) still managed the normal way — only `CFBundleVersion` is auto-stamped. The Watch payoff is the dev-iteration sync loop; the HOST payoff is unblocking repeat TestFlight uploads.

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

# ⚠️ Device-ID trap (2026-05-30 validated, cost 1 wasted build + ~5 min):
#   `-destination 'id=...'` MUST be the iPhone HOST UDID — NEVER the Watch
#   UDID, NEVER an ID carried over from earlier context/memory. The Watch
#   target builds as an EMBEDDED bundle inside the host app; you never
#   target the Watch directly. A wrong/stale ID does NOT fail at compile —
#   `xcodebuild` exits 70 with a destination-resolution error and compiles
#   ZERO lines (log shows only the device list, no SwiftCompile entries).
#   Symptom: "build" finishes in seconds, `grep -c "SwiftCompile.*Watch" = 0`,
#   no INSTALL/BUILD marker. ALWAYS re-derive the iPhone UDID FRESH from the
#   line above each session — for THIS repo iPhone = `00008120-...`,
#   Watch = `00008301-...` (do not confuse). When a build looks instant,
#   FIRST check exit code + that the log has real compile lines before
#   trusting it.

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

   ⚠️ **The Watch `devicectl` query is FLAKY** (2026-05-30 validated, D29 smoke). The Watch is paired-via-iPhone, not directly connected, so `devicectl device info apps --device <watch-id>` intermittently returns empty OR fails with `Timed out while attempting to establish tunnel ... RemotePairingError 1001` / `CoreDeviceError 4000`. Don't trust/chase it. Instead verify **what you actually pushed** by reading the STAGED embedded Watch plist (authoritative, no device round-trip):
   ```bash
   APP="<DerivedData>/.../InstallationBuildProductsLocation/Applications/TrainingLog.app"
   /usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' \
     "$APP/Watch/TrainingLog Watch Watch App.app/Info.plist"   # expect a fresh timestamp (auto-bump), >> the old on-device value
   # symbol sanity (combined binary on install builds — NOT a .debug.dylib here):
   strings "$APP/Watch/TrainingLog Watch Watch App.app/TrainingLog Watch Watch App" | grep -ci '<YourNewType>'
   ```
   Staged plist has a bumped timestamp + the host got `devicectl install` → the Watch WILL auto-sync (CFBundleVersion auto-bump, no Trap 3 dance). If you still need to confirm on-wrist, let the smoke result be the proof (does the new behaviour show?), not the flaky query.

## Not every Watch-facing fix needs this skill (JS-only shortcut)

A bug VISIBLE on the Watch is not necessarily a Watch-BINARY bug. The Watch reads its session data from the iPhone over WC, so a fix in **iPhone-side JS/TS** (handshake builders, `replaceLiveMirror`, services, `onStartFromWatch`, i18n) reflects on the Watch with just **Metro Reload JS + a fresh handshake/session** — NO rebuild, NO `devicectl`, NO Watch-sync dance. Validated 2026-05-30: the D29 "duplicate exercise" + "空白訓練" bugs both looked like Watch bugs but were fixed entirely in `src/` TS → Reload JS re-smoke each cycle (~30s vs ~10min rebuild). Only `ios/**/*.swift` changes need the full pipeline below. Before reaching for a clean install, ask: *did I touch any Swift?* If not, just Reload JS.

## RN-side caveat (related but not the same trap)

If the user opens the app and sees React Native red error page `No script URL provided`, that's Metro packager missing, NOT this skill's territory. Fix: `npx expo start --dev-client` from repo root (LAN-reachable from iPhone) → iPhone tap **Reload JS**. This is per-launch and unrelated to Watch binary state.

## Cost of skipping this skill

2026-05-29 morning: ~45 min lost iterating "rebuild → user reports old Watch UI → re-investigate". Three full xcodebuild rounds (07:12, 07:36, 07:50) all printed `** INSTALL SUCCEEDED **` while iPhone had no app installed. Only at 08:00 did `devicectl install` solve Trap 1, and only after clean build at 07:50 was Watch target actually compiled (Trap 2). User then hit Trap 3 (cached old Watch UI) until iPhone host app was fully deleted at 08:30.

Don't repeat. Start with `clean install` + `devicectl install` from the start when shipping new Watch Swift code to wrist.
