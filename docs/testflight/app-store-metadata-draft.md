# App Store Connect Metadata — Draft

> **STATUS: DRAFT — refreshed 2026-06-13** (was 2026-05-26; predated slice 15
> iCloud backup, slice 15b JSON export, and the recent Watch live-workout work).
> Review-first copy for the App Record in App Store Connect. The user fills the
> actual values + makes the `[PLACEHOLDER]` decisions; nothing here is published
> externally by the agent. Bilingual zh-Hant (primary) + en-US (secondary).
>
> **Cross-links:**
> - [`submission-readiness-2026-06-13.md`](./submission-readiness-2026-06-13.md) — current blocker/punch-list (supersedes the 2026-06-03 scorecard).
> - [`build-bump.md`](./build-bump.md) — build-number bump + pre-archive checklist (`ITMS-90478`).
> - [`icon-spec.md`](./icon-spec.md) — iOS AppIcon size table + `gen-ios-icons.sh`.
> - `submission-questionnaire.md` — ASC submission-time answers; **arrives on `chore/appstore-watch-readiness`** (not yet on main; see readiness doc).
> - Privacy Policy + App Privacy questionnaire docs — owned by a parallel agent; do not duplicate here.

---

## Identity (cross-locale)

| Field             | Value                                                          |
|-------------------|----------------------------------------------------------------|
| Bundle ID         | `com.lisonchang.TrainingLog`                                   |
| SKU               | `traininglog-001` (suggested — must be unique per dev account) |
| Apple Team        | `XQTU89U2J2`                                                   |
| Primary Language  | Chinese (Traditional) — `zh-Hant`                              |
| Primary Category  | Health & Fitness                                               |
| Secondary Category| `[PLACEHOLDER]` — suggest **Sports** or **Lifestyle** (user picks) |
| `LSApplicationCategoryType` (binary) | `public.app-category.healthcare-fitness` (lands with `chore/appstore-watch-readiness` merge) |
| Age Rating        | 4+ (no objectionable content; HealthKit data is health-info, not "medical/treatment" — answer the ASC age questionnaire "None" across all categories) |
| Pricing           | Free                                                           |
| Availability      | `[PLACEHOLDER]` — Taiwan-only day 1 vs worldwide               |
| Marketing version | 1.0.0 (host `Info.plist`/`project.pbxproj`/`app.json` agree; Watch `1.0` fix lands with the branch merge) |

---

## Localised — Chinese (Traditional, `zh-Hant`) — PRIMARY

### App Name (≤30 chars)

```
TrainingLog 訓練誌
```
*(15 chars. Alt if pure-EN preferred everywhere: `TrainingLog`.)*

### Subtitle (≤30 chars)

```
離線重訓紀錄 × Apple Watch
```
*(18 chars.)*

### Promotional Text (≤170 chars — editable anytime without re-review)

```
全離線、無帳號、無廣告的重訓日誌。手腕開練、即時心率與消耗熱量、組數一鍵記錄；iCloud 自動備份，資料永遠是你的。
```
*(≈60 chars.)*

### Keywords (≤100 chars, comma-separated, NO spaces after commas — spaces count)

```
重訓,健身,訓練紀錄,健身房,啞鈴,槓鈴,組數,次數,RPE,計畫,課表,超級組,遞減組,PR,離線
```
*(≈73 chars. "Apple Watch"/"HealthKit" intentionally omitted here — Apple
auto-indexes the app name + category; spend keyword bytes on terms the title/
subtitle don't already carry. `[PLACEHOLDER]` — confirm keyword strategy.)*

### Description (full — ≤4000 chars)

```
TrainingLog 訓練誌是一款專注、全離線的重量訓練日誌。所有資料只存在你的 iPhone 本機，沒有帳號、沒有伺服器、沒有廣告、沒有任何第三方追蹤。

▍記錄你的每一組
為增肌與力量訓練打造的記錄體驗：每組的重量、次數、RPE 一次到位。支援熱身組、遞減組（dropset 群組）、超級組（superset），複雜的訓練編排也能忠實呈現。

▍計畫與可重用模板
建立訓練計畫與可重用模板，並為同一模板設定不同的強度變體（intensity variants），讓週期化訓練快速開練、不必每次重建。

▍歷史、圖表、PR 與成就
月曆與列表雙視圖回顧過往訓練；動作歷史頁與趨勢圖表追蹤進步；自動偵測個人紀錄（PR）與 e1RM；解鎖成就，讓累積看得見。

▍Apple Watch 隨身開練
直接從手腕開始訓練：即時心率、主動與靜止消耗熱量（透過 HealthKit 即時 workout）、手錶端逐組記錄、完成後即時統計。手錶與 iPhone 雙向同步。

▍HealthKit 整合
可選擇授權讀取心率與消耗熱量用於訓練統計；訓練完成後可將 workout 寫回「健康」與「體能訓練」App。所有 HealthKit 存取皆為選用，首次進入時才會請求授權。

▍身體數據
記錄體重等身體指標，與訓練一起觀察長期變化。

▍iCloud 備份與資料匯出
整個資料庫自動備份到你自己的 iCloud Drive（保留最近兩份），裝置遺失或更換時可一鍵還原。也可隨時將資料匯出為 JSON，完全掌握自己的資料。

▍深色模式與雙語
支援淺色／深色／跟隨系統主題，介面提供繁體中文與英文。

TrainingLog 不收集你的任何資料——它只是一本屬於你的訓練筆記。
```
*(Verify the dropset/superset/variants/achievement/PR wording matches the
shipped UI before submit — grounded in CLAUDE.md + reports 07/08, not the
running app.)*

### What's New / Release Notes — v1.0.0 (zh-Hant)

```
TrainingLog 訓練誌 1.0.0 首次發行：
• 重訓記錄：組數／次數／重量／RPE，支援熱身、遞減組、超級組
• 計畫與可重用模板（含強度變體）
• 歷史月曆、趨勢圖表、PR 與成就追蹤
• Apple Watch：手腕開練、即時心率與消耗熱量、逐組記錄
• HealthKit 整合（選用授權）
• iCloud Drive 自動備份／還原、JSON 資料匯出
• 深色模式、繁中／英文
全程離線、無帳號、無廣告。
```

---

## Localised — English (US, `en-US`) — SECONDARY

### App Name (≤30 chars)

```
TrainingLog
```

### Subtitle (≤30 chars)

```
Offline lifting log + Watch
```
*(27 chars.)*

### Promotional Text (≤170 chars)

```
A fully offline weight-training log. No account, no ads, no tracking. Start from your wrist with live heart rate & calories, and auto-back up to your own iCloud.
```
*(≈160 chars.)*

### Keywords (≤100 chars, comma-separated, NO spaces)

```
weightlifting,workout log,gym,strength,dumbbell,barbell,sets,reps,RPE,program,template,superset,dropset,PR,offline
```
*(≈110 chars — TRIM to ≤100 before submit; drop e.g. "dropset" or "PR". `[PLACEHOLDER]` confirm.)*

### Description (full — ≤4000 chars)

```
TrainingLog is a focused, fully offline weight-training journal. Everything lives only on your iPhone — no account, no server, no ads, and no third-party tracking.

▍Log every set
Built for hypertrophy and strength work: capture weight, reps, and RPE per set. Supports warmup sets, dropset clusters, and supersets, so even complex programming is logged faithfully.

▍Programs & reusable templates
Build training programs and reusable templates, and attach multiple intensity variants to the same template so periodized training starts fast — no rebuilding each session.

▍History, charts, PRs & achievements
Review past training in calendar or list view; track progress with per-exercise history and trend charts; automatic personal-record (PR) and e1RM detection; unlock achievements as the work adds up.

▍Train from your Apple Watch
Start a workout right from your wrist: live heart rate, active and basal calories (via a HealthKit live workout), on-wrist per-set logging, and instant finish stats. Two-way sync with your iPhone.

▍HealthKit integration
Optionally grant read access to heart rate and energy for training stats; after a session you can write the workout back to Health / Fitness. All HealthKit access is optional and requested only when you first need it.

▍Body metrics
Log body weight and other metrics alongside your training to watch long-term change.

▍iCloud backup & data export
The whole database auto-backs up to your own iCloud Drive (keeping the latest two), so you can restore in one tap on a new or lost device. Export your data to JSON anytime — your data is always yours.

▍Dark mode & bilingual
Light / dark / follow-system themes, with Traditional Chinese and English interfaces.

TrainingLog collects nothing about you — it's just your training notebook, kept private.
```

### What's New / Release Notes — v1.0.0 (en-US)

```
TrainingLog 1.0.0 — first release:
• Log sets/reps/weight/RPE with warmup, dropset & superset support
• Programs and reusable templates with intensity variants
• History calendar, trend charts, PR & achievement tracking
• Apple Watch: start from the wrist, live HR & calories, per-set logging
• HealthKit integration (optional)
• iCloud Drive auto-backup/restore + JSON data export
• Dark mode, English / Traditional Chinese
Fully offline. No account. No ads.
```

---

## Shared URLs

| Field              | Value |
|--------------------|-------|
| Support URL        | `[PLACEHOLDER]` — required by ASC. Candidate: `https://github.com/lisonchang80/TrainingLog` (public repo issues), or a GitHub Pages support page. Must be a reachable page, not a bare repo if private. |
| Marketing URL      | `[PLACEHOLDER]` — optional; leave blank or a GitHub Pages landing page. |
| Privacy Policy URL | `[PLACEHOLDER]` — **required (HealthKit + App Store)**. Publish the privacy-policy doc (owned by the parallel agent) to a reachable URL (GitHub Pages on the existing repo is the contemplated path), then paste here. |

---

## App Review Information

| Field                  | Draft value |
|------------------------|-------------|
| Sign-in required?      | No — the app has no login; everything is local/offline. |
| Demo Account           | N/A (no account). |
| Notes for reviewer     | `本 App 為個人重訓紀錄工具，全離線，所有資料儲存於裝置本機 SQLite。HealthKit 為選用功能（讀取心率／消耗熱量供訓練統計、可選擇將 workout 寫回「健康」App），首次進入訓練 session 才請求授權。iCloud Drive 備份寫入使用者自己的 iCloud 容器（非開發者伺服器）；可匯出 JSON 至本機。無第三方追蹤、無分析、無廣告、無任何網路傳輸。Apple Watch 為隨附 target，可從手腕開練並即時顯示心率／熱量。` |
| Contact First / Last   | `[PLACEHOLDER]` — user fills. |
| Contact Phone          | `[PLACEHOLDER]` — user fills. |
| Contact Email          | `lisonchang80@gmail.com` |

---

## TestFlight-specific fields

| Field                    | Draft value |
|--------------------------|-------------|
| Beta App Description     | Short version of the App Store description (first 2–3 ▍sections). |
| Beta App Feedback Email  | `lisonchang80@gmail.com` |
| What to Test (per build) | `[PLACEHOLDER]` per build — for the first 1.0.0 archive, emphasize: iCloud backup/restore (never run on device), Apple Watch live-workout finish stats, JSON export. |
| Demo Account / Sign-in   | N/A — no login, fully offline. |
| Contact First/Last/Phone | `[PLACEHOLDER]` — user fills. |

---

## Screenshots — `[PLACEHOLDER]` (NOT captured)

iOS 17+ accepts a single 6.5" or 6.7"/6.9" iPhone size class. Min 3, max 10 per
locale. Suggested set (capture AFTER the Watch icon ships + on seeded demo data —
empty screens look bad):

1. Active session — set logger with a cluster / dropset
2. Home / today overview
3. History calendar (filled month)
4. Trend chart / PR for an exercise
5. Programs + templates grid
6. Apple Watch — live workout (HR + calories) or finish stats
7. Settings — theme picker + iCloud backup status
8. (Optional) Fitness app cell showing a TrainingLog workout (HealthKit write proof)

Capture command (simulator, iPhone 16 Pro Max 6.9"):

```bash
xcrun simctl io booted screenshot ~/Desktop/tl-shot-$(date +%H%M%S).png
```

> Apple Watch screenshots have their own size class if you want a Watch
> screenshot set — optional for v1.

---

## Open decisions (`[PLACEHOLDER]` — user must resolve before submit)

1. **App name** — `TrainingLog 訓練誌` (zh) + `TrainingLog` (en) vs pure-English in both locales.
2. **Secondary category** — Sports vs Lifestyle.
3. **Availability** — Taiwan-only day 1 vs worldwide.
4. **Support URL** + **Marketing URL** — exact reachable pages.
5. **Privacy Policy URL** — where the parallel-agent privacy doc gets published.
6. **Keyword final cut** — both locales must end ≤100 chars (en-US list above is currently ~110, trim).
7. **Screenshots** — capture + (optional) Watch screenshot set.
8. **External tester cohort** — who beyond the developer.
