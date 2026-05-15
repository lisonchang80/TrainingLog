---
name: Ship Slice
description: End-to-end workflow for shipping one vertical slice (issue #N) of TrainingLog. Triggers - "開始 #N" / "ship slice N" / "start slice N". Covers worktree setup, build, verify (jest/tsc/lint/expo-doctor/Metro), commit + push + PR, smoke test (Expo Go for slices 1-8, Simulator dev build slice 9+), squash merge from main repo, branch cleanup. Encodes lessons from slices 1-9.
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

**No-new-dep slice → symlink shortcut**: when a slice adds zero new packages (e.g., pure-backend phases: schema + repo + pure-logic tests), `npm install` is wasted work. Symlink main worktree's `node_modules` instead — jest + ts-jest + better-sqlite3 native binding all share fine on macOS:

```bash
ln -s /Users/hao800922/code/TrainingLog/node_modules ./node_modules
```

Slice 9.6 Phase 1 used this — `node_modules` symlink + `npx jest` ran 439 tests in 2.7 s with zero install. **Caveat 1**: any time you `npx expo install <pkg>` or `npm install <new-dep>`, you MUST break the symlink first (`rm node_modules && npm install`) — otherwise the new package writes through into main worktree's `node_modules` and contaminates the parent's lockfile state. Also matches the user's "embedded-terminal `npm install` is annoying" preference (feedback_claude_code_embedded_terminal.md). **Caveat 2 — Metro does NOT follow the symlink**: jest uses Node's resolver and traverses symlinks transparently, but Metro (RN bundler) has its own resolver that **refuses to resolve modules through a `node_modules` symlink**. Symptom: `npx expo start --ios` crashes the red-screen with `Unable to resolve module ./TrainingLog/node_modules/expo-router/entry` (note the weird relative path — Metro is trying to resolve through the symlink and gets nonsense). So the symlink shortcut is **strictly for jest / tsc / pure-logic work**. The moment a slice enters UI / simulator-smoke territory, break the symlink and `npm install` for real: `rm node_modules && npm install` (~2-3 min). Slice 9.6 L1 hit this — `library.tsx` rewrite passed jest cleanly but red-screened in simulator until the symlink was replaced with a real install.

**Adding a new native module mid-slice**: use `npx expo install <pkg>` (NOT `npm install <pkg>`). `expo install` picks the version compatible with the current Expo SDK; raw `npm install` will pull `latest` and silently break iOS bundling. Slice 6 hit this — `react-native-svg` is the canonical example. The user-level "不要幫忙裝工具" preference is about system-level tools (brew / xcode-select), NOT project npm deps tracked in package.json — but still ask the user before adding a new dep, since it changes the lockfile and adds attack surface.

## 3. Read the issue spec

```bash
gh issue view N
```

**Trust the issue, not memory.** Issue titles in memory may be outdated — the published acceptance criteria on GitHub are the contract.

## 4. Build the slice

Layer separation per ADR-0001:

- **Pure logic** — `src/domain/<area>/` — no DB, no React, no platform APIs. Unit-tested with plain jest in `tests/domain/`.
- **Schema** — new migration in `src/db/schema/vNNN_<name>.ts` registered in `src/db/migrate.ts`. Always `INSERT OR IGNORE` for seeds (idempotency). Bump `vNNN`. **`ALTER TABLE ADD COLUMN` for a NOT NULL column must include `DEFAULT <value>`** — SQLite refuses to add a NOT NULL column without a default because existing rows have no value for it. Slice 4 (`is_evergreen INTEGER NOT NULL DEFAULT 0`) is the canonical example. **Migration version = `ls src/db/schema/` HEAD + 1, NOT the ADR's planning name** — ADRs often pre-allocate version numbers assuming earlier ADRs would ship first (e.g., ADR-0016 wrote "v012 累加" assuming ADR-0014/0015 had landed as v009/v010/v011), but in practice schema HEAD can be far behind. Slice 9.5 hit this: ADR-0016 said "v012" but actual schema HEAD was v008 → migration shipped as v009. **Always check `ls src/db/schema/`** before writing migration filename + `migrate.ts` registry number, and add a comment in the migration explaining the gap if there is one.
- **PHASE the DROP COLUMN — don't bundle it with the replacement ADD COLUMN**: when a migration ADDs a new column that supersedes an old one (e.g., per-Exercise `exercise.notes` replacing per-template `template_exercise.notes`), the temptation is to also `ALTER TABLE … DROP COLUMN` the legacy column in the same migration. **Resist it.** Slice 9.6 v010 tried this — DROP'd `template_exercise.notes` and instantly cascade-broke `templateRepository.getTemplateFull` + `commitTemplateDraft` (which still SELECT/INSERT the column) + 8 `templateRepositoryV2` tests + the v009 schema test that asserted `notes` exists. Recovery cost a same-session revert. **Phased pattern**:
  1. Phase A migration: ADD new column + best-effort merge of old data → new column (data preserved, both columns coexist)
  2. Production code: switch repository + UI reads/writes from old column to new column
  3. Phase B migration (separate, later): `DROP COLUMN` the legacy column
  Document the phasing in the migration file comments + ADR § migration plan + a issue comment (so the post-grill acceptance-criteria checkbox audit trail is preserved).
  **Phase B aftershock — old tests outside the new migration's own test file break too**: any historical test that does `await migrate(db)` then asserts `PRAGMA table_info(<table>)` contains the dropped column will start failing. Slice 9.6 v012 hit `v009TemplateSet.test.ts` "adds template_exercise.notes column" + `v010ExerciseLibraryV2.test.ts` "keeps notes column post-v010" — both used full `migrate(db)`, both broke when v012 landed. Fix by converting each to **manual replay (stop at version N)**: import only `v001_initial..vNNN_<add>` and apply them one by one before the column assertion. The pattern (already used for backfill tests in slice 9.5) keeps the historical contract verifiable without conflicting with the later DROP. Also strip the dropped column from any `INSERT INTO <table> (..., <col>, ...)` in unrelated test fixtures — those crash with `SqliteError: table X has no column named <col>` once Phase B lands.
- **Repository** — `src/adapters/sqlite/<area>Repository.ts` — pure functions taking `Database` (from `src/db/types.ts`). DB-integration tested in `tests/db/`.
- **UI** — `app/(tabs)/*` for tabs, `app/<route>/[id].tsx` for detail screens. Uses `useDatabase()` from `components/database-provider.tsx`.

### Architectural patterns to repeat

- **Database interface dual implementation**: `src/db/types.ts` defines `Database` interface; production = `expoDatabase.ts` (expo-sqlite), tests = `betterSqliteDatabase.ts` (better-sqlite3 :memory:). Same interface, repositories never import expo-sqlite directly.
- **uuid injection is REQUIRED**: any function that generates UUIDs takes `uuid: () => string` as a non-default parameter. Production callers pass `randomUUID` from `expo-crypto`; tests pass deterministic stubs. **Never** default to `() => crypto.randomUUID()` — Hermes (RN runtime) lacks global `crypto`, will crash on save at runtime.
- **clock injection optional**: `now: () => number = Date.now` for test determinism. OK to default.
- **State derived from DB**: UI doesn't hold lifecycle state in React-only state. Use `useFocusEffect(refresh)` to re-query DB on every focus. Lift DB rows into pure-logic state via `fromRow`.
- **UI name-lookup must seed from every data source**: when a screen renders rows that come from multiple queries (e.g. plan rows + actual set rows in Save-back), build the `exercise_id → name` map from BOTH sides — not just one. Slice 4 shipped a Save-back where Modify/Add cards rendered names but Remove cards showed a raw UUID, because the name map was seeded only from set rows; planned-but-skipped exercises had no matching set row. Either use the `*WithName` JOIN variant on the plan side or merge two lookups before render.
- **RN vertical ScrollView in a row-flex parent IGNORES `style.width`**: `<ScrollView style={{ width: 92 }}>` inside a `flexDirection: 'row'` container will silently grow to fit its widest descendant's intrinsic width, NOT respect the 92pt cap. None of `flex: 0`, `flexGrow: 0`, `flexShrink: 0`, or `alignSelf: 'flex-start'` on the ScrollView itself fix it. Slice 9.6 L1 hit this — the Library sidebar ScrollView (configured `{ width: 92 }`) rendered at 247pt because its sub-muscle row children's intrinsic content nudged contentSize beyond 92; the body's `flex-row` layout then gave the content area only `402 - 247 = 155pt`, collapsing the 2-col grid to 1-col + squashed cards. Diagnosed via `onLayout={(e) => console.log(layout.width)}` walked up the tree (body=402 → sidebar=247 → content=155 → grid=131). **Fix**: wrap the ScrollView in a fixed-width outer View with `overflow: 'hidden'`. The outer View respects `width` properly; `overflow: 'hidden'` clips the rogue ScrollView frame back to spec. Pattern: `<View style={{ width: 92, overflow: 'hidden' }}><ScrollView style={{ flex: 1 }}>...</ScrollView></View>`. Same workaround applies to horizontal ScrollViews stealing vertical space — wrap in `<View style={{ height: N }}>`.
- **For 2-col grids, prefer manual row-pair rendering inside a ScrollView over FlatList numColumns**: `FlatList numColumns={2}` + `columnWrapperStyle` + child `aspectRatio` + child `flex: 1` is a combination that breaks under RN 0.74+'s layout passes in nested flex / ScrollView contexts (slice 9.6 L1 cards shrank to ~60pt instead of 138pt). The bullet-proof alternative: compute pairs with a `for (let i = 0; i < items.length; i += 2)` loop into `Exercise[][]`, then render each pair as `<View style={{ flexDirection: 'row', gap }}>` with explicit pixel widths from `useWindowDimensions` (NOT `flex: 1` cards, which interacts badly with aspectRatio). Drop `aspectRatio` for explicit `height` to fully decouple cross-axis measurement. The cost is ~10 lines of pair-batching logic; the win is reproducible layout.

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
- **Adding a required field to a domain interface breaks prior-slice fixtures**: tests that use strict `toEqual({...})` against the type will fail because the fixture object literal no longer matches the now-wider type. Slice 4 hit this when `is_evergreen: 0 | 1` was added to `TemplateExerciseSpec` / `SessionExerciseRow` / `TemplateExerciseRow` and broke `tests/domain/templateManager.test.ts` + `tests/db/templates.test.ts`. Before pushing, grep for `toEqual({` in `tests/` and add the new field to every matching fixture; don't trust "all tests in my new file pass" as proof everything's green.
- **Adding a new tab requires icon mapping**: `components/ui/icon-symbol.tsx` keeps an explicit `SF Symbols → MaterialIcons` `MAPPING`. If you reference an unmapped name in `_layout.tsx`, TypeScript blocks via the `IconSymbolName` keyof guard. Add the entry first (e.g. `'doc.text': 'description'`).
- **Controlled numeric `<TextInput>` round-trip eats trailing `.` / partial input**: `<TextInput value={String(set.weight)} onChangeText={t => setWeight(Number(t))}>` looks fine but bites whenever the user types a partial-but-valid prefix. `Number("12.") === 12`, so the next render writes back `"12"` and the dot is silently erased before the user can type the fractional digit. Same hazard on backspace-to-empty (`Number("") === 0` → field jumps to "0"). **Fix**: keep a local string buffer inside the row component; sync from prop only when the buffer's *parsed* value diverges from the prop. Mid-typed states like `"12."` (parses to 12 == set.weight) are then preserved while external changes (e.g. `cycleSetKind`, cluster clone) still refresh the field. Slice 9.5 hit this on the per-set reps/weight inputs in Template editor — fix lives in `components/template-editor/template-editor-view.tsx` `SetRowContent`. Also: use `keyboardType="decimal-pad"` for weight (surfaces dot key on iOS) and `"number-pad"` for reps.

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

## 8. Smoke test

**Slices 1–8**: `npx expo start --ios` (background) → boots iPhone simulator with Expo Go.

**Slice 9 onwards**: `npx expo run:ios --device "iPhone 17"` (background) → builds dev build natively, installs to simulator, launches. First run is 5–10 min cold build; budget for it. Pod install needs `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8` (see gotcha below).

Walk the user through the manual flow corresponding to the acceptance criteria. **The smoke test is what catches platform bugs unit tests miss** — slice 1 caught the Hermes-no-crypto bug only on real device because tests injected fake uuid.

If user does the steps themselves, just monitor + ask for screenshots at key states. After verification, kill Metro: `pkill -f "expo start"` (or `expo run`).

For slice 9+, sub-agent `simulator-smoke-db` (Haiku) can verify post-flow DB state automatically via `xcrun simctl get_app_container` — invoke for deterministic state checks; UI judgement still goes to the user.

**If the parent harness can't see the sub-agent** (Agent tool returns `Agent type 'simulator-smoke-db' not found`), fall through to read-only `sqlite3` SELECT calls from the main agent. Locate the dev-build DB the same way the sub-agent does:

```bash
APP_DATA=$(xcrun simctl get_app_container booted com.anonymous.TrainingLog data)
DB="$APP_DATA/Documents/SQLite/traininglog.db"
sqlite3 "$DB" "SELECT key, value FROM app_settings;"
```

This is acknowledged in the overnight playbook rule set ("read-only ad-hoc sqlite3 is OK for spot-checks") — burns Opus tokens instead of Haiku, but unblocks verification. The harness limitation surfaced 2026-05-09 overnight when project-level `.claude/agents/` files weren't exposed via the parent's Agent tool.

### Smoke-test gotchas to mention upfront

- **iOS Simulator software keyboard hidden by default**: the simulator pipes the Mac keyboard in as a "hardware keyboard", so tapping a `TextInput` shows a cursor but no on-screen keyboard. Tell the user to **type with the Mac keyboard directly** (cursor is in the field — it just works), or press **⌘K** in the Simulator to toggle software keyboard. Otherwise they'll think the input is broken.
- **Routes outside the `(tabs)` group hide the bottom tab bar**: `app/template/[id].tsx` and `app/session/[id].tsx` are siblings of the `(tabs)` group, so when pushed they fully cover the tab bar. The auto-generated header back button (e.g. `< (tabs)`) sometimes fails to fire on the simulator, leaving the user stranded with no way out. **Recovery**: Cmd+R in the Simulator to reload JS, or kill + relaunch the app. **Polish fix for later**: present these screens as modal (`presentation: 'modal'` in `Stack.Screen` options) or mount inside the tabs group as a sub-route. Don't block ship for this; capture as a follow-up issue.
- **Placeholder text vs entered text**: `TextInput placeholder` renders in grey; an empty field with the cursor in it still counts as empty. Users may think `60` is already entered when it's just placeholder. If they report "Save Set does nothing", first check the field colors.
- **Aggregation: use the modal group, not the last set**: when summarising user-logged sets back into a single `(sets, reps, weight)` tuple (Save-back, history rollups, Watch quick-stats), the naive "total count + last set's reps/weight" heuristic is wrong — a backoff / deload set at the end dominates the summary. Slice-4 smoke caught it: user logged `4 × 8 @ 70 kg` then `1 × 10 @ 20 kg`, got "5 × 10 @ 20 kg" proposed. Group sets by `(reps, weight)` tuple, pick the modal (largest count) group, tiebreak on heavier weight then earliest appearance, and report the modal group's count — internally consistent and matches the user's "work set" mental model. Reach for this pattern any time you condense N sets to one summary row.
- **Don't hand the user expected counts you didn't compute from the seed**: when telling the user "search press → 8 動作" / "MG=胸 → 9 個", count the literal seed array first (e.g. grep the seed file for the muscle/load_type) — eyeballing breeds off-by-three errors that look like real filter bugs to the user. Slice 6 smoke had three wrong predicted counts (11→9, 11→8, 11→8) because the seed kept growing while I was eyeballing the same mental model. If you can't be bothered to compute, say "filter should narrow the list" without a number; the user's screen IS the ground truth.
- **DB write that immediately re-renders → seed derived state in the same callback, don't rely on next focus refresh**: when an action both writes to DB AND transitions the screen into a new render path (e.g. pre-session confirm: createSession → render in_progress UI in same tick), the derived state used by that new render path must be set in the same callback. `useFocusEffect(refresh)` only fires on focus change — if you stay on the same tab, the next render reads the OLD derived state and the user sees a missing/stale UI piece. Slice 7 smoke caught this: `bwSnapshotKg` was only seeded inside `refresh()`, so confirming the pre-prompt left the 🔒 badge invisible until the user tab-switched. Fix: `setBwSnapshotKg(bwKg)` right next to `setSessionState(startState(...))` in the confirm handler. Whenever you call a `setX(...)` that flips the visible UI branch, scan the new branch's render for any state it reads that came from a Promise.all in `refresh()` — those need a synchronous local set too.
- **Concept-group your status badges, don't orphan them between unrelated headers**: when a UI status badge (lock indicator, snapshot value, sync state, validation flag) belongs conceptually to a feature block, place it inside that block's visual region. Slice 7 smoke had `🔒 BW snapshot · 72.0 kg` placed between the "Session in progress · 0 sets" subhead and the "Body data" header, which read as orphan text — user immediately asked "should this be under Body data?". Rule of thumb: if removing the badge would leave the surrounding section coherent, it's in the wrong place. Put it under the most-related section header, not in the gap between two sections.
- **Metro fast-refresh silently stuck → restart with `--clear`**: during in-flight smoke, you may patch a UI file but the simulator keeps showing the OLD version even after Cmd+R. Symptoms: Metro log shows zero bundling activity post-edit; `git diff` confirms the edit landed; `tsc` / `lint` are clean; user reloads but sees stale UI. This means the file watcher missed the change OR Hermes is serving a cached pre-built bundle. **Fix**: `pkill -f "expo start"` then relaunch with `npx expo start --ios --clear` — the `--clear` flag rebuilds the Metro cache from scratch (`warning: Bundler cache is empty, rebuilding` confirms). Don't waste loops sending Cmd+R when the bundle log shows no compile activity; trust the Metro log over the simulator. Slice 8 smoke hit this twice — chip label fix didn't surface until cache was busted.
- **Cocoapods 1.16.2 + Ruby 4.0.3 unicode bug → set UTF-8 locale**: when a worktree first hits `npx expo run:ios` (which auto-runs `pod install`), pod install crashes with `Encoding::CompatibilityError: Unicode Normalization not appropriate for ASCII-8BIT`. Root cause: Ruby 4.0+ changed default encoding handling, Cocoapods 1.16.2 didn't catch up. **Fix**: prefix with `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pod install`. Slice 9 first dev-build attempt hit this. Add to slice prep checklist whenever a new worktree needs `pod install`.
- **Worktree first `expo run:ios` is COLD-build slow (5-10 min)**: each git worktree has its own gitignored `ios/` directory. `expo prebuild` regenerates from scratch, then xcodebuild compiles all 92+ pods (reanimated, Hermes, RN core) without DerivedData reuse from the main repo's build. Don't panic — track progress via `tail` of the build log; 500+ "Compiling X.cpp" lines is normal mid-build. **Plan for it**: don't kick a worktree dev build at the start of a 30-min smoke window; budget 15 min purely for the build first.
- **Expo Go vs dev build sandbox isolation**: when a slice introduces native modules (or you switch a slice to dev build for any reason), the Expo Go app and the dev build app each have their own sandbox + their own SQLite DB. **Symptom**: user says "I logged a set but achievements show 0/255" → check which app variant they used. Their last app's data is in `Documents/ExponentExperienceData/@anonymous/TrainingLog-*/SQLite/` (Expo Go) vs `Documents/SQLite/traininglog.db` (dev build). Use `xcrun simctl get_app_container booted com.anonymous.TrainingLog data` to find the dev build's data dir authoritatively. Migration from Expo Go → dev build = fresh DB; the user must redo any data-dependent smoke steps.
- **`expo prebuild` modifies app.json + package.json — commit explicitly**: when a worktree first runs `expo run:ios`, prebuild adds `ios.bundleIdentifier` to `app.json` and rewrites `npm run ios` from `expo start --ios` to `expo run:ios` in `package.json`. These show as **uncommitted modifications** in `git status`. They are **legitimate dev-build switch artifacts** — commit them with a chore message explaining the workflow shift, do NOT revert. Slice 9 hit this when switching from Expo Go to Simulator dev build mid-smoke.
- **Adding a native module mid-smoke → kill Metro + relaunch with `--clear`, not just hot-reload**: when you `npx expo install <pkg>` for a native module (e.g. `@react-native-community/datetimepicker` in slice 9), Metro's running bundle doesn't see the new native binding. Cmd+R alone shows `Unable to resolve module ...` errors. **Fix**: same `pkill -f "expo start"` + `npx expo start --ios --clear`. The `--clear` flag is needed because the Metro bundler cache pre-dates the new module entry. Tell the user upfront so they don't waste a Cmd+R loop. Distinct from the fast-refresh gotcha above: that's about a stale JS bundle; this is about a missing native module entry.
- **SVG chart axis: use `SvgText` for rotated labels, not RN `<Text>` in a flex slot**: rotating a `<Text>` inside a `flex: 1` parent (e.g. for `-30°` X-axis tick labels) makes RN measure the **un**rotated width against the slot first, then truncate with `...` BEFORE applying the transform. Symptom: "2021" renders as "20..." in a 25px slot. **Fix**: render labels as `<Text>` from `react-native-svg` inside the `<Svg>` itself, with `textAnchor="end"` and `transform={\`rotate(-30 ${cx} ${cy})\`}`. SvgText doesn't get clipped by sibling layout; rotated text overflows freely into adjacent whitespace. Slice 9 MiniBarChart hit this on the year scale.
- **Rotated SvgText with `textAnchor="end"` → asymmetric padding for the first label**: when SvgText anchored at `(cx, cy)` rotates `-30°` upward-left, its bounding box extends ~22px to the left of `cx`. The first bar's `cx` is at `PAD_X + barSlot/2` ≈ 16px from SVG left edge — so the leftmost glyph clips at the SVG boundary ("2021" → "021"). **Fix**: split `PAD_X` into `PAD_LEFT` (≥ 22 for fontSize 10) and `PAD_RIGHT` (≥ 4); recalculate `usableWidth = width - PAD_LEFT - PAD_RIGHT` and shift bar / baseline / avg-line geometry by `PAD_LEFT`. Slice 9 round-4 caught this AFTER switching to SvgText fixed the truncation but introduced this clipping at x=0.
- **Pushing into a `(tabs)/X` route from a stack-pushed screen swaps tab focus → `router.back()` follows TAB history, not stack pop**: when a stack route (e.g. `/template/[id]`) calls `router.push('/library?mode=picker')`, expo-router doesn't add a new stack frame above the editor — it switches the active tab inside `(tabs)/`, and the back behavior then follows the most-recently-active tab. So 完成/✕ in the picker lands on Today (the default tab) instead of returning to the template editor. **Symptom**: user reports "按完成跳到 Today、按 ✕ 也跳 Today". **Fix**: make the picker a sibling stack route OUTSIDE `(tabs)` (e.g. `app/exercise-picker.tsx`) and register it in `app/_layout.tsx`'s root Stack. Push the new route → real stack frame → `router.back()` pops cleanly. Slice 9.6 L2 picker hit this. Note: re-exporting via `export { default } from './(tabs)/library'` is NOT enough — expo-router resolves both routes to the same screen identity and still does tab-focus-swap. You MUST wrap in a thin function component (`export default function() { return <LibraryScreen />; }`) for the two routes to have distinct identities.
- **Stale cached state when a sibling/child route creates a new entity → caller's cache is frozen at mount**: when screen A loads a list of entities into local state ONCE on mount (`useEffect` with `[db, id]` deps), and screen B (pushed via `router.push`) creates a new entity then returns, screen A's cached list does NOT refresh. If screen A then uses the cache (e.g. to look up the new entity by id), the lookup silently fails. **Symptom**: user reports "建完新動作沒被加進來，要重開 editor 才看得到". **Fix**: re-fetch live data at the use site, not at mount. For picker → editor hydration, the editor's `hydrateExercisesByIds` does a fresh `listExercises(db)` call at the top of the function instead of trusting cached `exerciseLibrary` state. Cost: one extra query per hydration (sub-100ms for ~70 rows). Slice 9.6 L2 caught this — picker would addSelection on the new id, submitPick on 完成, editor's hydrate `.find(cachedLibrary, id)` returned undefined → silent skip via `continue`.
- **In-process singleton "mailbox" for cross-route data handoff**: when route A pushes route B and B needs to return data to A, expo-router doesn't natively pass params back through `router.back()`. **Pattern**: a tiny module-level singleton with `submitX(payload)` / `consumeX(): payload | null` semantics. B writes before `router.back()`; A reads in `useFocusEffect` on re-focus. Both `submit` and `consume` clear on read so a re-focus doesn't re-apply. Cross-direction works too (parent → child entity creation feedback): both `pickerBridge.submitPick` (picker → editor multi-select handoff) AND `pickerBridge.submitNewlyCreated` (new-form → caller auto-select) in `src/domain/exercise/pickerBridge.ts`. Pair the mailbox with the two-stage drain pattern below if the destination's render needs other async state to be ready before consuming.
- **Two-stage drain for `useFocusEffect` payload that depends on other async state**: when a focus effect consumes a mailbox payload BUT the work it triggers needs another piece of async state that may not be loaded yet (e.g. editor cold-remounts; `draft` from `getTemplateFull` is still loading when consume fires), the work silently no-ops. **Pattern**: stage 1 — focus effect ONLY captures the payload into a `pendingPick` state, doesn't act. Stage 2 — a separate `useEffect` with `[pendingPick, draft, otherAsyncDep]` deps does the actual hydration when all gates pass, then clears `pendingPick`. Slice 9.6 OD hit this when user navigated Today → Templates → template/[id] instead of using the back stack: editor remounted with empty draft, focus effect consumed too early, the picked exercises were dropped.
- **`router.push` from one `presentation:'modal'` screen to another → Metro `R` reload freezes the app**: when route A and route B are BOTH registered as `presentation: 'modal'` in `_layout.tsx`'s root Stack, and A pushes to B via `router.push`, the navigation stack momentarily holds two modal UIViewControllers (one above the other). On Metro full reload (`R` in terminal), expo-router restores both routes, but the iOS modal-on-modal UIViewController teardown/rebuild dance races with React's bundle re-execution → app freezes, white screen, no JS error. **Fix**: use `router.replace` instead of `router.push` for cross-modal navigation — stack only ever holds ONE modal at a time. Cost: the user can't `router.back()` to the previous modal — they go back to whatever was under the modal stack. Acceptable for swap-style UX (e.g. 動作歷史 ↔ 動作圖表 sharing a filter mailbox); state hops via mailbox singleton so the navigation history depth doesn't matter. Slice 9.6 L2 caught this — 歷史 → 轉圖表 → terminal R froze; 圖表 → 看歷史 → terminal R same. The freeze does NOT reproduce on Cmd+R inside the simulator (only Metro's terminal `R` triggers the bundle re-eval that races).
- **Inline arrow functions in `<Stack.Screen options={{ headerLeft: () => (...) }}>` cause infinite re-render on modal screens during reload**: when the options object is inlined in JSX (constructed fresh every render) AND `headerLeft`/`headerRight` is an inline arrow (new function reference every render), expo-router sees options ref change every render → internally calls `setOptions` → react-navigation re-renders the parent Stack → screen re-renders → new options object → new setOptions call → loop. For non-modal screens (e.g. detail page) the loop self-stabilizes via React's batching, but for `presentation: 'modal'` screens the UIViewController re-mounts each cycle, particularly when state is already populated (mailbox-hydrated filter active) → app freezes on Metro R reload. **Symptom**: terminal R freezes only AFTER a `轉圖表 / 看歷史`-style cross-navigation has populated the filter mailbox; direct entry doesn't freeze. **Fix**: `useMemo` the options object with deps `[router]` (or whichever stable refs the inner closure references). `<Stack.Screen options={screenOptions} />` then sees a stable ref → no reapply loop. Slice 9.6 L2 caught this on history + chart modal pages. Don't reach for `useLayoutEffect + navigation.setOptions` as the fix — it has the same race on modal screens because `useNavigation()` ref drifts during navigator rebuild; the declarative `<Stack.Screen>` form with memoized options is the only stable pattern for modal screens.

## 9. Merge — from main repo, NOT worktree

**Re-check `mergeable` right before merging.** GitHub recomputes mergeability asynchronously: a PR that was MERGEABLE when smoke started can flip to CONFLICTING by merge time if `main` advanced during your smoke window with overlapping file edits. Run:

```bash
gh pr view N --json state,mergeable,mergeStateStatus -q '{state, mergeable, mergeStateStatus}'
# UNKNOWN = GitHub is still computing; wait ~10s and retry. CLEAN = safe to merge. CONFLICTING = merge main into the branch first, resolve, push, re-check.
```

Slice 9 hit this — overnight ran 5 units, pushed 3 commits, then on the morning final check found `main` had advanced via a doc-only commit that touched the same lessons file. Resolution = `git merge origin/main` in the worktree, hand-merge the markdown, `npm test` (must stay green), push, re-check mergeable.

Critical: `gh pr merge ... --delete-branch` fails inside a worktree because deleting the branch requires checking out main, but main is already checked out by the parent worktree.

```
ExitWorktree(action: "keep")        # exit the session's worktree
# session is now back in ~/code/TrainingLog
gh pr merge N --squash --delete-branch
```

If the merge succeeds on GitHub but local cleanup fails (e.g. worktree directory still holds the branch):

```bash
git worktree remove ~/code/TrainingLog-worktrees/slice-NN-<kebab-name>
git branch -D slice/NN-<kebab-name>              # -D is required: squash creates a different SHA, so -d says "not fully merged"
git pull --ff-only origin main
```

**`git worktree remove` errors with "Directory not empty" when the worktree still has `node_modules` / `dist` / `.expo` cache** — git removes its tracking entry but refuses to delete the on-disk directory because non-git files remain. The branch deletion still succeeds, `git worktree list` no longer shows the worktree, but the directory is left orphaned (~1 GB of `node_modules`). **Hand the user the `rm -rf` command rather than running it yourself** — `rm -rf` is in the blast-radius list and the orphan is harmless (everything in there is either merged to main or re-generatable). Slice 9.5 cleanup hit this: agent printed `rm -rf ~/code/TrainingLog-worktrees/slice-9.5-template-editor-production` for the user to execute. Use `git worktree remove --force` BEFORE the directory is touched if you want a one-shot remove; once `--force` fails it's already too late to rerun.

**Then ALWAYS verify the remote branch was deleted** — `gh pr merge --delete-branch` aborts the WHOLE delete step (local AND remote) when local fails, but its log only mentions the local error so it _looks_ like remote was handled. Slice 5 found `remotes/origin/slice/04-saveback` still alive a week after slice 4 supposedly cleaned up, because slice 4 trusted "merge succeeded" without checking remote.

```bash
git ls-remote origin 'refs/heads/slice/*'   # should be empty post-cleanup
# if anything is listed, delete it (one-shot, multiple branches OK):
git push origin --delete slice/NN-<kebab-name> [slice/MM-other-leftover ...]
git fetch --prune
```

Sanity check at the end:
```bash
git worktree list   # should show only the main repo
git branch -a       # should show only main + remotes/origin/main (NO slice/* anywhere)
git log --oneline -3   # newest commit = the squashed slice merge
```

**Re-run `npm install` in the main repo before relaunching Metro from there.** When a slice ships new deps (the typical case — most slices add at least one `npx expo install <pkg>`), the squash-merge updates `package-lock.json` but the main repo's local `node_modules` still mirrors the pre-merge lockfile. `npx expo start` then crashes with `PluginError: Failed to resolve plugin for module "<new-pkg>" relative to "/Users/.../TrainingLog". Do you have node modules installed?` even though `node_modules/` exists. Slice 9 cleanup hit this — `expo-sqlite` config plugin wasn't in main's old node_modules until `npm install` re-aligned. Bake into cleanup checklist:

```bash
cd ~/code/TrainingLog
npm install --no-audit --no-fund   # re-align node_modules with newly-pulled lockfile
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
