# 2026-05-24 — Test Gap Round 2

**Worktree:** `agent-E-test-gap-round2` @ base `01a0a62`
**Baseline:** 1409 tests green (`agent-D-test-results.md` final).
**Final:** 1423 tests green (1409 + 14 new), tsc clean. No existing test files touched.

---

## § 1. Scan method

Re-read 5/24 Agent D's audit (`docs/audit/2026-05-24-test-gap-and-dead-code.md`)
and confirmed the top-5 deferred list. Then swept candidates beyond D's
coverage:

1. `find src/domain src/adapters/sqlite -name "*.ts"` cross-referenced
   against `tests/{domain,db}` filenames — counted 75 db tests + 49 domain
   tests already present.
2. `grep -rn "markClusterCycle|cloneClusterCycle|cycleSessionSetKind|swapProgramCells|appendReusableSuperset|appendSessionExercise|restoreSessionFromSnapshot|discardSession|applyTemplateToColumn|applyTagToRow|deleteSet|wizardStateMachine"` against `tests/` to map test → source coverage.
3. For each candidate, read its describe blocks and counted what's not
   asserted explicitly.
4. Cross-checked D's §3 medium + low deferred rows and D's §5 top-5
   follow-up list — picked the 3 highest-leverage uncovered ones.

Candidates considered (filtered down to 3 chosen):

| Area | Coverage status | Decision |
| --- | --- | --- |
| `markClusterCycleLogged × dropset chain on one side` | atomic flip covered; chain×cluster interaction NOT | **CHOSE** (HIGH — top D §5 #4) |
| `cloneClusterCycle × dropset chain semantics` | 4 happy-path cases; chain semantics implicit | **CHOSE** (MED — D §3 low row, promoted) |
| `wizardStateMachine validateStep Preview/Confirm cascade order` | composite call exists; order not pinned | **CHOSE** (MED — D §5 #5) |
| `restoreSessionFromSnapshot × dropset chain` | Agent D added 5 cases | covered |
| `appendReusableSupersetToSession × active session interlock` | Agent D added 8 cases | covered |
| `convertSessionToTemplate × 2 RS sharing same exercise` | Agent D added 3 cases | covered |
| `discardSession × achievement_unlock` | 6 existing tests in `discardSessionWithUnlocks` | covered |
| `swapProgramCells` | 7 existing tests (all 4 cases + early return + dict + updated_at) | covered |
| `applyTemplateToColumn / applyTagToRow` | 9 existing tests + v022 dict | covered |
| `cycleSessionSetKind / ClusterAware` | 17 existing tests | covered |
| `clusterCascadeDelete (#17 × #18)` | 3 existing tests | covered |

---

## § 2. Tests added

3 NEW test files, 14 new test cases. All existing test files untouched
(cherry-pick safety).

### `tests/db/markClusterCycleLoggedDropsetChain.test.ts` — 5 cases (HIGH)

Promotes D §3 medium-priority row 5 ("markClusterCycleLogged × dropset
chain on one side") to explicit coverage. The skill memory
`dropset-chain-semantics` says is_logged is owned by the chain HEAD and
markClusterCycleLogged never cascades into followers, but no test pinned
this against a regression.

| # | Test | Catches regression |
| --- | --- | --- |
| 1 | Logging cycle (working A, working B) leaves UNRELATED dropset chain on A side at is_logged=0 across head + 2 followers | Adding a "chase chain on session" SQL to mark would corrupt this |
| 2 | Logging cycle when A IS the dropset head → only head flips; followers stay 0 | Adding accidental `OR parent_set_id = ?` cascade would break chain-semantics rule that DB is_logged on follower is always 0 |
| 3 | Unchecking inverse round-trips the head; followers (always 0) never change | Mirror of #2 for `markClusterCycleUnlogged` |
| 4 | Chains on BOTH cluster sides — working pair flip touches neither chain | Multi-chain interference |
| 5 | Caller bug: passes FOLLOWER id instead of HEAD → flips the follower row only (strict-id contract; surfaces UI bug as DB smell rather than silently re-routing) | Pins the strict-id contract documented at setRepository.ts:266-269 |

### `tests/db/cloneClusterCycleDropsetChain.test.ts` — 4 cases (MED)

D §3 low row "cloneClusterCycle (source is dropset chain head — clone
copies head's weight/reps but **followers are NOT cloned**)" — promoted
because two invariants exist (I1 head-no-deep-copy, I2 follower-clone-
no-parent) and both could be silently broken by future refactors.

| # | Test | Catches regression |
| --- | --- | --- |
| 1 | **I1** Cloning a dropset HEAD does NOT deep-copy followers — only the head row is inserted (no rows where `parent_set_id = a-clone`) | Future "deep clone" addition would produce silent extra logged sets the user never performed |
| 2 | **I2** Cloning a FOLLOWER produces row with `parent_set_id=NULL` (per INSERT literal at setRepository.ts:410) — never another orphan follower | Removing the literal NULL would let follower-clones inherit stale parent ids |
| 3 | **I3** Cloning a LOGGED head — clone is `is_logged=0`, source chain unchanged | Already-covered for plain working; this locks the dropset-head variant explicitly |
| 4 | Asymmetric A-dropset × B-working — ordering correct on both sides, set_kind preserved, no follower auto-attached | End-to-end smoke for the realistic "+ 加 cycle" right-swipe path |

### `tests/domain/wizardStateMachineCascadeOrder.test.ts` — 5 cases (MED)

D §5 top-5 deferred #5 — the cascade order at wizardStateMachine.ts:154-162
is documented but not pinned. Re-ordering it would change the user-facing
error message in `complete()` for every blocked program-creation flow.

| # | Test | Catches regression |
| --- | --- | --- |
| 1 | Rank 0: all-invalid draft → "Program name cannot be empty" (NameAndTag) | Re-ordering cascade |
| 2 | Rank 1: name OK, cycle_length=0, dayPlans empty → "cycle_length must be 3-14" (CycleConfig) | Same |
| 3 | Rank 2: name+cycle OK, no template anywhere, override cycle 99 → "Pick a template for at least one day" (DayPattern) | Same |
| 4 | Rank 3: only CycleSubTags invalid → "Override cycle 5 out of range" + `complete()` returns same error | Same; also pins `complete()`-routes-through-Confirm contract |
| 5 | Preview and Confirm share identical cascade output across all 4 ranks | Guards against a future drift where Preview vs Confirm gain divergent extra checks |

---

## § 3. Final test count

| Stage | Tests | Δ |
| --- | --- | --- |
| Baseline `01a0a62` | 1409 | — |
| + markClusterCycleLoggedDropsetChain | 1414 | +5 |
| + cloneClusterCycleDropsetChain | 1418 | +4 |
| + wizardStateMachineCascadeOrder | 1423 | +5 |
| **Final** | **1423** | **+14** |

`npx tsc --noEmit` clean throughout.

---

## § 4. Left deferred

Reasons in priority order:

1. **`computeClusterVolume` × cluster cycle ✓ atomic + dropset chain logged head — integration coverage** — `tests/domain/clusterCard.test.ts` already has 14 unit cases including "A side dropset chain logged head + followers: full chain volume in numerator". The integration with `markClusterCycleLogged` would re-test the same pure logic; not net-positive.

2. **`appendReusableSupersetToSession × picker bridge race`** — would require mocking the PickerBridge state machine alongside the DB; spans 2 layers and is better tested as an E2E smoke. Out of scope for repo-layer tests.

3. **`recordProgramSubTag × concurrent insert race`** — SQLite `INSERT OR IGNORE` makes this structurally impossible to corrupt within better-sqlite3's single-threaded mode; would require a real race condition simulator. Low ROI.

4. **`session_exercise.parent_id` × RS A/B side flip after `applyTemplateToColumn`** — would test that the cluster relationship persists after the column-wide template swap. But program cells don't store cluster relationships directly (they reference a template, which stores its own exercises); the relationship survives by virtue of `template_id` being a pointer not a copy. Tested implicitly via `convertSessionToTemplate` round-trips.

5. **Component-level UI tests for cluster row ⚙️ menu cascade** — outside repo/domain scope and explicitly in the DO NOT TOUCH list (Agent C anatomy stack).

---

## Process notes

- Cherry-pick safety: NO existing test files modified. The 3 new files are
  standalone and import only from `src/`.
- All 3 files follow the established naming pattern (`<scope><Variant>.test.ts`).
- Each test uses `BetterSqliteDatabase(':memory:')` + `migrate(db)` per
  the convention in surrounding tests.
- Total wall time for the 14 new cases: ~5.5 sec across the 3 suites.
