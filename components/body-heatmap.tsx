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
import Svg, { Path, Text as SvgText } from 'react-native-svg';

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

// Label coordinates for the front + back SVG views. Hand-picked to sit roughly
// at each MG region's centre while staying off the silhouette outline.
interface MgLabel {
  mg_id: string;
  short: string; // 1-2 char display
  x: number;
  y: number;
}

const FRONT_LABELS: readonly MgLabel[] = [
  { mg_id: MG_SHOULDER, short: '肩', x: 50, y: 105 },
  { mg_id: MG_CHEST, short: '胸', x: 100, y: 122 },
  { mg_id: MG_BICEP, short: '二頭', x: 50, y: 152 },
  { mg_id: MG_CORE, short: '核心', x: 100, y: 178 },
  { mg_id: MG_FOREARM, short: '前臂', x: 53, y: 195 },
  { mg_id: MG_LEG, short: '腿', x: 82, y: 280 },
  { mg_id: MG_CALF, short: '小腿', x: 82, y: 360 },
];
const BACK_LABELS: readonly MgLabel[] = [
  { mg_id: MG_TRAP, short: '斜方', x: 100, y: 102 },
  { mg_id: MG_SHOULDER, short: '肩', x: 50, y: 105 },
  { mg_id: MG_BACK, short: '背', x: 100, y: 138 },
  { mg_id: MG_TRICEP, short: '三頭', x: 50, y: 152 },
  { mg_id: MG_GLUTE, short: '臀', x: 100, y: 230 },
  { mg_id: MG_LEG, short: '腿', x: 82, y: 285 },
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

export interface BodyHeatmapProps {
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
}: {
  labels: readonly MgLabel[];
  mgCount?: Map<string, number>;
}) {
  return (
    <>
      {labels.map((l) => {
        const c = mgCount?.get(l.mg_id);
        const text = c != null && c > 0 ? `${l.short}·${c}` : l.short;
        return (
          <SvgText
            key={`${l.mg_id}-${l.x}-${l.y}`}
            x={l.x}
            y={l.y}
            fontSize={8}
            fontWeight="700"
            fill="#1F2937"
            stroke="#FFFFFF"
            strokeWidth={0.5}
            textAnchor="middle">
            {text}
          </SvgText>
        );
      })}
    </>
  );
}

function FrontBody({ mgQuintile, mgCount }: BodyHeatmapProps) {
  const f = (mg: string) => fillForMg(mg, mgQuintile);
  return (
    <Svg viewBox="0 0 200 400" width={140} height={280}>
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
        d="M58 90 C50 92 46 105 50 118 L70 110 L72 92 Z M142 90 C150 92 154 105 150 118 L130 110 L128 92 Z M48 118 C44 130 46 142 56 144 L62 130 L52 120 Z M152 118 C156 130 154 142 144 144 L138 130 L148 120 Z"
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
      <MgLabels labels={FRONT_LABELS} mgCount={mgCount} />
    </Svg>
  );
}

function BackBody({ mgQuintile, mgCount }: BodyHeatmapProps) {
  const f = (mg: string) => fillForMg(mg, mgQuintile);
  return (
    <Svg viewBox="0 0 200 400" width={140} height={280}>
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
      {/* Rear delts (shared MG_SHOULDER fill so back/front both glow) */}
      <Path
        d="M58 90 C50 92 46 105 50 118 L72 108 L74 92 Z M142 90 C150 92 154 105 150 118 L128 108 L126 92 Z"
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
      <MgLabels labels={BACK_LABELS} mgCount={mgCount} />
    </Svg>
  );
}

export function BodyHeatmap({ mgQuintile, mgCount }: BodyHeatmapProps) {
  return (
    <View style={styles.row}>
      <View style={styles.column}>
        <Text style={styles.label}>正面</Text>
        <FrontBody mgQuintile={mgQuintile} mgCount={mgCount} />
      </View>
      <View style={styles.column}>
        <Text style={styles.label}>背面</Text>
        <BackBody mgQuintile={mgQuintile} mgCount={mgCount} />
      </View>
    </View>
  );
}

/** Legend strip showing the 5-quintile colour scale. */
export function BodyHeatmapLegend() {
  return (
    <View style={styles.legendRow}>
      <View style={[styles.swatch, { backgroundColor: COLOR_ZERO, borderWidth: 1, borderColor: COLOR_OUTLINE }]} />
      <Text style={styles.legendText}>0</Text>
      {QUINTILE_COLORS.map((c, i) => (
        <View key={i} style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: c }]} />
          <Text style={styles.legendText}>Q{i + 1}</Text>
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
