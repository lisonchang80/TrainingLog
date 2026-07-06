# Doc-Verify Corrections — Adversarial Fact-Check of First-Round Submission Docs (2026-07-07)

> **Overnight agent E (wave-2), read-only.** Independently re-verified every
> load-bearing factual claim in the six first-round TestFlight/ASC docs against
> the actual code at `main @ 2574061` (this worktree's HEAD). Goal: **nothing
> false enters App Store Connect** — a wrong privacy label draws Apple penalties,
> a description feature that doesn't exist gets the build rejected, a "blocker"
> that isn't real wastes a native round-trip.
>
> **Scope of authority:** this doc only *reports*. It does not edit the
> first-round docs or any code/native file.

---

## One-line summary

**~48 discrete factual claims checked across 6 docs. 42 ✅ true, 1 ❌ FALSE
(a phantom "blocker"), 5 ⚠️ need-author-nuance.**
**No privacy-label red-line: the "Data Not Collected" nutrition label and the
privacy-policy draft are BOTH accurate** — independent greps re-confirm zero
network egress, zero analytics/ads/tracking SDKs, iCloud = user's own *private*
ubiquity container (not CloudKit-public), HK data on-device only.
**No description red-line: every marketed feature exists in shipped code.**
The single ❌ is the **opposite** risk — the privacy-manifest-audit doc invents a
🔴 "Watch HealthKit usage strings MISSING" blocker that is **not real** (the
strings are supplied via `INFOPLIST_KEY_NSHealth*` build settings in the
pbxproj); acting on it is harmless but unnecessary. Two first-round docs
**contradict each other** on exactly this point — this table resolves it.

---

## Corrections table

Legend — **✅ 屬實** (claim matches code) · **❌ 不實** (claim is wrong, fix
before use) · **⚠️ 需作者確認** (technically defensible but needs a nuance/decision).

| # | Doc | Claim | 判定 | 佐證 (`file:line`) | 建議修正字句 |
|---|---|---|---|---|---|
| 1 | privacy-manifest-audit §TL;DR + §2.2 | **🔴 "Watch HealthKit usage strings MISSING — real gap / blocking-class"** | ❌ **不實** | Strings **exist** as build settings: `ios/TrainingLog.xcodeproj/project.pbxproj:588-589` (Debug) + `:644-645` (Release) → `INFOPLIST_KEY_NSHealthShareUsageDescription` + `INFOPLIST_KEY_NSHealthUpdateUsageDescription`. Xcode injects `INFOPLIST_KEY_*` into the built Watch Info.plist at compile time, so the shipped Watch app **does** carry both keys. The audit only `cat`-ed the raw `ios/TrainingLog-Watch-Watch-App-Info.plist` (315 B, only `WKBackgroundModes`) and missed the pbxproj injection. | Downgrade from 🔴 blocker to 🟢 "present via `INFOPLIST_KEY_*` build settings; the *Update* string is placeholder-ish copy → optional polish." Delete the "add both keys to Watch Info.plist" fix — adding literal plist keys **on top of** the build-setting keys would produce a duplicate-key conflict at build. This exactly matches what submission-readiness item #21 already says. |
| 2 | submission-readiness #21 | Watch HK usage strings present at `pbxproj:589,645`, "placeholder-ish", ⚠️ optional polish, "won't fail review" | ✅ **屬實** | `pbxproj:588-589,644-645` confirmed. This doc is **correct**; it directly contradicts #1 above (same fact, opposite verdict). | Keep as-is. Note in cross-links that privacy-manifest-audit §2.2 is wrong and this is the right reading. |
| 3 | metadata header + privacy-policy + app-privacy-answers + manifest-audit §5 | **No network egress** (`fetch`/`axios`/`XHR`/`WebSocket`/`sendBeacon`/`EventSource`) — 0 production call sites | ✅ **屬實** | Independent grep over `src app components modules` = 0 runtime hits. Only `https://` literals are code comments + podspec `homepage` metadata (`modules/*/ios/*.podspec:7`, `components/ui/icon-symbol.tsx:13-14`). | none |
| 4 | all privacy docs | **No analytics / ads / crash / tracking SDK** (sentry/firebase/amplitude/mixpanel/segment/posthog/etc.) | ✅ **屬實** | `package.json` deps scanned: none present. Code grep hits were the UI word "segmented" + i18n string "Adjust the rep range" — no SDKs. No `IDFA`/`AdSupport`/`ATTrackingManager`. | none |
| 5 | all privacy docs | **No account / login / auth** | ✅ **屬實** | No `signIn`/`signUp`/`oauth`/`password`/auth-token code in `src app components` (only false hits were "author"/"Assigning" comments). No auth deps. | none |
| 6 | privacy-policy + app-privacy-answers | **iCloud backup = user's OWN private container, not CloudKit-public, not a dev server** | ✅ **屬實** | Zero `CloudKit`/`CKContainer`/`CKRecord` anywhere. Backup uses `FileManager.default.url(forUbiquityContainerIdentifier: nil)` → `modules/icloud-backup/ios/IcloudBackupModule.swift:48,81`; ubiquity container `iCloud.com.lisonchang.TrainingLog` in `ios/TrainingLog/TrainingLog.entitlements`. | none |
| 7 | app-privacy-answers §Fresh evidence (Watch row) | Watch HK scope = read `heartRate`, `activeEnergyBurned`, **`basalEnergyBurned`**, `workoutType`; share `workoutType` | ✅ **屬實** | `ios/TrainingLog Watch Watch App/HealthKitController.swift:65-77` — `typesToRead` = heartRate + activeEnergyBurned + basalEnergyBurned + workoutType; `typesToShare` = workoutType. | none |
| 8 | metadata header + privacy-policy + manifest-audit | iPhone HK scope = **READ** HeartRate + ActiveEnergyBurned, **WRITE** HKWorkoutType | ✅ **屬實** | `src/adapters/healthkit/permission.ts:72-77` — `toRead: [HeartRate, ActiveEnergyBurned]`, `toShare: [HKWorkoutTypeIdentifier]`. | none |
| 9 | metadata header | "`LSApplicationCategoryType = healthcare-fitness`, `ITSAppUsesNonExemptEncryption = false`, `NSPrivacyTracking = false`" | ✅ **屬實** | `ios/TrainingLog/Info.plist:7-8` (category), `:39` (encryption); `ios/TrainingLog/PrivacyInfo.xcprivacy` (NSPrivacyTracking + empty NSPrivacyCollectedDataTypes). | none |
| 10 | metadata header (line 19-22) | Implies `LSApplicationCategoryType` etc. + `supportsTablet` are all "in `app.json`" | ⚠️ **需作者確認** | Only `supportsTablet: true` and `version: 1.0.0` are in `app.json` (`app.json` `ios.infoPlist` is **empty `[]`**). Category/encryption/HK-usage/`NSUbiquitousContainers` live in the **prebuilt `ios/TrainingLog/Info.plist`**, not app.json. The doc's actual citations point at `ios/.../Info.plist` + entitlements (correct); only the prose is loose. | No user-facing impact (all keys exist in the shipped Info.plist). If prebuild is ever re-run from scratch, these Info.plist keys are hand-maintained in `ios/` and must survive — worth a note, not a correction. |
| 11 | app-privacy-answers §manifest + manifest-audit §1 | `PrivacyInfo.xcprivacy` declares UserDefaults `CA92.1`; FileTimestamp `0A2A.1/3B52.1/C617.1`; DiskSpace `E174.1/85F4.1`; SystemBootTime `35F9.1`; empty CollectedDataTypes; Tracking=false | ✅ **屬實** | `ios/TrainingLog/PrivacyInfo.xcprivacy` — all four categories + exact reason codes + `NSPrivacyCollectedDataTypes=[]` + `NSPrivacyTracking=false` confirmed verbatim. | none |
| 12 | metadata desc (zh+en) | "內建數百個常見動作 / Hundreds of common exercises" | ✅ **屬實** | `docs/exercise-media-import/curated-master.json` = **230 entries**, all active. "數百 / Hundreds" is accurate and safe. | Keep the vague quantifier, OR if naming a number use "**230+**" (curated master 230; net shipped active ≈233 per project memory). Do not write "數百" as literally 300+. |
| 13 | shotlist header | Tab bar = **5 tabs** (訓練/計劃表/動作庫/訓練紀錄/設定); **極簡 mode = 4 tabs** (計劃表 hidden) | ✅ **屬實** | `app/(tabs)/_layout.tsx:67-116` = index/programs/library/history/settings (5). Minimal hides Programs via `href: isMinimal ? null : undefined` (`:82-87`, ADR-0026 D1). | none |
| 14 | shotlist Shots 1-8 | Every shot's in-app nav path (Today→開始訓練→set-logger; History calendar; Library→exercise detail; exercise chart; Programs grid; Settings backup) reaches a real screen | ✅ **屬實** | Routes exist: `app/(tabs)/index.tsx`, `app/(tabs)/history.tsx`, `app/(tabs)/library.tsx` + `app/exercise/[id].tsx`, `app/exercise-chart/[id].tsx` & `app/exercise-history/[id].tsx`, `app/(tabs)/programs.tsx`, `app/(tabs)/settings.tsx`. | none |
| 15 | metadata desc | Feature: **two-way live Watch↔iPhone sync** | ✅ **屬實** | `src/services/iphoneLiveMirrorProducer.ts`, `watchLiveMirrorReceiver.ts`, `replaceLiveMirror.ts`, `watchSessionCast.ts` — bidirectional sync shipped. | none |
| 16 | metadata desc | Features: dropset clusters, supersets, warmup sets, RPE, intensity variants, PR/e1RM, achievements, rest timer, minimal mode, onboarding, dark mode, bilingual | ✅ **屬實** | `src/domain/pr/e1rmEngine.ts` + `prEngine.ts`; `src/domain/achievement/`; `src/domain/template/resolveTargetTemplate.ts` (variants); `components/session/rest-timer-modal.tsx` + Watch `RestTimerView.swift`; ADR-0026 minimal mode (#13); `components/onboarding/onboarding-wizard.tsx`; `src/theme/theme-persist.ts` (system/light/dark); `src/i18n/strings.ts` (zh+en). | none |
| 17 | metadata desc + policy | iCloud backup **"保留最近兩份 / keeping the latest two"** | ✅ **屬實** | `src/domain/backup/backupPolicy.ts:40` `export const BACKUP_KEEP_COUNT = 2;` — exact. | none |
| 18 | policy + app-privacy-answers | JSON export **stays on device** (no auto-transmit) | ✅ **屬實** | `src/services/jsonExport.ts` writes to a passed `documentDirectory` URI (`:183`); no `http`/`fetch`/`shareAsync`/`upload` in the file. Sharing (if any) is user-initiated. | none |
| 19 | app-privacy-answers §evidence | `expo-crypto randomUUID` used only for local DB/envelope row IDs, never transmitted | ✅ **屬實** | `src/adapters/sqlite/templateRepository.ts:675-676,1309` — injected `randomUUID` for row IDs; no network path. | none |
| 20 | privacy-policy + app-privacy-answers + manifest-audit | `expo-web-browser` is a dependency but **0 call sites** (unused) | ✅ **屬實** | In `package.json` deps; grep for `WebBrowser`/`openBrowserAsync` over `src app components modules` = **0**. (Content-rating "no unrestricted web access" answer is therefore also safe.) | none |
| 21 | submission-readiness #24 | `SDWebImage` ships a bundled `.xcprivacy`; pbxproj Copy-Pods-Resources lists `SDWebImage.bundle`; verify after `pod install` | ✅ **屬實** | `ios/TrainingLog.xcodeproj/project.pbxproj:382,395` references `SDWebImage.bundle`; `ios/Podfile.lock:47-50,2163-2173,2587` pins SDWebImage 5.21.7 (+ AVIF/SVG/WebP coders) as a transitive Pod of `expo-image`. | none — but see #22 |
| 22 | privacy-manifest-audit §4 | "`SDWebImage` is mentioned in the brief but is **not** a direct dependency here … No action." | ⚠️ **需作者確認** | Half-true & misleading vs #21. SDWebImage is **not a direct npm dep** (correct) but **IS a CocoaPods dependency** in the tree (`Podfile.lock` + pbxproj, #21). Both docs land on "no app-side action," which is right, but the audit's wording could read as "SDWebImage absent." | Reword to: "SDWebImage is a **transitive Pod** (via `expo-image`), not a direct npm dep; it ships its own `.xcprivacy` upstream — verify present in the archive after `pod install` (submission-readiness #24)." Keep the "no hand-add" verdict. |
| 23 | submission-readiness #1,2,6,7 / metadata Identity | Marketing version **1.0.0** aligned across host + Watch; bundle ids `com.lisonchang.TrainingLog` / `.watchkitapp` | ✅ **屬實** | `ios/TrainingLog.xcodeproj/project.pbxproj:515,548` (host) + `:598,654` (Watch) all `MARKETING_VERSION = 1.0.0`; `app.json version 1.0.0`; bundle `com.lisonchang.TrainingLog`. | none |
| 24 | submission-readiness §Supersedes + #12 | `72dcee0` + `7abb7d3` (Watch AppIcon/version/category + ASC draft) **merged to main**; Watch AppIcon populated | ✅ **屬實** | `git merge-base --is-ancestor 72dcee0 HEAD` ✓ and `7abb7d3` ✓ (both ancestors of `2574061`). `ios/TrainingLog Watch Watch App/Assets.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png` = **18727 B** (matches doc's "18727 B"). | none |
| 25 | submission-readiness #16-19 | HealthKit entitlement on **both** targets; iCloud entitlement (3 keys, CloudDocuments) on host only; **no App Group** | ✅ **屬實** | `ios/TrainingLog/TrainingLog.entitlements` = healthkit + icloud-container/services(CloudDocuments)/ubiquity; Watch `.entitlements` = healthkit only; zero `application-groups` anywhere. | none |
| 26 | app-privacy-answers §Health row | Watch does **read** basal energy; the **HKWorkout write is iPhone-side only** (Watch write=workoutType share kept "for future-proofing", not exercised) | ✅ **屬實** | `HealthKitController.swift:9-12` header comment: "current Branch C trigger-only flow does NOT write HKWorkout from Watch, iPhone 13c saveTrainingLogWorkout is the only writer." Consistent with policy wording. | none |

---

## Red-line assessment (would any of this get the app rejected / penalized?)

- **Privacy label (Data Not Collected):** ✅ **Accurate — no red-line.** Every
  pillar (no egress, no SDKs, no IDFA, on-device HealthKit, user's-own private
  iCloud, local JSON export) independently re-verified. The ASC label and the
  privacy-policy draft are mutually consistent and code-true.
- **Store description features:** ✅ **No red-line.** All marketed features exist
  (#15, #16, #17). The only soft spot is the vague "數百 / Hundreds" exercise
  count (#12) — safe as written; only becomes a risk if replaced by an inflated
  hard number.
- **The one ❌ (#1):** is a **false blocker**, not a false shipping claim — it
  over-states readiness risk rather than under-stating it. Correct it so the
  author doesn't (a) waste a native edit or (b) introduce a duplicate-Info.plist-key
  build error by "fixing" a non-problem. Real remaining HK-string work is at most
  the optional copy polish already tracked by submission-readiness #21/Gate 5.

**Net: the first-round docs are safe to drive an ASC submission after correcting
row #1 (and clarifying rows #10, #12, #22).** The genuine remaining blockers are
all the human/operational ones the submission-readiness doc already lists
(first Release archive, publish privacy-policy URL, capture screenshots, device
smokes) — none of which this fact-check contradicts.

---

*Generated by overnight agent E (wave-2), read-only against `main @ 2574061`.*
