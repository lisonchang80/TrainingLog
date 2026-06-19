# App Store Connect — Submission-Time Questionnaire Answers

> **STATUS: DRAFT — 2026-06-02**
> Paste-ready answers for the App Store Connect screens you click through
> **at submission time** (after the binary uploads): the App Privacy
> "nutrition label", the HealthKit data-usage review statement, export
> compliance, the age-rating questionnaire, and the demo-account fields.
>
> This complements — does not duplicate — the sibling docs:
> - Store-listing fields (name / subtitle / keywords / screenshots / review
>   notes) → [`app-store-metadata-draft.md`](./app-store-metadata-draft.md)
> - Published privacy policy text → [`../PRIVACY-POLICY-DRAFT.md`](../PRIVACY-POLICY-DRAFT.md)
> - Build-number bump mechanics → [`build-bump.md`](./build-bump.md)
>
> Every answer below is grounded in the **current binary** on
> `chore/appstore-watch-readiness`. Re-verify before each submission — these
> claims drift when network code, SDKs, or HealthKit scope change.

---

## Verification basis (re-checked 2026-06-02 against branch files)

| Claim | Source of truth | Verified value |
|---|---|---|
| No analytics / ads / tracking / crash SDKs | `package.json` deps | grep for firebase/sentry/crashlytics/amplitude/mixpanel/segment/analytics/appsflyer/adjust/onesignal/posthog/axios → **0 matches** |
| No production network egress | `src/` + `app/` | no HTTP client lib; only off-device libs are `@kingstinct/react-native-healthkit` (on-device) + `react-native-watch-connectivity` (WCSession device↔watch, no internet) |
| App Transport Security locked down | `ios/TrainingLog/Info.plist` | `NSAllowsArbitraryLoads=false`; only `NSAllowsLocalNetworking=true` (Metro dev on LAN, benign in Release) |
| No account / login / backend | `src/` + `app/` | zero login/oauth/account/password/backend matches |
| HealthKit scope | `src/adapters/healthkit/permission.ts` L72-76 | **READ** `HKQuantityTypeIdentifierHeartRate`, `HKQuantityTypeIdentifierActiveEnergyBurned`; **WRITE** `HKWorkoutTypeIdentifier` |
| Export-compliance key present | `ios/TrainingLog/Info.plist` L39-40 | `ITSAppUsesNonExemptEncryption = false` |
| App category | `ios/TrainingLog/Info.plist` L7-8 | `LSApplicationCategoryType = public.app-category.healthcare-fitness` |
| Privacy manifest ships | `ios/TrainingLog/PrivacyInfo.xcprivacy` | present, `NSPrivacyTracking=false`, no collected data types, required-reason APIs declared |

> ⚠️ **iCloud whole-DB backup (ADR-0011, slice 15) is NOT shipped**, and JSON
> export is NOT shipped. The "Data Not Collected" answers below are correct
> **today**. Re-review this entire questionnaire when backup ships — even
> then it is typically still "Data Not Collected" (the DB goes to the
> *user's own* private iCloud, not a developer server), but Apple's wording
> must be re-checked at that point. **Do not over-declare now.**

---

## 1. App Privacy ("nutrition label")

The app stores everything in on-device SQLite and transmits nothing to any
server. Per Apple's definition, data is "collected" only if it leaves the
device or is accessible to you / a third party — which is **not** the case
here. Honest answer = **Data Not Collected** for every category.

In App Store Connect: select **"Data Not Collected"**, which skips all the
per-category detail screens.

| Apple data category | Collected? | Why |
|---|---|---|
| Health & Fitness | **No** | HK heart-rate / energy / workout data is read from and written into Apple Health **on-device**; never transmitted off-device by us → not "collected". |
| User Content | **No** | training logs (exercises, sets, reps, RPE, notes) live in local SQLite, never uploaded. |
| Usage Data | **No** | no analytics SDK. |
| Diagnostics | **No** | no crash-reporting SDK. |
| Identifiers | **No** | no advertising/tracking IDs collected. |
| Contact Info / Contacts | **No** | — |
| Location / Financial / Browsing / Purchases / Search / Sensitive Info | **No** | — |

**Final selection:** *Data Not Collected* (all categories). Not linked to
identity. Not used for tracking.

---

## 2. HealthKit data-usage statement (paste into App Review notes)

> TrainingLog reads **Heart Rate** and **Active Energy Burned** from
> HealthKit to display heart-rate and calorie statistics for a workout the
> user just performed, and writes a single **HKWorkout** summary (functional
> strength training) back to Health so the session appears in the Fitness
> app. On Apple Watch it uses a live `HKWorkoutSession` to read heart rate
> during the workout. All Health data stays on the device inside Apple
> Health — it is never sent to any server, and the app has no account or
> backend. Health permission is requested with a clear purpose string when
> the user first opens a relevant screen.

The on-device Info.plist purpose strings the reviewer will see (host target):

- `NSHealthShareUsageDescription`:
  `TrainingLog 需要讀取 Apple Watch 訓練心率與消耗熱量、用於詳情頁統計。`
- `NSHealthUpdateUsageDescription`:
  `TrainingLog 會在無 Apple Watch 紀錄時、把訓練 session 寫入健康資料，讓 Fitness App 顯示完整訓練紀錄。`

> 🟡 The **Watch** target's HK usage strings (pbxproj
> `INFOPLIST_KEY_NSHealth…UsageDescription`) are currently vaguer
> placeholders. Grammatical and won't fail review, but App Review prefers a
> concrete purpose — tighten if convenient (non-blocking, per readiness
> audit report 01 §🟡).

---

## 3. Export compliance

`ITSAppUsesNonExemptEncryption = false` is set in `Info.plist`, so the
**ASC upload will not prompt** the encryption question. If asked anywhere:

- **Uses non-exempt encryption? → No.**
- Rationale: the app uses only standard OS-provided / HTTPS encryption (and
  in practice makes no network calls); it implements no proprietary or
  non-exempt cryptography.
- **No CCATS / annual self-classification report required.**

---

## 4. Demo account & reviewer instructions

- **Demo account: None required.** No login, no account, no server.
  Set **"Sign-in required: No"**.
- Reviewer instructions (paste):

> No login needed. On first use, grant Health access when prompted (Allow
> all) so the workout heart-rate and calorie tiles populate. The heart-rate
> / calorie tiles show "—" unless an Apple Watch actively recorded the
> session, which is expected on a device without a paired Watch. To exercise
> the core flow: create a template, start a session, log sets, then finish —
> the session is saved locally and (if Health is granted) written to the
> Health app as a workout.

---

## 5. Age rating questionnaire

Answer **"None" / "No"** to every content-frequency question — it's a
personal fitness logger with no objectionable content, no user-generated-
content sharing, and no in-app web browsing.

- Resulting rating: **4+**.
- (Consistent with `app-store-metadata-draft.md` Identity → Age Rating 4+.)

---

## 6. Account-deletion requirement → DOES NOT APPLY

Apple's in-app account-deletion mandate applies only to apps that let users
**create an account**. This app has none, so there is nothing to delete
server-side and the requirement is **out of scope** for submission.

> Optional future nicety (not required): a "delete all local data"
> affordance in Settings. Track separately; it is not a submission blocker.

---

## Submission flow ordering (after a green archive)

1. Confirm the archive uploaded (host + watch CFBundleVersion bumped, V2 > V1
   across re-uploads — see [`build-bump.md`](./build-bump.md)).
2. Fill the **store-listing** fields from
   [`app-store-metadata-draft.md`](./app-store-metadata-draft.md).
3. Publish the privacy policy ([`../PRIVACY-POLICY-DRAFT.md`](../PRIVACY-POLICY-DRAFT.md))
   to a public, stable URL and paste it into the Privacy Policy URL field.
4. Complete **this questionnaire**: App Privacy = Data Not Collected (§1),
   export compliance = No (§3), age rating = 4+ (§5).
5. Paste the HealthKit statement (§2) + reviewer instructions (§4) into
   App Review notes.
6. Submit.

---

## Open items carried from sibling drafts

- App name: `TrainingLog 訓練誌` (zh) vs pure-English in both locales — open
  decision in `app-store-metadata-draft.md`.
- Privacy-policy hosting location (repo GitHub Pages vs separate legal repo)
  — open decision in `app-store-metadata-draft.md`.
- Taiwan-first vs worldwide day-1 availability — open decision.
