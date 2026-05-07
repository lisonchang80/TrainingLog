---
name: Ship Slice
description: End-to-end workflow for shipping one vertical slice (issue #N) of TrainingLog. Triggers - "開始 #N" / "ship slice N" / "start slice N". Covers worktree setup, build, verify (jest/tsc/lint/expo-doctor/Metro), commit + push + PR, real-device smoke test, squash merge from main repo, branch cleanup. Encodes lessons from slices 1 + 2.
---

# Ship Slice

Standard sequence for delivering one issue tracker slice (#2..#17) of TrainingLog: branch → build → verify → ship → smoke → merge → cleanup. Trigger phrase from user is typically `開始 #N`.

Each slice is a vertical tracer bullet (schema → repository → UI → tests). Stay narrow but cut all layers.

## 1. Open the worktree

From `~/code/TrainingLog` (main repo):

```bash
git worktree add ../TrainingLog-worktrees/slice-NN-<kebab-name> -b slice/NN-<kebab-name> main
```

Then enter via `EnterWorktree(path: "...")`.

`NN` is zero-padded (`01`, `02`, ...). `kebab-name` is short — e.g. `foundation`, `session-lifecycle`, `exercise-library`.

## 2. Bootstrap

```bash
npm install --no-audit --no-fund
```

The worktree starts with no `node_modules` — installing is mandatory before anything else (otherwise `expo install`, `npx tsc`, jest all fail).

## 3. Read the issue spec

```bash
gh issue view N
```

**Trust the issue, not memory.** Issue titles in memory may be outdated — the published acceptance criteria on GitHub are the contract.

## 4. Build the slice

Layer separation per ADR-0001:

- **Pure logic** — `src/domain/<area>/` — no DB, no React, no platform APIs. Unit-tested with plain jest in `tests/domain/`.
- **Schema** — new migration in `src/db/schema/vNNN_<name>.ts` registered in `src/db/migrate.ts`. Always `INSERT OR IGNORE` for seeds (idempotency). Bump `vNNN`.
- **Repository** — `src/adapters/sqlite/<area>Repository.ts` — pure functions taking `Database` (from `src/db/types.ts`). DB-integration tested in `tests/db/`.
- **UI** — `app/(tabs)/*` for tabs, `app/<route>/[id].tsx` for detail screens. Uses `useDatabase()` from `components/database-provider.tsx`.

### Architectural patterns to repeat

- **Database interface dual implementation**: `src/db/types.ts` defines `Database` interface; production = `expoDatabase.ts` (expo-sqlite), tests = `betterSqliteDatabase.ts` (better-sqlite3 :memory:). Same interface, repositories never import expo-sqlite directly.
- **uuid injection is REQUIRED**: any function that generates UUIDs takes `uuid: () => string` as a non-default parameter. Production callers pass `randomUUID` from `expo-crypto`; tests pass deterministic stubs. **Never** default to `() => crypto.randomUUID()` — Hermes (RN runtime) lacks global `crypto`, will crash on save at runtime.
- **clock injection optional**: `now: () => number = Date.now` for test determinism. OK to default.
- **State derived from DB**: UI doesn't hold lifecycle state in React-only state. Use `useFocusEffect(refresh)` to re-query DB on every focus. Lift DB rows into pure-logic state via `fromRow`.

## 5. Verify

Run all in parallel:

```bash
npm test                  # jest — must be all green
npx tsc --noEmit          # type check — must be clean (no output = OK)
npm run lint              # expo lint — must be 0 errors / 0 warnings
npx expo-doctor           # 17 / 17 checks
rm -rf dist && npx expo export -p ios   # Metro bundle compiles
```

If any fail, fix before commit. Common gotchas:
- After adding a migration that seeds new rows, slice-1 tests asserting `toHaveLength(1)` will break — bump expectation + use `find(name === ...)` instead of `[0]` positional access.
- Lint complains about `Array<T>` syntax — use `T[]` instead.
- **jest test fixture pollution**: a `const fixture = {...}` declared inside a `describe` block is shared across `it` cases — if any test mutates it (e.g. `fixture.exercises.push(...)` to assert mutation isolation), later tests see the polluted version. Use a factory `const buildFixture = () => ({...})` and call it inside each `it`. Slice 3 hit this when the "mutating source template after snapshot" case left a 3rd exercise behind for the next test.
- **Adding a new tab requires icon mapping**: `components/ui/icon-symbol.tsx` keeps an explicit `SF Symbols → MaterialIcons` `MAPPING`. If you reference an unmapped name in `_layout.tsx`, TypeScript blocks via the `IconSymbolName` keyof guard. Add the entry first (e.g. `'doc.text': 'description'`).

## 6. Commit (logical units)

`git diff --stat` first, then split by purpose:
- Don't mix layers in one commit (e.g. don't put pure-logic + UI in the same commit).
- Tests for X go with X.
- Each commit message ends with:

  ```
  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  ```

Style example: `feat: Module #6 Session Manager — pure-logic state machine`. Title-cased, em-dash separator, `feat:/fix:/chore:/docs:/refactor:` prefix.

## 7. Push + PR

```bash
git push -u origin slice/NN-<kebab-name>
gh pr create --title "Slice N: <name> — <one-line summary>" --body "$(cat <<'EOF'
Closes #<issue-number>.

## Summary
- Bullet per major change

## Acceptance criteria (issue #<n>)
- [x] each criterion ticked

## Verification
- npm test: X / X
- tsc / lint / expo-doctor / Metro export

## Test plan (manual smoke)
- [ ] step 1
- [ ] step 2
EOF
)"
```

PR title under 70 chars. Body cites the issue's exact acceptance criteria so review is mechanical.

## 8. Real-device smoke test

`npx expo start --ios` (background) → boots iPhone simulator with Expo Go.

Walk the user through the manual flow corresponding to the acceptance criteria. **The smoke test is what catches platform bugs unit tests miss** — slice 1 caught the Hermes-no-crypto bug only on real device because tests injected fake uuid.

If user does the steps themselves, just monitor + ask for screenshots at key states. After verification, kill Metro: `pkill -f "expo start"`.

### Smoke-test gotchas to mention upfront

- **iOS Simulator software keyboard hidden by default**: the simulator pipes the Mac keyboard in as a "hardware keyboard", so tapping a `TextInput` shows a cursor but no on-screen keyboard. Tell the user to **type with the Mac keyboard directly** (cursor is in the field — it just works), or press **⌘K** in the Simulator to toggle software keyboard. Otherwise they'll think the input is broken.
- **Routes outside the `(tabs)` group hide the bottom tab bar**: `app/template/[id].tsx` and `app/session/[id].tsx` are siblings of the `(tabs)` group, so when pushed they fully cover the tab bar. The auto-generated header back button (e.g. `< (tabs)`) sometimes fails to fire on the simulator, leaving the user stranded with no way out. **Recovery**: Cmd+R in the Simulator to reload JS, or kill + relaunch the app. **Polish fix for later**: present these screens as modal (`presentation: 'modal'` in `Stack.Screen` options) or mount inside the tabs group as a sub-route. Don't block ship for this; capture as a follow-up issue.
- **Placeholder text vs entered text**: `TextInput placeholder` renders in grey; an empty field with the cursor in it still counts as empty. Users may think `60` is already entered when it's just placeholder. If they report "Save Set does nothing", first check the field colors.

## 9. Merge — from main repo, NOT worktree

Critical: `gh pr merge ... --delete-branch` fails inside a worktree because deleting the branch requires checking out main, but main is already checked out by the parent worktree.

```
ExitWorktree(action: "keep")        # exit the session's worktree
# session is now back in ~/code/TrainingLog
gh pr merge N --squash --delete-branch
```

If the merge succeeds on GitHub but local cleanup fails (e.g. worktree directory still holds the branch):

```bash
git worktree remove ~/code/TrainingLog-worktrees/slice-NN-<kebab-name>
git push origin --delete slice/NN-<kebab-name>   # if remote still has it
git branch -D slice/NN-<kebab-name>              # -D is required: squash creates a different SHA, so -d says "not fully merged"
git fetch --prune && git pull
```

Sanity check at the end:
```bash
git worktree list   # should show only the main repo
git branch -a       # should show only main + remotes/origin/main
git log --oneline -3   # newest commit = the squashed slice merge
```

## 10. Update memory in /cp

After ship, run `/cp` to:
- Update `~/.claude/projects/<slug>/memory/project_traininglog_overview.md` — bump completed slice count (`X/16 done`), update next-step pointer, capture any new lessons.
- Update `MEMORY.md` hook line if the one-liner is stale.
- DO NOT push memory — user-level only.

## Out-of-scope reminders

- Don't refactor unrelated areas just because you're touching nearby files. Stay in the slice.
- Don't write docs for features that haven't shipped.
- Don't create new ADRs unless the slice's design decision genuinely deserves one — check if existing ADRs already cover it.
- Don't stage or commit `dist/` (Metro export output) — `.gitignore` should already cover it but double-check.
