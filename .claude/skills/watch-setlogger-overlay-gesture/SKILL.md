---
name: Watch set-logger overlay mutation + in-row swipe gesture
description: 在 Watch in-session set-logger (D11 Phase D-H) 加「動作/set 的就地變更」(刪除/+1/reorder/type-cycle) 時的兩個核心 pattern — (1) 變更走 OVERLAY 疊在不可變 SessionSnapshot 上、render + live-mirror projection 兩處 filter/merge；(2) `{}` Active 列的左右滑 reveal-then-tap 手勢在 paging TabView 內怎麼搶手勢。含 iPhone reconcile 的 ordinal 配對鐵律。Trigger 詞：「Watch 刪 set / 加 set / 長按 reorder / # type cycling」「D11 Phase D-H」「set logger 手勢」。涉及檔案：ios/TrainingLog Watch Watch App/{SessionInteractionState,ExerciseCard,LiveMirrorProducer}.swift + src/services/replaceLiveMirror.ts
---

# Watch set-logger overlay mutation + in-row swipe gesture

D11 in-session set logger 的「就地改動作/set」功能（刪除、+1、reorder、type cycling…）都共用兩個 pattern。動工前讀這個，省掉重踩。Validated 2026-05-31（刪 set/動作 + +1 set，main `055ad61`，device-verified）。**F2 批次（全屏鍵盤 / # type cycling / 長按 reorder）2026-05-31 已實作、Sim-green，branch `slice/13d-d11-setlogger-f2` 待實機驗** — 下面 §「Reorder / 中插 round-trip」+ §「長按 drag reorder 手勢」是這批的學問。

## Pattern 1 — 變更走 OVERLAY，不改不可變 snapshot

`SetLoggerView` 拿到的 `SessionSnapshot` 是**不可變的**（exercise/set 清單的來源）。`SessionInteractionState` 只存 **overlay**：active / logged ✓ / editedValues / **deletedExerciseIds / deletedSetIds / addedSets / setKindOverrides（# cycling）/ setRankOverrides（reorder 顯示序）**。每加一個 `@Published` overlay，**務必**在 `LiveMirrorProducer.configure()` 補一條 `.dropFirst().sink → dirty = true`（漏了變更不會推 iPhone），並 thread 進 `mergeSets` / `project` 兩處（漏了 render 跟 projection 不一致）。

新增一種變更 = 加一個 overlay 欄位 + 在**兩個地方**套用：

1. **Render**（`ExerciseCard.rowGroups`）— filter/merge 後再 `SetRowGroup.group(...)`。
2. **Live-mirror projection**（`LiveMirror.project` / `LiveMirror.mergeSets`）— 同樣 filter/merge，產生推給 iPhone 的快照。

**鐵律：render 與 projection 必須用同一套 merge 邏輯**（2026-05-31 抽 `LiveMirror.mergeSets(base:deletedSets:addedSets:kindOverrides:rankOverrides:sessionExerciseId:)` 給兩邊共用），否則手錶畫面跟 iPhone 收到的不一致。`mergeSets` 內：sort key = `rankOverrides[id] ?? (base ordinal / added displayRank)`、再 `applyKindOverride`（套 set_kind override）。

`LiveMirrorProducer.configure()` 要 `.dropFirst().sink` 訂閱**每個**新 overlay `@Published`（標 dirty），不然變更不會在 15s tick / `emitFinal()` 推出去。

刪除語意：base set → tombstone 進 `deletedSetIds`；**added set → 直接從 `addedSets` 移除**（它本來就不在 base、不需 tombstone）。`deleteSet` 要分流。

## Pattern 2 — `{}` Active 列的左右滑 reveal-then-tap 手勢

set rows 在 `ScrollView { VStack { ForEach } }`（**不是 List** → 沒有 `.swipeActions`），又包在左右換頁的 `TabView(.page)` 裡。要在列上做橫向手勢，照這套（`InteractiveSetRow`）：

```swift
@State private var reveal: RowReveal = .none   // none / delete / add
.highPriorityGesture(revealGesture, including: rowIsActive ? .all : .subviews)
```

- **`.highPriorityGesture` + `DragGesture(minimumDistance: 5)`** — 低門檻 + 高優先序，讓 Active 列在 TabView 換頁門檻**之前**先搶到橫向拖曳。這是「Active 列左滑一直觸發換頁」的解法（minDistance 14 會輸給換頁；5 才穩）。
- **`including: rowIsActive ? .all : .subviews`** — 非 Active 列把手勢 mask 掉（`.subviews`），讓橫滑自然走 TabView 換頁（spec line 1576-1577：只有 `{}` Active 才走列內手勢）。
- **reveal-then-tap，不要 swipe-past-threshold-直接動作** — 左滑只「露出 🗑」、右滑只「露出 ＋」，要再 **tap** 才真的刪/加。直接刪會「一滑就刪」+ 誤觸；2026-05-31 user 明確要 reveal-then-tap。
- **方向 toggle**：反向滑取消已露出的 affordance（add 狀態左滑→none、delete 狀態右滑→none）。
- **position 慣例（user 拍板）**：左滑 🗑 在 **trailing**（換掉 ◯）；右滑 ＋ 在 **leading**（列右移、◯ 推掉）。iOS-Mail 慣例。
- **ForEach 一定用穩定 id**（`id: \.element.id` = setId / cluster header setId），**不可用 `\.offset`**：刪一筆後 index 重排會讓 per-row `@State`（reveal flag）錯位到別列 → 「一滑刪兩 set」。
- 離開 Active（tap 框外 / 切列 / ✓）要 `.onChange(of: rowIsActive)` 把 reveal 收掉。

watchOS Sim **驗不到拖曳手勢**（AX tree 空、tap 不穩）→ build green + at-rest layout 截圖就好，手勢真驗一律走實機（`xcodebuild-watchos-realdevice-install` skill）。每改一輪 Swift = 一次 clean install + devicectl + 戴錶 smoke，預期會迭代好幾輪 device feedback。

## iPhone reconcile 的 ordinal 鐵律（`src/services/replaceLiveMirror.ts`）

加任何「動結構」的功能前必懂，否則 [完成] 後歷史會錯：

- **set 配對 = `(session_exercise_id, ordinal)` 值**。所以：
  - 刪 set → **保留剩餘 set 的原 ordinal**（純 filter、絕不 re-index）→ 被刪的 ordinal 缺席 → end-reconcile purge 對的那列。
  - 加 set → 給**唯一**的 wire ordinal = `max(該動作所有 ordinal 含 tombstoned)+1` → 不撞 canonical → INSERT。
- **exercise 配對 = `exercise_id` + 出現序**（不是清單位置！位置配對會讓刪首/中動作弄壞歷史）。
- **整數 ordinal 插不進中間**：要「插在中間列」的顯示位置，用 `AddedSet.displayRank: Double`（夾在兩列 rank 中點）**decouple** wire ordinal（仍 max+1）。代價：Watch 顯示在中間、但 iPhone 歷史該 set 排在該動作**最後**（值對、序差）。「插在最後一組」兩邊才一致。要 iPhone 也中插 = 得 renumber-at-end（會破壞值配對）、屬另一個大改。

## Reorder / 中插 round-trip — 不改 reconcile，靠「ordinal 池 permute」

2026-05-31 F2：要讓 Watch 的 reorder / 中插 +1 在 **iPhone 歷史也跟著動**，**不要動 reconcile**（值配對鐵律別碰）。整個解法在 Watch 端：

- 顯示順序走 `setRankOverrides: [setId: Double]`；reorder = 重排 rank（group 整組移動時成員 rank 連續重排，見下節）。
- **projection 送出前重指派 wire ordinal**：把該動作「**目前在場的 ordinal 值集合**」**排序後、按顯示順序逐一指派**回各 set（`LiveMirror.project` 內 `let sortedOrdinals = merged.map{$0.ordinal}.sorted()` → `ordinal: sortedOrdinals[i]`）。
- **關鍵不變式 = ordinal 值的「集合」不變**（沒新增/沒砍 ordinal 值、只 permute 指派）→ delete 的缺席 purge、add 的 max+1 INSERT 全部不受影響；iPhone 按值覆寫 mirror-bound 欄位 → 內容跟著 ordinal slot 走 → 順序跟 Watch 一致。
- 非 reorder 情況與舊行為**完全相同**（純模板 / 刪除保留原 ordinal / 末尾 add = max+1）；**附帶修好**之前 deferred 的「中插 +1 在 iPhone 排最後」。
- ⚠️ 代價：同動作內 set 的「實體 row 身分（哪個 canonical UUID 裝哪筆內容）」會錯置 → 對歷史**顯示**完全不可見，僅理論上影響 per-set 模板連結（罕見邊界）。
- ⚠️ **切 D 新建的 dropset sub-set 在 iPhone `parent_set_id=NULL`**（reconcile INSERT 沒設）→ 資料正確（連續 `set_kind=dropset` 列），但 iPhone 歷史是否聚成 cluster 框未驗、屬後續。

## 長按 drag reorder 手勢（group 層級）— 含 2026-05-31 device-grilled 坑

掛在 group row（`ExerciseCard.setRowsSection` ForEach、OUTER），用一個擁有
`@GestureState` 的 wrapper（`ReorderableRow`）：`LongPressGesture(minimumDuration:
0.5).sequenced(before: DragGesture(coordinateSpace: .named(...)))`。

- **⭐ `.first` vs `.second` 是「瞬間發動」bug 的真因**：sequence gesture 的
  `.first(true)` 是 **PRESS 階段（isPressing，手指碰下去那刻就送出）**、**不是長按完成**！
  把橘框/震動接在 `.first(true)` → 一碰就觸發,**跟 `minimumDuration` 完全無關**(調
  0.45→0.7s 完全沒差別,因為門檻根本沒參與)。正解:橘框 + 震動只在 **`.second`**
  (長按真正撐過門檻、進入 drag 階段)才發。震動用 `@State didEnterMove` 旗標只發一次。
- **`@GestureState`(不是 `@State`)存 move-mode + offset**:手勢一結束/取消「自動歸零」
  → 橘框不會殘留。`@State` 在「長按了沒拖就放開」時 `.onEnded` 不觸發 → 橘框卡死 +
  擋住 cell 點擊(2026-05-31 device bug)。
- **`.simultaneousGesture`(不是 `.highPriorityGesture`)讓 cell 點得到**:highPriority
  長按對整列(含 cell)最高優先 → 快速點 cell 被吃掉、稍按久變橘。simultaneous 讓長按
  跟 cell tap 並行判斷:快速點 → cell;按住 0.5s → reorder。
- gate 在 active 列:`.simultaneousGesture(g, including: isActive ? .all : .subviews)`
  → idle 列 `.subviews` 完全 inert,捲動/tap-to-activate 正常(否則「進 session 滑不動/
  無法 active」)。
- 落點 index:`PreferenceKey` 收 group midY(named space)+ 手指 Y。midY reader 掛在
  wrapper **外面**(`.offset` 是非佈局 transform,不會歪掉靜態 slot Y)。
- **cluster(D) 整組移動** = 成員 setIds 一起重排:`state.applyReorder([[String]])`。
- 手勢可靠度 Sim 驗不到、device-only。

## 遞減組 cluster（dropset chain）— 2026-06-01

- **視覺**:綠色 Active 框(同一般組,user Q1)、整 chain 一個框、✓ 在框「外」右上 →
  缺角多邊形(`ClusterNotchedBorder`,tangent-arc 圓角化全 6 角)。子步 `[－]/[＋]` 只在
  Active 時出現、`[－]` 在剩最後 1 個子步時 disabled+灰(min-1-child)。
- **⭐ CellBox 對齊**:`CellBox` 會自動展開(`Text.frame(maxWidth:.infinity)`),所以 head
  被缺角 notch padding 擠窄、子步沒擠 → cells 不等寬。修法 = cluster cells **釘死固定寬**
  `.frame(width: CellMetrics.weightWidth/.repsWidth)` + head/follower 用**相同 HStack 骨架**
  (相同 leading 寬 + inline trailing 保留,不要一個用 `.padding(.trailing)` 一個用內部 spacer)。
- **資料層 `parentSetId`(Stage 2,純 TS+Swift 無 migration)**:`SessionSnapshotSet` /
  `AddedSet` 加 `parentSetId`(custom init 帶 default 免改 ~16 建構點);`cycleSetKind` 種子步
  / `[＋]` 帶 `parentSetId = head`;wire Codable 自動帶(nil→absent)。**iPhone reconcile 靠
  `setIdMap`(wire id → on-device id)即時翻譯 follower 的 parent** — head 是 canonical 時
  c1≠wire id 也正確;**非 dropset 列一律清 `parent_set_id`**(解構後再 cycle 才不被 stale 誤折)。
- **iPhone 折疊要「ordering 連續」**(`computeSessionSetLayout` 按序連續吃 follower),不是純
  parent_set_id → follower 的 wire ordinal 必須緊接 head。

## live-mirror 即時鏡像（`LiveMirrorProducer` + `replaceLiveMirror`）— 2026-06-01

- **sync <1s**:throttle 15s → **0.5s + `markDirty()` 立即推送**(超過 coalesce 窗就馬上 emit,
  否則 poll 合併;burst ≤2 次/秒)。改了 NEW-Q50 Q6=a 的 15s 設計。
- **live per-動作 set purge**:原 E2 契約「live 只 upsert 不刪」→ 遞減組改結構時孤兒列累積
  (「變一堆組」)。修法 = `purgeSetsInPresentExercises` 選項,live 對**快照裡有的動作**刪掉它
  多餘的 set(缺席的整個動作仍留 end-session)。對 WC applicationContext(完整快照)安全。
- **⚠️ 未解:ordinal value-shuffle「吃掉下面的組」**:`project()` 的 pool-permute(為 reorder/
  中插做的)把 follower 的 `set_kind/parent` 洗到下面 canonical 工作列上 → per-動作 purge 清孤兒
  但擋不住這個洗。**歷史(end-session purge)正確、live 仍會暫態吃**。深解待辦(可能要 dropset 不
  參與 permute / 給 follower 高 ordinal INSERT)。

## 全屏鍵盤（`CellEditOverlay` keypad mode）

- keypad mode 整個 `Color.black.ignoresSafeArea()` 全屏、`KeypadVStack` 用 `.frame(maxHeight: .infinity)` 把 4 列按鍵撐滿。
- buffer 行右側那顆從「`↻` 切 crown」改成「`⬅` 返回 = `state.discardActiveCell()`（取消編輯不存值）」；crown 模式改由 ⚙ 設定 → 輸入方式（`WatchSettingsKey.inputMode` == `InputMode.storageKey` == `"inputMode"`、同 key）。
- 編輯時 (`activeCell != nil`) `SetLoggerView` 用條件 `.toolbar` 藏齒輪。⚠️ 右上**系統時間 watchOS 系統層畫、無 API 可藏**。

## Anti-patterns

- ❌ 只在 render filter、忘了 projection 也要 filter → 手錶看起來刪了、iPhone 沒收到變更。
- ❌ 加了 overlay `@Published` 但沒在 `LiveMirrorProducer.configure()` 訂閱 → 變更永不推出。
- ❌ `ForEach(..., id: \.offset)` + per-row `@State` → 刪一筆牽連鄰列。
- ❌ swipe-past-threshold 直接刪/加 → 一滑就動 + 誤觸換頁。
- ❌ 加 set 時 re-index 既有 set 的 ordinal → 破壞 iPhone 值配對、purge/UPDATE 錯列。
- ❌ 以為 watchOS Sim 能驗手勢 → 浪費時間，手勢只能實機驗。
- ❌ 把橘框/震動接在 reorder gesture 的 `.first(true)` → 一碰就發動(那是 press 階段、不是長按完成)。
- ❌ reorder/reveal 用 `.highPriorityGesture` 蓋整列 → 吃掉 cell 點擊 / 擋掉垂直捲動。
- ❌ cluster head 與 follower 用不同 HStack 骨架 → cells 不對齊(CellBox 會展開)。
- ❌ 純 TS 改動(reconcile)後叫 user 重裝機 → TS 是 Metro 熱載,Reload JS 就好;只有 Swift 改才 build。

## Cross-references

- `watch-sim-screenshot` — Sim 出圖驗視覺(layout/對齊/顏色,不含手勢)
- `watch-swiftui-phase-ship` — Sim verify + commit/cherry-pick 流程（build 層）
- `xcodebuild-watchos-realdevice-install` — 實機 build+install（手勢真驗在這）
- `~/.claude/projects/-Users-hao800922/memory/project_traininglog_watch_setlogger_backlog.md` — D11 Phase F 現況（F2 三項：全屏鍵盤 / # cycling / 長按 reorder 已實作待實機驗）
- ADR-0019 § Slice 13d D11 spec（line 1513-1599 row gestures + state table）+ § "WC Ship-Blocker Fixes E1/E2/E3"
