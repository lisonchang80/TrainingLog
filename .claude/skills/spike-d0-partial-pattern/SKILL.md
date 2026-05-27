---
name: spike-d0-partial-pattern
description: Real-device spike → D0 partial doc-only commit workflow. Use when validating a risky cross-cutting assumption that requires real hardware (Watch, HK, WC bridge, sensor behavior, OS version behavior) before committing a downstream D-commit. Trigger words "spike A", "spike B", "spike C", "D0 spike", "real-device validation", "Q28 trigger-only", "Q22 paired-share", "Q5 react-native-watch-connectivity". Validated on TrainingLog slice 13d twice (spike C 2026-05-27 14:30 Branch B confirmed in 44ms / spike A 2026-05-27 20:00 Branch C confirmed in 56s). Pattern files involved — src/adapters/<area>/spike/<name>Spike.ts (RN/JS layer) OR ios/<Watch App>/<Spike>Harness.swift (Watch native), settings dev section or ContentView for run button, docs/slice-XX-d0-spike-X-checklist.md runbook, docs/adr/00XX-<slice>.md (5 row types updated), tmp/d0-spike-X-results.md local-only evidence.
---

# Spike → D0 partial doc commit

When a slice has a risky cross-cutting assumption that **only real hardware can validate** (Watch, HK, WC bridge, OS version behavior), the cost of being wrong is high (full architecture redesign). The D0 spike slot in a D-chain is reserved for this validation. This skill captures the workflow we've used twice on TrainingLog slice 13d.

## When to use

ALL of these:

- You have a risky assumption baked into ADR (e.g. "discardWorkout doesn't write HKWorkout entry on watchOS 11+")
- The assumption can ONLY be validated on real hardware (not in tests, not in simulator)
- Being wrong means rewriting downstream D-commits
- You can build a small harness (~150-250 LOC) that exercises the assumption end-to-end
- You can capture structured evidence (JSON report) that future readers can audit

If the assumption can be validated in a unit test or simulator, use that instead — this pattern's overhead isn't justified.

## The 11-step workflow

### 1. Branch off latest main

```bash
git checkout main && git pull --ff-only
git checkout -b slice/<S>-d0-spike-<X>
```

`<X>` is a short identifier (`a`, `b`, `c`, ...) matching the spike letter in the ADR's NEW-Q47 row (or equivalent spike enumeration).

### 2. Write the harness

**Build-into-the-app, NOT a standalone script.** The harness rides the existing deploy pipeline — for RN/JS layer it's just another TS module, for Watch native it's a Swift file in the Watch target.

**Layer convention**:

| Layer | Harness location | UI hook | Returns |
|---|---|---|---|
| RN / JS (e.g. WC bridge from JS side) | `src/adapters/<area>/spike/<name>Spike.ts` | Settings dev section row | Promise<SpikeReport JSON> |
| Watch native (e.g. HK, HKWorkoutSession) | `ios/<Watch App>/<Spike>Harness.swift` | ContentView dev block + Run button | Codable SpikeReport via `@Published` |

**Report shape** (mirror across spikes for consistency):

```typescript
{
  startedAt: string (ISO8601 with ms),
  finishedAt: string,
  totalMs: number,
  steps: Array<{ name, durationMs, ok, note? }>,
  // domain-specific counters / state proofs
  verdict: 'pass' | 'partial' | 'fail',
  summary: string  // human-readable result for ADR row
}
```

Print bracketed by clear delimiters for Xcode/Metro console capture:

```
===== SPIKE X REPORT =====
{ ... pretty JSON ... }
===== END SPIKE X =====
```

### 3. Add Run button + result panel in dev UI

- RN/JS: tap row → `await runSpike()` → render result inline
- Watch Swift: `@StateObject` harness, button calls `Task { await spike.runSpike() }`, result panel with color-coded verdict

Result panel surfaces the **3-5 key counters** + summary text. Reader on Watch face shouldn't need to scroll to debug.

### 4. Write on-device runbook checklist

`docs/slice-<S>-d0-spike-<X>-checklist.md` — covers:

- Pre-flight (hardware state, fitting, network config, sensor sanity-check)
- 7-9 numbered steps to run
- Cross-check section pointing to independent verification path (Health app, Settings, external observer)
- Verdict template (paste in `tmp/d0-spike-<X>-results.md`)
- Troubleshooting table for known failure modes

### 5. Commit harness on spike branch

```
spike(slice-<S>-d0): D0 spike <X> — <one-line description>
```

Commit body documents harness phases, verdict criteria, branch policy ("code stays on this branch, NOT cherry-picked to main"). Push branch but DO NOT open PR.

### 6. Real-device run

User-driven phase. You can't drive this — schedule with user when they have device + ~30-60 min. After:

- User taps Run button on device
- Harness completes
- User reports Watch UI panel screenshot OR Settings result + Xcode/Metro console JSON

### 7. Cross-check independently

Spike's internal queries can be wrong (predicate bug, time window off). Force user to verify result via **a different code path**:

| Spike topic | Independent cross-check |
|---|---|
| HK sample / workout writes | iPhone Health app browse tabs |
| WC bridge state | Settings → Watch panel / system Bluetooth |
| Sensor data persistence | Health app or external Bluetooth sniffer |

If cross-check disagrees with harness, **harness is wrong**, not the assumption.

### 8. Create D0 partial branch on main

```bash
git checkout main
git checkout -b slice/<S>-d0-partial-spike-<X>
```

### 9. Update ADR — 5 row types

The ADR doc update is the substantive landing artifact. Update **all 5** of these (in order):

| Row type | What to change |
|---|---|
| **Q row** for the assumption (e.g. Q28 for trigger-only HK) | Add inline "confirmed by D0 spike <X> YYYY-MM-DD HH:mm 真機 PASS" + key evidence (device, OS, total ms, 1-2 key counters) + pointer to shipped table row |
| **NEW-Q47 (or equivalent spike enum)** | Flip spike <X> status from pending → "已 land 為 D0 partial" with verdict + caveat for what spike DOESN'T cover |
| **Shipped table** | Add new row at appropriate position: `slice-<S>/D0-partial-spike-<X>` + commit hash placeholder `(本 commit)` + date + verdict summary + full phase breakdown + harness branch retention note |
| **剩下未 land paragraph** | Decrement (remove the now-landed spike from the list, leave remaining ones) |
| **翻盤 ledger top row** | Date HH:mm + ledger entry: 原拍板 → 新拍板 → 觸發 (story of how spike ran + any infra issues) → 關聯 commit (本 commit + harness branch ref). Also record any **unexpected findings** that affect future spikes/decisions (e.g. spike A found HK auth dialog appears on Watch not iPhone, which invalidates an implicit assumption about spike B coverage) |

### 10. Cherry-pick to main + delete partial branch

```bash
git add docs/adr/<file>.md
git commit -m "docs(slice-<S>): D0 partial spike <X> — <Q row topic> confirmed"
# (commit body = verdict + result counters + ADR update enumeration + unexpected findings)

git checkout main
git cherry-pick <doc commit sha>
git push

# Cleanup — partial branch is now redundant
git branch -D slice/<S>-d0-partial-spike-<X>
# (remote --delete only if you pushed it; usually didn't)
```

### 11. Spike harness branch stays alive

The harness branch (`slice/<S>-d0-spike-<X>`) is NOT deleted. It serves as:

- Reference for downstream D-commits (e.g. D5 SessionController.swift can absorb HK setup pattern from SpikeAHarness.swift)
- Audit trail (anyone questioning the verdict can run the harness fresh)
- Mock pattern reservoir (for spike C, `__mocks__/react-native-watch-connectivity.ts` shipped on the spike branch — re-usable for D3 connectivity.ts)

Delete only when the spike's domain is fully shipped and the harness adds no value beyond git history.

## Validated runs (TrainingLog slice 13d)

| Spike | Date | Topic | Branch policy held? | Cross-check passed? | Verdict |
|---|---|---|---|---|---|
| Spike C (Q5 react-native-watch-connectivity) | 2026-05-27 14:18 | WC bridge load on Expo SDK 54 + New Arch | ✅ harness on `slice/13d-d0-spike-c` @ `e81c0f5` | ✅ WCErrorCode 7006 from native bridge | PASS 44ms |
| Spike A (Q28 trigger-only HK) | 2026-05-27 19:51 | discardWorkout no-entry on watchOS 11+ | ✅ harness on `slice/13d-d0-spike-a` @ `be3c179` | ✅ Health app 體能訓練 tab no new entry + 心率 tab has samples | PASS 56s (incl 37s auth dialog) |
| Spike B (Q22 paired-share HK) | TBD | Watch query HR without own request after iPhone-side grant | TBD | TBD | TBD |

## Anti-patterns

- ❌ **Cherry-pick spike harness code into main.** Throwaway by design — main shouldn't carry it.
- ❌ **Skip cross-check.** Harness internal query can be wrong; cross-check is the ground truth.
- ❌ **Run spike + write D0 partial commit before verdict is clear.** If verdict is partial/fail, the ADR update + commit body need to reflect the actual finding, not the hoped-for one.
- ❌ **Run multiple spikes in one harness.** They have different real-device setup requirements (sensor contact, network state, auth grant order). Mixing makes failure diagnosis impossible.
- ❌ **Skip the 翻盤 ledger row.** The ledger is the "what changed and why" record. Quiet ADR updates lose context within weeks.
- ❌ **Write `(本 commit)` placeholder then forget to update.** Verify final commit hash is in shipped table after cherry-pick. Or just leave `(本 commit)` since git log resolves it — but be consistent within the slice.

## Cost notes (so future runs estimate well)

| Phase | Spike C | Spike A | Why differ |
|---|---|---|---|
| Branch + harness write | ~30 min | ~45 min | Watch Swift slower than RN/TS, more boilerplate |
| Checklist write | ~15 min | ~15 min | Same template |
| Build + push to device | ~10 min first time / ~3 min retry | ~5 min (D4 target was new but symbols cached) | First-time symbols copy was D4's cost |
| Real-device run | ~10 min wallclock (1 retry) | ~5 min wallclock | Spike A had cleaner setup |
| Cross-check | ~5 min | ~5 min | Same Health app navigation |
| D0 partial branch + ADR 5-row update | ~30 min | ~25 min | Pattern was practiced |
| Cherry-pick + cleanup | ~5 min | ~5 min | Same |
| **Total** | **~95 min** | **~100 min** | Spike A had Combine import build fail + Watch dev tunnel hotspot issue |

Future similar spikes should budget ~90-120 min unless there's a new dev-env gotcha.
