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
