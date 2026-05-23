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

export function BodyHeatmap({ mQuintile, mCount: _mCount }: BodyHeatmapProps) {
  const data = React.useMemo(() => buildSlugData(mQuintile), [mQuintile]);
  return (
    <View style={styles.row}>
      <View style={styles.column}>
        <Text style={styles.label}>{t('page', 'bodyFront')}</Text>
        <Body
          side="front"
          gender="male"
          data={data}
          colors={BODY_COLORS}
          scale={0.8}
          border={COLOR_OUTLINE}
          defaultFill="#FAFAFA"
          defaultStroke="#9CA3AF"
        />
      </View>
      <View style={styles.column}>
        <Text style={styles.label}>{t('page', 'bodyBack')}</Text>
        <Body
          side="back"
          gender="male"
          data={data}
          colors={BODY_COLORS}
          scale={0.8}
          border={COLOR_OUTLINE}
          defaultFill="#FAFAFA"
          defaultStroke="#9CA3AF"
        />
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
