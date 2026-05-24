# Agent C — Abs Pattern C (6-pack stroke overlay) findings

**Branch**: `agent-C-abs-pattern-c`
**Base**: `b965ee493f06111c52c089149efe7ac903e4fd90`
**Date**: 2026-05-24 (overnight)

## Goal

Layer thin darker strokes on top of the package's `abs` slug fill to read as
a 6-pack (rectus abdominis + linea alba + 3 tendinous intersections) when
M_ABS is highlighted, without introducing new M_* split slugs.

## Coordinate sampling

Decoded the package's `abs` slug sub-paths via the bezier-sampling helper
(`node -e ... sampling 20 pts per curve, binning by Y`).

### Sub-region bounding boxes (package viewBox `0 0 724 1448`)

| Sub-path | x range | y range | Anatomical role |
|---|---|---|---|
| LEFT 2  | [261.2, 359.9] | [428.5, 498.5] | L top pair (above belly button) |
| RIGHT 0 | [368.4, 422.4] | [428.8, 498.8] | R top pair |
| LEFT 0  | [263.9, 313.1] | ~531.7         | L second-pair bridge (thin) |
| RIGHT 1 | [367.8, 418.1] | [482.9, 533.3] | R second pair |
| LEFT 1  | [309.2, 361.0] | [536.4, 578.7] | L third pair |
| RIGHT 2 | [366.9, 416.9] | [506.7, 578.7] | R third pair |
| LEFT 3  | [310.9, 350.4] | [586.2, 712.8] | L lower long section |
| RIGHT 3 | [367.2, 417.4] | [583.4, 715.9] | R lower long section |

Combined abs bbox: **x[261, 422], y[428, 715]**. The package's own
sub-paths already form a natural 4-tier vertical stack — the gaps between
tiers (~y 498→531, ~534, ~580) are where tendinous intersections live.

### Linea alba x — sampled by midline (max L_x, min R_x)

| y level | L_max | R_min | Midline |
|---|---|---|---|
| 460  | 359.9 | 368.4 | 364.1 |
| 536  | 360.7 | 367.8 | 364.3 |
| 580  | 359.3 | 368.9 | 364.1 |

→ **Linea alba x = 364** (matches chest centerline used elsewhere; not
viewBox center x=362). Used `(L_max + R_min) / 2` rather than naïve
viewBox center to track the package's actual symmetry.

### Final divider coordinates

| Path | d= | Length | Why this y |
|---|---|---|---|
| LINEA ALBA       | `M364 432 L364 708` | 276u | inset 4u from abs top/bot |
| TENDINOUS TOP    | `M320 500 L408 500` | 88u  | gap between LEFT 2/RIGHT 0 and LEFT 0/RIGHT 1 |
| TENDINOUS MIDDLE | `M316 534 L412 534` | 96u  | gap between LEFT 0/RIGHT 1 and LEFT 1/RIGHT 2 (widest) |
| TENDINOUS BOTTOM | `M320 581 L408 581` | 88u  | gap between LEFT 1/RIGHT 2 and LEFT 3/RIGHT 3 |

All horizontal dividers sit inset ~6-10u from the bbox at that y level so
the stroke never extends past the abs silhouette onto obliques or body
border.

## Implementation

Pattern C (unclipped extension stroke):

- `components/exercise/body-overlay-paths.ts`: added 4 path constants
  (`PATH_ABS_LINEA_ALBA`, `PATH_ABS_TENDINOUS_TOP/MIDDLE/BOTTOM`) plus a
  shared stroke colour token `COLOR_ABS_DETAIL = '#4B5563'` (Tailwind
  gray-600). Verbose comment captures sub-path bbox table + lessons.
- `components/exercise/muscle-body-tagger.tsx`: `FrontOverlay` renders the
  4 stroke paths *only when* `highlight.has(M_ABS)` is true. Each path
  uses `strokeWidth=1`, `vectorEffect="non-scaling-stroke"` (essential at
  `BODY_SCALE=0.5` per the head-outline mini-pattern lesson from commit
  `0734b6f` — without `vectorEffect` the stroke renders sub-pixel and
  becomes invisible).
- `components/body-heatmap.tsx`: same 4 stroke paths gated on
  `mQuintile.has(M_ABS)`.

Both consumers gate on the highlight presence — never paint strokes on an
unhighlighted body. The stroke colour is a single neutral dark grey that
reads well against any role/quintile fill (orange / blue / yellow / red).

## Self-evaluation

### Does it read as 6-pack?

**Yes — in primary/secondary highlight modes the linea alba + 3 dividers
create the classic anatomical 8-pack outline** (3 dividers × 2 sides + lower
long section = 4 pair rows, the textbook "8-pack" reading; the more
common "6-pack" reads as the upper 3 pairs ignoring the lower long
section). Either way, the visual reads as rectus abdominis subdivisions
rather than a flat blob.

The preview HTML at `docs/audits/anatomy/preview/abs-pattern-c.html`
shows the abs in 4 panels:
1. Inactive — strokes suppressed (no abs highlight)
2. Primary orange + strokes
3. Secondary blue + strokes
4. Wide context with obliques flanking

### Edge cases checked

- **Top boundary**: linea alba starts at y=432, 4u below abs top y=428.
  Tendinous TOP at y=500 sits at the natural gap (LEFT 2 ends y=498).
  No clash with xiphoid process / sternum.
- **Bottom boundary**: linea alba ends at y=708, 4u above abs bot y=712.
  Bottom long section (LEFT 3 / RIGHT 3 from y=583 onwards) intentionally
  has no further divider — anatomically the pyramidalis area below the
  belly button is one undivided strip in most muscular references.
- **Lateral boundary**: dividers span ~88-96u, well inside the widest
  abs section (~106u at y=530). 6u margin on each side prevents bleed
  onto the package's obliques slug. Verified via the wide-context preview
  panel — strokes terminate cleanly within the abs colour fill.
- **Linea alba x = 364**: deviates from naïve viewBox center 362 but
  matches the chest centerline already used throughout this file (see
  CHEST round 17 keypoint mirror sums). Mid-line sampling confirms abs
  L/R boundary is around x=364.

### Obliques fiber hints — SKIPPED

The PRD listed obliques fiber hint paths (`PATH_OBLIQUE_FIBER_HINT_L/R`)
as a stretch goal. I deliberately did NOT ship them, for these reasons:

1. The package's obliques slug already shows 8 distinct sub-paths per side
   (LEFT 0..7, RIGHT 0..7) that visually approximate the external oblique's
   ribbed fiber direction — additional diagonal strokes would be redundant
   noise on top of an already busy silhouette.
2. The obliques sub-paths run from upper-medial to lower-lateral with
   varying curvature; faking 2-3 hand-drawn diagonal lines would either
   contradict the package's actual sub-path geometry (looking "off") or
   require a coord-picker round-trip with the user (not possible overnight).
3. The user already separates M_OBLIQUE from M_ABS, so the obliques have
   their own highlight pathway that doesn't share visual real estate with
   the 6-pack lines — no synergy lost by skipping.

If the user later asks for oblique fiber hints, the right move is to use
the coord-picker tool to trace 2-3 fiber lines per side that align with
the package's actual oblique sub-path slopes, rather than guess.

### Confidence

**4 / 5**. High confidence in:
- Coordinate sampling (mathematical derivation from package bbox).
- Pattern C is the right approach (matches `svg-overlay-refine` skill's
  decision tree for "fill notches / extend beyond slug" use cases).
- No regressions (tsc clean, 1393/1393 tests pass).

Slight uncertainty about:
- Whether the 4-divider count reads as too busy at `BODY_SCALE=0.5`. At
  the rendered abs height of ~40px (282u viewBox × 0.5 scale × ~0.28
  display ratio at 200px body width), 4 horizontal lines = ~10px between
  each. Might benefit from dropping the bottom divider to 3 dividers
  (= classic 6-pack) if user finds it cluttered. Easy revert: comment out
  the `PATH_ABS_TENDINOUS_BOTTOM` `<Path>` element in both consumers.

## Recommendation

**Ship as-is**, with the note that the bottom divider can be removed in
~30 seconds if the user finds the rendering too busy (single revert =
drop one Path element from each of FrontOverlay). Obliques fiber hints
skipped per rationale above — not blocking, not regressing.

## Files changed

- `components/exercise/body-overlay-paths.ts` (+58 LOC: 4 path constants
  + COLOR_ABS_DETAIL token + verbose anatomy comment)
- `components/exercise/muscle-body-tagger.tsx` (+33 LOC: 4 new imports
  + conditional `<>...</>` block in FrontOverlay)
- `components/body-heatmap.tsx` (+38 LOC: 5 new imports + conditional
  block in FrontOverlay)
- `docs/audits/anatomy/preview/abs-pattern-c.html` (new — visual preview
  4 panels showing inactive / primary / secondary / wide-context)
- `docs/audits/anatomy/agent-C-abs-findings.md` (this file)

## Verification

- `npx tsc --noEmit` → clean (no output, exit 0)
- `npm test` → 1393/1393 pass
- Manual visual check via `docs/audits/anatomy/preview/abs-pattern-c.html`
  (open in any browser to inspect)
