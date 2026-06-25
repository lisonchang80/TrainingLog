---
name: dropset-chain-semantics
description: Reference for handling dropset chains (head + followers via parent_set_id) consistently across DB queries, set counters, progress bars, and history display. Trigger when touching code that filters / counts / displays sets with `set_kind`, `parent_set_id`, `is_logged`, or any of `computeExerciseProgress` / `computeClusterCycleProgress` / `classifyClusterCycle` / `prefillSessionExerciseFromLastSession` / set count helpers. Read this before writing SQL `WHERE is_logged = 1` or counter `set_kind !== 'warmup'` — both are common pitfalls.
---

# Dropset chain semantics

Dropset chains are TrainingLog's most error-prone data shape. Five separate bugs in slice 10c wave 12 all traced to the same root cause: code that treats every row independently when the chain should behave as one unit. This document is the canonical reference.

## Data model (post wave 11 #61)

A "dropset chain" is a head row + 0..N follower rows linked by `parent_set_id`:

```
HEAD     : set_kind='dropset', parent_set_id=NULL, id='h1'
FOLLOWER : set_kind='dropset', parent_set_id='h1', id='f1'
FOLLOWER : set_kind='dropset', parent_set_id='h1', id='f2'
```

A `working` row never has children. A `warmup` row never has children. Only `set_kind='dropset'` rows can have `parent_set_id != NULL`.

Both session_set (`"set"` table) and template_set carry the same shape. Within a cluster, BOTH A side and B side can have their own independent chains.

## The 4 invariants

Every code path that touches sets must satisfy these:

### 1. UI invariant: head has ✓ slot, follower doesn't

The chain head row in the UI has the tap-✓ button. Followers render the weight/reps inputs only — no ✓, no swipe (per #61). User toggles the chain by tapping the head's ✓.

### 2. DB invariant: only head's `is_logged` gets toggled

When user taps ✓ on a chain head, the UI writes `is_logged=1` to **the head row only**. Followers stay at `is_logged=0` in DB indefinitely.

**This is the single most common source of bugs.** Followers' DB `is_logged` is NOT a source of truth — you must resolve it via the head.

### 3. "1 chain = 1 set unit" for counting

For all progress / stat counters, a chain counts as ONE unit:

| Row kind             | Counts toward "組" count? |
|----------------------|--------------------------|
| `working`            | Yes (1 unit)             |
| `dropset` HEAD       | Yes (1 unit)             |
| `dropset` FOLLOWER   | No (rolled into head)    |
| `warmup`             | No (counted as "熱")     |

This applies to:
- Session card progress bar `setsTotal` / `setsDone`
- Cluster cycle progress
- Template editor "X 熱 + X 組" stat
- Any future "how many sets did the user do" UI

### 4. Volume includes everything non-warmup

For volume math (`Σ weight × reps`):
- Every non-warmup row contributes to denominator
- Every non-warmup row whose **effective is_logged** = 1 contributes to numerator

Effective is_logged for followers = head's is_logged.

## How to apply (by use case)

### Determining "is this row effectively logged?"

```ts
function effectiveIsLogged(s, byId) {
  if (s.set_kind === 'dropset' && s.parent_set_id != null) {
    const head = byId.get(s.parent_set_id);
    return head?.is_logged ?? 0;
  }
  return s.is_logged;
}
```

Used in `app/session/[id].tsx::resolveEffectiveLogged` (filter "hide unchecked"),
`src/domain/session/exerciseProgress.ts` (`volumeDone` chain-aware accumulation),
`src/adapters/sqlite/setRepository.ts::prefillSessionExerciseFromLastSession` (chain-aware filter).

### Counting "set units" (head only)

```ts
const isUnit = (s) =>
  s.set_kind === 'working' ||
  (s.set_kind === 'dropset' && (s.parent_set_id ?? null) === null);
```

Used in `computeExerciseProgress`, `computeClusterCycleProgress::isUnitSide`,
template editor solo `workings` filter, `classifyClusterCycle::isUnitSide`.

### Pulling source sets in SQL (DO NOT use `WHERE is_logged = 1`)

Pre-fix (broken):
```sql
SELECT * FROM "set"
WHERE session_id = ? AND exercise_id = ?
  AND is_skipped = 0
  AND is_logged = 1     -- ❌ excludes followers (their DB is_logged is 0)
ORDER BY ordering ASC
```

Post-fix:
```sql
SELECT * FROM "set"
WHERE session_id = ? AND exercise_id = ?
  AND is_skipped = 0
ORDER BY ordering ASC
```

Then filter in JS using `effectiveIsLogged`. Forward sweep is safe because head's ordering < follower's ordering.

If you MUST filter at SQL level (e.g., aggregate query that returns counts only):

```sql
WHERE (
  s.is_logged = 1
  OR EXISTS (
    SELECT 1 FROM "set" h
    WHERE h.id = s.parent_set_id AND h.is_logged = 1
  )
)
```

This is heavier — prefer JS-side filter when caller has the full set list.

> **Companion / opposite rule — see `is-logged-surfaces`.** That skill is for
> *aggregate* surfaces (PR replay, stats volume, History volume) where the
> correct filter IS the **plain `WHERE is_logged = 1`** this section warns
> against — because there, dropset followers SHOULD be excluded (History does
> the same, so the surfaces agree). The two rules don't conflict: aggregating
> "how much / did this happen" → plain `is_logged = 1`; reconstructing "what
> sets exist in the chain / progress" → effective is_logged (this skill). Don't
> conflate them.

### Cluster cycle classification

A cluster cycle (A.sets[i] + B.sets[i]) classifies as:

- **working**: at least one side is `working` OR `dropset HEAD`
- **warmup**: no side is unit, at least one side is `warmup`
- **null (skip)**: both sides are `dropset FOLLOWER` (rolled into the head cycle elsewhere)

See `src/domain/template/clusterStat.ts::classifyClusterCycle` and
`src/domain/session/clusterCard.ts::computeClusterCycleProgress`.

### Prefilling sets from history

When copying sets from a source session to the current session
(`prefillSessionExerciseFromLastSession`, `replayCardSetsFromHistoricalSession`):

1. Pull ALL non-skipped rows (don't filter `is_logged` in SQL)
2. JS-filter using effective is_logged (head logged → include follower)
3. **Build `Map<source.id, new.id>`** for parent_set_id remap
4. New row's `parent_set_id` = `idMap.get(src.parent_set_id) ?? null`
5. Forward sweep is safe (`ORDER BY ordering ASC` guarantees head before follower)

Bug pattern to avoid: `parent_set_id: null` on copy. That orphans the chain — splits one chain into N "heads".

### History label rendering

Labels in history view: `computeSessionSetLayout` (NOT `computeHistorySetLabels`).

- `computeHistorySetLabels` counts every dropset row as D1/D2/D3...
- `computeSessionSetLayout` gives `D{N}` to head only, blank to followers

Mirror UX rule #1: head visible as labeled row, followers visible as indented rows under head.

## Known wave 12 bugs (all traced to this)

| Commit     | Bug                                                              | Root cause                                                           |
|------------|------------------------------------------------------------------|----------------------------------------------------------------------|
| `138cc0a`  | +動作 prefill 變兩個 orphan head                                 | `parent_set_id: null` on copy                                        |
| `8d3734e`  | prefill 後只有 head 沒 follower                                   | SQL `WHERE is_logged = 1` excludes followers                         |
| `8e2b82d`  | 純 dropset 卡進度條卡 0/3                                         | `workingDone` only counted `working`, not dropset HEAD               |
| `207c3c9`  | template editor 顯示「12 組」(3 chain × 3 row)                    | `s.kind !== 'warmup'` counted every row                              |
| (multiple) | `D1..D12` in history read mode                                   | `computeHistorySetLabels` counted every row                          |

## Wave 12 missed (Agent B audit 2026-05-21 surfaced)

| Commit     | Bug                                                              | Root cause                                                           |
|------------|------------------------------------------------------------------|----------------------------------------------------------------------|
| `aaebdb0`  | ↻ 再次訓練 solo → only HEAD copied, follower dropped              | `replayCardSetsFromHistoricalSession` SQL `WHERE is_logged = 1` — same shape as `8d3734e` but in sibling helper |
| `aaebdb0`  | ↻ 再次訓練 cluster A side chain → only HEAD copied                | `replayClusterCardSetsFromHistoricalSession` same SQL bug; same fix; also leaks via `prefillReusableSupersetFromLastSession` |
| `aaebdb0`  | Cluster 容量 chip 卡 stuck-low on dropset-heavy clusters          | `computeClusterVolume` used naive `s.is_logged === 1` — wave 12 `8e2b82d` touched sibling `computeClusterCycleProgress` but missed this function in same file |

**Audit-friendly grep that would have caught all 3 wave-12 misses**:
```bash
grep -rn "is_logged = 1\|is_logged=1" src/adapters/sqlite/
grep -rn "s\.is_logged === 1" src/domain/
```
After every chain-aware fix, sweep these patterns across all reader sites
— don't trust that "the bug only existed in the one helper".

## Test fixture smell — production-faithful follower is_logged

When writing fixtures for dropset chains, **default the follower row's
`is_logged` to `0`** (matches production — UI tap-✓ writes head only, per
DB invariant #2). A follower fixture with `is_logged=1` is non-
representative and will silently mask `WHERE is_logged = 1` SQL bugs.

Concrete pointer that hid 2 bugs (Agent B audit 2026-05-21):
- `tests/db/replayCardSets.test.ts:88` `addSet` helper defaulted
  `is_logged: 0 | 1 = 1`. Existing tests passed pre-fix because both
  HEAD and follower had `is_logged=1`, so the bad SQL filter kept both.
  Fix: comment the helper's default with a warning, add Case 2b
  (solo chain follower is_logged=0) + Case 4b (cluster A side chain
  follower is_logged=0) — these are the production-faithful tests that
  exercise the actual bug.

## Files that already follow these rules (reference implementations)

- `src/domain/session/exerciseProgress.ts` — solo progress (setsDone/setsTotal, volumeDone chain-aware)
- `src/domain/session/clusterCard.ts::computeClusterCycleProgress` — cluster progress
- `src/domain/session/clusterCard.ts::computeClusterVolume` — cluster volume (chain-aware after `aaebdb0`)
- `src/domain/template/clusterStat.ts::classifyClusterCycle` — template cluster stat
- `src/adapters/sqlite/setRepository.ts::prefillSessionExerciseFromLastSession` — prefill chain-aware
- `src/adapters/sqlite/setRepository.ts::replayCardSetsFromHistoricalSession` — replay with parent remap + chain-aware filter (after `aaebdb0`)
- `src/adapters/sqlite/setRepository.ts::replayClusterCardSetsFromHistoricalSession` — cluster replay (after `aaebdb0`)
- `app/session/[id].tsx::resolveEffectiveLogged` — hide-unchecked filter
- `components/template-editor/template-editor-view.tsx` line ~2044 — solo `workings` count

## Checklist before merging code that touches sets

- [ ] Does this filter `is_logged = 1` in SQL? → switch to JS-side chain-aware filter, OR add EXISTS clause for parent
- [ ] Does this count set rows toward a "組" / "set unit" total? → use head-only rule
- [ ] Does this aggregate volume? → use effective is_logged (chain-aware)
- [ ] Does this copy sets to another location? → remap `parent_set_id` via id Map
- [ ] Does this render dropset labels? → use `computeSessionSetLayout` (head-only `D{N}`)
- [ ] Does this classify a cluster cycle? → follower-only cycles return null (skip)
- [ ] **Audit-sweep regression-prone patterns**: after fixing any chain-aware bug, also run `grep -rn "is_logged = 1\|is_logged=1" src/adapters/sqlite/` and `grep -rn "s\.is_logged === 1" src/domain/` — same bug shape often exists in sibling helpers (Agent B audit 2026-05-21 found 3 missed by wave 12)
- [ ] **Test fixture sanity**: any new test exercising a chain MUST set follower `is_logged: 0` explicitly. Defaults of `1` mask SQL filter bugs.
