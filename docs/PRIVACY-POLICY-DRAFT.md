# Privacy Policy / 隱私政策

> **STATUS: DRAFT — 2026-05-27**
> This document is a working draft prepared during TestFlight readiness
> work. Review, edit, and publish (e.g. via GitHub Pages or Notion) before
> submitting the App Store Connect Privacy Policy URL. The published URL
> must be public, stable, and reflect the build that is shipping.

---

## English

### About TrainingLog

TrainingLog ("the App") is an iOS application for personal weight-training
log keeping. It is developed and maintained by Lison Chang
(`lisonchang80@gmail.com`).

### What data the App collects

The App stores the following information **locally on your device**:

- Training records you enter manually: exercise name, sets, reps, weight,
  RPE, notes, and timestamps.
- Workout sessions, programs, and template definitions you create.
- App preferences (theme, units, etc.).

The App reads the following from Apple's HealthKit framework, **only with
your explicit permission**:

- Heart rate samples recorded during your training sessions (typically by
  Apple Watch).
- Active energy burned during training sessions.

The App writes the following back to HealthKit, **only with your explicit
permission**:

- Workout records (HKWorkout) representing the strength-training sessions
  you complete, so they appear in Apple's Fitness app alongside cardio
  workouts.

### Where the data goes

- **All training data stays on your device** in a local SQLite database.
- **HealthKit data is read on-device** and is never copied off the device
  by the App. HealthKit access requires your explicit grant via the system
  permission dialog, and you can revoke it any time in Settings → Privacy
  → Health.
- **HKWorkout records are written to your own Health app**, where they
  remain under your control like any other Health app data.
- **No data is sent to any server controlled by the developer.** The App
  does not include analytics, crash reporters, advertising SDKs, or any
  third-party network code.

### Third-party services

The App does **not** integrate any of the following: Google Analytics,
Amplitude, Sentry, Firebase, PostHog, Mixpanel, Segment, or any other
third-party analytics, telemetry, or advertising service.

### Tracking

The App does **not** track you across other apps or websites. The
`NSPrivacyTracking` flag in `PrivacyInfo.xcprivacy` is set to `false`.

### Children

The App is not directed to children under 13. It does not knowingly
collect any data from children.

### Changes to this policy

If the App's data handling changes (for example, when iCloud Drive backup
is added in a future release), this policy will be updated and the
"effective date" below will be revised. App Store Connect requires the
published Privacy Policy to match the behaviour of the current build.

### Contact

For questions about this policy, contact `lisonchang80@gmail.com`.

**Effective date**: (to be filled in on publish)

---

## 繁體中文

### 關於 TrainingLog

TrainingLog（以下簡稱「本 App」）是一款 iOS 上的個人重量訓練紀錄 App，
由 Lison Chang（`lisonchang80@gmail.com`）開發與維護。

### 本 App 蒐集的資料

本 App 在 **您裝置本機** 儲存以下資料：

- 您手動輸入的訓練紀錄：動作名稱、組數、次數、重量、RPE、備註、時間戳記。
- 您建立的訓練 session、訓練計畫（program）、模板（template）。
- App 偏好設定（主題、單位等）。

本 App 在取得您 **明確授權後**，會從 Apple HealthKit 讀取：

- 訓練期間的心率樣本（通常由 Apple Watch 紀錄）。
- 訓練期間的主動消耗熱量。

本 App 在取得您 **明確授權後**，會寫入 HealthKit：

- 重量訓練 Workout 紀錄（HKWorkout），讓您的訓練 session 與其他有氧運動
  並列出現在 Apple Fitness App 中。

### 資料儲存位置

- **所有訓練資料皆儲存於您裝置本機** 的 SQLite 資料庫。
- **HealthKit 資料於裝置本機讀取** ，本 App 不會將 HealthKit 資料複製到
  裝置以外。HealthKit 存取需要您透過系統權限對話框明確授權，您可隨時於
  「設定 → 隱私權與安全性 → 健康」中撤銷。
- **HKWorkout 紀錄寫入您自己的「健康」App**，仍由您完全掌控，與其他健康
  資料相同。
- **本 App 不會將任何資料傳送至開發者控制的任何伺服器。** 本 App 沒有
  分析、Crash 回報、廣告 SDK，也沒有任何第三方網路程式碼。

### 第三方服務

本 App **未整合** 以下任何服務：Google Analytics、Amplitude、Sentry、
Firebase、PostHog、Mixpanel、Segment、或任何其他第三方分析、遙測或
廣告服務。

### 追蹤

本 App **不會** 跨 App、跨網站追蹤您。`PrivacyInfo.xcprivacy` 中的
`NSPrivacyTracking` 旗標為 `false`。

### 兒童

本 App 並非以 13 歲以下兒童為對象，亦不會主動蒐集兒童資料。

### 政策變更

若本 App 處理資料的方式變更（例如未來版本加入 iCloud Drive 備份功能），
本政策將同步更新並修訂下方的「生效日期」。App Store Connect 規定公開的
隱私政策內容必須與當前出貨版本的行為一致。

### 聯絡方式

如有疑問請聯絡 `lisonchang80@gmail.com`。

**生效日期**：（發布時填入）
