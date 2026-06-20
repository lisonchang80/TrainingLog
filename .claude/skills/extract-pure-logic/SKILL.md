---
name: extract-pure-logic
description: Promote inline closures / state-mutation logic from a React component (.tsx) to a pure module under `src/domain/` so it can be unit-tested in node env. Trigger phrases - "抽 pure logic", "extract closure to domain", "make this testable", or any time component-internal logic needs jest coverage. Files involved - components/**/*.tsx (source), src/domain/<area>/<name>.ts (extracted target), tests/domain/<name>.test.ts (unit tests).
---

# Extract pure logic from a React component to `src/domain/`

When component-internal logic (event handlers, state-transition functions, validators) needs jest unit-test coverage, lift it to `src/domain/<area>/<name>.ts` and have the component import it. Do NOT try to colocate inside the `.tsx` file — jest can't reach it.

## Why a separate `.ts` module is mandatory

TrainingLog's `package.json` jest config:

```json
"jest": {
  "preset": "ts-jest",
  "testEnvironment": "node",
  "testMatch": ["<rootDir>/tests/**/*.test.ts"]
}
```

Two hard constraints:

1. **`testMatch` is `.test.ts` only — not `.tsx`.** Colocating tests next to a `.tsx` component won't be picked up.
2. **`testEnvironment: node` — no React Native runtime.** Importing from a file that imports `react-native` blows up at module-load time with "Cannot find module 'react-native'" (jsdom doesn't help — RN's modules are native, not DOM).

So even if you write `tests/components/foo-keypad.test.tsx` with a working test, it won't run. The only path is: pure logic lives in a `.ts` file that has zero RN / React imports → component imports the pure functions and wraps them in UI state → tests import the pure functions directly.

## The mechanical recipe

1. **Identify the pure block.** Inside the component, find logic that:
   - Doesn't read/write React state directly (no `useState` setters, no `setDraft` calls).
   - Doesn't reference DOM/RN APIs (no `Pressable`, `View`, animated values).
   - Is deterministic: given input X, returns output Y. Side-effects like `console.log` are fine to strip; UUID generation is fine if injected via a `deps.newId()` parameter.

2. **Pick the target file.** Naming convention this repo uses (camelCase, descriptive):
   - Domain entity exists → put it there: `src/domain/template/templateOps.ts`, `src/domain/set/validateRecordSet.ts`.
   - No fitting domain → add a top-level pure module: `src/domain/keypad.ts` (UI input handling for the keypad modal).
   - Avoid `src/lib/` (doesn't exist in this repo as a convention) and `src/util/` (same).

3. **Extract verbatim first, refactor second.** Copy the closure body unchanged into the new file. **Don't "improve" the docstring** during the move — if the docstring describes behavior that doesn't match the closure (e.g. "normalizes to working" but the code returns `'warmup'`), the test will fail and you'll spend a round-trip diagnosing whether the bug is in old code, new code, or the test.

   Pattern bite (TrainingLog slice 10c Phase 2 commit 3): pulled `cycleSetKind` closure out; rewrote docstring to say cluster's stray-dropset state "normalizes to working" because that *seemed* more semantically correct. The actual closure was `currentKind === 'warmup' ? 'working' : 'warmup'` — dropset → warmup. Test failed, docstring + test had to be corrected to match the verbatim behavior. Cost: one round-trip. **Rule**: extract = faithful copy. Behavior changes are a separate commit.

4. **Add a `deps` parameter for non-determinism.** If the closure calls `newId('set')` or `Date.now()` or `Math.random()`, take them as injected dependencies so tests can pass deterministic stubs:

   ```ts
   export interface IdGenerator { uuid: () => string; }
   export function cycleSetKind(ex, set_id, idgen: IdGenerator) { ... }
   ```

   Tests pass `{ uuid: () => 'cyc-1' }`-style stubs. The component passes the real `() => newId('set')` lambda.

5. **For cluster/sibling-aware versions, dispatch don't duplicate.** When the closure has two branches (solo case + cluster-mirror case), and an existing pure function already covers solo:

   - **Wrong**: copy the solo logic into the new wrapper and add cluster mirror alongside (two copies of solo logic → drift risk).
   - **Right**: new wrapper takes the array, dispatches: cluster branch handles mirror inline; solo branch delegates to the existing per-ex pure function.

   Example (templateOps.cycleSetKindAcrossExercises): solo branch is one line — `exercises.map((ex) => ex.id === ex_id ? cycleSetKind(ex, set_id, idgen) : ex)`. Mirror branch is the only novel logic.

6. **Update the component to import.** The component handler becomes a 3-5 line wrapper that bundles state-setter logic around the pure call:

   ```tsx
   const cycleSetKind = (ex_id: string, set_id: string) => {
     if (!draft) return;
     setDraft({
       ...draft,
       exercises: cycleSetKindAcrossExercises(draft.exercises, ex_id, set_id, {
         uuid: () => newId('set'),
       }),
     });
   };
   ```

7. **Write tests in `tests/domain/<name>.test.ts`.** Mirror existing test style (see `tests/domain/templateOps.test.ts` for a good template-level reference, `tests/domain/keypad.test.ts` for a UI-input-logic reference). Build minimal fixtures with `makeEx({ id: 'ex-1', sets: [...] })`-style helpers; cover edge cases (empty input, invalid ids, off-by-one boundaries).

   Run only the new test file first to iterate fast:
   ```bash
   npm test -- --testPathPattern="<name>"
   ```

   Then run full suite to confirm no regression elsewhere:
   ```bash
   npm test
   ```

## Commit shape

Two clean shapes work — pick by size:

- **Single commit** (small extraction, ≤ ~200 lines moved): one `refactor(domain): ...` commit covering domain + component + tests.
- **Two commits** (big component or two distinct extracts): commit 1 = move helper + update component import; commit 2 = the bigger extraction with tests. See slice 10c Phase 1 commits 1 + 2 (`3bce155`, `ea0b011`) for a template — `SwipeableSetRow` was a pure file move so it shipped alone; `SetRowContent` extraction with type-genericization shipped as its own commit.

Conventional-commit prefix:
- `refactor(domain): ...` when promoting existing closure logic without changing behavior.
- `feat(...): ...` when the extraction creates a new module that didn't exist before (e.g. `src/domain/keypad.ts` for slice 10c commit 4 — even though the logic was new, it WAS net-new domain code).

## DB-mutating logic: emit ops, don't return new arrays

When the closure mutates rows in a DB-backed list (rather than just returning a new in-memory array), prefer emitting **a list of DB ops** over returning a new array.

The template-side `cycleSetKind` returns a new `TemplateExercise` because template data lives in a React state object — the entire `sets[]` array is replaced on every change. But the session-side `cycleSessionSetKind` (slice 10c Phase 2 commit 7a) instead returns:

```ts
type CycleSessionSetOp =
  | { type: 'update'; set_id: string; patch: {...} }
  | { type: 'insertFollower'; new_set_id: string; parent_set_id: string; ... }
  | { type: 'delete'; set_id: string };

function cycleSessionSetKind(sets, set_id, new_set_id): CycleSessionSetOp[]
```

The caller maps each op to a single repo call (updateSetFields / insertSessionSet / deleteSet). Why ops, not array:

1. **Each row is its own DB record** — diffing old vs new array to figure out which rows to UPDATE / INSERT / DELETE is busywork the pure function shouldn't do.
2. **Caller controls non-deterministic context** — ordering (max+1), session_id, exercise_id, created_at all live in the caller's runtime state. Pure function shouldn't fabricate them.
3. **Tests stay simple** — assert on the op list shape (`expect(ops).toEqual([{type: 'update', ...}, ...])`) instead of reconstructing the DB state.

When to use array-return vs op-emit:
- **Array-return**: data lives in a single in-memory container that's replaced wholesale (React state, draft objects). Template editor's `cycleSetKind` is the canonical example.
- **Op-emit**: data lives in a normalized DB where each item is its own row. Session set logger's `cycleSessionSetKind` is the canonical example. Reorder operations, cascade deletes, and partial-update bulk-edit logic also fit this mold.

The op-emit pattern needs the caller to inject `new_set_id` (or any other id-gen output) so the pure function stays deterministic — same `deps` parameter rule from §4 above.

## Anti-pattern: colocating tests in `tests/components/foo.test.tsx`

Tempting because the test file lives next to the component conceptually. Doesn't work — jest's `testMatch` is `.test.ts` only. Even if you fix the glob to include `.tsx`, you then need a jsdom-like env that can render RN, which means installing `@testing-library/react-native` + adjusting `testEnvironment`, which is a separate slice-level decision. Don't do it casually.

If you genuinely need to test rendered behavior (e.g. tap a button → modal opens), that's an integration smoke test — run the Expo simulator and verify by hand. Don't try to bolt a UI test runner onto this repo's jest config.

## Gotchas burned in (2026-06-02, big-file #8 extractions)

Validated extracting `computePRs` (→ `src/domain/pr/historyPrSnapshot.ts`) and the
hide-unchecked filters (→ `src/domain/set/hideUncheckedFilter.ts`) out of the
**giant screen files** `app/exercise-history/[id].tsx` (1915 L) and
`app/session/[id].tsx` (3656 L). Two clean extractions, `2e8dc7f` + `7b81ea3`.

- **Input type lives in an adapter? `import type` it — no layering violation.**
  When the function's input type is defined in `src/adapters/sqlite/*` (e.g.
  `ExerciseHistorySession`), the new domain module CAN `import type { ... } from
  '../../adapters/sqlite/...'`. Precedent: `src/domain/training/todayPlan.ts`,
  `templateListGroups.ts`, `session/editSnapshotPersistence.ts` all do it.
  Type-only imports are erased at compile → zero runtime / circular-dep cost (as
  long as the adapter doesn't import your new module back). Don't fabricate a
  duplicate "minimal structural" type — just import the real one.

- **Map ALL usages before cutting — decide move-entirely vs import-back, and drop
  orphan imports.** A symbol used ONLY by the function you're moving (e.g.
  `PR_ORDER`, `resolveEffectiveLogged`) moves entirely (don't re-export). A symbol
  the *page* still uses (e.g. `PRKey` in a label fn, `filterUncheckedSolo` at call
  sites) must be imported back. After the cut, an import that was the SOLE feeder
  of a moved symbol becomes an orphan (e.g. `BucketKey` once local `PRKey` left) →
  delete it; but `grep` the other co-imports first (`effectiveLoad`/`setVolume`/
  `classifyBucket` were still used elsewhere in the file → keep). tsc won't flag
  unused imports (no `noUnusedLocals`); the PostToolUse eslint --fix does, so
  cleaning them in the edit avoids churn.

- **Ground test expectations in the REAL primitive behavior, don't guess.** When
  the extracted fn calls domain primitives (`effectiveLoad`, `setVolume`,
  `classifyBucket`), READ their bodies before asserting expected numbers —
  `effectiveLoad('loaded'|'bodyweight')` = `weight`, `('assisted')` = `bw - weight`
  (null if bw null), `setVolume` = `eff * reps` with `assisted eff<=0 → null`,
  buckets 1-3/4-6/7-10/11-15/16+. Guessing the formula produces green-looking but
  wrong assertions that pin the wrong behavior. (Same spirit as §3 "extract
  verbatim" but for the test side.)

- **Worktree + symlinked node_modules → LSP phantom-diagnostic storm; tsc/jest is
  ground truth.** Doing the extraction in a `git worktree` with
  `ln -s <main>/node_modules` fires continuous bursts of "Cannot find module
  '../../src/...'", "Cannot find name 'expect'/'it'/'describe'", "implicitly has an
  'any' type" on files you never touched. ALL stale (the TS server mis-resolves
  across the symlink). Authoritative check = `npx tsc --noEmit` (exit 0) + `npx
  jest` in the worktree. Cross-ref overnight-parallel-agents #14.

- **Screen-file extractions are device-gated for MERGE.** Extracting from
  `app/**/[id].tsx` is behavior-preserving by construction (pure cut + import
  back), and jest+tsc prove the pure logic — but they do NOT prove the screen
  still renders. So commit on a branch off `main`, run the suite green, **push but
  DON'T merge**; gate the ff-merge on a Reload-JS device smoke of the affected
  page(s). Same gate model as native/App-Store branches. (Contrast: extracting
  from a small leaf `components/*.tsx` with existing coverage can merge directly.)
  **2026-06-20 refinement**: for a PURE-JS screen extraction the render is
  sim-verifiable, so a Reload-JS **iOS-Sim** smoke suffices to ff-merge (per
  `feedback_sim-smoke-first`) — reserve a real-device smoke for screens that
  surface Watch / HealthKit / signing. Drive the sim flow with `ios-simulator-smoke`.

## Screen-load orchestration → `src/services/` (2026-06-20, report 09 #3)

A third target tier beyond `src/domain/` (pure) and adapter repos (SQL): when the
thing you're lifting is a **whole screen's load/refresh engine** — a query fan-out +
derivation invoked from many sites that sets a dozen state vars — extract it to
`src/services/<loadX>.ts` returning a **flat state object**; the component keeps ONLY
the setState wiring (+ any UI-state mapping like `fromRow`).

Validated on the Training tab's `refresh()` (`app/(tabs)/index.tsx`), the de-facto
state-sync engine called from ~20 sites (focus + every set op). → `src/services/
loadTrainingTabState.ts`: `loadTrainingTabState(db, {now?})` returns a flat
`TrainingTabState` (exercises / activeSession / activeProgram / unit / templates map /
programCellToday / sets / plan / bw / title / prSnapshotById). The screen's `refresh`
became `const s = await loadTrainingTabState(db); setX(s.x); …` + the one
`fromRow(s.activeSession)` mapping. Commit `9602636`.

- **`src/services/` not `src/domain/`** when it does IO (fans out repo reads). Domain
  stays pure; services orchestrate repos + pure derivation (the `todayCell` /
  `computePRSnapshot` primitives it sequences already live in domain).
- **Return RAW data; leave UI-state mapping in the component.** Service returns the
  raw `activeSession` row; the component maps it via `fromRow` into its `SessionState`
  machine. Keeping state-machine/React concerns out is what keeps the service
  node-testable.
- **Inject `now` for date-dependent derivation** (`todayCell` needs "today") — same
  deps rule as §4; default `Date.now`, tests pass a fixed ms.
- **Single-phase setState is fine + cleaner** than the old two-phase inline refresh
  (set base → await second fan-out → set session). React 18 batches the one wire; no
  intermediate inconsistent render. Behaviour-equivalent.
- **Sweep now-dead source imports.** The fan-out lift orphaned 9 imports in index.tsx
  (`listExercises`, `getActiveProgram`, `listTemplates`, …) — remove them (grep
  co-imports first to keep still-used siblings, e.g. `localMsToIsoDate` stayed). tsc
  still exits 0 (no `noUnusedLocals`) but clean them anyway.

## Effectful subscription/listener cluster → `hooks/` (2026-06-20, report 09 #2)

A fourth tier: when the thing to lift is NOT pure logic but an **effectful `useEffect`
cluster** — a wall of `addListener` / subscribe / cleanup wiring (WC channels, event
emitters, timers) — it can't go to `src/domain/` (it's effectful) nor `src/services/`
(it's a hook). Lift it to a **custom hook** in `hooks/<useX>.ts` that takes the
component's refs/setters as params and owns the `useEffect` + cleanup. The component
shrinks to a one-line `useX(db, { refA, setB })` call.

Validated on the Training tab's two WC-listener `useEffect`s (end-session dual-channel
+ the 10-listener handshake/start/live-mirror/tick cluster) → `hooks/useWatchSync.ts`,
`app/(tabs)/index.tsx` −278 net lines. Commit `8ff1304` (branch `refactor/use-watch-sync`).

- **Lift the effect bodies + comments 1:1.** Same channels, same handlers, same
  intentional empty deps (`}, [])` + the `eslint-disable react-hooks/exhaustive-deps`),
  same cleanup. Load-bearing comments (DO-NOT-REMOVE markers, dual-fire idempotent
  notes) move verbatim — they encode why the wiring is shaped that way.
- **⭐ Verify the param signature against the audit — snapshots DRIFT.** The audit's
  proposed `useX(db, {...})` signature was written from a code snapshot; re-derive it
  from the CURRENT effect bodies. This session caught two drifts: the audit listed
  `endInFlightRef` (the effects never read it — only `finalizeEndAndRoute` does → dropped
  it) and OMITTED `setWatchLiveTicks` (hr/kcal-tick reducers need it → added it). Grep
  each candidate ref/setter inside the moved effects before putting it in the param list.
  (Same spirit as grill-with-docs "audit recommendations are stale-by-default".)
- **Type refs as `RefObject<T | null>`** (React 19.1: `useRef<T|null>(null)` returns
  `RefObject`, `.current` is mutable); setters as `Dispatch<SetStateAction<T>>`. Name a
  `type` alias for a fat callback ref (e.g. `FinalizeEndAndRoute`) so the hook stays
  typed without importing back from the component (circular).
- **jest count is UNCHANGED and that's correct.** A mechanical effect-lift has no new
  pure unit to test — behaviour is verified at RUNTIME (sim/device), not by jest. Don't
  manufacture a test to bump the count.
- **Sim-smoke proves MOUNT, not the wired behaviour.** A Reload-JS iOS-Sim smoke
  confirms the hook mounts cleanly (component renders, effects mount/unmount, no
  red/white screen) + that adjacent flows (e.g. `refresh()` via the passed ref) still
  fire — drive it with `ios-simulator-smoke`. But it CANNOT exercise the actual
  subscriptions (no Watch/peer to send events). So **if the cluster wires Watch / HK /
  live-sync runtime → push the branch but DON'T merge to main**; gate the merge on a
  real-device round-trip smoke (the audit's "not a blind merge"). Same device-gate model
  as §"Screen-file extractions". Because main may advance meanwhile, the eventual merge
  is a normal 3-way merge (disjoint files = clean), not necessarily `--ff-only`.

## DEDUP (N byte-identical copies) vs single extraction (2026-06-02, more #8)

A second flavour of extraction: not "lift one closure" but "collapse N copies of the
same logic scattered across files". Validated on `localYmd` (5 copies of a local
`YYYY-MM-DD` formatter), `deleteWarningSuffix` (4 copies: Today + detail × cluster +
solo), `resolveSetDefaults` (2 copies: Today + detail `onAddSet`).

- **Survey ALL copies first; confirm byte-identical before collapsing.** Grep every
  occurrence. If a copy DIFFERS (even subtly), do NOT fold it in blindly — either
  list the diff and extract only the common core, or leave the divergent one alone.
  Real examples kept SEPARATE on purpose: `stats-panel` used `YYYY/MM/DD` (slash) and
  `session-time-editor` used `YYYY-MM-DD HH:MM` (datetime) — both intentionally NOT
  merged into `localYmd`. Naively unifying them would have changed output.
- **Inject deps to keep the domain module locale/IO-pure.** When the duplicated logic
  calls i18n / Date.now / a DB lookup, take them as parameters so the module has zero
  RN/i18n imports. `computeDeleteWarningSuffix(sets, { withLogged, unfinished })` takes
  the two i18n message fns as deps; callers pass the right pair (the ONLY thing that
  differed between the 4 sites). `resolveSetDefaults(lastSet, historical)` keeps the
  async `listPriorSetsForExercise` lookup + `Date.now()` in the caller — and you MUST
  preserve caller invariants verbatim (e.g. "only query history when no lastSet";
  "dropset short-circuit runs before defaults"). State which invariants you preserved.
- **Thin named wrappers are fine.** Sites with domain-specific names (`formatDateLabel`,
  `dateKeyFromTimestamp`) can become 1-line delegates to the canonical fn — that IS the
  dedup (one impl). Don't force every call site to import the canonical name.
- **Manage the device-smoke surface — defer copies in not-yet-touched screens.** Each
  screen file a dedup touches joins the branch's Reload-JS merge gate. When collapsing
  copies, do the ones already in your smoke surface now and DEFER copies that live in a
  fresh screen (e.g. left `programs.tsx`'s formatter copy for a later commit so the
  Programs page didn't get pulled into this branch's smoke). Note the deferred copy.
