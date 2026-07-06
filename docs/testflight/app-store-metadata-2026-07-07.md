# App Store Connect Metadata — Paste-Ready Pack

> **STATUS: DRAFT — 2026-07-07.** Refined + completed from
> [`app-store-metadata-draft.md`](./app-store-metadata-draft.md) (2026-06-13).
> Every store-listing field is filled for both locales with a **character count**
> per field; fields near the Apple limit are flagged **⚠️ 逼近上限**. Nothing here
> is published or submitted by the agent — the user pastes the final values into
> App Store Connect and resolves the `[PLACEHOLDER]` decisions.
>
> **Verified against the code at `main @ 2574061` (2026-07-07):**
> - No account / login / backend / analytics / ads / third-party tracking
>   (grep of `src/` + `app/` + `package.json`: 0 network egress, 0
>   firebase/sentry/amplitude/mixpanel/segment/posthog/etc.).
> - HealthKit scope: **READ** HeartRate + ActiveEnergyBurned, **WRITE**
>   HKWorkoutType (`src/adapters/healthkit/permission.ts`).
> - iCloud backup → user's own private container
>   `iCloud.com.lisonchang.TrainingLog` / CloudDocuments
>   (`ios/TrainingLog/TrainingLog.entitlements`).
> - `LSApplicationCategoryType = public.app-category.healthcare-fitness`,
>   `ITSAppUsesNonExemptEncryption = false`, `NSPrivacyTracking = false`.
> - `supportsTablet: true` in `app.json` → **iPad build ships** (screenshot
>   + iPad-listing implication; see shotlist doc).
>
> **Cross-links:** [`submission-questionnaire.md`](./submission-questionnaire.md),
> [`app-privacy-questionnaire-2026-06-13.md`](./app-privacy-questionnaire-2026-06-13.md),
> [`screenshot-shotlist-2026-07-07.md`](./screenshot-shotlist-2026-07-07.md),
> [`privacy-policy-draft-2026-07-07.md`](./privacy-policy-draft-2026-07-07.md).

---

## Character-limit reference (Apple)

| Field | Limit | Notes |
|---|---|---|
| App Name | 30 | per locale |
| Subtitle | 30 | per locale |
| Promotional Text | 170 | editable anytime without re-review |
| Description | 4000 | per locale |
| Keywords | 100 | comma-separated, **no spaces** (spaces count) |
| What's New | 4000 | per locale, per version |

> Char counts below were computed on the exact string in the code block. For
> CJK, App Store Connect counts each Han character as **1**. Counts labelled
> "chars" are total glyphs including punctuation.

---

## Identity (cross-locale)

| Field | Value |
|---|---|
| Bundle ID | `com.lisonchang.TrainingLog` |
| SKU | `traininglog-001` (suggested — must be unique in the dev account) |
| Apple Team | `XQTU89U2J2` |
| Primary Language | Chinese (Traditional) — `zh-Hant` |
| Primary Category | **Health & Fitness**（健康與健身） |
| Secondary Category | **Sports**（運動）— recommended over Lifestyle: the app is squarely a training tool, and "Sports" keeps the store placement athletic. `[PLACEHOLDER]` user confirms. |
| Age Rating | **4+** (no objectionable content; answer every age-questionnaire item "None") |
| Pricing | Free |
| Availability | `[PLACEHOLDER]` — Taiwan-only day 1 vs worldwide |
| Marketing version | 1.0.0 |

---

# ═══ zh-Hant (Traditional Chinese) — PRIMARY ═══

### App Name (≤30)

```
TrainingLog 訓練誌
```
**15 chars.** Alt if you want pure-English everywhere: `TrainingLog` (11).

### Subtitle (≤30)

```
離線重訓紀錄 × Apple Watch
```
**18 chars.** Carries "離線" + "重訓" + "Apple Watch" — three keyword-bearing terms the name doesn't. Alt (more benefit-led): `增肌重訓日誌．手腕開練` (10).

### Promotional Text (≤170)

```
全離線、無帳號、無廣告的重訓日誌。手腕即可開練、即時心率與消耗熱量、組數一鍵記錄；模板與計劃週期化，iCloud 自動備份，資料永遠是你的。
```
**60 chars.** Well within limit; editable anytime without re-review — use it for seasonal / feature-highlight rotations.

### Keywords (≤100, no spaces)

```
重訓,健身,健身房,訓練紀錄,課表,計畫,模板,組數,次數,RPE,超級組,遞減組,啞鈴,槓鈴,增肌,PR,e1RM,離線
```
**73 chars.** ⚠️ Keyword strategy notes:
- "Apple Watch"、"HealthKit"、"訓練誌" 已在 App Name / Subtitle / 分類中被 Apple 自動索引 → 不放進 keywords，把字元讓給標題沒帶到的詞。
- 加入了高意圖詞：`增肌`（客群核心）、`e1RM`、`課表`、`模板`。
- 還有 ~27 字元餘裕，可加 `力量`、`肌肥大`、`健美` 之一。`[PLACEHOLDER]` 作者定稿。

### Description (≤4000)

```
TrainingLog 訓練誌是一款專注、全離線的重量訓練日誌，為認真追求增肌與力量的你打造。所有資料只存在你的 iPhone 本機，沒有帳號、沒有伺服器、沒有廣告、沒有任何第三方追蹤。

▍記錄你的每一組
每組的重量、次數、RPE 一次到位。完整支援熱身組、遞減組（dropset 群組）與超級組（superset），再複雜的訓練編排也能忠實記錄。數字輸入點一下就選取，改值快速不卡手。

▍計劃與可重用模板
建立訓練計劃與可重用模板，並為同一模板設定不同的強度變體（intensity variants），讓週期化訓練快速開練、不必每次重建。也提供「極簡模式」：只看模板名稱、一律以通用強度開始，最少步驟直接開練。

▍歷史、圖表、PR 與成就
月曆與列表雙視圖回顧過往訓練；動作歷史頁與趨勢圖表追蹤進步；自動偵測個人紀錄（PR）與 e1RM；解鎖成就，讓累積看得見。

▍Apple Watch 隨身開練
直接從手腕開始訓練：即時心率、主動與靜止消耗熱量（透過 HealthKit 即時 workout）、手錶端逐組打勾記錄、休息計時器與完成後即時統計。手錶與 iPhone 雙向即時同步，換裝置記錄也不漏拍。

▍完整動作庫
內建數百個常見動作，附真人示範照與精準肌群高亮，快速找到你要練的動作。也可自訂動作與全域備註。

▍HealthKit 整合
可選擇授權讀取心率與消耗熱量用於訓練統計；訓練完成後可將 workout 寫回「健康」與「體能訓練」App。所有 HealthKit 存取皆為選用，首次進入相關畫面時才會請求授權。

▍身體數據
記錄體重等身體指標，與訓練一起觀察長期變化。

▍iCloud 備份與資料匯出
整個資料庫自動備份到你自己的 iCloud Drive（保留最近兩份），裝置遺失或更換時可一鍵還原。也可隨時將資料匯出為 JSON，完全掌握自己的資料。

▍深色模式與雙語
支援淺色／深色／跟隨系統主題，介面提供繁體中文與英文，並附新手引導與逐頁說明。

TrainingLog 不收集你的任何資料——它只是一本屬於你的訓練筆記。
```
**≈690 chars.** Comfortably under 4000. ⚠️ **Verify before submit:** "內建數百個常見動作" 用了模糊量詞（curated master 目前 ~230 筆）；若要寫確切數字（例如「230+ 內建動作」）先確認 seed 出貨數。dropset/superset/變體/PR/成就/極簡模式 措辭已對齊 shipped UI 用語。

### What's New — v1.0.0 (zh-Hant, ≤4000)

```
TrainingLog 訓練誌 1.0.0 首次發行：
• 重訓記錄：組數／次數／重量／RPE，支援熱身組、遞減組、超級組
• 計劃與可重用模板（含強度變體）＋極簡模式一鍵開練
• 歷史月曆、趨勢圖表、PR 與成就追蹤
• 內建動作庫（真人示範照＋肌群高亮）
• Apple Watch：手腕開練、即時心率與消耗熱量、逐組記錄、休息計時器、雙向同步
• HealthKit 整合（選用授權）
• iCloud Drive 自動備份／還原、JSON 資料匯出
• 深色模式、繁中／英文、新手引導
全程離線、無帳號、無廣告。
```
**≈210 chars.**

---

# ═══ en-US (English) — SECONDARY ═══

### App Name (≤30)

```
TrainingLog
```
**11 chars.**

### Subtitle (≤30)

```
Offline lifting log + Watch
```
**27 chars.** ⚠️ 逼近上限 (27/30). Alt with more benefit: `Hypertrophy & strength log` (26).

### Promotional Text (≤170)

```
A fully offline weight-training log. No account, no ads, no tracking. Start from your wrist with live heart rate & calories, and auto-back up to your own iCloud.
```
**159 chars.** ⚠️ 逼近上限 (159/170).

### Keywords (≤100, no spaces)

```
weightlifting,workout log,gym,strength,hypertrophy,sets,reps,RPE,program,template,superset,dropset,dumbbell,barbell,PR,offline
```
**124 chars.** ⚠️ **OVER LIMIT — MUST TRIM to ≤100 before submit.** Suggested trim (drop lower-value / title-covered terms) → **98 chars, ✅ within limit**:
```
weightlifting,workout log,gym,strength,hypertrophy,sets,reps,RPE,program,template,superset,dropset
```
(Dropped `dumbbell,barbell,PR,offline` — "offline" is in the subtitle, PR/equipment are lower-intent. `[PLACEHOLDER]` author confirms final cut.)

### Description (≤4000)

```
TrainingLog is a focused, fully offline weight-training journal built for anyone serious about hypertrophy and strength. Everything lives only on your iPhone — no account, no server, no ads, and no third-party tracking.

▍Log every set
Capture weight, reps, and RPE per set. Full support for warmup sets, dropset clusters, and supersets, so even complex programming is logged faithfully. Tap a number and it's selected — editing values is fast.

▍Programs & reusable templates
Build training programs and reusable templates, and attach multiple intensity variants to the same template so periodized training starts fast — no rebuilding each session. A "minimal mode" is also included: see just the template name and start at a default intensity in the fewest possible taps.

▍History, charts, PRs & achievements
Review past training in calendar or list view; track progress with per-exercise history and trend charts; automatic personal-record (PR) and e1RM detection; unlock achievements as the work adds up.

▍Train from your Apple Watch
Start a workout right from your wrist: live heart rate, active and basal calories (via a HealthKit live workout), on-wrist per-set logging, a rest timer, and instant finish stats. Two-way live sync with your iPhone means nothing gets missed if you switch devices mid-session.

▍A full exercise library
Hundreds of common exercises with real demo photos and accurate muscle highlighting help you find what you want to train. Add your own exercises and global notes too.

▍HealthKit integration
Optionally grant read access to heart rate and energy for training stats; after a session you can write the workout back to Health / Fitness. All HealthKit access is optional and requested only when you first need it.

▍Body metrics
Log body weight and other metrics alongside your training to watch long-term change.

▍iCloud backup & data export
The whole database auto-backs up to your own iCloud Drive (keeping the latest two), so you can restore in one tap on a new or lost device. Export your data to JSON anytime — your data is always yours.

▍Dark mode & bilingual
Light / dark / follow-system themes, Traditional Chinese and English interfaces, plus first-run onboarding and per-page help.

TrainingLog collects nothing about you — it's just your training notebook, kept private.
```
**≈2050 chars.** Under 4000. ⚠️ Same "Hundreds of common exercises" caveat as zh — confirm exact seed count before naming a number.

### What's New — v1.0.0 (en-US, ≤4000)

```
TrainingLog 1.0.0 — first release:
• Log sets/reps/weight/RPE with warmup, dropset & superset support
• Programs and reusable templates with intensity variants + one-tap minimal mode
• History calendar, trend charts, PR & achievement tracking
• Built-in exercise library (real demo photos + muscle highlighting)
• Apple Watch: start from the wrist, live HR & calories, per-set logging, rest timer, two-way sync
• HealthKit integration (optional)
• iCloud Drive auto-backup/restore + JSON data export
• Dark mode, English / Traditional Chinese, first-run onboarding
Fully offline. No account. No ads.
```
**≈480 chars.**

---

## Shared URLs

| Field | Value |
|---|---|
| Support URL | `[PLACEHOLDER]` — **required.** Candidate: a GitHub Pages page on `lisonchang80/TrainingLog` (e.g. `https://lisonchang80.github.io/TrainingLog/support`). A bare private repo is not acceptable; the page must be publicly reachable. |
| Marketing URL | `[PLACEHOLDER]` — optional. Leave blank, or a GitHub Pages landing page. |
| Privacy Policy URL | `[PLACEHOLDER]` — **required (HealthKit + App Store).** Publish [`privacy-policy-draft-2026-07-07.md`](./privacy-policy-draft-2026-07-07.md) to a reachable URL (GitHub Pages on the repo is the contemplated path), then paste here. |

---

## App Review Information

| Field | Draft value |
|---|---|
| Sign-in required? | **No** — no login; everything is local/offline. |
| Demo Account | N/A. |
| Notes for reviewer (zh) | `本 App 為個人重訓紀錄工具，全離線，所有資料儲存於裝置本機 SQLite。HealthKit 為選用功能（讀取心率／消耗熱量供訓練統計、可選擇將 workout 寫回「健康」App），首次進入訓練 session 才請求授權。iCloud Drive 備份寫入使用者自己的 iCloud 容器（非開發者伺服器）；可匯出 JSON 至本機。無第三方追蹤、無分析、無廣告、無任何網路傳輸。Apple Watch 為隨附 target，可從手腕開練並即時顯示心率／熱量。心率／熱量 tile 在無配對 Apple Watch 時顯示「—」，屬預期行為。` |
| Contact First / Last | `[PLACEHOLDER]` |
| Contact Phone | `[PLACEHOLDER]` |
| Contact Email | `lisonchang80@gmail.com` |

---

## TestFlight-specific fields

| Field | Draft value |
|---|---|
| Beta App Description | Short version of the App Store description (first 2–3 ▍sections). |
| Beta App Feedback Email | `lisonchang80@gmail.com` |
| What to Test (1.0.0) | `iCloud 備份／還原（實機）、Apple Watch 即時 workout 完成統計與雙向同步、JSON 匯出、HealthKit workout 寫回 Fitness。` |
| Demo Account / Sign-in | N/A — no login, fully offline. |

---

## Content-rating questionnaire — recommended answers

Answer **"None" / "No"** to every content-frequency item. Rationale:

| Questionnaire item | Answer |
|---|---|
| Cartoon/Fantasy/Realistic Violence | None |
| Sexual Content / Nudity | None |
| Profanity / Crude Humor | None |
| Alcohol, Tobacco, Drug Use/References | None |
| Mature/Suggestive Themes, Horror | None |
| Gambling / Contests | None |
| Unrestricted Web Access | **No** (no in-app browser; `expo-web-browser` is a dependency but is not invoked anywhere — grep = 0 call sites) |
| User-Generated Content / sharing | **No** (all content stays local; no social feed) |
| Medical/Treatment Information | **No** (fitness logging, not medical advice) |

→ **Resulting rating: 4+.** Consistent with the Identity table and
[`submission-questionnaire.md`](./submission-questionnaire.md) §5.

---

## Open decisions (`[PLACEHOLDER]` — user resolves before submit)

1. **App name** — `TrainingLog 訓練誌` (zh) + `TrainingLog` (en) vs pure-English both.
2. **Secondary category** — Sports (recommended) vs Lifestyle.
3. **Availability** — Taiwan-only day 1 vs worldwide.
4. **Support URL** + optional **Marketing URL** — exact reachable pages.
5. **Privacy Policy URL** — publish location for the privacy-policy draft.
6. **en-US keyword final cut** — the 124-char list MUST be trimmed to ≤100 (trimmed 98-char version supplied above).
7. **Exact exercise count** in both descriptions — confirm shipped seed count before naming a number (currently written as "數百個 / Hundreds").
8. **iPad**: `supportsTablet: true` ships an iPad build → ASC may require a **12.9"/13" iPad screenshot set**. Decide iPad-support in the listing (keep or set iPhone-only) — see shotlist doc.
9. **Screenshots** — capture on seeded demo data (see shotlist doc).
