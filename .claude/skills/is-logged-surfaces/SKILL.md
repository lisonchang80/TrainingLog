---
name: is-logged-surfaces
description: Map of EVERY repository query that aggregates "performed" sets and which must filter `is_logged = 1` to exclude planned-but-unchecked sets. Use when fixing "未打勾的計劃組被算進 PR / 成就 / 統計 / 容量", touching a SQL query that SUMs/COUNTs/replays sets, or adding a new aggregate surface. `is_logged = 1` is the canonical "this set was ✓-tapped / actually done" signal (setRepository.ts:698). The recurring bug (F3 + achievement PR class): a query filters only `is_skipped = 0` and derives a JS "logged" flag from a stale `is_skipped === 0 && weight/reps valid` proxy — which CANNOT tell a planned set (template / 動作記憶 default, real weight/reps, is_logged=0, never purged by endSession) from a performed one. Touches src/adapters/sqlite/{achievementRepository,statsRepository,exerciseHistoryRepository,exerciseLibraryRepository}.ts. Companion to `dropset-chain-semantics` (DIFFERENT angle — read both).
---

# is_logged surfaces (performed vs planned)

Sibling to `set-weight-unit-surfaces` / `set-ordering-surfaces`: the same
whack-a-mole shape. The "this set was actually performed" predicate is read in
**many** independent aggregate queries (PR replay, stats volume, History
volume, library "has any logged set"). Each must filter `is_logged = 1` — miss
one and **planned-but-unchecked sets inflate the number**.

## The DB invariant (why the proxy is wrong)

- `is_logged INTEGER NOT NULL DEFAULT 0` (v015). The user's **✓-tap** flips it
  to 1 (`setRepository.ts:339-343`). It is *"the single source of truth for
  this set [was performed]"* (`setRepository.ts:698`).
- A **planned** set — materialized from a template / 動作記憶 default, or
  `prefillSessionExerciseFromLastSession` — carries **real weight/reps** (the
  plan) but `is_logged = 0` and `is_skipped = 0` until ticked.
- `endSession` (`sessionRepository.ts:91`) **only writes `ended_at`** — it does
  NOT purge unchecked planned sets. They persist in the DB forever.
- ⇒ `is_skipped = 0` does **NOT** mean "performed". A planned set is also
  `is_skipped = 0`. Only `is_logged = 1` distinguishes performed from planned.

## The bug class (F3 + achievement PR)

A query that:
1. SQL filters only `set_kind = 'working'` (or `!= 'warmup'`) — **no
   `is_logged`** — so planned sets are returned, AND
2. derives the JS "logged" flag from
   `is_skipped === 0 && weight_kg != null && reps != null && reps >= 1`

…treats every planned set with real weight/reps as performed. It then breaks
PRs / adds volume / unlocks achievements off sets the user only *typed*, never
*did*.

Repro shape: open a session from a template (5×5 planned at 100kg), tick only
the first 2 sets, end. The 3 unchecked sets still carry 100kg×5 + is_logged=0.

## The fix (mirror the canonical query)

Canonical is `exerciseHistoryRepository.listExercisePRSetRows`:

```sql
WHERE s.exercise_id = ? AND s.is_skipped = 0 AND s.is_logged = 1
```

Apply the **plain `is_logged = 1`** (NOT chain-aware — see tension below):

1. SQL: SELECT the real `s.is_logged` column, add `AND s.is_logged = 1` to the
   WHERE (keep the existing `set_kind` clause).
2. JS flag: anchor on the real column — `r.is_logged === 1 && <weight/reps
   value guard>`. Keep the value guard (a logged-but-blank row → null
   volume / unqualified, never a NaN); the SQL filter makes `r.is_logged === 1`
   always true but the value guard still gates downstream qualification.
3. **Tests**: `recordSetInSession` / `insertSet` leave `is_logged = 0`
   (DB default). Any test that seeds via them and expects the set to COUNT must
   simulate the ✓-tap: `await db.runAsync('UPDATE "set" SET is_logged = 1 WHERE
   session_id = ?', id)` (or `WHERE id = ?`). New regression: seed a logged set
   + an unchecked set (real weight/reps, no ✓), assert the unchecked one does
   NOT count / unlock. Verify the test FAILS without the src fix.

## Tension with `dropset-chain-semantics` (read both, don't conflate)

Two opposite rules, both correct in their context:

- **This skill (aggregates)**: PR / stats / History volume use **plain
  `is_logged = 1`**. Dropset followers carry DB `is_logged = 0` (only the head
  flips), so they're excluded — which is EXACTLY what History does, so the
  surfaces agree. Do NOT resolve follower → head here; that would over-count vs
  History.
- **`dropset-chain-semantics` (per-set pull / progress)**: when pulling source
  sets or computing a progress numerator, use **effective is_logged**
  (follower inherits head's). There, plain `WHERE is_logged = 1` is the bug
  (drops followers that the user did perform as part of the chain).

Rule of thumb: aggregating "how much / how many PRs / did this happen" → plain
`is_logged = 1`. Reconstructing "what sets exist in this chain / progress" →
effective is_logged.

## Surface audit map (status as of 2026-06-25)

- ✅ `exerciseHistoryRepository.ts` (History list volume, PR detail,
  `listExercisePRSetRows`, charts) — `is_skipped = 0 AND is_logged = 1`. **Canonical.**
- ✅ `exerciseLibraryRepository.ts:141/153` ("has any logged set", last-logged) —
  `is_skipped = 0 AND is_logged = 1`.
- ✅ `statsRepository.loadStatsSetRecords` — **F3** (`fix/f3-stats-is-logged-2026-06-25`
  `60cd5e5`): added `AND s.is_logged = 1`, flag anchored on real column.
- ✅ `achievementRepository.loadReplayRecords` (feeds `replayPRs` +
  `evaluateAndPersistAchievements` + `backfillAchievementsIfNeeded` +
  `loadAchievementPanelData`) — **this fix**
  (`fix/achievement-pr-is-logged-2026-06-25`): added `AND s.is_logged = 1`.
  Note `loadAchievementPanelData`'s `if (!r.is_logged) continue` did NOT
  protect — it read the same stale proxy.
- ✅ `achievementRepository.countLoggedSessions` — **FIXED** (`226b004`,
  2026-06-28): added `AND s.is_logged = 1`. Feeds `totalSessionCount` for the
  session_count ladder. The prior proxy (`is_skipped = 0 AND weight_kg/reps NOT
  NULL`) over-counted a session opened from a template / 動作記憶 default and
  ended WITHOUT ✓-tapping any set (real weight·reps, is_logged=0, is_skipped=0,
  never purged by `endSession`), inflating the total so a session_count
  milestone unlocked one (or more) sessions early on the next genuinely-logged
  session. Verify-rootcause (per the backfill docblock @ `backfillAchievementsIfNeeded`)
  confirmed the warmup-only handling is **NOT** regressed: the count is fed as
  the FINAL total (not progressive) and `evaluate()` still gates each unlock on
  the current session's working-set `hasLogged`.
  **Deliberately NOT `set_kind = 'working'`** (ADR-0009 §D3): warmup-only
  sessions are intentionally counted (compensated by the `hasLogged` gate), and a
  dropset HEAD carries `set_kind='dropset'` — a working-only filter would wrongly
  drop a pure-dropset session that the user really performed. So the plain
  `is_logged = 1` (this skill's canonical aggregate rule) is exactly right here.
  Regression: live path in `achievementsAndStats.test.ts`
  (`evaluateAndPersistAchievements` + `loadAchievementPanelData`), backfill path
  in `achievementBackfill.test.ts`.
- ➖ `setRepository.ts` prefill / "load last session" paths (707/739/851/1475…)
  — **intentionally** filter only `is_skipped = 0` (they pull the *planned*
  shape of the last session, which includes unchecked sets). `dropset-chain-semantics`
  also warns NOT to add `is_logged = 1` here. Not this bug class.

## Trigger reminders

Read this before writing or reviewing any repository SQL that SUMs/COUNTs/
replays `"set"` rows for a "performed work" number. If the query has
`is_skipped = 0` but no `is_logged = 1`, ask: is this an **aggregate of done
work** (add `is_logged = 1`) or a **plan/chain reconstruction** (leave it)?
