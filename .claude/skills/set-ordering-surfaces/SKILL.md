---
name: set-ordering-surfaces
description: Map of EVERY place TrainingLog independently sorts / numbers session sets. Use when adding or changing a set sort key (e.g. display_rank), fixing "in-session OK but history/superset 沒同步" ordering bugs, or any "sets show in the wrong order / labels 亂跳" report. Each surface sorts on its OWN — a new sort key must be added to ALL of them or you get whack-a-mole (solo fixed → superset rows → superset labels → history each break separately). Touches sessionSetLayout.ts, clusterCard.ts, workingSetOrdinal.ts, setRepository.ts, exerciseHistoryRepository.ts, app/(tabs)/index.tsx, app/session/[id].tsx, app/exercise-history/[id].tsx.
---

# Session-set ordering / numbering surfaces

The runtime `set` table is rendered by SEVERAL independent code paths, each with
its OWN sort + working-set numbering. They do NOT share one sort. So when you add
or change a **sort key** (creation `ordering`, Watch `display_rank`, a future
key…), you must update **every** surface below, or the classic bug appears:
solo动作 syncs, but **superset rows**, **superset labels**, or **history** still
show the old order (`2026-06-02` displayRank slice — fixed each path one device-
smoke at a time).

## The 2026-06-02 rule: identity vs display

- **Identity / reconcile key** = `(session_exercise_id, set.ordering)`. `ordering`
  = creation/append order; the WC reconcile (`reconcileSessionTree`) matches base
  sets by it, so it must NEVER be re-stamped to encode display position.
- **Display sort key** = `set.display_rank` (v025, REAL nullable, backfill =
  ordering). The Watch carries its reorder / mid-insert order here. Every RENDER
  surface sorts by `display_rank ?? ordering` (ordering tie-break). NULL → legacy
  fallback (display == creation).

## The surfaces (audit ALL when a sort key changes)

| # | Surface | File | Sort site | Smoke |
|---|---------|------|-----------|-------|
| 1 | Solo card layout + labels (Today + session detail) | `src/domain/set/sessionSetLayout.ts` `computeSessionSetLayout` | `sorted = [...sets].sort(...)` | solo reorder/insert in-session + 該次詳情 |
| 2 | Superset/cluster **row order** | `src/domain/session/clusterCard.ts` `sortedSetsFor` (inside `groupClusterSides`) | per-side `.sort(...)` | superset reorder/insert in-session |
| 3 | Superset/cluster **working-set numbers** | `src/domain/set/workingSetOrdinal.ts` `computeWorkingSetOrdinals` | `sorted = [...sets].sort(...)` | superset labels read 1,2,3 not 3,2,4,1 |
| 4 | Per-exercise **history page** | `src/adapters/sqlite/exerciseHistoryRepository.ts` (SELECT + row type) + `src/domain/set/historySetLabel.ts` `computeHistorySetLabels` + `app/exercise-history/[id].tsx` render | SQL now SELECTs `s.display_rank`; `computeHistorySetLabels` sorts by `display_rank ?? ordering` | 動作卡「動作歷史」→ order matches in-session |
| 5 | Session-detail **read-mode solo row SEQUENCE** | `app/session/[id].tsx` `buildOrderedItems` (~:2645) | `sortSetsByDisplayRank(exSets)` | 該次詳情 solo rows render in display order (not creation order) |
| 6 | Session-detail **read-mode cluster row SEQUENCE** | `app/session/[id].tsx` `buildClusters` setsA/setsB (~:2605/:2611) | `sortSetsByDisplayRank(...)` per side | 該次詳情 superset rows AND labels agree (no 2,1,3) |

Plus the data must actually CARRY the key to those surfaces:
- **DB column**: `src/db/schema/vNNN_*.ts` migration + `setRepository.ts`
  `SessionSetWithExercise` type + `listSetsBySession` SELECT (feeds #1/#2/#3 on
  Today + session detail).
- **Wire (Watch→iPhone)**: Swift `SessionSnapshot.swift` field + CodingKey +
  `LiveMirrorProducer.swift` (`mergeSets` stamps it, `project`/`applyKindOverride`
  preserve it) → TS `handshake.ts SessionSnapshotSet` → `watchLiveMirrorReceiver`
  `parseLiveMirrorSnapshot` → `replaceLiveMirror` `reconcileSessionTree`
  INSERT + **all** UPDATE branches.
- `payloadSchema.ts` does NOT need it — the live-mirror `snapshot` is opaque
  `Record<string, JsonValue>` there.

## Gotchas burned in (2026-06-02)

- **Call sites pass the field structurally** — `SessionSetWithExercise` /
  `ClusterSetInput` / `WorkingSetOrdinalInput` adding an OPTIONAL `display_rank?`
  means existing object args (which already carry it) light up with no call-site
  change; tests/legacy callers without it fall back. Keep it OPTIONAL to avoid an
  avalanche.
- **History persists fine, only RENDER lagged**: live + end-session reconcile
  both write `display_rank` (same INSERT/UPDATE code). So an "history 沒同步"
  report is a RENDER-sort bug on surface #4 (and historically #2/#3), NOT a
  persistence bug. Don't go hunting the DB.
- **Smoke each surface separately** — they fail independently: device-verify
  solo, then superset rows, then superset labels, then BOTH history pages
  (session detail #1/#2 + per-exercise history #4). "solo works" proves nothing
  about the others.
- **session detail vs per-exercise history are different paths**: 該次訓練詳情
  (`app/session/[id].tsx`) uses #1 + #2 + #3 for LABELS **and** #5 + #6 for the
  read-mode ROW SEQUENCE; 動作歷史 (`app/exercise-history`) is #4 (separate repo +
  query + `historySetLabel.ts`). Both are "歷史" to the user.
- **labels and row sequence are SEPARATE sorts** (2026-06-02 root cause): the
  "詳情頁 superset 2,1,3" bug was NOT the label fn (#3 was already display_rank-
  aware) — it was that the read-mode builders `buildClusters` / `buildOrderedItems`
  in `app/session/[id].tsx` sorted ROWS by `ordering` while labels sorted by
  `display_rank`, so rows and labels disagreed. Fix: both builders now call the
  shared **`sortSetsByDisplayRank`** comparator exported from `sessionSetLayout.ts`
  — use that ONE comparator anywhere you sort set rows for display so row-order and
  label-order can never drift apart again. Edit-mode was fixed earlier in the slice;
  read-mode lagged → smoke read-mode separately.
- **`historySetLabel.ts` needed the field added, not just plumbed**: fixing #4
  required adding `display_rank: number | null` to `ExerciseHistorySet` + SELECTing
  `s.display_rank` in all 3 history queries + sorting `computeHistorySetLabels` by
  `display_rank ?? ordering`. `queryExerciseHistory` (chart/filter, Function A) has
  no set-row order → intentionally left out.
