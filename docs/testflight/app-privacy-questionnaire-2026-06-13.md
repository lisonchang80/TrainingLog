# App Store Connect — "App Privacy" Questionnaire Answer Sheet

> **STATUS: DRAFT — 2026-06-13.** Ready-to-paste answers for the App Store
> Connect → App Privacy ("privacy nutrition label") questionnaire, grounded
> in the TrainingLog code at branch
> `chore/privacy-policy-and-app-privacy` (off main `f9f637e`).
>
> This sheet supersedes the older branch draft
> (`chore/appstore-watch-readiness:docs/testflight/submission-questionnaire.md`),
> whose premise — "iCloud whole-DB backup … is NOT shipped, and JSON export
> is NOT shipped" — is now **FALSE**: slice 15 iCloud backup and slice 15b
> JSON export have both shipped. The conclusion is **unchanged** after
> re-review against the shipped binary: **Data Not Collected**. See §"Why
> the new features do not change the answer" for the reasoning.

---

## TL;DR — what to enter in App Store Connect

1. On the App Privacy page, the first question is:
   **"Do you or your third-party partners collect data from this app?"**
   → Select **"No, we do not collect data from this app."**
2. App Store Connect then shows the label as **"Data Not Collected"** for
   every category. You do not fill in any individual category.
3. Separately (NOT part of this questionnaire, but a hard requirement for a
   HealthKit app): enter the **Privacy Policy URL** in the app's metadata
   (App Information → Privacy Policy URL). Publish
   `docs/PRIVACY-POLICY-DRAFT.md` first and paste that URL.

---

## Apple's definition of "collect" (the rule this sheet applies)

Apple's App Privacy definitions state that **"collect"** means *transmitting
data off the device in a way that allows you (the developer) and/or your
third-party partners to access it for a period longer than necessary to
service the request in real time*.

Three consequences that decide every answer below:

1. **Data that never leaves the device is not "collected."** All of
   TrainingLog's training data lives in a local SQLite database in the App's
   sandbox. Verified: zero `fetch`/`axios`/`XMLHttpRequest`/`WebSocket`/
   `sendBeacon`/`EventSource` in `src/` + `app/` (the report-08 audit and a
   fresh grep both return zero network egress).

2. **Reading from HealthKit is not "collecting."** HealthKit data is read
   on-device for on-device display; it is never transmitted to the developer
   or a third party. Apple treats on-device HealthKit reads as not-collected
   so long as the data is not sent off-device. TrainingLog does not send it
   off-device.

3. **Backing up to the user's OWN iCloud account is not "collecting" by the
   developer.** The iCloud Drive backup goes into the **user's** private
   iCloud container, which Apple stores and syncs on the user's behalf. The
   developer has **no access** to it — it is not a developer-controlled
   server. Apple's guidance is explicit that data the user stores in their
   own iCloud (managed by Apple, not accessible to the developer) is not
   "collected" by the developer for App Privacy purposes.

A useful contrast Apple draws: a developer-run CloudKit *public* database or
a developer backend *would* count. TrainingLog uses neither — it writes a
file into the user's **private** ubiquity container
(`iCloud.com.lisonchang.TrainingLog`,
`com.apple.developer.icloud-services = CloudDocuments`), not CloudKit, not a
developer server.

---

## Per-category answers (all ASC data categories)

For every category below the answer is **Data Not Collected** because no
data is transmitted off-device to the developer or any third party. Each
row states the answer plus the code-grounded justification.

| ASC category | Collected? | Justification (code-grounded) |
|---|---|---|
| **Contact Info** (name, email, phone, address, etc.) | **No** | The App has no sign-up, no account, no login. It never asks for or transmits contact info. The developer contact email in the policy is the developer's, not collected from users. |
| **Health & Fitness** | **No** | This is the sensitive one — and still **Not Collected**. The App *reads* HealthKit (heart rate, active energy, basal energy, workout type) on-device with explicit permission, and *writes* HKWorkout to the user's own Health store. None of it is transmitted to the developer or a third party. Training data the user enters (sets/reps/weight/RPE/notes/body metrics) lives only in the local SQLite DB. iCloud backup of that DB goes to the **user's own** iCloud, not a developer server. → **Not Collected.** |
| **Financial Info** | **No** | No payments, no in-app purchases, no payment-card or financial data of any kind. |
| **Location** | **No** | No Core Location usage; no location usage-description strings; no location data read or transmitted. |
| **Sensitive Info** | **No** | No race/ethnicity, sexual orientation, religious/political belief, biometric, etc. collected or transmitted. (Health data is handled under Health & Fitness above and stays on-device.) |
| **Contacts** | **No** | No access to the device address book; no Contacts framework usage. |
| **User Content** (photos, videos, audio, gameplay, customer support, other user content) | **No** | The user's training content (exercise names, notes, templates, programs, body metrics) is "user content," but it stays in the on-device SQLite DB / the user's own iCloud backup / a user-initiated local JSON export. None of it is transmitted to the developer or a third party. → **Not Collected.** |
| **Browsing History** | **No** | The App has no web browser/web view that records browsing; nothing transmitted. |
| **Search History** | **No** | In-app search/filter (e.g. exercise library filter) runs locally against SQLite; nothing transmitted. |
| **Identifiers** (User ID, Device ID) | **No** | No account/user ID. No IDFA / advertising identifier. No device identifier is read for transmission. `NSPrivacyTracking = false`. |
| **Purchases** (purchase history) | **No** | No purchases / StoreKit / IAP. |
| **Usage Data** (product interaction, advertising data, etc.) | **No** | No analytics SDK, no event logging sent off-device, no advertising. Verified: no Sentry/Firebase/Amplitude/Mixpanel/Segment/PostHog/Google-Analytics/etc. in dependencies or code. |
| **Diagnostics** (crash data, performance data, other diagnostic data) | **No** | No crash reporter, no performance/telemetry SDK. The App logs `console.warn`/`console.error` to the local console only on failure paths (33 occurrences, all on-device, none transmitted). → **Not Collected.** |
| **Other Data** | **No** | Nothing else collected or transmitted. |

---

## Why the new slice-15 features do not change the answer

These two features shipped AFTER the previous questionnaire draft and were
the reason it was flagged stale. Re-reviewed against the code, both remain
**Not Collected**:

### iCloud whole-DB backup (slice 15)
- **What it does:** copies a snapshot of the local SQLite DB into the App's
  iCloud Drive ubiquity container under `Documents/`
  (`src/adapters/backup/icloudBackupAdapter.ts`: write-then-promote into
  `<container>/Documents/`; `modules/icloud-backup/index.ts`: thin native
  bridge to the ubiquity container; `src/services/backupService.ts`:
  orchestrator).
- **Why it is NOT "collected":** the ubiquity container lives in the
  **user's own private iCloud account**
  (`iCloud.com.lisonchang.TrainingLog`, CloudDocuments). Apple stores/syncs
  it on the user's behalf; the developer cannot access it. This is the
  textbook "user stores their data in their own iCloud, managed by Apple,
  not accessible to the developer" case → not collected by the developer.
  No CloudKit public DB, no developer backend.

### JSON export (slice 15b)
- **What it does:** when the user taps "Export Data (JSON)" in Settings, the
  App writes a single JSON dump of the DB to the device's document directory
  (`src/services/jsonExport.ts` → `writeJsonExport` → `documentDirectory`;
  wired in `app/(tabs)/settings.tsx`). The iOS Share Sheet is **deferred**
  (expo-sharing not installed) — for now the user just gets a file on disk
  plus its path.
- **Why it is NOT "collected":** the file is created only at the user's
  request, stays on the user's device, and is shared (if at all) only by the
  **user**, to a destination the **user** picks. The developer never
  receives it and there is no automatic transmission. → not collected.

---

## Privacy manifest cross-check (consistency, not part of this questionnaire)

`ios/TrainingLog/PrivacyInfo.xcprivacy` is consistent with the
"Data Not Collected" answer and should NOT need to change:

- `NSPrivacyCollectedDataTypes` = **empty array** → matches "Data Not
  Collected." ✓
- `NSPrivacyTracking` = **false** → matches "no tracking." ✓
- `NSPrivacyAccessedAPITypes` declares required-reason APIs only
  (UserDefaults `CA92.1`; FileTimestamp `0A2A.1`/`3B52.1`/`C617.1`;
  DiskSpace `E174.1`/`85F4.1`; SystemBootTime `35F9.1`) — these are
  "required reason" API declarations, NOT data collection. They do not
  change the App Privacy answer. ✓

If App Store Connect's answer ("Data Not Collected") and the privacy
manifest's empty `NSPrivacyCollectedDataTypes` ever disagree, Apple flags
it — here they agree, so no action.

---

## Hard requirement to remember (separate from this questionnaire)

A HealthKit-using app **MUST** have a Privacy Policy URL in App Store
Connect, regardless of the "Data Not Collected" answer. Publish
`docs/PRIVACY-POLICY-DRAFT.md` (fill its placeholders first) and paste the
URL into App Information → Privacy Policy URL. This is an App-Store
submission blocker independent of the privacy label.

---

## Open items for the user to confirm before submitting

1. **Re-confirm "No account / no login."** This sheet assumes the App has no
   user account or sign-in. (Verified: no auth code found.) Confirm no
   account feature is added before submission.
2. **Confirm no third-party SDK is added later** that phones home (e.g. if a
   crash reporter or analytics is added in a future build, this answer must
   change to "Yes, we collect data" and the relevant categories filled in,
   and the privacy manifest + policy updated).
3. **Privacy Policy URL** must be live and reachable before you submit (see
   the hard-requirement note above).
