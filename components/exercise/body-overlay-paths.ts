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
 * Front: anterior (front) deltoid — medial half closer to chest.
 * Left side (subject's right shoulder on screen).
 */
export const PATH_FRONT_DELT_L =
  'M242 318 Q250 350 252 380 Q262 395 274 400 L290 395 Q295 360 290 325 Q272 310 252 312 Z';
/** Front: anterior (front) deltoid — right side. */
export const PATH_FRONT_DELT_R =
  'M448 320 Q446 360 450 395 L468 400 Q480 395 488 380 Q490 350 488 318 Q470 310 452 314 Z';

/**
 * Front: middle (lateral) deltoid — lateral cap of shoulder.
 * Visible on both front and back. Front view: outer half.
 */
export const PATH_MID_DELT_FRONT_L =
  'M200 330 Q198 370 210 395 Q224 400 240 395 Q238 360 240 320 Q220 320 208 322 Z';
export const PATH_MID_DELT_FRONT_R =
  'M488 320 Q488 360 488 395 Q502 400 514 395 Q526 370 524 330 Q514 322 500 320 Z';

// ---------------------------------------------------------------------------
// Back-side overlay paths
// ---------------------------------------------------------------------------

/** Back: rear (posterior) deltoid — medial half closer to back. */
export const PATH_REAR_DELT_L =
  'M962 326 Q960 360 966 392 L985 395 Q998 392 1004 380 Q1004 348 998 322 Q982 318 970 320 Z';
export const PATH_REAR_DELT_R =
  'M1188 322 Q1180 350 1180 380 Q1188 392 1200 395 L1220 392 Q1226 360 1226 326 Q1208 318 1192 320 Z';

/** Back: middle (lateral) deltoid — outer cap on back view. */
export const PATH_MID_DELT_BACK_L =
  'M928 332 Q920 372 930 398 Q940 405 956 400 Q958 365 962 326 Q942 322 930 326 Z';
export const PATH_MID_DELT_BACK_R =
  'M1226 326 Q1226 365 1228 398 Q1240 405 1254 400 Q1262 372 1256 332 Q1242 322 1230 324 Z';

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
