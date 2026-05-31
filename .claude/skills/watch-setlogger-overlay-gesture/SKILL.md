---
name: Watch set-logger overlay mutation + in-row swipe gesture
description: 在 Watch in-session set-logger (D11 Phase D-H) 加「動作/set 的就地變更」(刪除/+1/reorder/type-cycle) 時的兩個核心 pattern — (1) 變更走 OVERLAY 疊在不可變 SessionSnapshot 上、render + live-mirror projection 兩處 filter/merge；(2) `{}` Active 列的左右滑 reveal-then-tap 手勢在 paging TabView 內怎麼搶手勢。含 iPhone reconcile 的 ordinal 配對鐵律。Trigger 詞：「Watch 刪 set / 加 set / 長按 reorder / # type cycling」「D11 Phase D-H」「set logger 手勢」。涉及檔案：ios/TrainingLog Watch Watch App/{SessionInteractionState,ExerciseCard,LiveMirrorProducer}.swift + src/services/replaceLiveMirror.ts
---

# Watch set-logger overlay mutation + in-row swipe gesture

D11 in-session set logger 的「就地改動作/set」功能（刪除、+1、reorder、type cycling…）都共用兩個 pattern。動工前讀這個，省掉重踩。Validated 2026-05-31（刪 set/動作 + +1 set，main `055ad61`，device-verified）。

## Pattern 1 — 變更走 OVERLAY，不改不可變 snapshot

`SetLoggerView` 拿到的 `SessionSnapshot` 是**不可變的**（exercise/set 清單的來源）。`SessionInteractionState` 只存 **overlay**：active / logged ✓ / editedValues / **deletedExerciseIds / deletedSetIds / addedSets**。

新增一種變更 = 加一個 overlay 欄位 + 在**兩個地方**套用：

1. **Render**（`ExerciseCard.rowGroups`）— filter/merge 後再 `SetRowGroup.group(...)`。
2. **Live-mirror projection**（`LiveMirror.project` / `LiveMirror.mergeSets`）— 同樣 filter/merge，產生推給 iPhone 的快照。

**鐵律：render 與 projection 必須用同一套 merge 邏輯**（2026-05-31 抽 `LiveMirror.mergeSets(base:deletedSets:addedSets:sessionExerciseId:)` 給兩邊共用），否則手錶畫面跟 iPhone 收到的不一致。

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

## Anti-patterns

- ❌ 只在 render filter、忘了 projection 也要 filter → 手錶看起來刪了、iPhone 沒收到變更。
- ❌ 加了 overlay `@Published` 但沒在 `LiveMirrorProducer.configure()` 訂閱 → 變更永不推出。
- ❌ `ForEach(..., id: \.offset)` + per-row `@State` → 刪一筆牽連鄰列。
- ❌ swipe-past-threshold 直接刪/加 → 一滑就動 + 誤觸換頁。
- ❌ 加 set 時 re-index 既有 set 的 ordinal → 破壞 iPhone 值配對、purge/UPDATE 錯列。
- ❌ 以為 watchOS Sim 能驗手勢 → 浪費時間，手勢只能實機驗。

## Cross-references

- `watch-swiftui-phase-ship` — Sim verify + commit/cherry-pick 流程（build 層）
- `xcodebuild-watchos-realdevice-install` — 實機 build+install（手勢真驗在這）
- `~/.claude/projects/-Users-hao800922/memory/project_traininglog_watch_setlogger_backlog.md` — D11 Phase F 現況 + 下次工作（長按 reorder / 全屏鍵盤 / # type cycling）
- ADR-0019 § Slice 13d D11 spec（line 1513-1599 row gestures + state table）+ § "WC Ship-Blocker Fixes E1/E2/E3"
