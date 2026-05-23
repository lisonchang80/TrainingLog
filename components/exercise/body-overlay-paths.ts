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
 * Path shapes are reasonable polygon approximations of each half — see the
 * anatomy reference IMG_1359..IMG_1377 PNGs for the visual targets. They
 * don't trace the package paths exactly but occupy roughly the right region
 * so a viewer can tell which sub-head is highlighted.
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
 * Front: anterior (front) deltoid — medial fan from clavicle to humerus.
 * Package outline (FRONT LEFT = subject's right): y=320 x∈[213,278], y=340
 * x∈[200,250], y=360 x∈[195,248], y=378 x∈[200,242], y=395 x∈[217,228].
 * Anterior fibers run from clavicular origin (top-medial) → humeral
 * insertion (bottom). This wedge occupies the MEDIAL upper half of the cap
 * (higher x on left shoulder = closer to chest centerline x=362).
 *
 * Left side (subject's right shoulder, viewer's left).
 */
export const PATH_FRONT_DELT_L =
  'M244 322 Q238 340 236 358 Q236 370 240 372 Q248 366 252 354 Q256 338 260 324 Z';
/** Front: anterior (front) deltoid — right side (mirror at x=362). */
export const PATH_FRONT_DELT_R =
  'M470 324 Q478 342 482 358 Q486 368 490 370 Q496 366 494 354 Q488 340 484 322 Z';

/**
 * Front: middle (lateral) deltoid — outer strip of the cap.
 * Acromial origin (top-lateral) → humeral insertion. Stays in the LATERAL
 * half of the cap (lower x on left shoulder = further from centerline).
 * Strip kept ≥5 units inside the package's lateral curve at every y.
 *
 * Left side (subject's right shoulder, viewer's left).
 */
export const PATH_MID_DELT_FRONT_L =
  'M222 324 Q212 348 216 368 Q222 374 228 370 Q230 350 230 326 Z';
export const PATH_MID_DELT_FRONT_R =
  'M498 326 Q498 350 500 370 Q506 374 512 368 Q516 348 506 324 Z';

// ---------------------------------------------------------------------------
// Back-side overlay paths
// ---------------------------------------------------------------------------

/**
 * Back: rear (posterior) deltoid — fan from scapular spine to humerus.
 * MEDIAL portion of the deltoid cap (toward spine centerline x=1086).
 * Package outline (BACK LEFT = subject's right): cap top at y=312-320 spans
 * only x=955-980 (narrow apex); widens going down: y=340 x∈[917,960],
 * y=360 x∈[914,951], y=380 x∈[914,935], y=395 x∈[914,915].
 * Rear delt fans from upper-medial origin → tapers down-and-out toward
 * humeral insertion. Stays in the MEDIAL half (higher x) of the cap.
 *
 * Back left = subject's right shoulder (viewer's left on back view).
 */
export const PATH_REAR_DELT_L =
  'M960 324 Q950 340 942 358 Q938 370 942 374 Q948 370 950 360 Q958 342 968 324 Z';
/** Back right = subject's left shoulder (viewer's right on back view). */
export const PATH_REAR_DELT_R =
  'M1200 324 Q1210 342 1220 360 Q1224 370 1226 374 Q1230 370 1224 358 Q1216 340 1208 324 Z';

/**
 * Back: middle (lateral) deltoid — LATERAL strip on outer cap, back view.
 * Acromial origin → humeral insertion. Stays in LATERAL half of the cap.
 * Package lateral edge (BACK LEFT): vertical at x≈914 from y=346 to y=395,
 * curving to (955, 311) at top. Strip kept ≥4 units inside.
 */
export const PATH_MID_DELT_BACK_L =
  'M934 334 Q920 358 922 380 Q928 386 932 384 Q934 360 938 336 Z';
export const PATH_MID_DELT_BACK_R =
  'M1234 336 Q1238 360 1240 384 Q1244 386 1248 380 Q1248 358 1238 334 Z';

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
