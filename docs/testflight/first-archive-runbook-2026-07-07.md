# First Release Archive → uploadable IPA — TrainingLog runbook (2026-07-07)

> **What this is.** A step-by-step, per-command runbook to go from a **clean `main`**
> to a **validated, uploadable IPA** for TrainingLog's first-ever App Store /
> TestFlight build. Written by overnight agent H against `main @ 2574061`. It is a
> **script to follow**, not something an agent runs: several steps are **USER-ONLY**
> (Apple-ID login, ASC upload, physical archive/signing). Each step lists the
> **command**, the **expected output**, and **what to check when it fails**.
>
> **Sources baked in:** `.claude/skills/xcodebuild-watchos-realdevice-install`
> (archive verify + CFBundleVersion bump + traps), `.claude/skills/expo-bare-build-pipeline`
> (prebuild → pod → sign gotchas), and the current punch-list
> [`submission-readiness-2026-07-07.md`](./submission-readiness-2026-07-07.md).
> Related: [`build-bump.md`](./build-bump.md), [`branch-triage-2026-07-07.md`](./branch-triage-2026-07-07.md).

## Repo-specific facts (verified on `main @ 2574061`)

| Fact | Value |
|---|---|
| Workspace | `ios/TrainingLog.xcworkspace` (**always the workspace, never `.xcodeproj`** — pod-managed) |
| Scheme | `TrainingLog` (only host scheme; no standalone Watch scheme) |
| Signing team | `XQTU89U2J2` (`DEVELOPMENT_TEAM` on all configs) |
| Host bundle id | `com.lisonchang.TrainingLog` |
| Watch bundle id | `com.lisonchang.TrainingLog.watchkitapp` (`SKIP_INSTALL=YES`, embedded) |
| iCloud container | `iCloud.com.lisonchang.TrainingLog` (host entitlements — **signing path never exercised**) |
| CFBundleVersion | auto-bumped by two Run-Script phases (host + Watch) → each build gets a fresh epoch; source plists stay at `1` (zero git churn) |
| Marketing version | `1.0.0` (host + Watch aligned) |
| `ExportOptions.plist` | **DOES NOT EXIST** on main → Step 5 creates it |

> ⚠️ **The single highest-risk unknown** is the iCloud (CloudDocuments)
> entitlement signing path — the keys were text-edited in slice 15 and have
> **never been through an archive**. Step 2 is the moment that proves it.

---

## Step 0 — Pre-flight: account, certs, dependencies (agent-runnable up to Step 2)

```bash
cd /Users/hao800922/code/TrainingLog                 # MAIN worktree, on main (not a sub-worktree)
git switch main && git pull --ff-only                 # confirm you are on the tip you triaged
git rev-parse --short HEAD                             # expect 2574061 (or later)
```

**0a. Apple Developer / signing sanity (no login — just confirm identities exist):**
```bash
security find-identity -p codesigning -v | grep -i "Apple Development\|Apple Distribution"
# Expect at least one "Apple Development: … (…)" line for team XQTU89U2J2.
# Distribution identity is created lazily by Xcode on first archive w/ -allowProvisioningUpdates.
xcrun xcodebuild -version                              # Xcode present (26.x expected)
```
- **If no signing identity:** open Xcode ▸ Settings ▸ Accounts, sign in with the ADP Apple ID, "Download Manual Profiles". This is **USER-ONLY** (Apple-ID auth).

**0b. Node deps reconciled to lockfile:**
```bash
npm install                                            # NOT `npm ci` (repo uses shared node_modules symlink across worktrees)
```
- **If it rewrites `package-lock.json`:** that's fine here; don't commit it as part of the archive.

**0c. CocoaPods — Bare workflow requires `pod install` on every fresh checkout:**
```bash
cd ios && LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pod install && cd ..
```
- **`Encoding::CompatibilityError: Unicode Normalization not appropriate for ASCII-8BIT`** → you dropped `LANG`. Re-run with `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8` (expo-bare gotcha #2). The Claude shell has no UTF-8 locale by default.
- **`[Xcodeproj] Unable to find compatibility version string for object version '70'`** → Xcode-26 pbxproj vs CocoaPods 1.16 (gotcha #6). Patch the local gem constant (add `70 => 'Xcode 16.0',` in `…/xcodeproj-1.27.0/lib/xcodeproj/constants.rb`), re-run.
- **Success:** ends with `Pod installation complete!`. This also drops in `SDWebImage`'s bundled `PrivacyInfo.xcprivacy` — confirm it (punch-list item 24):
  ```bash
  ls ios/Pods/SDWebImage/**/PrivacyInfo.xcprivacy 2>/dev/null && echo "SDWebImage privacy manifest present"
  ```

**0d. Confirm the bump scripts are executable (they drive CFBundleVersion):**
```bash
ls -l scripts/bump-cfbundle-version.sh scripts/bump-watch-build-number.sh   # both -rwxr-xr-x
```

---

## Step 1 — Cheap compile gate BEFORE the slow archive (agent-runnable, ~2-3 min)

Prove the **Watch Swift target compiles** before spending ~10 min on a full
archive (per xcodebuild skill's pre-flight gate):

```bash
cd ios
xcodebuild -scheme WatchPreview -sdk watchsimulator \
  -destination 'generic/platform=watchOS Simulator' build 2>&1 \
  | grep -E "error:|BUILD SUCCEEDED|BUILD FAILED" | tail
cd ..
```
- **`** BUILD SUCCEEDED **`** → Watch Swift is clean; proceed to archive.
- **`BUILD FAILED` + `error:`** → fix the Swift first (a `@Published` model missing `import Combine` shows a 4-error cluster in one file — gotcha #9). Do **not** waste the 10-min archive on a known-broken Watch target.
- **`Unable to find a destination…`** → you used the host `TrainingLog` scheme with a watchOS destination. Use `WatchPreview` exactly as above (it's the only watchOS-buildable scheme).

---

## Step 2 — First Release **archive** (⚠️ USER-ONLY, ~10-30 min, highest risk)

This is the whole point: it exercises Release signing + the **iCloud
entitlement** for the first time. Two paths — **Option A (Xcode UI) is preferred
for the first archive** because it registers the iCloud container in the Portal
via the capability toggle; Option B works once the container is already
registered.

### Option A — Xcode UI (preferred first time)
1. `open ios/TrainingLog.xcworkspace`
2. TARGETS ▸ **TrainingLog** ▸ Signing & Capabilities: team = `XQTU89U2J2`, `Automatically manage signing` ON. Confirm **no red signing error**.
3. Toggle the **iCloud (CloudDocuments)** capability off→on once so Xcode registers `iCloud.com.lisonchang.TrainingLog` in the Portal and regenerates the profile.
4. Product ▸ Destination ▸ **Any iOS Device (arm64)**.
5. Product ▸ **Archive**. Wait for the Organizer to open with the new archive.

### Option B — CLI (lets auto-signing register the container)
```bash
xcodebuild -workspace "/Users/hao800922/code/TrainingLog/ios/TrainingLog.xcworkspace" \
  -scheme TrainingLog -configuration Release \
  -destination 'generic/platform=iOS' -allowProvisioningUpdates \
  -archivePath ~/Desktop/TrainingLog.xcarchive archive > /tmp/tl-archive.log 2>&1; echo "EXIT=$?"
grep -E "\*\* ARCHIVE SUCCEEDED \*\*|error:" /tmp/tl-archive.log | tail
```

**Expected:** `** ARCHIVE SUCCEEDED **`, archive at `~/Desktop/TrainingLog.xcarchive`.

**What to check when it fails:**
- **`no such module 'WatchKit'` / Watch target fails** → you passed `-sdk iphoneos` (forces the WHOLE graph onto the iOS SDK). **Use `-destination 'generic/platform=iOS'`** so each target keeps its own SDKROOT (host→iOS, Watch→watchOS). (xcodebuild skill Trap A.)
- **`'TrainingLog.xcworkspace' does not exist` (exit 66)** → a backgrounded xcodebuild doesn't inherit cwd. Pass the **absolute** `-workspace` path (shown above). (Trap B.)
- **Signing error / `requires a development team`** → team not set or profile not provisioned; open in Xcode, re-select team `XQTU89U2J2`, let auto-provision settle (gotcha #3 — `--clean` prebuild also wipes the team).
- **iCloud entitlement rejected / `Provisioning profile doesn't include the iCloud… entitlement`** → the container isn't registered in the Portal yet. Do Option A step 3 (toggle the capability in Xcode once), then re-archive. **This is the specific risk this whole runbook exists to surface.**
- **`-sdk iphoneos` was NOT used but Watch still errors** → run Step 1's `WatchPreview` gate to isolate a genuine Swift error from a signing/SDK issue.

---

## Step 3 — Verify CFBundleVersion auto-bump fired (host + embedded Watch)

Both bump Run-Script phases stamp the **built product** plist during archive.
Confirm they ran and the archive carries the bumped value (skill's PlistBuddy
recipe):

```bash
ARCH=~/Desktop/TrainingLog.xcarchive
# 1. host bump:
/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' \
  "$ARCH/Products/Applications/TrainingLog.app/Info.plist"
# 2. embedded Watch bump:
/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' \
  "$ARCH/Products/Applications/TrainingLog.app/Watch/TrainingLog Watch Watch App.app/Info.plist"
# 3. marketing version unchanged:
/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' \
  "$ARCH/Products/Applications/TrainingLog.app/Info.plist"     # expect 1.0.0
```
**Expected:** items 1 & 2 are large Unix-epoch timestamps (e.g. `178xxxxxxxx`),
**not `1`**; item 3 is `1.0.0`.

**What to check when it fails:**
- **Value is `1`** → the bump phase didn't run. In the archive log (`/tmp/tl-archive.log`) grep `host: CFBundleVersion` / `watch: CFBundleVersion` for the echo. If absent, the Run-Script phase is missing/ordered wrong — confirm "Bump Host CFBundleVersion" is the **last** phase of the host target (after "Embed Watch Content") and "Bump Watch CFBundleVersion" is the last phase of the Watch target (punch-list items 3-5).
- **Source plist changed in git** → it shouldn't; the scripts write the built product only. If `git status` shows `ios/**/Info.plist` dirty, that's a bug — revert it, the archive value is what matters.
- **Monotonicity proof (optional):** run Step 2 twice; item 1's timestamp must strictly increase (V2 > V1). ASC requires each **host** upload's build number strictly higher than the last (`ITMS-90478`).

---

## Step 4 — Verify the archive payload is complete (Watch bundle, PrivacyInfo, entitlements)

```bash
ARCH=~/Desktop/TrainingLog.xcarchive
APP="$ARCH/Products/Applications/TrainingLog.app"
# a. embedded Watch app present:
ls -d "$APP/Watch/TrainingLog Watch Watch App.app" && echo "Watch bundle embedded"
# b. host privacy manifest present:
ls "$APP/PrivacyInfo.xcprivacy" && echo "host PrivacyInfo present"
# c. SDWebImage privacy manifest shipped inside the app (from pod):
find "$APP" -path '*SDWebImage*' -name 'PrivacyInfo.xcprivacy' 2>/dev/null
# d. signed entitlements actually applied (iCloud + HealthKit):
codesign -d --entitlements :- "$APP" 2>/dev/null | grep -iE "healthkit|icloud-container|icloud-services"
```
**Expected:** (a) Watch bundle dir exists; (b) `PrivacyInfo.xcprivacy` present;
(c) SDWebImage's manifest found (harmless if absent — SDWebImage ships it
upstream ≥5.17, verify the pod version if empty); (d) the codesign dump lists
`com.apple.developer.healthkit` and the iCloud keys — proving the entitlements
are **signed in**, not just present as source text.

**What to check when it fails:**
- **No Watch bundle** → the Watch target was skipped (incremental cache / wrong SDK). Re-archive clean; confirm `SwiftCompile … Watch Watch App` lines in the log (Release WMO shows few lines — scan the single SwiftCompile line for filenames, don't panic at a low count — Trap 2).
- **codesign dump missing iCloud keys** → signing didn't attach the iCloud entitlement even though the source file has it → the **Portal container isn't in the profile**. Back to Step 2 Option A step 3.

---

## Step 5 — Export the IPA (⚠️ USER-ONLY signing, ~2 min)

`ios/ExportOptions.plist` **does not exist on main** — create it first (app-store
method, auto-signing, team `XQTU89U2J2`):

```bash
cat > ~/Desktop/ExportOptions.plist <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>              <string>app-store-connect</string>
  <key>teamID</key>              <string>XQTU89U2J2</string>
  <key>signingStyle</key>        <string>automatic</string>
  <key>uploadSymbols</key>       <true/>
  <key>destination</key>         <string>export</string>
</dict>
</plist>
PLIST

xcodebuild -exportArchive \
  -archivePath ~/Desktop/TrainingLog.xcarchive \
  -exportPath ~/Desktop/TrainingLog-export \
  -exportOptionsPlist ~/Desktop/ExportOptions.plist \
  -allowProvisioningUpdates 2>&1 | tee /tmp/tl-export.log | tail -5
ls -la ~/Desktop/TrainingLog-export/*.ipa
```
**Expected:** `** EXPORT SUCCEEDED **` and a `TrainingLog.ipa` in
`~/Desktop/TrainingLog-export/`.

> If you prefer, `method = development` produces a device-installable IPA instead
> (for a last on-device sanity check); use `app-store-connect` for the upload.
> Optionally commit `ExportOptions.plist` to `ios/` afterward so it's repeatable —
> but that's a code change, out of scope for this read-only doc.

**What to check when it fails:**
- **`exportOptionsPlist` errors on `method`** → older Xcode wants `app-store` instead of `app-store-connect`; swap the string.
- **`No signing certificate "Apple Distribution" found`** → let `-allowProvisioningUpdates` create it (needs a logged-in Apple ID in Xcode), or open the Organizer ▸ Distribute App ▸ App Store Connect once (UI path also produces the distribution cert). **USER-ONLY.**
- **`Profile doesn't support…` iCloud** → same Portal-container root cause as Step 2.

---

## Step 6 — Validate (agent-runnable up to the point of login) then **upload (USER-ONLY)**

**6a. Validate the IPA** — allowed to run; catches ITMS errors before you burn an
upload slot:
```bash
# API-key path (no interactive password). Requires an ASC API key .p8 the USER created:
xcrun altool --validate-app -f ~/Desktop/TrainingLog-export/TrainingLog.ipa \
  -t ios --apiKey <KEY_ID> --apiIssuer <ISSUER_ID> 2>&1 | tail
```
- **Expected:** `No errors validating archive` / `UPLOAD/VALIDATION SUCCEEDED`.
- **`ITMS-90478` (build number not higher)** → CFBundleVersion didn't bump or you re-used an archive; re-archive (Step 2→3).
- **`ITMS-90717` alpha channel / icon** → an AppIcon PNG has alpha. Punch-list item 13 says all 15 are alpha-free on main; if this fires, a branch reintroduced alpha — `sips -g hasAlpha` the icons.
- **Missing privacy manifest / usage string** → Step 4 payload check should have caught it; re-verify.

> **Validate is fine for an agent** *only* with a pre-created API key. Without a
> key, validation needs interactive Apple-ID auth → **USER-ONLY**. Prefer the
> Transporter app or Xcode Organizer ▸ Validate App (both USER-ONLY UI) if no key
> exists.

**6b. UPLOAD — USER-ONLY, an agent must NOT run this.** Apple-ID-authenticated;
puts a build into your ASC account.
- **Xcode Organizer** ▸ select the archive ▸ **Distribute App** ▸ App Store Connect ▸ Upload (handles signing + upload in one UI flow), **or**
- `xcrun altool --upload-app -f …TrainingLog.ipa -t ios --apiKey <KEY> --apiIssuer <ISSUER>` (run by the user), **or** the **Transporter** app.

**Everything past the upload — creating the ASC record, filling the store
listing, App Privacy questionnaire, screenshots, submitting for review — is
USER-ONLY and lives in `submission-readiness-2026-07-07.md` Gates 2-4.**

---

## USER-ONLY vs agent-runnable — quick map

| Step | Who |
|---|---|
| 0 (pre-flight: git/npm/pod, sanity greps) | **Agent** (up to any Apple-ID login) |
| 1 (WatchPreview compile gate) | **Agent** |
| 2 (first Release archive) | **USER-ONLY** (signing / Portal / physical Xcode) |
| 3 (CFBundleVersion verify) | **Agent** (reads the archive) |
| 4 (payload verify) | **Agent** |
| 5 (export IPA) | **USER-ONLY** (distribution signing) |
| 6a (validate) | **Agent** *only if* an ASC API key exists; else **USER-ONLY** |
| 6b (upload / ASC record / listing / screenshots / submit) | **USER-ONLY** |

## Cross-cutting failure quick-reference (from the skills)

- **`pod install` encoding crash** → prepend `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8`.
- **`objectVersion '70'` in pod install** → patch the local xcodeproj gem constant (per-Mac, not git).
- **Watch fails to compile in archive** → never `-sdk iphoneos`; use `-destination 'generic/platform=iOS'`.
- **Backgrounded xcodebuild "workspace does not exist"** → pass the absolute `-workspace` path.
- **Signing team "None" after any `expo prebuild --clean`** → re-select `XQTU89U2J2` in Xcode (team isn't in git).
- **CFBundleVersion stuck at 1** → bump Run-Script phase missing/mis-ordered; must be the last phase of each target.
- **iCloud entitlement not signed in** → toggle the CloudDocuments capability once in Xcode to register the container in the Portal, then re-archive. **This is the #1 first-archive risk.**
