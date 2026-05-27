# Slice 13d / D4 — Watch Xcode Target Setup Checklist

**Purpose**: add an Apple Watch app target to the existing
`ios/TrainingLog.xcodeproj` so Spike A/B can run + D5 (Watch HK
lifecycle) can build on top. ADR-0019 § Q1/Q2/Q3/Q26 + D4 spec.

**Approach**: Branch C per ADR-0019 Q1 — manual Xcode scaffold; the
`ios/` directory is committed to git (no `expo prebuild --clean` after
this point).

**Why D4 must be user-driven**: Xcode handles `.xcodeproj/project.pbxproj`
edits with a UUID-keyed binary-ish format that's brittle to hand-edit.
Adding a target through Xcode GUI ensures all the cross-references stay
sane. After Xcode generates the target, this checklist tells you which
generated files to overlay with the locked-in content below.

**Pre-flight (confirmed earlier today)**:
- Xcode 26.4.1 ✅
- iPhone 14 Pro + Apple Watch Ultra paired & available ✅
- TING-HAO CHANG (4344LN7CXS) dev cert ✅
- `react-native-watch-connectivity@2.0.0` already linked on iPhone side
  (spike C PASS) ✅
- Watch app target NOT yet created — this checklist creates it

**Estimated time**: 20-40 minutes (most is Xcode GUI clicks + the cold
build to verify Watch app installs on real device).

---

## Naming + identifiers (locked per ADR-0019)

| Asset | Value | Source |
|---|---|---|
| Watch app Bundle Identifier | `com.lisonchang.TrainingLog.watchkitapp` | Q2 |
| Watch app display name | `TrainingLog Watch` | (convention) |
| Watch target folder | `ios/TrainingLogWatch/` | (convention) |
| iPhone app Bundle Identifier (unchanged) | `com.lisonchang.TrainingLog` | (existing) |
| Team | TING-HAO CHANG (`4344LN7CXS`) | Q3 |
| Interface | SwiftUI | Q1 |
| Min watchOS deployment | 11.0 | Q22/Q28 — trigger-only HK requires watchOS 11+ |

The watchOS app target's bundle ID being a STRICT PREFIX-PLUS-suffix of
the iPhone bundle ID (i.e. `<iPhone-id>.watchkitapp`) is required by
Apple's WatchKit auto-association. Don't deviate.

---

## Step 1 — Open Xcode workspace

```sh
open /Users/hao800922/code/TrainingLog/ios/TrainingLog.xcworkspace
```

If still open from spike C — switch to it.

---

## Step 2 — File → New → Target…

1. Menu bar: **File** → **New** → **Target...** (⌘⌥N)
2. Top tab: select **watchOS**
3. Pick template: **App** (NOT "App for iOS App" — that's the old paired
   template; we want a modern watchOS-only target since iOS 17+ deprecated
   the old paired flow). Click **Next**.

**Configuration sheet** — fill in EXACTLY:

| Field | Value |
|---|---|
| Product Name | `TrainingLog Watch` |
| Team | TING-HAO CHANG |
| Organization Identifier | `com.lisonchang` |
| Bundle Identifier | (auto: `com.lisonchang.TrainingLogWatch` — **edit to**: `com.lisonchang.TrainingLog.watchkitapp`) |
| Interface | SwiftUI |
| Language | Swift |
| Include Tests | unchecked (keep simple; we add later if needed) |
| Storage | None |

Click **Finish**. Xcode may show an "Activate scheme?" dialog — click
**Activate**.

After this, you should see a new folder `TrainingLog Watch` in the
project navigator (left sidebar) with these files auto-generated:
- `TrainingLog_WatchApp.swift`
- `ContentView.swift`
- `Assets.xcassets`
- `Info.plist` (may be implicit — sometimes Xcode uses Build Settings
  instead of a literal file; we'll check in step 4)
- `TrainingLog Watch.entitlements` (only created if you add a capability;
  step 5 below)

---

## Step 3 — Rename folder on disk to match convention

Xcode creates `ios/TrainingLog Watch/` (with a space). Our convention
is `ios/TrainingLogWatch/` (no space) to avoid quoting issues in build
scripts + commit paths. Do this:

1. In Xcode Project navigator, right-click the `TrainingLog Watch` group
   → **Show in Finder**
2. In Finder, rename the folder from `TrainingLog Watch` to
   `TrainingLogWatch`
3. Back in Xcode, the group will show a missing-file warning (red text).
   Click the group, in the right panel **File inspector → Identity and
   Type → Location** → click the folder icon → re-pick the renamed
   folder.

If that's annoying, you can leave the folder as `TrainingLog Watch` —
Bash escaping with quotes handles spaces fine. The convention is a
preference, not strict.

---

## Step 4 — Replace `TrainingLog_WatchApp.swift` content

Click `TrainingLog_WatchApp.swift` in the navigator, replace whole file
contents with:

```swift
//
// TrainingLogWatchApp.swift
// TrainingLog Watch
//
// Slice 13d D4 — minimal watchOS app entry. D5 will wire
// HKLiveWorkoutBuilder + WCSession; D8+ will wire the picker UI.
// Per ADR-0019 Q1 (manual scaffold) + Q22/Q28 (trigger-only HK,
// watchOS 11+).
//

import SwiftUI

@main
struct TrainingLogWatchApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
```

---

## Step 5 — Replace `ContentView.swift` content

Click `ContentView.swift` in the navigator, replace whole file contents
with:

```swift
//
// ContentView.swift
// TrainingLog Watch
//
// Slice 13d D4 placeholder. D8 replaces this with the picker root
// 3-step UI per ADR-0019 NEW-Q29.
//

import SwiftUI

struct ContentView: View {
    var body: some View {
        VStack(spacing: 8) {
            Text("TrainingLog")
                .font(.headline)
            Text("D4 scaffold")
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text("Picker UI ships in D8")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .padding()
    }
}

#Preview {
    ContentView()
}
```

---

## Step 6 — Add capabilities (HealthKit + Background Modes)

Click the **TrainingLog Watch** target in the TARGETS list (left side of
project editor) → **Signing & Capabilities** tab.

### 6a. Add HealthKit

1. Top-left **+ Capability** button → search "HealthKit" → double-click
2. After adding, in the HealthKit row:
   - Leave "Clinical Health Records" UNCHECKED (we don't need clinical
     data per ADR-0019)
   - Leave "Background Delivery" UNCHECKED (D5 uses live workout flow,
     not background HK observer queries)

This adds an entry in the auto-generated entitlements file:
```xml
<key>com.apple.developer.healthkit</key>
<true/>
```

### 6b. Add Background Modes

1. **+ Capability** → search "Background Modes" → double-click
2. After adding, in the Background Modes section, CHECK exactly:
   - ☑ **Workout processing**
3. Leave all other boxes (Audio, Location, etc.) unchecked.

This adds an entry in the auto-generated Info.plist:
```xml
<key>WKBackgroundModes</key>
<array>
  <string>workout-processing</string>
</array>
```

(Note: on watchOS the key is `WKBackgroundModes`, not iOS's
`UIBackgroundModes`. Xcode UI handles this automatically.)

### 6c. Verify the entitlements file content

In the Project navigator, find `TrainingLogWatch.entitlements` (Xcode
creates it under `ios/TrainingLogWatch/` after step 6a). Open it →
should look exactly like:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.developer.healthkit</key>
    <true/>
</dict>
</plist>
```

If Xcode added extra keys (e.g. `com.apple.developer.healthkit.access`
as an array) — that's fine, just don't remove `healthkit = true`.

---

## Step 7 — Add HealthKit usage descriptions to Watch Info.plist

watchOS apps must declare HealthKit usage descriptions even though
ADR-0019 Q22 says we rely on paired-share permission (= iPhone-side
already has these). If we skip these, the Watch app crashes on
`HKHealthStore` access. Apple's rule is "if the binary calls HK APIs,
the Info.plist must declare usage strings", regardless of where the
auth was granted.

In Xcode, click the **TrainingLog Watch** target → **Info** tab
(or open Info.plist directly if Xcode shows it as a literal file in
the navigator). Add these two keys:

| Key | Value |
|---|---|
| `NSHealthShareUsageDescription` (Privacy - Health Share Usage Description) | `TrainingLog Watch 讀取訓練心率與消耗熱量、用於本機顯示。` |
| `NSHealthUpdateUsageDescription` (Privacy - Health Update Usage Description) | `TrainingLog Watch 不直接寫入健康資料，本鍵預留以符合 watchOS HKHealthStore API 要求。` |

Note the second key's description is intentionally explanatory — per
ADR-0019 § Q28 Branch C, Watch end-of-workout calls
`HKLiveWorkoutBuilder.discardWorkout()` so we never actually write an
HKWorkout entry from Watch (iPhone-side writer in D3 13c is the only
writer). But the Info.plist key has to be present for the binary to
link against HK.

---

## Step 8 — Verify signing

Still in **TrainingLog Watch target → Signing & Capabilities**:
- ☑ Automatically manage signing
- Team: TING-HAO CHANG (`4344LN7CXS`) — same as iPhone target
- Bundle Identifier: `com.lisonchang.TrainingLog.watchkitapp` (double-check)
- Provisioning Profile: should auto-populate to "Xcode Managed Profile"
  once signing resolves. If you see a yellow ⚠ error, click "Try Again"
  in the Signing area — sometimes Xcode needs a beat to register the
  new App ID with developer.apple.com.

If "Try Again" doesn't clear the error, possible causes:
- App ID `com.lisonchang.TrainingLog.watchkitapp` already exists on
  developer.apple.com from a previous experiment → log into
  https://developer.apple.com/account/resources/identifiers/list and
  delete it, then "Try Again"
- HealthKit entitlement needs explicit App ID registration → Apple
  usually does this automatically; if not, manually add HealthKit to the
  App ID at developer.apple.com

---

## Step 9 — Podfile considerations (per ADR-0019 Q26)

Per Q26 spec: "Watch target 純 Apple framework、無 npm dep；Podfile
Watch target section stub or skip". We do NOT add a `target
'TrainingLog Watch' do … end` block to Podfile, because:
- Watch target only uses Apple frameworks (HealthKit, WatchConnectivity,
  SwiftUI) — no CocoaPods deps
- Adding an empty target block can confuse Expo's autolinking + might
  cause pod install warnings

**Action**: open `ios/Podfile` — verify that there is NO
`target 'TrainingLog Watch' do` block. If Xcode auto-added one (unlikely
in modern Xcode, but possible), delete it.

---

## Step 10 — Build to real device

1. Top-bar scheme: keep **TrainingLog** (the iOS app)
2. Top-bar device: **張庭晧 的 iPhone**
3. ⌘R

Xcode will build the iOS app AND the embedded Watch app, then install
both on the iPhone (the Watch app auto-installs to the paired Apple
Watch).

**Expected duration**: 1-3 min incremental build from spike C state
(only the new Watch target needs full compile; iPhone side mostly
cached).

**Expected outcome**:
- iPhone app launches (4-tab bar, as before)
- Apple Watch installs `TrainingLog Watch` — appears in Watch's home
  screen
- Tap the Watch app — should show the D4 placeholder:
  > TrainingLog
  > D4 scaffold
  > Picker UI ships in D8

If the Watch app doesn't appear on the Watch automatically:
- Check Apple Watch app on iPhone → My Watch → scroll to AVAILABLE APPS
  → tap "Install" next to TrainingLog Watch
- Or: Watch settings → General → Software Update — sometimes the Watch
  needs a wake-up tap to discover newly-paired apps

---

## Step 11 — Verify on Watch

Once `TrainingLog Watch` is on the Apple Watch:
1. Tap to launch → confirm placeholder text renders
2. Press Digital Crown to background → app stays alive (no immediate crash)
3. Re-launch from Watch app drawer → should resume cleanly

If the Watch app crashes on launch, common causes:
- Missing `NSHealthShareUsageDescription` in Info.plist → step 7 wasn't
  saved
- Wrong bundle ID → has to be `com.lisonchang.TrainingLog.watchkitapp`
  exactly
- watchOS deployment target mismatch → in target Build Settings, search
  "deployment target", confirm watchOS Deployment Target ≥ 11.0

Watch the Xcode console (⇧⌘Y) — any Swift exception will print with
the file:line.

---

## Step 12 — Re-run spike C to confirm `getIsWatchAppInstalled` flips

Now that the Watch app is installed, the spike C result for that step
should change:

| Step | Before D4 | After D4 |
|---|---|---|
| `getIsWatchAppInstalled` | `false` | `true` |
| `getReachability` | `false` | `true` (if Watch is on wrist + iPhone in range) |
| `sendMessage` errCb code | `7006 WatchAppNotInstalled` | likely `7007 NotReachable` or actual reply if we wire a handler in D5+ |

To verify:
1. Reopen TrainingLog iOS app
2. Settings tab → bottom → 🔬 開發者 — D0 spike C → **執行 WC spike**
3. Compare to previous JSON

Re-running takes ~50ms. Not critical for D4 commit, but a satisfying
sanity check that the Watch + iPhone are talking.

---

## Step 13 — Commit D4

Once Watch app installs + placeholder renders + (optional) spike C
re-run confirms `getIsWatchAppInstalled === true`:

Files to stage (will be created by Xcode in step 2-7):
- `ios/TrainingLog.xcodeproj/project.pbxproj` (heavily modified; Xcode handles)
- `ios/TrainingLogWatch/` (whole new directory with Swift files +
  Info.plist + entitlements + Assets)
- maybe `ios/TrainingLog.xcodeproj/xcshareddata/xcschemes/TrainingLog Watch.xcscheme` (if Xcode created one)

Commit message template (`feat(slice-13d): D4 — Watch Xcode target scaffold + entitlements`):

```
feat(slice-13d): D4 — Watch Xcode target scaffold + entitlements

Manual Xcode scaffold per ADR-0019 Q1 (Branch C). Creates:

  - `ios/TrainingLogWatch/` watchOS App target
  - Bundle ID `com.lisonchang.TrainingLog.watchkitapp` (Q2 strict
    paired-app convention)
  - watchOS 11+ deployment (Q22/Q28 — trigger-only HK requires this)
  - SwiftUI interface (Q1)
  - HealthKit capability + Background Modes "Workout processing"
  - HK usage descriptions in Watch Info.plist (declared even though
    Q28 trigger-only flow never writes HKWorkout from Watch — required
    for `HKHealthStore` API linking)
  - Placeholder UI showing "TrainingLog / D4 scaffold / Picker UI ships
    in D8" — D8 will replace with picker root 3-step

Verified on real device (iPhone 14 Pro + Apple Watch Ultra):
  - iOS app builds + installs as before
  - Watch app auto-installs from companion app
  - Watch app launches + renders placeholder, no crash
  - spike C re-run confirms `getIsWatchAppInstalled === true` (was
    `false` before D4)

Podfile NOT modified — Watch target has zero CocoaPods deps (Q26).
Skipped `target 'TrainingLog Watch'` block to avoid Expo autolinking
warnings.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## What this enables

After D4 lands:
- **Spike A** (Q28 trigger-only HK on watchOS 11+) can run — Swift code
  in `HealthKitController.swift` calling `HKLiveWorkoutBuilder.discardWorkout()`
- **Spike B** (Q22 paired-share HK auth) can verify whether iPhone-side
  HK auth propagates to Watch automatically, or whether Watch needs its
  own `requestAuthorization` call (the latter being the failure mode)
- **D5** (Watch HK lifecycle) is the natural next D-commit — actual
  Swift `SessionController.swift` + `HealthKitController.swift`
  implementing the trigger-only flow

Both spike A/B are still real-device-only; they'll need this scaffold
to even compile.

---

## Reference files (when you're done)

After D4 lands, these are the files to consult for the next D-commits:
- `ios/TrainingLogWatch/TrainingLogWatchApp.swift` — entry point;
  D8 will add `WCSession` delegate + state object here
- `ios/TrainingLogWatch/ContentView.swift` — UI placeholder;
  D8/D10/D11/D12/D13 will replace incrementally
- `ios/TrainingLogWatch/TrainingLogWatch.entitlements` — HK boolean;
  do NOT modify in normal D-commits
- `ios/TrainingLogWatch/Info.plist` — HK usage strings + WKBackgroundModes;
  do NOT modify in normal D-commits

---

## If you hit something not covered here

Likely culprits + fixes:
- **App ID conflict at developer.apple.com** — log in, manually delete
  the stale identifier, "Try Again" in Xcode signing
- **Pod install warnings post-D4** — `cd ios && LANG=en_US.UTF-8 pod
  install` to refresh; should ignore the new Watch target since no pod
  references it
- **Watch app builds but doesn't install on Watch** — Apple Watch app on
  iPhone → My Watch → scroll → "INSTALL" button next to TrainingLog Watch
- **`HKHealthStore` API call crashes Watch app** — check Info.plist HK
  usage strings (step 7) saved; also verify HK capability is on Watch
  target (step 6a)

When in doubt, copy the exact error message from Xcode and ask me — I
can usually diagnose from the message wording.
