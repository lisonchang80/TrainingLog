# Privacy Policy / 隱私政策

> **STATUS: DRAFT — refreshed 2026-06-13**
> This document is a working draft. Before submitting the App Store Connect
> Privacy Policy URL you must: (1) fill every `[PLACEHOLDER]` below,
> (2) publish it at a public, stable URL (e.g. GitHub Pages on the existing
> repo, or Notion), and (3) confirm it reflects the build that is shipping.
> The published URL must be public, stable, and match the current build's
> behaviour. Apps that access HealthKit are **required** by Apple to provide
> a privacy-policy URL in App Store Connect.
>
> **Placeholders to resolve before publishing:**
> - `[DEVELOPER LEGAL NAME]` — the legal name / entity that owns the app
>   record (currently shown as "Lison Chang"; confirm or replace).
> - `[EFFECTIVE DATE]` — the date this policy goes live.
> - `[HOSTED POLICY URL]` — the public URL you publish this at.
> - `[JURISDICTION]` — the governing-law / residence jurisdiction (e.g.
>   "Taiwan"), if you choose to include a governing-law line.

---

## English

### About TrainingLog

TrainingLog ("the App") is an iOS and Apple Watch application for keeping a
personal weight-training log. It is developed and maintained by
`[DEVELOPER LEGAL NAME]` (contact: `lisonchang80@gmail.com`).

**Summary in one sentence:** the App stores all of your data on your own
device, optionally backs it up to **your own private iCloud account**, and
sends **no data to the developer or to any third party** — there are no
analytics, no advertising, and no tracking of any kind.

### What information the App handles

The App stores the following information **locally on your device**, in a
private SQLite database inside the App's own sandbox:

- Training records you enter manually: exercise name, sets, reps, weight,
  RPE, notes, and timestamps.
- Workout sessions, training programs, exercise library entries, and
  template definitions you create.
- Body-metric entries you choose to record.
- App preferences (theme, measurement units, backup mode, etc.).

The App reads the following from Apple's HealthKit framework, **only with
your explicit permission** (granted through the iOS/watchOS system
permission dialog):

- **Heart-rate** samples recorded during your training sessions (typically
  by Apple Watch).
- **Active energy burned** during training sessions.
- **Basal (resting) energy burned** during training sessions — read on the
  Apple Watch to display a complete calorie figure on the workout finish
  screen.
- **Workout records** — read so the App can show your existing workouts.

The App writes the following back to HealthKit, **only with your explicit
permission**:

- **Workout records (HKWorkout)** representing strength-training sessions
  you complete on iPhone, written **only when an Apple Watch did not already
  record that session**, so the session appears in Apple's Fitness app
  alongside your other workouts. (The Apple Watch app does not write
  HKWorkout records itself.)

### Where the data goes

- **All training data stays on your device** in a local SQLite database.
  The App does not upload your training data to the developer or to any
  third party.

- **HealthKit data is read on-device** and is never copied off the device by
  the App. HealthKit access requires your explicit grant via the system
  permission dialog, and you can revoke it at any time in
  Settings → Privacy & Security → Health → TrainingLog (on iPhone) or the
  Watch app.

- **HKWorkout records the App writes go into your own Health app**, where
  they remain under your control like any other Health data.

- **iCloud backup (optional, your own iCloud account).** If you keep
  iCloud backup enabled, the App copies a snapshot of its local database
  into the App's iCloud Drive container, which lives in **your own private
  iCloud account**. Apple stores and syncs that file on your behalf; the
  developer **cannot access it** — it is not on any developer-controlled
  server. You can turn this off in the App's Settings, and you can delete
  the backups from the Files app. If you are not signed in to iCloud, or
  iCloud Drive is disabled, no backup is made.

- **JSON export (optional, user-initiated).** When you tap "Export Data
  (JSON)" in Settings, the App writes a single JSON file containing your
  data to a folder on your device. This file is created only at your
  request and stays on your device unless **you** choose to share it (for
  example, via the Files app). The App does not transmit the export
  anywhere.

- **No data is sent to any server controlled by the developer.** The App
  contains no analytics, no crash reporters, no advertising SDKs, and no
  third-party network code. It makes no network requests that carry your
  data off the device.

### Third-party services

The App does **not** integrate any of the following: Google Analytics,
Amplitude, Sentry, Firebase, PostHog, Mixpanel, Segment, advertising
networks, or any other third-party analytics, telemetry, attribution, or
advertising service. The only external system involved is Apple's own
HealthKit (on your device, with your permission) and Apple's iCloud
(your own account, only if you enable backup).

### Tracking

The App does **not** track you across other companies' apps or websites.
The `NSPrivacyTracking` flag in the App's privacy manifest
(`PrivacyInfo.xcprivacy`) is set to `false`, and the App does not use the
Advertising Identifier (IDFA) or any cross-app identifier.

### Your choices and control

- You can deny or revoke HealthKit access at any time in iOS/watchOS
  Settings.
- You can disable iCloud backup in the App's Settings, and delete existing
  backups via the Files app.
- You can delete all of your data by deleting the App (local data is removed
  with the App's sandbox); iCloud backups can be removed separately from the
  Files app.

### Children

The App is not directed to children under 13. It does not knowingly collect
any data from children. (Because the App collects no data on the developer's
behalf at all, no child data reaches the developer.)

### Changes to this policy

If the App's data handling changes, this policy will be updated and the
"effective date" below will be revised. App Store Connect requires the
published Privacy Policy to match the behaviour of the current build.

### Contact

For questions about this policy, contact `lisonchang80@gmail.com`.

**Effective date**: `[EFFECTIVE DATE]`
**Published at**: `[HOSTED POLICY URL]`

---

## 繁體中文

### 關於 TrainingLog

TrainingLog（以下簡稱「本 App」）是一款 iOS 與 Apple Watch 上的個人重量
訓練紀錄 App，由 `[DEVELOPER LEGAL NAME]`（聯絡方式：
`lisonchang80@gmail.com`）開發與維護。

**一句話總結：** 本 App 將您的所有資料儲存在您自己的裝置上，可選擇備份至
**您自己的私人 iCloud 帳號**，且**不會將任何資料傳送給開發者或任何第三
方** —— 沒有任何分析、沒有廣告、沒有任何形式的追蹤。

### 本 App 處理的資料

本 App 在 **您裝置本機**（App 自身沙盒內的私有 SQLite 資料庫）儲存以下
資料：

- 您手動輸入的訓練紀錄：動作名稱、組數、次數、重量、RPE、備註、時間戳記。
- 您建立的訓練 session、訓練計畫（program）、動作庫、模板（template）。
- 您選擇記錄的身體量測資料（body metric）。
- App 偏好設定（主題、度量單位、備份模式等）。

本 App 在取得您 **明確授權後**（透過 iOS/watchOS 系統權限對話框），會從
Apple HealthKit 讀取：

- 訓練期間的 **心率** 樣本（通常由 Apple Watch 紀錄）。
- 訓練期間的 **主動消耗熱量**（active energy）。
- 訓練期間的 **靜態（基礎）消耗熱量**（basal energy）—— 於 Apple Watch
  讀取，用於在訓練完成畫面顯示完整的消耗熱量。
- **Workout 紀錄** —— 讀取以便顯示您既有的訓練。

本 App 在取得您 **明確授權後**，會寫入 HealthKit：

- 您在 iPhone 上完成之重量訓練 session 的 **Workout 紀錄（HKWorkout）**，
  **僅在沒有 Apple Watch 紀錄該 session 時** 才寫入，讓您的訓練 session
  與其他運動並列出現在 Apple Fitness App 中。（Apple Watch App 本身不會
  寫入 HKWorkout 紀錄。）

### 資料儲存位置

- **所有訓練資料皆儲存於您裝置本機** 的 SQLite 資料庫。本 App 不會將您的
  訓練資料上傳至開發者或任何第三方。

- **HealthKit 資料於裝置本機讀取**，本 App 不會將 HealthKit 資料複製到
  裝置以外。HealthKit 存取需要您透過系統權限對話框明確授權，您可隨時於
  iPhone「設定 → 隱私權與安全性 → 健康 → TrainingLog」或 Watch App 中
  撤銷。

- **本 App 寫入的 HKWorkout 紀錄寫入您自己的「健康」App**，仍由您完全
  掌控，與其他健康資料相同。

- **iCloud 備份（選用，使用您自己的 iCloud 帳號）。** 若您保持 iCloud
  備份開啟，本 App 會將其本機資料庫的快照複製到 App 的 iCloud Drive
  容器，該容器位於 **您自己的私人 iCloud 帳號** 中。Apple 代您儲存與同步
  該檔案；開發者 **無法存取** —— 它並不在任何開發者控制的伺服器上。您可
  在 App 設定中關閉此功能，也可從「檔案」App 刪除備份。若您未登入 iCloud
  或已停用 iCloud Drive，則不會進行備份。

- **JSON 匯出（選用，由您主動觸發）。** 當您在設定中點選「匯出資料
  (JSON)」時，本 App 會將包含您資料的單一 JSON 檔案寫入您裝置上的資料夾。
  此檔案僅在您要求時產生，且會留在您的裝置上，除非 **您** 主動選擇分享它
  （例如透過「檔案」App）。本 App 不會將匯出檔傳送至任何地方。

- **本 App 不會將任何資料傳送至開發者控制的任何伺服器。** 本 App 沒有
  分析、Crash 回報、廣告 SDK，也沒有任何第三方網路程式碼，更不會發出任何
  將您資料帶離裝置的網路請求。

### 第三方服務

本 App **未整合** 以下任何服務：Google Analytics、Amplitude、Sentry、
Firebase、PostHog、Mixpanel、Segment、廣告聯播網，或任何其他第三方分析、
遙測、歸因或廣告服務。唯一涉及的外部系統是 Apple 自家的 HealthKit（在您
裝置上、經您授權）與 Apple 的 iCloud（您自己的帳號，且僅在您啟用備份時）。

### 追蹤

本 App **不會** 跨其他公司的 App、跨網站追蹤您。App 隱私資訊清單
（`PrivacyInfo.xcprivacy`）中的 `NSPrivacyTracking` 旗標為 `false`，且本
App 不使用廣告識別碼（IDFA）或任何跨 App 識別碼。

### 您的選擇與控制權

- 您可隨時於 iOS/watchOS 設定中拒絕或撤銷 HealthKit 存取。
- 您可於 App 設定中停用 iCloud 備份，並透過「檔案」App 刪除既有備份。
- 您可透過刪除 App 來刪除您的所有資料（本機資料會隨 App 沙盒一併移除）；
  iCloud 備份可另於「檔案」App 中移除。

### 兒童

本 App 並非以 13 歲以下兒童為對象，亦不會主動蒐集兒童資料。（由於本 App
完全不會代開發者蒐集任何資料，故沒有任何兒童資料會到達開發者手中。）

### 政策變更

若本 App 處理資料的方式變更，本政策將同步更新並修訂下方的「生效日期」。
App Store Connect 規定公開的隱私政策內容必須與當前出貨版本的行為一致。

### 聯絡方式

如有疑問請聯絡 `lisonchang80@gmail.com`。

**生效日期**：`[EFFECTIVE DATE]`
**發布網址**：`[HOSTED POLICY URL]`
