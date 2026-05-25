# 2026-05-24 — Anatomy Overlay 14-slug Fidelity + Visual Gap Audit

Branch: `slice/10c-set-logger-and-menu`  ·  baseline `c03670b`
Scope: `components/body-heatmap.tsx` slug map (19 M_* → 14 unique package slugs) + `components/exercise/body-overlay-paths.ts` (custom PATH_* overrides) vs the `react-native-body-highlighter@3.2.0` package native shapes.

Fidelity scoring rubric (0–5):
- **5** Pattern D coord-picker with 20+ user keypoints (chest 28-pt cubic asymmetric leaf; glute 51-pt Catmull-Rom + S-curve cubic)
- **4** Pattern B ClipPath partition with anatomically meaningful split (deltoid 3-head via SPLIT_X)
- **3** Pattern C unclipped extension with reasonable Bezier (front-/rear-delt medial fill arcs); or package native that happens to read anatomically correct
- **2** Rough polygon approximation (bicep long/short head wedges)
- **1** Empty string `''` (no overlay; falls through to package base)
- **0** Visually wrong (overlap, off-screen, mis-located)

----------

## § 1 — 14-slug inventory

The collapse map (`M_TO_SLUG` in `body-heatmap.tsx:136-156`) is reproduced below for context. Where 2+ M_* collapse onto one slug, the row covers the slug as a whole and notes the sibling-aware overlay that re-splits it.

| # | slug | side | M_* collapsed onto it | current PATH_* implementation | pattern | package native? | fidelity | notes |
|---|------|------|------------------------|-------------------------------|---------|-----------------|----------|-------|
| 1 | `chest` | front | `M_UPPER_CHEST`, `M_LOWER_CHEST` | `PATH_UPPER_CHEST` + `PATH_LOWER_CHEST` (28-keypoint user trace, asymmetric cubic Bezier ∪ leaf 切線, mirror x=364) | D | yes (L+R silhouette, no split) | **5** | round 20 final; UPPER+LOWER tile exactly within user-traced outline, anti-alias gap closed via identical 切線 cubic coords |
| 2 | `deltoids` | front | `M_FRONT_DELT`, `M_MID_DELT`, (`M_REAR_DELT` excluded front-side) | `PACKAGE_DELT_FRONT_L/R` (verbatim) inside `<ClipPath>`, two `<Rect>` partitioned at `SPLIT_X_FRONT_DELT_L/R` (≈1/3 width lateral strip) + `PATH_FRONT_DELT_CHEST_FILL_L/R` unclipped extension + `PATH_MID_DELT_PEAK_FRONT_L/R` empty | B + C + 1 | yes (cap silhouette only) | **4** | ClipPath partition exact; medial fill arc (round 8) anchored to PACKAGE bbox medial vertical, 2-cubic asymmetric leaf; mid-delt peak removed after overflow feedback |
| 3 | `deltoids` | back | `M_REAR_DELT`, `M_MID_DELT`, (`M_FRONT_DELT` excluded back-side) | `PACKAGE_DELT_BACK_L/R` (verbatim) inside `<ClipPath>` + `SPLIT_X_BACK_DELT_L/R` partition + `PATH_REAR_DELT_BACK_FILL_L/R` extension (round 9) + `PATH_MID_DELT_PEAK_BACK_L/R` empty | B + C + 1 | yes | **4** | symmetric to front; rear-delt fill anchored to real PACKAGE BACK medial curve after round 9 fix (was 13 units off) |
| 4 | `biceps` | front | `M_BICEP_LONG`, `M_BICEP_SHORT` | `PATH_BICEP_LONG_L/R` + `PATH_BICEP_SHORT_L/R` — 4 hand-drawn Q-Bezier quad polygons (~5-vertex each) | C/2 | yes (single belly silhouette per arm) | **2** | per file header "reasonable polygon approximations"; lateral/medial split is roughly right but does NOT trace PACKAGE bicep belly and ignores acromial origin tendon directions |
| 5 | `gluteal` | back | `M_UPPER_GLUTE`, `M_LOWER_GLUTE` | `PATH_UPPER_GLUTE` + `PATH_LOWER_GLUTE` (51-keypoint user trace, Catmull-Rom smoothed, S-curve cubic Bezier 切線 with inflection ∪ outer + ∩ inner, mirror x=1083.5) | D | yes (single combined silhouette) | **5** | round 4 final; outline + cut line both user-driven, anti-alias gap closed via shared cubic, half-fill tiling exact |
| 6 | `trapezius` | both | `M_TRAP` | none (package native) | A | yes (single silhouette covering upper/middle/lower fibers as one shape) | **3** | shape is anatomically OK as a single mass but loses upper/middle/lower fiber split that users training shrugs (upper) vs Y-raise (lower) actually care about |
| 7 | `triceps` | both | `M_TRICEP` | none (package native) | A | yes (single bundle on posterior arm) | **3** | package shape lacks long/lateral/medial head split but the lateral profile from back view reads correctly and 3-head split is rarely demanded by users |
| 8 | `forearm` | both | `M_FOREARM` | none (package native) | A | yes (single mass on radial/ulnar side) | **3** | acceptable — flexor/extensor split not commonly tracked by users; package shape covers anterior + posterior compartments visually |
| 9 | `abs` | front | `M_ABS` | none (package native) | A | yes (rectus abdominis with internal segments) | **3** | shape OK; package already has approximate "6-pack" segmentation visible at this render size |
| 10 | `obliques` | front | `M_OBLIQUE` | none (package native, multiple sub-paths) | A | yes (3-segment per side) | **3** | package shape is anatomically faithful for external oblique fiber direction |
| 11 | `upper-back` | back | `M_BACK` | none (package native) | A | yes (single mass covering lats + rhomboids + teres) | **2** | conflates latissimus dorsi (V-shape lower lats) and rhomboids (mid-back diamond) into one shape — training distinction is highly user-visible (pull-up vs row) |
| 12 | `lower-back` | back | `M_LOWER_BACK` | none (package native) | A | yes (erector spinae strip) | **3** | acceptable — erector spinae is anatomically a single visible mass at our render size |
| 13 | `quadriceps` | front | `M_QUAD` | none (package native) | A | yes (single mass covering all 4 heads) | **2** | misses rectus femoris (centerline) / vastus lateralis (outer) / vastus medialis ("teardrop" inner) split — these 3 heads are visually distinct on a developed leg and lifters track them |
| 14 | `hamstring` | back | `M_HAMSTRING` | none (package native) | A | yes (single mass covering biceps femoris + semitendinosus + semimembranosus) | **3** | 3-head split rarely tracked; package shape covers posterior thigh correctly |
| 15 | `calves` | both | `M_CALF` | none (package native) | A | yes (single mass at posterior lower leg) | **3** | gastrocnemius/soleus split would be nice but visually the diamond shape reads correctly |

(15 rows total because deltoids appears twice — front and back — for clarity.)

### Fidelity histogram

| score | slug count | slugs |
|-------|-----------|-------|
| 5 | 2 | chest, gluteal |
| 4 | 2 | deltoids front, deltoids back |
| 3 | 7 | trapezius, triceps, forearm, abs, obliques, lower-back, hamstring, calves *(8)* |
| 2 | 3 | biceps, upper-back, quadriceps |
| 1 | 0 | (PATH_MID_DELT_PEAK_* are listed inside deltoid rows since they're empty supplementary paths, not standalone slugs) |
| 0 | 0 | none broken |

(Note: 8 slugs land at fidelity 3 if you count both deltoid sides as already-4, so 14 unique slugs ⇒ histogram totals 14.)

----------

## § 2 — Visual gap analysis (lowest-fidelity slugs)

Visual references gathered via WebSearch (the task's preferred sub-agent path was not available — no Agent/Task spawning tool exposed in this environment — so reference gathering was done inline). Each slug below has fidelity ≤ 3.

### 2.1 `biceps` (front) — fidelity 2

- **Current state.** 4 hand-drawn quad polygons (`PATH_BICEP_LONG_L/R`, `PATH_BICEP_SHORT_L/R`) sitting on top of the package bicep silhouette. Each ~5 vertices, very rough.
- **Reference.** [Kenhub — Biceps brachii](https://www.kenhub.com/en/library/anatomy/biceps-brachii-muscle), [Wikipedia — Biceps](https://en.wikipedia.org/wiki/Biceps), [Speediance — long & short head](https://www.speediance.com/blogs/fitness/parts-of-bicep-anatomy-guide).
- **Gap.**
  - Long head sits laterally (outer), short head medially (inner) — current geometry direction is correct, but the polygons don't trace the PACKAGE bicep belly silhouette so they can extend past it (no clipping).
  - Both heads converge into a single common tendon at the elbow — current polygons are rectangular wedges that don't taper distally.
  - Acromion / coracoid origin direction (long head curves from lateral shoulder, short head from medial) is invisible in our polygon.
  - The two heads sit side-by-side along the entire belly length; our split mostly captures this but the boundary is straight rather than the slight diagonal seen in life.
- **Pattern recommendation.** **Pattern B (ClipPath partition)**. Wrap the PACKAGE biceps L+R paths in `<ClipPath>`, define a `SPLIT_X_BICEP_L/R` per arm, and let two `<Rect>` per arm partition the belly cleanly. This is the same fix that made deltoid jump from polygon → ClipPath at score 4. Estimated effort: **low** (no user keypoints needed; just decode bbox once + pick SPLIT_X at bicep horizontal midpoint per arm). 1 commit, ~40 LOC swap.

### 2.2 `upper-back` (back) — fidelity 2

- **Current state.** Single package shape covering lats + rhomboids + teres (and visually the trapezius mid-fibers spillover).
- **Reference.** [TeachMeAnatomy — Superficial Back Muscles](https://teachmeanatomy.info/back/muscles/superficial/), [Kenhub — Latissimus dorsi](https://www.kenhub.com/en/library/anatomy/latissimus-dorsi-muscle), [Kenhub — Rhomboids](https://www.kenhub.com/en/library/anatomy/rhomboid-muscles).
- **Gap.**
  - Latissimus dorsi is the LARGE V-shape from mid-thoracic spine + iliac crest up to the bicipital groove — this is what readers think of as "back" (pull-up training).
  - Rhomboids sit between scapulae, diamond-shaped — these drive row exercises and are training-distinct.
  - Teres major sits at the inferior scapular angle — tiny but visually distinct in muscular subjects.
  - Currently all three plus any spillover get one fill colour, so a user who tags "lats only" vs "rhomboids only" can't tell their selection apart on the diagram.
  - TrainingLog only has a single `M_BACK` constant though — so the back schema is the upstream constraint, not the overlay.
- **Pattern recommendation.** **Pattern D (coord-picker user trace)** is the right tool, but **the schema only has one `M_BACK` constant** — splitting visually without an M_* split would be misleading. Recommended: defer this slug; if back-split is desired, file ADR amendment first (split `M_BACK` → `M_LATS` + `M_RHOMBOID`), then do a Pattern D coord-picker session. Estimated effort: **high** (needs ADR + schema migration + user keypoint session); if just visual without M_* split, **medium** but anatomically dishonest. **Recommendation: do not iterate without ADR change.**

### 2.3 `quadriceps` (front) — fidelity 2

- **Current state.** Single package shape covering all 4 heads as one mass.
- **Reference.** [Kenhub — Quadriceps](https://www.kenhub.com/en/library/anatomy/the-quadriceps-femoris-muscle), [Wikipedia — Quadriceps](https://en.wikipedia.org/wiki/Quadriceps), [Brookbush — Vastus muscles](https://brookbushinstitute.com/articles/quadriceps-vastus-muscles).
- **Gap.**
  - Rectus femoris runs straight down the centerline of the thigh — visible as a central ridge.
  - Vastus lateralis bulges on the outer thigh — large, visible from the side, prominent in cyclists/lifters.
  - Vastus medialis sits at the inner-distal thigh forming the "teardrop" just above the knee — highly desirable visually + trained by deep squats.
  - Vastus intermedius sits beneath rectus femoris — not visible without dissection, no need to render.
  - Package currently shows a single mass with no internal split → users can't communicate which head a given exercise hits.
  - Like `upper-back`, the schema only has `M_QUAD` so a split would be schema-ungrounded.
- **Pattern recommendation.** **Pattern D (coord-picker)** if schema gets split `M_QUAD` → `M_RECTUS_FEMORIS` + `M_VASTUS_LATERALIS` + `M_VASTUS_MEDIALIS`. Without schema split, defer. Estimated effort: **high** (ADR + 3-region trace per leg ~30 keypoints each, mirror about thigh midline). **Recommendation: defer until ADR amendment.**

### 2.4 `trapezius` (both) — fidelity 3

- **Current state.** Single package shape covering upper + middle + lower fibers.
- **Reference.** [Kenhub — Trapezius](https://www.kenhub.com/en/library/anatomy/trapezius-muscle), [TeachMeAnatomy — Trapezius](https://teachmeanatomy.info/encyclopaedia/t/trapezius/).
- **Gap.**
  - Upper trapezius (descending fibers, neck → acromion) trained by shrugs.
  - Middle trapezius (transverse fibers, T1-T4 spine → scapular spine) trained by face-pulls / rear-delt rows.
  - Lower trapezius (ascending fibers, T4-T12 spine → scapular spine root) trained by Y-raise / lower-trap raises.
  - All three are popular training targets — losing the split costs information density.
  - Schema only has `M_TRAP` → same upstream constraint as `M_BACK` and `M_QUAD`.
- **Pattern recommendation.** **Pattern B (ClipPath partition)** with 2 horizontal split-lines if schema gets `M_TRAP_UPPER` / `M_TRAP_MIDDLE` / `M_TRAP_LOWER`. Without schema, defer. Estimated effort: **medium** (ClipPath partition is mostly mechanical once schema lands). **Recommendation: defer until ADR amendment.**

### 2.5 `triceps` (both) — fidelity 3

- **Current state.** Single package shape on posterior arm.
- **Reference.** [Kenhub — Triceps](https://www.kenhub.com/en/library/anatomy/triceps-brachii-muscle).
- **Gap.** Long head (inner-posterior, biceps brachii antagonist), lateral head (outer, "horseshoe" look), medial head (deep, only distal visible). Triple-split is anatomically rich but `M_TRICEP` is one constant.
- **Pattern recommendation.** **Defer**. Single-mass rendering reads correctly enough; user demand likely low vs biceps split.

### 2.6 `forearm`, `abs`, `obliques`, `lower-back`, `hamstring`, `calves` (all fidelity 3)

- All package native, all anatomically defensible at our render size, all single-M_*.
- No iteration recommended — return on visual investment is low and schema doesn't support sub-split.
- Reference for completeness: [Cleveland Clinic — Abdominal Muscles](https://my.clevelandclinic.org/health/body/21755-abdominal-muscles), [TeachMeAnatomy — Anterolateral Abdominal Wall](https://teachmeanatomy.info/abdomen/muscles/abdominal-wall/), [Kenhub — Trapezius](https://www.kenhub.com/en/library/anatomy/trapezius-muscle) (used above).

----------

## § 3 — Recommended iteration order (top 5)

Composite ranking = user-visibility × fidelity gap × inverse-effort. Schema-blocked items pushed down even if visual gap is large.

| rank | slug | pattern | needs user input? | est. commits | est. LOC | rationale |
|------|------|---------|--------------------|---------------|-----------|-----------|
| **1** | `biceps` (front) | **B** — ClipPath partition | No (can be coded blind: decode PACKAGE biceps bbox once, pick SPLIT_X at horizontal midpoint per arm) | 1 | ~40 (+ remove 4 polygon constants) | Highest ROI — schema already has long/short split; current polygon is the only fidelity-2 slug that has both an M_* split *and* a code-only fix. Mirror the deltoid round-1 ClipPath upgrade. Expected to jump fidelity 2 → 4. |
| **2** | `triceps` (both) | **C** — unclipped extension (mild horseshoe outline) | No | 1 | ~30 | Add a single bracket / horseshoe outline on top of the package triceps to suggest long+lateral head separation. Low risk, low LOC, modest visual win. Fidelity 3 → 3.5. |
| **3** | `abs` (front) | **C** — unclipped vertical linea alba + 1-2 horizontal tendinous intersection lines | No | 1 | ~20 | The 6-pack is iconic but the package abs already has internal segmentation paths; this just adds a thin centerline + tendinous intersection at umbilicus level. Reinforces the visual without an M_* split. Fidelity 3 → 4. |
| **4** | `trapezius` (both) | **B** — ClipPath partition with 2 horizontal cut lines | **Yes** — needs user choice of cut-line heights + ADR amendment for `M_TRAP_UPPER/MID/LOWER` schema split | 1 ADR + 1 schema migration + 1 overlay = 3+ | ~100 | Schema-blocked. Worthwhile but defer until user signals demand for tracking upper-vs-lower trap differently. |
| **5** | `upper-back` (back) | **D** — coord-picker user trace for lat V + rhomboid diamond | **Yes** — needs ADR amendment for `M_LATS` + `M_RHOMBOID` schema split + user trace session | 1 ADR + 1 schema + 1 trace + 1 overlay = 4+ | ~200 | Highest visual gap but highest effort — pull-day exercise differentiation is real but defer until schema is ready. |

`quadriceps` ranked 6th (omitted to keep top-5): same as `upper-back`, schema-blocked, ~200 LOC + ADR + trace.

----------

## § 4 — Package native path coverage

### Slugs where Pattern A (defer to package) is currently used AND is anatomically defensible

| slug | reason |
|------|--------|
| `forearm` | single mass acceptable at render size; flexor/extensor split rarely user-tracked |
| `obliques` | package ships multi-segment paths showing serratus-style fiber direction — anatomically faithful |
| `lower-back` | erector spinae is visually a single column |
| `hamstring` | 3-head split rarely tracked; single mass acceptable |
| `calves` | gastrocnemius diamond reads correctly; soleus split rarely user-tracked |

### Slugs where Pattern A is currently used but the package is anatomically too coarse

| slug | what's missing | upgrade path |
|------|----------------|--------------|
| `trapezius` | no upper/middle/lower fiber split | Pattern B (needs schema split first) |
| `upper-back` | no lats / rhomboids / teres split | Pattern D (needs schema split first) |
| `quadriceps` | no rectus / vastus lateralis / vastus medialis split | Pattern D (needs schema split first) |
| `abs` | rectus segmentation visible but linea alba + tendinous intersections not crisp | Pattern C (no schema change needed) |
| `triceps` | no long / lateral / medial head split | Pattern C (no schema change needed) |

### Slugs where Pattern A would be valid but we already have a custom override

| slug | current pattern | "would A be enough?" |
|------|-----------------|-----------------------|
| `chest` | D | No — package chest is single L+R silhouette; M_UPPER_CHEST + M_LOWER_CHEST schema demands a split. Pattern D is necessary. |
| `deltoids` (both) | B + C | No — package deltoid is single cap shape; 3-head schema demands ClipPath partition. Pattern B is necessary. |
| `biceps` (front) | C/2 (rough polygon) | No — long/short head schema demands a split. Pattern B (ClipPath) is the right upgrade. |
| `gluteal` (back) | D | No — package gluteal is single L+R silhouette; M_UPPER_GLUTE + M_LOWER_GLUTE schema demands a split. Pattern D is necessary. |

### Summary

- **5 of 14** slugs would benefit from upstream schema changes before any overlay iteration makes anatomical sense.
- **3 of 14** can be improved blind (no user keypoints, no schema change): `biceps` (Pattern B), `triceps` (Pattern C), `abs` (Pattern C).
- **6 of 14** are package native and good enough as-is.

----------

## Process notes

- **Sub-agent spawning blocked.** Task spec asked for `Agent` tool with `subagent_type: "general-purpose"`. No such tool is exposed in this environment's deferred toolkit (verified via ToolSearch `+agent task spawn subagent` and `+task` — only `TaskStop` and scheduled-task tools surfaced). Visual reference research was done inline via 6 parallel `WebSearch` calls instead.
- **Worktree note.** The named agent worktree `agent-ac4ca5d079cc3180a` was checked out on `main @ ee2ff2f`, not `slice/10c-set-logger-and-menu @ c03670b` as the task header stated. Inputs were read from the real branch worktree at `/Users/hao800922/code/TrainingLog-worktrees/slice-10c-set-logger-and-menu`; the audit doc is written there so it lands on the slice/10c branch.
- All read inputs verified read-only: no .ts / .tsx / ADR / test touched.

## Sources (for visual reference comparison)

- [Kenhub — Biceps brachii](https://www.kenhub.com/en/library/anatomy/biceps-brachii-muscle)
- [Wikipedia — Biceps](https://en.wikipedia.org/wiki/Biceps)
- [Speediance — Bicep long & short head](https://www.speediance.com/blogs/fitness/parts-of-bicep-anatomy-guide)
- [Kenhub — Trapezius](https://www.kenhub.com/en/library/anatomy/trapezius-muscle)
- [TeachMeAnatomy — Trapezius](https://teachmeanatomy.info/encyclopaedia/t/trapezius/)
- [TeachMeAnatomy — Superficial Back Muscles](https://teachmeanatomy.info/back/muscles/superficial/)
- [Kenhub — Latissimus dorsi](https://www.kenhub.com/en/library/anatomy/latissimus-dorsi-muscle)
- [Kenhub — Rhomboids](https://www.kenhub.com/en/library/anatomy/rhomboid-muscles)
- [Kenhub — Quadriceps](https://www.kenhub.com/en/library/anatomy/the-quadriceps-femoris-muscle)
- [Wikipedia — Quadriceps](https://en.wikipedia.org/wiki/Quadriceps)
- [Brookbush — Vastus muscles](https://brookbushinstitute.com/articles/quadriceps-vastus-muscles)
- [Physio-Pedia — Deltoid](https://www.physio-pedia.com/Deltoid)
- [Wikipedia — Deltoid muscle](https://en.wikipedia.org/wiki/Deltoid_muscle)
- [Cleveland Clinic — Abdominal muscles](https://my.clevelandclinic.org/health/body/21755-abdominal-muscles)
- [TeachMeAnatomy — Anterolateral abdominal wall](https://teachmeanatomy.info/abdomen/muscles/abdominal-wall/)
