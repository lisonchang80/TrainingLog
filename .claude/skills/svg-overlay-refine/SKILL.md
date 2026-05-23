---
name: svg-overlay-refine
description: Iteratively refine SVG body / anatomy overlay paths with reference-image verification. Use when adjusting body-heatmap, muscle-body-tagger, body-overlay-paths.ts, or any similar SVG diagram that needs to match user-provided reference PNGs (e.g. /Users/.../tmp/anatomy-refs/IMG_*.PNG). Companion to screenshot-compare (which picks variants) — this skill iterates a single target.
---

# SVG Overlay Refine — Anatomy diagram coordinate iteration

When user-facing SVG body / muscle diagram doesn't match reference images, iterate the SVG path data with agent verification rather than freelancing coords. SVG path tuning is precision work — small `Q` control point shifts mean visible re-shapes. Letting agents read reference PNGs + adjust coords is dramatically more accurate than text-only prose iteration.

## When to use

- User feedback「不對」、「太大」、「太小」、「跑出來了」on body / anatomy SVG render
- Adding sub-division overlay paths (chest upper/lower, biceps long/short, deltoid 3-head)
- Iterating coordinates on existing overlay (`PATH_*` constants in `body-overlay-paths.ts`)
- Replacing hand-drawn approximation with package-derived precise path
- Need clipPath / Defs / Rect SVG composition

## When NOT to use

- Visual is roughly right, just needs color/scale tweak (Edit directly)
- First-pass design (no reference yet) — get reference first
- Non-SVG visual issues (CSS layout, image asset, font)

## Setup invariants

### Reference images convention

User stores reference PNGs at `/Users/<user>/code/<project>/tmp/anatomy-refs/`:
- TrainingLog: `/Users/hao800922/code/TrainingLog/tmp/anatomy-refs/IMG_1359.PNG` ~ `IMG_1377.PNG` (19 muscle highlights)
- Path is consistent — agent should Read these via the Read tool to **see** the reference

NOT in git tracking (`.gitignore` or stays in `tmp/`).

### Package coordinate space (react-native-body-highlighter)

- Front body: viewBox `0 0 724 1448` (chest centerline x=362)
- Back body: viewBox `724 0 724 1448` (spine centerline x=1086)
- Verbatim package paths in `node_modules/react-native-body-highlighter/dist/assets/bodyFront.js` + `bodyBack.js`

### Overlay file structure

- `components/exercise/body-overlay-paths.ts` — shared PATH_*, SPLIT_X_*, sibling-group constants
- `components/body-heatmap.tsx` — quintile-fill overlay (FrontOverlay/BackOverlay)
- `components/exercise/muscle-body-tagger.tsx` — role-fill overlay (same FrontOverlay/BackOverlay structure)
- Both use `subFill` / `roleSubFill` helpers (sibling-aware)

## Iteration loop

### Step 1 — Identify what's wrong

User reports specifically what's off (extends too far, doesn't match shape, missing area, overlaps wrong region). Capture the exact words ("超出外側" / "缺角" / "向外延伸不對") + reference IMG number.

### Step 2 — Decide approach (3 patterns)

**A. ClipPath partition** (best for collapsed slugs):
- When two sub-divisions should EXACTLY tile the parent slug (no gaps, no overflow)
- Wrap package's verbatim slug path in `<Defs><ClipPath id="...">`
- Render two `<Rect>` covering full bounding box, each filled with a sub-division color
- Both rects get clipped to the slug shape → exact partition
- Use `SPLIT_X_*` constants for the divider position
- Pattern used for: deltoid 3-head split

**B. Unclipped extension paths** (for filling notches / extending beyond slug):
- When the slug doesn't reach a visual landmark (e.g. acromion peak) OR another slug masks part of it (e.g. chest covers lower medial deltoid)
- Draw `<Path>` UNCLIPPED on top of package slugs
- These cannot be visually masked since they layer last
- BEWARE: paths extending past body silhouette outline look like errors

**C. Approximate polygon (legacy)**:
- Quick approximation, OK for non-collapse cases (chest upper/lower, gluteal upper/lower)
- Less precise than ClipPath but simpler

**D. User-traced outline via coord-picker tool** (best when user has strong visual opinion):
- After 5+ iterations of agent guessing fail, ask user to TRACE the outline themselves
- Build interactive HTML page with PACKAGE body silhouette + grid + landmark labels + sternum centerline
- Render in browser via `open file.html` — user moves mouse to see SVG viewBox coords live, clicks to record keypoints
- User provides N keypoints (typically 10-30 for one half of body, ~4 for a 切線/split line)
- Mirror about user-chosen axis (NOT necessarily viewBox center — user may pick x=363 / x=364 / etc based on visual symmetry, verify by checking mirror sums on 切線 endpoints)
- Pattern used: chest UPPER/LOWER 切線 + 28-point chest outline trace (2026-05-23/24)
- Coord-picker HTML template:
  ```html
  <svg viewBox="X Y W H" onmousemove="..." onclick="...">
    <!-- inline ALL PACKAGE body parts so user has full context (not just chest in isolation) -->
  </svg>
  ```
  Extract paths via: `node -e "const {bodyFront} = require('./node_modules/react-native-body-highlighter/dist/assets/bodyFront'); ..."`
  - Display landmark dots + labels + grid + sternum centerline
  - Show live coord display + click-to-mark + copy-to-clipboard
  - Place at `~/Desktop/<thing>-coord-picker.html` so user can re-open easily

### Step 3 — Spawn agent with reference

Agent prompt should:
- Read specific reference IMG paths (e.g. `Read /Users/.../IMG_1369.PNG`)
- Read current PATH_* constants
- Read package's verbatim slug path (for bounding box / partition source)
- Suggest specific coordinate changes
- Verify with `npx tsc --noEmit` + `npm test -- bodyHeatmap`
- Commit + push directly to working branch

Agent template prompt:
```
Working directory: /Users/<user>/code/<repo>/<worktree>. Always cd here.

Mission: <specific user-feedback driven goal>

Read references:
- /Users/<user>/code/<project>/tmp/anatomy-refs/IMG_<N>.PNG
- components/exercise/body-overlay-paths.ts
- node_modules/react-native-body-highlighter/dist/assets/body<Front|Back>.js

Approach: <A: clipPath | B: unclipped extension | C: polygon>

Constants to change: <list>
New coordinates: <hints based on user feedback>

Verify: tsc + jest pass, commit + push.
Report: old → new coords with rationale, branch tip SHA.
```

### Step 4 — Smoke + iterate

User reloads simulator, screenshots back. Compare to reference IMG + previous attempt. If still off, repeat Step 1 with revised feedback.

Typical session: 3-6 iterations until visual matches reference.

## Bezier curve direction reference

For SVG screen coords (y increases downward):

| Visual shape | Math name | How to make with Q control |
|---|---|---|
| ∪ (smile, sags down at middle) | Concave-UP | Q ctrl y **>** straight midpoint y |
| ∩ (frown, bulges up at middle) | Concave-DOWN | Q ctrl y **<** straight midpoint y |

**Common mistake**: in SVG, "concave-up" is COUNTER-intuitive vs math-class drawings because y axis flips. For a 切線 from (252, 379) lower-left to (356, 336) upper-right, straight midpoint y=357.5. To make concave-UP (user usually wants this for natural muscle boundary):
- Q ctrl (305, 372) → curve y > 357.5 at midpoint → ∪ ✓
- Q ctrl (305, 343) → curve y < 357.5 at midpoint → ∩ ✗ (looks "凹向下")

For asymmetric leaf shape, switch Q (quadratic, symmetric) → C (cubic, 2 control points):
- `C cp1_x cp1_y cp2_x cp2_y end_x end_y`
- cp1 controls curve near start (typically outer lateral end of 切線)
- cp2 controls curve near end (typically inner medial end)
- Both cp y > straight midpoint → concave-up
- |cp1.y - midpoint.y| > |cp2.y - midpoint.y| → bulge deeper near outer side → asymmetric leaf

Example (chest 切線 round 20):
```
L: C 270 400 335 348 356 336  (asymmetric concave-up cubic)
   cp1 (270, 400) → deep bulge near outer (depth 12.75 at t=0.3)
   cp2 (335, 348) → shallow bulge near inner (depth 7 at t=0.7)
```

### S-shape cubic Bezier (different concavity at outer vs inner)

When user wants 切線 with DIFFERENT concavity at each end (e.g. "外側凹向上、內側凹向下" — S-shape with inflection point):

Place cp1 and cp2 on OPPOSITE sides of the straight line:
- cp1 (near outer): y > straight_at_cp1_x → ∪ near outer
- cp2 (near inner): y < straight_at_cp2_x → ∩ near inner
- Inflection point happens around t=0.5 (curve crosses straight line once)

Example (glute 切線 round 3):
```
L→R from (978, 674) to (1081, 685), straight slope 11/103 ≈ 0.107
  cp1 (1008, 706): straight y at x=1008 ≈ 677.2, cp1 y=706 → 29 below straight → ∪ pull
  cp2 (1054, 654): straight y at x=1054 ≈ 681.7, cp2 y=654 → 28 above straight → ∩ pull
  Curve at t=0.3: y=684.6 vs straight 677.2 → +7 below straight (∪ confirmed)
  Curve at t=0.7: y=675.0 vs straight 682.0 → -7 above straight (∩ confirmed)
  Total amplitude ~14 units, clearly visible S
```

For mirroring across an axis, reverse cp order: L→R `C cp1 cp2 end` ↔ reverse `C cp2 cp1 start` (same shape, opposite direction).

## Catmull-Rom smoothing for jagged polylines

When user traces an outline with 20+ closely-spaced keypoints, connecting them with straight L lines produces visible jaggedness at small render size. Replace with Catmull-Rom cubic Bezier chain — curve passes through every keypoint with continuous tangent (C1 smoothness).

**Formula** (segment from Pi → Pi+1, with neighbors Pi-1 and Pi+2):
```
cp1 = Pi   + (Pi+1 - Pi-1) / 6
cp2 = Pi+1 - (Pi+2 - Pi)   / 6
```
Factor 1/6 is standard Catmull-Rom (tension=1). Larger factor (e.g. 1/3) = more curve; smaller (1/12) = sharper.

**Boundary handling**: first/last segments have no real neighbor on one side. Use mirror-phantom:
```python
p_neg1 = (2*pts[0][0] - pts[1][0], 2*pts[0][1] - pts[1][1])
p_n    = (2*pts[-1][0] - pts[-2][0], 2*pts[-1][1] - pts[-2][1])
```
This makes endpoint tangent direction continuous with first/last segment direction (no sudden snap).

**Python script** (reusable across muscle outlines):
```python
def catmull_rom(pts, factor=1/6):
    p_neg1 = (2*pts[0][0] - pts[1][0], 2*pts[0][1] - pts[1][1])
    p_n = (2*pts[-1][0] - pts[-2][0], 2*pts[-1][1] - pts[-2][1])
    extended = [p_neg1] + list(pts) + [p_n]
    parts = [f"M{pts[0][0]} {pts[0][1]}"]
    for i in range(1, len(extended) - 2):
        p0, p1, p2, p3 = extended[i-1], extended[i], extended[i+1], extended[i+2]
        cp1 = (p1[0] + (p2[0]-p0[0])*factor, p1[1] + (p2[1]-p0[1])*factor)
        cp2 = (p2[0] - (p3[0]-p1[0])*factor, p2[1] - (p3[1]-p1[1])*factor)
        parts.append(f"C{cp1[0]:.1f} {cp1[1]:.1f} {cp2[0]:.1f} {cp2[1]:.1f} {p2[0]} {p2[1]}")
    return " ".join(parts)
```

**Cost**: ~30 chars per Bezier segment × N-1 segments. For 28 keypoints → 27 cubic Beziers → ~810 chars. Path size doubles vs straight L, but jaggedness eliminated.

**When NOT to smooth**: short polylines (< 10 points) where each segment is intentional / where straight edges are anatomically correct (e.g., bone landmarks).

Used: glute UPPER/LOWER outline round 4 (51-keypoint trace).

## Mirror axis selection

PACKAGE bodies (`react-native-body-highlighter`) are NOT strictly mirror-symmetric about viewBox center x=362:
- PACKAGE chest L bbox: [251, 359] (width 108, center 305)
- PACKAGE chest R bbox: [372, 471] (width 99, center 421.5)
- Naive mirror about 362 → R extends [365, 473], doesn't match PACKAGE R

**How to choose mirror axis**:
1. Ask user to click 4 symmetric reference points on coord-picker tool (e.g., 切線 L outer + R outer + L inner + R inner)
2. Compute mirror sums: L.x + R.x for each pair
3. If sums consistent (e.g., all 728), user's mental centerline = sum/2 (= 364, NOT 362)
4. Use user's centerline for ALL subsequent mirror calculations on this body region

**Don't impose viewBox center x=362** as mirror axis — user perceives PACKAGE asymmetry and adjusts visually. Trust user's clicked symmetry.

## SVG fill rule + hole technique

When 2 fills need to share a boundary (e.g., UPPER and LOWER chest sharing 切線):

**Approach 1: Separate non-overlapping paths** (preferred if possible):
- UPPER = path bounded by chest top + 切線
- LOWER = path bounded by 切線 + chest bottom
- Both share EXACT 切線 endpoints + control points (copy-paste same Bezier into both)
- No anti-alias gap because boundaries align

**Approach 2: SVG nonzero hole** (for chest L+R combined fills, where one slug needs hole inside):
- LOWER path = `[chest CW] [hole CCW] [hole CCW]` — reversed direction hole sub-paths cancel chest's winding inside → SVG nonzero rule treats them as holes
- UPPER path = same hole shapes alone (forward direction) → fills the holes

**Anti-pattern: naive mirror flips winding direction**:
- If L path written CW (computed via shoelace), naive coordinate-mirror about x-axis gives R path traversed in OPPOSITE direction = CCW
- Result: R hole subpath has SAME direction as chest R → no hole created → fill bleeds across (user sees R leaf invisible, L leaf visible)
- Fix: explicitly reverse R subpath traversal order so it's CW like chest R (swap top/bottom curve order, swap C cp1/cp2)

## Anti-pattern

- ❌ Eyeball-tune SVG coords in main convo without reading reference IMG — high error rate
- ❌ Set d="" on multiple paths without testing each — silent rendering bugs
- ❌ ClipPath without verbatim package path — clip cuts wrong region
- ❌ Change `SPLIT_X` value without explaining the 1/2 vs 1/3 ratio choice
- ❌ Forget side-aware exclusion (deltoid front vs back) when modifying buildData
- ❌ Don't put extension paths AFTER clipped rects in render order — they get covered
- ❌ Confuse SVG concave-up/down vs math class convention (y axis flipped) — always verify with curve midpoint calc against straight midpoint
- ❌ Assume mirror axis = viewBox center 362 — PACKAGE is asymmetric, user often picks 363/364
- ❌ Naive coordinate-mirror cubic Bezier without reversing curve order — flips winding direction silently
- ❌ Iterate 5+ rounds with agent guesses on user black-line images — break to coord-picker tool, get exact SVG coords from user instead
- ❌ Assume cut line has single concavity (∪ only or ∩ only) — user may want S-shape (∪ at outer + ∩ at inner). Confirm with user before picking cp y direction; for S-shape, place cps on OPPOSITE sides of straight line.
- ❌ Leave user-traced polyline (20+ keypoints) as raw `L` segments — looks jagged at render size. Apply Catmull-Rom smoothing (cubic Bezier chain through every keypoint, C1 continuous tangent).

## Pre-commit hook integration

Per the git pre-commit hook (TrainingLog), tsc + jest gate runs automatically when committing the SVG path change. If hook errors, agent re-iterates without push.

## Historical example session

TrainingLog 2026-05-23 evening:
- R5 library swap (`react-native-body-highlighter@3.2.0`) — 1 agent
- R6 sub-division overlay (chest/biceps/deltoid/gluteal polygons) — 1 agent
- Port overlay to muscle-body-tagger (role-color) — 1 agent
- Deltoid clipPath partition (replace polygon approximation) — 1 agent
- Mid-delt 1/3 shrink (SPLIT_X tweak) — manual Edit
- Acromion peak removal + chest/back fill arcs — 1 agent
- Arc shrink (apex pulled back 22-28 units toward delt) — 1 agent

7 iterations, ~3-4 hr total, 8 separate commits. Each iteration: user reports, I decide approach, spawn agent (or manual Edit for 1-line changes), push, user reloads. Reference IMGs key to convergence.

## Historical example session 2 — chest UPPER/LOWER 切線 (2026-05-23 → 24)

10 rounds (round 10 → 20), ~12 commits, escalating tool sophistication:
- Round 10-13: agent guesses based on user black-ink screenshot → REPEATED FAILURE (V apex direction wrong, leaf shape too thin, R leaf invisible due to winding direction bug)
- Round 14: tried ∧ apex at sternum top — still wrong direction
- Round 15-16: leaf shape attempt — R leaf hidden by LOWER (winding bug fixed)
- Round 17: **BREAKTHROUGH** — built coord-picker HTML, user clicked 4 切線 keypoints, mirror sum=728 → user's centerline = 364
- Round 18: user traced 28 chest L outline keypoints → custom chest silhouette, mirror gave R, exact match
- Round 19: 4 fixes (symmetry, gap, curve depth, scale 1.05)
- Round 20: caught Q ctrl direction bug — concave-down → cubic Bezier asymmetric concave-up

**Key takeaway**: agent visual interpretation of user hand-drawn ink images is unreliable past 3-5 iterations. Switch to coord-picker HTML tool to get exact SVG coords from user. Build the tool when iteration stalls, don't wait 10 rounds.

## Historical example session 3 — glute UPPER/LOWER 切線 + outline (2026-05-24)

4 rounds, 1 commit (no agent — direct main-convo Edit with verification math each round). Leveraged session 2's coord-picker tool from start, avoided wasted iterations:

- **Round 1** — Built `glute-coord-picker.html` (back viewBox `940 540 280 320`, full back silhouette + dashed overlay of existing PATH_UPPER_GLUTE/LOWER_GLUTE for reference). User clicked 4 切線 keypoints. Mirror sums P1+P4 = P2+P3 = 2167 → axis x=1083.5. Implemented cut line as single-concavity cubic (cp y > straight midpoint → ∪).
- **Round 2** — User traced 51-point L glute combined outline. Decomposed into UPPER (P3-P23) + LOWER (P24-P51) via cut line. Mirrored R using x'=2167-x. Outline as raw `L` segments.
- **Round 3** — User feedback "接近外側凹向上，接近內側凹向下" → S-shape cubic. Placed cp1 below straight near outer (∪ pull), cp2 above straight near inner (∩ pull). Verified amplitude ±7 units at t=0.3 / t=0.7.
- **Round 4** — User feedback "外圍有點鋸齒給一點點平滑" → Catmull-Rom smoothing on all 4 polylines (UPPER L 21 + UPPER R 21 + LOWER L 27 + LOWER R 27 segments). Used Python script with mirror-phantom boundary.

**Key takeaway vs session 2**: when the user's mental model is precise (they can articulate "外側凹向上、內側凹向下"), do the math in the main conversation — no agent spawn needed. Save agents for ambiguous visual interpretation tasks. Also: re-use the coord-picker HTML template (just swap viewBox + silhouette parts) — building takes 5 min, saves 5+ rounds of guesswork.
