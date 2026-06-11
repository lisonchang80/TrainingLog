---
name: watch-live-workout-stats
description: 在 Watch in-session 任一 view 顯示活的 HK 數據（HR min/max/latest、動態/靜態 kcal）— 讀 HKLiveWorkoutBuilder.statistics 的單一來源 recipe + 4 個坑（新 quantity type 要進 typesToRead 且會跳增量授權、首樣本落地延遲 10-60s 必須 "--" fallback、TabView 頁用 onAppear 刷新 vs 常駐條吃 D17 delegate 串流 @Published streamedStats、✓/組數統計必吃 LiveMirror 投影非 raw snapshot）。Trigger — "接真資料", "live HR", "kcal 累計", "D17", "HR zone Watch 顯示", "builder statistics", "心率範圍"。Files — ios/TrainingLog Watch Watch App/{SessionController,HealthKitController,FinishPageView,SetLoggerView}.swift。
---

# Watch live workout stats（HKLiveWorkoutBuilder 即時數據）

Validated 2026-06-11 — #312 FinishPage 6-tile 真資料 + HRFrozenPane 即時條，
全 device-verified（commits `42b8f84` → `38dbae2`）。

## 單一來源

`WorkoutLiveStats`（struct、Equatable：`hrMin/hrMax/hrLatest/activeKcal/
basalKcal`，全 optional、無樣本＝nil），兩條取得路徑、同一個
`computeStats(from:)` 讀法：

- **pull** — `SessionController.liveWorkoutStats()`（onAppear 型 view 用）
- **push（D17、2026-06-12）** — `@Published streamedStats`：
  `HKLiveWorkoutBuilderDelegate.workoutBuilder(_:didCollectDataOf:)`
  HR/active/basal 三型別觸發重算、**等值閘門節流**（比對相等不 assign——
  @Published struct 同值 assign 也 fire objectWillChange）；callback 在
  背景 queue → `Task { @MainActor [weak self] }` hop + `builder ===`
  擋 teardown 遲到 callback；start() / 三 teardown path 清空（新場 "--"
  到首樣本、結束不留 stale 凍結數字）。

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

D17 起常駐顯示改傳**值**不傳 closure（`liveStats:
sessionController.streamedStats`）：@Published 變動觸發持有處 re-render、
新值自然流下去，子 view 變純顯示 struct。closure threading 只留給
on-demand pull（FinishPage onAppear、history sheet）。

## 刷新策略（兩種、按 view 性質選）

| View 性質 | 策略 | 範例 |
|---|---|---|
| TabView page（滑入才看） | `.onAppear` 重查（每次滑入都 re-fire）`liveWorkoutStats()` closure | FinishPageView |
| 常駐釘選條 | **D17 delegate 串流**：`@EnvironmentObject sessionController` 持有處讀 `streamedStats`、把「值」（非 closure）下傳給純顯示 struct——@Published 變動自動 re-render | HRFrozenPane |
| ~~常駐釘選條（superseded 2026-06-12）~~ | ~~`TimelineView(.periodic(from: .now, by: 5))` 包住、每 tick 呼叫 closure~~ — D17 串流落地後砍除，勿新用 | （舊 HRFrozenPane）|

D17 ~1Hz 串流 2026-06-12 落地（branch `slice/d17-hr-streaming`）；
2026-06-11 的「降階輪詢先上」拍板已翻盤（ADR-0019 翻盤 ledger
2026-06-12 row）。

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
