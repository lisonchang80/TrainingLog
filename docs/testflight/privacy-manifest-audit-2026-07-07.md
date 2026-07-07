# Privacy Manifest & Entitlements Audit — 2026-07-07

> **STATUS: AUDIT (read-only).** Overnight agent C. Cross-checks the app's
> `PrivacyInfo.xcprivacy` (Required-Reason APIs), `Info.plist` usage
> descriptions, and entitlements against the actual shipped code. Grounded
> at branch `overnight/privacy-compliance-2026-07-07` (off main `2574061`).
>
> **This document proposes fixes; it does NOT touch any native project file.**
> Every suggested change below is an XML snippet / step for the author to
> apply by hand (or approve). The audited files (`*.xcprivacy`, `Info.plist`,
> `*.entitlements`, `*.pbxproj`) were opened read-only.

---

## TL;DR — verdict

| Area | Status | Action |
|---|---|---|
| App-body Required-Reason API manifest (`PrivacyInfo.xcprivacy`) | ✅ **Covers all APIs the code uses** | None required |
| App-body HealthKit usage strings (iPhone `Info.plist`) | ✅ Present, both keys | Optional wording polish (§2.1) |
| **Watch HealthKit usage strings** | 🔴 **MISSING — real gap** | Add both keys to Watch Info.plist (§2.2) |
| HealthKit entitlement (both targets) | ✅ Declared | None |
| iCloud container entitlement (app) | ✅ Declared + bundle-aligned | None |
| App Group entitlement | ✅ **Correctly absent** (not used) | None |
| Network egress / analytics / tracking | ✅ **Zero** (grep-verified) | None |
| Third-party privacy manifests | ⚠️ Build-time only (Pods not installed in this tree) | Verify at archive time (§4) |

**One blocking-class finding**: the Apple-Watch target requests HealthKit
authorization *on the Watch itself* (`HealthKitController.ensureAuthorized()`
→ `store.requestAuthorization`) but its `Info.plist` has **no HealthKit usage
strings**. On watchOS a target that surfaces the HK permission dialog needs
its own `NSHealthShareUsageDescription` / `NSHealthUpdateUsageDescription`.
Fix in §2.2.

---

## 1. Required-Reason API manifest (`NSPrivacyAccessedAPITypes`)

App-body manifest: `ios/TrainingLog/PrivacyInfo.xcprivacy`.

### 1.1 What the manifest currently declares

| API category | Reason codes declared |
|---|---|
| `NSPrivacyAccessedAPICategoryUserDefaults` | `CA92.1` |
| `NSPrivacyAccessedAPICategoryFileTimestamp` | `0A2A.1`, `3B52.1`, `C617.1` |
| `NSPrivacyAccessedAPICategoryDiskSpace` | `E174.1`, `85F4.1` |
| `NSPrivacyAccessedAPICategorySystemBootTime` | `35F9.1` |

Plus `NSPrivacyCollectedDataTypes = []` and `NSPrivacyTracking = false`.

### 1.2 Does the code actually use these? (grep evidence)

- **UserDefaults (`CA92.1` — "access info from same app, no tracking")** ✅
  used. `@react-native-async-storage/async-storage` (2.2.0) is backed by
  `NSUserDefaults` on iOS. 10 source files touch `AsyncStorage`, all
  first-party settings persistence:
  - `src/theme/theme-persist.ts` (theme preference)
  - `src/i18n/locale-persist.ts` (locale preference)
  - `components/restore-gate.tsx` / `.behavior.ts` (restore-declined sentinel)
  - `app/(tabs)/settings.tsx`, `app/_layout.tsx` (hydrate on boot)
  All are same-app local reads/writes → `CA92.1` is the correct reason. ✅

- **File timestamp (`C617.1`/`0A2A.1`/`3B52.1`)** ✅ used. `expo-file-system`
  (19.0.23) drives the iCloud backup adapter (`icloudBackupAdapter.ts`),
  restore (`restoreService.ts`, `restoreDepsWiring.ts`), and JSON export
  (`jsonExport.ts`). `expo-sqlite` (16.0.10) also stats DB files. These
  frameworks call `stat`/`NSFileManager` timestamp APIs internally.
  - `C617.1` — display file timestamp to the user / within the app.
  - `3B52.1` / `0A2A.1` — third-party SDK (Expo) & container-declared reasons.
  Covered. ✅ (Expo's own file-system pod also ships these — see §4.)

- **Disk space (`E174.1`/`85F4.1`)** ✅ plausibly used. `expo-file-system` /
  `expo-sqlite` query free space before writes; Expo declares these two
  reasons in its own manifests. Keeping them app-side is safe and matches
  Expo. ✅

- **System boot time (`35F9.1`)** ✅ plausibly used. React Native /
  `react-native-reanimated` / worklets read `systemUptime` for monotonic
  timers. `35F9.1` = "measure elapsed time with the token" (non-tracking).
  Safe to keep; matches the RN toolchain's own manifests. ✅

### 1.3 Anything the code uses that is NOT declared? — none found

- **Active keyboard API** (`NSPrivacyAccessedAPICategoryActiveKeyboards`) —
  not needed. No `UITextInputMode.activeInputModes` usage; the app uses
  standard `TextInput`, which does not trip this category for the app.
- **No other Required-Reason category** (there are only the five: UserDefaults,
  FileTimestamp, DiskSpace, SystemBootTime, ActiveKeyboard) is used beyond the
  four already declared.

**Conclusion: the app-body Required-Reason manifest is complete and correct.
No change required.** (The reason codes are a superset that also happens to
match what the Expo/RN pods declare, which is the safe posture.)

---

## 2. Usage descriptions (`Info.plist`)

### 2.1 iPhone app — `ios/TrainingLog/Info.plist` ✅ present

Both HealthKit keys are present and specific:

```xml
<key>NSHealthShareUsageDescription</key>
<string>TrainingLog 需要讀取 Apple Watch 訓練心率與消耗熱量、用於詳情頁統計。</string>
<key>NSHealthUpdateUsageDescription</key>
<string>TrainingLog 會在無 Apple Watch 紀錄時、把訓練 session 寫入健康資料，讓 Fitness App 顯示完整訓練紀錄。</string>
```

These name the concrete data (心率/消耗熱量) and the purpose (詳情頁統計 /
Fitness App 顯示), which is what App Review looks for. **No change strictly
required.**

Optional polish (not blocking): the app is bilingual (zh/en). Apple shows the
usage string in the device's language; a Chinese-only string is fine for
review but an English speaker sees Chinese. If a fully-localized string is
wanted, add `InfoPlist.strings` per-locale — **out of scope for this audit,
noted only.**

Other keys reviewed, all correct/benign:
- `ITSAppUsesNonExemptEncryption = false` ✅ (no custom crypto beyond
  Apple's; `expo-crypto` is only `randomUUID` for local row IDs — HTTPS/Apple
  crypto is exempt, so `false` is correct).
- `NSAppTransportSecurity`: `NSAllowsArbitraryLoads=false`,
  `NSAllowsLocalNetworking=true` ✅ (local networking is the RN dev bundler /
  WatchConnectivity LAN; no arbitrary cleartext loads). Fine for release.
- `NSUbiquitousContainers` declares `iCloud.com.lisonchang.TrainingLog` ✅
  (matches entitlement, §3).
- `LSApplicationCategoryType = public.app-category.healthcare-fitness` ✅.
- No `NSLocation*`, `NSCameraUsageDescription`, `NSContactsUsageDescription`,
  `NSMicrophoneUsageDescription`, `NSPhotoLibrary*` — correct, the app uses
  none of those frameworks. **A stray usage-description for an unused
  framework would itself be a review flag; none present. ✅**

### 2.2 🔴 Apple-Watch app — usage strings MISSING (real gap)

`ios/TrainingLog-Watch-Watch-App-Info.plist` currently contains only:

```xml
<key>WKBackgroundModes</key>
<array><string>workout-processing</string></array>
<key>UIBackgroundModes</key>
<array/>
```

**Problem.** The Watch target calls HealthKit **directly on the Watch**:
- `HealthKitController.swift` → `store.requestAuthorization(toShare:read:)`
  with read = `.heartRate`, `.activeEnergyBurned`, `.basalEnergyBurned`,
  `.workoutType`; share = `.workoutType`.
- The in-code comment (lines 80-82) documents that **the first call surfaces
  the system permission dialog ON THE WATCH** (spike A, 2026-05-27, real
  device). `SessionController.swift` then runs `HKWorkoutSession` +
  `HKLiveWorkoutBuilder`.

When a watchOS app triggers the HK authorization dialog itself, that target's
`Info.plist` must carry the HealthKit usage strings, exactly like the phone.
They are currently absent. Risk: HK authorization can throw / the dialog can
fail to present, and App Review can reject for a HealthKit target lacking
purpose strings.

> Note: `WKBackgroundModes = workout-processing` is correctly present (needed
> for the live `HKWorkoutSession` to keep running in the background). That part
> is fine — only the usage strings are missing.

**Proposed fix — add to the Watch Info.plist (author applies, do NOT auto-edit):**

```xml
<key>NSHealthShareUsageDescription</key>
<string>TrainingLog 需要在 Apple Watch 上讀取你的即時心率與消耗熱量，於訓練時顯示並記錄。</string>
<key>NSHealthUpdateUsageDescription</key>
<string>TrainingLog 需要記錄你的 Apple Watch 訓練 session 到健康資料。</string>
```

Apply by editing the Watch target's Info in Xcode (Target → Info) or the
plist file, then re-archive. (Because Expo `prebuild` regenerates `ios/`, the
durable fix is to also add these to `app.config` / the `expo-health*` config
plugin or an `ios.infoPlist` override so a future prebuild doesn't drop them —
noted for the author, out of this audit's write scope.)

> **⚠️ 需作者確認**: verify on a real Watch whether paired-share (iPhone grant
> propagating to Watch) currently suppresses the Watch dialog. The code
> (HealthKitController header, "Spike B pending") says it does **not** rely on
> that and prompts on-Watch — which is exactly why the Watch usage strings are
> needed. If paired-share is later confirmed and the Watch never prompts, the
> strings become belt-and-suspenders but should still be present for a HK
> target.

---

## 3. Entitlements

### 3.1 App target — `ios/TrainingLog/TrainingLog.entitlements` ✅

```xml
<key>com.apple.developer.healthkit</key><true/>
<key>com.apple.developer.icloud-container-identifiers</key>
<array><string>iCloud.com.lisonchang.TrainingLog</string></array>
<key>com.apple.developer.icloud-services</key>
<array><string>CloudDocuments</string></array>
<key>com.apple.developer.ubiquity-container-identifiers</key>
<array><string>iCloud.com.lisonchang.TrainingLog</string></array>
```

- **HealthKit** ✅ declared; matches usage in `src/adapters/healthkit/*`.
- **iCloud CloudDocuments** ✅ declared; container id
  `iCloud.com.lisonchang.TrainingLog` **aligns** with the `Info.plist`
  `NSUbiquitousContainers` key and with `icloudBackupAdapter.ts` /
  `modules/icloud-backup`. Bundle id is `com.lisonchang.TrainingLog`. ✅
- **No `com.apple.developer.healthkit.access`** (clinical-records) — correct,
  the app reads only standard quantity types, not clinical records. Not needed.
- **No HealthKit background-delivery entitlement** — correct; the phone does
  not observe HK in the background (it reads on finalize; the Watch uses
  `HKWorkoutSession`, gated by `WKBackgroundModes` not an entitlement).
- **No App Group** — correct. `grep` for `application-groups` / `group.com.…`
  across `ios/` returns **zero**, matching `CLAUDE.md` ("no App Group is
  defined or used"). Watch↔iPhone talk over WatchConnectivity, not a shared
  container, so an App Group entitlement is intentionally absent. ✅

### 3.2 Watch target — `ios/TrainingLog Watch Watch App/…entitlements` ✅

```xml
<key>com.apple.developer.healthkit</key><true/>
```

- HealthKit entitlement ✅ present (required — the Watch runs
  `HKWorkoutSession`/`HKLiveWorkoutBuilder`).
- No iCloud on the Watch — correct, backup/restore is phone-only.
- Bundle id `com.lisonchang.TrainingLog.watchkitapp`, signed with this
  entitlement file (pbxproj `CODE_SIGN_ENTITLEMENTS` for both Debug/Release of
  the Watch target). ✅
- **Gap is the missing usage strings (§2.2), NOT the entitlement.** The
  entitlement grants capability; the Info.plist strings satisfy the consent
  UI. You need both; only the second is missing.

### 3.3 pbxproj wiring (read-only cross-check) ✅
- App target Debug+Release → `TrainingLog/TrainingLog.entitlements`.
- Watch target Debug+Release → `TrainingLog Watch Watch App/…entitlements`.
- `PRODUCT_BUNDLE_IDENTIFIER`: app `com.lisonchang.TrainingLog`, Watch
  `com.lisonchang.TrainingLog.watchkitapp` (correct parent/child). ✅

---

## 4. Third-party privacy manifests (build-time)

- `find node_modules -name PrivacyInfo.xcprivacy` → **0** (JS packages don't
  ship the iOS manifest; it lives in the CocoaPods pod).
- `find ios/Pods -name '*.xcprivacy'` → **0** — because **Pods are not
  installed in this worktree** (`ios/Pods/` absent; only `Podfile` /
  `Podfile.lock` present).

**Action for the author (at archive time, not now):** after `pod install`,
confirm the key SDKs each ship their `PrivacyInfo.xcprivacy` inside the app
bundle — notably:
- React Native core, `react-native-reanimated` / worklets (SystemBootTime),
- Expo modules: `expo-file-system`, `expo-sqlite`, `expo-crypto`,
  `expo-constants`, `AsyncStorage` (FileTimestamp / DiskSpace / UserDefaults),
- `@kingstinct/react-native-healthkit`,
- `react-native-svg`, `react-native-screens`, `react-native-gesture-handler`.

Xcode 15+ aggregates all bundled `.xcprivacy` into the App Privacy Report at
archive; Apple validates them at upload. Since the app-body manifest already
declares the same reason codes these pods use, no *additional* app-side
declaration is anticipated. **Just verify the pods are present in the archive;
do not hand-add pod manifests.**

> Note: `SDWebImage` is mentioned in the task brief but is **not** a direct
> dependency here (no `sd-web-image` / SDWebImage in `package.json`). `expo-image`
> (3.0.11) is the image stack; it ships its own manifest via its pod. No action.

---

## 5. Network egress / analytics / tracking — zero (grep-verified)

- **Network egress**: `grep -nE '\bfetch\(|axios|XMLHttpRequest|WebSocket|sendBeacon|EventSource'`
  over `src/ app/ components/ modules/` → **0 matches**. The app makes no
  outbound network calls.
- **Analytics / crash / tracking SDKs**: no `sentry|firebase|amplitude|mixpanel|`
  `segment|posthog|google-analytics|bugsnag|crashlytics|datadog|appcenter|`
  `flurry|adjust|appsflyer|facebook|admob` in dependencies or code (the only
  grep hits were the UI word "segmented" and "adjust", not SDKs). Dependency
  scan returned `suspicious deps: NONE`.
- **`expo-web-browser`** (15.0.10) is in `package.json` but has **zero call
  sites** in `src/app/components` (no `openBrowserAsync`/`WebBrowser`). It is
  an unused transitive/leftover dep — harmless for privacy (no egress), but a
  candidate to remove in a cleanup pass. **⚠️ 需作者確認 / defer.**
- **`expo-crypto`** is used only for `randomUUID` to mint local row/envelope
  IDs — not an advertising or device identifier, never transmitted.

Consistent with `NSPrivacyTracking = false` and empty
`NSPrivacyCollectedDataTypes` in the manifest, and with the "Data Not
Collected" App Privacy answer (see companion doc
`app-privacy-answers-2026-07-07.md`).

---

## 6. Action checklist for the author

| # | Priority | Action | File (author edits by hand) |
|---|---|---|---|
| 1 | 🔴 **Do before submit** | Add `NSHealthShareUsageDescription` + `NSHealthUpdateUsageDescription` to the Watch target (§2.2). Also mirror into `app.config`/config-plugin so `prebuild` keeps them. | `ios/TrainingLog-Watch-Watch-App-Info.plist` (+ Expo config) |
| 2 | 🟡 At archive | After `pod install`, confirm bundled pods carry their `.xcprivacy` (§4). | (verify only) |
| 3 | 🟢 Optional | Localize HK usage strings to en for English users (§2.1). | InfoPlist.strings |
| 4 | 🟢 Optional | Remove unused `expo-web-browser` dep (§5). | package.json |
| 5 | ✅ No-op | App-body Required-Reason manifest is complete (§1). | — |

Nothing else in the manifest / entitlements / usage descriptions requires
change. The one genuine gap is the Watch HealthKit usage strings (#1).
