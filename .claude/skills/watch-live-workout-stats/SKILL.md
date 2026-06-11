---
name: watch-live-workout-stats
description: 在 Watch in-session 任一 view 顯示活的 HK 數據（HR min/max/latest、動態/靜態 kcal）— 讀 HKLiveWorkoutBuilder.statistics 的單一來源 recipe + 4 個坑（新 quantity type 要進 typesToRead 且會跳增量授權、首樣本落地延遲 10-60s 必須 "--" fallback、TabView 頁用 onAppear 刷新 vs 常駐條用 TimelineView 輪詢、✓/組數統計必吃 LiveMirror 投影非 raw snapshot）。Trigger — "接真資料", "live HR", "kcal 累計", "D17", "HR zone Watch 顯示", "builder statistics", "心率範圍"。Files — ios/TrainingLog Watch Watch App/{SessionController,HealthKitController,FinishPageView,SetLoggerView}.swift。
---

# Watch live workout stats（HKLiveWorkoutBuilder 即時數據）

Validated 2026-06-11 — #312 FinishPage 6-tile 真資料 + HRFrozenPane 即時條，
全 device-verified（commits `42b8f84` → `38dbae2`）。

## 單一來源

`SessionController.liveWorkoutStats() -> WorkoutLiveStats`（struct：
`hrMin/hrMax/hrLatest/activeKcal/basalKcal`，全 optional、無樣本＝nil）。

- `builder.statistics(for:)` 是**本地同步便宜讀取**——每幾秒輪詢無負擔。
- HR 用 `minimumQuantity()/maximumQuantity()/mostRecentQuantity()`（單位
  `HKUnit.count().unitDivided(by: .minute())`）；能量用 `sumQuantity()`
  （`.kilocalorie()`）。
- builder 在 `start()` 的 `beginCollection` 起活到 `end()/cancel()` 的
  `discardWorkout` 為止——完成頁顯示期間 builder 還活著（session 要按
  [完成]/[放棄] 才 end），可以直接查。

## 接線 pattern（closure threading）

sheet / file-private sub-struct **不繼承 `@EnvironmentObject`** → 在
`SetLoggerView`（sessionController 所在處）建 closure 往下傳：
`liveStats: { sessionController.liveWorkoutStats() }`——與 `historyLoad`
同一 pattern。新 consumer 照抄，別在子 view 加 `@EnvironmentObject`。

## 刷新策略（兩種、按 view 性質選）

| View 性質 | 策略 | 範例 |
|---|---|---|
| TabView page（滑入才看） | `.onAppear` 重查（每次滑入都 re-fire） | FinishPageView |
| 常駐釘選條 | `TimelineView(.periodic(from: .now, by: 5))` 包住、每 tick 呼叫 closure | HRFrozenPane |

D17 真 ~1Hz 串流（`HKLiveWorkoutBuilderDelegate`）仍在 backlog；輪詢版
已夠 5s 級顯示、先上（ADR-0019 D14 § 2026-06-11 amendment 拍板降階）。

## 四個坑

1. **新 quantity type 必進 `HealthKitController.typesToRead`**，且下次
   `ensureAuthorized()` 會在 **Watch 上跳一次增量授權畫面**（既有授權不
   受影響）——user 沒按允許該欄位永遠 nil。basal 2026-06-11 就是這樣加的。
2. **首樣本落地延遲 10-60s**（watchOS 批次寫入、由加速度計+HR+健康檔案
   推算）→ 每個顯示點都要 "--" fallback；樣本落地時會回補從 start 起的
   累計、不漏算。Simulator 永遠 nil。
3. **重訓 active kcal 長得慢**是 Apple 演算法行為（只算高於基礎代謝的
   消耗、組間休息幾乎不累積）——別當 bug 修。
4. **✓ / 組數 / 動作數統計必吃 LiveMirror 投影後 snapshot**
   （`liveMirror.currentSnapshot() ?? raw`）——raw snapshot 的 `isLogged`
   永遠是開場值（✓ 活在 `SessionInteractionState` overlay）。完成頁組數
   tile 從 D14 起壞到 2026-06-11 才被抓到。見
   `watch-setlogger-overlay-gesture` skill。
