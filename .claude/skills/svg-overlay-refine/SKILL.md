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

## Anti-pattern

- ❌ Eyeball-tune SVG coords in main convo without reading reference IMG — high error rate
- ❌ Set d="" on multiple paths without testing each — silent rendering bugs
- ❌ ClipPath without verbatim package path — clip cuts wrong region
- ❌ Change `SPLIT_X` value without explaining the 1/2 vs 1/3 ratio choice
- ❌ Forget side-aware exclusion (deltoid front vs back) when modifying buildData
- ❌ Don't put extension paths AFTER clipped rects in render order — they get covered

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
