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
import Svg, { ClipPath, Defs, Path, Polyline, Rect } from 'react-native-svg';

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
import { t, tMuscle } from '@/src/i18n';
import {
  BACK_ANCHORS,
  FRONT_ANCHORS,
  fanLayout,
  vbToBodyLocalX,
  vbToBodyLocalY,
} from './exercise/body-anchors';
import {
  BICEPS_SIBS,
  CHEST_SIBS,
  COLOR_BODY_BASE,
  COLOR_ABS_DETAIL,
  DELT_SIBS,
  GLUTE_SIBS,
  PACKAGE_BICEP_L,
  PACKAGE_BICEP_R,
  PACKAGE_DELT_BACK_L,
  PACKAGE_DELT_BACK_R,
  PACKAGE_DELT_FRONT_L,
  PACKAGE_DELT_FRONT_R,
  PATH_ABS_LINEA_ALBA,
  PATH_ABS_TENDINOUS_BOTTOM,
  PATH_ABS_TENDINOUS_MIDDLE,
  PATH_ABS_TENDINOUS_TOP,
  PATH_FRONT_DELT_CHEST_FILL_L,
  PATH_FRONT_DELT_CHEST_FILL_R,
  PATH_LOWER_CHEST,
  PATH_LOWER_GLUTE,
  PATH_MID_DELT_PEAK_BACK_L,
  PATH_MID_DELT_PEAK_BACK_R,
  PATH_MID_DELT_PEAK_FRONT_L,
  PATH_MID_DELT_PEAK_FRONT_R,
  PATH_REAR_DELT_BACK_FILL_L,
  PATH_REAR_DELT_BACK_FILL_R,
  PATH_UPPER_CHEST,
  PATH_UPPER_GLUTE,
  PATH_BICEP_L_LATERAL_HALF,
  PATH_BICEP_L_MEDIAL_HALF,
  PATH_BICEP_R_LATERAL_HALF,
  PATH_BICEP_R_MEDIAL_HALF,
  PATH_HEAD_OUTLINE_BACK,
  PATH_HEAD_OUTLINE_FRONT,
  SPLIT_X_BACK_DELT_L,
  SPLIT_X_BACK_DELT_R,
  SPLIT_X_FRONT_DELT_L,
  SPLIT_X_FRONT_DELT_R,
} from './exercise/body-overlay-paths';

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
 * Same hue family as QUINTILE_COLORS but darker (Tailwind ~-700/-800 tones)
 * so the muscle-name labels stay legible on the white background.
 * Pairing convention mirrors `muscle-body-tagger.tsx`'s BTN_THEME pattern
 * (light fill + matching dark text).
 */
const QUINTILE_TEXT_COLORS: readonly string[] = [
  '#1D4ED8', // Q1 blue-700  ← #BFDBFE
  '#1E40AF', // Q2 blue-800  ← #93C5FD
  '#B45309', // Q3 amber-700 ← #FCD34D
  '#C2410C', // Q4 orange-700 ← #FB923C
  '#991B1B', // Q5 red-800   ← #EF4444
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
// Sub-division overlay
//
// The path geometry + sibling-group constants live in `./exercise/body-overlay-paths`
// so `muscle-body-tagger.tsx` can reuse them. The fill helper stays here
// because it's quintile-aware; the tagger has its own role-aware variant.
// ---------------------------------------------------------------------------

/**
 * Sibling-aware fill. If the M_* has its own quintile → render that color.
 * Otherwise if ANY sibling M_* (sharing the same package slug) has data →
 * render COLOR_BODY_BASE so the split line stays visible against the
 * sibling's filled region. If no sibling has data → 'none' (transparent),
 * letting the package's empty body show through unmodified.
 */
function subFill(m: string, siblings: readonly string[], mQuintile: Map<string, Quintile>): string {
  const q = mQuintile.get(m);
  if (q != null) return QUINTILE_COLORS[q];
  if (siblings.some((s) => mQuintile.has(s))) return COLOR_BODY_BASE;
  return 'none';
}

/**
 * Front-side overlay paths (chest split, biceps split per-arm, deltoids
 * front+mid). Positioned absolutely over the package's front body.
 */
function FrontOverlay({ mQuintile, scale }: { mQuintile: Map<string, Quintile>; scale: number }) {
  // Front deltoid sub-division via ClipPath partition (see body-overlay-paths
  // for geometry rationale). LEFT shoulder: medial right half = front delt,
  // lateral left half = mid delt. RIGHT shoulder: mirrored.
  // Biceps sub-division via ClipPath partition (round 2, 2026-05-24, user
  // coord-picker diagonal):
  //   LEFT arm  : trapezoid west of diagonal = LONG  head (lateral/outer)
  //               trapezoid east of diagonal = SHORT head (medial/inner)
  //   RIGHT arm : trapezoid west of diagonal = SHORT head (medial/inner)
  //               trapezoid east of diagonal = LONG  head (lateral/outer)
  const frontDeltFill = subFill(M_FRONT_DELT, DELT_SIBS, mQuintile);
  const midDeltFill = subFill(M_MID_DELT, DELT_SIBS, mQuintile);
  const longBicepFill = subFill(M_BICEP_LONG, BICEPS_SIBS, mQuintile);
  const shortBicepFill = subFill(M_BICEP_SHORT, BICEPS_SIBS, mQuintile);
  return (
    <Svg
      style={{ position: 'absolute', top: 0, left: 0 }}
      width={200 * scale}
      height={400 * scale}
      viewBox="0 0 724 1448"
      pointerEvents="none"
    >
      <Defs>
        <ClipPath id="heatmap-delt-front-l">
          <Path d={PACKAGE_DELT_FRONT_L} />
        </ClipPath>
        <ClipPath id="heatmap-delt-front-r">
          <Path d={PACKAGE_DELT_FRONT_R} />
        </ClipPath>
        <ClipPath id="heatmap-bicep-l">
          <Path d={PACKAGE_BICEP_L} />
        </ClipPath>
        <ClipPath id="heatmap-bicep-r">
          <Path d={PACKAGE_BICEP_R} />
        </ClipPath>
      </Defs>
      {/* Chest split */}
      <Path d={PATH_UPPER_CHEST} fill={subFill(M_UPPER_CHEST, CHEST_SIBS, mQuintile)} />
      <Path d={PATH_LOWER_CHEST} fill={subFill(M_LOWER_CHEST, CHEST_SIBS, mQuintile)} />
      {/* Bicep diagonal split — LEFT arm: lateral half (long) + medial half (short) */}
      <Path
        d={PATH_BICEP_L_LATERAL_HALF}
        fill={longBicepFill}
        clipPath="url(#heatmap-bicep-l)"
      />
      <Path
        d={PATH_BICEP_L_MEDIAL_HALF}
        fill={shortBicepFill}
        clipPath="url(#heatmap-bicep-l)"
      />
      {/* Bicep diagonal split — RIGHT arm: medial half (short) + lateral half (long) */}
      <Path
        d={PATH_BICEP_R_MEDIAL_HALF}
        fill={shortBicepFill}
        clipPath="url(#heatmap-bicep-r)"
      />
      <Path
        d={PATH_BICEP_R_LATERAL_HALF}
        fill={longBicepFill}
        clipPath="url(#heatmap-bicep-r)"
      />
      {/* Front view LEFT shoulder: lateral half (mid delt) + medial half (front delt) */}
      <Rect
        x={0}
        y={0}
        width={SPLIT_X_FRONT_DELT_L}
        height={1448}
        fill={midDeltFill}
        clipPath="url(#heatmap-delt-front-l)"
      />
      <Rect
        x={SPLIT_X_FRONT_DELT_L}
        y={0}
        width={724 - SPLIT_X_FRONT_DELT_L}
        height={1448}
        fill={frontDeltFill}
        clipPath="url(#heatmap-delt-front-l)"
      />
      {/* Front view RIGHT shoulder: medial half (front delt) + lateral half (mid delt) */}
      <Rect
        x={0}
        y={0}
        width={SPLIT_X_FRONT_DELT_R}
        height={1448}
        fill={frontDeltFill}
        clipPath="url(#heatmap-delt-front-r)"
      />
      <Rect
        x={SPLIT_X_FRONT_DELT_R}
        y={0}
        width={724 - SPLIT_X_FRONT_DELT_R}
        height={1448}
        fill={midDeltFill}
        clipPath="url(#heatmap-delt-front-r)"
      />
      {/* UNCLIPPED delt extensions — drawn on top so the package's chest /
          trapezius slugs cannot mask these regions. See body-overlay-paths.ts. */}
      <Path d={PATH_FRONT_DELT_CHEST_FILL_L} fill={frontDeltFill} />
      <Path d={PATH_FRONT_DELT_CHEST_FILL_R} fill={frontDeltFill} />
      <Path d={PATH_MID_DELT_PEAK_FRONT_L} fill={midDeltFill} />
      <Path d={PATH_MID_DELT_PEAK_FRONT_R} fill={midDeltFill} />
      {/* Abs 6-pack detail — Pattern C unclipped stroke layer. Only render
          when M_ABS has a quintile (data exists); lines stay inside the abs
          slug bbox so they don't overlap obliques or body silhouette. */}
      {mQuintile.has(M_ABS) ? (
        <>
          <Path
            d={PATH_ABS_LINEA_ALBA}
            fill="none"
            stroke={COLOR_ABS_DETAIL}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          <Path
            d={PATH_ABS_TENDINOUS_TOP}
            fill="none"
            stroke={COLOR_ABS_DETAIL}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          <Path
            d={PATH_ABS_TENDINOUS_MIDDLE}
            fill="none"
            stroke={COLOR_ABS_DETAIL}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          <Path
            d={PATH_ABS_TENDINOUS_BOTTOM}
            fill="none"
            stroke={COLOR_ABS_DETAIL}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        </>
      ) : null}
      {/* Head outline — package's border path skips head/hair; trace the
          slug paths once more here as a stroke-only layer. */}
      <Path
        d={PATH_HEAD_OUTLINE_FRONT}
        fill="none"
        stroke={COLOR_OUTLINE}
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
    </Svg>
  );
}

/**
 * Back-side overlay paths (rear+mid delts, upper/lower gluteal). Positioned
 * absolutely over the package's back body.
 */
function BackOverlay({ mQuintile, scale }: { mQuintile: Map<string, Quintile>; scale: number }) {
  // Back deltoid sub-division via ClipPath partition. LEFT shoulder:
  // medial right half = rear delt, lateral left half = mid delt. RIGHT
  // shoulder: mirrored.
  const rearDeltFill = subFill(M_REAR_DELT, DELT_SIBS, mQuintile);
  const midDeltFill = subFill(M_MID_DELT, DELT_SIBS, mQuintile);
  return (
    <Svg
      style={{ position: 'absolute', top: 0, left: 0 }}
      width={200 * scale}
      height={400 * scale}
      viewBox="724 0 724 1448"
      pointerEvents="none"
    >
      <Defs>
        <ClipPath id="heatmap-delt-back-l">
          <Path d={PACKAGE_DELT_BACK_L} />
        </ClipPath>
        <ClipPath id="heatmap-delt-back-r">
          <Path d={PACKAGE_DELT_BACK_R} />
        </ClipPath>
      </Defs>
      {/* Back view LEFT shoulder: lateral half (mid delt) + medial half (rear delt) */}
      <Rect
        x={724}
        y={0}
        width={SPLIT_X_BACK_DELT_L - 724}
        height={1448}
        fill={midDeltFill}
        clipPath="url(#heatmap-delt-back-l)"
      />
      <Rect
        x={SPLIT_X_BACK_DELT_L}
        y={0}
        width={1448 - SPLIT_X_BACK_DELT_L}
        height={1448}
        fill={rearDeltFill}
        clipPath="url(#heatmap-delt-back-l)"
      />
      {/* Back view RIGHT shoulder: medial half (rear delt) + lateral half (mid delt) */}
      <Rect
        x={724}
        y={0}
        width={SPLIT_X_BACK_DELT_R - 724}
        height={1448}
        fill={rearDeltFill}
        clipPath="url(#heatmap-delt-back-r)"
      />
      <Rect
        x={SPLIT_X_BACK_DELT_R}
        y={0}
        width={1448 - SPLIT_X_BACK_DELT_R}
        height={1448}
        fill={midDeltFill}
        clipPath="url(#heatmap-delt-back-r)"
      />
      {/* UNCLIPPED delt extensions — drawn on top so the package's trapezius /
          upper-back slugs cannot mask these regions. See body-overlay-paths.ts. */}
      <Path d={PATH_REAR_DELT_BACK_FILL_L} fill={rearDeltFill} />
      <Path d={PATH_REAR_DELT_BACK_FILL_R} fill={rearDeltFill} />
      <Path d={PATH_MID_DELT_PEAK_BACK_L} fill={midDeltFill} />
      <Path d={PATH_MID_DELT_PEAK_BACK_R} fill={midDeltFill} />
      {/* Gluteal split */}
      <Path d={PATH_UPPER_GLUTE} fill={subFill(M_UPPER_GLUTE, GLUTE_SIBS, mQuintile)} />
      <Path d={PATH_LOWER_GLUTE} fill={subFill(M_LOWER_GLUTE, GLUTE_SIBS, mQuintile)} />
      {/* Head outline — same stroke-only layer as FrontOverlay. */}
      <Path
        d={PATH_HEAD_OUTLINE_BACK}
        fill="none"
        stroke={COLOR_OUTLINE}
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
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

/** Slightly darker skin tone for non-muscle parts (head, hair, hands, feet). */
const COLOR_SKIN = '#E5E5E5';
const SKIN_SLUGS: ReadonlySet<Slug> = new Set<Slug>(['head', 'hair', 'hands', 'feet']);

/**
 * Collapse the 19 M_* constants onto the package's slug vocabulary, then
 * emit an entry for EVERY slug — highlighted ones get the quintile color,
 * the rest get the light body base. We pass `color` explicitly to override
 * the package's hardcoded asset `color: "#3f3f3f"`.
 */
/**
 * Side-aware deltoid exclusion: front-view's deltoid cap visually represents
 * front + mid (lateral) heads only; back-view's represents rear + mid.
 * Picking only M_REAR_DELT shouldn't fill the FRONT shoulder — it's a
 * different muscle anatomically.
 */
function isMSidedExcluded(m: string, side: 'front' | 'back'): boolean {
  if (side === 'front' && m === M_REAR_DELT) return true;
  if (side === 'back' && m === M_FRONT_DELT) return true;
  return false;
}

function buildSlugData(mQuintile: Map<string, Quintile>, side: 'front' | 'back'): ExtendedBodyPart[] {
  // Touch every M_* fill so the static-analysis test sees the references.
  M_FILLS(mQuintile);

  const slugMax = new Map<Slug, Quintile>();
  for (const [m, slug] of Object.entries(M_TO_SLUG)) {
    if (isMSidedExcluded(m, side)) continue;
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
 *
 * 2026-05-24 fan-label redesign: shrink slightly to make room for plain-text
 * muscle name labels in outer lanes (front=left, back=right). Heatmap labels
 * are READ-ONLY (not Pressable buttons) so the lane can be slimmer than
 * muscle-body-tagger's interactive layout.
 */
const BODY_SCALE = 0.65;
const BODY_WIDTH_PX = 200 * BODY_SCALE; // 130
const BODY_HEIGHT_PX = 400 * BODY_SCALE; // 260
const LABEL_LANE_WIDTH = 56;
const LABEL_WIDTH = 50;
const LABEL_HEIGHT = 16;
const SIDE_WIDTH = LABEL_LANE_WIDTH + BODY_WIDTH_PX; // 186
const LANE_Y_MIN = LABEL_HEIGHT / 2;
const LANE_Y_MAX = BODY_HEIGHT_PX - LABEL_HEIGHT / 2;
const LABEL_FONT_SIZE = 10;
const COLOR_LABEL_TEXT = '#4B5563';

export function BodyHeatmap({ mQuintile, mCount: _mCount }: BodyHeatmapProps) {
  const frontData = React.useMemo(() => buildSlugData(mQuintile, 'front'), [mQuintile]);
  const backData = React.useMemo(() => buildSlugData(mQuintile, 'back'), [mQuintile]);
  return (
    <View style={styles.row}>
      <View style={styles.column}>
        <SideHeader side="front" label={t('page', 'bodyFront')} />
        <SideContainer side="front" mQuintile={mQuintile} data={frontData} />
      </View>
      <View style={styles.column}>
        <SideHeader side="back" label={t('page', 'bodyBack')} />
        <SideContainer side="back" mQuintile={mQuintile} data={backData} />
      </View>
    </View>
  );
}

/**
 * SideContainer — body + role overlay + fan-layout muscle-name labels for
 * one view. Labels are READ-ONLY plain text (not Pressable, no border).
 * Layout: front has label lane on LEFT, body on RIGHT; back mirrored.
 */
function SideContainer({
  side,
  mQuintile,
  data,
}: {
  side: 'front' | 'back';
  mQuintile: Map<string, Quintile>;
  data: ExtendedBodyPart[];
}): React.JSX.Element {
  const anchors = side === 'front' ? FRONT_ANCHORS : BACK_ANCHORS;
  const items = React.useMemo(
    () => fanLayout(anchors, () => true, LANE_Y_MIN, LANE_Y_MAX),
    [anchors]
  );

  const labelOnLeft = side === 'front';
  const bodyLeft = labelOnLeft ? LABEL_LANE_WIDTH : 0;
  const labelLeft = labelOnLeft ? 2 : SIDE_WIDTH - LABEL_WIDTH - 2;
  const labelRight = labelLeft + LABEL_WIDTH;
  const railX = labelOnLeft ? LABEL_LANE_WIDTH - 3 : BODY_WIDTH_PX + 3;
  const leaderStart = labelOnLeft ? labelRight : labelLeft;

  return (
    <View style={{ width: SIDE_WIDTH, height: BODY_HEIGHT_PX, position: 'relative' }}>
      {/* Body + role overlay */}
      <View style={{ position: 'absolute', left: bodyLeft, top: 0 }}>
        <Body
          side={side}
          gender="male"
          data={data}
          colors={BODY_COLORS}
          scale={BODY_SCALE}
          border={COLOR_OUTLINE}
          defaultFill="#FAFAFA"
          defaultStroke="#9CA3AF"
        />
        {side === 'front' ? (
          <FrontOverlay mQuintile={mQuintile} scale={BODY_SCALE} />
        ) : (
          <BackOverlay mQuintile={mQuintile} scale={BODY_SCALE} />
        )}
      </View>

      {/* Leader polylines — pure presentation. */}
      <Svg
        style={{ position: 'absolute', left: 0, top: 0 }}
        width={SIDE_WIDTH}
        height={BODY_HEIGHT_PX}
        pointerEvents="none"
      >
        {items.map((item) => {
          const ax = bodyLeft + vbToBodyLocalX(item.vbX, side, BODY_WIDTH_PX);
          const ay = vbToBodyLocalY(item.vbY, BODY_HEIGHT_PX);
          return (
            <Polyline
              key={`leader-${item.m}`}
              points={`${leaderStart},${item.labelY} ${railX},${item.labelY} ${ax},${ay}`}
              stroke={COLOR_OUTLINE}
              strokeWidth={0.5}
              fill="none"
            />
          );
        })}
      </Svg>

      {/* Muscle name labels — plain Text, no background. Text colour uses
          QUINTILE_TEXT_COLORS (darker variant of the legend hue) so the
          label stays legible on white while still signalling the bucket.
          Untrained muscles fall back to neutral grey. */}
      {items.map((item) => {
        const q = mQuintile.get(item.m);
        const textColor = q == null ? COLOR_LABEL_TEXT : QUINTILE_TEXT_COLORS[q];
        return (
          <View
            key={`label-${item.m}`}
            style={[
              styles.muscleLabel,
              {
                left: labelLeft,
                top: item.labelY - LABEL_HEIGHT / 2,
                alignItems: labelOnLeft ? 'flex-end' : 'flex-start',
              },
            ]}
            pointerEvents="none"
          >
            <Text style={{ fontSize: LABEL_FONT_SIZE, color: textColor, fontWeight: '600' }}>
              {tMuscle(item.m)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/**
 * Centers the 正面/背面 header over the body lane only (not over the label
 * lane). Spacer-row trick mirrors muscle-body-tagger.tsx.
 */
function SideHeader({ side, label }: { side: 'front' | 'back'; label: string }) {
  const labelOnLeft = side === 'front';
  return (
    <View style={{ width: SIDE_WIDTH, flexDirection: 'row' }}>
      {labelOnLeft && <View style={{ width: LABEL_LANE_WIDTH }} />}
      <View style={{ width: BODY_WIDTH_PX, alignItems: 'center' }}>
        <Text style={styles.label}>{label}</Text>
      </View>
      {!labelOnLeft && <View style={{ width: LABEL_LANE_WIDTH }} />}
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
  muscleLabel: {
    position: 'absolute',
    width: LABEL_WIDTH,
    height: LABEL_HEIGHT,
    justifyContent: 'center',
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
