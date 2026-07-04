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

## ⚠️ Launch the dev-client (`com.lisonchang.TrainingLog`), NOT Expo Go

Since slice 13b (bare workflow) the app links native modules — HealthKit ships
via **NitroModules**. Plain **Expo Go (`host.exp.Exponent`) CRASHES ON BOOT**:
a red error `NitroModules are not supported in Expo Go!` at `index.tsx`'s
HealthKit import — the app never mounts, no screen is reachable (verified
2026-06-27, wasted ~6 screenshots reaching for Expo Go out of habit). Sim smoke
must run the **dev-client build** `com.lisonchang.TrainingLog` (native modules
compiled in). Check the sim home first: if there's no TrainingLog icon, no
dev-client is installed → build + install a *simulator* dev-client before any
tap work:
```
cd ios && xcodebuild -workspace TrainingLog.xcworkspace -scheme TrainingLog \
  -configuration Debug -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath build/sim-phone build
xcrun simctl install booted "build/sim-phone/Build/Products/Debug-iphonesimulator/TrainingLog.app"
```
Then `launch_app com.lisonchang.TrainingLog`. Metro still serves JS (reload
picks up `.ts` edits), but the SHELL must be the dev-client, never Expo Go.
（2026-07-04：改用 `-destination`＋`build/sim-phone`——`-sdk iphonesimulator` 會把
embedded Watch target 的 asset catalog 也用 iphone thinning 而 BUILD FAILED；
derivedData 必須在 `ios/build/` 下，否則 RN post-install 的 plist 掃描會讓下次
`pod install` 炸 UTF-8。）
(To smoke a fix that lives on another branch, Metro follows the **main
worktree's checked-out branch** — detached-checkout that tree there first; it
doesn't follow a symlinked-node_modules worktree.)

## ⭐ The #1 trap: tap coords are POINTS, the screenshot is SCALED

`ui_tap {x,y}` takes **points** (same space as `ui_find_element` / `ui_describe_all`
`AXFrame`). The PNG from `screenshot` is rendered at a **larger scale**, so **NEVER
eyeball a tap coordinate off the screenshot** — you'll tap too low/right and hit nothing.

**Don't hardcode the scale — measure it.** `sips -g pixelWidth -g pixelHeight <shot>.png`
÷ the pt screen (iPhone 17 = 402×874). Validated 2026-06-27: the **MCP `screenshot`
tool wrote 1206×2622 px → exactly 3× pt, NOT 1.5×** (an older note here said ~1.5× /
603-px-wide — that undercounts the MCP path; `xcrun simctl io` may differ, so always
measure rather than assume). Screenshot px ÷ scale = tap pt.

Recipe for every tap:
1. `ui_find_element {search:["Button label"]}` (or `ui_describe_all`) → read the
   element's `AXFrame` `{x, y, width, height}` (points).
2. Tap its CENTER: `x + width/2`, `y + height/2`.
3. Screenshot only to *verify the result*, never to *measure the next tap*.

(2026-06-20: tapped y=854 read off the screenshot → no-op; the real button was at
AXFrame y≈546, center ≈569. One wasted round-trip. Always go via AXFrame.)

**Fallback when `ui_describe_all` collapses a sheet into ONE node** (validated
2026-06-27 on `TemplateMetaSheet` 另存模板): a RN bottom-sheet / modal can surface as a
single full-screen `GenericElement` whose `AXLabel` concatenates all its children
("取消, 另存模板, 儲存, 模板名稱, …") with **no per-child `AXFrame`** — `ui_find_element`
and `ui_describe_point` can't give you a button's box. Recipe: `sips -c <h> <w>
--cropOffset <top> <left> shot.png --out strip.png` to crop a horizontal strip where the
target sits, `Read` the strip to eyeball the element's px position **within the strip**,
then `(strip_left + px_x)/scale`, `(crop_top + px_y)/scale` → tap pt. Cropping isolates
the row so the Read estimate is tight; ÷scale (=3, per above) converts to points.

## Relaunch = JS reload (no rebuild for .ts/.tsx changes)

`launch_app {bundle_id, udid, terminate_running:true}` re-attaches to Metro and
pulls a fresh JS bundle. For pure JS/TS changes that's all you need — **no Xcode
rebuild**. Metro serves whatever's on disk in the **primary worktree**, so:

- To smoke a branch: `git switch` the **primary** checkout to it first (real
  `node_modules`). A *symlinked* git-worktree breaks Metro entry resolution (red
  screen) — see `overnight-parallel-agents` gotcha #14. Switch back when done.
- **Alt — serve a worktree directly** (e.g. an integration/overnight branch you
  don't want to disturb the primary checkout for): give THAT worktree REAL
  `node_modules` — `rm node_modules` (removes the symlink only; the target/main
  install is safe) → `npm install` (~3-5 min) — then `kill` the primary's Metro
  (`lsof -ti :8081 | xargs kill`) and `npx expo start --dev-client [--clear]`
  from the worktree dir. Symptom if you skip the install: red screen `Unable to
  resolve ./<repo>/node_modules/expo-router/entry`. `tsc`/`jest` are happy with
  the symlink; only Metro's bundler isn't. Validated 2026-07-01 (integration-
  overnight-0701 coach-scroll fix smoke). Restart the primary's Metro after.
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

⚠️ **You CAN'T screenshot-verify the app's OWN bottom-anchored toast in dev-client** —
the in-app `ToastHost` (`components/ui/Toast.tsx`, `SafeAreaView edges={['bottom']}`)
renders at the very bottom, exactly where the dev "Open debugger" banner sits, so a
success toast (e.g. 投影 Watch's queued/ok toast, 儲存模板 success) is OBSCURED by the
banner AND auto-dismisses in ~2-3s — `ui_find_element` / screenshots come up empty even
when the toast fired correctly. Don't open a "toast not rendering / ToastHost mis-wired"
investigation (2026-06-27, ~5 wasted attempts): confirm the wiring is identical to a
proven `ToastHost` caller (the session-detail page) + tsc-clean + handler runs without
crash, and verify the toast VISUALLY on a release build / real device (no dev banner)
instead. This is a dev-overlay artifact, not a bug.

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

## ⛔ The template EDITOR is NOT sim-reachable (edit-flow behaviors are device-gated)

Validated twice (2026-06-25 另存→Y nav + #6 dpid/dst subtitle). You cannot open
`components/template-editor/template-editor-view.tsx` on the sim through the
normal UI:
- **模板訓練 list tap** → opens `StartTemplateSheet` (start a session), NOT the editor.
- **計畫 tab program-cell tap** (e.g. `拉日`/`T1-1`) → **no navigation** at all
  (cells are display-only outside 編輯 mode; `programs.tsx:1022` push doesn't fire).
- **模板訓練「＋」** opens the editor but as a FRESH (`needsClassify`) template, so
  `!needsClassify`-gated affordances (⋯「另存模板/另存強度」, 儲存-in-place re-classify) don't show.

⟹ Any **editor-only** behavior — 另存→Y navigation, #6 dpid/dst subtitle clear,
onSaveAsConfirm/onSaveSheetConfirm paths — is **device-gated**. Verify tsc+jest +
code-review against the file's proven patterns, then defer the behavior check to a
real device. Don't burn turns hunting a sim entry that isn't there.

### ✅ BUT the START flows ARE sim-reachable + DB-verifiable (validated 2026-06-26)

The template-START handlers in `app/(tabs)/index.tsx` — NOT the editor — ARE
fully sim-verifiable, and the strongest check is **DB-after-tap** (not pixels):

- **計劃-mode StartTemplateSheet** (`onSheetStart`): `app_mode='plan'` → 模板訓練
  list tap → sheet → tap a program/intensity chip (通用 / T1 / …) → 開始訓練 →
  then query the sim DB: *which* `template_id` did `session_exercise` link to, and
  did a new `template` row get created (e.g. a 通用/variant auto-create)? This
  proved the 通用/variant resolve-or-create + prefill end-to-end.
- **極簡-mode start** (`onStartMinimalTemplate`): `app_mode='minimal'` → 模板訓練
  list tap (no sheet) → same DB check.
- **FRESH editor 開始訓練** (`onStartSession`, reached via 模板訓練「＋」): IS
  reachable — add exercise → 開始訓練 → DB check (template classified? session
  linked? template survived = savedRef worked?). Only the CLASSIFIED-editor
  另存/reclassify affordances are device-gated (above).

Recipe: seed precise DB state first (`sqlite3` on the sim db, or `sim-db-seed-smoke`)
— e.g. ensure NO 通用 row exists, NO active session, a prior session-with-exercises
as the prefill source — then drive the taps and `sqlite3 SELECT` to assert the
template/session rows. The flattened-sheet a11y tree often can't give per-button
frames; estimate the bottom-bar button center from a screenshot and confirm via DB.

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
