# Slice 13d / D0 Spike C — Real-Device Checklist

**Purpose**: validate `react-native-watch-connectivity@2.0.0` works under
Expo SDK 54 + New Arch on real iPhone 14 Pro, before committing to it as
the D3 `connectivity.ts` foundation. See ADR-0019 Q5 + NEW-Q47.

**Branch**: `slice/13d-d0-spike-c` — do NOT merge until spike verdict
recorded. After verdict:
- **PASS** → keep `react-native-watch-connectivity` dep, retire spike file,
  open D3 `connectivity.ts` proper.
- **FAIL** → revert this branch + `npm uninstall react-native-watch-connectivity`,
  fall back to Branch A (Swift Nitro module ~150 LOC).

**Devices**: paired & available per `xcrun devicectl list devices`
(confirmed 2026-05-27):
- iPhone 14 Pro (iOS) — `4536C2DA-A43F-5C6D-939D-DCCF014C280B`
- Apple Watch Ultra — `81614537-98A6-5EE0-BE8A-9562AB51E677` (paired,
  but spike doesn't need Watch app installed — that's D8+)

---

## What the spike actually tests

| # | Step | What it proves | Expected outcome |
|---|---|---|---|
| 1 | App boots without crash | `TurboModuleRegistry.getEnforcing('WatchConnectivity')` resolves at module load | App reaches Settings tab without red box |
| 2 | `getIsPaired()` | iPhone↔Watch pairing reachable from JS | Returns `true` (Watch is paired) |
| 3 | `getIsWatchAppInstalled()` | Bridge query for companion app install state | Returns `false` (Watch app not built yet) |
| 4 | `getReachability()` | Reachability snapshot | Returns `false` (no companion app → not reachable) |
| 5 | `watchEvents.addListener('reachability', ...)` | Event subscription registers + unregisters cleanly | No throw; unsub function returned |
| 6 | `sendMessage(...)` | Bridge call doesn't crash JS; errCb fires with `WCErrorCodeNotReachable` (7008) | errCb fires within 5s with `code` field |

**Verdict mapping** (computed by `runConnectivitySpike()`):
- All 6 OK → `pass`
- Steps 1-5 OK but step 6 hits 5s timeout → `partial` (lib loads but
  bridge channel may need real companion app to validate fully)
- Any of 1-5 fails → `fail` (most likely TurboModule registration crash
  → Branch A fallback)

---

## Execution steps

### 1. Open project in Xcode

```sh
open ios/TrainingLog.xcworkspace
```

In Xcode:
- Top-bar target dropdown → select **TrainingLog** scheme
- Top-bar device dropdown → select **iPhone 14 Pro (張庭晧 的 iPhone)** —
  must show the physical device with the green dot, not a Simulator
- Verify signing: TrainingLog target → Signing & Capabilities →
  Team should show **TING-HAO CHANG (4344LN7CXS)**. If not, click
  the dropdown and pick that team.

### 2. Build + run on iPhone

In Xcode, press ⌘R (or click the ▶ Run button).

Expected duration: **first build = 2-5 minutes** (RNWatch native code is
~tiny but the full RN/Hermes/SPM cold build is slow); subsequent
rebuilds = ~30s if no native changes.

**If build fails**: capture the error message (the EXACT Xcode build
log line, not just "build failed") and stop. Common failure modes:
- Code-signing prompt → make sure you trusted the developer cert in
  Settings.app on the iPhone (Settings → General → VPN & Device
  Management → "TING-HAO CHANG" → Trust).
- `Module 'WatchConnectivity' not found` → pod install didn't link
  correctly; re-run `cd ios && LANG=en_US.UTF-8 pod install`.
- TurboModule registration crash at app launch → **this is a spike
  FAIL outcome** — record it in the verdict.

### 3. Verify app boots

Wait until the app's bottom tabs render. **If you see a red error
screen or the app doesn't reach the tab bar** → spike step 1 FAILED.
Capture screenshot and record. Stop here, file verdict as `fail`.

### 4. Open Xcode console + clear it

In Xcode (after build is running):
- View → Debug Area → Show Debug Area (⇧⌘Y)
- Click the trash icon in the console area to clear stale output

### 5. Run the spike

In the app:
1. Tap **Settings** tab (gear icon, far right)
2. Scroll to bottom — find **「🔬 開發者 — D0 spike C」** section
3. Tap **「執行 WC spike」** row

The row label changes to "執行中…". Within 1-7 seconds the result panel
appears below the button.

### 6. Read the on-screen verdict

Result panel shows:
- **判定**：`PASS` / `PARTIAL` / `FAIL` + total ms
- One-line summary
- 6 step lines (✓ or ✗ each, with duration + values/errors)

Snap a screenshot. If `FAIL`, also screenshot the Xcode console
(might show the underlying crash).

### 7. Copy full JSON from Xcode console

Look at the Xcode console — search for `[D0 spike C] full report:`
(⌘F in console). The next ~30 lines are the pretty-printed JSON.
Select + copy that block (you'll paste it into the D0 commit body).

### 8. Run the spike a second time (optional but recommended)

Cold-start state vs warm-state can differ. Hit "執行 WC spike" again
and compare verdicts. If the first run was `pass` but the second is
`partial`, that's worth noting in the commit body.

### 9. (Optional sanity check) Toggle Watch on/off

1. With Watch on wrist → run spike → record verdict
2. Power off Watch (long-press side button → Power Off) → wait 10s
   → run spike again
3. Power Watch back on, wait until reachable → run spike again

`isPaired` should always be `true` (pairing persists). `isReachable`
should flip between `true` (Watch on, in range) and `false` (Watch
off / unreachable). At spike time `isWatchAppInstalled` is `false`
regardless because we have no companion app yet.

---

## Recording results

Create a file `tmp/d0-spike-c-results.md` (gitignored) with:

```markdown
## Run 1 — 2026-05-XX HH:mm
**On-screen verdict**: PASS / PARTIAL / FAIL
**Total ms**: ...
**Summary line**: ...

### Full JSON report
```json
{ ...pasted from Xcode console... }
```

### Screenshots
- result-panel-run1.png
- xcode-console-run1.png (if FAIL)

## Run 2 (warm-state) — same template

## Run 3 (Watch off) — same template
```

---

## Commit the D0 outcome

Once you have ≥1 PASS or definitive FAIL, the workflow back to me is:

> "spike C verdict: <pass/partial/fail>" + paste the JSON / screenshot

Then I'll write the D0 commit body summarizing:
- The 3 sub-spike results (A: trigger-only HK, B: paired-share HK,
  C: react-native-watch-connectivity — this checklist)
- Any caveats from partial runs
- The decision branch taken per ADR-0019 NEW-Q47

D0 lands on `slice/13d-d0-spike` (separate branch — gets cherry-picked
or merged into main, depending on whether spike result code is kept
or thrown away).

---

## If you hit something not in this checklist

Common "weird" things and what to do:

- **Xcode prompts about provisioning profile** → let it auto-create one;
  if it can't, you may need to manually set Bundle Identifier in
  Signing & Capabilities to something unique like
  `com.tinghao.traininglog.dev`.
- **"Could not launch — Failed to install app"** → unplug + replug
  USB, restart Xcode, retry. If persistent, restart iPhone.
- **App installs but immediately quits** → TurboModule crash on launch
  is the most likely cause; check Xcode console for the crash log
  (search for "Fatal error" or "JavaScript error"). This is a spike
  FAIL.
- **Watch shows "not paired" even though physically paired** →
  rare iOS bug; toggle airplane mode on/off on both devices, wait 30s,
  retry.

---

## Reference files

- `src/adapters/watch/spike/connectivitySpike.ts` — the spike harness
- `app/(tabs)/settings.tsx` — the "🔬 開發者 — D0 spike C" section
- `__mocks__/react-native-watch-connectivity.ts` — jest mock (kept
  even after spike for D3 `connectivity.ts` proper)
- `ios/Podfile.lock` — confirms `WatchConnectivity (2.0.0)` linked
- ADR-0019 `docs/adr/0019-session-ui-ux-integral-redesign.md` § NEW-Q47
- `.claude/skills/ship-partial-pure-logic/SKILL.md` — pattern this
  spike branch follows (separate branch, no cherry-pick to main
  until D0 final)
