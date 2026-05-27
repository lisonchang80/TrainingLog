# Slice 13d D0 Spike A — On-Device Runbook

**Branch**: `slice/13d-d0-spike-a`
**Goal**: validate ADR-0019 Q28 Branch C (trigger-only HK on watchOS 11+)
**Hypothesis**: Watch `HKWorkoutSession` + `HKLiveWorkoutBuilder.discardWorkout()` → no HKWorkout entry, but HR samples persist in HK store.

---

## What "PASS" means

| Assertion | Verdict criterion |
|---|---|
| Negative: discardWorkout did NOT write HKWorkout entry | `workoutEntriesFound == 0` AND `workoutEntryWritten == false` |
| Positive: HR samples DO persist for the session window | `hrSamplesAfterDiscard > 0` |

PASS = both hold. Otherwise:
- `workoutEntriesFound > 0` → **FAIL**, Q28 Branch C invalid, must fall back to Branch A (Watch writes HKWorkout, conflict with iPhone 13c writer needs new design)
- `hrSamplesAfterDiscard == 0` (with no workout) → **PARTIAL**, almost certainly Watch-not-worn / sensor contact issue, retry after fitting Watch properly

---

## Prerequisites

- [ ] Apple Watch paired to iPhone 14 Pro, Developer Mode enabled (validated 2026-05-27 in D4 runbook)
- [ ] Watch worn on wrist with skin contact — **REQUIRED** for HR sensor to produce samples
- [ ] Watch unlocked (so HK auth dialog can be acknowledged)
- [ ] Health app on iPhone shows existing HR data (sanity-check sensor + auth path)
- [ ] On `slice/13d-d0-spike-a` branch, both new files exist:
  - `ios/TrainingLog Watch Watch App/SpikeAHarness.swift`
  - `ios/TrainingLog Watch Watch App/ContentView.swift` (updated)

---

## Steps

### 1. Build to Watch

1. Open `ios/TrainingLog.xcworkspace`
2. Scheme dropdown (top-left of Xcode toolbar): select **TrainingLog Watch Watch App**
3. Device dropdown: select your Apple Watch
4. ⌘R → build + install
5. App launches on Watch with new layout: D4 placeholder text + Divider + **Run Spike A** button

If build fails:
- Check Issue Navigator (⌘5) for the actual error
- Common: `HKHealthStore` undefined → missing `import HealthKit` in `SpikeAHarness.swift` (shouldn't happen, file has it)
- Common: entitlements missing → re-verify Watch target Signing & Capabilities has HealthKit on

### 2. Fit Watch properly

- Tighten strap, skin contact on inside of wrist
- Open Heart Rate complication briefly to confirm HR shows live numbers (proves sensor + skin contact OK)
- If Watch shows `- -` for HR, tighten further or move strap up wrist

### 3. Open Xcode Console (Cmd+Shift+Y)

Filter by `SPIKE A REPORT` so the JSON dump shows up cleanly when spike finishes.

### 4. Tap Run Spike A

- First time: iPhone shows Health auth dialog → tap **Turn On All** (or grant the requested subset)
  - Wait for dialog to appear if delayed by a few seconds (auth round-trips through paired iPhone)
- Watch face replaces button text with `Running…`
- Status line cycles through phases: `Phase 1: HK auth` → `Phase 2: configure…` → `Phase 3: start session` → `Phase 4: collecting HR samples (15s)…` → … → `Phase 9: query HR (after discard)`
- ~22-25s total wall time
- When done, status reads `done — pass` (or `partial` / `fail`)
- Result panel appears under button showing 5 key values + summary

### 5. Capture report

Two outputs:

**a. Watch UI panel** (screenshot Watch face or read off):
- verdict
- total ms
- HR during
- HR after
- workouts (0 = green, >0 = red)
- summary text

**b. Xcode Console JSON** (Cmd+A → copy → paste into `tmp/d0-spike-a-results.md`):
```
===== SPIKE A REPORT =====
{
  "startedAt": "...",
  "finishedAt": "...",
  "totalMs": 22134,
  "steps": [ ... 9 phases ... ],
  "hkAuthOk": true,
  "sessionStarted": true,
  "hrSamplesDuringSession": 4,
  "hrSamplesAfterDiscard": 4,
  "workoutEntriesFound": 0,
  "workoutEntryWritten": false,
  "verdict": "pass",
  "summary": "Q28 Branch C CONFIRMED — ..."
}
===== END SPIKE A =====
```

### 6. Cross-check with Health app

After spike completes:
1. Open Health app on iPhone
2. **Browse → Workouts** → confirm NO new "Traditional Strength Training" entry in the last few minutes
3. **Browse → Heart → Heart Rate** → confirm HR samples in the last few minutes ARE present
4. This independently corroborates the spike harness's HK queries

### 7. Verdict template (paste into `tmp/d0-spike-a-results.md`)

```markdown
# Spike A — Q28 trigger-only HK validation
## Setup
- Date: 2026-05-XX HH:MM
- Devices: iPhone 14 Pro + Apple Watch Ultra (watchOS 11.6.2)
- Worn: yes / no
- HK auth granted: yes / no

## Result
- **Verdict**: PASS / FAIL / PARTIAL
- **Total**: NN ms
- **HR during session**: N samples
- **HR after discard**: N samples
- **Workout entries**: N
- Health app cross-check:
  - Workouts tab: no new entry ✅ / new entry ❌
  - Heart Rate tab: samples present ✅ / missing ❌

## Verdict implication
- PASS → Q28 Branch C confirmed; D5 implementation can rely on `discardWorkout()` pattern.
- FAIL workout written → Branch C invalid; need Branch A (Watch writes HKWorkout, dual-write conflict with iPhone 13c writer needs separate ADR).
- PARTIAL → retry after fixing Watch wear.

## Full JSON (from Xcode Console)
\`\`\`json
{ ... }
\`\`\`
```

---

## Cleanup after spike

- Spike code stays on `slice/13d-d0-spike-a` branch (parallel to `slice/13d-d0-spike-c`)
- Branch is NOT cherry-picked into main
- After verdict: a "D0 partial spike A" doc-only commit lands on main updating ADR-0019 § Q28 + NEW-Q47

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| HK auth dialog never appears | iPhone Health app permissions broken / Watch & iPhone out of sync | Toggle airplane mode, re-pair Watch, or open Health app first |
| `verdict: partial, hrSamplesAfterDiscard: 0` | Watch not worn / sensor contact lost | Tighten strap, confirm HR complication shows live numbers, rerun |
| `verdict: fail` with workout entry written | Q28 Branch C invalid on this watchOS version | Treat as authoritative — escalate, do not work around |
| Run Spike A button does nothing | Console may show Swift exception | Open Console, look for stack trace; likely Swift compile-time issue |
| App crashes when tapping Run | `HKHealthStore` permissions edge case | Check Info.plist usage descriptions present; revoke + regrant HK in Watch Settings |

---

## Future spike B (Q22 paired-share auth)

Spike B will reuse this same Watch target + harness pattern but:
- Request HK auth **on iPhone first** (via the existing 13b/13c iPhone-side path)
- Then run a Watch-side query that assumes auth already granted (no `requestAuthorization` call on Watch)
- Verdict: can Watch read HR without its own auth request?

Not in scope for this checklist. Spike A first, spike B after PASS.
