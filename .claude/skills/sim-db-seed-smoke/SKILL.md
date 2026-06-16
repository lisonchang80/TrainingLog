---
name: sim-db-seed-smoke
description: Inject SQLite seed data directly into the iOS Simulator's TrainingLog DB to skip multi-step UI setup before running an MCP-driven smoke test. Use when smoke would otherwise need to walk through 10+ taps to build state (e.g. 3 same-name template variants + 2 program_cell bindings, OR a completed session with PR-breaking working sets to light up the achievements/PR/history surfaces) for a single feature verification. Trigger words "sim seed inject", "smoke 走 UI 太冗", "inject seed", "DB-driven smoke", "跑 swipe 但不想手建資料", "seed 一個 session", "獎章/PR 要真資料". Also covers verifying a Switch/toggle-gated UI when simctl can't flip the RN Switch — seed the `app_settings` key instead (see §Seeding a setting). Validated 3× on slice 13d 2026-05-29 batch-delete smoke + slice 17 2026-06-16 achievements-panel smoke. Pairs with `simulator-db-query` (read-only diagnostics) and `ios-simulator-smoke` (tap/swipe workflow).
---

# Sim DB Seed Smoke — TrainingLog

When a smoke needs **multi-entity state** (a program + 3 templates + 2 program_cell bindings + …) that would take 10+ taps to build via UI, inject the seed straight into SQLite, relaunch the app, and run a targeted MCP-driven smoke. Trade ergonomics for time: 20× faster than walking the UI builder flows.

## When TO use

- A smoke needs cross-entity state (program + templates + cells + sets) that isn't trivially expressible in 3 taps
- You're verifying a destructive flow (delete / cleanup) and want the *outcome* to be the focus, not the setup
- Multiple cases share 80% of the same setup → invest once in seed SQL, re-seed between cases
- Bare workflow (slice 13b+) — `xcrun simctl` is the only path to the DB

## When NOT to use

- Pure tap-driven UI smoke (no DB state needed) — use `ios-simulator-smoke` plain
- Diagnosing why UI doesn't match DB (the bug is in read path) — use `simulator-db-query`
- A migration smoke — fresh DB is the right state, don't inject

## Step 0 — Confirm Bare workflow + sim ready

```bash
xcrun simctl list devices booted | grep -i iphone     # need booted sim
xcrun simctl get_app_container 6CA1EB12-... com.lisonchang.TrainingLog data 2>/dev/null
# → returns the app sandbox path; empty = app not installed yet, need expo-bare-build-pipeline first
```

If sandbox not found, see `expo-bare-build-pipeline` skill — needs xcodebuild + simctl install before seed.

## Step 1 — Locate the DB

Bare workflow path pattern (slice 13b+):

```bash
DB=$(find ~/Library/Developer/CoreSimulator/Devices/<UDID>/data/Containers/Data/Application \
  -name "traininglog.db" -path "*Documents/SQLite/*" 2>/dev/null | head -1)
echo "$DB"   # must be non-empty
```

`<UDID>` is the booted-sim id from Step 0. App sandbox UUID changes on uninstall+reinstall — never hardcode it.

(For Expo Go path see `simulator-db-query` skill.)

## Step 2 — Terminate app (release DB lock)

```bash
xcrun simctl terminate <UDID> com.lisonchang.TrainingLog
```

SQLite locks on running app. INSERT without terminate will deadlock or partially write. Always terminate first.

## Step 3 — Inject seed via heredoc

Use a HEREDOC so multi-row INSERT stays readable:

```bash
NOW=1747000000000
sqlite3 "$DB" <<SQL
INSERT INTO program (id, name, cycle_length, cycle_count, start_date, is_active, created_at, updated_at)
VALUES ('prog-T1', 'T1', 7, 1, '2026-05-29', 1, $NOW, $NOW);

INSERT INTO template (id, name, created_at, updated_at, program_id, sub_tag, color_hex) VALUES
  ('tpl-test-default', 'Test', $NOW, $NOW, NULL, NULL, ''),
  ('tpl-test-t1a',     'Test', $NOW, $NOW, 'prog-T1', 'T1-1', ''),
  ('tpl-test-t1b',     'Test', $NOW, $NOW, 'prog-T1', 'T1-2', '');

INSERT INTO program_cell (id, program_id, cycle_index, day_index, template_id, sub_tag) VALUES
  ('cell-1', 'prog-T1', 0, 0, 'tpl-test-t1a', 'T1-1'),
  ('cell-2', 'prog-T1', 0, 2, 'tpl-test-t1b', 'T1-2');
SQL

# Verify before relaunch
sqlite3 "$DB" "SELECT id, name, program_id, sub_tag FROM template;"
```

### ID naming convention

Use descriptive prefixes that reveal the test case at a glance: `tpl-test-default-b` (case B), `tpl-c-low` (case C lowercase), `cell-b1` (case B cell 1). Future re-seed iterations won't accidentally collide with previous round's data.

### `color_hex` quirk

`color_hex TEXT NOT NULL DEFAULT ''` — pass empty string `''`, NOT NULL. SQLite NOT NULL constraint will reject NULL.

### `program_cell` UNIQUE constraint

`UNIQUE(program_id, cycle_index, day_index)` — re-seed inserts on same slot fail. Either DELETE old cell first or use different `(cycle_index, day_index)`.

## Step 4 — Relaunch + verify seed visible in UI

```bash
xcrun simctl launch <UDID> com.lisonchang.TrainingLog && sleep 8
```

`sleep 8` lets Metro re-bundle + DB migrate-on-open + initial focus effects fire. Less and the first screenshot catches splash / hydration empty state.

Then `mcp__ios-simulator__screenshot` → confirm the seeded entity is visible (e.g. "Test" row appears in 模板訓練 section, "T1" appears in 計劃訓練 section).

## Step 5 — Run the smoke action via MCP

Tap / swipe per `ios-simulator-smoke` skill conventions. Tip:
- `mcp__ios-simulator__ui_find_element` returns frame in **points (pt)**, not screenshot pixels — tap with pt directly
- For swipe, `delta` default of 1 works; `duration: 0.3` is a good fast-flick speed

## Step 6 — Verify outcome via DB + UI

**Always check both**:

```bash
# DB-side ground truth
sqlite3 "$DB" "SELECT COUNT(*) FROM template;"
sqlite3 "$DB" "SELECT id, template_id FROM program_cell;"
```

```python
# UI-side: re-screenshot OR tap a refresh path (switch tab + back) to force useFocusEffect re-fire
mcp__ios-simulator__screenshot(output_path="/tmp/sim-final.png")
```

### Common pitfall: stale React state after DB mutation

`useFocusEffect` only re-fires when the focused screen changes. If the smoke modified data the **current** screen reads but you stay on the same screen, the section won't refresh (you'll see stale text alongside fresh sections that *did* re-mount).

**Cure**: tap a sibling tab then tap back. Forces all `useFocusEffect` callbacks to re-fire. (Don't file a "stale UI bug" without trying this first.)

Validated 2026-05-29 case A: after batch delete, 模板訓練 section refreshed immediately but 計劃訓練 + today card stayed stale showing "Test · T1-1". Switching to 歷史 tab and back to 訓練 made all three sections re-fetch and align to DB state.

## Step 7 — Re-seed between cases

For consecutive cases (A → B → C) reusing the same sim:

```bash
xcrun simctl terminate <UDID> com.lisonchang.TrainingLog
# Cleanup previous round's residue (e.g. ID prefixes from case A)
sqlite3 "$DB" "DELETE FROM template WHERE id LIKE 'tpl-a-%';"
# Inject case B seed
sqlite3 "$DB" <<SQL
...
SQL
xcrun simctl launch <UDID> com.lisonchang.TrainingLog && sleep 8
```

Don't `simctl uninstall` between cases — that wipes the DB *and* triggers a fresh schema migration on relaunch, slower than DELETE + INSERT.

## Step 8 — Final cleanup (optional)

If the smoke leaves residue you don't want to carry into next dev session, either:
- `xcrun simctl uninstall <UDID> com.lisonchang.TrainingLog && xcrun simctl install <UDID> <derived/.app>` — clean reinstall, fresh DB
- Or leave it; the residue is bounded (a few extra `program_cell` with NULL `template_id`) and unlikely to affect future smokes

## Recipe — seed a COMPLETED session (PR / achievement / history smoke)

Validated slice 17 2026-06-16 (achievements-panel tier cards). To make the
獎章 panel / PR banner / 歷史 calendar show **real** data without logging sets
through the UI, seed a `session` + `session_exercise` + `set` graph. Built-in
exercises already exist (`SELECT id,name,muscle_group_id,load_type FROM exercise`)
— reference their IDs (e.g. `00000000-0000-4000-8000-000000000001` = Bench Press
`mg-chest`).

```bash
TS=$(($(date -v-2d +%s)*1000))   # macOS; epoch MS
BENCH=00000000-0000-4000-8000-000000000001
sqlite3 "$DB" <<SQL
-- ended_at SET = a COMPLETED session (null = still in-progress).
INSERT INTO session (id,started_at,ended_at,bodyweight_snapshot_kg,title,is_watch_tracked)
  VALUES ('s1',$TS,$TS+3600000,70,'',0);
INSERT INTO session_exercise (id,session_id,exercise_id,ordering,planned_sets)
  VALUES ('se1','s1','$BENCH',0,1);          -- planned_sets is NOT NULL
INSERT INTO "set" (id,session_id,exercise_id,weight_kg,reps,is_skipped,ordering,created_at,set_kind,is_logged,session_exercise_id)
  VALUES ('set1','s1','$BENCH',60,5,0,0,$TS+60000,'working',1,'se1');
SQL
```

**Required-or-it-won't-count gotchas** (a set silently ignored by PR replay /
achievement panel if any is wrong):
- `set_kind='working'` (not 'warmup'/'dropset') — only working sets count for PR.
- `is_logged=1` — replay + history only read logged sets.
- `session_exercise_id` must point at a real `session_exercise` row.
- table name is quoted `"set"` (reserved word).
- `weight_kg` + `reps` both non-null for a weight/volume PR.

**To break PRs across sessions**: seed session A (e.g. bench 60×5), then session B
later (`started_at` larger) with a heavier set (65×5) → that's a weight-PR break.
N breaks in one (muscle-group × type) → the panel card shows count N (`N / 10`).

**Key insight**: the 獎章 panel computes cumulative PR counts via `prReplay`
over the set history at render time — it does NOT read `achievement_unlock`
rows. So seeding working sets is **enough** to light up the tier cards; you do
NOT need to run the achievement engine. `碰過` (touched mg/bucket) is likewise
derived from the working sets. Bucket classification uses the **live**
`bucket_ranges` cache, so a prior range edit changes which bucket a set lands in
(slice 17 saw 5-rep sets jump to 最大力量 after 1–5 was set, and the 力量 card
vanished — proof of the ③→② end-to-end path).

## Seeding a setting (§ verify a toggle-gated UI when simctl can't flip the Switch)

`mcp__ios-simulator__ui_tap` on an **RN `<Switch>`** often does NOT fire its
`onValueChange` on the sim (point-tap ≠ the toggle gesture; the AXValue stays
unchanged after the tap). Don't conclude the toggle is broken. Instead verify
the **gating logic** by seeding the backing `app_settings` key + relaunch:

```bash
xcrun simctl terminate <UDID> com.lisonchang.TrainingLog
sqlite3 "$DB" "INSERT OR REPLACE INTO app_settings (key,value) VALUES ('achievements_enabled','0');"
xcrun simctl launch <UDID> com.lisonchang.TrainingLog
# → observe the gated surface is hidden (e.g. 獎章 sub-tab gone, segmented control collapses).
sqlite3 "$DB" "DELETE FROM app_settings WHERE key='achievements_enabled';"   # reset when done
```

(Boolean app_settings are stored numeric `1`/`0` per `settingsRepository`.) The
real on-device build with a finger tap flips the Switch fine — flag it as the
one device-gate item, not a bug.

## Anti-patterns

- ❌ Inject without `simctl terminate` first → DB lock, INSERT hangs or silently partial-writes
- ❌ Hardcode the sandbox UUID → it changes after every uninstall+install
- ❌ Skip `sleep 8` after launch → screenshot the splash screen instead of the real UI
- ❌ Assume UI reflects DB without forcing re-focus → 30 min wild goose chase debugging stale React state
- ❌ Use `simulator-db-query` patterns for inject — that skill is read-only; this one is write
- ❌ Write seeds with raw NULL into NOT NULL columns (`color_hex` quirk) — will fail with constraint violation
- ❌ Re-seed same (program_id, cycle_index, day_index) without DELETE first — UNIQUE constraint
