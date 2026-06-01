---
name: watch-sim-screenshot
description: Visual-verify a watchOS SwiftUI change by rendering it in the watchOS Simulator and grabbing a screenshot — WITHOUT a real device or the full iPhone-paired session flow. Triggers — "Sim 出圖", "screenshot the Watch UI", "let me see the layout", "visual sign-off before device", any time you changed a Watch view (ExerciseCard / cluster / SetLoggerView / a content row) and want to SEE it before a 5-10 min device build. Owns the temp-smoke-in-ContentView pattern + `xcodebuild -scheme "TrainingLog Watch Watch App" -derivedDataPath /tmp/wsmoke` + the `xcrun simctl` install/launch/screenshot chain.
---

# watchOS Sim screenshot (visual verify, no device)

## When to use

You changed a Watch SwiftUI view and want to SEE the result before committing a
5-10 min real-device build (`xcodebuild-watchos-realdevice-install`). The Sim
RENDERS the view fine. Use this for LAYOUT / colour / alignment / border /
spacing checks AND for scripted interaction.

**Gestures via the ios-simulator MCP (2026-06-01 — supersedes the old "cannot
drive gestures" note):** `mcp__ios-simulator__ui_tap {x,y}` drives taps;
`ui_tap` to activate then `ui_swipe {x_start,y_start,x_end,y_end,duration}`
drives left/right swipe-to-reveal — both work on the watch Sim. Coords are in
POINTS (app AXFrame ≈ 211×257 pt on Ultra 49mm; the PNG is 2× = 421 px wide, so
point = px ÷ 2). `ui_describe_all` returns only the app frame (watchOS SwiftUI
exposes no deep a11y tree) → tap by computed point. The ONLY gesture you can't
script is a **long-press-then-drag reorder** (`ui_swipe` is continuous motion,
not hold-then-drag) → manual / device verify. `terminate` + `launch` between
probes resets in-memory state.

## The 4 steps

### 1. Temp smoke view in `ContentView.body` (revert before commit!)

The Sim `ContentView` uses `PickerViewModel.mockDefault()`, but navigating
picker → set logger needs UI taps the Sim can't drive. Instead, temporarily
root straight into a render-only smoke view. Put the smoke STRUCT in the same
file as the view under test (e.g. `ExerciseCard.swift`) so it can reach
`private` content views + `SetLoggerMockData`.

```swift
// ContentView.body — TEMP (revert to plain `PickerRootView(viewModel: pickerVM)`):
var body: some View {
    MySmokeView()  // TEMP-SMOKE (revert before commit)
    if false { PickerRootView(viewModel: pickerVM)
        .environmentObject(watchConn)
        .environmentObject(session)
    }  // TEMP-SMOKE: end `if false`
}
```

The smoke view renders the target with mock data; set Active state in
`.onAppear` (e.g. `state.activate(setId: head.setId)` to show the green/notch).
To make a specific group land at the TOP (visible without scroll), filter /
reorder the mock groups (Sim can't scroll on command either).

**Two reverts before commit**: the `ContentView.body` swap AND the smoke struct.

### 2. Build the Watch app to `/tmp/wsmoke`

```bash
cd /Users/hao800922/code/TrainingLog/ios   # MUST cd — cwd resets to ~ between Bash calls
rm -rf /tmp/wsmoke                          # fresh build (incremental rebuilds flake)
xcodebuild -scheme "TrainingLog Watch Watch App" -configuration Debug \
  -sdk watchsimulator -arch arm64 -derivedDataPath /tmp/wsmoke build > /tmp/wsmoke-build.log 2>&1
APP="/tmp/wsmoke/Build/Products/Debug-watchsimulator/TrainingLog Watch Watch App.app"
```

**Trap — the build "FAILS" but still produces a usable watch .app.** A
`-derivedDataPath` build of the Watch scheme drags in the HOST's
`SplashScreen.storyboard` (`iOS storyboards do not support target device type
"watch"`) + the Expo modulemaps (`module map file 'Expo.modulemap' not found`).
Those steps run AFTER the watch app is assembled, so the watch binary is
already written. **Gate on the BINARY existing, not the exit code**:

```bash
if [ -f "$APP/TrainingLog Watch Watch App" ]; then echo OK; else
  echo "NO BINARY"; grep error: /tmp/wsmoke-build.log | grep -v "WatchKit\|module map\|storyboard"
fi
```

If `NO BINARY`: a real Swift error in YOUR code (the grep shows it), OR the
deps-race flaked → `rm -rf /tmp/wsmoke` and retry once. (`-derivedDataPath`
REQUIRES `-scheme` — a `-target` build won't produce a clean installable .app;
its product lands under `Index.noindex/` stale + with no Info.plist.)

Also: `.listRowSeparator(.hidden)` is **unavailable on watchOS** (compile error)
— watchOS List has no separators to hide; just drop the modifier.

**Trap — in a git WORKTREE (no `ios/Pods`) the `-scheme` build FAILS HARD, no
binary** (2026-06-01). The "TrainingLog Watch Watch App" scheme pulls in the
HOST iOS target, whose `Pods-TrainingLog.debug.xcconfig` is missing in a fresh
worktree (`pod install` not run) → `error: Unable to open base configuration
reference file …` and NO watch binary. Two fixes that need NO `pod install`:
- **Quick compile-check only:** `xcodebuild build -target "TrainingLog Watch
  Watch App" -sdk watchsimulator CODE_SIGNING_ALLOWED=NO` — the watch target has
  no dependencies, so it builds alone (no host, no Pods). But `-target` can't
  take `-derivedDataPath` and won't produce a clean installable .app.
- **Installable build + Xcode-Canvas previews:** add a Watch-only SHARED scheme
  `ios/TrainingLog.xcodeproj/xcshareddata/xcschemes/WatchPreview.xcscheme` whose
  BuildAction lists ONLY the watch target's `BuildableReference` with
  `buildImplicitDependencies = "NO"`. Get the blueprint id from the watch
  `PBXNativeTarget` block in project.pbxproj (BuildableName = `TrainingLog Watch
  Watch App.app`). Then build `-scheme "WatchPreview" -derivedDataPath …` →
  clean watch .app, no Pods. Xcode Live Preview also fails in a worktree for the
  same reason (Canvas builds via the scheme → host → Pods); selecting the
  WatchPreview scheme makes the Canvas build watch-only too.

### Mounting the REAL page (HR frozen pane + active-set auto-scroll)

A bare `ScrollView { MyCard }` smoke MISSES the page chrome: the top HR frozen
pane and the `ScrollViewReader` that auto-scrolls the active set under it both
live in `SessionCardListPage` (private in SetLoggerView.swift), and the keypad
overlay (`CellEditOverlay`) is mounted at the page level — NOT inside the card.
To verify those WITH your card: temporarily make `SessionCardListPage` internal
(was private) and root the smoke at `ZStack { SessionCardListPage(snapshot:
mockSnap, state: smokeState); CellEditOverlay(state: smokeState) }` with a
multi-card mock so a lower card can scroll up. Revert the `private` too. Without
`CellEditOverlay` in the smoke, tapping a cell sets `activeCell` but no keypad
draws → looks like a "keypad doesn't open" bug that is really just the missing
overlay.

### 3. Install + launch on the booted watch Sim

```bash
SIM=$(xcrun simctl list devices booted | grep -i watch | grep -oE '[0-9A-F-]{36}')
xcrun simctl terminate "$SIM" com.lisonchang.TrainingLog.watchkitapp 2>/dev/null
xcrun simctl install "$SIM" "$APP"
xcrun simctl launch  "$SIM" com.lisonchang.TrainingLog.watchkitapp
```

Bundle id is `com.lisonchang.TrainingLog.watchkitapp`.

### 4. Screenshot — DOUBLE it (skip the launch screen)

```bash
xcrun simctl launch "$SIM" com.lisonchang.TrainingLog.watchkitapp >/dev/null 2>&1
xcrun simctl io "$SIM" screenshot /tmp/shot.png >/dev/null 2>&1   # 1st often = bullseye launch screen
xcrun simctl io "$SIM" screenshot /tmp/shot.png                   # 2nd = rendered app
```

`sleep` is blocked in the foreground here, so you can't pause between launch +
shot — instead screenshot TWICE (or re-screenshot in the next Bash call). A
black frame / a grey bullseye = caught mid-launch; re-shoot. Then `Read`
`/tmp/shot.png` to view it.

## watchOS layout gotchas surfaced via this loop

- **`CellBox` auto-EXPANDS** (`Text.frame(maxWidth:.infinity)` + `minWidth`), so
  the same cell renders DIFFERENT widths when the row's available width differs
  (e.g. a cluster head squeezed by a trailing notch-padding vs a follower that
  isn't). To force column alignment, pin each cluster cell with an explicit
  `.frame(width: CellMetrics.weightWidth/.repsWidth)`.
- Give the head + follower rows an IDENTICAL HStack skeleton (same leading
  label width + same inline trailing reserve) — mixing an OUTER
  `.padding(.trailing, notchW)` on one and an INNER spacer on the other yields
  different layout baselines.
