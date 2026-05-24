/**
 * Sub-division overlay paths shared by `body-heatmap.tsx` and
 * `muscle-body-tagger.tsx`.
 *
 * The `react-native-body-highlighter` package's `chest`, `biceps`, `deltoids`,
 * and `gluteal` slugs each bundle 2+ M_* constants together. To restore the
 * lost granularity we draw a transparent SVG overlay on top of the Body
 * component with per-half fills that match the underlying region. Coordinates
 * are in the package viewBox space:
 *   - front : "0 0 724 1448"
 *   - back  : "724 0 724 1448"
 *
 * Chest / biceps / gluteal overlay paths are reasonable polygon
 * approximations of each half — see the anatomy reference IMG_1359..IMG_1377
 * PNGs for the visual targets. They don't trace the package paths exactly
 * but occupy roughly the right region so a viewer can tell which sub-head
 * is highlighted.
 *
 * The DELTOID slug is handled differently (since 2026-05-23): instead of
 * approximate per-head wedges, the consumer wraps the package's verbatim
 * deltoid path in a `<ClipPath>` and partitions it via two `<Rect>` halves
 * split at the bounding-box midpoint. This guarantees the combined fill
 * exactly equals the underlying cap silhouette — see PACKAGE_DELT_* and
 * SPLIT_X_*_DELT_* constants below.
 *
 * Each consumer (heatmap = quintile-fill, tagger = role-fill) builds its own
 * `subFill` helper around these primitives — the fill colour space differs
 * (quintile palette vs primary/secondary role), but the path geometry is
 * shared.
 */

import {
  M_BICEP_LONG,
  M_BICEP_SHORT,
  M_FRONT_DELT,
  M_LOWER_CHEST,
  M_LOWER_GLUTE,
  M_MID_DELT,
  M_REAR_DELT,
  M_UPPER_CHEST,
  M_UPPER_GLUTE,
} from '@/src/db/seed/v006ExerciseLibrary';

// ---------------------------------------------------------------------------
// Front-side overlay paths
// ---------------------------------------------------------------------------

/**
 * Front chest — upper / lower split via V-line meeting at sternum mid.
 *
 * Decoded from PACKAGE chest L+R silhouettes (node_modules/.../bodyFront.js):
 *   Chest L outline: (260, 344) top-left → (300, 318) top arc → (337, 319)
 *     top-medial → (357, 392) right-medial mid → (297, 433) bottom-medial
 *     → (272, 422) bottom-left.
 *   Chest R outline: (380, 327) top-medial → (399, 318) → (422, 318) →
 *     (449, 326) top-right → (471, 355) right-lateral → (443, 430)
 *     bottom-right → (416, 435) → (375, 413) bottom-medial.
 *   Sternum notch gap between (337, 319) and (380, 327); xiphoid notch
 *   between (357, 392) and (375, 413).
 *
 * V-line design (per user 2026-05-23 round 10):
 *   - apex at (362, 385) — chest centerline, mid-height
 *   - endpoints at chest lateral edges: L (260, 345), R (463, 345)
 *   - "一點點凹向上弧度" — each V wing uses Q control at y=358,
 *     ~7 units above straight-line midpoint (subtle upward bow)
 *   - L↔R mirror about x=362 (anchor sums = 723, close to 724;
 *     PACKAGE chest is not strictly symmetric)
 *
 * Two paths share the V-line; together they fill the chest silhouette
 * without extending outside.
 */
/**
 * Round 11 chest fix (2026-05-23): user reported "上方中間超出胸的界線 (中縫)"
 * — UPPER paint crossed PACKAGE sternum notch (between chest L medial top
 * (337, 319) and chest R medial top (380, 327)) painting over body area
 * that has no pec muscle.
 *
 * Redesign: each of UPPER + LOWER is now TWO sub-paths (one per pec L/R),
 * never crossing sternum notch at top or xiphoid notch at bottom.
 *
 * V wings now end at chest L/R medial silhouette crossings (where the
 * original V wing from lateral to centerline-apex would intersect chest
 * medial): L crossing ~(357, 383), R crossing ~(374, 380). Two close-but-
 * separate "V apexes" 17 units apart in x — visually reads as single V
 * apex at sternum xiphoid area without actually crossing into the notch.
 *
 * "一點點凹向上" preserved: V wing left Q control (309, 357), curve mid
 * y=360.5 vs straight midpoint y=364 → 3.5 above (slight concave up).
 * V wing right Q control (416, 356), similar slight concave up.
 */
/**
 * Round 12 chest fix (2026-05-23): user feedback "1.請填滿原本胸的位置
 * 2.中縫可以著色，只是上下沒有連著就不用著色 3.切線起始與終點異常，應該要
 * 如我手畫黑線 4.請對稱".
 *
 * Re-reading user's black-line direction: V apex at SternumTOP center
 * (chest 中縫上方分開處 = where chest L+R separate at sternum top), wings
 * going DOWN-OUTWARD to lateral upper. So UPPER is the SMALL triangle
 * sliver near sternum top; LOWER is the LARGE region covering most of
 * chest. Round 11 had this backwards (V apex at chest mid-lower).
 *
 * Each of UPPER + LOWER = 2 sub-paths (L pec + R pec). V wings end at
 * PACKAGE chest L/R medial top vertices:
 *   - L V apex: (337, 319) — real chest L medial top
 *   - R V apex: (380, 327) — real chest R medial top
 * Sternum top gap between (337, 319) and (380, 327) is NOT painted
 * (chest L/R don't connect there); xiphoid bottom gap likewise.
 *
 * Each pec fully painted by UPPER+LOWER union (覆蓋原 PACKAGE chest area).
 *
 * V wings concave up (slight): L Q control (295, 326), R Q control
 * (428, 326). PACKAGE chest L/R asymmetry (medial top y=319 vs y=327)
 * inherent; paths follow each side's real silhouette → visual symmetry
 * within PACKAGE constraints.
 */
/**
 * Round 13 chest fix (2026-05-23): user black-line drawing shows V wings
 * going DOWN-INWARD (from chest upper-outer lateral to chest lower-medial),
 * forming a bowtie where the two wings visually meet at sternum mid-lower.
 *
 * V apex on each side at chest medial near lower-mid:
 *   L: (357, 395) — on chest L medial silhouette mid-bottom
 *   R: (374, 395) — on chest R medial silhouette mid-bottom
 * Two close-but-separate V apex points (17 units apart in x) — visually
 * read as single bowtie center around sternum lower-mid area.
 *
 * UPPER = large region above V wings (most of chest from V down to top)
 * LOWER = small region below V wings (chest bottom near medial)
 *
 * V wing concave up via Q control y=360 (5 above straight midpoint 365).
 * "一點點凹向上" — slight upward bow on each wing.
 *
 * Each of UPPER + LOWER is 2 sub-paths (L pec + R pec) — no crossing
 * of sternum top notch or xiphoid bottom notch.
 *
 * PACKAGE chest L/R asymmetry inherent (medial top y=319 vs y=327);
 * paths follow each side's real silhouette. Visual symmetry within
 * PACKAGE constraints.
 */
/**
 * Round 14 chest fix (2026-05-23): user gave explicit 3 keypoints —
 * 切割線 = 左下－中上－右下 (∧ shape spanning entire chest).
 *
 * Strict ∧ design per user keypoints:
 *   - 中上 apex: (362, 320) sternum top center
 *   - 左下: (290, 425) chest L lower interior
 *   - 右下: (434, 425) chest R lower interior (strict mirror about x=362)
 *
 * Mirror sum = 290+434 = 724 ✓ symmetric.
 *
 * V wings concave up via Q control y=360 (12 above straight midpoint
 * y=372.5) — "一點點凹向上弧度".
 *
 * Chest fill structure:
 *   - LOWER = central triangle inside ∧ (apex top, base at y=425)
 *     covers sternum middle → "中間也塗到"
 *   - UPPER = chest area OUTSIDE the ∧ triangle (lateral upper + lateral
 *     lower regions around the triangle)
 *
 * Implementation: UPPER path has chest silhouette (CCW outer) + triangle
 * (CW inner) so nonzero fill rule makes triangle a HOLE in UPPER.
 * LOWER fills the same triangle (CW alone).
 *
 * Chest silhouette traced through sternum top notch + xiphoid bottom
 * notch (user said "中縫可以著色" — sternum strip ok to color).
 */
/**
 * Round 15 chest fix (2026-05-23): re-mapped user black ink keypoints to
 * SVG viewBox coordinates from comparing user image with reload screenshot.
 *
 * User's 2 black ink curves = 2 mirrored leaf/lens shapes, one per pec.
 * Each leaf goes from chest upper-outer diagonally to sternum mid-low.
 * Anatomically = clavicular head fiber direction (upper-outer → lower-medial).
 *
 * Mapping:
 *   - UPPER (clavicular) = 2 leaves
 *   - LOWER (sternal head main belly) = chest L+R minus 2 leaves
 *
 * Leaf vertices (strict mirror about x=362, sums all 724):
 *   L leaf: (280, 340) upper-outer → (356, 392) chest L medial bottom
 *   R leaf: (444, 340) upper-outer → (368, 392) chest R medial bottom
 *   Q controls: top curve (318, 350) / (406, 350); bottom curve
 *   (318, 385) / (406, 385) — gives leaf height ~17 units mid.
 *
 * Lens vertices verified INSIDE respective PACKAGE pec silhouette
 * (no extension past chest into sternum gap or body silhouette).
 *
 * Implementation: LOWER path includes chest L + chest R silhouettes (CW)
 * + 2 leaves reversed (CCW) → SVG nonzero fill rule cuts leaves as
 * HOLES in LOWER. UPPER path = same 2 leaves (forward) → fills the holes.
 *
 * Together UPPER + LOWER = entire chest L + chest R silhouette area,
 * with leaves visible as UPPER and rest as LOWER. Each path stays
 * strictly within chest silhouettes (no painting outside).
 */
/**
 * Round 16 chest fix (2026-05-23): user screenshot showed R leaf invisible
 * + L leaf too thin to read as leaf shape.
 *
 * Two bugs identified:
 *   1. R leaf coordinate-mirror gave SAME winding direction as chest R
 *      (CW in screen). SVG nonzero rule didn't make R leaf a HOLE in
 *      LOWER → LOWER fill covered UPPER R leaf. Fix: R leaf uses reversed
 *      curve order (top-curve-first) to force CCW direction.
 *   2. Leaf width at midpoint only 17 units — rendered as thin line, not
 *      visible as leaf. Fix: widen leaves to ~42 units width via Q control
 *      y offsets (bottom curve y=408, top curve y=324).
 *
 * Final leaf control points (all strict mirror about x=362, sums=724):
 *   L leaf (CCW screen): M 280 340 Q 347 408 (bottom curve via (347, 408))
 *     → 356 392 → Q 290 324 (top curve via (290, 324)) → 280 340 Z
 *   R leaf (CCW screen): M 444 340 Q 434 324 (top curve first) → 368 392
 *     → Q 377 408 (bottom curve) → 444 340 Z
 *
 * Q controls verified inside chest L/R silhouette → no painting outside.
 */
/**
 * Round 17 chest fix (2026-05-23): user clicked 4 切線 keypoints via
 * coord-picker tool, strict mirror about x=364:
 *   P2 (255, 379) L outer / P4 (354, 338) L inner
 *   P1 (473, 379) R outer / P3 (374, 339) R inner
 *
 * Snapped to PACKAGE chest L/R boundaries (avoid 超出胸):
 *   L 切線: (265, 379) → (352, 338)
 *   R 切線: (462, 379) → (378, 339)
 *
 * 切線 goes from chest lateral mid-low to chest medial upper, slight
 * concave-up curve (Q ctrl y=350, ~4 units above straight midpoint).
 *
 * Anatomical interpretation:
 *   UPPER (above 切線) = small region near chest top (clavicular head)
 *   LOWER (below 切線) = larger region (sternal head)
 *
 * Both regions use 2 sub-paths (L pec + R pec). LOWER includes chest
 * silhouettes + UPPER sub-paths (CCW direction creates holes via SVG
 * nonzero fill rule, since chest paths are CW).
 *
 * UPPER_L traversed as CCW: 切線 outer → 切線 inner → chest medial top
 * → top arc reversed → chest lateral top → lateral down → close.
 * UPPER_R follows real chest R silhouette (PACKAGE asymmetric).
 */
/**
 * Round 18 chest (2026-05-23): user traced left pec outline via
 * coord-picker, gave 28 keypoints (P1..P28) defining custom chest L
 * silhouette. Chest R mirrored about x=364 (user's centerline).
 *
 * User's L outline keypoints (CCW from top-medial):
 *   P1 (342, 321) → P2 (323, 317) → P3 (305, 317) → P4 (289, 321) →
 *   P5 (275, 327) → P6 (266, 335) → P7 (258, 350) → P8 (255, 362) →
 *   P9 (255, 374) → P10 (256, 385) → P11 (258, 395) → P12 (262, 406) →
 *   P13 (267, 416) → P14 (275, 424) → P15 (286, 430) → P16 (297, 433) →
 *   P17 (310, 434) → P18 (327, 432) → P19 (341, 426) → P20 (350, 418) →
 *   P21 (355, 412) → P22 (357, 400) → P23 (357, 388) → P24 (358, 376) →
 *   P25 (359, 363) → P26 (357, 352) → P27 (355, 341) → P28 (350, 330)
 *
 * 切線 (from round 17, snapped to outline):
 *   L: (255, 379) → (354, 338), Q control (304, 350) — concave up 4.25u
 *   R: (473, 379) → (374, 338), Q control (424, 350) — mirror about x=364
 *
 * UPPER (above 切線) covers P1..P9 + P28 + 切線 closure
 * LOWER (below 切線) covers 切線 + P27..P22..P10 closure
 *
 * Together UPPER + LOWER tile the user-defined chest area. No overlap,
 * no holes needed (each path fills its own region).
 */
/**
 * Round 19 chest (2026-05-24): user feedback on round 18:
 *   1. 對稱 — already mirror about x=364, PACKAGE body inherent asymmetry
 *   2. 切線公差沒切乾淨 — UPPER + LOWER 切線 endpoints + Q ctrl exact match
 *      avoid anti-alias gap
 *   3. 弧度加深 — Q ctrl y 350 → 343, curve mid y=350.25, 7.25u above
 *      straight midpoint y=357.5 (was 4.25u)
 *   4. 比例放大 — 28 outline points + 切線 endpoints all scaled × 1.05
 *      around chest center (307, 375)
 *
 * Scaled outline (28 points + 切線):
 *   L outer (252, 379), L inner (356, 336), Q ctrl (305, 343)
 *   R outer (476, 379), R inner (372, 336), Q ctrl (423, 343) — mirror x=364
 *
 * UPPER + LOWER share EXACT same 切線 coords + Q ctrl — anti-alias should
 * align (round 18's "公差沒切乾淨" was likely this).
 */
/**
 * Round 20 chest (2026-05-24): user feedback "兩條切線做成凹向下了，
 * 改成凹向上弧度 (像不對稱的葉子)".
 *
 * Round 19 had Q ctrl y=343 < straight midpoint y=357.5 → curve passed
 * ABOVE straight line at midpoint = ∩ shape (concave-DOWN), wrong.
 *
 * Round 20: changed Q (quadratic) to C (cubic Bezier) for asymmetric
 * leaf shape. Both control points have y > straight midpoint to bulge
 * curve BELOW straight line → ∪ shape (concave-UP).
 *
 * Asymmetric cubic:
 *   L 切線: M 252 379 → cp1 (270, 400) [near outer, deep bulge]
 *           → cp2 (335, 348) [near inner, shallow bulge] → 356 336
 *   R 切線: mirror about x=364 → cp1 (458, 400), cp2 (393, 348)
 *
 * Curve depth vs straight (asymmetric leaf, bulge偏 outer):
 *   t=0.3 (near outer): 12.75 units below straight ✓ deepest
 *   t=0.5 (midpoint):   12.0 units
 *   t=0.7 (near inner): 7.0 units below ✓ shallowest
 *
 * UPPER + LOWER share IDENTICAL 切線 cubic coords → no anti-alias gap.
 */
/** Front: upper chest — 2 sub-paths above 切線 (clavicular regions). */
export const PATH_UPPER_CHEST =
  'M252 379 L252 374 L252 361 L256 349 L264 333 L273 325 L288 318 L305 314 L324 314 L344 318 L352 328 L356 336 C335 348 270 400 252 379 Z M476 379 L476 374 L476 361 L472 349 L464 333 L455 325 L440 318 L423 314 L404 314 L384 318 L376 328 L372 336 C393 348 458 400 476 379 Z';

/** Front: lower chest — 2 sub-paths below 切線 (sternal regions). */
export const PATH_LOWER_CHEST =
  'M252 379 C270 400 335 348 356 336 L357 339 L360 351 L362 362 L361 376 L360 389 L360 401 L357 414 L352 420 L343 429 L328 435 L310 437 L297 436 L285 433 L273 426 L265 418 L260 408 L256 396 L253 386 L252 379 Z M476 379 C458 400 393 348 372 336 L371 339 L368 351 L366 362 L367 376 L368 389 L368 401 L371 414 L376 420 L385 429 L400 435 L418 437 L431 436 L443 433 L455 426 L463 418 L468 408 L472 396 L475 386 L476 379 Z';

/**
 * Bicep sub-division — partition the package's verbatim biceps slug path into
 * LATERAL (long head, outer) + MEDIAL (short head, inner) halves via
 * `<ClipPath>` so the combined fill exactly equals the underlying belly
 * silhouette (no gap, no overflow). Mirrors the DELTOID treatment above but
 * uses a DIAGONAL split line (not vertical) per user coord-picker keypoints,
 * matching the actual long/short head fiber direction.
 *
 * The two PACKAGE paths are byte-for-byte copies of the
 * `react-native-body-highlighter` package's `biceps` slug paths
 * (node_modules/.../bodyFront.js).
 *
 * Round 2 (2026-05-24, user coord-picker via bicep-coord-picker.html):
 *   L arm diagonal endpoints:
 *     top (214.5, 406.5) — chest-side upper
 *     bot (183.5, 492.5) — body-edge lower
 *   R arm diagonal endpoints (mirror about x=364, verified):
 *     top (513.5, 406.5)
 *     bot (544.5, 492.0)
 *   Slope |dx/dy| ≈ 0.36 — head fibers run from supraglenoid/coracoid
 *   tubercle (top, near shoulder centerline) outward toward elbow.
 *
 * Implementation: each "half" is a TRAPEZOID polygon extrapolated to
 * y=395..510 (covering bicep bbox y∈[406, 493] with buffer) and x extending
 * past bicep bbox so the ClipPath cleanly cuts the silhouette. The diagonal
 * edge coordinates are SHARED byte-for-byte between LATERAL + MEDIAL halves
 * so SVG anti-alias closes without gap (same trick as chest round 20 cubic).
 *
 *   L diagonal extrapolated: top (218.6, 395), bot (177.2, 510)
 *   R diagonal extrapolated: top (509.4, 395), bot (550.8, 510)
 *
 * Per-arm anatomy (chest centerline x≈362; lateral = "outer", away from body
 * centerline; medial = "inner", toward body centerline):
 *   FRONT_L (viewer's left, subject's right) :
 *     LATERAL (long head)  = polygon LEFT of diagonal (far from chest)
 *     MEDIAL (short head)  = polygon RIGHT of diagonal (near chest)
 *   FRONT_R (viewer's right, subject's left) :
 *     MEDIAL (short head)  = polygon LEFT of diagonal (near chest)
 *     LATERAL (long head)  = polygon RIGHT of diagonal (far from chest)
 */
export const PACKAGE_BICEP_L =
  'M189.52 492.51c-2.43.62-7.38.57-7.51-3.08-.56-16.01-.42-35.49 5.11-50.26 3.19-8.54 13.89-30.22 23.27-32.72 10.08-2.68 12.68 16.59 12.6 22.8-.22 15.98-7.51 34.79-15.05 48.71-4.29 7.94-9.95 12.38-18.42 14.55z';
export const PACKAGE_BICEP_R =
  'M526.69 486.31c-9.9-8.61-17.75-33.21-20.65-47.73-1.41-7.06-1.34-29.61 8.58-32.16 10.33-2.66 23.81 25.34 26.6 32.91q2.6 7.04 3.6 16.13 1.62 14.66 1.66 32.28c.03 11.04-16.45 1.48-19.79-1.43z';

/** L arm LATERAL half (long head / outer) — trapezoid west of diagonal. */
export const PATH_BICEP_L_LATERAL_HALF =
  'M150 395 L218.6 395 L177.2 510 L150 510 Z';
/** L arm MEDIAL half (short head / inner) — trapezoid east of diagonal. */
export const PATH_BICEP_L_MEDIAL_HALF =
  'M218.6 395 L250 395 L250 510 L177.2 510 Z';
/** R arm MEDIAL half (short head / inner) — trapezoid west of diagonal. */
export const PATH_BICEP_R_MEDIAL_HALF =
  'M480 395 L509.4 395 L550.8 510 L480 510 Z';
/** R arm LATERAL half (long head / outer) — trapezoid east of diagonal. */
export const PATH_BICEP_R_LATERAL_HALF =
  'M509.4 395 L580 395 L580 510 L550.8 510 Z';

/**
 * Deltoid sub-division — partition the package's verbatim deltoid slug path
 * into MEDIAL + LATERAL halves via `<ClipPath>` so the combined fill exactly
 * equals the underlying cap silhouette (no gaps, no overflow).
 *
 * The 4 path strings below are byte-for-byte copies of the
 * `react-native-body-highlighter` package's `deltoids` slug paths
 * (node_modules/.../bodyFront.js + bodyBack.js). The consumer wraps each in
 * `<Defs><ClipPath id="..."><Path d={...}/></ClipPath></Defs>` and then
 * renders two `<Rect>` elements (one per half) clipped to it — `Rect`
 * covers the full bounding box, the clip restricts paint to the cap shape.
 *
 * SPLIT_X constants are the horizontal midpoint of each path's bounding box
 * (parsed once offline and hard-coded here). They are tagged with the
 * anatomical fiber-direction interpretation:
 *   - Front view: anterior (front delt) on the chest-centerline side,
 *     lateral (mid delt) on the outer side.
 *   - Back view : posterior (rear delt) on the spine-centerline side,
 *     lateral (mid delt) on the outer side.
 *
 * Per-shoulder geometry (chest centerline x=362; spine centerline x=1086):
 *   FRONT_L (viewer's left, subject's right) : MEDIAL = right half (x ≥ split)
 *   FRONT_R (viewer's right, subject's left) : MEDIAL = left  half (x ≤ split)
 *   BACK_L  (viewer's left, subject's right) : MEDIAL = right half (x ≥ split)
 *   BACK_R  (viewer's right, subject's left) : MEDIAL = left  half (x ≤ split)
 */
export const PACKAGE_DELT_FRONT_L =
  'M274.06 311.69q3.94 2.77 4.33 8.14.04.48-.38.73c-9.98 5.88-24.35 7.45-28.82 19.75-2.31 6.36-.97 17.35-1.43 23.68q-.55 7.51-5.73 14.07-10.37 13.11-13.81 16.67c-3.41 3.53-6.81 1.76-10.69-.47-15.42-8.87-24.95-25.45-22.52-43.22 2.05-14.92 12.71-25.79 24.06-35.02 16.99-13.82 35.58-17.99 54.99-4.33z';
export const PACKAGE_DELT_FRONT_R =
  'M450.39 320.75q-.95-.52-.7-1.58c1.57-6.61 5.8-9.1 12.14-11.9 24.99-11.03 43.76 3.33 60.17 20.74 20.73 21.99 11.81 56.44-14.82 68.19-4.41 1.94-6.79-1.03-9.81-4.51-5.81-6.7-13.46-14.12-15.99-22.8-3.93-13.43 4.32-27.54-9.64-37.62q-8.22-5.93-17.99-9.08-1.84-.59-3.36-1.44z';
export const PACKAGE_DELT_BACK_L =
  'M980.66 319.58c.19.14.55.19.65.32a.8.8 0 01-.16 1.15c-6.78 4.75-15.26 9.77-20.03 15.58-6.41 7.78-8.76 16.96-9.44 27.04-.39 5.92-1.68 9.5-5.59 13.43-10.02 10.08-19.04 16.47-31.14 20.41q-.75.25-.75-.55.19-18.4-.09-36.3-.14-9.4 1.07-14.22c4.04-16.07 22.8-33.85 39.68-35.64 9.99-1.06 17.34 2.46 25.8 8.78z';
export const PACKAGE_DELT_BACK_R =
  'M1227.3 316.44c14.62 9.44 25.48 21.03 25.46 39.51q-.02 20.56-.01 41.37a.37.37 0 01-.51.35c-5.08-2.06-10.41-3.98-14.9-6.97-7.84-5.24-21.14-14.95-21.77-24.95-.69-10.75-2.81-20.85-9.76-29.25-4.68-5.65-12.96-10.58-19.6-15.26q-1.23-.87.01-1.71c4.6-3.13 9.91-6.78 15.25-7.98q13.58-3.03 25.83 4.89z';

/**
 * Horizontal midpoint of each deltoid bounding box. Used to position the
 * two split-rects per shoulder: one covers x ≤ SPLIT, the other x ≥ SPLIT,
 * both clipped to the package path → exact partition of the cap.
 *
 * Bounding boxes (computed once from the package paths, offline):
 *   FRONT_L: x ∈ [192.58, 278.43]  → mid 235.50
 *   FRONT_R: x ∈ [449.44, 542.73]  → mid 496.09
 *   BACK_L : x ∈ [913.97, 981.31]  → mid 947.64
 *   BACK_R : x ∈ [1184.98, 1252.78] → mid 1218.88
 */
// SPLIT_X shifted toward lateral edge so mid-delt occupies 1/3 of deltoid
// width (was 1/2). Mid-delt = lateral strip; medial side (front-delt on
// front view, rear-delt on back view) now gets 2/3.
//   Front L bbox 192.58..278.43 (w=85.85) → 1/3 = 28.6 → split @ 192.58+28.6 = 221.2
//   Front R bbox 449.44..542.73 (w=93.29) → 1/3 = 31.1 → split @ 542.73-31.1 = 511.6
//   Back  L bbox 913.97..981.31 (w=67.34) → 1/3 = 22.4 → split @ 913.97+22.4 = 936.4
//   Back  R bbox 1184.98..1252.78 (w=67.80) → 1/3 = 22.6 → split @ 1252.78-22.6 = 1230.2
export const SPLIT_X_FRONT_DELT_L = 221.2;
export const SPLIT_X_FRONT_DELT_R = 511.6;
export const SPLIT_X_BACK_DELT_L = 936.4;
export const SPLIT_X_BACK_DELT_R = 1230.2;

// ---------------------------------------------------------------------------
// Deltoid EXTENSION paths — drawn UNCLIPPED on top of the package's slug fills
// so the visual delt coverage is complete (the package's deltoid silhouette
// doesn't reach the acromion peak, and chest / upper-back / trapezius slugs
// mask the medial deltoid edge). Each path is a small fan / wedge that sits
// at the topmost paint layer — they cannot be masked by underlying slugs.
//
// Coordinates were derived from the package paths:
//   PACKAGE_DELT_FRONT_L bbox x ∈ [192.58, 278.43], y ∈ [312, 395]
//   PACKAGE_DELT_FRONT_R bbox x ∈ [449.44, 542.73], y ∈ [308, 393]
//   PACKAGE_DELT_BACK_L  bbox x ∈ [913.97, 981.31], y ∈ [312, 397]
//   PACKAGE_DELT_BACK_R  bbox x ∈ [1184.98, 1252.78], y ∈ [313, 398]
//   chest L front start  M272.91 422.84 (upper-medial pec edge ≈ x 270-300, y 320-360)
//   trapezius L back     bbox roughly x ∈ [1005, 1075], y ∈ [299, 475]
//   upper-back L start   bbox roughly x ∈ [957, 1075], y ∈ [325, 585]
// ---------------------------------------------------------------------------

/**
 * Mid-delt acromion peak extensions — REMOVED (set to empty path) after
 * user feedback they overflowed the body silhouette outline. The package's
 * deltoid contour already provides the shoulder cap; extending above it
 * pokes beyond the body boundary. Kept as empty exports so the consumer
 * render stays structurally stable without conditional branches.
 */
export const PATH_MID_DELT_PEAK_FRONT_L = '';
export const PATH_MID_DELT_PEAK_FRONT_R = '';
export const PATH_MID_DELT_PEAK_BACK_L = '';
export const PATH_MID_DELT_PEAK_BACK_R = '';

/**
 * Front-delt / rear-delt notch fills — "smooth the medial concavity"
 * variant 2026-05-23 evening.
 *
 * User clarification (round 4): "補缺口" means smooth the deltoid's OWN
 * medial concave curve (deltoid 自身內側內凹 curve), NOT extend past the
 * deltoid silhouette into chest/back.
 *
 * Analysis of PACKAGE_DELT_FRONT_L path (decoded relative cmds):
 *   - top apex (274, 312)
 *   - briefly pokes to medial bbox edge (278, 320)
 *   - sharp inward curve to (249, 340) — THIS is the visible concavity
 *   - gradually tapers to (247, 364) → (241, 378) → (228, 395) at bottom
 *
 * The "sharp inward curve" between (278, 320) and (249, 340) reads
 * visually as a notch — the medial edge of the deltoid suddenly recedes
 * by ~29 units in only 20 vertical units. The fill below smooths this
 * by drawing a gentler arc from (276, 318) down to (250, 360), tracing
 * a more gradual diagonal that fills the concave pocket without
 * extending past the deltoid bbox.
 *
 * IMPORTANT invariants:
 *   - fill x stays ≤ deltoid bbox medial edge (278 front-L, ≥449 front-R,
 *     ≤981 back-L, ≥1185 back-R) — NEVER extends into chest/back area
 *   - all 4 paths byte-for-byte mirror about chest centerline (x=362) or
 *     spine centerline (x=1086)
 *   - fill colour = front-delt rect colour (front view) / rear-delt rect
 *     colour (back view) — same colour as the medial half ClipPath rect,
 *     so overlap is invisible
 */
/**
 * Per user feedback (round 6, 2026-05-23): "異常，沒有填滿，請對稱左右肩，
 * 從上到下弧，不要出現鋸齒". Previous round-5 paths used 4 Q-segments with
 * control points that overshot the deltoid bbox medial edge (e.g. FRONT_L
 * had control point (279, 322) past bbox edge 278.43), causing the
 * unclipped fill to bleed into chest/back areas and producing visible
 * sawtooth artifacts.
 *
 * Redesign: each leaf is exactly TWO cubic Bezier curves (smooth single
 * sweep top→bottom→top), all control points strictly inside the deltoid
 * medial half (between SPLIT_X and bbox medial edge, with 2-3 unit buffer).
 * L↔R control points are byte-for-byte mirrors about chest centerline
 * (x=362, sum=724) / spine centerline (x=1086, sum=2172).
 *
 * Shape: asymmetric leaf — outer-edge cubic has wider amplitude than
 * inner-edge cubic, so the midrib leans toward the medial (bbox edge)
 * side. Reads as a stylized leaf, not a symmetric ellipse.
 *
 * Coverage:
 *   - FRONT leaves: x range ~[225, 273] (covers 84% of medial half width 57)
 *   - BACK leaves: x range ~[943, 978] (covers 78% of medial half width 45)
 *
 * Invariants:
 *   - all control points x ∈ [SPLIT_X + buffer, bbox_medial_edge - buffer]
 *   - L↔R mirror: FRONT cp x_L + x_R = 724; BACK cp x_L + x_R = 2172
 *   - Two cubic Beziers share endpoints → single smooth contour, no folds
 *   - Fill stays inside deltoid → no bleed into chest/back, no overlap with
 *     mid-delt rect (no colour collision, no sawtooth)
 */
/**
 * Round 7 (2026-05-23): "都有鋸齒，弧請連結肌肉端點". Previous round-6 leaf
 * had anchor at deltoid bbox CENTER (e.g. FRONT_L (250, 315)), leaving
 * a ~25 unit gap between fill anchor and deltoid medial edge → visible
 * seam read as sawtooth.
 *
 * Fix: anchor pulled out to deltoid medial bbox edge (2-4 units inside).
 * top anchor sits on the deltoid's upper-medial vertex (close to PACKAGE
 * path start); bottom anchor sits on the lower-medial vertex (close to
 * PACKAGE medial curve's lowest point in medial half). Now fill visually
 * "connects" the muscle endpoints — no gap, no seam.
 *
 * Strict L↔R mirror (FRONT sums=724 about chest centerline x=362; BACK
 * sums=2172 about spine centerline x=1086). Two-cubic-Bezier leaf with
 * asymmetric midrib leaning medial. All control points stay in medial
 * half: outer cp ≤ bbox medial edge - 2; inner cp ≥ SPLIT_X + 4.
 *
 * Verified each path point in own bbox medial half:
 *   FRONT_L medial half [221.2, 278.43]: all pts in [225, 274] ✓
 *   FRONT_R medial half [449.44, 511.6]: all pts in [450, 499] ✓
 *   BACK_L medial half [936.4, 981.31]: all pts in [943, 980] ✓
 *   BACK_R medial half [1184.98, 1230.2]: all pts in [1192, 1229] ✓
 */
/**
 * Round 8 (2026-05-23): "前束沒對稱，右邊太寬，有空隙，下方鋸齒；左邊上方鋸齒".
 *
 * Diagnosis: PACKAGE deltoid_L and _R are NOT strict mirrors about chest
 * centerline x=362 — L medial edge x=278.43, R medial edge x=449.44,
 * sum=727.87 ≠ 724. Round-7 strict-x-mirror anchors (sum=724) left a
 * 1-2 unit gap between fill anchor and deltoid medial edge on at least
 * one side, visible as sawtooth.
 *
 * Fix: abandon strict x mirror; each side's anchor pinned to its OWN
 * PACKAGE medial edge. To preserve visual symmetry, each leaf is sized
 * to span exactly 46 units (top→bottom medial vertical) and uses the
 * same control-point offset pattern from its respective edge.
 *
 * FRONT_L medial vertical: top (278, 320) → bottom (232, 390), span 46
 * FRONT_R medial vertical: top (450, 320) → bottom (496, 390), span 46
 *   (sum top=728, bottom=728; not 724 but matches each side's own edge)
 *
 * BACK_L medial vertical: top (980, 320) → bottom (945, 390), span 35
 * BACK_R medial vertical: top (1192, 320) → bottom (1227, 390), span 35
 *   (BACK deltoid bbox is narrower, so leaves proportionally smaller)
 *
 * All control points stay 2-4 units inside own bbox medial edge / SPLIT_X.
 */
export const PATH_FRONT_DELT_CHEST_FILL_L =
  'M278 320 C276 350 245 385 232 390 C225 360 250 325 278 320 Z';
export const PATH_FRONT_DELT_CHEST_FILL_R =
  'M450 320 C452 350 483 385 496 390 C503 360 478 325 450 320 Z';
/**
 * Round 9 BACK fix (2026-05-23): "後束一樣沒對稱，左邊有空隙下方鋸齒，
 * 右邊上下都有鋸齒". Root cause: previous BACK anchors used estimates
 * not from real PACKAGE_DELT_BACK_L/R medial edge analysis.
 *
 * Decoded PACKAGE_DELT_BACK_L medial side: top vertex (980, 320) →
 * curve thru (961, 337) → (951, 363) → bottom vertex (946, 377).
 * Previous bottom anchor (945, 390) was 13 units below real medial
 * edge → big gap → sawtooth.
 *
 * Decoded PACKAGE_DELT_BACK_R medial side: top vertex (1186, 320) →
 * (1205, 336) → (1215, 365) → (1237, 391). Note (1237, 391) is past
 * SPLIT_X_BACK_R=1230.2 → in lateral half! So R bottom anchor must
 * stop at where medial curve crosses SPLIT: ~ (1228, 380).
 *
 * New design:
 *   BACK_L: top (980, 320), bottom (942, 380), leaf span 60
 *   BACK_R: top (1186, 320), bottom (1228, 380), leaf span 60
 * Control points sit along each side's real medial curve so the fill
 * outer edge traces PACKAGE silhouette and inner edge stays just inside
 * SPLIT_X with 2-4 unit buffer.
 *
 * Verified each path point stays in own medial half:
 *   BACK_L medial half [936.4, 981.31]: pts in [938, 980] ✓
 *   BACK_R medial half [1184.98, 1230.2]: pts in [1186, 1228] ✓
 */
export const PATH_REAR_DELT_BACK_FILL_L =
  'M980 320 C979 340 953 372 942 380 C938 350 960 325 980 320 Z';
export const PATH_REAR_DELT_BACK_FILL_R =
  'M1186 320 C1187 340 1219 372 1228 380 C1228 350 1208 325 1186 320 Z';

// ---------------------------------------------------------------------------
// Back-side overlay paths
// ---------------------------------------------------------------------------

/**
 * Back: upper gluteal — top crescent of glutes (both sides).
 *
 * Round 2 outline (2026-05-24): user-traced 51 keypoints via glute
 * coord-picker HTML tool tracing the COMBINED L glute silhouette:
 *   P1 (978, 674)        — L outer cut endpoint
 *   P2 (1081, 685)       — L inner cut endpoint
 *   P3 (1081, 675)       — L inner-top (just above cut)
 *   P4-P14 (down to 1018, 619) — inner edge going up-left to top
 *   P15 (1010, 619)      — top corner
 *   P16-P23 (to 980, 665) — outer edge going down-left from top to just
 *                            above cut
 *   P24 (977, 680)       — outer just below cut (LOWER starts)
 *   P25-P40 (to 1050, 778) — outer/bottom edge of LOWER
 *   P41-P51 (to 1081, 694) — bottom/inner edge going up to just below cut
 *
 * Cut-line cubic (round 3, 2026-05-24): user feedback "接近外側凹向上，
 * 接近內側凹向下" — S-shape, NOT single ∪. Cps placed off-straight in
 * opposite directions to produce inflection point near t=0.5.
 *   L→R from (978,674) to (1081,685): C 1008 706 1054 654 1081 685
 *     cp1 (1008, 706): ~29 units below straight at x=1008 → ∪ near outer
 *     cp2 (1054, 654): ~28 units above straight at x=1054 → ∩ near inner
 *     Curve amplitude ~7 units below straight at t=0.3, ~7 above at t=0.7
 *   Mirror axis x=1083.5 (P1+P4 = P2+P3 = 2167 sums verified)
 *
 * UPPER decomposition for L sub-path (CCW traversal):
 *   M P3 → Catmull-Rom Bezier chain through P4..P23 → L P1 (outer cut)
 *   → cubic L→R → P2 (inner cut) → Z (closes back to P3)
 *
 * Round 4 smoothing (2026-05-24): user feedback "外圍有點鋸齒給一點點平滑"
 * — outline polyline (straight L lines between 22 keypoints) replaced
 * with Catmull-Rom cubic Bezier chain (tension=1/6 standard). Curve
 * still passes through every user keypoint exactly, but tangents are
 * continuous across vertices (no sharp corners). Boundary endpoints
 * (P3 and P23) use mirror-phantom for smooth tangent direction.
 *
 * R sub-path: same shape, mirrored about x=1083.5 (every x → 2167-x),
 * traversed in same order (CCW on R side = CW visually, but fill-rule
 * nonzero treats both consistently).
 */
export const PATH_UPPER_GLUTE =
  'M1081 675 C1080.3 672 1079.8 668.8 1079 666 C1078.2 663.2 1077.2 660.7 1076 658 C1074.8 655.3 1073.5 652.5 1072 650 C1070.5 647.5 1068.7 645.2 1067 643 C1065.3 640.8 1064.2 638.7 1062 637 C1059.8 635.3 1056.2 634.2 1054 633 C1051.8 631.8 1050.7 631.3 1049 630 C1047.3 628.7 1046.3 626.3 1044 625 C1041.7 623.7 1038 622.8 1035 622 C1032 621.2 1028.8 620.5 1026 620 C1023.2 619.5 1020.7 619.2 1018 619 C1015.3 618.8 1012.5 618.7 1010 619 C1007.5 619.3 1005 620 1003 621 C1001 622 999.5 623.5 998 625 C996.5 626.5 995.3 628.2 994 630 C992.7 631.8 991.3 633.8 990 636 C988.7 638.2 987.2 640.7 986 643 C984.8 645.3 983.8 647.5 983 650 C982.2 652.5 981.5 655.5 981 658 C980.5 660.5 980.3 662.7 980 665 L978 674 C1008 706 1054 654 1081 685 Z M1086 675 C1086.7 672 1087.2 668.8 1088 666 C1088.8 663.2 1089.8 660.7 1091 658 C1092.2 655.3 1093.5 652.5 1095 650 C1096.5 647.5 1098.3 645.2 1100 643 C1101.7 640.8 1102.8 638.7 1105 637 C1107.2 635.3 1110.8 634.2 1113 633 C1115.2 631.8 1116.3 631.3 1118 630 C1119.7 628.7 1120.7 626.3 1123 625 C1125.3 623.7 1129 622.8 1132 622 C1135 621.2 1138.2 620.5 1141 620 C1143.8 619.5 1146.3 619.2 1149 619 C1151.7 618.8 1154.5 618.7 1157 619 C1159.5 619.3 1162 620 1164 621 C1166 622 1167.5 623.5 1169 625 C1170.5 626.5 1171.7 628.2 1173 630 C1174.3 631.8 1175.7 633.8 1177 636 C1178.3 638.2 1179.8 640.7 1181 643 C1182.2 645.3 1183.2 647.5 1184 650 C1184.8 652.5 1185.5 655.5 1186 658 C1186.5 660.5 1186.7 662.7 1187 665 L1189 674 C1159 706 1113 654 1086 685 Z';

/**
 * Back: lower gluteal — bottom half of glutes (both sides).
 *
 * Top edge shares the same cut-line cubic as PATH_UPPER_GLUTE (paths
 * touch but don't overlap). See PATH_UPPER_GLUTE comment for the 51-
 * keypoint trace decomposition.
 *
 * LOWER decomposition for L sub-path (CCW traversal):
 *   M P24 → Catmull-Rom Bezier chain through P25..P51 → L P2 (inner cut)
 *   → cubic R→L → Z (closes back to P24)
 *
 * Round 4 smoothing: same Catmull-Rom treatment as UPPER (see comment
 * above) — 28-point polyline → 27 cubic Bezier segments passing through
 * every keypoint with continuous tangents.
 *
 * R sub-path: same shape, mirrored about x=1083.5.
 *
 * Cubic R→L cps for L (round 3 S-shape, reverse of UPPER L→R):
 *   C 1054 654 1008 706 978 674
 *     cp1 (1054, 654): ∩ near inner (= near t=0 = right end of L LOWER cut)
 *     cp2 (1008, 706): ∪ near outer (= near t=1 = left end of L LOWER cut)
 * Cubic L→R cps for R (mirror + reverse): C 1113 654 1159 706 1189 674
 */
export const PATH_LOWER_GLUTE =
  'M977 680 C977 682 977 683.8 977 686 C977 688.2 977.2 690.8 977 693 C976.8 695.2 976 696.7 976 699 C976 701.3 976.5 704.5 977 707 C977.5 709.5 978.3 711.5 979 714 C979.7 716.5 980.2 719.5 981 722 C981.8 724.5 982.7 726.3 984 729 C985.3 731.7 987.5 735.3 989 738 C990.5 740.7 991.3 742.7 993 745 C994.7 747.3 997.2 749.7 999 752 C1000.8 754.3 1002 756.8 1004 759 C1006 761.2 1008.5 763.2 1011 765 C1013.5 766.8 1016 768.8 1019 770 C1022 771.2 1025.3 771 1029 772 C1032.7 773 1037.5 775 1041 776 C1044.5 777 1046.8 777.8 1050 778 C1053.2 778.2 1057.3 777.7 1060 777 C1062.7 776.3 1064 775.7 1066 774 C1068 772.3 1071 769.5 1072 767 C1073 764.5 1072 761.7 1072 759 C1072 756.3 1071.8 753.8 1072 751 C1072.2 748.2 1072.5 745 1073 742 C1073.5 739 1074.2 736.3 1075 733 C1075.8 729.7 1077.3 725.7 1078 722 C1078.7 718.3 1078.5 714.5 1079 711 C1079.5 707.5 1080.7 703.8 1081 701 C1081.3 698.2 1081 696.3 1081 694 L1081 685 C1054 654 1008 706 978 674 Z M1190 680 C1190 682 1190 683.8 1190 686 C1190 688.2 1189.8 690.8 1190 693 C1190.2 695.2 1191 696.7 1191 699 C1191 701.3 1190.5 704.5 1190 707 C1189.5 709.5 1188.7 711.5 1188 714 C1187.3 716.5 1186.8 719.5 1186 722 C1185.2 724.5 1184.3 726.3 1183 729 C1181.7 731.7 1179.5 735.3 1178 738 C1176.5 740.7 1175.7 742.7 1174 745 C1172.3 747.3 1169.8 749.7 1168 752 C1166.2 754.3 1165 756.8 1163 759 C1161 761.2 1158.5 763.2 1156 765 C1153.5 766.8 1151 768.8 1148 770 C1145 771.2 1141.7 771 1138 772 C1134.3 773 1129.5 775 1126 776 C1122.5 777 1120.2 777.8 1117 778 C1113.8 778.2 1109.7 777.7 1107 777 C1104.3 776.3 1103 775.7 1101 774 C1099 772.3 1096 769.5 1095 767 C1094 764.5 1095 761.7 1095 759 C1095 756.3 1095.2 753.8 1095 751 C1094.8 748.2 1094.5 745 1094 742 C1093.5 739 1092.8 736.3 1092 733 C1091.2 729.7 1089.7 725.7 1089 722 C1088.3 718.3 1088.5 714.5 1088 711 C1087.5 707.5 1086.3 703.8 1086 701 C1085.7 698.2 1086 696.3 1086 694 L1086 685 C1113 654 1159 706 1189 674 Z';

// ---------------------------------------------------------------------------
// Head outline — package's `border` prop draws the BODY outline path only
// (starts at M 309.48 168.91 below the head); the `head` + `hair` slugs have
// no outline of their own (package `defaultStrokeWidth=0`). Without an
// explicit stroke layer the head silhouette reads as a flat gray blob with
// no boundary line, looking unfinished compared to the bordered torso.
//
// Fix: paint the package's verbatim `head` + `hair` slug paths once more as
// a transparent stroke-only layer on top of the package fills. Each is
// byte-for-byte copied from node_modules/.../bodyFront.js + bodyBack.js,
// concatenated (z then M starts a new sub-path) so a single Path covers
// both slugs. Consumer renders with:
//   fill="none" stroke={COLOR_OUTLINE} strokeWidth={2}
//   vectorEffect="non-scaling-stroke"  // match body border line weight
// ---------------------------------------------------------------------------

export const PATH_HEAD_OUTLINE_FRONT =
  'M 418.91 167.68 c 3.92 -1.77 6.58 0.47 7.06 4.32 c 1.48 11.93 -4.92 26.67 -11.75 36.45 c -2.21 3.17 -3.86 0.17 -4.74 -1.76 a 0.38 0.38 0 0 0 -0.73 0.16 c 0.02 8.31 1.01 17.01 -3.36 24.53 c -0.167 0.293 -4.39 4.62 -10.799 9.508 c -23.591 18.112 -41.591 16.112 -61.446 -0.797 c -4.736 -3.649 -5.925 -5.041 -8.805 -7.621 c -5.66 -5.07 -5.28 -17.38 -4.47 -24.92 c 0.05 -0.51 -0.468 -0.892 -0.933 -0.687 a 0.653 0.653 0 0 0 -0.357 0.397 c -0.57 1.69 -2.24 4.05 -4.07 1.48 c -6.2 -8.71 -16.02 -28.53 -11.19 -38.98 c 1.68 -3.627 3.733 -3.91 6.16 -0.85 a 182.853 182.853 0 0 1 3.78 23.29 a 1.02 1.02 0 0 0 1.56 0.77 c 2.79 -1.75 2.61 -18.93 2.63 -24.22 c 0.02 -4.53 1.12 -8.94 3.8 -13.1 c 4.36 -6.76 4.86 -11.51 5.57 -19.82 c 0.47 -5.53 4.34 -8.12 9.77 -8.21 c 6.39 -0.12 12.69 -0.07 19 -0.93 c 4.02 -0.55 7.4 -1.43 11.53 -0.75 c 6.7 1.1 13.44 1.64 20.22 1.62 c 4.607 -0.013 7.523 0.227 8.75 0.72 c 5.96 2.37 5.56 9.73 6.11 15.22 c 0.44 4.34 2.097 8.447 4.97 12.32 c 6.57 8.88 2.19 25.6 5.64 36.36 a 1.14 1.14 0 0 0 2.22 -0.23 c 0.887 -8.36 2.18 -16.45 3.88 -24.27 z M418.91 167.68q-2.55 11.73-3.88 24.27a1.14 1.14 0 01-2.22.23c-3.45-10.76.93-27.48-5.64-36.36q-4.31-5.81-4.97-12.32c-.55-5.49-.15-12.85-6.11-15.22q-1.84-.74-8.75-.72-10.17.03-20.22-1.62c-4.13-.68-7.51.2-11.53.75-6.31.86-12.61.81-19 .93-5.43.09-9.3 2.68-9.77 8.21-.71 8.31-1.21 13.06-5.57 19.82-2.68 4.16-3.78 8.57-3.8 13.1-.02 5.29.16 22.47-2.63 24.22a1.02 1.02 0 01-1.56-.77q-1.14-11.78-3.78-23.29-1.48-6.99-1.9-9.7c-2.49-15.94.13-40.13 13.53-51.15 9.39-7.72 28.53-11.63 40.37-11.51 4.2.05 8.74-.3 12.68.22 13.82 1.82 31.67 5.83 39.42 18.92 9.01 15.21 9.88 35.14 5.33 51.99z';

export const PATH_HEAD_OUTLINE_BACK =
  'M1028.14 166.45c1.03 5.06 1.36 9.61 6.41 11.53 13.06 4.95 16.74 15.51 23.52 27.48 1.387 2.447 3.863 3.623 7.43 3.53a910.025 910.025 0 0136.94-.25c6.23.09 9.27-7.55 11.48-12.3 4.31-9.27 10.37-15.83 20.28-18.94.333-.1.603-.287.81-.56 1.92-2.58 3.043-5.43 3.37-8.55l2.31-1.51a.977.977 0 01.99-.08c11.92 5.42-3.35 35.31-8.21 42.45-.761 1.11-2.423 1.028-3.06-.15l-1.26-2.32c-.133-.253-.32-.297-.56-.13-.34.24-.48.61-.42 1.11.86 7.64.75 16.87-2.96 23.31-.173.3.839.041-3.7 4.71-3.34 3.436-74.18 3.78-75.48-1.38a1.465 1.465 0 00-.55-.82c-4.15-2.97-6.07-7.95-6.16-12.39-.03-1.68.18-14.28-.53-14.63-.207-.1-.33-.037-.37.19-.3 1.553-1.183 2.597-2.65 3.13a.951.951 0 01-1.07-.32c-7.29-9.56-12.32-22.18-12.97-33.54-.34-6.04 1.797-9.23 6.41-9.57zm29.95 61.71c.173 14.187 18.967 14.703 19.1-1.37.03-4.05-.38-6.54-4.68-7.3-4.2-.75-11.87-1.47-13.85 2.91-.413.92-.603 2.84-.57 5.76zm31.71-3.35c.36 19.647 18.59 14.82 18.87 5.94.13-3.9 1.32-9.43-2.88-10.79-4.25-1.38-16.12-2.54-15.99 4.85z M1138.38 168.39q-.49 4.68-3.37 8.55-.31.41-.81.56c-9.91 3.11-15.97 9.67-20.28 18.94-2.21 4.75-5.25 12.39-11.48 12.3q-18.46-.25-36.94.25-5.35.14-7.43-3.53c-6.78-11.97-10.46-22.53-23.52-27.48-5.05-1.92-5.38-6.47-6.41-11.53q-6.64-26.16 4.43-48.88c8.13-16.7 34.61-21.41 51.58-21.04 4.89.11 9.69-.11 14.42.85 18.79 3.8 33.17 8.5 39.34 28.66q6.38 20.88.47 42.35z';

// ---------------------------------------------------------------------------
// Abs 6-pack overlay — Pattern C (unclipped extension stroke).
//
// The package's `abs` slug renders the rectus abdominis as a single
// hourglass-shaped fill. Real anatomy = vertical linea alba (median line)
// + 3 horizontal tendinous intersections that visually carve the muscle
// into 6-8 visible "pack" segments. Adding sub-M_* split would require
// dictionary changes (M_ABS_UPPER/MIDDLE/LOWER + LEFT/RIGHT × N) that
// ripple through tagging UI; instead we layer thin DARKER STROKES on top
// of the existing fill — purely decorative anatomical detail that reads
// as "6-pack" when abs is highlighted, without changing semantics.
//
// Coordinates derived from sampling the package abs sub-paths
// (node_modules/.../bodyFront.js, `slug: 'abs'`). The package itself
// already groups abs into 4 horizontal segments per side via separate
// sub-paths — the gaps between those sub-paths are the natural divider
// positions for tendinous intersections.
//
// Sub-path bboxes (y-extent):
//   LEFT 2  / RIGHT 0 : y[428, 498]  — top pair (above belly button)
//   LEFT 0  / RIGHT 1 : y[~500, 533] — second pair
//   LEFT 1  / RIGHT 2 : y[536, 578]  — third pair
//   LEFT 3  / RIGHT 3 : y[583, 715]  — long bottom (lower abs / pyramidalis)
//
// Linea alba x: sampled L_max ~360, R_min ~368 at multiple y levels →
//   midline x = 364 (matches chest centerline used elsewhere in this file).
//
// Tendinous intersection lengths: hourglass-shaped abs is widest near y=530
// (~106u) and narrows at top (y=428: ~37u) / bottom (y=712: ~35u). Each
// divider line spans ~88-96u (inset 6u on each side from full bbox at that
// y) so it stays well inside the slug fill — no overflow onto obliques or
// body silhouette.
//
// All paths are STROKE-ONLY (fill="none"). Consumer renders with:
//   stroke={COLOR_ABS_DETAIL} strokeWidth={1} vectorEffect="non-scaling-stroke"
// `vectorEffect` essential at BODY_SCALE=0.5 — without it, viewBox stroke
// width 1 renders sub-pixel at small scale and disappears (same lesson as
// head outline mini-pattern, commit 0734b6f).
//
// Visibility gating: consumer renders these paths ONLY when M_ABS is
// highlighted, so the lines never show on an empty body. The stroke color
// is a darker variant of whatever fill color M_ABS uses (primary orange /
// secondary blue / quintile shade) — but for simplicity we use a single
// neutral dark grey that reads against any fill colour.
// ---------------------------------------------------------------------------

/** Linea alba — vertical center line bisecting the abs from top to bottom. */
export const PATH_ABS_LINEA_ALBA = 'M364 432 L364 708';

/** Top tendinous intersection — between first pair and second pair. */
export const PATH_ABS_TENDINOUS_TOP = 'M320 500 L408 500';

/** Middle tendinous intersection — between second pair and third pair. */
export const PATH_ABS_TENDINOUS_MIDDLE = 'M316 534 L412 534';

/** Bottom tendinous intersection — between third pair and lower long section. */
export const PATH_ABS_TENDINOUS_BOTTOM = 'M320 581 L408 581';

/** Stroke colour for abs detail lines — dark grey, reads against any role fill. */
export const COLOR_ABS_DETAIL = '#4B5563';

// ---------------------------------------------------------------------------
// Sibling groups — each entry shares a package slug (overlay split)
// ---------------------------------------------------------------------------

export const CHEST_SIBS: readonly string[] = [M_UPPER_CHEST, M_LOWER_CHEST];
export const BICEPS_SIBS: readonly string[] = [M_BICEP_LONG, M_BICEP_SHORT];
export const DELT_SIBS: readonly string[] = [M_FRONT_DELT, M_MID_DELT, M_REAR_DELT];
export const GLUTE_SIBS: readonly string[] = [M_UPPER_GLUTE, M_LOWER_GLUTE];

// ---------------------------------------------------------------------------
// Shared body-base colour token — used by sibling-aware overlay fill so the
// split line stays visible against a sibling-filled region. Kept here so
// both consumers reference the same hex.
// ---------------------------------------------------------------------------

export const COLOR_BODY_BASE = '#FAFAFA';
