# Agent D — Test Gap Fills (top-3 deferred)

**Branch:** `agent-D-test-gap-fills`
**Base:** `b965ee493f06111c52c089149efe7ac903e4fd90` (slice/10c-set-logger-and-menu tip)
**Date:** 2026-05-24

## Summary

Implemented the top-3 deferred test gaps from `docs/audit/2026-05-24-test-gap-and-dead-code.md` § 5 (#1, #2, #3). Three new test files, **16 new test cases**, all green. Existing 1393 tests still pass (zero regression).

| Test file | Cases | Audit § ref |
| --- | --- | --- |
| `tests/db/appendReusableSupersetActiveSessionInterlock.test.ts` | 8 | § 5 #1 (HIGH) |
| `tests/db/restoreSessionFromSnapshotDropsetChain.test.ts` | 5 | § 5 #2 (MED) |
| `tests/db/convertSessionToTemplateRSSharing.test.ts` | 3 | § 5 #3 (MED) |
| **Total** | **16** | — |

Final test count: **1393 + 16 = 1409 / 1409 pass** (in-isolation runs and most full-suite runs; see `Pre-existing flake` note below). `npx tsc --noEmit` clean.

---

## Test file detail

### 1. `appendReusableSupersetActiveSessionInterlock.test.ts` (8 cases)

Locks in the cross-session contract for `appendReusableSupersetToSession`. The existing dup guard is *per-session* (`WHERE session_id = ? AND reusable_superset_id = ?`); the function does NOT inspect `session.ended_at`. These tests document the current behavior so a future tightening (e.g. "an RS template may exist in at most one active session") forces explicit re-evaluation.

| # | Case |
| --- | --- |
| 1 | Append into fresh active session → A+B atomically appended, cluster linkage correct |
| 2 | Append into FINISHED session (`ended_at IS NOT NULL`) → succeeds (edit-mode flows depend on this) |
| 3 | Append when no active session exists → succeeds against an explicit `session_id` (function is target-explicit, not active-implicit) |
| 4 | Append targeting non-existent `session_id` → FK on `session_exercise.session_id` rejects |
| 5 | Dup append into SAME session → second call rejected with `duplicate RS in session`, no partial row leak |
| 6 | Same RS template across one finished + one active session → both succeed independently |
| 7 | Same RS template across TWO different active sessions → both succeed (dup guard is per-session only) |
| 8 | Ordering: append into a session with existing solo cards → starts at `MAX(ordering)+1`, A at +1, B at +2 |

### 2. `restoreSessionFromSnapshotDropsetChain.test.ts` (5 cases)

Locks in `parent_set_id` preservation across `captureSessionSnapshot` → edit → `restoreSessionFromSnapshot` round-trip. Behavior is structurally correct because snapshotted set rows keep their original `id` on restore, but no test previously made the chain invariant explicit.

| # | Case |
| --- | --- |
| 1 | Single chain (1 root + 2 followers) → `parent_set_id` linkage preserved verbatim after delete-and-restore |
| 2 | Multiple independent chains in same session → each chain stays isolated (no follower bleed across heads) |
| 3 | Mixed solo + chain on same `session_exercise` → solo restored independently, chain links intact, no accidental linkage |
| 4 | Snapshot with **orphan follower** (parent_set_id references id NOT present in snapshot.sets) → INSERT'd verbatim, becomes a true orphan. Locks in the current "no validation pass" contract; `set.parent_set_id` has no DB-level FK in v015, so the orphan insert succeeds. |
| 5 | Ordering preserved across restore (head=10, d1=20, d2=30) → important for set-logger UI render order |

### 3. `convertSessionToTemplateRSSharing.test.ts` (3 cases)

Complements existing `templateConvertFromSession.test.ts` #31 (Case A / Case B) by adding `reusable_superset_id` propagation coverage + the "entire pair shared" + "RS + solo same-exercise" scenarios.

| # | Case |
| --- | --- |
| 1 | RS1=[Bench,ChestDip] + RS2=[Cable,ChestDip] (shared ChestDip) → 2 distinct `reusable_superset_id` values across 4 template_exercise rows; each pair's `parent_id` correctly remaps; each card's set list is its own (no cross-RS bleed) |
| 2 | Entire-pair shared (RS1=[A,X] + RS2=[A,X]) is **structurally impossible** — `insertReusableSuperset` rejects the second template with `duplicate RS pair` (verified, including reversed order). Locks in the dup-pair guard so a future loosening forces explicit re-evaluation of `convertSessionToTemplate`'s 1-to-1 RS→pair assumption. |
| 3 | 1 RS + 1 solo with same exercise as RS A-side → solo stays solo (`reusable_superset_id = NULL`), RS stays RS (`reusable_superset_id = rs.id`); per-card set lists stay isolated thanks to session_exercise_id (#17 / #31) isolation |

---

## Findings during implementation

### Finding 1 (resolved, not a bug)

The task brief sketched a "RS1=[A,X] + RS2=[A,X] entire-pair shared" case to verify dup-RS handling. Investigation shows this is **structurally impossible** at the RS template level: `insertReusableSuperset` rejects identical exercise-id pairs via the order-insensitive `findExistingReusableSupersetByPair` guard. Test 3 Case 2 reframes this as a locked-in invariant test rather than a runtime behavior test.

### Finding 2 (deliberately scoped out, NOT a bug)

`insertReusableSuperset` does NOT reject RS templates where both slots reference the same exercise (`exercise_ids: [X, X]`). The dup-pair guard (`findExistingReusableSupersetByPair`) explicitly short-circuits on `A === B` returning `null`. The validation lives in `validateReusableSupersetDraft` (domain layer), and `insertReusableSuperset`'s docstring explicitly states `"Caller MUST validateReusableSupersetDraft first; this function trusts the draft."`

This is a documented contract, not a bug. I considered adding a defensive guard test for `insertReusableSuperset(db, {exercise_ids: [X, X]})` but removed it: it would have been testing the absence of a guard that's intentionally not there. The validator already enforces this — covered in `tests/domain/supersetManager.test.ts`.

### Finding 3 (pre-existing flake, NOT introduced by this PR)

`tests/db/v011ReusableSuperset.test.ts` has 2 tests that fail intermittently when the full test suite runs in parallel:
- `PRIMARY KEY (superset_id, position) rejects duplicate slot`
- `superset_exercise.exercise_id FK is enforced`

Both pass when the file runs in isolation. Both also fail on the cold-baseline run BEFORE any of my changes were applied (initial `npx jest` after `npm install`). The likely root cause is `PRAGMA foreign_keys` initialization race in better-sqlite3 when many worker processes hammer `:memory:` migrations concurrently.

This is OUT OF SCOPE for the task allow-list (cannot edit `tests/db/v011*` or `src/`). Flagging for follow-up: see `spawn_task` chip generated by this agent if applicable.

**Impact on this PR**: zero. All 16 new tests pass in isolation, in the multi-file combo, and in most full-suite runs. Baseline parity is maintained (no new flakes introduced).

---

## Final test count

| | Count |
| --- | --- |
| Baseline (`b965ee4`) | 1393 |
| + Test 1 (appendReusableSupersetActiveSessionInterlock) | +8 |
| + Test 2 (restoreSessionFromSnapshotDropsetChain) | +5 |
| + Test 3 (convertSessionToTemplateRSSharing) | +3 |
| **Total** | **1409** |

TypeScript: `npx tsc --noEmit` — clean (zero errors).

## Files added

- `tests/db/appendReusableSupersetActiveSessionInterlock.test.ts` (8 cases, new)
- `tests/db/restoreSessionFromSnapshotDropsetChain.test.ts` (5 cases, new)
- `tests/db/convertSessionToTemplateRSSharing.test.ts` (3 cases, new)
- `docs/audit/agent-D-test-results.md` (this file)

## Files NOT touched

Per allow-list:
- `src/**` — read-only
- `app/**` — not touched
- `src/i18n/strings.ts` — not touched
- `docs/design/2026-05-24-set-logger-implementation-plan.md` — not touched
- `docs/adr/**` — not touched
- Existing `tests/**` files — only new files added
- `package.json` / `package-lock.json` — `npm install --prefer-offline` only (no lockfile mutation)
