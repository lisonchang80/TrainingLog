---
name: ios-simulator-smoke
description: Drive a TrainingLog iPhone UI flow on the iOS Simulator (tap / type / swipe / screenshot) to smoke a JS/TS behaviour change before merging to main — the iPhone half of `feedback_sim-smoke-first`. Use for "sim smoke", "跑一下模擬器確認", "verify on sim before push", "smoke the dropset/refresh/session flow". Covers the point-coords-vs-scaled-screenshot trap, relaunch=JS-reload (no rebuild for .ts), the dev warning-toast overlap, the set-row composite-a11y-button tap target, and common TrainingLog flows. Pairs with `sim-db-seed-smoke` (inject DB state to skip setup taps) + `simulator-db-query` (read-only DB diagnostics) + `add-accessibility-props` (a11y-tree VERIFY recipe). Validated 2026-06-20 (report 09 #1 dropset-cycle + #3 refresh active/idle branches).
---

# iOS Simulator UI smoke (TrainingLog iPhone)

Drive a real UI flow on the booted iPhone sim to confirm a JS/TS change behaves
correctly end-to-end. This is the iPhone half of `feedback_sim-smoke-first`:
self-verify everything that doesn't need a real device/Watch/HK/signing here,
before merging to main.

Bundle id: `com.lisonchang.TrainingLog`. Get the booted udid with
`xcrun simctl list devices booted`.

MCP tools (load via ToolSearch `select:...` if deferred):
`mcp__ios-simulator__{launch_app, screenshot, ui_describe_all, ui_find_element, ui_tap, ui_type}`.

## ⭐ The #1 trap: tap coords are POINTS, the screenshot is SCALED

`ui_tap {x,y}` takes **points** (same space as `ui_find_element` / `ui_describe_all`
`AXFrame`). The PNG from `screenshot` is rendered at a **larger scale** (~1.5× on the
iPhone 17 sim: a 402-pt-wide screen → ~603-px-wide PNG). So **NEVER eyeball a tap
coordinate off the screenshot** — you'll tap ~1.5× too low/right and hit nothing.

Recipe for every tap:
1. `ui_find_element {search:["Button label"]}` (or `ui_describe_all`) → read the
   element's `AXFrame` `{x, y, width, height}` (points).
2. Tap its CENTER: `x + width/2`, `y + height/2`.
3. Screenshot only to *verify the result*, never to *measure the next tap*.

(2026-06-20: tapped y=854 read off the screenshot → no-op; the real button was at
AXFrame y≈546, center ≈569. One wasted round-trip. Always go via AXFrame.)

## Relaunch = JS reload (no rebuild for .ts/.tsx changes)

`launch_app {bundle_id, udid, terminate_running:true}` re-attaches to Metro and
pulls a fresh JS bundle. For pure JS/TS changes that's all you need — **no Xcode
rebuild**. Metro serves whatever's on disk in the **primary worktree**, so:

- To smoke a branch: `git switch` the **primary** checkout to it first (real
  `node_modules`). A *symlinked* git-worktree breaks Metro entry resolution (red
  screen) — see `overnight-parallel-agents` gotcha #14. Switch back when done.
- Confirm Metro is alive: `ps aux | grep "expo start"`. If dead:
  `npx expo start --dev-client` from the repo root.
- **`CI=1` disables Metro's file watcher** — a Metro started with `CI=1 npx expo
  start` (the non-interactive form used to avoid the embedded-terminal hang, per
  `feedback_claude_code_embedded_terminal`) will **serve a STALE bundle** after you
  edit a `.ts/.tsx` on disk: a `launch_app` relaunch re-pulls the *cached* bundle,
  not your edit (symptom: a tiny "Bundled … (1 module)" rebuild and the old UI). To
  pick up an edit you MUST restart Metro (fresh process re-reads files): kill it
  (`lsof -ti :8081 | xargs kill`) and re-run `CI=1 npx expo start --dev-client`
  (add `--clear` if still stale). Cost this skill's author 4+ wasted relaunch
  round-trips on 2026-06-24 before catching it. (Without `CI=1` the watcher + Fast
  Refresh pick edits up live — but the interactive CLI can hang the Bash tool.)

## Dev warning toast overlaps bottom buttons

A dark "Open debugger to view warnings." toast sits at the bottom in dev builds and
**overlaps the bottom action bar** (`Done`, `+ Exercise`, sheet confirm buttons). If
a bottom tap is a no-op, either tap the toast's ✕ to dismiss first, or get the target
button's AXFrame and tap its exact center (the toast is a sibling, not a true modal —
the button underneath is still hit-testable at its own frame).

## Set-row tap target (composite a11y button)

The session set row flattens into ONE a11y button:
`"Cycle set kind (1), Edit weight, 67 kg, kg, ×, Edit reps, 5, Mark as Done"`.
But the underlying RN `Pressable`s keep their own hit areas. To cycle set kind
(working→warmup→dropset), tap the **leftmost** label box: `x ≈ rowFrame.x + 20`,
`y = row center`. Re-`ui_find_element {search:["Cycle set kind"]}` after each tap —
the AXLabel updates (`(1)`→`(熱)`→ row gains a follower) and confirms the cycle.

## Common TrainingLog flows (idle Training tab → in-session)

- **Start empty session**: `Start Freestyle` (idle) → in-session shell.
- **Add exercise**: `+ Exercise` → picker → tap an exercise card (selects, green ✓
  badge) → `Done (N)` bar.
- **Log/modify set**: tap weight/reps box → `NumericKeypad` → type → done; tap the
  `○` (right) to mark done.
- **Dropset**: tap set-kind label twice (working→熱→D1) — warmup→dropset spawns one
  follower row directly below (atomic `insertDropsetFollower`).
- **End/discard**: `⋯` session menu (top, next to `Done`) → `Discard Session` →
  confirm `Discard`. Lands back on the idle 3-section Training tab (Planned /
  Templates / Freestyle) — good for smoking the `refresh()` idle branch.

## Verify a result

Screenshot to `/tmp/<name>.png`, then `Read` it. Cross-check with the a11y tree
(`ui_describe_all`) when you need exact label/state rather than pixels. For DB-state
assertions use `simulator-db-query`; to skip 10+ setup taps inject state with
`sim-db-seed-smoke`.

## When NOT to use

- Watch / HealthKit / signing / archive / iCloud first-sign behaviour → real device
  only (`xcodebuild-watchos-realdevice-install`, device runbooks).
- Pure-logic changes already covered by jest + tsc → a sim smoke adds little; reserve
  this for runtime/wiring changes (highest-blast-radius functions, navigation, gesture).
