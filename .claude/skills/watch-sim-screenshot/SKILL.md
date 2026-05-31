---
name: watch-sim-screenshot
description: Visual-verify a watchOS SwiftUI change by rendering it in the watchOS Simulator and grabbing a screenshot — WITHOUT a real device or the full iPhone-paired session flow. Triggers — "Sim 出圖", "screenshot the Watch UI", "let me see the layout", "visual sign-off before device", any time you changed a Watch view (ExerciseCard / cluster / SetLoggerView / a content row) and want to SEE it before a 5-10 min device build. Owns the temp-smoke-in-ContentView pattern + `xcodebuild -scheme "TrainingLog Watch Watch App" -derivedDataPath /tmp/wsmoke` + the `xcrun simctl` install/launch/screenshot chain.
---

# watchOS Sim screenshot (visual verify, no device)

## When to use

You changed a Watch SwiftUI view and want to SEE the result before committing a
5-10 min real-device build (`xcodebuild-watchos-realdevice-install`). The Sim
RENDERS the view fine. **It cannot drive drag/long-press gestures** — reorder,
swipe-to-reveal, and `.swipeActions` at-rest are NOT screenshot-able, so those
still need device verification. Use this for LAYOUT / colour / alignment /
border / spacing checks.

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
