# Set Logger + Session UI Roadmap (synthesis 2026-05-23)

Synthesis of ADR-0012 (set logger redesign), ADR-0019 (session UI/UX integral redesign),
and the v014/ADR-0014 Q6 / Q7 deferred ledger — assessed against current code on
branch `slice/10c-set-logger-and-menu @ 0cdbb69`. Intended as the briefing doc
for the next slice (10e+) grill.

Sources read end-to-end:
- ADR-0012 (set logger schema + 5 gesture / cluster B3 / dropset chain)
- ADR-0019 (session integral redesign — Q1-Q10 + slice 10a / 10b / 10c / 10d ship logs + 翻盤 ledger)
- ADR-0014 (session.title + history detail 4-button + 4-tile + HR chart)
- ADR-0013 (per-exercise notes — superseded by ADR-0017 Q5)
- ADR-0018 (session-side cluster grouping schema v014 + Q6 deferred status)
- ADR-0016 (template editor) — only for delta vs in-session UX

Code probes (read-only):
- `app/session/[id].tsx` (3149 lines), `app/(tabs)/index.tsx` (3160 lines)
- `app/exercise-picker.tsx` (thin wrapper around `(tabs)/library.tsx`)
- `components/session/{cluster-card,rest-timer-modal,session-stats-panel,template-meta-sheet,body-data-sheet,session-time-editor-sheet}.tsx`
- `components/shared/{set-row-content,swipeable-set-row,numeric-keypad,set-note-sheet,segmented-progress-bar,reorder-exercises-sheet}.tsx`
- `app/(tabs)/library.tsx` (RS picker tab wired)
- `app/(tabs)/settings.tsx` (auto-popup rest timer Switch wired)

## ADR-0012 Status Matrix

### Schema (v008-equivalent — actually shipped over v015 + v018 + v019)

| Decision | Status | Evidence | Remaining work |
|---|---|---|---|
| D1: `set.set_kind` enum (warmup / working / dropset) | ✅ | v015 migration (`tests/db/v015SetKindAndClusters.test.ts`); `cycleSessionSetKind` domain module + UI label cycle | — |
| D2: `set.is_logged` 兩態 row (◯ / ✓) | ✅ | v015; tap-✓ toggle wired in Today + session detail edit mode | — |
| D3: `set.notes` per-set 備註 (cluster 級存 root) | ✅ | v018 migration (`tests/db/v018SetNotes.test.ts`); `SetNoteSheet` invoked from right-swipe `[📝 備註]` | — |
| D4: `set.position` 顯式排序 | ✅ | v015 + `reorderSessionSetsForExercise` (`tests/db/reorderSessionSets.test.ts`) | — |
| D5: `set.parent_set_id` (dropset cluster B3) | ✅ | v015 + `addSessionDropsetCluster` / `addSessionDropsetRow` / `removeSessionDropsetRow` (`tests/db/clusterDropset.test.ts`, `tests/db/sessionDropsetRow.test.ts`) | — |
| D6: `set.session_exercise_id` (NEW — not in ADR-0012, added wave 17 `5/18`) | ✅ | v019 migration + `sessionExerciseIsolation.test.ts` 7 cases — set-isolation per session_exercise so two RS sharing the same exercise don't cross-pollute | architectural addition that the ADR does not yet reference; ADR-0012 amendment recommended (see below) |
| D7: `template_exercise.warmup_set_count` + `working_set_count` (rename of planned_sets) | ⚠️ | warmup/working counters used by `prefillSessionExerciseFromLastSession`; template editor uses `default_sets`. Rename not literal in schema | low — column name vs ADR text discrepancy; behavior matches |
| D8: deprecate `set.is_warmup` / `set.is_skipped` | ✅ | Per ADR-0019 § "Slice 10a Q2" — grep verified `set` table never carried `is_warmup` at runtime; nothing to migrate | — |

### Per-row affordance (5 gesture)

| Decision | Status | Evidence | Remaining work |
|---|---|---|---|
| G1: tap label cycles 熱 → #N → D# → 熱 | ✅ | `src/domain/set/cycleSessionSetKind.ts` (chain-aware variant `cycleSessionSetKindClusterAware`); `tests/domain/cycleSessionSetKind.test.ts` | — |
| G2: tap ✓ toggles `is_logged` (no menu, no confirm) | ✅ | `onToggleLogged` in Today + cluster card cycle-level `onToggleClusterCycle` | — |
| G3: right-swipe → `[新增] + [📝 備註]` two buttons | ✅ | `SwipeableSetRow.swipeRightActions`; insert new set after, edit set.notes via `SetNoteSheet` | — |
| G4: left-swipe → `[刪除]` red button (no confirm) | ✅ | `SwipeableSetRow.swipeLeftActions`; one-tap DELETE | — |
| G5: long-press → drag-reorder mode | ⚠️ | Implemented via `NestableDraggableFlatList` on set rows + `reorderSessionSetsForExercise`. ADR-0013 amendment proposed "dedicated reorder list screen" instead; current impl follows ADR-0012 inline gesture (ADR-0013 amendment effectively rolled back without a ledger row) | flag for next grill — keep inline or follow ADR-0013 dedicated screen? |
| G6: inline edit reps / weight (NumericKeypad) | ✅ | `SetRowContent.onTapNumber` → `NumericKeypad` modal pure domain (`src/domain/keypad.ts`, 31 tests) | — |

### Dropset cluster (B3) + cluster-level gestures

| Decision | Status | Evidence | Remaining work |
|---|---|---|---|
| DR1: cluster首step has D# label + ✓; followers have `[−]` / `[− +]` button-only | ✅ | `set-row-content.tsx` follower rendering; dropset chain semantics covered in `dropset-chain-semantics` skill + `replayGate.ts` | — |
| DR2: cluster 內 step 不接受 swipe gesture | ✅ | Followers render inside ONE `SwipeableSetRow` per cluster head (single swipe unit per cluster) | — |
| DR3: `is_logged` 只在 cluster 首 step 有意義 | ✅ | Aggregation honors chain (`computeExerciseProgress` chain-aware after wave 13) | — |
| DR4: cluster 左滑刪 entire cluster, 右滑加 entire new cluster, 長按 cluster reorder | ✅ | Wave 13 fix replayCardSets / clusterCard volume chain-aware; cluster-card.tsx ⚙️ + cycle-row drag | — |
| DR5: per-cluster ⚙️ menu 6 槽 (3 main + 2 history + 1 utility) | ✅ | `onSettingsPress` in Today branches on `partnerExerciseId` (per ADR-0019 § Q5 (b) slice-10c 修訂) | — |
| DR6: cluster 整 cluster 跳過 PR engine | ✅ | PR engine filter respects `parent_set_id`; covered in `prEngine.test.ts` | — |
| DR7: cluster 容量 aggregation = Σ all steps | ✅ | `computeClusterVolume` (chain-aware after wave 13) | — |

### Computation rules + per-exercise card structure

| Decision | Status | Evidence | Remaining work |
|---|---|---|---|
| C1: chip 永 0–100% (分子 ⊆ 分母 superset) | ✅ | `computeExerciseProgress.test.ts` 7 cases | — |
| C2: 編號規則 (working 1.. independent of dropset D#) | ✅ | `workingSetOrdinal.ts` + `setLabels.ts` (computeHistorySetLabels) | — |
| C3: Freestyle 加動作預建 row (warmup_set_count + working_set_count) | ✅ | `appendSessionExercise` planned_sets=3; `prefillSessionExerciseFromLastSession` covers Template-based + per-exercise memory | — |
| C4: per-exercise card top-right 容量 chip + 系統主色 bar | ✅ | `SegmentedProgressBar` + `computeExerciseProgress` in card header (slice 10c Phase 3 修訂版 — sets/target line 砍除, chip 主位) | — |
| C5: session 頂層 stats panel (Q6 翻盤) | ⚠️ partial | `SessionStatsPanel` 3-tile (duration / 容量 / 動作數) wired in Today + session detail. 5-tile Watch variant + kcal/HR deferred to slice 13 per ADR-0019 slice-10c 修訂 (also Agent A drift audit M1/M2) | slice 13 work — wait for HealthKit |
| C6: session 底部 bar 只剩 `[⊕ 加動作]` | 🔄 | ADR-0012 拍板 "只剩加動作 ➕"; current Today + session detail edit-mode have **two** buttons: `[+ 動作]` + `[傳至手錶 ⌚]` (slice 10c Phase 5 落地). Watch handoff placeholder = pre-slice-13 forward-port | refresh — does Watch handoff stay on bottom bar in v1 or get postponed? grill candidate |
| C7: per-exercise card 中 per-exercise 備註欄 ("點擊輸入備註" placeholder) | 🔄 | ADR-0013 Q5.3 拍板 expanded 卡顯 SF Symbol `text.bubble` + 直行純文字 — currently **not rendered** in expanded session card. ADR-0017 Q5 升 per-Exercise 全局 + ADR-0019 § Q5 (a) menu entry「📝 編輯備註」 is the only surfaced edit path. The display affordance on the card itself is missing | medium — confirm whether expanded display still desired given menu-only edit |

### Save-back / engine

| Decision | Status | Evidence | Remaining work |
|---|---|---|---|
| E1: PR engine 過濾 `set_kind != 'working'` | ✅ | `prEngine.ts` + `prQuery.ts` filter + tests | — |
| E2: volumeEngine 排 warmup, include working+dropset(cluster ✓ ⇒ Σ all steps) | ✅ | `volumeEngine.test.ts` + `clusterCard.ts` cluster volume helper | — |
| E3: saveBackDiff cluster aggregate | 🔄 | ADR-0019 § 翻盤 ledger 2026-05-18 row — Save-back domain/repo/screen pipeline orphan, 整題砍除; 模板入口移至 session detail sticky 4-button bar (silent overwrite). ADR-0012 § "saveBackDiff cluster aggregate" no longer relevant | docs hygiene — already captured in ADR-0014 + ADR-0019 amendments |

### Set logger summary

**ADR-0012 is ~95% shipped.** Open items:
- **C6**: bottom bar = `[⊕ 加動作]` alone vs current `[+ 動作] + [傳至手錶 ⌚]` (Watch handoff placeholder)
- **C7**: per-exercise 備註欄 display in expanded card (vs current menu-only edit)
- **G5**: long-press reorder is inline (current) vs dedicated reorder screen (ADR-0013 amendment)
- **D6 (new)**: schema added `set.session_exercise_id` (v019) post-ADR — ADR-0012 should be amended to acknowledge.

## ADR-0019 Decision Matrix

ADR-0019 ships in waves (slice 10a foundation → 10b card layout → 10c set logger + menu → 10d rest timer → upcoming 10e+). Per-question audit:

| Decision | Status | Evidence | Remaining work |
|---|---|---|---|
| Q1: scope = A1+ / B1 / C1 / D2 | ✅ | progressive ship | — |
| Q2.1: 系統預設 60s hardcoded | ✅ | Today + detail use `?? 60` fallback | — |
| Q2.2 (A): in-session 改 `session_exercise.rest_sec` | ✅ | `updateSessionExerciseRestSec` + ⚙️「⏱️ 休息秒數」 sheet | — |
| Q2.2 (B): schema v01X `template_exercise.rest_sec` + `session_exercise.rest_sec` | ⚠️ | v016 added both; v009 had `template_exercise.rest_seconds` long ago — v021 DROPped orphan `template_exercise.rest_sec` (wave 13c) leaving `rest_seconds` canonical + `session_exercise.rest_sec` canonical. Schema is bridged but `rest_seconds` ↔ `rest_sec` naming asymmetry persists | low — naming-only debt; covered by domain mapping in `templateRepository.getTemplate` |
| Q2.2 (C): cluster 內 step 之間不啟 timer; cluster root ✓ → root.rest_sec | ✅ | `onToggleClusterCycle` uses `group.a.exercise.rest_sec ?? 60` | — |
| Q2.2 (D): 「另存」UI 共用歷史頁 flow | 🔄 | ADR-0019 翻盤 2026-05-18 — Save-back pipeline 整題砍除; finish dialog 改詳情頁 sticky bar. Q2.2 (D) 失語境 | — (moot) |
| Q2.3 (a): Settings `auto_popup_rest_timer` | ✅ | settings.tsx Switch + `getAutoPopupRestTimer` round-trip + `tests/db/autoPopupRestTimerSetting.test.ts` | — |
| Q2.3 (b)/(c)/(d): chip 概念 → X1 modal-only | ✅ | Slice 10d ship; `rest-timer-modal.tsx`; 翻盤 ledger 2026-05-20 row | — |
| Q2.3 (c) Timer 0 → 震動 + 短音 + auto-dismiss | ⚠️ | 震動 + auto-dismiss 落地; **短音 F1 deferred to slice 13** (expo-av integration) | slice 13 |
| Q2.4: 一 cycle 一 ✓ semantic | ✅ | `cluster-card.tsx` cycle row + `markClusterCycleLogged` atomic; `tests/db/clusterAtomicLog.test.ts` | — |
| Q3 a-1 to e-3: 動作卡 collapsed default + only-one-expanded + scroll-list | ✅ | `expandedExerciseId` single-id state in Today + session detail; ADR-0019 § Q3 副作用拍板 落地 | — |
| Q4: set row ⋯ icon (I1) — 維持砍 | ✅ | `set-row-content.tsx` 無 ⋯ icon | — |
| Q5 (a): ⚙️ menu 「📝 編輯備註」 | ✅ | `onSettingsPress` 派發到 `SetNoteSheet` 全局 `exercise.notes` (via `updateExerciseNotes`) | — |
| Q5 (b): ⚙️ menu 3 主項 + 1 reorder (+2 history shortcuts cluster context only) | ✅ | per ADR slice-10c 修訂; Today `onSettingsPress` matches the cluster vs solo branching | — |
| Q5 (c): 編輯 UI = bottom sheet | ✅ | `SetNoteSheet`, `NumericKeypad` modal | — |
| Q5 (d): 「換動作」flow = ⚙️ 🗑️ → [⊕ 加動作] | ✅ | 🔀 砍除; ADR-0014 sibling rename moot | — |
| Q6: P1 in-session stats panel | ⚠️ | 3-tile in-session live duration + 容量 + 動作數 ✅; 5-tile Watch variant + kcal/HR deferred to slice 13 (per ADR-0019 slice-10c 修訂) | slice 13 |
| Q7: cluster 來源唯一性 (Template snapshot OR RS picker) | ✅ | `library.tsx` 超級組 tab; `appendReusableSupersetToSession` explode path; ADR-0018 deferred 6 → 3 (write-path closed) | — |
| Q7 寄生 (i) K1 picker | ✅ | `library.tsx` 11 MG sidebar + 超級組 tab | — |
| Q7 寄生 (ii) B1 即時新建 RS | ✅ | `newlyCreatedSupersetId` mailbox round-trip per ADR-0017 9.8b | — |
| Q7 寄生 (iii) L1 自動保存 | ✅ | superset insert path | — |
| Q7 寄生 (iv) ADR-0018 amendment | ✅ | ADR-0018 § 2026-05-16 Amendment 已落地 | — |
| Q8 (a)–(f): cluster block layout (left bar RS color + banner + cycle ✓ + asymmetric "—") | ✅ | `cluster-card.tsx` 873 LOC + `computeClusterCycles` / `computeClusterCycleProgress` / `computeClusterVolume`; AS1 灰字 placeholder; H1 縱條色 | — |
| Q9 (a) Start UX = bottom sheet (週期 + 強度 picker) → [編輯模板] / [開始訓練] | ✅ | `start-template-sheet.tsx` (756 LOC) | — |
| Q9.2 (i) FB1 / N1 / P1 / B1 sticky last-selected etc. | ✅ | `start-template-sheet`; v017 program-none seed (`tests/db/v017ProgramNoneSeed.test.ts`); `cloneTemplateWithSubTag` 5 case test | — |
| Q9.2 terminology rename (週期 / 強度 / 通用) | ✅ | Slice 10c wave 11 修訂; ADR-0019 § Slice 10a Q4 落地; ADR-0003 amendment pending one sweep | — (small ADR-0003 sweep due) |
| Q9 (b) Pause = PS0 無 pause | ✅ | No pause UI on session header | — |
| Q9 (c) Discard via header `[⋯]` menu | ✅ | `discardSession` + header `[⋯]` ActionSheetIOS; menu also has「Body data」shortcut (slice 10c expansion, drift audit L1 accepted) | — |
| Q9 (d) Finish dialog 差異化 (Template diff-aware 3-option / Freestyle 2-option) | 🔄 | **翻盤 2026-05-18** — dialog 整題砍除; 「完成」 → endSession + push `/session/[id]` 詳情頁; 模板操作改 sticky 4-button bar; silent overwrite linked template | — (moot; ADR-0019 ledger row exists) |
| Q9 Diff scope (Sticky 3) | 🔄 | Save-back pipeline 退場後 diff scope 失語境 | — (moot) |
| Q10 HU1: 砍 3 段統一動作清單 | ✅ | session detail render uses `orderedItems` by `ordering ASC` + solo / cluster inline mixed (`renderEditBody` / read-mode loop) | — |
| Q10 HV1: 動作清單全 expanded default + 「隱藏未打勾」switch | ✅ | `hideUnchecked` Switch + filter helpers; 動作清單全展開 default (slice 10c 修訂 drift audit L3 accepted) | — |
| Q10 HE1: `[編輯訓練]` → 整頁 edit mode + ✓ 完成編輯 | ✅ | `editMode` state + `enterEditMode` / `exitEditMode` snapshot/restore pattern; bottom sticky bar `[+ 動作][儲存模板][另存模板][刪除]` (edit mode swaps 編輯訓練 → + 動作) | — |
| Schema v015 / v016 / v017 / v018 / v019 / v021 / v022 | ✅ | All landed per ADR-0019 schema 影響總覽 + 已新增 v019 set.session_exercise_id (slice 10c wave 17) + v020 template color backfill + v021 DROP `template_exercise.rest_sec` orphan + v022 `program_sub_tag` (→ ADR-0021) | — |

### Slice 10d (rest timer modal-only) — X1 / S1 / E2 / BG2

| Decision | Status |
|---|---|
| X1 chip 砍除, modal-only | ✅ |
| S1 Settings 開關 | ✅ |
| E2 session/[id] edit mode 不接 timer | ✅ |
| BG2 AppState wall-clock self-correct | ✅ |

### ADR-0019 summary

**ADR-0019 is ~88% shipped.** Open items:
- **Q6 / C5**: 5-tile Watch variant + kcal/HR (slice 13, blocked on HealthKit)
- **Q2.3 (c)**: timer-0 短音 F1 (slice 13, blocked on expo-av)
- Q9 (d) finish dialog: explicitly retracted (翻盤 ledger 2026-05-18) — docs already updated; no code work
- ADR-0003 terminology amendment sweep (週期 / 強度 / 通用 label propagation) — small docs follow-through; CONTEXT.md already updated

## ADR-0014 Q6 / Q7 Deferred Items

ADR-0014 has no explicit "Q6 deferred" section — the Q6 deferred batch lives in **ADR-0018 § Out of scope** (six items), under the label "session UI/UX grill — Q6 DEFERRED". ADR-0019 § Q7 + Q8 resolved these. Status today:

| Original deferred (ADR-0018 § Out of scope) | Resolution path | Status |
|---|---|---|
| C-1 cluster 標記入口 (gesture / picker / multi-select) | ✗ 移除 (ADR-0019 Q7 cluster 來源唯一性) | ✅ closed |
| C-2 cluster block tap target / interaction | ADR-0019 § Q3 collapsed/expanded model + § Q8 一 cycle 一 ✓ | ✅ shipped (cluster-card.tsx + clusterCard domain module) |
| C-3 cluster header 位置 (banner / vertical label) | ADR-0019 § Q8 H1 = 左側縱條 RS 色 + 上方 banner "動作 A · 動作 B" | ✅ shipped |
| C-4 promote ad-hoc to RS | ✗ 移除 (沒有 ad-hoc cluster 存在) | ✅ closed |
| C-5 asymmetric highlight | ADR-0019 § Q8 AS1 = B 側「—」灰字 placeholder, 不加 highlight | ✅ shipped (cluster-card.tsx renders "—" for short side) |
| C-6 un-cluster (拆 cluster) | ✗ 移除 (取消 cluster = ⚙️ 🗑️ 刪除整 cluster) | ✅ closed |

**There are no truly-deferred Q6 items remaining.** All six are either shipped (C-2 / C-3 / C-5) or explicitly retracted (C-1 / C-4 / C-6). The ADR-0014 v014 Q6 ledger is complete.

ADR-0014's own latent open items (separate from the Q6 deferred set):

| Latent open | Status |
|---|---|
| Q7.4 freestyle session.title='' fallback UI label 「自由訓練」 | ✅ shipped (collapsed list + in-session header use the fallback) |
| Q7.5-α 衝突偵測 hard block + escape | ✅ shipped via `findTemplateByTriple` + `cloneTemplateWithSubTag` `DUPLICATE_TEMPLATE_TRIPLE` |
| 2026-05-12 Amendment: header `[⋯]` 4-button + 4-tile + HR chart | ⚠️ 4-tile + HR chart deferred to slice 13 (per ADR-0019 slice-10c 修訂) |
| Sibling rename + 4-branch 「儲存模板」 logic | 🔄 **retracted 2026-05-18** — silent overwrite; freestyle 升級走「另存模板」; ADR-0014 has inline marker but the body still describes the old 4-branch path |

## Cross-ADR Conflicts

### 1. Finish session flow

| ADR | Says |
|---|---|
| ADR-0012 (line 152) | session 底部 bar 只剩 `[⊕ 加動作]` |
| ADR-0014 | session 結束 → Save-back dialog 觸發 (內容差異); 歷史頁三按鈕 (身份維度) |
| ADR-0019 Q9 (d) | Template diff-aware 3-option dialog / Freestyle 2-option dialog |
| ADR-0019 翻盤 ledger 2026-05-18 row | **整題砍除** — 完成 → endSession + 跳詳情頁; 模板操作改 sticky 4-button bar; silent overwrite |
| Code (`finalizeEndAndRoute`) | direct endSession + `router.push('/session/${id}')` — no dialog |

**Recommended reconciliation**: The ADR-0019 ledger row is the canonical truth. ADR-0014 still carries the original 4-branch description with an inline 修訂 marker — readers must follow the marker. Cleanup option (low-priority): ADR-0014 body could be edited to consolidate the marker with a clearer "see ledger row 2026-05-18" pointer, but the current state is acceptable per existing翻盤 ledger discipline.

### 2. Session bottom bar contents

| ADR | Says |
|---|---|
| ADR-0012 | 只剩 `[⊕ 加動作]` |
| ADR-0019 Slice 10c Phase 5 落地 | `[+ 動作][傳至手錶 ⌚]` (Watch placeholder for slice 13) |

**Recommended reconciliation**: The Watch handoff button is a forward-port placeholder per ADR-0008 (Watch v1 scope, slice 11+). ADR-0012 line 150 should pick up an inline marker pointing at ADR-0008 + ADR-0019 slice-10c log. Low priority.

### 3. Long-press reorder (set rows)

| ADR | Says |
|---|---|
| ADR-0012 per-row affordance map | 長按 → drag-reorder mode (UPDATE set.position) |
| ADR-0013 amendment | 「移動動作」改用專屬重排列表畫面 (entry = ⚙ menu「↕ 移動動作」 OR 動作卡標題長按) |
| Code | Inline NestableDraggableFlatList drag-reorder for sets (per-row long-press); `ReorderExercisesSheet` for **exercise-level** reorder |

**Reconciliation**: ADR-0013's amendment is about **exercise-level** reordering (per the screenshot in ADR-0013 it shows a "deep" exercise list with handles, not a set list). ADR-0012's long-press is for **set-level** reordering inside one card. Both are shipped correctly — they target different granularities. ADR-0012 + ADR-0013 are not actually in conflict, just confusingly phrased. **Recommend**: clarifying inline note in ADR-0013 amendment ("exercise-level only; set-level reorder still inline per ADR-0012 G5"). Low priority.

### 4. Set logger `session_exercise_id` (v019)

| Document | Status |
|---|---|
| ADR-0012 schema 影響總覽 | Does not mention `set.session_exercise_id` |
| ADR-0019 schema 影響總覽 | Lists v019 |
| Code (`recordSetInSession` etc.) | Honors `session_exercise_id` since wave 17 (5/18 afternoon round 2) |

**Recommended reconciliation**: ADR-0012 amendment to acknowledge v019 isolation. The column is a hard architectural change (multi-RS-same-exercise isolation invariant) that should not live only in ADR-0019. Suggested amendment block at end of ADR-0012:

> 2026-05-18 wave-17 architectural addition — `set.session_exercise_id TEXT NULL` (v019) added to fix multi-RS-same-exercise set cross-contamination (e.g. two reusable supersets both containing Chest Dip in the same session). Within-session DELETE / REORDER paths scope by `session_exercise_id`; cross-session aggregate queries (history / PR / volumeEngine) unaffected. Legacy disjunction fallback (`session_exercise_id IS NULL`) preserved.

### 5. Per-exercise card 備註 display affordance

| ADR | Says |
|---|---|
| ADR-0012 (line 145) | 動作圖正下方、第一 set 上方 per-exercise 備註欄 (placeholder「點擊輸入備註」) |
| ADR-0013 Q5.3 | expanded 卡顯 SF Symbol `text.bubble` + 直行純文字 (non-empty only); collapsed 卡完全不顯示 |
| ADR-0019 Q5 (a) N1 | ⚙️ menu「📝 編輯備註」 entry → bottom sheet edit |
| Code | Menu-only edit (Today + session detail). No expanded-card display of `exercise.notes`. |

**Reconciliation**: Three ADRs describe slightly different things. ADR-0017 Q5 (referenced from ADR-0013 amendment) collapsed notes to per-Exercise global, killing per-template-exercise notes. The display (expanded card) is not currently rendered — confirm whether (a) ADR-0013 Q5.3 display still desired (`text.bubble` + 直行 expanded), or (b) menu-only is the intentional final state. **Likely grill candidate**.

### 6. ADR-0014 4-tile + HR chart vs ADR-0019 3-tile

| ADR | Says |
|---|---|
| ADR-0014 § 2026-05-12 Amendment | 詳情頁 4-tile (訓練時間 / 容量 / 動作數 / 大卡) + Watch-only 心率折線圖 |
| ADR-0019 § Q6 (b) slice-10c 修訂 | 5-tile Watch variant + 歷史頁 4-tile + 心率 chart 都 deferred to slice 13 |
| Code | `SessionStatsPanel` 3-tile (duration / volume / exercise count) used in both Today + session detail; 4-tile / HR chart not rendered |

**Reconciliation**: Already aligned via ADR-0019 slice-10c 修訂 — both ADR-0014 (4-tile) and ADR-0019 (5-tile in-session Watch variant) defer the kcal tile + HR chart to slice 13. Current 3-tile is the v1 interim. No new conflict.

## Proposed Next Slice (10e)

**Theme**: "Session UI cleanup + ADR ledger close-out" — finish the small surface-level items that did not make it into earlier waves, get the ADRs back into agreement with each other, and clear the remaining smoke-test dust so slice 10 closes cleanly before slice 11 (Watch v1 / HealthKit) opens.

This is intentionally a **light** slice (3 bundles, no schema migration, low risk). It avoids touching anatomy / i18n surfaces (Agent A/B/D territory) and stays inside the session UI / docs domain.

**Bundles** (3):

### Bundle 1 — Expanded per-exercise card notes display
- **Scope**: render `exercise.notes` (per-Exercise global, ADR-0017 Q5) inside expanded session card body, between the exercise image area and the first set row. Empty → don't render (no placeholder text per ADR-0013 Q5.3 final form). Style: SF Symbol-like icon (RN equivalent — vector glyph 💬 chip already used elsewhere) + secondary-grey 直行 text.
- **Files touched**:
  - `app/(tabs)/index.tsx` (Today expanded-card body)
  - `app/session/[id].tsx` (detail page expanded card — both read mode + edit mode)
  - Possibly a small `<ExerciseNotesPreview>` shared component if duplicated 3× — otherwise inline
  - No new domain module needed (`getExerciseNotes` already exists; just read on card expand)
- **Tests**: 2-3 component-level smoke tests OR (lighter) a pure helper `formatNotesPreview(notes: string | null)` with 4 cases.
- **Risk**: low (read-only render; no DB write)

### Bundle 2 — ADR-0012 amendment + ADR-0014 ledger consolidation
- **Scope**: Two small ADR edits:
  1. ADR-0012 appended amendment block noting `set.session_exercise_id` v019 architectural addition (text in Cross-ADR Conflicts #4 above ready to paste).
  2. ADR-0014 inline marker tightening — the body still describes the 4-branch "儲存模板" logic at length. Recommend adding a single bold pointer at the top of § "歷史詳情頁三按鈕" pointing readers to ADR-0019 翻盤 ledger 2026-05-18 row, and leaving the body as historical-amendment record per existing convention.
  3. ADR-0013 amendment: small inline note clarifying that "移動動作" amendment applies to **exercise-level** reorder only; **set-level** reorder remains inline per ADR-0012 G5.
- **Files touched**:
  - `docs/adr/0012-set-logger-redesign-schema-and-affordances.md`
  - `docs/adr/0013-per-exercise-notes-persistence.md`
  - `docs/adr/0014-session-title-and-history-detail-actions.md`
- **Tests**: none (docs only)
- **Risk**: low (pure docs)

### Bundle 3 — Bottom-bar Watch handoff button — gate behind slice-13 flag OR keep placeholder
- **Scope**: Grill candidate, not a unilateral build decision. Two options:
  - **(a) Keep**: Confirm `[傳至手錶 ⌚]` button is visible from slice 10e through slice 11. ADR-0012 inline marker + ADR-0019 slice-13 ledger row. No code change.
  - **(b) Hide until slice 11**: Wrap the button in a `__DEV__` / feature flag so Expo Go users on TestFlight (if any pre-slice-13) don't see a button that Alert-stubs.
- **Files touched**:
  - `app/(tabs)/index.tsx` (Today bottom bar)
  - `app/session/[id].tsx` (session detail bottom bar — currently doesn't have this button, only edit-mode `[+ 動作]`; double-check)
- **Tests**: none (UI affordance)
- **Risk**: low

**ADR amendments needed** (per Bundle 2):
- ADR-0012 — append v019 `set.session_exercise_id` amendment block
- ADR-0013 — exercise-level vs set-level reorder clarification
- ADR-0014 — top-of-section pointer to ADR-0019 ledger 2026-05-18 row

**Out of scope (defer to later)**:
- 5-tile Watch stats panel — slice 13 (HealthKit)
- HR chart in history detail — slice 13
- Rest timer 短音 F1 — slice 13 (expo-av)
- ADR-0003 terminology rename code propagation — already done in app/, schema column rename remains intentionally deferred (192 hits, internal naming)
- App Store / TestFlight prep — slice 11+

## Open Questions (grill candidates)

1. **Per-exercise notes display in expanded card** — Should the expanded session card render `exercise.notes` as preview text (ADR-0013 Q5.3 original) or remain menu-only (ADR-0019 Q5 (a) implicit)? Bundle 1 above assumes "yes, render", but this is a UX call and the simpler menu-only path is defensible too. Display takes one extra row of vertical space per card; notes are usually short cues but could be multi-line.
2. **Watch handoff button (`[傳至手錶 ⌚]`)** — Stays visible on session bottom bar from slice 10c onward, or gates until slice 11 lands real WatchConnectivity? Visible-with-placeholder onboards users; gated-until-real avoids confusion.
3. **`session_exercise_id` legacy fallback decay** — `recordSetInSession` and DELETE / REORDER paths keep a `session_exercise_id IS NULL` disjunction fallback for pre-v019 rows. v1 user has none of these. Can we drop the fallback to simplify queries, or is the carrying cost so low it's not worth touching? (Defensible either way.)
