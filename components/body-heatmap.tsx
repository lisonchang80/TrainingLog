/**
 * Body Heatmap — front + back human silhouette coloured by per-MG quintile.
 *
 * Used by the Stats sub-tab of History (slice 9 / ADR-0009 §人體部位圖).
 *
 * Reuses the path data shape from `components/body-diagram.tsx` but groups
 * muscles by their parent MG and fills the whole MG with one quintile colour
 * (冷藍 → 暖紅 + 灰 for zero). Slice 10 will likely consolidate the path data
 * into a shared constant.
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
import Svg, { Line as SvgLine, Path, Text as SvgText } from 'react-native-svg';

import {
  MG_BACK,
  MG_BICEP,
  MG_CALF,
  MG_CHEST,
  MG_CORE,
  MG_FOREARM,
  MG_GLUTE,
  MG_LEG,
  MG_SHOULDER,
  MG_TRAP,
  MG_TRICEP,
} from '@/src/db/seed/v006ExerciseLibrary';
import { tMuscleGroup } from '@/src/i18n';

// Label coordinates with leader lines (smoke round-2 #2: pull labels outside
// body silhouette + bigger font for legibility).
//
//   Front view: extended viewBox left by 80px → labels sit at x = -8, end-aligned
//   Back view:  extended viewBox right by 80px → labels sit at x = 208, start-aligned
//
// `anchor` = the (x, y) inside the body region the leader line points to.
// `label`  = the (x, y) at the outer edge where the text renders.
interface MgLabel {
  mg_id: string;
  /**
   * Short zh literal label used for body-diagram leader-line callouts.
   * Phase 4D i18n note: `short` is a fallback display; `MgLabels` render
   * goes through `tMuscleGroup(mg_id)` first so EN locale shows
   * Chest/Back/Legs etc. We keep `short` for legacy mg_ids that the
   * strings.ts dictionary doesn't cover (e.g. 斜方 is mapped via 斜方肌
   * key — so the zh literal here matches what tMuscleGroup returns when
   * locale=zh and key matches).
   */
  short: string;
  anchorX: number;
  anchorY: number;
  labelX: number;
  labelY: number;
}

const FRONT_LABELS: readonly MgLabel[] = [
  { mg_id: MG_SHOULDER, short: '肩', anchorX: 50, anchorY: 110, labelX: -8, labelY: 105 },
  { mg_id: MG_CHEST, short: '胸', anchorX: 100, anchorY: 122, labelX: -8, labelY: 135 },
  { mg_id: MG_BICEP, short: '二頭', anchorX: 50, anchorY: 150, labelX: -8, labelY: 165 },
  { mg_id: MG_CORE, short: '核心', anchorX: 100, anchorY: 175, labelX: -8, labelY: 195 },
  { mg_id: MG_FOREARM, short: '小臂', anchorX: 55, anchorY: 195, labelX: -8, labelY: 225 },
  { mg_id: MG_LEG, short: '腿', anchorX: 82, anchorY: 280, labelX: -8, labelY: 280 },
  { mg_id: MG_CALF, short: '小腿', anchorX: 82, anchorY: 360, labelX: -8, labelY: 360 },
];
const BACK_LABELS: readonly MgLabel[] = [
  { mg_id: MG_TRAP, short: '斜方', anchorX: 100, anchorY: 100, labelX: 208, labelY: 100 },
  { mg_id: MG_SHOULDER, short: '肩', anchorX: 150, anchorY: 105, labelX: 208, labelY: 130 },
  { mg_id: MG_BACK, short: '背', anchorX: 100, anchorY: 138, labelX: 208, labelY: 160 },
  { mg_id: MG_TRICEP, short: '三頭', anchorX: 150, anchorY: 152, labelX: 208, labelY: 195 },
  { mg_id: MG_GLUTE, short: '臀', anchorX: 100, anchorY: 230, labelX: 208, labelY: 235 },
  { mg_id: MG_LEG, short: '腿', anchorX: 82, anchorY: 285, labelX: 208, labelY: 285 },
];

const COLOR_OUTLINE = '#9CA3AF';
const QUINTILE_COLORS: readonly string[] = [
  '#BFDBFE', // Q1 cool blue
  '#93C5FD', // Q2 light blue-green
  '#FCD34D', // Q3 yellow
  '#FB923C', // Q4 warm orange
  '#EF4444', // Q5 warm red
];
const COLOR_ZERO = '#E5E7EB';

export type Quintile = 0 | 1 | 2 | 3 | 4;

interface BodyHeatmapProps {
  /**
   * mg_id → quintile bucket (0..4) for non-zero MGs.
   * MGs absent from this map render in zero-grey.
   */
  mgQuintile: Map<string, Quintile>;
  /**
   * Optional mg_id → per-Session frequency. When provided, labels render as
   * "MG · N"; otherwise they show just the MG name.
   */
  mgCount?: Map<string, number>;
}

const fillForMg = (mg: string, mgQuintile: Map<string, Quintile>): string => {
  const q = mgQuintile.get(mg);
  if (q == null) return COLOR_ZERO;
  return QUINTILE_COLORS[q];
};

function MgLabels({
  labels,
  mgCount,
  textAnchor,
}: {
  labels: readonly MgLabel[];
  mgCount?: Map<string, number>;
  textAnchor: 'start' | 'end';
}) {
  return (
    <>
      {labels.map((l) => {
        const c = mgCount?.get(l.mg_id);
        // Round-trip the mg_id through the i18n muscle-group dictionary
        // first so EN locale shows e.g. "Chest" rather than "胸". The
        // `short` field is the legacy zh literal used as ultimate
        // fallback if the mg_id isn't in the dictionary.
        const localized = tMuscleGroup(l.mg_id);
        const display = localized && localized !== l.mg_id ? localized : l.short;
        const text = c != null && c > 0 ? `${display}·${c}` : display;
        return (
          <React.Fragment key={l.mg_id}>
            <SvgLine
              x1={l.anchorX}
              y1={l.anchorY}
              x2={l.labelX}
              y2={l.labelY}
              stroke="#9CA3AF"
              strokeWidth={0.6}
            />
            <SvgText
              x={l.labelX}
              y={l.labelY + 4}
              fontSize={12}
              fontWeight="600"
              fill="#1F2937"
              textAnchor={textAnchor}>
              {text}
            </SvgText>
          </React.Fragment>
        );
      })}
    </>
  );
}

function FrontBody({ mgQuintile, mgCount }: BodyHeatmapProps) {
  const f = (mg: string) => fillForMg(mg, mgQuintile);
  return (
    <Svg viewBox="-80 0 280 400" width={160} height={228}>
      {/* Head */}
      <Path
        d="M100 10 C82 10 70 24 70 42 C70 60 82 74 100 74 C118 74 130 60 130 42 C130 24 118 10 100 10 Z"
        fill="#F5F5F7"
        stroke={COLOR_OUTLINE}
        strokeWidth={1}
      />
      {/* Neck */}
      <Path d="M88 74 L112 74 L110 86 L90 86 Z" fill="#F5F5F7" stroke={COLOR_OUTLINE} strokeWidth={1} />
      {/* Torso outline */}
      <Path
        d="M62 88 L138 88 L150 130 L142 200 L100 210 L58 200 L50 130 Z"
        fill="#FAFAFA"
        stroke={COLOR_OUTLINE}
        strokeWidth={1}
      />
      {/* Shoulders (front + mid delts combined as a single MG fill) */}
      <Path
        d="M58 90 C50 92 46 105 50 118 L70 110 L72 92 Z M142 90 C150 92 154 105 150 118 L130 110 L128 92 Z M42 92 C36 98 36 114 46 118 L48 110 L50 92 Z M158 92 C164 98 164 114 154 118 L152 110 L150 92 Z"
        fill={f(MG_SHOULDER)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Chest (upper + lower combined) */}
      <Path
        d="M72 92 L128 92 L122 110 L78 110 Z M78 110 L122 110 L118 138 L100 144 L82 138 Z"
        fill={f(MG_CHEST)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Bicep (long + short combined) */}
      <Path
        d="M44 130 C40 145 42 160 50 168 L58 168 L60 145 L52 130 Z M156 130 C160 145 158 160 150 168 L142 168 L140 145 L148 130 Z M58 130 L62 130 L64 168 L60 168 Z M138 130 L142 130 L140 168 L136 168 Z"
        fill={f(MG_BICEP)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Forearm */}
      <Path
        d="M48 168 C44 184 46 200 54 210 L62 210 L62 168 Z M152 168 C156 184 154 200 146 210 L138 210 L138 168 Z"
        fill={f(MG_FOREARM)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Core (abs + obliques combined) */}
      <Path
        d="M86 144 L114 144 L112 200 L88 200 Z M70 138 L86 144 L88 200 L74 198 Z M130 138 L114 144 L112 200 L126 198 Z"
        fill={f(MG_CORE)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Hip / pelvis */}
      <Path
        d="M58 200 L142 200 L138 230 L100 240 L62 230 Z"
        fill="#F5F5F7"
        stroke={COLOR_OUTLINE}
        strokeWidth={1}
      />
      {/* Quads (front of leg) */}
      <Path
        d="M64 232 L98 232 L94 318 L70 318 Z M136 232 L102 232 L106 318 L130 318 Z"
        fill={f(MG_LEG)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Knee */}
      <Path
        d="M70 318 L94 318 L92 326 L72 326 Z M106 318 L130 318 L128 326 L108 326 Z"
        fill="#F5F5F7"
        stroke={COLOR_OUTLINE}
        strokeWidth={1}
      />
      {/* Calves (front view) */}
      <Path
        d="M72 326 L92 326 L88 388 L76 388 Z M108 326 L128 326 L124 388 L112 388 Z"
        fill={f(MG_CALF)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      <MgLabels labels={FRONT_LABELS} mgCount={mgCount} textAnchor="end" />
    </Svg>
  );
}

function BackBody({ mgQuintile, mgCount }: BodyHeatmapProps) {
  const f = (mg: string) => fillForMg(mg, mgQuintile);
  return (
    <Svg viewBox="0 0 280 400" width={160} height={228}>
      {/* Head */}
      <Path
        d="M100 10 C82 10 70 24 70 42 C70 60 82 74 100 74 C118 74 130 60 130 42 C130 24 118 10 100 10 Z"
        fill="#F5F5F7"
        stroke={COLOR_OUTLINE}
        strokeWidth={1}
      />
      {/* Neck */}
      <Path d="M88 74 L112 74 L110 86 L90 86 Z" fill="#F5F5F7" stroke={COLOR_OUTLINE} strokeWidth={1} />
      {/* Torso outline */}
      <Path
        d="M62 88 L138 88 L150 130 L142 200 L100 210 L58 200 L50 130 Z"
        fill="#FAFAFA"
        stroke={COLOR_OUTLINE}
        strokeWidth={1}
      />
      {/* Trap (upper back diamond) */}
      <Path
        d="M84 86 L116 86 L122 100 L100 116 L78 100 Z"
        fill={f(MG_TRAP)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Rear delts + mid delts (shared MG_SHOULDER fill so back/front both glow) */}
      <Path
        d="M58 90 C50 92 46 105 50 118 L72 108 L74 92 Z M142 90 C150 92 154 105 150 118 L128 108 L126 92 Z M42 92 C36 98 36 114 46 118 L48 110 L50 92 Z M158 92 C164 98 164 114 154 118 L152 110 L150 92 Z"
        fill={f(MG_SHOULDER)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Lats + lower back (背部 + 下背 = MG_BACK) */}
      <Path
        d="M76 102 L124 102 L130 158 L100 168 L70 158 Z M82 168 L118 168 L116 198 L84 198 Z"
        fill={f(MG_BACK)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Tricep (back of upper arm) */}
      <Path
        d="M44 130 C40 148 44 165 52 170 L62 168 L60 130 Z M156 130 C160 148 156 165 148 170 L138 168 L140 130 Z"
        fill={f(MG_TRICEP)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Forearm (back) */}
      <Path
        d="M48 170 C44 188 46 204 54 212 L62 210 L62 170 Z M152 170 C156 188 154 204 146 212 L138 210 L138 170 Z"
        fill={f(MG_FOREARM)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Hip outline */}
      <Path
        d="M58 200 L142 200 L138 230 L100 240 L62 230 Z"
        fill="#F5F5F7"
        stroke={COLOR_OUTLINE}
        strokeWidth={1}
      />
      {/* Glutes (upper + lower combined) */}
      <Path
        d="M68 210 L132 210 L128 230 L72 230 Z M72 230 L128 230 L126 250 L74 250 Z"
        fill={f(MG_GLUTE)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Hamstrings (back of leg — same MG as quads) */}
      <Path
        d="M64 252 L96 252 L94 318 L70 318 Z M136 252 L104 252 L106 318 L130 318 Z"
        fill={f(MG_LEG)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Knee */}
      <Path
        d="M70 318 L94 318 L92 326 L72 326 Z M106 318 L130 318 L128 326 L108 326 Z"
        fill="#F5F5F7"
        stroke={COLOR_OUTLINE}
        strokeWidth={1}
      />
      {/* Calf (back view) */}
      <Path
        d="M72 326 L92 326 L88 388 L76 388 Z M108 326 L128 326 L124 388 L112 388 Z"
        fill={f(MG_CALF)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      <MgLabels labels={BACK_LABELS} mgCount={mgCount} textAnchor="start" />
    </Svg>
  );
}

export function BodyHeatmap({ mgQuintile, mgCount }: BodyHeatmapProps) {
  return (
    <View style={styles.row}>
      <View style={styles.column}>
        {/* TODO(i18n): no key for "正面" body-diagram column header */}
        <Text style={styles.label}>正面</Text>
        <FrontBody mgQuintile={mgQuintile} mgCount={mgCount} />
      </View>
      <View style={styles.column}>
        {/* TODO(i18n): no key for "背面" body-diagram column header */}
        <Text style={styles.label}>背面</Text>
        <BackBody mgQuintile={mgQuintile} mgCount={mgCount} />
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
        <View style={[styles.swatch, { backgroundColor: COLOR_ZERO, borderWidth: 1, borderColor: COLOR_OUTLINE }]} />
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
