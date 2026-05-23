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

/** Front: upper chest — top ~40% of chest area (clavicular head, both pecs). */
export const PATH_UPPER_CHEST =
  'M260 330 Q300 318 332 322 L362 326 Q392 320 432 326 Q466 332 478 348 L478 378 Q448 372 432 370 L362 374 Q330 372 300 376 L260 380 Z';

/** Front: lower chest — bottom ~60% of chest area (sternal head, with V-notch). */
export const PATH_LOWER_CHEST =
  'M260 380 Q300 376 332 378 L362 376 Q392 378 432 376 Q466 378 478 378 L478 410 Q458 438 422 446 Q392 450 362 442 L362 442 Q332 450 302 446 Q272 442 260 414 Z';

/** Front: bicep long head (outer/lateral) left arm. */
export const PATH_BICEP_LONG_L =
  'M182 410 Q176 460 184 495 L200 495 Q205 460 208 415 Z';
/** Front: bicep short head (inner/medial) left arm. */
export const PATH_BICEP_SHORT_L =
  'M200 415 Q205 460 200 495 L222 495 Q228 465 224 420 Z';

/** Front: bicep short head (inner/medial) right arm. */
export const PATH_BICEP_SHORT_R =
  'M502 420 Q500 465 506 492 L526 492 Q532 460 528 415 Z';
/** Front: bicep long head (outer/lateral) right arm. */
export const PATH_BICEP_LONG_R =
  'M528 415 Q532 460 526 492 L548 488 Q548 460 540 410 Z';

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
 * Mid-delt extension up to the acromion peak. A small triangular cap that
 * extends from the TOP of the package's deltoid silhouette (y≈312) UP to
 * approximately y≈293, sitting on the lateral half (mid-delt side) of each
 * shoulder. Bridges the gap between the package's deltoid contour and the
 * true bony acromion landmark. Reference IMG_1370.PNG (中束 highlight).
 */
export const PATH_MID_DELT_PEAK_FRONT_L =
  'M204 314 Q207 300 215 295 Q220 293 222 296 L222 314 Q217 314 210 316 Z';
export const PATH_MID_DELT_PEAK_FRONT_R =
  'M510 314 L510 296 Q513 293 518 295 Q525 300 528 314 Q522 316 517 314 Z';
export const PATH_MID_DELT_PEAK_BACK_L =
  'M918 316 Q922 300 930 295 Q936 293 938 297 L938 316 Q930 316 924 316 Z';
export const PATH_MID_DELT_PEAK_BACK_R =
  'M1228 316 L1228 297 Q1230 293 1237 295 Q1245 300 1249 316 Q1240 316 1234 316 Z';

/**
 * Front-delt extension filling the chest-notch — a small fan that extends
 * from the medial edge of the front-delt (around the lower-medial corner
 * where the package's deltoid path swings under the pec) DOWNWARD and
 * slightly OVER the package's chest region. Sits on top of the chest fill
 * so the front-delt visually wraps onto the upper-medial pec strip.
 * Reference IMG_1371.PNG (前束 highlight).
 */
export const PATH_FRONT_DELT_CHEST_FILL_L =
  'M268 320 Q278 318 285 326 Q292 340 290 358 Q284 372 274 378 Q264 376 260 366 Q258 348 262 332 Z';
export const PATH_FRONT_DELT_CHEST_FILL_R =
  'M464 326 Q472 318 482 320 Q488 332 490 348 Q492 366 488 376 Q478 378 470 372 Q460 366 458 350 Q458 336 464 326 Z';

/**
 * Rear-delt extension filling the back-notch — a small fan that extends
 * from the medial edge of the rear-delt INWARD over the package's
 * upper-back / trapezius region. Sits on top so the rear-delt visually
 * wraps onto the upper-medial scapular strip. Reference IMG_1369.PNG
 * (後束 highlight).
 */
export const PATH_REAR_DELT_BACK_FILL_L =
  'M984 322 Q996 320 1006 328 Q1014 342 1014 358 Q1010 372 1000 378 Q988 376 982 366 Q978 350 980 334 Z';
export const PATH_REAR_DELT_BACK_FILL_R =
  'M1162 328 Q1172 320 1184 322 Q1188 334 1190 350 Q1188 366 1180 376 Q1170 378 1160 372 Q1154 358 1156 342 Z';

// ---------------------------------------------------------------------------
// Back-side overlay paths
// ---------------------------------------------------------------------------

/** Back: upper gluteal — top crescent of glutes (both sides). */
export const PATH_UPPER_GLUTE =
  'M978 632 Q1010 622 1042 626 L1062 628 Q1080 622 1118 628 Q1156 622 1184 632 Q1186 660 1180 685 L1156 692 Q1112 686 1082 690 Q1052 686 1010 692 L984 685 Q978 660 978 632 Z';

/** Back: lower gluteal — bottom half of glutes (both sides). */
export const PATH_LOWER_GLUTE =
  'M984 685 Q1010 696 1042 692 L1062 694 Q1080 696 1118 694 Q1156 696 1180 685 L1186 720 Q1184 752 1170 778 Q1140 790 1110 776 L1080 770 Q1050 778 1020 780 Q990 786 974 770 Q970 740 980 712 Z';

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
