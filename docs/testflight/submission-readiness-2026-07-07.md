# Submission-Readiness Checklist + Punch-List (2026-07-07)

> **Supersedes** [`submission-readiness-2026-06-13.md`](./submission-readiness-2026-06-13.md)
> (kept as history). That doc listed **4 packaging 🔴** as living on the unmerged
> `chore/appstore-watch-readiness` branch. **All four have since merged to main**
> (commit `72dcee0` "App Store readiness — Watch AppIcon + version/category
> blockers", plus `7abb7d3` folding the ASC metadata draft). This refresh
> re-audits **the actual files on `main` @ `2574061`** (= `origin/main` tip) and
> finds the packaging surface is now essentially clean — every remaining gate is
> **operational / human-in-the-loop**, not a code or config defect.
>
> **Read-only audit.** No build, archive, `pod install`, or git mutation behind
> any status. Every ✅/⚠️/🔴 carries a `file:line` from the current tree.
>
> **Cross-links:** [`submission-questionnaire.md`](./submission-questionnaire.md) ·
> [`app-store-metadata-draft.md`](./app-store-metadata-draft.md) ·
> [`build-bump.md`](./build-bump.md) · [`icon-spec.md`](./icon-spec.md). Two
> parallel overnight agents are refreshing the **privacy policy** and **ASC
> metadata** in sibling worktrees (`overnight/privacy-compliance-2026-07-07`,
> `overnight/asc-metadata-2026-07-07`) — coordinate before submit.

---

## TL;DR

**Distance to a TestFlight upload: ~4 gates remain, all requiring a human — and 0 are code/config defects.** The binary is packaging-clean: versions align, bundle ids are consistent, encryption compliance is declared, both AppIcon sets are complete + alpha-free, entitlements + usage strings + privacy manifest are all present and correct on `main`. What is left is entirely operational: **(1)** perform the first-ever Release **archive** (proves the never-verified iCloud signing path — the single highest-risk unknown), **(2)** publish the **Privacy Policy** to a public URL (mandatory for HealthKit apps), **(3)** fill ASC store-listing + **capture ≥3 screenshots/locale**, **(4)** run the **device smokes** for the iCloud backup/restore native chain (never compiled/run on device). One optional 1-line copy polish (Watch HK Update string) and the still-unmerged `feat/exercise-kneeling-cable-pulldown` (content, not a gate) round it out.

---

## Requirement scorecard

Legend: ✅ ready · ⚠️ needs action (non-blocking / polish / verify-on-archive) · 🔴 blocker (must clear before upload). "Human?" = needs a person (Xcode/ASC/device), not an agent.

| # | Requirement | Status | Human? | Evidence (`file:line`) | Remediation |
|---|---|---|---|---|---|
| 1 | Marketing version — host | ✅ 1.0.0 | — | `ios/TrainingLog/Info.plist:23-24`; `project.pbxproj:515,548`; `app.json:5` all agree | none |
| 2 | Marketing version — Watch | ✅ 1.0.0 | — | `project.pbxproj:598,654` `MARKETING_VERSION = 1.0.0` (was `1.0` in 06-13 doc — **now fixed/merged**) | none |
| 3 | CFBundleVersion bump — host | ✅ | — | phase "Bump Host CFBundleVersion" `project.pbxproj:444-462`, in TrainingLog target buildPhases **last** (`:211`, after Embed Watch Content `:210`); script `scripts/bump-cfbundle-version.sh` exists +x | none |
| 4 | CFBundleVersion bump — Watch | ✅ | — | phase "Bump Watch CFBundleVersion" `project.pbxproj:424-442`, in Watch target buildPhases **last** (`:230`); script `scripts/bump-watch-build-number.sh` exists +x | none |
| 5 | Bump phase order | ✅ | — | each bump is the final phase of its own target; host bump runs after Embed Watch → cannot clobber the already-embedded Watch plist. Both write BUILT plist only (`CURRENT_PROJECT_VERSION=1` stays, no git churn) | none |
| 6 | Bundle id — host | ✅ | — | `project.pbxproj:522,555` `com.lisonchang.TrainingLog`; matches `app.json:13` | none |
| 7 | Bundle id — Watch | ✅ | — | `project.pbxproj:602,657` `com.lisonchang.TrainingLog.watchkitapp`; `WKCompanionAppBundleIdentifier = com.lisonchang.TrainingLog` (`:591,647`) — conventional + consistent | none |
| 8 | watchOS bundling | ✅ | — | `SKIP_INSTALL = YES` (`:605,660`), Watch embedded via "Embed Watch Content" (`:210`), companion id set | none |
| 9 | Encryption compliance | ✅ | — | `ios/TrainingLog/Info.plist:39-40` `ITSAppUsesNonExemptEncryption = false` → ASC will not prompt | none |
| 10 | App category | ✅ | — | `ios/TrainingLog/Info.plist:7-8` `LSApplicationCategoryType = public.app-category.healthcare-fitness` (was branch-only in 06-13 — **now on main**) | none |
| 11 | AppIcon — host completeness | ✅ | — | `Images.xcassets/AppIcon.appiconset/Contents.json` = 17 entries (iPhone 20/29/40/60 + iPad 20/29/40/76/83.5 + 1024 marketing); 14 PNGs present | none |
| 12 | AppIcon — Watch present | ✅ | — | `TrainingLog Watch Watch App/Assets.xcassets/AppIcon.appiconset/` has `App-Icon-1024x1024@1x.png` (18727 B) + valid watchOS single-size universal `Contents.json` (was **EMPTY placeholder** = 06-13 Blocker 1; **now populated/merged**) | none |
| 13 | AppIcon — no alpha | ✅ | — | `sips -g hasAlpha` = **no** on all 15 icon PNGs (host 14 + Watch 1), incl. both 1024 marketing icons → passes ITMS alpha rejection | none |
| 14 | LaunchScreen / splash | ✅ | — | `ios/TrainingLog/SplashScreen.storyboard` present; `Info.plist:72-73` `UILaunchStoryboardName = SplashScreen`; imageset+colorset in assets | none |
| 15 | Deployment targets | ✅ | — | `IPHONEOS_DEPLOYMENT_TARGET = 16.0` (`:510,543`), `WATCHOS_DEPLOYMENT_TARGET = 11.0` (`:615,669`) — both current + reasonable | none |
| 16 | HealthKit entitlement (host + Watch) | ✅ | — | `TrainingLog.entitlements:5-6` + `TrainingLog Watch Watch App.entitlements:5-6` both `com.apple.developer.healthkit = true` | none |
| 17 | iCloud entitlement keys (host) | ✅ (file) / ⚠️ (signing) | Y | `TrainingLog.entitlements:7-18` has all 3 keys (`icloud-container-identifiers`, `icloud-services=CloudDocuments`, `ubiquity-container-identifiers`), container id `iCloud.com.lisonchang.TrainingLog` consistent w/ `Info.plist:54-64` `NSUbiquitousContainers` | keys are correct; **signing path unproven** — see Gate 1 |
| 18 | App Group entitlement | ✅ n/a | — | not present in either `.entitlements` — correct: Watch↔iPhone uses WatchConnectivity, no App Group needed (CLAUDE.md confirms "no App Group is defined or used") | none |
| 19 | Entitlements wired in pbxproj | ✅ | — | `CODE_SIGN_ENTITLEMENTS` → host `:500,538`, Watch `:577,632`; `DEVELOPMENT_TEAM = XQTU89U2J2` on all configs; `CODE_SIGN_STYLE = Automatic` (Watch `:578,633`; host inherits default) | none |
| 20 | HK usage strings — host | ✅ | — | `Info.plist:50-53` `NSHealthShareUsageDescription` + `NSHealthUpdateUsageDescription`, specific + grammatical (also in `app.json:49-50`) | none |
| 21 | HK usage strings — Watch | ⚠️ | Y | `project.pbxproj:589,645` `INFOPLIST_KEY_NSHealthUpdateUsageDescription = "…本鍵預留以符合 watchOS HKHealthStore API 要求。"` — placeholder-ish copy | optional polish (see Gate 5); grammatical → won't fail review |
| 22 | Other required usage strings (Motion/Location/etc.) | ✅ n/a | — | app reads only HR + ActiveEnergy via HK; no CoreMotion/CoreLocation/Camera/Mic/Contacts APIs → no extra `NS*UsageDescription` required | none |
| 23 | Privacy manifest (`PrivacyInfo.xcprivacy`) | ✅ | — | `ios/TrainingLog/PrivacyInfo.xcprivacy` present + honest: `NSPrivacyTracking=false`, `NSPrivacyCollectedDataTypes=[]`, 4 required-reason API categories declared (UserDefaults CA92.1, FileTimestamp, DiskSpace, SystemBootTime) | none |
| 24 | Third-party SDK PrivacyInfo (SDWebImage) | ⚠️ verify-on-pod | Y | `ios/Pods/` not present in this worktree (no `pod install` yet) → cannot statically confirm SDWebImage ships its bundled `.xcprivacy`. SDWebImage ≥5.17 ships one upstream; Copy-Pods-Resources phase already lists `SDWebImage.bundle` (`project.pbxproj:382`) | after `pod install`, confirm `ios/Pods/SDWebImage/**/PrivacyInfo.xcprivacy` exists (it does upstream) — no action expected, just verify |
| 25 | ATS locked down | ✅ | — | `Info.plist:43-49` `NSAllowsArbitraryLoads=false`, only `NSAllowsLocalNetworking=true` (Metro LAN, benign in Release — no network calls) | optional: drop `NSAllowsLocalNetworking` for cleanliness (non-blocking) |
| 26 | No network egress / no dev backdoor in Release | ✅ | — | `grep fetch/XHR/WebSocket/axios/sendBeacon` over `src/` + `app/` = **0 hits**; `FB_SONARKIT_ENABLED` (Flipper) only in **Debug** config (`:507`), Release uses `-D EXPO_CONFIGURATION_RELEASE` (`:555`); no `__DEV__` dev-section in `app/settings.tsx` | none |
| 27 | Privacy Policy + reachable URL | 🔴 | Y | HealthKit apps **must** provide one. Draft owned by `overnight/privacy-compliance-2026-07-07` agent — confirm before submit | publish to public URL + paste into ASC — see Gate 2 |
| 28 | First Release **archive** ever | 🔴 | Y | `~/Library/Developer/Xcode/Archives` does not exist → never archived; the iCloud signing path (#17) is static-only until an archive proves it | see Gate 1 (highest-risk unknown) |
| 29 | ASC store-listing metadata | ⚠️ | Y | drafted in `app-store-metadata-draft.md` w/ `[PLACEHOLDER]`s (URLs, keyword cut, app-name decision); being refreshed by `overnight/asc-metadata-2026-07-07` | fill placeholders — see Gate 3 |
| 30 | Screenshots (≥3/locale) | 🔴 | Y | not captured | capture on sim/device — see Gate 3 |
| 31 | App Privacy questionnaire (nutrition label) | ✅ | Y | `submission-questionnaire.md:43-64` → "Data Not Collected" for all categories (local-only SQLite; iCloud goes to *user's own* private container, not a dev server) — still correct today | click through at submit — see Gate 3 |
| 32 | iCloud backup/restore DEVICE verification | 🔴 | Y | native chain (Swift backup/restore + fresh-install copy-in) has **never compiled/run on device** — all prior audits were static API matching | run device smokes — see Gate 4 |
| 33 | Migration / schema data-safety | ✅ | — | carried from 2026-06-03 A-audit: v001→ chain monotonic, transaction-wrapped, zero data-destroying ops. `feat/exercise-kneeling-cable-pulldown` (unmerged) adds v030 with tests | none |

### Bottom line

The **packaging surface that dominated the 06-13 punch-list is now clean on
main** — the Watch icon, Watch version `1.0→1.0.0`, category, and questionnaire
all merged. Nothing in the tree blocks an upload. The four remaining 🔴 are
**all human-in-the-loop operational steps** (archive-signing proof, privacy-policy
publish, screenshots, device smokes) plus one ⚠️ copy polish and one ⚠️
verify-after-`pod install`. There is **no agent-fixable blocker left**.

---

## Execution order when a human is present

> Everything below is **user-only** unless marked. Do it in one Xcode + one
> device session. Team `XQTU89U2J2`. `USER-ONLY` = requires Apple ID / Xcode UI /
> physical device / ASC login — an agent cannot and must not do these.

### Pre-flight (5 min, CLI — can be an agent up to the archive)

```bash
cd /Users/hao800922/code/TrainingLog                 # main worktree, on main
npm install                                          # reconcile node_modules to lock (NOT npm ci)
cd ios && pod install && cd ..                       # regenerate Pods (proves SDWebImage xcprivacy — item 24)
```

### Gate 1 — first Release archive (**USER-ONLY**, ~30 min, highest risk)

This is the single most important step: it is the **only** thing that can make
the build fail to archive/install at all, because the iCloud entitlement keys
(#17) were text-edited in slice 15 and their signing path has never been
exercised.

```bash
# Option A (preferred) — Xcode UI, per build-bump.md:
#   open ios/TrainingLog.xcworkspace
#   • toggle the iCloud (CloudDocuments) capability once on the HOST target so
#     Xcode registers container iCloud.com.lisonchang.TrainingLog in the Portal
#     + regenerates the profile — confirm NO red signing error, team XQTU89U2J2
#   • Product ▸ Archive
#
# Option B — CLI, lets auto-signing register the container:
xcodebuild -workspace ios/TrainingLog.xcworkspace -scheme TrainingLog \
  -configuration Release -archivePath ~/Desktop/TrainingLog.xcarchive \
  -allowProvisioningUpdates archive
```

If the archive succeeds with no signing error, #17 and #28 both clear. Confirm
host **and** Watch `CFBundleVersion` got stamped (both bump phases fired).

### Gate 2 — Privacy Policy publish (**USER-ONLY**, ~1 hr, parallelizable)

HealthKit apps must expose a privacy-policy URL. Draft is being refreshed by the
`overnight/privacy-compliance-2026-07-07` agent — confirm it landed, publish to a
stable public URL (repo GitHub Pages is the contemplated path), paste into ASC's
Privacy Policy URL field + into the metadata draft placeholder.

### Gate 3 — ASC listing, screenshots, questionnaire (**USER-ONLY**, ~2-4 hr)

1. Export IPA from the Gate-1 archive and upload:
   ```bash
   xcodebuild -exportArchive -archivePath ~/Desktop/TrainingLog.xcarchive \
     -exportPath ~/Desktop/TrainingLog-export \
     -exportOptionsPlist ios/ExportOptions.plist -allowProvisioningUpdates
   # then upload the .ipa via Xcode Organizer, or:
   xcrun altool --upload-app -f ~/Desktop/TrainingLog-export/TrainingLog.ipa \
     -t ios --apiKey <KEY> --apiIssuer <ISSUER>          # ASC API key
   ```
   (An agent must NOT run the upload / altool step — Apple-ID-authenticated.)
2. Fill store-listing fields from `app-store-metadata-draft.md` (resolve the
   `[PLACEHOLDER]`s + app-name + availability decisions).
3. Capture **≥3 screenshots per locale** on seeded demo data (sim or device).
4. Click through the questionnaire: App Privacy = **Data Not Collected**
   (`submission-questionnaire.md §1`), export compliance = **No** (§3), age
   rating = **4+** (§5). Paste the HK data-usage statement (§2) + reviewer
   instructions (§4) into App Review notes.

### Gate 4 — iCloud backup/restore device smokes (**USER-ONLY / device**, ~half day)

The native backup/restore chain has never run on a device. Run the 7-item smoke
set from the 2026-06-13 doc §D7 (fresh-install restore, manual 立即備份, rotate
keep-2, restore-fallback, version-guard, escalation banner, Watch-envelope
isolation) + the Fitness-workout-row brand-logo check (**must be a stable
TestFlight build, not a dev rebuild** — dev builds churn Apple's source-icon
cache; see 06-13 doc §D7 item 9).

### Gate 5 — optional, non-blocking

- Tighten the Watch HK Update usage copy (`project.pbxproj:589,645`) from the
  "本鍵預留…" placeholder to a concrete purpose (item 21). App Review prefers it;
  won't fail without it. **Requires editing the native project file — user or a
  follow-up branch, not this doc.**
- Optionally drop `NSAllowsLocalNetworking` (`Info.plist:47-48`) for cleanliness.

---

## Note on `feat/exercise-kneeling-cable-pulldown` (unmerged) — merge BEFORE archive? → optional, low-risk YES

- **State:** 0 commits behind main, 2 ahead, cleanly based on `main` tip → `git merge --ff-only`-able as-is.
- **Scope:** touches only TS/DB/i18n/docs — `src/db/schema/v030_kneeling_cable_pulldown.ts`, `src/db/migrate.ts`, `src/i18n/strings.ts`, `docs/`, and test files. **Zero native project-file changes** (no `.pbxproj` / `Info.plist` / entitlements / AppIcon).
- **Verdict:** it is **not a submission gate** — it's a content addition (one built-in exercise + v030 migration). Because it's a clean FF and doesn't touch the packaging surface, merging it before the first archive is harmless and gets the extra exercise into v1. But it's equally fine to ship v1 without it and fold it into 1.0.1. **Recommendation:** merge it (ff-only) before Gate 1 if you want it in v1; otherwise defer. Do not let it delay the archive. *(Recommendation only — this agent did not merge anything.)*
