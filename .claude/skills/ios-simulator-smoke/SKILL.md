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
- **Even WITHOUT `CI=1`, a COLD relaunch can still load a STALE bundle.** Fast
  Refresh patches a *running* app live, but `terminate` + `launch_app` makes the
  Expo **dev-client reload its own on-disk bundle cache** — it does not always
  re-fetch from Metro, so your just-edited `.ts/.tsx` may not appear (verified
  2026-06-24: a `'use no memo'` edit needed a Metro restart, not just relaunch,
  to take effect). Reliable reset that ALWAYS picks up edits on the next launch:
  restart Metro (`lsof -ti :8081 | xargs kill -9` → `npx expo start --dev-client`),
  then `launch_app`. The FIRST cold launch against a fresh Metro process re-pulls
  a clean build; subsequent relaunches may reuse the client cache again.

## Reading on-sim `console.log` (RN logs you can't see)

The user's Metro runs in a terminal you can't read, so app `console.log` is
invisible — and the dev "Open debugger" toast means you can't attach a debugger
either. To capture RN logs for a diagnosis (e.g. confirming a hook fires / what a
value actually is at render time): kill their Metro and start your OWN piped to a
file — `lsof -ti :8081 | xargs kill -9; nohup npx expo start --dev-client > /tmp/metro.log 2>&1 &`
— then cold-launch the app and `grep` your tag out of `/tmp/metro.log` (record the
line count before an action, `tail -n +N` after, to read only new lines). This +
temporary `console.log('[DIAG] …')` probes is how the React-Compiler-memoizes-i18n
root cause got nailed on 2026-06-24 (see `[[project-traininglog-react-compiler-i18n-gotcha]]`):
a probe printing `t()` fresh while the JSX rendered the stale cached value proved
the compiler was reusing memoized output. Remove the probes + restart Metro clean
when done.

## Dev warning toast overlaps bottom buttons — INCLUDING the tab bar

A dark "Open debugger to view warnings." toast sits at the bottom in dev builds and
**overlaps the bottom action bar** (`Done`, `+ Exercise`, sheet confirm buttons) **AND
the bottom TAB BAR** (its AXFrame ≈ `y 787–835` sits right on top of the tab buttons at
`y 791–840`). If a bottom tap is a no-op, either tap the toast's ✕ to dismiss first, or
get the target button's AXFrame and tap its exact center (the toast is a sibling, not a
true modal — the button underneath is still hit-testable at its own frame).

⚠️ **For SHEET-CONFIRM buttons (e.g. the exercise-picker `完成 (N)` bar), the
exact-center fallback is UNRELIABLE — just dismiss the toast first.** Re-validated
2026-06-25 (~6 wasted taps): the toast's touch-capture zone extends BELOW its visible
pill, so tapping `完成`'s exact center AND the exposed strip below the pill both
no-op'd; only tapping the ✕ (right end of the toast bar, ≈ `x 371, y 796`) cleared it
and made `完成` tappable. So: bottom action-bar / tab-bar buttons MAY be hit-testable at
their frame, but full-width bottom-confirm bars usually are NOT — reach for the ✕ dismiss
by default for those.

⚠️ **Tab-switch taps silently fail when this toast is up** — the #1 time-waster
(2026-06-24: ~10 wasted round-trips). Symptom: you `ui_tap` a tab's exact AXFrame
center and the screen DOESN'T switch (you stay on / bounce back to the current tab),
with no error — because the toast captured the touch. `ui_describe_point` on the tap
coord still returns the tab Button (it's underneath), so the coord looks correct —
misleading. **Fix: dismiss the toast FIRST** (tap its ✕ at the right edge, ≈ `x 375,
y 811` in points — re-`ui_find_element {search:["Open debugger"]}` to confirm it's
gone), THEN tap the tab. The toast reappears after some reloads, so re-check before each
tab hop in a long flow.

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

## Two MCP-call gotchas (validated 2026-06-24)

- **`ui_type` only accepts ASCII** (`^[\x20-\x7E]+$`) — passing Chinese/CJK errors with
  `Input validation error … Invalid`. You rarely need real text in a smoke; to make a
  field/editor dirty (e.g. flip a template-editor `儲存` from disabled→enabled) just
  `ui_type {text: " X"}` (a space + ASCII char). Don't burn turns trying to type the
  localized string.
- **`screenshot` output_path parent dir must already exist** — the MCP does NOT
  `mkdir -p`; a path like `/tmp/slice16-smoke/01.png` errors `The folder … doesn't
  exist` until you `mkdir -p /tmp/slice16-smoke` once up front.

## When NOT to use

- Watch / HealthKit / signing / archive / iCloud first-sign behaviour → real device
  only (`xcodebuild-watchos-realdevice-install`, device runbooks).
- Pure-logic changes already covered by jest + tsc → a sim smoke adds little; reserve
  this for runtime/wiring changes (highest-blast-radius functions, navigation, gesture).
