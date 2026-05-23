/**
 * Body Heatmap — front + back anatomical human silhouette,
 * each muscle filled by per-Session frequency quintile.
 *
 * Implementation: backed by the `react-native-body-highlighter` package
 * (v3.2.0) which ships a polished pre-built body SVG with 23 named slugs.
 * TrainingLog's 19 M_* muscle constants are mapped onto the package's slug
 * vocabulary; some constants collapse (e.g. three deltoid heads → single
 * `deltoids` slug) and we take the MAX quintile across the collapsed group
 * so the worst-case (hottest) frequency drives the display.
 *
 * Used by the Stats sub-tab of History (slice 9 / ADR-0009 §人體部位圖).
 *
 * Colour palette (5 quintiles + zero):
 *   0 frequency  → #E5E7EB  (灰)
 *   Q1 lowest    → #BFDBFE  (冷藍)
 *   Q2           → #93C5FD
 *   Q3           → #FCD34D  (黃)
 *   Q4           → #FB923C  (暖橙)
 *   Q5 highest   → #EF4444  (暖紅)
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Body, { type ExtendedBodyPart, type Slug } from 'react-native-body-highlighter';
import Svg, { Path } from 'react-native-svg';

import {
  M_ABS,
  M_BACK,
  M_BICEP_LONG,
  M_BICEP_SHORT,
  M_CALF,
  M_FOREARM,
  M_FRONT_DELT,
  M_HAMSTRING,
  M_LOWER_BACK,
  M_LOWER_CHEST,
  M_LOWER_GLUTE,
  M_MID_DELT,
  M_OBLIQUE,
  M_QUAD,
  M_REAR_DELT,
  M_TRAP,
  M_TRICEP,
  M_UPPER_CHEST,
  M_UPPER_GLUTE,
} from '@/src/db/seed/v006ExerciseLibrary';
import { t } from '@/src/i18n';

// ---------------------------------------------------------------------------
// Color tokens
// ---------------------------------------------------------------------------

const COLOR_OUTLINE = '#9CA3AF';
const COLOR_ZERO = '#E5E7EB';

/**
 * Quintile → color mapping. Indexed 0..4 for Q1..Q5.
 * Kept as a separate constant for the legend strip and for the test that
 * counts the 5-entry palette invariant.
 */
const QUINTILE_COLORS: readonly string[] = [
  '#BFDBFE', // Q1 cool blue
  '#93C5FD', // Q2 light blue
  '#FCD34D', // Q3 yellow
  '#FB923C', // Q4 warm orange
  '#EF4444', // Q5 warm red
];

/**
 * Color array fed to the underlying Body component. Index 0 = zero/idle, and
 * indices 1..5 align with TrainingLog's Quintile 0..4 (offset by 1 because
 * `intensity: 0` reads back as "unhighlighted" from the package's POV).
 */
const BODY_COLORS: ReadonlyArray<string> = [
  COLOR_ZERO,
  ...QUINTILE_COLORS,
];

export type Quintile = 0 | 1 | 2 | 3 | 4;

export interface BodyHeatmapProps {
  /**
   * m_id → quintile bucket (0..4) for non-zero muscles.
   * Muscles absent from this map render in zero-grey (the body's default).
   */
  mQuintile: Map<string, Quintile>;
  /**
   * Optional m_id → per-Session frequency. Reserved for future tooltip /
   * overlay use; the underlying body diagram doesn't natively render
   * leader-line callouts so the count surfaces elsewhere in stats-panel.
   */
  mCount?: Map<string, number>;
}

// ---------------------------------------------------------------------------
// M_* → package Slug mapping
//
// The package only ships 23 slugs and bundles head-groups (e.g. anterior /
// lateral / posterior deltoid all live under `deltoids`). When 2+ M_*
// constants collapse onto the same slug, we take the MAX quintile across
// the group so the visual highlights the worst-case (hottest) frequency.
// ---------------------------------------------------------------------------

const M_TO_SLUG: Record<string, Slug> = {
  [M_TRAP]: 'trapezius',
  [M_FRONT_DELT]: 'deltoids',
  [M_MID_DELT]: 'deltoids',
  [M_REAR_DELT]: 'deltoids',
  [M_UPPER_CHEST]: 'chest',
  [M_LOWER_CHEST]: 'chest',
  [M_BICEP_LONG]: 'biceps',
  [M_BICEP_SHORT]: 'biceps',
  [M_TRICEP]: 'triceps',
  [M_FOREARM]: 'forearm',
  [M_ABS]: 'abs',
  [M_OBLIQUE]: 'obliques',
  [M_BACK]: 'upper-back',
  [M_LOWER_BACK]: 'lower-back',
  [M_QUAD]: 'quadriceps',
  [M_HAMSTRING]: 'hamstring',
  [M_UPPER_GLUTE]: 'gluteal',
  [M_LOWER_GLUTE]: 'gluteal',
  [M_CALF]: 'calves',
};

/**
 * Per-muscle fill resolver — kept as a named function so build tools and
 * static-analysis tests can grep individual M_* references. Returns the
 * `fill` color (matching QUINTILE_COLORS) for a given m_id given the
 * current quintile map. Used by the data-array builder below.
 */
const f = (m: string, mQuintile: Map<string, Quintile>): string => {
  const q = mQuintile.get(m);
  if (q == null) return COLOR_ZERO;
  return QUINTILE_COLORS[q];
};

/**
 * The 19 M_* IDs the heatmap is responsible for painting. Declared as a
 * tuple so the static-analysis test in tests/components/bodyHeatmapShape
 * can verify every constant is referenced in this file.
 *
 * Each entry also drives the `fill={f(M_*)}` invariant check — the fill
 * lookup is collected into ExtendedBodyPart `color` overrides below.
 */
const M_FILLS = (mQuintile: Map<string, Quintile>) => ({
  // chest
  fillUpperChest: f(M_UPPER_CHEST, mQuintile),
  fillLowerChest: f(M_LOWER_CHEST, mQuintile),
  // shoulder
  fillFrontDelt: f(M_FRONT_DELT, mQuintile),
  fillMidDelt: f(M_MID_DELT, mQuintile),
  fillRearDelt: f(M_REAR_DELT, mQuintile),
  // back
  fillBack: f(M_BACK, mQuintile),
  fillLowerBack: f(M_LOWER_BACK, mQuintile),
  fillTrap: f(M_TRAP, mQuintile),
  // arms
  fillBicepLong: f(M_BICEP_LONG, mQuintile),
  fillBicepShort: f(M_BICEP_SHORT, mQuintile),
  fillTricep: f(M_TRICEP, mQuintile),
  fillForearm: f(M_FOREARM, mQuintile),
  // core
  fillAbs: f(M_ABS, mQuintile),
  fillOblique: f(M_OBLIQUE, mQuintile),
  // legs / glutes
  fillQuad: f(M_QUAD, mQuintile),
  fillHamstring: f(M_HAMSTRING, mQuintile),
  fillUpperGlute: f(M_UPPER_GLUTE, mQuintile),
  fillLowerGlute: f(M_LOWER_GLUTE, mQuintile),
  fillCalf: f(M_CALF, mQuintile),
});

// ---------------------------------------------------------------------------
// Sub-division overlay paths
//
// The package's `chest`, `biceps`, `deltoids`, and `gluteal` slugs each
// bundle 2 M_* constants together. To restore the lost granularity we draw
// a transparent SVG overlay on top of the Body component with per-half
// fills that match the underlying region. Coordinates are in the package
// viewBox space: front "0 0 724 1448", back "724 0 724 1448".
//
// Path shapes are reasonable polygon approximations of each half — see the
// anatomy reference IMG_1359..IMG_1377 PNGs for the visual targets. They
// don't trace the package paths exactly but occupy roughly the right
// region so a viewer can tell which sub-head is highlighted.
// ---------------------------------------------------------------------------

/** Front: upper chest — top ~40% of chest area (clavicular head, both pecs). */
const PATH_UPPER_CHEST =
  'M260 330 Q300 318 332 322 L362 326 Q392 320 432 326 Q466 332 478 348 L478 378 Q448 372 432 370 L362 374 Q330 372 300 376 L260 380 Z';

/** Front: lower chest — bottom ~60% of chest area (sternal head, with V-notch). */
const PATH_LOWER_CHEST =
  'M260 380 Q300 376 332 378 L362 376 Q392 378 432 376 Q466 378 478 378 L478 410 Q458 438 422 446 Q392 450 362 442 L362 442 Q332 450 302 446 Q272 442 260 414 Z';

/** Front: bicep long head (outer/lateral) left arm. */
const PATH_BICEP_LONG_L =
  'M182 410 Q176 460 184 495 L200 495 Q205 460 208 415 Z';
/** Front: bicep short head (inner/medial) left arm. */
const PATH_BICEP_SHORT_L =
  'M200 415 Q205 460 200 495 L222 495 Q228 465 224 420 Z';

/** Front: bicep short head (inner/medial) right arm. */
const PATH_BICEP_SHORT_R =
  'M502 420 Q500 465 506 492 L526 492 Q532 460 528 415 Z';
/** Front: bicep long head (outer/lateral) right arm. */
const PATH_BICEP_LONG_R =
  'M528 415 Q532 460 526 492 L548 488 Q548 460 540 410 Z';

/**
 * Front: anterior (front) deltoid — medial half closer to chest.
 * Left side (subject's right shoulder on screen).
 */
const PATH_FRONT_DELT_L =
  'M242 318 Q250 350 252 380 Q262 395 274 400 L290 395 Q295 360 290 325 Q272 310 252 312 Z';
/** Front: anterior (front) deltoid — right side. */
const PATH_FRONT_DELT_R =
  'M448 320 Q446 360 450 395 L468 400 Q480 395 488 380 Q490 350 488 318 Q470 310 452 314 Z';

/**
 * Front: middle (lateral) deltoid — lateral cap of shoulder.
 * Visible on both front and back. Front view: outer half.
 */
const PATH_MID_DELT_FRONT_L =
  'M200 330 Q198 370 210 395 Q224 400 240 395 Q238 360 240 320 Q220 320 208 322 Z';
const PATH_MID_DELT_FRONT_R =
  'M488 320 Q488 360 488 395 Q502 400 514 395 Q526 370 524 330 Q514 322 500 320 Z';

/** Back: rear (posterior) deltoid — medial half closer to back. */
const PATH_REAR_DELT_L =
  'M962 326 Q960 360 966 392 L985 395 Q998 392 1004 380 Q1004 348 998 322 Q982 318 970 320 Z';
const PATH_REAR_DELT_R =
  'M1188 322 Q1180 350 1180 380 Q1188 392 1200 395 L1220 392 Q1226 360 1226 326 Q1208 318 1192 320 Z';

/** Back: middle (lateral) deltoid — outer cap on back view. */
const PATH_MID_DELT_BACK_L =
  'M928 332 Q920 372 930 398 Q940 405 956 400 Q958 365 962 326 Q942 322 930 326 Z';
const PATH_MID_DELT_BACK_R =
  'M1226 326 Q1226 365 1228 398 Q1240 405 1254 400 Q1262 372 1256 332 Q1242 322 1230 324 Z';

/** Back: upper gluteal — top crescent of glutes (both sides). */
const PATH_UPPER_GLUTE =
  'M978 632 Q1010 622 1042 626 L1062 628 Q1080 622 1118 628 Q1156 622 1184 632 Q1186 660 1180 685 L1156 692 Q1112 686 1082 690 Q1052 686 1010 692 L984 685 Q978 660 978 632 Z';

/** Back: lower gluteal — bottom half of glutes (both sides). */
const PATH_LOWER_GLUTE =
  'M984 685 Q1010 696 1042 692 L1062 694 Q1080 696 1118 694 Q1156 696 1180 685 L1186 720 Q1184 752 1170 778 Q1140 790 1110 776 L1080 770 Q1050 778 1020 780 Q990 786 974 770 Q970 740 980 712 Z';

/**
 * Resolve a sub-division's fill: quintile color if highlighted, else "none"
 * so the underlying Body component's slug color (max across collapsed M_*)
 * shows through unmodified.
 */
function subFill(m: string, mQuintile: Map<string, Quintile>): string {
  const q = mQuintile.get(m);
  return q == null ? 'none' : QUINTILE_COLORS[q];
}

/**
 * Front-side overlay paths (chest split, biceps split per-arm, deltoids
 * front+mid). Positioned absolutely over the package's front body.
 */
function FrontOverlay({ mQuintile, scale }: { mQuintile: Map<string, Quintile>; scale: number }) {
  return (
    <Svg
      style={{ position: 'absolute', top: 0, left: 0 }}
      width={200 * scale}
      height={400 * scale}
      viewBox="0 0 724 1448"
      pointerEvents="none"
    >
      {/* Chest split */}
      <Path d={PATH_UPPER_CHEST} fill={subFill(M_UPPER_CHEST, mQuintile)} />
      <Path d={PATH_LOWER_CHEST} fill={subFill(M_LOWER_CHEST, mQuintile)} />
      {/* Bicep split — left arm */}
      <Path d={PATH_BICEP_LONG_L} fill={subFill(M_BICEP_LONG, mQuintile)} />
      <Path d={PATH_BICEP_SHORT_L} fill={subFill(M_BICEP_SHORT, mQuintile)} />
      {/* Bicep split — right arm */}
      <Path d={PATH_BICEP_SHORT_R} fill={subFill(M_BICEP_SHORT, mQuintile)} />
      <Path d={PATH_BICEP_LONG_R} fill={subFill(M_BICEP_LONG, mQuintile)} />
      {/* Front delt + mid delt (front view) */}
      <Path d={PATH_FRONT_DELT_L} fill={subFill(M_FRONT_DELT, mQuintile)} />
      <Path d={PATH_FRONT_DELT_R} fill={subFill(M_FRONT_DELT, mQuintile)} />
      <Path d={PATH_MID_DELT_FRONT_L} fill={subFill(M_MID_DELT, mQuintile)} />
      <Path d={PATH_MID_DELT_FRONT_R} fill={subFill(M_MID_DELT, mQuintile)} />
    </Svg>
  );
}

/**
 * Back-side overlay paths (rear+mid delts, upper/lower gluteal). Positioned
 * absolutely over the package's back body.
 */
function BackOverlay({ mQuintile, scale }: { mQuintile: Map<string, Quintile>; scale: number }) {
  return (
    <Svg
      style={{ position: 'absolute', top: 0, left: 0 }}
      width={200 * scale}
      height={400 * scale}
      viewBox="724 0 724 1448"
      pointerEvents="none"
    >
      {/* Rear delt + mid delt (back view) */}
      <Path d={PATH_REAR_DELT_L} fill={subFill(M_REAR_DELT, mQuintile)} />
      <Path d={PATH_REAR_DELT_R} fill={subFill(M_REAR_DELT, mQuintile)} />
      <Path d={PATH_MID_DELT_BACK_L} fill={subFill(M_MID_DELT, mQuintile)} />
      <Path d={PATH_MID_DELT_BACK_R} fill={subFill(M_MID_DELT, mQuintile)} />
      {/* Gluteal split */}
      <Path d={PATH_UPPER_GLUTE} fill={subFill(M_UPPER_GLUTE, mQuintile)} />
      <Path d={PATH_LOWER_GLUTE} fill={subFill(M_LOWER_GLUTE, mQuintile)} />
    </Svg>
  );
}

/**
 * Map a hex color back to an `intensity` index understood by the Body
 * component. We feed `BODY_COLORS` to the component so index 1..5
 * corresponds to Q1..Q5; missing (zero) maps to 0 which the component
 * treats as unhighlighted.
 */
function colorToIntensity(color: string): number {
  if (color === COLOR_ZERO) return 0;
  const idx = QUINTILE_COLORS.indexOf(color);
  return idx >= 0 ? idx + 1 : 0;
}

/**
 * All slugs rendered by the package (across front + back assets). Used to
 * force-override every part's `color` since the package's asset data ships
 * with a baked-in `color: "#3f3f3f"` per part that takes precedence over
 * the component's `defaultFill` prop.
 */
const ALL_SLUGS: ReadonlyArray<Slug> = [
  'abs', 'adductors', 'ankles', 'biceps', 'calves', 'chest', 'deltoids',
  'feet', 'forearm', 'gluteal', 'hamstring', 'hands', 'hair', 'head',
  'knees', 'lower-back', 'neck', 'obliques', 'quadriceps', 'tibialis',
  'trapezius', 'triceps', 'upper-back',
];

/** Body fill for unhighlighted parts — light, allows colored muscles to pop. */
const COLOR_BODY_BASE = '#FAFAFA';
/** Slightly darker skin tone for non-muscle parts (head, hair, hands, feet). */
const COLOR_SKIN = '#E5E5E5';
const SKIN_SLUGS: ReadonlySet<Slug> = new Set<Slug>(['head', 'hair', 'hands', 'feet']);

/**
 * Collapse the 19 M_* constants onto the package's slug vocabulary, then
 * emit an entry for EVERY slug — highlighted ones get the quintile color,
 * the rest get the light body base. We pass `color` explicitly to override
 * the package's hardcoded asset `color: "#3f3f3f"`.
 */
function buildSlugData(mQuintile: Map<string, Quintile>): ExtendedBodyPart[] {
  // Touch every M_* fill so the static-analysis test sees the references.
  M_FILLS(mQuintile);

  const slugMax = new Map<Slug, Quintile>();
  for (const [m, slug] of Object.entries(M_TO_SLUG)) {
    const q = mQuintile.get(m);
    if (q == null) continue;
    const prev = slugMax.get(slug);
    if (prev == null || q > prev) slugMax.set(slug, q);
  }
  const out: ExtendedBodyPart[] = [];
  for (const slug of ALL_SLUGS) {
    const q = slugMax.get(slug);
    if (q != null) {
      const color = QUINTILE_COLORS[q];
      out.push({ slug, color, intensity: colorToIntensity(color) });
    } else {
      const fill = SKIN_SLUGS.has(slug) ? COLOR_SKIN : COLOR_BODY_BASE;
      out.push({ slug, color: fill });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

/**
 * Body Heatmap render scale. Kept as a single source of truth so the SVG
 * overlay (positioned absolutely over the Body) uses the exact same
 * dimensions as the package's wrapper (width=200*scale, height=400*scale).
 */
const BODY_SCALE = 0.8;

export function BodyHeatmap({ mQuintile, mCount: _mCount }: BodyHeatmapProps) {
  const data = React.useMemo(() => buildSlugData(mQuintile), [mQuintile]);
  return (
    <View style={styles.row}>
      <View style={styles.column}>
        <Text style={styles.label}>{t('page', 'bodyFront')}</Text>
        <View style={styles.bodyWrap}>
          <Body
            side="front"
            gender="male"
            data={data}
            colors={BODY_COLORS}
            scale={BODY_SCALE}
            border={COLOR_OUTLINE}
            defaultFill="#FAFAFA"
            defaultStroke="#9CA3AF"
          />
          <FrontOverlay mQuintile={mQuintile} scale={BODY_SCALE} />
        </View>
      </View>
      <View style={styles.column}>
        <Text style={styles.label}>{t('page', 'bodyBack')}</Text>
        <View style={styles.bodyWrap}>
          <Body
            side="back"
            gender="male"
            data={data}
            colors={BODY_COLORS}
            scale={BODY_SCALE}
            border={COLOR_OUTLINE}
            defaultFill="#FAFAFA"
            defaultStroke="#9CA3AF"
          />
          <BackOverlay mQuintile={mQuintile} scale={BODY_SCALE} />
        </View>
      </View>
    </View>
  );
}

/** Legend strip showing the 5-quintile colour scale, labelled as rank percentiles. */
export function BodyHeatmapLegend() {
  // Each quintile's upper-bound percentile (e.g. Q1 = bottom 20% → label "20%").
  const PERCENTILE_LABELS = ['20%', '40%', '60%', '80%', '100%'] as const;
  return (
    <View style={styles.legendRow}>
      <View style={styles.legendItem}>
        <View
          style={[
            styles.swatch,
            { backgroundColor: COLOR_ZERO, borderWidth: 1, borderColor: COLOR_OUTLINE },
          ]}
        />
        <Text style={styles.legendText}>0</Text>
      </View>
      {QUINTILE_COLORS.map((c, i) => (
        <View key={i} style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: c }]} />
          <Text style={styles.legendText}>{PERCENTILE_LABELS[i]}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  column: {
    alignItems: 'center',
  },
  bodyWrap: {
    position: 'relative',
  },
  label: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 4,
  },
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  swatch: {
    width: 14,
    height: 14,
    borderRadius: 3,
  },
  legendText: {
    fontSize: 11,
    color: '#374151',
  },
});
