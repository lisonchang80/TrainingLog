# Set Logger + Session UI 落地 Implementation Plan (2026-05-24)

> 本文承接 5/23 overnight Agent E 的 set-logger-roadmap（worktree 內未保留 file；以 ADR-0012 / ADR-0018 / ADR-0019 / ADR-0014 為直接 source of truth）+ slice 10a/10b 已 ship 的 schema（v015/v016/v017）+ 5/23~5/24 8-commit drift 觀察。目標：把「set logger redesign（ADR-0012）+ session UI 整體（ADR-0019）+ session lifecycle（ADR-0019 Q9）+ 歷史頁 layout 整合（ADR-0019 Q10）+ v014 cluster write path（ADR-0018 Q6 deferred → ADR-0019 Q7 翻盤）」這條 5-8 週工作量拆成可 ship 的 slice 10c→10f bundle，並列出每張卡的 grill 開放點 + 程式碼觸點 + 測試清單。

---

## § 0 — Worktree state baseline (2026-05-24)

| 元件 | 已落地（slice 10a/10b） | 未落地（slice 10c+） |
|---|---|---|
| Schema v015 set 三欄（`set_kind` / `parent_set_id` / `is_logged`）| ✅ `src/db/schema/v015_set_kind_and_clusters.ts` | – |
| Schema v016 rest_sec 雙欄 + auto_popup_rest_timer seed | ✅ `src/db/schema/v016_session_runtime_data.ts` | – |
| Schema v017 「無」 program seed | ✅ `src/db/schema/v017_program_none_seed.ts` + `RESERVED_NONE_PROGRAM_ID` | – |
| `snapshotForSession` 複製 `rest_sec` | ✅ `src/domain/template/templateManager.ts:162` | – |
| 動作卡 collapsed / expanded（Q3 a-1 / b-1 / c-2）| ✅ `app/(tabs)/index.tsx:594-614, 805-876` | ⚙️ menu 真實 3 sheet |
| ⚙️ icon affordance + Alert placeholder | ✅ `app/(tabs)/index.tsx:605-610` | 改成 ActionSheet / Modal |
| Set logger per-row 5 gesture（ADR-0012）| ❌ `app/(tabs)/index.tsx:655-685` 仍是 Weight/Reps TextInput + Save Set | 全 reimplement |
| Cluster 一 cycle 一 ✓（ADR-0019 Q2.4 / Q8）| ❌ – cluster UI 只在 read-only `app/session/[id].tsx:263-325` | reimplement 整 cluster block |
| Library RS picker tab + `appendReusableSupersetToSession` | ⚠️ `app/(tabs)/library.tsx:241,398,619+` RS tab 已存在，但 picker mode 只支援 multi-select 動作 → 還沒接 `targetSessionId=` snapshot 進 session 的 explode flow | 加 in-session RS picker 路徑 |
| Rest timer chip + auto-popup modal | ❌ 完全沒實作 | 全新 |
| In-session stats panel 3-tile / 5-tile（Q6）| ❌ | 全新 |
| Session.title in-session tap-to-edit（ADR-0014 + ADR-0019 Q9.2 rename）| ❌ – Today screen 無 title field | 全新 |
| Finish dialog 差異化（Q9d）| ❌ – `onEndSession` (`app/(tabs)/index.tsx:342`) 直接 endSession 無 diff prompt | 全新 |
| Discard 路徑（Q9c）| ❌ – 無 header `[⋯]` menu | 全新 |
| Start UX bottom sheet（Q9a）| ❌ – sheet 已 ship、scope 改大為 ADR-0024 訓練 tab 重構（slice 10g）| 砍 templates tab、3 區塊 + bodyweight 流程改 |
| Save-back diff 範圍（Q9 Sticky 3 擴展）| ❌ – `src/domain/template/saveBackDiff.ts:194-261` 只看 sets/reps/weight | 擴 set_kind / position / cluster / rest_sec |
| 歷史詳情頁 HU1/HV1/HE1 layout（Q10）| 🟢 大部分 ship – `app/session/[id].tsx` 已 3176 行、HU1/HV1/HE1 + 4-button bar + 3-tile stats panel + edit mode 全 shipped、僅缺 HR chart (留 slice 13) | Round G 拍板新 Card 12R (persistent snapshot) 吸到 slice 10e |
| ADR-0012 amendment marker / ADR-0018 amendment marker / ADR-0014 amendment marker | ✅ 已 inline | – |
| Session.title `v010` 欄 + ADR-0014 backfill | ⚠️ 需要 verify — schema 未列在 v015-v017 中（可能在更早 v009/v010 已落） | check + 加 backfill 若缺 |

---

## § 1 — Drift since 5/23 roadmap

8 個 commit since `0cdbb69`（roadmap basis）→ `c03670b`（current HEAD）全部是 **anatomy / SVG body diagram 微調**（`components/body-heatmap.tsx` chest / glute / deltoid 切線重做、`docs/skills/svg-overlay-refine` 新增 Pattern D + S-curve + Catmull-Rom 兩條 session）：

```
c03670b docs(skill): svg-overlay-refine — add S-curve cubic + Catmull-Rom
80261a4 fix(anatomy): glute UPPER/LOWER redesign — 4-keypoint cut + outline + S-curve
60f37f6 docs(skill): svg-overlay-refine — add Pattern D coord-picker + Bezier
d2cf009 fix(anatomy): chest 切線 flip to concave-up via cubic Bezier
3ffe2f3 tweak(anatomy): chest scale × 1.05 + deeper 切線 curve
901070f fix(anatomy): chest outline from user's 28 keypoints + 切線 split
44477a2 fix(anatomy): chest UPPER/LOWER split using 4-keypoint 切線
a3e72dc fix(anatomy): chest leaves — fix R-leaf winding direction
```

**Drift impact on set-logger / session-UI 落地：零**。所有 commits 都動 `components/body-heatmap.tsx` + `components/exercise/body-overlay-paths.ts`（read-only 視覺資產）+ `docs/skills/svg-overlay-refine/SKILL.md`；不碰 `app/session/`、`app/(tabs)/index.tsx`、`components/template-editor/`、`src/adapters/sqlite/setRepository.ts`、`src/domain/template/saveBackDiff.ts`、`src/db/schema/`。

**結論**：5/23 status matrix 全部 carry over，無 ⚠️/❌ 轉 ✅ 也無新 blocker。新「blocker」只有一條：**roadmap doc 本身在 worktree 內找不到（被 git clean 或從未 commit 進來）**——本文以 ADR-0012 / ADR-0019 重建 status matrix。

---

## § 2 — Implementation steps per ⚠️/❌ item

### Card 1 — Set logger per-row 5 gesture（ADR-0012 主結構）

- **Status**: ❌（slice 10b 留尾 — Today tab expanded body 只有 hint 文字「coming in slice 10c」）
- **Decision needed (grill)**: yes — § 4 Round A
- **Code touch list**：
  - 新建 `components/set-logger/set-row-content.tsx`（row 視覺 = `[label][reps][×][weight kg][📝][★][✓]`，per ADR-0012 § Per-row affordance map）
  - 新建 `components/set-logger/swipeable-set-row-session.tsx`（port `components/template-editor/swipeable-set-row.tsx` 並接 left/right action + long-press；template editor 既有版本沿用 ADR-0016 Q11 模型，session 版需接 ADR-0012 5 gesture）
  - 新建 `components/set-logger/set-label-cycle.ts`（pure：`set_kind: warmup → working → dropset → warmup`）
  - 新建 `components/set-logger/inline-numeric-input.tsx`（tap reps/weight 方格 → keyboard，per ADR-0012 § inline edit）
  - 改 `app/(tabs)/index.tsx:856-873` Expanded body → render `<SetRowList sessionExerciseId={…}>`（從 `setRepository.listSetsBySessionExercise` query + render）
  - 新建 `src/adapters/sqlite/setRepository.ts` 加 `listSetsBySessionExerciseOrdered` / `updateSetField` / `appendSetAfter` / `deleteSet` / `reorderSetPositions` 5 個 helper（既有只有 `recordSetInSession` + `listSetsBySession`）
  - 新建 `src/domain/set/setRowReducer.ts`（pure：分子分母 reactive 計算 + label cycle + reorder math）
- **Test cases needed** (`tests/domain/setRowReducer.test.ts` + `tests/db/setRepositoryGestures.test.ts`)：
  1. label cycle warmup → working → dropset → warmup（3 tap 回原態）
  2. tap ✓ toggle `is_logged` round-trip
  3. 右滑加 row 從當前 row 後 INSERT、position 重編
  4. 左滑刪除 row（無 confirm）→ position 重編
  5. 長按 reorder → position UPDATE 群組
  6. inline edit reps/weight 即時 UPDATE 同欄
  7. 已 ✓ 的 set 改數字維持 ✓（語意 = 「✓ = 存在 / 完成」非反悔）
  8. 分母 reactive = `Σ reps × weight WHERE set_kind != 'warmup'`（不過濾 is_logged）
  9. 分子 reactive = `Σ … WHERE is_logged=1 AND set_kind != 'warmup'`
  10. 分子嚴格 ≤ 分母（property test：random 100 row state）
- **Commit boundary**：3 commit
  - C1.1 — pure setRowReducer + test（無 UI 改動）
  - C1.2 — setRepository helpers + test
  - C1.3 — UI wire（set-row-content + swipeable wrapper + index.tsx Expanded body）
- **Risk**：**high** — 主結構 reimplement、5 gesture × 8 state field 高 surface；mitigation：(a) C1.1 先 pure reducer 釘 invariant；(b) C1.3 開新 file 不動 template editor 既有 swipeable-set-row；(c) iOS simulator 5 gesture smoke 必走過

### Card 2 — Dropset cluster B3（parent_set_id 連結 + 3 cluster gesture）

- **Status**: ❌ — `parent_set_id` schema 在 v015 有，UI 無
- **Decision needed (grill)**: yes — § 4 Round B
- **Code touch list**：
  - 新建 `components/set-logger/dropset-cluster.tsx`（render `[D# root row][− step][−+ last step]`，3 cluster-level gesture：左滑刪整 cluster / 長按整 cluster 拖移 / 右滑加新 cluster + 備註）
  - 改 `setRepository.deleteSet` 加 `cascadeChildren` 模式（root row DELETE → children 透過 `FK ON DELETE CASCADE` 自動消，但 v015 註解「no FK」→ 改 explicit `DELETE WHERE parent_set_id = root.id` 先 + DELETE root）
  - 新建 `src/domain/set/clusterMath.ts`（pure：`GROUP BY COALESCE(parent_set_id, id)`、cluster 計算規則表 per ADR-0012 § 計算規則矩陣）
  - 改 `src/domain/pr/prEngine.ts`（既有過濾條件可能還是 `is_warmup` → 改 `set_kind != 'working'` 排 warmup + dropset；本卡的 PR engine 動需要先 grep 驗證再決定子卡邊界）
  - 改 `src/domain/stats/statsEngine.ts`（volumeEngine：`set_kind = 'warmup'` 排除；working + dropset 算容量；cluster ✓ 才算 Σ all steps）
- **Test cases needed** (`tests/domain/clusterMath.test.ts`)：
  1. cluster 首 step 顯 D1 label + ✓ button
  2. cluster 後續 step 顯 `[−]` / 最末 `[−+]`、無 label
  3. cluster `is_logged` 只在 root（child UPDATE 失敗 / no-op）
  4. SQL `GROUP BY COALESCE(parent_set_id, id)` 取 cluster grouping
  5. 左滑 cluster → DELETE root + cascade children（無 dangling）
  6. 右滑 cluster → INSERT 新 cluster 在後（D# 重編）
  7. 整 cluster 跳過 PR engine
  8. 容量 cluster ✓ → Σ all steps
- **Commit boundary**：2 commit
  - C2.1 — clusterMath + setRepository cascade + tests
  - C2.2 — dropset-cluster UI + 接 index.tsx Expanded body
- **Risk**：**med** — schema 已就位、cluster invariant 在 ADR-0012 鎖死；mitigation：先 pure clusterMath test + 對照 ADR § 計算規則矩陣

### Card 3 — Rest timer chip + auto-popup modal（ADR-0019 Q2）

- **Status**: ❌
- **Decision needed (grill)**: partial — § 4 Round C（auto-popup modal 視覺 + Cluster root rest_sec source）
- **Code touch list**：
  - 新建 `components/session/rest-timer-chip.tsx`（永久 chip：剩餘秒數 + 上下時間調整 ± button per ADR-0012「per-row 5 gesture」 reference UI 風格）
  - 新建 `components/session/rest-timer-modal.tsx`（auto-popup：大字倒數 + [完成] btn，per Q2.3 b 「modal 不重彈」變體）
  - 新建 `src/domain/rest-timer/restTimerState.ts`（pure state machine：`idle | running | finished` + `tick(now)` 純函數 + AppState wall-clock self-correct hook target）
  - 新建 `src/hooks/useRestTimer.ts`（React hook：sub `restTimerState` + `Vibration.vibrate` + `expo-av` 短音 + AppState `addEventListener` 校時）
  - 改 `app/(tabs)/index.tsx` set-row ✓ tap handler → 啟 timer（cluster 走 cluster root rest_sec）
  - 改 `app/(tabs)/settings.tsx` 加 `auto_popup_rest_timer` toggle（讀寫 `app_settings` 表）
- **Test cases needed** (`tests/domain/restTimerState.test.ts`)：
  1. tick 每秒 -1
  2. 倒到 0 → state = finished（trigger vibrate hook side-effect 測 mock）
  3. 重新 tap ✓ → reset to rest_sec（取消上次倒數）
  4. ✓ 取消（再 tap ✓ 翻空白）→ timer stop + chip 消失
  5. Cluster root ✓ → rest_sec 來自 root.rest_sec（child rest_sec 即使有值忽略）
  6. AppState background → resume → wall-clock self-correct
- **Commit boundary**：2 commit（state + UI）
- **Risk**：**med** — AppState 校時 5/20 在 slice 10d 試過遇 BG2 wall-clock 偏差 issue；mitigation：抄 slice 10d ship 紀錄的 BG2 pattern

### Card 4 — In-session stats panel 3-tile / 5-tile（ADR-0019 Q6）

- **Status**: ❌（schema v016 加了 `session.healthkit_workout_uuid` + `avg_hr_bpm` + `kcal` stub 三欄已就位）
- **Decision needed (grill)**: no — Q6 全拍板，layout 固定 3 / 5 tile；slice 13 HK 真實寫入前 5-tile 條件永遠 false → 等效 3-tile
- **Code touch list**：
  - 新建 `components/session/session-stats-panel.tsx`（3-tile：容量 / 動作數 / 訓練時間；5-tile 條件 `session.healthkit_workout_uuid != null` 走 row 2 加心率 + 大卡）
  - 改 `app/(tabs)/index.tsx` 插在 timer header 下方、動作卡列表上方
  - 新建 `src/domain/session/sessionStats.ts`（pure aggregate：容量 = `Σ reps × weight WHERE set_kind != 'warmup' AND is_logged`、動作數 = distinct session_exercise 數、訓練時間 = `now - session.started_at`、心率 fallback「—」、kcal fallback「—」）
- **Test cases needed** (`tests/domain/sessionStats.test.ts`)：4 case（容量 / 動作數 / 訓練時間 / HK null fallback）
- **Commit boundary**：1 commit
- **Risk**：**low**

### Card 5 — ⚙️ menu 3 sheet（編輯備註 / 休息秒數 / 刪除動作）

- **Status**: ❌ — icon 已有，Alert placeholder
- **Decision needed (grill)**: no — Q5 拍板 3 項；備註 sheet 走 ADR-0017 Q5 全局 `exercise.notes`、休息 sheet 走 `session_exercise.rest_sec`、刪除走 confirm dialog + DELETE CASCADE
- **Code touch list**：
  - 新建 `components/session/exercise-settings-sheet.tsx`（ActionSheet 3 row）
  - 新建 `components/session/exercise-note-sheet.tsx`（bottom sheet TextInput multi-line）
  - 新建 `components/session/exercise-rest-sec-sheet.tsx`（bottom sheet numeric input）
  - 改 `app/(tabs)/index.tsx:605-610` `onSettingsPress` → open sheet（不再 Alert）
  - 改 `src/adapters/sqlite/exerciseRepository.ts` 加 `updateExerciseNotes(db, exerciseId, notes)`
  - 改 `src/adapters/sqlite/sessionRepository.ts` 加 `updateSessionExerciseRestSec` + `deleteSessionExerciseAndSets`（後者 wave 18 在 slice 10c-pre 已加，verify）
- **Test cases needed** (`tests/db/exerciseSettingsSheet.test.ts`)：6 case（notes round-trip / rest_sec round-trip null vs int / 刪除 cascade sets / 跨入口 notes 同步）
- **Commit boundary**：2 commit（repo helpers + UI sheets）
- **Risk**：**low**

### Card 6 — Cluster write path：In-session RS picker（ADR-0019 Q7）

- **Status**: ❌ — Library RS tab 已有（`app/(tabs)/library.tsx:241,398,619+`），但 picker mode 沒接 `targetSessionId=` 的 RS explode flow
- **Decision needed (grill)**: partial — § 4 Round D（picker URL params naming + explode 結果是否立刻 land 在當前 expanded card 上方）
- **Code touch list**：
  - 改 `app/(tabs)/library.tsx` picker mode 加 `targetSessionId` URL param；超級組 tab tap RS card → 不走 multi-select 而是直接 `appendReusableSupersetToSession(db, sessionId, rsId)` + `router.back()`
  - 新建 `src/adapters/sqlite/sessionRepository.ts::appendReusableSupersetToSession`（INSERT 2 row `session_exercise` parent + child，parent_id + reusable_superset_id 對齊 v014 schema；ordering 從 max + 1 起）
  - 改 `app/(tabs)/index.tsx` `[⊕ 加動作]` 入口 → `router.push('/exercise-picker?mode=picker&targetSessionId=…')`（既有可能用 targetTemplateId）
  - 新建 `src/domain/session/clusterFromRS.ts`（pure：把 `superset` + `superset_exercise` rows 攤平成 2 個 session_exercise spec，含 parent_id remap two-pass per snapshotForSession pattern）
- **Test cases needed** (`tests/db/appendReusableSupersetToSession.test.ts`)：6 case
  1. INSERT 2 row 帶 parent_id + reusable_superset_id
  2. ordering 從 max + 1 起
  3. asymmetric set count（A=4 / B=3）保留
  4. cross-session isolation
  5. dup pair guard（既有 `findExistingReusableSupersetByPair` 邏輯）→ session 內已有同 RS 是否 block 仍需 grill
  6. snapshotForSession 把 RS set 預建 row（沿用 prefillReusableSupersetFromLastSession？需 verify）
- **Commit boundary**：2 commit（pure clusterFromRS + repo + tests / UI picker wire）
- **Risk**：**med** — picker mode reuse path 多、URL params 命名衝突（既有 fromTemplateId / fromSessionId / targetTemplateId 區別）；mitigation：先 grep 既有 picker callers list 清單

### Card 7 — Cluster block in-session UI（ADR-0019 Q8）

- **Status**: ❌
- **Decision needed (grill)**: no — Q8 layout 鎖死（H1 縱條 RS 色 + banner、AS1 「—」placeholder、一 cycle 一 ✓）
- **Code touch list**：
  - 新建 `components/session/cluster-card.tsx`（collapsed: 圓圖重疊 1/3 寬 + chip 0-100% bar + cycles 圓點；expanded: cycle row × N + [新增一輪] + [動作歷史] btn）
  - 新建 `src/domain/cluster/clusterCycleLogger.ts`（pure：一 cycle 一 ✓ 事務寫 A.set[i].is_logged = B.set[i].is_logged = true；asymmetric skip 不存在的 row）
  - 改 `setRepository` 加 `markClusterCycleLogged(db, parentSessionExerciseId, cycleIndex)`（transaction-wrapped）
  - 改 `app/(tabs)/index.tsx:585-616` plan 渲染 → 把連續的 cluster session_exercise（parent_id linked pair）merge 成 1 個 `<ClusterCard>` 而不是 2 個 `<ExerciseCard>`
- **Test cases needed** (`tests/domain/clusterCycleLogger.test.ts`)：
  1. cycle ✓ 事務寫兩 side
  2. asymmetric A=4 B=3、cycle 4 ✓ 只動 A.set[3]
  3. cycle ✓ 啟 cluster root rest_sec（child rest_sec 忽略）
  4. 新增一輪 A+B 同時 append（不會造成 asymmetric）
  5. cluster 列表 group by parent_id 對 (A, B) 配對
- **Commit boundary**：2 commit
- **Risk**：**med** — cluster row group 邏輯在 index.tsx render 切容易踩 c-2 only-one-expanded edge

### Card 8 — Session lifecycle Start UX bottom sheet（ADR-0019 Q9a + Q9.2） — **2026-05-24 取代**

> **2026-05-24 Round E 完成、本卡 scope 大改、拆出獨立 ADR-0024 + slice 10g**。原 plan 假設「Templates tab 加 bottom sheet」、Round E 翻盤為「砍 Templates tab、Today tab 改名訓練 + 3 區塊重構」。本卡留作 history、實際工作見 [ADR-0024](../adr/0024-training-tab-three-sections-and-templates-tab-removal.md) 與下方 slice 10g bundle。
>
> Grill 拍板：見上方 § 4 Round E 22 sub-decision ledger。
>
> 既有 `components/templates/start-template-sheet.tsx` + `startSessionFromTemplate(.. program_id, sub_tag)` + sticky GLOBAL key 全保留不動、只是 sheet invocation 改在「訓練 → 模板訓練」區塊內。

- **Status**: ❌ — 工作搬到 slice 10g
- **Decision needed (grill)**: ✅ Round E 已完
- **Code touch list**：見 slice 10g bundle 6 commit 拆分
- **Risk**：med（評估 unchanged — 跨 tab + 砍 file + bodyweight schema 整合）

### Card 9 — Session header [⋯] menu「放棄訓練」(Q9c)

- **Status**: ❌
- **Decision needed (grill)**: no — Q9c 拍板（[⋯] menu「放棄訓練」+ confirm dialog + DELETE CASCADE）
- **Code touch list**：
  - 改 `app/(tabs)/index.tsx` Header layout 加 `⋯` icon 緊鄰 `[完成]`
  - 新建 `components/session/session-header-menu.tsx`（ActionSheet「放棄訓練」row）
  - 改 `src/adapters/sqlite/sessionRepository.ts` 加 `discardSession(db, sessionId)`（DELETE session + CASCADE，沿用 ADR-0014 § 「刪除本訓練」既有刪歷史 session 邏輯）
- **Test cases needed** (`tests/db/discardSession.test.ts`)：3 case（CASCADE 完整 / Today refresh state idle / PR/統計 reactive 重算 sanity）
- **Commit boundary**：1 commit
- **Risk**：**low**

### Card 10 — Finish dialog 差異化（Q9d + Save-back diff 範圍擴展） — **2026-05-24 deprecated**

> **2026-05-24 Round F 重定義** — ADR-0019 wave 12 (2026-05-18) 翻盤砍除整個 finish dialog flow + saveBackDiff pipeline 全砍為 dead code。本卡整題 obsolete。新 Card 10R 吸收 Round F 拍板（4-button bar polish 5 sub-decision）。

- **Status**: 🗑️ deprecated — 留 placeholder
- **取代**: Card 10R 下方

### Card 10R — Session 詳情頁 4-button bar polish（Round F 拍板落地）

- **Status**: ❌（新卡，2026-05-24 grill 完）
- **Decision needed (grill)**: ✅ Round F 已完
- **Code touch list**：
  - 新建 minimal toast component (`components/shared/toast.tsx` + `<ToastProvider>` root + `useToast()` hook) — 不引第三方 lib、純 RN Animated.View + setTimeout autodismiss
  - 改 `app/session/[id].tsx::handleSaveTemplate('update')` Alert.alert → `showToast('已儲存到 [模板名]')`
  - 改 `app/session/[id].tsx::handleSaveTemplate('create')` defaultName 計算邏輯：`session.title?.trim() || linked?.template_name || 'Session ${dateLabel}'` 三層 fallback
  - 改 `app/session/[id].tsx::handleDelete` confirm body：`'「${session.title || '本訓練'}」將被刪除、已記錄的 set 將全部刪除、無法復原。'`
  - 改 `app/session/[id].tsx` header title rendering 加 [編] chip（editMode true 時）
  - 加 inline `// KNOWN RISK ...` comment 在 4-button bar 描述 edit mode 期間 [儲存模板] 行為（per Q1 拍板）
- **Test cases needed** (`tests/components/toast.test.tsx` + `tests/integration/sessionDetailActions.test.ts`)：
  1. Toast: 顯示 / autodismiss 計時 / multiple toasts 排隊
  2. defaultName 三層 fallback：session.title 非空 / linked template / freestyle dateLabel
  3. Delete confirm body 含 session.title 字串
  4. Edit mode 進入 → header [編] chip 顯示
  5. Edit mode 退出 → header [編] chip 消失
  6. (regression) Edit mode 期間 [儲存模板] 仍可按 + 寫 template（鎖定 Q1 拍板「不動」）
- **Commit boundary**：3-4 commit（toast component / defaultName + delete polish / header chip / regression test）
- **Risk**：**low** — 純 UI polish、無 schema 動、無新 domain logic

### Card 11 — Session.title in-session tap-to-edit（ADR-0014 + Q9.2 rename）

- **Status**: ⚠️ — schema 應該已落（ADR-0014 v010 ALTER）但需要 verify；UI 完全沒
- **Decision needed (grill)**: no — Q7.7 拍板 in-session header tap-to-edit、即時 UPDATE 無 dialog
- **Code touch list**：
  - verify `src/db/schema/` 內 `session.title TEXT NOT NULL DEFAULT ''` 是否落地（若無→加 v018 migration）
  - 改 `app/(tabs)/index.tsx` Timer header 顯示 `session.title`（空 → fallback「自由訓練」per ADR-0014 § 歷史頁顯示）
  - 新建 `components/session/session-title-editor.tsx`（tap → inline TextInput → UPDATE on blur）
  - 改 `src/adapters/sqlite/sessionRepository.ts` 加 `updateSessionTitle`
- **Test cases needed**：4 case（title round-trip / 空 string fallback / freestyle 預設 '' / Template-based 預設 = template.name）
- **Commit boundary**：1 commit（含 verify migration step）
- **Risk**：**low**（如果 v010 已落）/ **med**（如果要新 migration）

### Card 12 — 歷史詳情頁 HU1/HV1/HE1 layout（ADR-0019 Q10）— **2026-05-24 大部分已 ship**

> **2026-05-24 stale-plan-default 翻盤**：本卡實際 status 跟 plan 描述差很多 — `app/session/[id].tsx` 已 **3176 行**（plan 估 600+）、HU1/HV1/HE1 全 ship、4-button bar shipped、SessionStatsPanel shipped。**只剩 HR chart 待 slice 13 (HealthKit landed)** 才能接真資料。
>
> 唯一新 grill 點 = Round G Q1 (force-kill recovery)、拆出 Card 12R 吸收。

- **Status**: 🟢 大部分 ship — 只剩 HR chart 等 slice 13
- **Shipped 對照表**：
  - ✅ Header: title + back btn (line 1604-1630)
  - ✅ 3-tile SessionStatsPanel (line 1700)
  - ✅ HU1 統一動作清單 (read mode SoloExerciseBlock/ClusterBlock display)
  - ✅ HV1 全 expanded default (per file note line 134「FULL active-session UI parity」)
  - ✅ HE1 編輯模式 toggle (enterEditMode/commitEditMode/attemptExitEditMode pattern)
  - ✅ hideUnchecked switch (slice 10c amendment per ADR-0019 Q10)
  - ✅ Same-day session ← N/M → switcher (overnight #58)
  - ❌ HR zone chart — 等 slice 13 HealthKit
- **Decision needed (grill)**: ✅ Round G grill 已完
- **Cleanup needed**：本卡狀態描述更新 + Card 10R/12R 已吸收 Round F/G grill 拍板、無 reimplement 工作

### Card 12R — 歷史詳情頁 edit mode persistent snapshot（Round G 拍板落地）

- **Status**: ❌（新卡，2026-05-24 grill 完）
- **Decision needed (grill)**: ✅ Round G 已完
- **Code touch list**：
  - 新建 `src/domain/session/editSnapshotPersistence.ts` (pure helpers: snapshot ↔ JSON serialize/deserialize + TTL check)
  - 改 `app/session/[id].tsx::enterEditMode` → also `setSetting('session_edit_snapshot_${session_id}', { snap, savedAt: Date.now() })`
  - 改 `app/session/[id].tsx::commitEditMode` + `attemptExitEditMode` (discard path) → also `setSetting(key, null)` (delete)
  - 加 `useFocusEffect` on mount → `getSetting(key)` → if exists：(a) >7d 舊 → silent delete only; (b) ≤7d → `restoreSessionFromSnapshot(db, snap)` + delete + toast「上次未完成編輯已還原」(per Round F Q2 toast component)
  - 改 `src/adapters/sqlite/sessionRepository.ts::discardSession` → also delete `session_edit_snapshot_${id}` setting key
- **Test cases needed** (`tests/domain/editSnapshotPersistence.test.ts` + `tests/integration/editModeRecovery.test.ts`)：
  1. enterEditMode persist snapshot to app_settings (round-trip serialize)
  2. commitEditMode delete snapshot key
  3. attemptExitEditMode discard path delete snapshot key
  4. discardSession cascade delete snapshot key (FK semantic)
  5. Stale snapshot (savedAt > 7d) silent discard (no restore)
- **Commit boundary**：2 commit（pure persistence helpers + tests / wire enterEditMode + focus restore + discardSession cascade）
- **Risk**：**low-med** — 牽動 enterEditMode/commitEditMode/discardSession 3 條 path、需 cross-cutting test；mitigation: pure helpers 先 ship + integration test 跑全 cycle

---

## § 3 — Schema migration sequence (no new schema needed for slice 10c-10e)

| Slice | Migration 需要 | 動作 |
|---|---|---|
| 10c | ❌ | v015/v016/v017 已就位；Card 1-7 全走既有欄位 |
| 10d | ❌ | Rest timer state in-memory；`auto_popup_rest_timer` setting 已 seed |
| 10e | ⚠️ verify v010 | Session.title (Card 11) — 若 v010 未落需新 `v018_session_title_backfill.ts` |
| 10f | ❌ | 歷史頁 layout 全走既有欄位 |
| 10g（後續）| ⚠️ optional v019 | DROP `template_exercise.rest_sec` orphan column（slice 10b § 不在 slice 10b 直接 DROP，留 cleanup slice）|

**若需新 migration（v018 backfill session.title）**：
- Forward：`ALTER TABLE session ADD COLUMN title TEXT NOT NULL DEFAULT ''`（若 v010 未落）+ backfill `UPDATE session SET title = COALESCE((SELECT name FROM template WHERE id = session.template_id), '')`
- Idempotency：`PRAGMA table_info(session)` 檢測有無 title 欄
- CASCADE：無相依 FK
- Test：4 case（idempotency / Template-based backfill / Freestyle '' / 多次 migrate 不疊加）

---

## § 4 — Recommended grill sequence (白天 user grill rounds)

### Round A — Set logger inline edit 摩擦 vs ADR-0013 dedicated screen 翻盤?

- **Background**：ADR-0012 § Per-row affordance map 拍板 inline edit reps/weight（tap 方格 → keyboard），但 ADR-0013 早期曾提過 dedicated set edit screen；ADR-0012 全 inline edit 是預設、確認沒有翻盤需求。
- **Questions**：
  1. inline edit 過程中 keyboard 蓋住下方 row，KeyboardAvoidingView scroll edit row 到上半屏 — 確認接受？
  2. inline edit 失焦自動 commit 無 [完成] btn — 還是要 explicit Done btn？
  3. 數字 0 / negative / NaN 怎處理？（reject / clamp / silent ignore）
  4. cluster 內 dropset step 也走 inline edit 同模式？（per ADR-0012 § Dropset cluster B3 「cluster 內 step 不接受 gesture」是指 swipe / 長按、不涉 tap 方格 inline edit）
  5. inline edit 改數字時 PR engine 即時偵測 vs ✓ tap 才 trigger？（影響 Card 1 + slice 8 PR engine 互動）
- **Recommended answer**：
  1. ✅ 接受（per ADR-0012 § 設計哲學 anchor 例外條款）
  2. ✅ 失焦自動 commit（per ADR-0012 「inline edit 直接寫回」既拍）
  3. clamp + silent ignore（reps ≥ 1、weight ≥ 0；超範圍視為 user typing 中間狀態）
  4. ✅ cluster 內 step inline edit 走同模式
  5. ✓ tap 才 trigger PR engine（per ADR-0012 § 計算規則矩陣「PR engine working only」+ Q2.3 d 「取消 ✓ = 取消 set 完成所有副作用」一致）
- **Open question count if all default ruled**：0 — implementation 可走

### Round B — Dropset cluster gesture 對 cluster 內 step disabled 是否包含 tap label cycle?

- **Background**：ADR-0012 § Dropset cluster B3 § 後續 step 「行為純 button-driven」，但 tap label cycle 對 root step 仍有效（cycle warmup → working → dropset）；root step 若 cycle 回 working / warmup 時，children 應該怎處理？
- **Questions**：
  1. Root step set_kind 從 dropset cycle 回 working → children rows 自動轉成 working sibling rows？還是 dangling？
  2. Cluster 內 step 自己 tap label 改 set_kind 是否生效？
  3. 如果 (1) 改 working、children 跟著 promote 成獨立 row 後是否還有 parent_set_id reference？
- **Recommended answer**：
  1. 「root cycle 回 working」= **block** UI（root 若有 children 不允許 cycle，user 要先刪 children）；簡化 invariant
  2. ❌ no-op（cluster 內 step set_kind 永遠 dropset、不允許 cycle）
  3. N/A（被 (1) 擋掉）
- **Open question count if all default ruled**：1 — UI block 時的提示文案 / Haptic feedback 等實作細節，但不卡 implementation

### Round C — Rest timer Cluster root rest_sec source + auto-popup modal 視覺

- **Background**：ADR-0019 Q2.4 拍板「Auto-popup 啟 timer 用 cluster root（parent）的 `rest_sec`」，但 cluster member 是 2 個 session_exercise row（parent + child，per ADR-0018 v014），rest_sec 在哪一邊？
- **Questions**：
  1. Cluster root rest_sec source = parent session_exercise.rest_sec 對嗎？（child session_exercise.rest_sec 即使有值忽略）
  2. Auto-popup modal 大字倒數 — fullscreen 還是 sheet halfscreen？
  3. Modal 顯示時 user tap chip 加減 timer — modal 內也要顯 ±？
  4. Timer 0 → vibrate + 短音；modal 自動關還是停留 user 手動 [完成]?
- **Recommended answer**：
  1. ✅ parent session_exercise.rest_sec（per ADR-0019 Q2.4 「cluster root」= cluster parent session_exercise；schema 上 parent 不是 set row）
  2. Halfscreen sheet（不擋 user 視線 + 維持下方動作卡 visible）
  3. ✅ modal 內也加 ± btn（chip 跟 modal 視覺對齊）
  4. 自動關 + chip 消失（per ADR-0019 Q2.3 c F1 「chip 消失，不擋互動」）
- **Open question count if all default ruled**：0

### Round D — In-session RS picker URL params + dup pair guard

- **Background**：Card 6 需要把 `[⊕ 加動作]` 接 library picker；既有 picker URL param naming（fromTemplateId / fromProgram / fromCycle / fromDay 等）一坨；session 入口需要新 param。
- **Questions**：
  1. URL param 取名 `targetSessionId=` 還是 `fromSessionId=`？（語意 vs 慣例）
  2. Session 內已有同 RS 是否 block 加第 2 個（dup pair guard）？還是允許多份？
  3. picker 內 tap RS 立刻 explode（不需 [完成] 確認）vs 進入 multi-select 模式累積？
  4. RS explode 後 session 新加的 2 個 session_exercise 自動 expand（c-2 active）還是仍 collapsed？
- **Recommended answer**：
  1. `targetSessionId=`（語意：「目標 session = 把選的物件加進這個 session」）
  2. ❌ 不 block（user 可能想做兩組同 RS；既有 superset 內已實作 dup guard 是 prevent **重複建立 RS entity**、不是 prevent **同 session 內多次使用**）
  3. tap 立刻 explode（per ADR-0019 Q7「整個 RS（含 parent A + child B）snapshot 進當前 session」單一 tap）
  4. 自動 expand（user 剛挑進來 → 立刻可開始記）
- **Open question count if all default ruled**：0

### Round E — Start UX：Templates tab 入口 vs Today tab 入口統一?

> **2026-05-24 grill 完成、拍板大重構，落地 [ADR-0024](../adr/0024-training-tab-three-sections-and-templates-tab-removal.md)。原 5 Q + recommended 段落保留作 history、實際拍板見下方 22 sub-decision ledger。**

- **拍板摘要**：Today tab 改名「訓練」(zh) / Training (en) + 砍 Templates tab + idle 分 3 區塊（計劃訓練 / 空白訓練 / 模板訓練）+ bodyweight pre-prompt 移除 + assisted 動作彈窗 block-only + Settings 新增體重 row + 獨立 slice 10g ship。

- **22 sub-decision 拍板 ledger**：

  | Sub-Q | 主題 | 拍板 |
  |---|---|---|
  | Q1 | In-session view 切換 | **A. Mode switch** — 1 tab 兩態，現行行為延續 |
  | Q1.2a | 計劃訓練內容廣度 | **a1.** 只今天單一 template |
  | Q1.2b | 無 active program fallback | **b2.** Empty state + Programs tab CTA |
  | Q1.2c | 今天 cell = 休息 / 空白 | **c1.** 灰底「今天休息」、無 tap |
  | Q1.3d | 模板 list 顯示樣式 | **d1.** 整 list 攤開（不折疊） |
  | Q1.3e | [+ 新建模板] 位置 | **e1.** 模板訓練 heading 右上角 |
  | Q1.3f | 模板數 = 0 顯示 | **f1.** Empty state CTA + 保留 [+ New] btn |
  | Q1.4g | Tab 順序 | **g1.** 訓練 / Programs / Library / History / Settings |
  | Q1.4h | 訓練 tab icon | **h2.** figure.run / dumbbell（實作時挑） |
  | Q1.4i | Tab title 語言 | **i1.** 跟 i18n locale (per ADR-0023) |
  | Q1.5 | Sticky scope | **A. 維持 global**（plan 原 recommended「per template」為 stale-plan-default、被否） |
  | Q2.1j | Bodyweight 寫入時機 | **E+補丁** — eager auto-pull + assisted 彈窗補 |
  | Q2.1k | Body_metric 時效性 | **無限制**，永遠拿最後一筆 |
  | Q2.2l | Assisted 彈窗 trigger | **l1.** `appendSessionExercise` 那一刻 |
  | Q2.2m | 已有 snapshot 後又遇 assisted | **m1.** 不再彈 |
  | Q2.3o | Modal 拒填行為 | **o1. Block** — 必填、無 Skip btn |
  | Q2.4p | Settings 體重 UI | **p1.** 加「體重」row + mini sheet（quick-update only、不含 history CRUD） |
  | Q3q | 程式碼搬遷 | **q2.** 抽 `<TemplateListSection>` shared component |
  | Q3r | ADR 策略 | **r3.** 新 ADR-0024 |
  | Q3s | Slice 切分 | **s2.** 獨立 slice 10g（跨 lifecycle 10e 解耦） |

- **翻盤的既有拍板（stale-plan-default）**：
  - ❌ Plan Q3 原 recommended「sticky per template」→ 否決，維持現行 global single-key（code ground truth）
  - ❌ Plan Q1 原 recommended「Quick Start Freestyle 直接走 freestyle path、不開 sheet」→ 升級為「空白訓練」獨立區塊，但實作上仍 = 同 direct path
  - ❌ ADR-0019 § Q9a「Templates tab → sheet」→ Templates tab entity 砍除、sheet invocation 改在「模板訓練」區塊（sheet logic 不動）

- **Open question count post-grill**：0（實作細節留給 slice 10g：SF Symbol icon 確切名稱、Settings row 排序位置、3 區塊 vertical spacing 等 visual polish）

- **原 5 Q + recommended（history）**：
  1. ~~Today tab 還保留「直接 Start Freestyle Session」按鈕嗎？~~ → 升級為「空白訓練」獨立區塊
  2. ~~如果統一移到 Templates tab → Today tab 變成「只看當下 active session / 空 state 引導去 Templates」？~~ → 翻盤：Templates tab 砍除、Today tab 變「訓練」+ 3 區塊
  3. ~~Sticky last-selected 是 per template 還是 global 一份？~~ → 維持 global（plan recommended 「per template」為 stale-plan-default）
  4. ~~「無」週期 + 強度 picker 隱藏：fade-out animation 還是 instant？~~ → 未討論（sheet 本身不動、留實作）
  5. ~~`[+ 新增週期]` / `[+ 新增強度]` 走 wizard 還是 minimal modal？~~ → 未討論（sheet 本身不動、留實作）

### Round F — Session 詳情頁 4-button bar 行為 polish（topic 重定義 2026-05-24）

> **2026-05-24 stale-plan-default 翻盤**：原 Round F 5 題（finish diff 偵測時機 + 3-option dialog 排序 + diff summary + cluster swap diff + template cluster schema 寫回）**全部 obsolete** — ADR-0019 2026-05-18 wave 12 翻盤段已把整個 finish dialog 砍除、Save-back domain/repo/screen pipeline 全砍為 dead code。Round F topic 重定義為「session 詳情頁 4-button bar polish」5 題。

- **拍板摘要**：edit mode 期間 3 button 維持 active（已知 risk 接受）+ [儲存模板] 反饋改 toast + [另存模板] default name 三層 fallback + [刪除] confirm 加 session.title + edit mode 加 header [編] chip。歸入 slice 10e bundle、~3-4 commit / ~6-8 test。

- **5 sub-decision 拍板 ledger**：

  | Sub-Q | 主題 | 拍板 |
  |---|---|---|
  | Q1 | Edit mode 期間 [儲存模板] / [另存模板] / [刪除] 3 button 行為 | **不動**（維持 active）— 已知 risk：edit mode transactional 保護只涵蓋 session-side、user 在 edit mode 按 [儲存模板] 會 immediate overwrite template、之後 [返回] discard session edits 也無法 rollback template。**接受此 risk**，理由：user 心智模型 = edit mode 是「session 編輯」、template 寫入是 explicit 動作。 |
  | Q2 | [儲存模板] silent overwrite 成功反饋 | **B. 改 toast** — Alert 2 tap 過重、toast 1 tap auto dismiss。需引 toast lib 或自寫 minimal toast component（codebase 目前無 toast pattern）。 |
  | Q3 | [另存模板] sheet default name 規則 | **C. session.title → linked.template_name → dateLabel** 三層 fallback。session.title 非空優先（最貼 user 意圖）；template-based fallback linked.template_name；freestyle fallback dateLabel。 |
  | Q4 | [刪除] confirm dialog body polish | **B. 加 session.title 確認**「『腿日 Q1 第3次』將被刪除...」— 防誤刪比量化代價（set count / volume）重要。 |
  | Q5 | Edit mode visual indicator | **D. Header title 加 [編] chip**「(腿日) [編]」— sticky header 永遠可見、不搶 vertical space、對齊 iOS Notes app convention。 |

- **翻盤的既有拍板（stale-plan-default）**：
  - ❌ 原 plan Q1「diff 偵測 one-shot at finish」→ topic 整題不存在（無 finish dialog 可承載 diff）
  - ❌ 原 plan Q2「3-option dialog 排序 儲存/另存/否」→ topic 不存在
  - ❌ 原 plan Q3「dialog 顯 diff summary」→ topic 不存在
  - ❌ 原 plan Q4「cluster swap 算 diff」→ topic 不存在（saveBackDiff dead）
  - ❌ 原 plan Q5「template-side cluster schema 寫回」→ topic 不存在
  - ❌ Card 10「Finish dialog 差異化」整題 deprecated → 拆出 Card 10R 「session 詳情頁 4-button bar polish」吸收 Round F 拍板

- **Open question count post-grill**：0

- **Known risk acknowledged (Q1)**：edit mode 期間 [儲存模板] 寫入不在 transactional 保護內。若 user 在 edit mode 改了 session、按 [儲存模板] 寫進 template、然後按 [返回] discard session edits → DB session 回滾但 template 已 leaked。**處理策略**：implement 時加 inline comment 標警告 + 加一個 test 鎖定 expected behavior（不 fix），未來若收到 user complaint 再 grill 翻盤改成 (A) disable / (B) snapshot template / (C) implicit commit。

- **原 5 Q + recommended（history，全 obsolete）**：
  1. ~~Diff 偵測 one-shot vs incremental~~ → 不存在
  2. ~~3-option dialog 排序~~ → 不存在
  3. ~~Diff summary~~ → 不存在
  4. ~~Cluster swap 算 diff~~ → 不存在
  5. ~~Save-back template-side cluster~~ → 不存在

### Round G — 歷史詳情頁編輯模式（topic 重定義 2026-05-24）

> **2026-05-24 stale-plan-default 翻盤**：原 Round G 5 題全 obsolete — Card 12 大部分已 ship、Round G 5 個原 recommended 都已落地（in-place toggle ✅ / back dirty check ✅ / 即時 commit DB + snapshot restore ✅ / Save-back dead N/A / 4-button bar 行為 = Round F Q1 「不動」與原 plan「hide 3 button」相反）。
>
> Topic 重定義為「App force-kill 期間 edit mode snapshot 恢復策略」3 sub-decision。

- **拍板摘要**：persistent snapshot to `app_settings` JSON kv + 進 session detail focus 時自動 restore + 7d TTL + discardSession cascade clean + re-enter edit overwrite baseline。歸入 slice 10e bundle、~1-2 commit / ~5 test。

- **3 sub-decision 拍板 ledger**：

  | Sub-Q | 主題 | 拍板 |
  |---|---|---|
  | Q1 | Force-kill 期間 snapshot 保留策略 | **A. Persistent snapshot + auto-restore** — `enterEditMode` 時 also `setSetting('session_edit_snapshot_${session_id}', { snap, savedAt: now })`；進 session detail focus 時 check key、有則 restore + clear + toast「上次未完成編輯已還原」；commitEditMode + discard path 也 clear key。**不給 user 3-way prompt** — 直接 always restore，避免心智負擔。 |
  | Q2a | Snapshot TTL | **a1. 7 天** — restore 時若 snapshot 超過 7 天則 silent discard、不還原（避免 user 1 個月後看到不記得的還原）。 |
  | Q2b | discardSession 連動清理 | **b1. 連動刪除** `session_edit_snapshot_${id}` key — FK semantic、避免 orphan。 |
  | Q2c | 同 session 多次 enterEditMode | **c1. 覆蓋新 baseline** — 每次 enterEditMode = 新 snapshot、跟 React state behaviour 一致。 |

- **翻盤的既有拍板（stale-plan-default）**：
  - ❌ 原 Round G Q5「編輯模式 hide 3 button」→ 已被 Round F Q1「不動」翻盤
  - ❌ 原 Round G Q4「Save-back diff 不 trigger」→ topic 已不存在（Save-back dead）
  - ❌ 原 Card 12 plan「445 行 → 估 600+ 行 reimplement」→ stale，實際 `app/session/[id].tsx` 已 **3176 行**、HU1/HV1/HE1 全 ship、只剩 HR chart 待 slice 13

- **Open question count post-grill**：0（implementation 細節：toast 字串、TTL 是否要 expose 為 Settings、restore 失敗 fallback）

- **原 5 Q + recommended（history，全 obsolete）**：
  1. ~~in-place toggle vs new route~~ → 已 ship in-place
  2. ~~back / app background 自動保存 vs prompt~~ → back dirty check shipped；app background 由 Q1 持久化 snapshot 涵蓋
  3. ~~即時 commit DB vs dirty state~~ → 已 ship 即時 commit + snapshot restore
  4. ~~Save-back diff trigger~~ → Save-back dead，N/A
  5. ~~4-button bar hide vs disable in edit mode~~ → Round F Q1 已拍「不動」

---

## § 5 — Suggested slice 10c → 10f phasing

| Slice | Cards | 估計 commit | 估計 test case | 估計 file touched | Grill upstream |
|---|---|---|---|---|---|
| **10c**（set logger 主結構）| Card 1 + Card 2 + Card 5 | 7 commit | ~25 test | ~12 file | Round A + B（必須先 grill）|
| **10d**（rest timer + cluster write path + cluster card）| Card 3 + Card 6 + Card 7 + Card 4 | 7 commit | ~22 test | ~14 file | Round C + D（必須先 grill）|
| **10e**（lifecycle 全套）| Card 9 + Card 10R + Card 11 + Card 12R（Card 8 拆出 → 10g、原 Card 10/12 deprecated）| ~7 commit | ~19 test | ~12 file | Round F ✅ + Round G ✅（皆已完）+ (Card 11 schema verify) |
| **10f**（歷史頁 layout）| 🗑️ deprecated — Card 12 大部分已 ship、剩 HR chart 留 slice 13 | — | — | — | — |
| **10g**（訓練 tab 重構）| ADR-0024 全部範圍（取代原 Card 8）| ~6 commit | ~12 test | ~10 file | Round E ✅（已完）+ 依賴 10c/10d/10e 元件 ship 與否皆可 |

### Slice 10c bundle 詳細

- 估時：1 週（已 grill round A+B 完）
- Commits：
  - C1.1 setRowReducer pure + test
  - C1.2 setRepository gesture helpers + test
  - C1.3 set-row-content + swipeable wire + index.tsx Expanded body
  - C2.1 clusterMath + setRepository cascade + tests
  - C2.2 dropset-cluster UI wire
  - C5.1 exerciseRepository updateExerciseNotes + sessionRepository updateSessionExerciseRestSec + tests
  - C5.2 ⚙️ menu 3 sheet UI wire
- 影響 ADR：ADR-0012 § Per-row 5 gesture 落地（無 amendment）；ADR-0019 Q5 落地（無 amendment）
- Smoke gate：iOS Simulator 走 5 gesture + dropset cluster + ⚙️ menu 3 sheet roundtrip

### Slice 10d bundle

- 估時：1.5 週（含 Round C+D grill）
- 風險 cards：Card 3（AppState BG2 校時）+ Card 6（picker URL params 衝突）
- 依賴：Card 7 cluster-card 需要 Card 1 set-row 元件、Card 6 RS picker 需要 Card 7 cluster-card 渲染

### Slice 10e bundle

- 估時：1.5 週（含 Round F grill + Card 10 高風險 saveBackDiff 擴展；Card 8 拆到 10g 後 lifecycle scope 縮）
- 風險 cards：Card 10（diff 範圍擴展牽動既有 saveBackRepository apply 路徑）
- 依賴：Card 11 schema verify 可能需要 v018 backfill migration（先 verify v010 是否落、無則加 1 commit）

### Slice 10g bundle（訓練 tab 重構，per ADR-0024）

- 估時：0.7 週（不含 grill — Round E 已完成）
- 風險 cards：(a) `appendSessionExercise` 注入 bodyweight modal 點 — 牽動既有 in-session view 流程；(b) `templates.tsx` 整檔砍除需 grep 0 ripple 確認
- 依賴：可獨立 ship、與 10e lifecycle 解耦
- Commits（6 estimated）：
  - 10g.1 抽 `components/training/template-list-section.tsx` shared component（純 refactor、行為等價）
  - 10g.2 `app/(tabs)/index.tsx` idle 區改 3 區塊 layout + 「計劃訓練」today resolver
  - 10g.3 `_layout.tsx` tab rename / icon / 砍 templates entry + 刪 `templates.tsx`
  - 10g.4 Settings 「體重」row + mini sheet + `insertBodyMetric` wire
  - 10g.5 Bodyweight snapshot E+補丁 model：session start auto-pull + `appendSessionExercise` assisted modal block
  - 10g.6 移除 Today pre-prompt（`prePromptVisible/preBwInput/onConfirmPrePrompt/onCancelPrePrompt` 整段砍）
- Smoke gate：3 區塊 layout / 空白訓練一鍵 / 模板訓練 sheet roundtrip / Settings 體重 quick-update / assisted modal block / Programs CTA navigation

### Slice 10f bundle — **2026-05-24 deprecated**

- Card 12「歷史詳情頁 HU1/HV1/HE1 layout」大部分已 ship、HR chart 留 slice 13 (HK landed)；Round G 新需求 (force-kill snapshot recovery) 拆 Card 12R 吸到 slice 10e。
- 整 slice 10f 不再需要、總時程 -1 週。

### Total estimate

- **4.5 週**（10f 砍除、Round F/G 拍板把 finish dialog + 整頁 reimplement 兩條主 risk 全消除；剩 slice 10c + 10d + 10e + 10g 四 bundle）
- 估 **~24 commit / ~75 test / ~50 file touched / 7 grill rounds upstream**（Round A-G 全完）

### Out of scope（slice 10g+ 後續）

- HK 真實寫入 + Watch session 5-tile 條件式 → slice 13（per ADR-0008）
- `template_exercise.rest_sec` orphan column DROP（v019 cleanup migration）
- 歷史詳情頁心率折線圖 hardcode demo → real data wire（slice 13 之後）
- PRD catch-up（per ADR-0019 § Known issues #5 已 wave-1 ship；slice 10c+ 新增 stories 視情況再 PRD diff）

---

## References

- ADR-0012 — Set logger schema + 5 gesture + dropset cluster B3
- ADR-0014 — session.title + 歷史詳情頁 4-button + 4-tile + 心率 chart + Save-back 共存 + Freestyle 升級
- ADR-0018 — Session-side cluster grouping schema（v014 parent_id + reusable_superset_id）
- ADR-0019 — Session UI/UX 整體 redesign（rest timer 系統、動作卡雙態、in-session stats panel、cluster 來源唯一性、lifecycle 全套、歷史頁 layout integration）
- `src/db/schema/v015_set_kind_and_clusters.ts` — set 三欄已落
- `src/db/schema/v016_session_runtime_data.ts` — rest_sec 雙欄 + auto_popup_rest_timer seed 已落
- `src/db/schema/v017_program_none_seed.ts` + `src/db/seed/v017ProgramNone.ts` — 「無」 program seed 已落
- `app/(tabs)/index.tsx:594-876` — Today screen + ExerciseCard collapsed/expanded（slice 10b ship）
- `app/session/[id].tsx` — 歷史詳情頁 read mode（Q10 待 reimplement）
- `components/template-editor/swipeable-set-row.tsx` — Template editor 既有 swipeable port reference（session 版要新建避免互相污染）
- `src/domain/template/saveBackDiff.ts:194-261` — Save-back diff 既有（Q9 Sticky 3 要擴範圍）
- `src/adapters/sqlite/sessionRepository.ts:104-180` — session_exercise schema 已含 `parent_id` + `reusable_superset_id` + `rest_sec` 三欄
