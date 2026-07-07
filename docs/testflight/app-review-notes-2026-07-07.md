# App Store Connect — App Review Notes & Reviewer Test Guide

> **STATUS: DRAFT — 2026-07-07.** Paste-ready material for the App Store
> Connect **App Review Information** panel (the "Notes" free-text box, the
> Sign-In / Demo-account fields) plus the **Export Compliance** answer.
> Every claim is grounded in the code at main `@2574061`; the English blocks
> in §A / §B / §C / §D are the ones to paste into ASC. The Chinese sections
> are author-facing context, **not** for ASC.
>
> Sibling docs (do not duplicate):
> - App Privacy "nutrition label" answers →
>   [`app-privacy-questionnaire-2026-06-13.md`](./app-privacy-questionnaire-2026-06-13.md)
> - Submission-time questionnaire (age rating, account-deletion, flow order) →
>   [`submission-questionnaire.md`](./submission-questionnaire.md)
> - Store-listing text (name / subtitle / keywords / description) →
>   `app-store-metadata-2026-07-07.md`
>
> **Why this doc exists:** HealthKit + Apple Watch apps are frequently
> rejected not on merit but because the reviewer — who usually has **only an
> iPhone, no paired Apple Watch** — cannot figure out how to exercise the
> features. This doc gives the reviewer an explicit iPhone-only test path and
> honestly flags what needs a physical Watch.

---

## 驗證基礎（2026-07-07 對 main @2574061 重新 grep）

| 主張 | 佐證來源 | 驗到的值 |
|---|---|---|
| 無帳號 / 無登入 / 無後端 | `src/` + `app/` grep `signIn\|oauth\|login\|createAccount\|password` | **0 命中** |
| 無對外網路連線 | `src/` + `app/` grep `fetch(\|XMLHttpRequest\|WebSocket\|sendBeacon` | **0 命中**（`expo-web-browser` 有裝但 0 call site，前輪 02 已確認） |
| HealthKit scope | `src/adapters/healthkit/permission.ts` L69-79 | READ `HeartRate` + `ActiveEnergyBurned`；WRITE `HKWorkoutTypeIdentifier` |
| HK 授權觸發點 | `components/onboarding/onboarding-wizard.tsx` L157-165、`app/(tabs)/settings.tsx` L367 | ①首啟精靈第 5 步「連結 Apple Health」②設定頁手動連結 |
| Export compliance key | `ios/TrainingLog/Info.plist` L39-40 | `ITSAppUsesNonExemptEncryption = false` |
| ATS 鎖定 | `ios/TrainingLog/Info.plist` L45-46 | `NSAllowsArbitraryLoads = false` |
| App 類別 | `ios/TrainingLog/Info.plist` L7-8 | `healthcare-fitness` |
| Watch HK usage 字串 | build settings（前輪 04 報告） | `INFOPLIST_KEY_NSHealth{Share,Update}UsageDescription` 已存在、非 placeholder、非 blocker |

> ⚠️ 這些主張會隨網路碼 / SDK / HealthKit scope 改動而失效 — 每次送審前重驗。

---

## A. App Review Notes — 貼進 ASC「Notes」欄（English）

> **No account or login is required. The entire app can be tested on an
> iPhone alone; a paired Apple Watch is optional (see below).**
>
> TrainingLog is a personal weight-training logbook. All data is stored in a
> local on-device SQLite database. The app has **no user account, no
> sign-in, no server, and no back end** — nothing is transmitted off the
> device. There is therefore **no demo account to provide**; just launch the
> app and use it.
>
> **HealthKit.** On first launch an onboarding wizard offers to connect Apple
> Health on its last step (this step is optional and can be skipped). You can
> also connect later from **Settings → Apple Health**. When you tap Connect,
> iOS shows the standard Health permission sheet. The app requests:
> • **Read** Heart Rate and Active Energy Burned — to show heart-rate and
>   calorie statistics for a workout the user just performed.
> • **Write** Workouts — to save each finished session to Apple Health as a
>   functional-strength-training HKWorkout, so it appears in the Fitness app.
> All Health data stays inside Apple Health on the device; it is never sent to
> any server.
>
> **Heart-rate / calorie tiles show "—" without a Watch.** The heart-rate and
> calorie numbers on a session's detail page are populated only when an Apple
> Watch actively recorded that session. On an iPhone with no paired Watch this
> is expected — the tiles read "—". Everything else (creating templates,
> logging sets/reps/weight, history, achievements, charts, backup) works fully
> on the iPhone alone.
>
> **Apple Watch companion (optional, needs physical hardware).** The app has a
> companion watchOS app that can drive a workout from the wrist and syncs
> live, in both directions, with the iPhone over WCSession (device-to-device;
> no internet). This half **cannot be exercised without a physical Apple
> Watch paired to the test iPhone** — the Simulator cannot reproduce a live
> HKWorkoutSession or the WCSession link. The iPhone app is fully functional
> and testable on its own; the Watch companion simply mirrors/augments a
> session. If a live Watch demonstration is required, we can provide a video —
> please let us know.
>
> **No third-party analytics, ads, tracking, or crash SDKs.** The app makes no
> network calls in normal operation.

> ⚠️需作者確認：是否要主動附一段 30–60s 的 Watch 雙向同步示範影片（審核員多半無 Watch，附影片可降被「無法驗證 Watch 功能」卡關的機率）。若要，錄一段 Watch 記 set → iPhone 即時鏡像 的短片，上傳到 ASC「App Review Information → Attachment」。

---

## B. Reviewer Test Script — 貼進 ASC「Notes」欄接在 §A 之後（English）

> **How to verify the core features on an iPhone (no Watch, ~3 minutes):**
>
> **1. First launch / onboarding.** Open the app. A short wizard appears
> (Welcome → Experience → Mode → Body metrics → Connect Apple Health). You may
> tap "Skip" at any point, or step through it. On the last step, tapping
> "Connect Apple Health" brings up the iOS Health permission sheet — tap
> "Turn On All" then "Allow" so the heart-rate/calorie tiles can populate
> later. (Granting Health is optional; the app still works if you skip it.)
>
> **2. Create a workout template.** Go to the Templates tab → add a template →
> add one or two exercises from the exercise library → save. (You can also
> just start a blank session without a template — see step 3.)
>
> **3. Start a session and log sets.** From the Today/Home tab, start a
> session (from the template you made, or a blank one). For each exercise,
> enter a weight and reps for a set, then tap the checkmark to log it. Add a
> few sets. Tap "Finish" to end the session — it is saved locally, and (if you
> granted Health) written to Apple Health as a Workout, visible in the Fitness
> app.
>
> **4. Review history & achievements.** Open the History tab to see the
> finished session on the calendar / list. Open the session to see its detail
> page (heart-rate/calorie tiles will read "—" with no Watch — expected).
> Check the Achievements panel and the per-exercise history/chart pages to see
> the logged data reflected.
>
> **5. Switch app mode (optional).** Go to Settings → Mode and toggle between
> "Plan" mode and "Minimal" mode. Minimal mode hides the program/planning
> concepts for users who just want to log; Plan mode exposes them. The
> whole app re-renders live. This is a display preference — no data is lost
> either way.
>
> That covers the full iPhone feature set. The Apple Watch companion (step
> not listed) requires physical hardware as noted in the App Review Notes.

---

## C. HealthKit Purpose Explanation — 若審核詢問 HK 用途時貼（English）

> TrainingLog uses HealthKit for two purposes, matching the on-device usage
> strings the reviewer sees on the permission sheet:
>
> - **Read Heart Rate + Active Energy Burned** (`NSHealthShareUsageDescription`):
>   to display heart-rate and calorie statistics for a workout the user has
>   just performed. On Apple Watch a live `HKWorkoutSession` reads heart rate
>   during the workout.
> - **Write Workouts** (`NSHealthUpdateUsageDescription`): to save each
>   completed training session back to Apple Health as an `HKWorkout` (type:
>   functional strength training), so the session appears in the Fitness app —
>   this is the fallback path when no Apple Watch recorded the session.
>
> All Health data is read and written **on-device only**, inside the user's
> own Apple Health store. It is never transmitted to a developer server or any
> third party (the app has no server and makes no network calls). Health
> permission is requested with a clear purpose string when the user first
> chooses to connect Health (onboarding last step or Settings), never silently.

**對照 Info.plist（審核員實際看到的字串，host target）：**

- `NSHealthShareUsageDescription`:
  `TrainingLog 需要讀取 Apple Watch 訓練心率與消耗熱量、用於詳情頁統計。`
- `NSHealthUpdateUsageDescription`:
  `TrainingLog 會在無 Apple Watch 紀錄時、把訓練 session 寫入健康資料，讓 Fitness App 顯示完整訓練紀錄。`

Watch target（build settings 產出、前輪 04 已確認存在）：

- `INFOPLIST_KEY_NSHealthShareUsageDescription`:
  `TrainingLog Watch 讀取訓練心率與消耗熱量、用於本機顯示。`
- `INFOPLIST_KEY_NSHealthUpdateUsageDescription`:
  `TrainingLog Watch 不直接寫入健康資料，本鍵預留以符合 watchOS HKHealthStore API 要求。`

---

## D. Export Compliance — ASC 出口合規問卷建議答案

`ITSAppUsesNonExemptEncryption = false` is already set in
`ios/TrainingLog/Info.plist` (L39-40), so **the ASC upload flow will not
prompt** the encryption question. If the question appears anywhere:

| ASC 問句 | 建議答案 |
|---|---|
| Does your app use encryption? | **Yes**（幾乎所有 app 都經由 OS/HTTPS 用到標準加密） |
| Does your app qualify for any of the exemptions provided in Category 5, Part 2? | **Yes** |
| …限用 Apple 提供的加密 / 標準加密（HTTPS、TLS）？ | **Yes** — 只用 OS 提供的標準加密；無自訂/專有/非豁免加密演算法 |
| ITSAppUsesNonExemptEncryption | **false**（已在 Info.plist 設定） |

- **Uses non-exempt encryption? → No.**
- **Rationale:** the app implements no proprietary or non-exempt
  cryptography. It uses only standard OS-provided encryption; in practice it
  makes no network calls at all (verified: zero `fetch`/`XMLHttpRequest`/
  `WebSocket`/`sendBeacon` in `src/` + `app/`).
- **No CCATS and no annual self-classification report required.**

> 佐證：`NSAllowsArbitraryLoads = false`（ATS 鎖定）＋ 全碼零網路 egress ＋
> 無第三方 SDK ＝ 沒有任何自訂加密面。`ITSAppUsesNonExemptEncryption=false`
> 是誠實且正確的宣告。

---

## E. Demo / 測試資料建議（審核員 + 截圖共用）

App 是**全新安裝即空白**（無 seed session），下列畫面「有資料才好看」。審核員照
§B 腳本建 1 個 session 後多數畫面就會有內容；若要更豐富的截圖/展示，建 3–5 個
不同日期的 session 效果最好。

| 畫面 | 需要什麼資料才好看 | 怎麼快速建 |
|---|---|---|
| History 月曆 / 列表 | ≥1 個已完成 session；跨多日更佳 | 照 §B 步驟 3 完成 session；重覆數次改日期 |
| Session 詳情頁 | 有 logged sets 的 session | §B 步驟 3 |
| 心率 / 熱量 tiles | **需實體 Watch 記錄**（否則顯示「—」，屬預期） | 無 Watch 則接受「—」；審核 notes 已說明 |
| Achievements 面板 | 有累積量 / PR 的 session | 多完成幾組 working set |
| 動作歷史 / 圖表頁 | 同一動作跨多次 session | 同一動作重覆記 2–3 次 session |
| 動作庫 | 內建即有數百個動作（seed ~230） | 開箱即有、無需建資料 |

> 給作者：若要拍高品質截圖，建議先照 `app-store-metadata-2026-07-07.md` 的
> shot-list 建對應資料，再與審核測試資料共用同一組。

---

## F. 無需 Demo 帳號聲明（貼進 ASC Sign-In 區）

- **Sign-in required: No.**
- **Demo account: 留空 / None.** App 無帳號系統、無登入、無伺服器，沒有任何憑證需要提供。
- 對應 §A 已在 Notes 內明講「No account or login is required」。

> 出處：`app-privacy-questionnaire-2026-06-13.md` §"no sign-up, no account,
> no login" 與 `submission-questionnaire.md` §4/§6（帳號刪除要求 → 不適用，因無帳號）。

---

## 送審時填寫對應（給作者的 checklist）

1. **App Review Information → Notes**：貼 §A + §B（可再附 §C 一段或留待審核詢問時補）。
2. **App Review Information → Sign-In required**：關（No）；Demo 帳號留空（§F）。
3. **Export Compliance**：若被問，照 §D；`Info.plist` 已設 `false` 通常不會被問。
4. **HealthKit data-usage review statement**（送審時另有一欄）：貼 §C 第一段。
5. **（可選）Attachment**：若決定附 Watch 示範影片（§A ⚠️），上傳到 App Review Information 的附件欄。

---

## Open items（需作者確認）

1. ⚠️ **是否附 Watch 雙向同步示範影片**（§A）— 建議附，降 Watch 功能無法驗證的卡關風險。
2. ⚠️ **iPad 支援**：若 `supportsTablet:true`（見前輪 02 報告），ASC 可能要求 iPad 截圖；
   與本審核腳本無直接衝突，但影響送審素材完整度。
3. HK 授權「Turn On All / Allow」實機系統對話框文案為 iOS 系統產出，非本 app 控制 —
   審核腳本 §B 步驟 1 的措辭以現行 iOS 為準。
