# App Store Connect — "App Privacy" Answer Sheet (refresh)

> **STATUS: READY-TO-PASTE — 2026-07-07.** Overnight agent C. Refreshes and
> re-verifies the 2026-06-13 sheet (`app-privacy-questionnaire-2026-06-13.md`)
> against the current code at branch
> `overnight/privacy-compliance-2026-07-07` (off main `2574061`).
>
> **Conclusion is UNCHANGED: "Data Not Collected" for every category.** This
> refresh re-ran the network/analytics/tracking greps (still zero) and adds
> fresh code citations, including a correction to the exact HealthKit scope
> and a note about the Apple-Watch HealthKit path.

---

## TL;DR — what to enter in App Store Connect

1. App Privacy page, first question — **"Do you or your third-party partners
   collect data from this app?"** → **"No, we do not collect data from this
   app."**
2. ASC then labels every category **"Data Not Collected."** You fill in no
   individual category.
3. Separately (a hard HealthKit-app requirement, NOT part of this
   questionnaire): put a **Privacy Policy URL** in App Information → Privacy
   Policy URL. Publish the privacy policy first and paste its URL. This is a
   submission blocker independent of the label.

---

## The rule this sheet applies (Apple's definition of "collect")

Apple: **"collect"** = transmitting data off the device so that you (the
developer) or a third-party partner can access it beyond servicing the request
in real time. Three consequences decide every answer:

1. **Data that never leaves the device is not "collected."** All training data
   lives in a local SQLite DB in the app sandbox.
2. **Reading HealthKit on-device is not "collecting"** — the data is displayed
   on-device and never sent to the developer or a third party.
3. **Backing up to the user's OWN iCloud is not "collecting" by the
   developer** — the ubiquity container is the user's private iCloud
   (`iCloud.com.lisonchang.TrainingLog`, `CloudDocuments`), managed by Apple,
   not developer-accessible. Not a developer server, not CloudKit public DB.

---

## Fresh evidence gathered 2026-07-07 (re-verification)

| Check | Command | Result |
|---|---|---|
| Network egress | `grep -nE '\bfetch\(|axios|XMLHttpRequest|WebSocket|sendBeacon|EventSource'` over `src/ app/ components/ modules/` | **0 matches** |
| Analytics/crash/tracking SDK | grep + `package.json` dependency scan (`sentry/firebase/amplitude/mixpanel/segment/posthog/bugsnag/crashlytics/datadog/appcenter/adjust/appsflyer/…`) | **NONE** |
| Advertising identifier (IDFA) | grep `AdSupport / IDFA / advertisingIdentifier / ATTrackingManager` | **0** |
| Account / login / auth | no auth deps, no sign-in screen | **none** |
| HealthKit scope (iPhone) | `src/adapters/healthkit/permission.ts` | read `HeartRate`, `ActiveEnergyBurned`; share `HKWorkoutTypeIdentifier` |
| HealthKit scope (Watch) | `ios/.../HealthKitController.swift` | read `heartRate`, `activeEnergyBurned`, `basalEnergyBurned`, `workoutType`; share `workoutType` |
| Local identifier use | `expo-crypto` `randomUUID` for DB/envelope row IDs only — never transmitted | on-device only |

Manifest cross-check: `NSPrivacyCollectedDataTypes = []`, `NSPrivacyTracking =
false` — both consistent with "Data Not Collected."

---

## Per-category answers (all ASC data categories)

Every category = **Data Not Collected** (nothing is transmitted off-device to
the developer or any third party).

| ASC category | Collected? | Justification (code-grounded 2026-07-07) |
|---|---|---|
| **Contact Info** | **No** | No sign-up, account, or login. Never asks for or transmits name/email/phone/address. Developer contact email in the policy is the developer's own, not collected from users. |
| **Health & Fitness** | **No** | The sensitive one, still **Not Collected**. App *reads* HealthKit on-device with explicit permission — iPhone: heart rate + active energy; Apple Watch: heart rate + active + basal energy + workout type (live `HKWorkoutSession`/`HKLiveWorkoutBuilder`). App *writes* one HKWorkout to the user's own Health store on finalize (`src/adapters/healthkit/writer.ts`). None transmitted to developer/third party. User-entered training data (sets/reps/weight/RPE/notes/body metrics) lives only in local SQLite. iCloud backup goes to the **user's own** iCloud. → **Not Collected.** |
| **Financial Info** | **No** | No payments, IAP, StoreKit, or payment/financial data. |
| **Location** | **No** | No Core Location; no `NSLocation*` usage strings; no location read or transmitted. |
| **Sensitive Info** | **No** | No race/ethnicity, sexual orientation, religious/political belief, biometric, etc. (Health data handled above, stays on-device.) |
| **Contacts** | **No** | No address-book / Contacts-framework access. |
| **User Content** (photos, notes, other content) | **No** | Training content (exercise names, notes, templates, programs, body metrics) is "user content" but stays in on-device SQLite / the user's own iCloud backup / a user-initiated local JSON export. Never transmitted. → **Not Collected.** |
| **Browsing History** | **No** | No web browser/web view recording browsing. (`expo-web-browser` is a dep but has **zero call sites** — nothing is opened or recorded.) |
| **Search History** | **No** | In-app filters (e.g. exercise library) run locally against SQLite; nothing transmitted. |
| **Identifiers** (User ID, Device ID) | **No** | No account/user ID. No IDFA/advertising identifier. No device identifier read for transmission. `expo-crypto randomUUID` is used only for local DB row/envelope IDs, never sent off-device. `NSPrivacyTracking = false`. |
| **Purchases** | **No** | No purchases / StoreKit / IAP. |
| **Usage Data** (product interaction, advertising) | **No** | No analytics SDK, no event logging sent off-device, no advertising. Re-verified 2026-07-07: no Sentry/Firebase/Amplitude/Mixpanel/Segment/PostHog/Google-Analytics/etc. |
| **Diagnostics** (crash, performance) | **No** | No crash reporter, no telemetry SDK. `console.warn`/`console.error` log to the local console on failure paths only; never transmitted. → **Not Collected.** |
| **Other Data** | **No** | Nothing else collected or transmitted. |

---

## Why the shipped features do not change the answer

### HealthKit read + write (slices 13b–13d)
- Read on-device for on-device display (詳情頁 stats, Watch live HR/kcal).
  Write = one HKWorkout to the **user's own** Health store so Apple Fitness
  shows the session. Neither transmits to the developer/third party. → not
  collected. (This is precisely the case Apple treats as not-collected for
  on-device HealthKit.)

### iCloud whole-DB backup (slice 15)
- Copies a SQLite snapshot into the app's **private** iCloud ubiquity
  container (`iCloud.com.lisonchang.TrainingLog`, `CloudDocuments`) —
  `src/adapters/backup/icloudBackupAdapter.ts`, `modules/icloud-backup`,
  `src/services/backupService.ts`. Stored/synced by Apple on the user's
  behalf; developer has **no access**. Not CloudKit public DB, not a developer
  backend. → not collected by the developer.

### JSON export (slice 15b)
- On user tap, writes one JSON dump to the device document directory
  (`src/services/jsonExport.ts`). Created only at the user's request, stays on
  device, shared (if at all) only by the **user** to a destination the **user**
  picks. Developer never receives it; no automatic transmission. → not
  collected.

---

## Privacy manifest consistency (not part of the questionnaire)

`ios/TrainingLog/PrivacyInfo.xcprivacy` agrees with "Data Not Collected":
- `NSPrivacyCollectedDataTypes = []` → matches. ✅
- `NSPrivacyTracking = false` → matches "no tracking." ✅
- `NSPrivacyAccessedAPITypes` declares Required-Reason APIs only (UserDefaults
  `CA92.1`; FileTimestamp `0A2A.1`/`3B52.1`/`C617.1`; DiskSpace
  `E174.1`/`85F4.1`; SystemBootTime `35F9.1`) — these are required-reason
  declarations, **not** data collection, and do not change the answer. ✅

If ASC ("Data Not Collected") and the manifest's empty
`NSPrivacyCollectedDataTypes` ever disagree Apple flags it — here they agree.

For the full manifest/entitlements audit (and the one real gap — missing Watch
HealthKit usage strings) see the companion doc
`privacy-manifest-audit-2026-07-07.md`.

---

## Open items for the author to confirm before submitting

1. **⚠️ Privacy Policy URL** must be live and reachable before submit. HealthKit
   apps require it regardless of "Data Not Collected."
2. **⚠️ Re-confirm "no account / no login."** This sheet assumes no user
   account or sign-in (verified: no auth code). Confirm before submission.
3. **⚠️ No phone-home SDK added later.** If a future build adds analytics or a
   crash reporter, this answer must flip to "Yes, we collect data," the
   relevant categories filled in, and the manifest + policy updated.
4. **Watch HealthKit usage strings** — separate from this label but a
   submission concern; see `privacy-manifest-audit-2026-07-07.md` §2.2.
