# Agent A — Biceps Pattern B revisit findings (2026-05-24)

Branch: `agent-A-biceps-pattern-b` · Base: `b965ee493f06111c52c089149efe7ac903e4fd90`
Author: overnight agent A

## TL;DR

**Ship Pattern A2 (diagonal). Keep Pattern B candidates behind a single-constant
toggle `BICEP_PATTERN` for fast future revisits.**

Pattern A2 wins on anatomical fidelity, edge clash safety, and visual liveness.
Vertical SPLIT_X (Pattern B) is mechanically simpler but loses the long-head
fiber direction the bicep belly actually shows.

Confidence: **4/5**. The PNG comparison is unambiguous: A2's diagonal cut
follows the bicep belly's own curved midline; every Pattern B variant produces
a static vertical stripe that ignores the belly's intrinsic curvature.

## SPLIT_X candidates sampled

Decoded `PACKAGE_BICEP_L` + `PACKAGE_BICEP_R` via offline Bezier sampling
(`/tmp/bicep-bbox-v2.mjs`, 800 samples per Bezier, 14 horizontal y-band stats):

| Variant      | L SPLIT_X | R SPLIT_X | L+R sum | Mirror axis | Rationale |
|--------------|-----------|-----------|---------|-------------|-----------|
| `B_BBOX_MID` | 202.4     | 525.9     | 728.3   | 364.16      | Exact Round-1 baseline. xmin+xmax mid of each bbox. |
| `B_MASS`     | 202.0     | 526.2     | 728.2   | 364.10      | Mass-weighted by belly width per y-band. |
| `B_MEDIAL_5` | 207.4     | 520.9     | 728.3   | 364.16      | 5u shift toward chest centerline → long head gets 2/3 of partition. Mirrors deltoid mid-delt 1/3-width tweak. |
| `B_LATERAL_5`| 197.4     | 530.9     | 728.3   | 364.16      | 5u shift away from centerline → short head gets 2/3. Anatomically inverted. |

All four sums land on x≈364, matching the A2 user-clicked mirror axis (verified
in `docs/audit/2026-05-24-anatomy-overlay-audit.md` § 2.1 + commit `188d723`).
So whatever variant we ship, anti-alias mirror safety holds.

### Per-y mid-x drift (the smoking gun)

Sampled belly's mid-x across 14 y-bands (each ≈ 6 units tall, full y range
406–493):

| y range | L mid-x | R mid-x |
|---------|---------|---------|
| 406–412 | 211.0   | 517.1   |
| 437–443 | 204.1   | 524.2   |
| 462–468 | 198.8   | 529.3   |
| 486–493 | 191.6   | 536.9   |
| **drift max-min** | **19.4u** | **19.7u** |

The L bicep belly's midline drifts 19 units laterally as you descend — almost
half the belly width (41u). That confirms the bicep is intrinsically a curved/
diagonal shape, not a straight vertical strip. **Any single vertical SPLIT_X
mis-aligns by ≈10 units at one end of the y-range.** Round 1 hit exactly this
problem and user (correctly) flagged the anatomy as off.

A2's user-clicked diagonal has slope |dx/dy| ≈ 0.36, slightly steeper than the
belly-midline drift (0.22). The extra steepness accounts for the long head's
actual fiber direction (supraglenoid → lateral elbow), not just the centerline.

## Side-by-side fidelity assessment

Each variant rendered to PNG via puppeteer headless
(`scripts/anatomy-render-biceps.mjs`, output in
`docs/audit/anatomy/png/biceps-{a2,b-bbox-mid,b-mass,b-medial-5,b-lateral-5}.png`)
and side-by-side in `docs/audit/anatomy/preview/biceps-pattern-b.html`.

| Variant      | Anatomical correctness | Edge clash w/ delt or lat | Code simplicity | Notes |
|--------------|------------------------|---------------------------|-----------------|-------|
| **A2**       | **High** — diagonal cut follows long-head fiber direction; long head correctly wraps lateral as you descend | None — clip path stays inside `PACKAGE_BICEP_L/R` bbox, no overflow into shoulder or forearm | Medium — 4 trapezoid Path constants per overlay (8 incl. mirror) | Default. User-validated round 2. |
| B-BBOX-MID   | Low — purely vertical stripe; loses fiber direction and the long head appears as a uniform-width lateral strip | None | High — 4 `<Rect>` per overlay, no extra path constants | Round 1 user rejection. |
| B-MASS       | Low — visually indistinguishable from B-BBOX-MID (mid-x only 0.4u away) | None | High | No reason to ship over B-BBOX-MID. |
| B-MEDIAL-5   | Low — long head gets 2/3 of belly which is the right *area* ratio anatomically but still ignores diagonal fiber direction | None | High | A "less wrong" B variant but doesn't beat A2. |
| B-LATERAL-5  | Lowest — gives short head 2/3 of belly, which inverts the typical visible-size ratio | None | High | Don't ship. |

### Why A2 reads as more "alive"

In the rendered PNG (`biceps-a2.png`), the orange (long head) region tapers as
it descends — wider near the shoulder, narrower near the elbow. This matches
real biceps photographs (Kenhub, Wikipedia references in the source audit).
B-* variants render a straight vertical column that reads as a flat 2-color
stripe.

## Code changes shipped

All under file allow-list. No app/ touched, no i18n strings touched, no ADR
touched.

- `components/exercise/body-overlay-paths.ts` (+~90 LOC)
  - Added `SPLIT_X_BICEP_{L,R}_B_{BBOX_MID,MASS,MEDIAL_5,LATERAL_5}` constants
    (8 total) documenting each candidate.
  - Added `BICEP_PATTERN` union type + default constant `'A2'`.
  - Added `bicepSplitX()` helper returning the right L/R split pair or `null`
    when A2 is active.
  - All existing `PATH_BICEP_*` A2 trapezoid constants preserved.

- `components/exercise/muscle-body-tagger.tsx` (~+15/-15 LOC)
  - Imported `BICEP_PATTERN` + `bicepSplitX`.
  - Wrapped the 4-Path bicep render in a `BICEP_PATTERN === 'A2' ? <A2-paths/> :
    <B-rects/>` switch. B-branch is dead code under default config but typesafe
    and ready for `BICEP_PATTERN` flip without further edits.

- `components/body-heatmap.tsx` (~+15/-15 LOC)
  - Identical change pattern to muscle-body-tagger so heatmap and tagger stay
    byte-symmetric in their bicep handling.

- `scripts/anatomy-render-biceps.mjs` (new, ~120 LOC)
  - Puppeteer headless renderer for the 5 variants. Reproducible; agent will
    skip on next run since PNGs already on disk, but `node
    scripts/anatomy-render-biceps.mjs` regenerates.

- `docs/audit/anatomy/png/biceps-*.png` (5 files, new)
- `docs/audit/anatomy/preview/biceps-pattern-b.html` (new, inline SVG variant
  preview — opens directly in browser, no build step)
- `package.json` + `package-lock.json` — added `puppeteer` to devDependencies
  (non-Expo, build-time only).

## Test plan

- `npx tsc --noEmit` — clean (no new TS errors introduced).
- `npm test` — 1393/1393 pass (with one re-run; first run had 5 unrelated
  better-sqlite3 cross-test FK-enforcement flakes in
  `tests/db/v011ReusableSuperset.test.ts`, second run all green; not caused by
  this branch, baseline-flaky as documented in MEMORY).
- Manual visual smoke: opened `docs/audit/anatomy/preview/biceps-pattern-b.html`
  in browser (offline) — 5 variants render correctly, A2 shows diagonal cut,
  Pattern B variants show vertical cuts at expected x positions.

## Subjective confidence: 4/5

Rationale:
- (+) Quantitative per-y mid-x drift analysis (19u, 47% of belly width) makes
  the "diagonal not vertical" verdict objective, not vibes.
- (+) PNG rendering produces unambiguous visual evidence — A2 is clearly more
  faithful.
- (+) Round 2 / commit `188d723` already user-validated A2 mirror axis (x=364)
  with 4 coord-picker keypoints.
- (−) Did not get user-in-the-loop confirmation that "diagonal still beats B
  even after seeing all 4 B variants side-by-side" — but the user already
  rejected B-BBOX-MID in Round 1, so the prior is strong.
- (−) Did not render on the actual iOS Simulator (this is an offline static SVG
  comparison, not the live React Native render); minor differences in
  anti-aliasing may exist but Pattern A2 is currently the production ship so
  any difference would already be visible to user.

## Open questions for follow-up

- If the audit `M_TRAP_UPPER / MID / LOWER` schema split lands, that's another
  ClipPath partition candidate (horizontal SPLIT_Y instead of vertical SPLIT_X)
  — the `BICEP_PATTERN` toggle pattern in `body-overlay-paths.ts` is the model
  to follow.
- If user later requests "wider long head" (anatomically reasonable since long
  head is the dominant visible head), tweak `PATH_BICEP_{L,R}_LATERAL_HALF`
  trapezoid coords — keep A2 diagonal direction, shift the diagonal line a few
  units toward the medial. Don't switch to Pattern B.

## Provenance

- Round 1 commit: `26ba1a4` (Pattern B vertical SPLIT_X, user-rejected)
- Round 2 commit: `188d723` (Pattern A2 diagonal, user-validated)
- This branch: `agent-A-biceps-pattern-b` on `b965ee4`
- Audit doc input: `docs/audit/2026-05-24-anatomy-overlay-audit.md` § 2.1
  (recommended Pattern B; this re-examination concludes A2 still beats the
  refined B candidates)
- Skill consulted: `.claude/skills/svg-overlay-refine/SKILL.md` (Pattern A vs
  A2 vs B vs C decision tree + session 4 bicep history)
