# Agent B — Triceps Pattern C self-eval

Branch: `agent-B-triceps-pattern-c`
Base: `b965ee493f06111c52c089149efe7ac903e4fd90` (verified)
Date: 2026-05-24

## TL;DR — verdict

**Recommendation: ABANDON Pattern C for triceps.** Implementation works
(tsc clean, 1393/1393 tests, strokes render without over-extension), but
PNG self-eval reveals the package's `triceps` slug already provides
3-head visual separation via natural white gaps between its 3 sub-paths
per side. Overlaying additional Bezier strokes is redundant noise rather
than added information.

Confidence: **4 / 5**.

The implementation lands cleanly so the user can inspect the diff and
either keep the change (subtle reinforcement) or `git revert` the commits
(restore package-only triceps). My read of the visual evidence strongly
favours revert.

## What was built

**Pattern C — unclipped horseshoe stroke extension** on the back-view
triceps. Two thin cubic Bezier strokes per arm (4 total) trace the
LATERAL-head and MEDIAL-head boundaries on top of the package's solid
fill. Strokes only render when `M_TRICEP` is highlighted; stroke colour
is a Tailwind-800/900 darker variant of the role/quintile fill.

- `body-overlay-paths.ts` +4 `PATH_TRICEP_EXT_*_BACK_{L,R}` constants
  (4 cubic Beziers, total ~12 LOC + ~50 lines of header comments)
- `body-heatmap.tsx` import + `tricepsStrokeColor` derived from
  `QUINTILE_TEXT_COLORS[q]` + 4 `<Path stroke=...>` elements in
  `BackOverlay` between gluteal split and head outline layers
- `muscle-body-tagger.tsx` symmetric wiring with
  `COLOR_PRIMARY_DARK = '#7C2D12'` (orange-900) and
  `COLOR_SECONDARY_DARK = '#1E3A8A'` (blue-900)

Front view: skipped. Package shows only a thin lateral profile per side
(1 sub-path, w≈50); the horseshoe is fundamentally a posterior feature
and front overlay would just be noise.

## Horseshoe coordinate derivation

Decoded package paths via tolerant SVG parser (handles arc flags + tight
decimals like `.47.46`):

```
BACK_L combined bbox: x ∈ [899.87, 959.92] w=60, y ∈ [383.08, 534.11] h=151
BACK_R combined bbox: x ∈ [1206.62, 1268.43] w=62, y ∈ [381.72, 534.50] h=153
Mirror axis = (929.895 + 1237.525) / 2 = 1083.71 (NOT viewBox center 1086)
```

The package's back triceps consists of 3 sub-paths per side:
- **L p1** (916-955, 383-451): upper medial fragment — long head origin
- **L p2** (919-959, 427-534): main body — long head belly running distal
- **L p3** (899-921, 440-520): lateral distal fragment — lateral head

Pattern C stroke design:
- Lateral stroke: top (925, 395) → cp1 (910, 430) → cp2 (905, 490) → bot (920, 525)
- Medial stroke: top (940, 395) → cp1 (955, 430) → cp2 (953, 490) → bot (935, 525)
- Both converge toward a notional olecranon apex at ~(927, 530)
- 12-15 unit buffer from outer silhouette to prevent rear-delt / lat bleed

Mirror about x=1083.71 produces R-side strokes byte-symmetric.

## Visual eval — three PNG variants

Rendered via `scripts/anatomy-render-triceps.mjs` (puppeteer + headless
Chromium, inlined package paths). All 3 saved to `docs/audit/anatomy/png/`:

1. `triceps-pattern-c-primary.png` — M_TRICEP=primary, fill orange
   #F26B3A + stroke orange-900 #7C2D12. Strokes visible but subtle —
   contrast with mid-tone orange is moderate.
2. `triceps-pattern-c-secondary.png` — M_TRICEP=secondary, fill light
   blue #7CB6E0 + stroke blue-900 #1E3A8A. Strokes very clearly read
   as two dark curves bowing outward.
3. `triceps-pattern-c-inactive.png` — no highlight, strokes hidden.
   Clean fallback (no spurious strokes when M_TRICEP missing).

Plus zoom view: `triceps-pattern-c-zoom.png` — upper-arm only, viewBox
870 300 430 280, 860×560 px.

### Does the horseshoe read?

**Sort of — but the package's natural sub-path gaps undercut it.** The
zoom render reveals that the package's `triceps` slug renders as 3
SEPARATE colour patches with WHITE GAPS between them, NOT as one solid
mass. The gaps themselves already create a visual 3-region break that
loosely suggests the 3 heads.

My added strokes:
- Compete with the existing gaps (sometimes overlapping, sometimes
  crossing fill regions where there's no gap)
- Don't align with the actual anatomical landmarks the user would
  recognize (the strokes bisect arbitrary points within the package's
  natural cell pattern)
- Add visual density without proportional information gain

The audit's claim that the package "lacks long/lateral/medial head
split" is **partially wrong** — the back-view package implicitly shows
3-head separation via its multi-sub-path slug. The audit may have based
its observation on the front view (which IS a single mass) and
generalised incorrectly to back view.

### Over-extension check

Strokes stay strictly inside the package triceps bbox + buffer:
- Lateral L stroke max-lateral x=905, bbox min-x=899.87 → 5u buffer ✓
- Medial L stroke max-medial x=953, bbox max-x=959.92 → 7u buffer ✓
- Top stroke y=395, bbox min-y=383.08 → 12u buffer (avoids deltoid which
  ends ~y=397) ✓
- Bot stroke y=525, bbox max-y=534.11 → 9u buffer (avoids forearm) ✓

**No bleed into rear delt, lat, or forearm.** Geometry verified safe;
the issue is purely visual semantics, not geometric overflow.

## Recommendation

**Revert this branch's overlay-paths + heatmap + tagger changes.** Keep
the puppeteer devDep + render script + this findings doc as a record of
the experiment (they don't affect runtime).

Specific recommendation if user wants to keep some form of triceps
enrichment:
- Consider letting the package's natural 3-piece rendering speak for
  itself (current main behavior is fine)
- If a head split is genuinely needed for user-facing differentiation,
  the audit's correct path is **ADR amendment splitting `M_TRICEP` into
  `M_TRICEP_LONG / M_TRICEP_LATERAL / M_TRICEP_MEDIAL`** — same blocker
  as `M_BACK` / `M_QUAD` / `M_TRAP` (audit § 2.5)
- Pattern A (defer to package native) at fidelity 3 is the correct
  resting state until schema work justifies escalation

## Files touched (this branch)

- `components/exercise/body-overlay-paths.ts` — +89 LOC (4 constants + comments)
- `components/exercise/muscle-body-tagger.tsx` — +12 import lines, +9
  colour constants, +tricepsRole derive + 4 Path nodes (~30 LOC delta)
- `components/body-heatmap.tsx` — +4 import lines, +tricepsQuintile
  derive + 4 Path nodes (~28 LOC delta)
- `scripts/anatomy-render-triceps.mjs` — new (130 LOC)
- `scripts/anatomy-render-triceps-zoom.mjs` — new (80 LOC)
- `docs/audit/anatomy/png/triceps-pattern-c-{primary,secondary,inactive,zoom}.png` — new
- `package.json` / `package-lock.json` — `puppeteer` devDep (non-Expo,
  safe; no Expo SDK packages touched)

No app/, no strings.ts, no ADR, no migration, no MEMORY touched.
Verified clean against the file allow-list in the spawn prompt.

## Tests + lint

- `npx tsc --noEmit` — clean, 0 errors
- `npm test` — 1393/1393 pass (matches baseline; no regressions)
- No existing tests assert against triceps overlay paths, so no test
  updates needed for the abandon-recommended changes.

## Process notes

- Puppeteer install pulled in 1081 dev packages but only `puppeteer`
  itself was added to `package.json` devDeps — `npm install` did not
  modify any Expo SDK packages (verified via `git diff package.json`
  before commit).
- This worktree had no `node_modules`; loaded package body paths from
  the sibling `slice-10c-set-logger-and-menu` worktree via absolute
  path in the render script. Acceptable for one-off self-eval rendering;
  the runtime code in `body-heatmap.tsx` / `muscle-body-tagger.tsx` uses
  the package import path so production usage is unaffected.
- Reference image research was inlined (no Agent/Task tool exposed in
  this env). Used WebSearch-derived knowledge of triceps anatomy
  (Kenhub triceps brachii reference) — long head medial-upper, lateral
  head outer, medial head deep distal, all converging at olecranon.
