---
name: ship-partial-pure-logic
description: Ship a single pure-TS commit (typically a D-chain commit's pure-logic subset) without opening a PR. Triggers - "D{N} partial", "ship pure-logic ahead of wire-in", "activate Z scaffold", or any time a self-contained pure module needs to land on main while its runtime callers (native bridge / UI hook) are gated on something else. Files involved - src/services/<name>.ts or src/adapters/watch/<name>.ts (new module), tests/services/<name>.test.ts (or activate existing tests/adapters/watch/<name>.test.ts scaffold), src/adapters/watch/index.ts (barrel if exports needed).
---

# Ship partial pure-logic commit

When a D-chain commit (or slice sub-commit) has a pure-TS subset that can ship before its runtime callers are ready, lift just that subset into its own commit. Pattern emerged in slice 13d 2026-05-27 evening when D19/D20/D7-partial shipped reducer logic ahead of the `connectivity.ts` bridge (gated on D0 spike).

## When this fits

All three must hold:
- The eventual full commit has a self-contained pure-logic subset (reducer / state machine / formatter / validator).
- The pure subset has zero dependencies on native bridges (`react-native-watch-connectivity`, `@kingstinct/react-native-healthkit`), SQLite via the `Database` interface, or React.
- The subset's runtime callers are gated on something else (D0 spike, native scaffold, UI integration) OR come naturally later in the chain.

If the pure subset shares files with the future commit's other code, **don't split** — ship the whole thing together later.

## Recipe

1. **Branch**: `git checkout -b slice/13d-d{N}-{kebab-name}` (or `-partial` / `-subset` suffix for sub-shipment). No worktree needed — single-commit pure-TS work doesn't justify the worktree overhead from ship-slice skill.

2. **Module location**:
   - Cross-cutting service (Live Activity feed, reconciliation timer) → `src/services/<name>.ts`
   - WC protocol-specific (envelope reducer, payload helper) → `src/adapters/watch/<name>.ts`
   - Pure domain logic → `src/domain/<area>/<name>.ts`

   Pure imports only — no `react-native`, no `expo-sqlite`, no `Database` interface. If you can't help adding one, this isn't the right pattern.

3. **Tests**:
   - **Activating an existing Z scaffold** at `tests/adapters/watch/<name>.test.ts`: preserve the structure including any `it.todo(...)` for genuine TBDs. Flip `describe.skip` → `describe`, fill `it.skip` bodies with real assertions, import the just-shipped module. Z's todos are usually open design questions ("TBD — should X happen?") — keep them as `it.todo` not delete.
   - **Fresh tests**: place at `tests/services/<name>.test.ts` (matches `src/services/` module path). Aim 8-15 cases: happy path + boundary + stale/no-op + edge cases. Use Clock-injected actions (`tick(now)`) instead of `jest.useFakeTimers()` so tests stay cold under `testEnvironment: node`.

4. **Barrel update** (if exports needed): edit `src/adapters/watch/index.ts` (runtime + type re-exports separated by `export type {...}` block per existing convention).

5. **Targeted verify**: `npx tsc --noEmit && npx jest tests/path/to/your.test.ts` — confirm green before full suite. Don't run full suite locally unless you're chasing a flake; pre-commit hook will do it.

6. **Commit body discipline** — include all of:
   - ADR § reference: `ADR-0019 § Q23 + NEW-Q45`
   - LOC + dep count: `~225 LOC, 0 native deps`
   - Test count + delta: `+22 cases / +2 todo preserved`
   - **"Wire-in deferred" paragraph** naming the gate (e.g. `gated on connectivity.ts D3 bridge + D0 spike outcome`) and what the future call sites will look like. Future-you reading the commit log needs to know what's still owed.
   - Skill #18 flake acknowledgement if pre-commit hook surfaced them (it usually retries through).

7. **Pre-commit hook** runs full suite. The two cold-cache flakes (v011 FK / v024 NOT NULL — see overnight-parallel-agents skill #18) may surface; hook accepts. Don't try to fix them inline — they pass isolated.

8. **Push + cherry-pick + cleanup**:
   ```bash
   git push -u origin <branch>
   git checkout main
   git cherry-pick <sha>
   git push origin main
   git push origin --delete <branch>
   git branch -D <branch>   # -D because branch isn't merged into main per git's view
   ```

## Naming convention

| Title pattern | Use when |
|---|---|
| `feat(slice-13d): D{N} <summary>` | The full D-commit per ADR-0019 § 28-commit chain spec ships in one go |
| `feat(slice-13d): D{N} partial — <pure subset summary>` | Only the pure subset ships; rest gated |
| `docs(slice-13d): D{N} partial — <doc subset summary>` | Doc-only subset of a larger D-commit (e.g. D26 progress table update before the rest of the amendment lands) |

"Partial" in the title signals to future readers that the eventual D{N} entry in `ADR-0019 § 28-commit chain` table is a superset.

## Validated cases (2026-05-27 evening)

Four landings under this pattern in one session, zero conflicts on cherry-pick, pre-existing flakes self-resolved on hook retry:

| Commit | What shipped | LOC / cases |
|---|---|---|
| D20 `2e3b13d` | `setModifiedReducer.ts` per-field LWW + activate Z's `lww.test.ts` | ~95 / 9 |
| D19 `791a0ed` | `liveMirrorReducer.ts` immutable reducer + activate Z's `liveMirror.test.ts` | ~225 / 22 + 2 todo preserved |
| D26 partial `54b8f9d` | ADR-0019 shipped progress + schema row backfill + chain-order amendment | doc-only |
| D7 partial `9a29ef6` | `endSessionReconciler.ts` 5-sec state machine + fresh test | ~125 / 12 |

## What NOT to ship as partial

- **`react-native-*` imports** → those need `__mocks__/...` setup; bundle with runtime caller's commit.
- **SQLite via `Database` interface** → these can be pure-logic-tested but usually benefit from real SQLite tests (integration-level via better-sqlite3) which complicate the "0 native deps" promise. Bundle.
- **Tests requiring `jest.useFakeTimers()`** → the module has internal `setTimeout`. Refactor to Clock-injected reducer (see `endSessionReconciler.ts` `tick` action pattern) before shipping pure-logic, OR bundle with the caller.
- **Anything touching `app/(tabs)/index.tsx` or other `.tsx`** → that's UI wire-in, not pure logic. Defer to the runtime caller's commit.
- **Cross-cutting refactors that change multiple existing modules** — pure-logic partial is for *adding* a self-contained pure module. If you're refactoring, you're outside this skill's scope.

## Pairing with other skills

- **ship-slice**: full vertical slice with worktree + simulator + PR. Use that when shipping >1 commit or anything that touches UI/native.
- **extract-pure-logic**: lifting *existing* inline closures from `.tsx` to testable modules. Use that for retrofitting; use this skill for greenfield pure modules.
- **overnight-parallel-agents skill #13**: cherry-pick integration pattern — this skill applies it to single-commit code-writer flows.
- **overnight-parallel-agents skill #18**: cold-cache flake tolerance — relevant for step 7 pre-commit hook behavior.
