# 2026-05-24 — Test Gap + Dead Code Sweep

**Branch:** `slice/10c-set-logger-and-menu` (worktree topic `worktree-agent-affd176ddcb6a7f4d`)
**Baseline:** `c03670b` — 1379 tests green, tsc clean.
**Final:** 1393 tests green (1379 + 14 new), tsc clean. Net −174 LOC of dead Expo scaffold + 1 export demoted to internal.

---

## § 1. Dead code DROPPED

| File | Symbol / scope | LOC | ADR ref status |
| --- | --- | --- | --- |
| `components/parallax-scroll-view.tsx` | whole file (Expo scaffold leftover) | 79 | Not in any ADR; zero callers across `app/`, `components/`, `src/`, tests. |
| `components/themed-text.tsx` | whole file (`ThemedText`) | 60 | Not in any ADR; only ref was `themed-text.tsx` itself. |
| `components/themed-view.tsx` | whole file (`ThemedView`) | 14 | Not in any ADR; only used by the dropped `parallax-scroll-view.tsx`. |
| `hooks/use-theme-color.ts` | whole file (`useThemeColor`) | 21 | Not in any ADR; only used by the three dropped Expo scaffold components above. |
| `src/adapters/sqlite/achievementRepository.ts:91` | `export` keyword on `insertUnlocks` removed (function kept, demoted to module-private) | 0 (–1 token) | Not in any ADR; only call site is `evaluateAndPersistAchievements` in the same file. |

**Total LOC removed: 174.** Pattern matches 5/22 wave-2 X1 sweep (Expo scaffold + dead repo helpers).

### Verification protocol (per drop)

1. `git grep -w <symbol>` across `*.ts` / `*.tsx` excluding `node_modules`.
2. `grep -rn "<symbol>" docs/` to confirm not referenced by any of the 23 ADRs.
3. After each batch: `npx tsc --noEmit` (clean) + `npx jest` (1379/1379 → 1393/1393 with new tests).
4. `hooks/use-color-scheme.ts` was NOT dropped — `app/_layout.tsx` and `app/(tabs)/_layout.tsx` both import it.

### Patterns deliberately PRESERVED

The known candidates from the task brief (`overwriteTemplateFromSession`, `createTemplateFromSession`) **do not exist on this branch** (`c03670b`). They were added in later commits on the slice tip per the 5/19 morning wave note and are addressed separately on the original slice branch.

---

## § 2. Dead code DEFERRED candidates (high-risk reason per item)

These exports have at most one external file referencing them, but the reference is a test file. Per the agent rules ("Cross-module utility imported by tests even if not in app code — tests are valid consumers = HIGH-RISK"), they are **kept**. Listed in priority order so a future cleanup can revisit:

| Symbol | File | Why deferred |
| --- | --- | --- |
| `setSessionBwSnapshot` | `sessionRepository.ts:23` | Tests-only (`bodyMetric.test.ts`, `exerciseHistory.test.ts`). Backfill helper for body weight snapshot — keep until App Store ship (slice 11+). |
| `recordSetAsAutoSession` | `setRepository.ts:1727` | Tests-only. Quick-log path for "auto-session" — likely future Apple Watch lane (ADR-0008). |
| `listAllSets` / `listAllSetsWithExercise` | `setRepository.ts:119/160` | Tests-only. Broad SELECT * helpers — handy for debugging / future export. Cheap to keep. |
| `listSlotsForSuperset` | `supersetRepository.ts` | Tests-only. Mirrors `listReusableSupersetsWithExercises` but at a lower level — keep for parity. |
| `listReusableSupersets` | `supersetRepository.ts` | Tests-only. Higher-level callers use `listReusableSupersetsWithExercises`; this is the lightweight variant. |
| `getBodyMetric` / `deleteBodyMetric` | `bodyMetricRepository.ts` | Tests-only. CRUD parity with `insertBodyMetric` which IS used. Keep matched pair. |
| `classifyTemplate` | `templateRepository.ts` | Tests-only. Used to derive shape (RS / template / dropset_block) from row — handy for future history/library refactors. |
| `updateCell` / `updateTemplateName` / `clearActiveProgram` / `deleteProgram` / `removeTemplateExercise` | various repos | Tests-only CRUD helpers. Kept for symmetry with their `create*` / `insert*` counterparts. |

**High-risk reason category:** "Cross-module utility (tests are valid consumers)" per task rules. Dropping would force test rewrites + lose API surface coverage; not net-positive.

### Component-level deferred

| File | Status |
| --- | --- |
| `components/exercise/muscle-diagram-tagged.tsx` | 0 external refs detected, **but on Agent C's DO NOT TOUCH list** (anatomy stack). Defer to anatomy agent. |

---

## § 3. Test gap inventory

Read-only audit of the 51 commits on `slice/10c-set-logger-and-menu` since the main baseline (`e8c67d7..c03670b`) plus the wave 13-18 series mentioned in MEMORY.

### High priority

| Area | Scenario | Why high-priority |
| --- | --- | --- |
| `src/i18n/locale-persist.ts` | AsyncStorage `getItem` throws → must return 'auto' silently | Boot-time path. Untested rejection would crash `app/_layout.tsx` `useEffect` hydration. **ADDRESSED in this PR.** |
| `src/i18n/locale-persist.ts` | Malformed stored value (e.g. residue from build that wrote 'fr') → return 'auto' | Easy regression when extending the locale union. **ADDRESSED.** |
| `src/i18n/locale-persist.ts` | `getLocales()` returns empty array → fallback to 'en' | Simulator edge case + future ChromeOS / web. **ADDRESSED.** |

### Medium priority

| Area | Scenario | Notes |
| --- | --- | --- |
| `programGridLayout.cellDate` | Feb 29 leap-year + non-leap-year contrast | UTC math is correct but no explicit assertion locked it. **ADDRESSED.** |
| `programGridLayout.findNearestNonRestInRow` | The only filled cell IS the source cell → null (not self) | Load-bearing for UX (no-preset picker fallback). **ADDRESSED.** |
| `sessionRepository.restoreSessionFromSnapshot` | Snapshot contains a dropset chain (head + N followers) — restore preserves `parent_set_id` linkage verbatim | SQL preserves `parent_set_id` by column so behaviour is structural — low regression risk but no positive lock-in. |
| `appendReusableSupersetToSession` | RS template referenced by other still-active session (ended_at NULL) — duplicate pair guard interaction | Existing guard `findExistingReusableSupersetByPair` is order-insensitive, but combined with active-session blocker (overwriteProgram pattern) untested. |
| `markClusterCycleLogged` × dropset chain on one side | Logging an A-side working cycle when A has a dropset chain elsewhere — chain head's is_logged should be unaffected | Covered by skill memory "dropset-chain-semantics" + sibling tests, but no explicit integration test for the interaction. |

### Low priority

| Area | Scenario | Notes |
| --- | --- | --- |
| `clusterCard.groupClusterSides` | 3rd follower silently dropped — but what about parent with 0 followers (solo with `parent_id=null`)? | Already tested via "ignores solo exercises that have no followers"; just less explicit. |
| `wizardStateMachine.validateStep` | `Preview` / `Confirm` cascade validation surfaces the FIRST failing step's error message | Covered indirectly; explicit assertion would be defensive. |
| `cloneClusterCycle` | Source is a dropset chain head — clone copies head's weight/reps but **followers are NOT cloned** (chain not deep-copied) | Verified by reading code; current tests don't make the followers-not-cloned invariant explicit. Worth a future test if chain-clone semantics change. |
| `convertSessionToTemplate` | Session has 2 RS cards sharing same exercise — template_exercise rows must use session_exercise_id isolation (#17) | Covered by 5/18 evening #31 (`af590fd`). Could add a 2-RS-same-exercise stress case. |
| `discardSession` × active rest timer | Rest timer modal state when session is discarded mid-countdown — UI guards via `IDLE_TIMER` | Pure UI / state-machine concern; restTimer tests cover the state machine but not the discard interlock. |

---

## § 4. Tests ADDED in this PR

Two NEW test files (existing files untouched to avoid cherry-pick conflict). 14 test cases total.

### `tests/i18n/locale-persist-edges.test.ts` — 6 cases

| # | Test | Catches regression |
| --- | --- | --- |
| 1 | `loadStoredLocale` returns 'auto' when AsyncStorage throws | Removing the try/catch around `getItem` → boot crash |
| 2 | `loadStoredLocale` returns 'auto' on malformed stored value ('fr') | Loosening the strict allowlist (e.g. accepting any string) |
| 3 | `loadStoredLocale` returns 'auto' on empty-string stored value | Same allowlist regression as #2 |
| 4 | `resolveLocale('auto')` falls back to 'en' when `getLocales()` is `[]` | Removing the `?? 'en'` fallback at line 65 |
| 5 | `resolveLocale('auto')` falls back to 'en' when first locale's `languageCode` is null | Same `?? 'en'` fallback as #4 |
| 6 | `resolveLocale('auto')` lowercases prefix → 'Zh-Hant' / 'ZH' resolve to 'zh' | Removing `.toLowerCase()` before `startsWith('zh')` |

### `tests/domain/programGridLayoutEdges.test.ts` — 8 cases

| # | Test | Catches regression |
| --- | --- | --- |
| 1 | `cellDate('2024-02-28', 0, 1, 7)` → `'2024-02-29'` | Switching to local-time `Date()` would silently shift Feb 29 by one day for users in negative UTC offsets |
| 2 | `cellDate('2024-02-29', 0, 1, 7)` → `'2024-03-01'` | Same |
| 3 | `cellDate('2025-02-28', 0, 1, 7)` → `'2025-03-01'` (non-leap year) | Leap-year mis-detection |
| 4 | 7-day cycle from `'2024-02-25'` lands d=4 on Feb 29 | Off-by-one in cycle index math during leap years |
| 5 | Same cycle from `'2025-02-25'` skips to Mar 1 at d=4 | Same |
| 6 | `findNearestNonRestInRow` returns null when source IS the only filled cell | Changing loop to start at `dist=0` → returns self, breaks UX |
| 7 | `findNearestNonRestInRow` treats `template_id!=null, sub_tag=null` as non-rest | Adding `sub_tag != null` to the filter → drops un-tagged cells |
| 8 | `findNearestNonRestInRow` with `cycle_length=3` (ADR-0004 minimum) | Off-by-one loop bounds for tight cycles |

### Final test count

| Slice | Tests | Δ |
| --- | --- | --- |
| Baseline `c03670b` | 1379 | — |
| + locale-persist-edges | 1385 | +6 |
| + programGridLayoutEdges | 1393 | +8 |
| **Final** | **1393** | **+14** |

---

## § 5. Recommended follow-up (top 5 high-priority deferred test gaps)

Ordered by regression cost × likelihood:

1. **`appendReusableSupersetToSession` × active-session interlock.** Currently `findExistingReusableSupersetByPair` is order-insensitive but the active-session guard (added in `overwriteProgram` pattern) isn't applied here. A test should verify that appending an RS template when an active session already uses it neither throws nor silently corrupts ordering.

2. **`restoreSessionFromSnapshot` × dropset chain preservation.** The SQL preserves `parent_set_id` by column so behaviour is structurally correct, but no test makes the chain-invariant explicit. A snapshot → edit (add follower) → restore round-trip should verify the original chain re-appears intact.

3. **`convertSessionToTemplate` with 2 RS sharing same exercise.** Wave 5/18 evening #31 added the session_exercise_id filter, but the regression test is for a single RS. Add a 2-RS-same-exercise corruption-recovery case.

4. **`markClusterCycleLogged/Unlogged` × dropset chain on one side.** When the cluster A side hosts a dropset chain (head + followers) and the user toggles a working cycle on the OTHER side, the chain's `is_logged` propagation should not bleed. Skill memory says this is correct; an integration test would lock it.

5. **Wizard `Preview` / `Confirm` cascade validation surfaces first error.** When name is missing AND cycle_length=0, the user sees "Program name cannot be empty" not "cycle_length must be 3-14". Pin the order so future refactors don't shuffle it.

---

## Process notes

- Cherry-pick safety: NO existing test file was edited. Both new test files are standalone — they import from `src/` only, so they merge cleanly into any branch on top of `c03670b`.
- Dead-code drops include only files (`rm`) and one `export` keyword removal — no body changes. Risk surface: zero functional behaviour change.
- `npx expo install --check` was NOT run (no native deps changed); npm install used `--prefer-offline` to honor lockfile.
