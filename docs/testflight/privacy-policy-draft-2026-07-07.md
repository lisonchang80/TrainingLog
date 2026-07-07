# Privacy Policy — Publishing Draft (bilingual)

> **STATUS: DRAFT — 2026-07-07.** A web-hostable privacy policy for TrainingLog,
> written for the **actual** data flow verified against the code at
> `main @ 2574061`. It is a **draft**: the agent does not publish it or make any
> external commitment on the user's behalf. Publish the final version to a
> reachable URL (e.g. GitHub Pages) and paste that URL into App Store Connect →
> App Information → Privacy Policy URL (a **hard requirement** for any
> HealthKit-using app).
>
> **How to use:** fill the `[[...]]` placeholders (effective date, contact,
> hosted URL), resolve the **⚠️ 需作者確認** items, then paste the zh + en
> sections into your hosting page. A sibling agent owns the ASC "App Privacy"
> nutrition-label answers — see
> [`app-privacy-questionnaire-2026-06-13.md`](./app-privacy-questionnaire-2026-06-13.md);
> keep the two consistent (both conclude **Data Not Collected**).

---

## Data-flow evidence (why this policy says what it says)

Verified 2026-07-07 against the repo:

| Claim | Evidence |
|---|---|
| No network egress from app code | grep of `src/` + `app/` for `fetch(`/`axios`/`XMLHttpRequest`/`WebSocket`/`sendBeacon`/`EventSource`/`http(s)://` → **0 production call sites**. |
| No analytics / ads / crash / tracking SDK | `package.json` has none of firebase/sentry/crashlytics/amplitude/mixpanel/segment/posthog/appsflyer/adjust/onesignal/google-analytics. |
| No account / login / backend | no auth/login/oauth/password/backend code. |
| `expo-web-browser` dependency is unused | grep for `WebBrowser`/`openBrowserAsync` → **0 call sites** (dependency present, never invoked). |
| Storage is local SQLite | `expo-sqlite`, `src/adapters/sqlite/*`. |
| HealthKit scope | READ `HeartRate` + `ActiveEnergyBurned`; WRITE `HKWorkoutType` (`src/adapters/healthkit/permission.ts`). |
| iCloud backup = user's own private container | `iCloud.com.lisonchang.TrainingLog`, `CloudDocuments` (`ios/TrainingLog/TrainingLog.entitlements`); not CloudKit-public, not a developer server. |
| JSON export stays on device | `src/services/jsonExport.ts` writes to the device document directory only. |
| Privacy manifest | `NSPrivacyTracking = false`, `NSPrivacyCollectedDataTypes = []`. |

**⚠️ 需作者確認 before publishing:**
1. The policy states **no analytics of any kind**. Grep is clean today; if a
   crash reporter or analytics SDK is ever added, this policy MUST be updated.
2. Effective date, developer/contact name, and hosted URL placeholders.
3. Governing-law / jurisdiction line (Taiwan assumed as default — confirm).
4. Whether to name a specific data-retention statement (drafted as "for as long
   as you keep the app / your own backups" — confirm wording).

---

# ═══════════ 繁體中文 ═══════════

# TrainingLog 隱私權政策

**生效日期：** [[YYYY-MM-DD]]
**開發者：** [[開發者姓名 / lisonchang80]]
**聯絡方式：** lisonchang80@gmail.com

## 摘要

TrainingLog（以下稱「本 App」）是一款完全離線的重量訓練紀錄工具。**本 App 不收集、不傳送、也無法存取你的任何個人資料。** 你的所有訓練資料只存在你自己的裝置上，以及（若你啟用）你自己的 iCloud 帳號中。本 App 沒有帳號系統、沒有伺服器、沒有廣告、也沒有任何第三方分析或追蹤。

## 我們收集哪些資料

**不收集。** 依 Apple 對「收集」的定義（將資料傳出裝置、使開發者或第三方得以存取），本 App 不收集任何資料，因為本 App 不會將任何資料傳出你的裝置到開發者或任何第三方。

## 你的資料存放在哪裡

- **裝置本機：** 你輸入的訓練內容（動作、組數、次數、重量、RPE、備註、模板、計劃、身體數據等）儲存在你 iPhone 上的本機資料庫（SQLite）。這些資料不會離開你的裝置，除非你自己主動備份或匯出（見下）。
- **你自己的 iCloud Drive（選用）：** 若啟用備份，本 App 會將整個資料庫的快照存入**你自己的** iCloud 私人容器（`iCloud.com.lisonchang.TrainingLog`）。此備份由 Apple 代你儲存與同步，**開發者無法存取**。這不是開發者的伺服器。
- **本機 JSON 匯出（選用）：** 當你點選「匯出資料 (JSON)」時，本 App 會在你的裝置上產生一份 JSON 檔。此檔案是否分享、分享到哪裡，完全由你決定；開發者不會收到它。

## Apple 健康（HealthKit）

在你明確授權的前提下，本 App 會：

- **讀取**你的**心率**與**主動消耗熱量**，用於顯示某次訓練的統計資料（在 Apple Watch 上則透過即時 workout session 讀取心率）。
- **寫入**一筆訓練摘要（HKWorkout）回「健康」App，讓該次訓練顯示在「體能訓練 / Fitness」App 中。

**所有健康資料都留在你的裝置上、存放於 Apple 健康資料庫，永不傳送到任何伺服器。** HealthKit 權限為選用，僅在你首次進入相關畫面時才會請求。本 App 從 HealthKit 取得的資料**不會**用於行銷或廣告，也**不會**分享給第三方。你可隨時於「設定 → 隱私權與安全性 → 健康 → TrainingLog」變更或撤銷授權。

## 我們不做的事

- ❌ 沒有帳號、沒有登入、沒有密碼。
- ❌ 沒有第三方分析、統計或使用者行為追蹤。
- ❌ 沒有廣告與廣告識別碼（IDFA）。
- ❌ 沒有當機回報或遙測 SDK。
- ❌ 不存取通訊錄、相機、麥克風、定位。
- ❌ 不會將你的資料販售、分享或傳送給任何人。

## 兒童隱私

本 App 不會針對兒童收集任何資料（本 App 對任何人都不收集資料）。分級為 4+。

## 資料保留與刪除

你的資料保存在你的裝置上，直到你刪除它。刪除本 App 即會移除裝置上的本機資料庫。你 iCloud 中的備份由你自行管理，可於 iCloud 設定中刪除。由於本 App 沒有伺服器，開發者端沒有任何你的資料需要刪除。

## 政策變更

若本政策有更新，會更新本頁的「生效日期」。若未來版本新增任何會傳送資料的功能，我們會在此明確揭露。

## 聯絡我們

有任何隱私相關問題，請來信：lisonchang80@gmail.com

---

# ═══════════ English ═══════════

# TrainingLog Privacy Policy

**Effective date:** [[YYYY-MM-DD]]
**Developer:** [[Developer name / lisonchang80]]
**Contact:** lisonchang80@gmail.com

## Summary

TrainingLog ("the App") is a fully offline weight-training log. **The App does
not collect, transmit, or have access to any of your personal data.** All of
your training data stays on your own device and (if you enable it) in your own
iCloud account. There is no account, no server, no ads, and no third-party
analytics or tracking.

## What data we collect

**None.** Under Apple's definition of "collect" (transmitting data off the
device in a way that lets the developer or a third party access it), the App
collects nothing, because it never transmits any data off your device to the
developer or any third party.

## Where your data lives

- **On your device:** the training content you enter (exercises, sets, reps,
  weight, RPE, notes, templates, programs, body metrics, etc.) is stored in a
  local database (SQLite) on your iPhone. It never leaves your device unless you
  choose to back it up or export it (below).
- **Your own iCloud Drive (optional):** if you enable backup, the App writes a
  snapshot of the whole database into **your own** private iCloud container
  (`iCloud.com.lisonchang.TrainingLog`). Apple stores and syncs this on your
  behalf; **the developer cannot access it.** It is not a developer server.
- **Local JSON export (optional):** when you tap "Export Data (JSON)", the App
  creates a JSON file on your device. Whether and where you share it is entirely
  your choice; the developer never receives it.

## Apple Health (HealthKit)

With your explicit permission, the App:

- **Reads** your **heart rate** and **active energy burned** to show stats for a
  workout you just did (on Apple Watch it reads heart rate via a live workout
  session).
- **Writes** a workout summary (HKWorkout) back to the Health app so the session
  appears in the Fitness app.

**All Health data stays on your device inside Apple Health and is never sent to
any server.** HealthKit permission is optional and is requested only when you
first open a relevant screen. Data obtained from HealthKit is **not** used for
marketing or advertising and is **not** shared with any third party. You can
change or revoke access anytime in Settings → Privacy & Security → Health →
TrainingLog.

## What we do NOT do

- ❌ No account, no login, no password.
- ❌ No third-party analytics, statistics, or behavioral tracking.
- ❌ No ads and no advertising identifier (IDFA).
- ❌ No crash-reporting or telemetry SDK.
- ❌ No access to contacts, camera, microphone, or location.
- ❌ We never sell, share, or transmit your data to anyone.

## Children's privacy

The App collects no data about children (it collects no data about anyone).
Rated 4+.

## Data retention & deletion

Your data stays on your device until you delete it. Deleting the App removes the
local database. Backups in your iCloud are managed by you and can be deleted in
your iCloud settings. Because the App has no server, there is no data on the
developer's side to delete.

## Changes to this policy

If this policy changes, the "Effective date" above will be updated. If a future
version adds any feature that transmits data, we will disclose it clearly here.

## Contact

For any privacy questions, email: lisonchang80@gmail.com

---

## Publishing checklist

- [ ] Fill `[[effective date]]`, `[[developer name]]`, `[[hosted URL]]`.
- [ ] Resolve the four **⚠️ 需作者確認** items above.
- [ ] Publish to a public, stable URL (GitHub Pages on the repo is the
      contemplated path).
- [ ] Paste the URL into App Store Connect → App Information → Privacy Policy URL.
- [ ] Keep this consistent with the ASC "App Privacy" answers
      ([`app-privacy-questionnaire-2026-06-13.md`](./app-privacy-questionnaire-2026-06-13.md))
      — both must say **Data Not Collected**.
- [ ] Re-review if any analytics / crash / network feature is ever added.
