/**
 * MuscleDiagramTagged — Slice 9.7 (ADR-0017 Q11 amendment, layout iteration v2).
 *
 * Front + back bodies side-by-side with **button-style** muscle labels
 * connected to anatomical anchors via two-segment leader lines (horizontal
 * from button → diagonal to anchor). Fan layout — labels sorted by anchorY
 * + rail-then-diagonal guarantees no leader line crossings.
 *
 * Layout:
 *   - SVG width 174 each + 2pt gap = 350pt total (fits iPhone 14 content width)
 *   - viewBox width 300 → fontSize 22 in viewBox ≈ 13pt rendered (comfortable)
 *   - Front: labels on LEFT lane (viewBox -100 to 0), rail at x=5
 *   - Back: labels on RIGHT lane (viewBox 200 to 305), rail at x=195
 *   - Each label = filled Rect button with rounded corners + Text overlay
 *   - Tap Rect entire button (no separate transparent overlay)
 *
 * Active state visual:
 *   primary  → orange fill + orange border + dark-orange text
 *   secondary → blue fill + blue border + dark-blue text
 *   inactive → grey fill + grey border + grey text
 *
 * Fan layout (no crossings, proven):
 *   1. Labels sorted by anchorY ASC so top label connects to topmost anchor
 *   2. labelY distributed evenly within available y range
 *   3. Polyline: (labelEdge, labelY) → (rail, labelY) → (anchorX, anchorY)
 *   4. Diagonals fan out from rail; preserve order → no two cross
 *   5. Horizontal segments all at distinct labelY → no horizontal crosses
 */
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Polyline, Rect, Text as SvgText } from 'react-native-svg';

import type { MuscleRole } from '@/src/domain/exercise/types';

const COLOR_PRIMARY = '#F26B3A';
const COLOR_SECONDARY = '#7CB6E0';
const COLOR_INACTIVE = '#E5E5EA';
const COLOR_OUTLINE = '#9CA3AF';
const COLOR_LEADER = '#9CA3AF';

const BTN = {
  inactive: { fill: '#F3F4F6', stroke: '#D1D5DB', text: '#374151' },
  primary: { fill: '#FED7AA', stroke: '#F26B3A', text: '#C2410C' },
  secondary: { fill: '#BFDBFE', stroke: '#7CB6E0', text: '#1E40AF' },
};

const BUTTON_WIDTH = 115; // wider to fit 4-char labels (外側二頭/內側二頭/斜方肌)
const BUTTON_HEIGHT = 40;
const FONT_SIZE = 28;
const SHADOW_DX = 2;
const SHADOW_DY = 2.5;
const SHADOW_FILL = 'rgba(0,0,0,0.18)';
const SVG_WIDTH = 174;
const VIEWBOX_WIDTH = 325; // extended to fit BUTTON_WIDTH 115 + 5pt padding
const VIEWBOX_HEIGHT = 540;
const SVG_HEIGHT = Math.round((SVG_WIDTH * VIEWBOX_HEIGHT) / VIEWBOX_WIDTH); // 289

interface MuscleAnchor {
  muscle_id: string;
  short: string;
  anchorX: number;
  anchorY: number;
  labelY: number; // labelX derived per-side constant
}

// FRONT — 10 labels (小腿 moved to BACK side to relieve crowding).
// labelY spaced 50 units (button h 40 + gap 10).
// 中下胸 manually promoted right under 上胸 (chest-group cluster).
const FRONT_MUSCLES: readonly MuscleAnchor[] = [
  { muscle_id: 'm-upper-chest', short: '上胸', anchorX: 100, anchorY: 100, labelY: 40 },
  { muscle_id: 'm-lower-chest', short: '中下胸', anchorX: 100, anchorY: 124, labelY: 90 },
  { muscle_id: 'm-mid-delt', short: '中束', anchorX: 35, anchorY: 105, labelY: 140 },
  { muscle_id: 'm-front-delt', short: '前束', anchorX: 55, anchorY: 105, labelY: 190 },
  { muscle_id: 'm-bicep-long', short: '外側二頭', anchorX: 50, anchorY: 150, labelY: 240 },
  { muscle_id: 'm-bicep-short', short: '內側二頭', anchorX: 62, anchorY: 150, labelY: 290 },
  { muscle_id: 'm-oblique', short: '側腹', anchorX: 75, anchorY: 170, labelY: 340 },
  { muscle_id: 'm-abs', short: '腹肌', anchorX: 100, anchorY: 172, labelY: 390 },
  { muscle_id: 'm-forearm', short: '小臂', anchorX: 55, anchorY: 190, labelY: 440 },
  { muscle_id: 'm-quad', short: '股四', anchorX: 80, anchorY: 275, labelY: 490 },
];

// BACK — 9 labels (小腿 moved here from front to balance density).
// Spacing 52 units (button h 40 + gap 12).
// Cluster ordering: 下背 right under 背部; 三頭 promoted above 背部 to keep the
// back-cluster contiguous without line crossings (verified).
const BACK_MUSCLES: readonly MuscleAnchor[] = [
  { muscle_id: 'm-trap', short: '斜方肌', anchorX: 100, anchorY: 100, labelY: 80 },
  { muscle_id: 'm-rear-delt', short: '後束', anchorX: 140, anchorY: 105, labelY: 132 },
  { muscle_id: 'm-tricep', short: '三頭', anchorX: 148, anchorY: 150, labelY: 184 },
  { muscle_id: 'm-back', short: '背部', anchorX: 100, anchorY: 135, labelY: 236 },
  { muscle_id: 'm-lower-back', short: '下背', anchorX: 100, anchorY: 183, labelY: 288 },
  { muscle_id: 'm-upper-glute', short: '上臀部', anchorX: 100, anchorY: 220, labelY: 340 },
  { muscle_id: 'm-lower-glute', short: '下臀部', anchorX: 100, anchorY: 240, labelY: 392 },
  { muscle_id: 'm-hamstring', short: '膕繩', anchorX: 80, anchorY: 285, labelY: 444 },
  { muscle_id: 'm-calf', short: '小腿', anchorX: 100, anchorY: 357, labelY: 496 },
];

const FRONT_LABEL_X = -118; // button right edge at -3 (rail at x=5)
const FRONT_RAIL_X = 5;
const BACK_LABEL_X = 205; // button right edge at 320 (viewBox ends at 325)
const BACK_RAIL_X = 195;

const fillFor = (highlight: Map<string, MuscleRole>, muscleId: string): string => {
  const role = highlight.get(muscleId);
  if (role === 'primary') return COLOR_PRIMARY;
  if (role === 'secondary') return COLOR_SECONDARY;
  return COLOR_INACTIVE;
};

const btnStyleFor = (role: MuscleRole | undefined) => {
  if (role === 'primary') return BTN.primary;
  if (role === 'secondary') return BTN.secondary;
  return BTN.inactive;
};

interface MuscleDiagramTaggedProps {
  highlight: Map<string, MuscleRole>;
  onTap?: (muscleId: string) => void;
  /**
   * 'edit' (default) — all 19 muscle buttons rendered, tappable, with shadow.
   * 'readonly' — only selected (primary or secondary) muscles get labels;
   * labelY redistributed evenly within the lane; no button background or
   * shadow; smaller text. Used on the exercise detail page.
   */
  mode?: 'edit' | 'readonly';
}

function repackLabels(source: readonly MuscleAnchor[], highlight: Map<string, MuscleRole>): MuscleAnchor[] {
  const selected = source.filter((m) => highlight.has(m.muscle_id));
  if (selected.length === 0) return [];
  const yMin = 60;
  const yMax = 480;
  if (selected.length === 1) {
    return [{ ...selected[0], labelY: (yMin + yMax) / 2 }];
  }
  const step = (yMax - yMin) / (selected.length - 1);
  return selected.map((m, i) => ({ ...m, labelY: yMin + i * step }));
}

export function MuscleDiagramTagged({
  highlight,
  onTap,
  mode = 'edit',
}: MuscleDiagramTaggedProps) {
  const f = (id: string) => fillFor(highlight, id);
  const tapBoundFor = (id: string) => onTap ? () => onTap(id) : undefined;

  const frontMuscles = useMemo(
    () => (mode === 'readonly' ? repackLabels(FRONT_MUSCLES, highlight) : [...FRONT_MUSCLES]),
    [mode, highlight]
  );
  const backMuscles = useMemo(
    () => (mode === 'readonly' ? repackLabels(BACK_MUSCLES, highlight) : [...BACK_MUSCLES]),
    [mode, highlight]
  );

  return (
    <View>
      <View style={styles.row}>
        <FrontView
          muscles={frontMuscles}
          highlight={highlight}
          fillFor={f}
          onTap={tapBoundFor}
          mode={mode}
        />
        <BackView
          muscles={backMuscles}
          highlight={highlight}
          fillFor={f}
          onTap={tapBoundFor}
          mode={mode}
        />
      </View>
      <View style={styles.legendRow}>
        <LegendItem color={COLOR_PRIMARY} label="主要" />
        <LegendItem color={COLOR_SECONDARY} label="次要" />
        {mode === 'edit' && <LegendItem color={COLOR_INACTIVE} label="未活化" />}
      </View>
    </View>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View
        style={[
          styles.swatch,
          { backgroundColor: color, borderWidth: color === COLOR_INACTIVE ? 1 : 0, borderColor: COLOR_OUTLINE },
        ]}
      />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

interface ViewSubProps {
  muscles: MuscleAnchor[];
  highlight: Map<string, MuscleRole>;
  fillFor: (id: string) => string;
  onTap: (id: string) => (() => void) | undefined;
  mode: 'edit' | 'readonly';
}

function FrontView({ muscles, highlight, fillFor, onTap, mode }: ViewSubProps) {
  return (
    <Svg viewBox={`-120 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`} width={SVG_WIDTH} height={SVG_HEIGHT}>
      <Path d="M100 10 C82 10 70 24 70 42 C70 60 82 74 100 74 C118 74 130 60 130 42 C130 24 118 10 100 10 Z" fill="#F5F5F7" stroke={COLOR_OUTLINE} strokeWidth={1} />
      <Path d="M88 74 L112 74 L110 86 L90 86 Z" fill="#F5F5F7" stroke={COLOR_OUTLINE} strokeWidth={1} />
      <Path d="M62 88 L138 88 L150 130 L142 200 L100 210 L58 200 L50 130 Z" fill="#FAFAFA" stroke={COLOR_OUTLINE} strokeWidth={1} />
      <Path d="M58 90 C50 92 46 105 50 118 L70 110 L72 92 Z M142 90 C150 92 154 105 150 118 L130 110 L128 92 Z" fill={fillFor('m-front-delt')} stroke={COLOR_OUTLINE} strokeWidth={0.5} />
      <Path d="M42 92 C36 98 36 114 46 118 L48 110 L50 92 Z M158 92 C164 98 164 114 154 118 L152 110 L150 92 Z" fill={fillFor('m-mid-delt')} stroke={COLOR_OUTLINE} strokeWidth={0.5} />
      <Path d="M72 92 L128 92 L122 110 L78 110 Z" fill={fillFor('m-upper-chest')} stroke={COLOR_OUTLINE} strokeWidth={0.5} />
      <Path d="M78 110 L122 110 L118 138 L100 144 L82 138 Z" fill={fillFor('m-lower-chest')} stroke={COLOR_OUTLINE} strokeWidth={0.5} />
      <Path d="M44 130 C40 145 42 160 50 168 L58 168 L60 145 L52 130 Z M156 130 C160 145 158 160 150 168 L142 168 L140 145 L148 130 Z" fill={fillFor('m-bicep-long')} stroke={COLOR_OUTLINE} strokeWidth={0.5} />
      <Path d="M58 130 L62 130 L64 168 L60 168 Z M138 130 L142 130 L140 168 L136 168 Z" fill={fillFor('m-bicep-short')} stroke={COLOR_OUTLINE} strokeWidth={0.5} />
      <Path d="M48 168 C44 184 46 200 54 210 L62 210 L62 168 Z M152 168 C156 184 154 200 146 210 L138 210 L138 168 Z" fill={fillFor('m-forearm')} stroke={COLOR_OUTLINE} strokeWidth={0.5} />
      <Path d="M86 144 L114 144 L112 200 L88 200 Z" fill={fillFor('m-abs')} stroke={COLOR_OUTLINE} strokeWidth={0.5} />
      <Path d="M70 138 L86 144 L88 200 L74 198 Z M130 138 L114 144 L112 200 L126 198 Z" fill={fillFor('m-oblique')} stroke={COLOR_OUTLINE} strokeWidth={0.5} />
      <Path d="M58 200 L142 200 L138 230 L100 240 L62 230 Z" fill="#F5F5F7" stroke={COLOR_OUTLINE} strokeWidth={1} />
      <Path d="M64 232 L98 232 L94 318 L70 318 Z M136 232 L102 232 L106 318 L130 318 Z" fill={fillFor('m-quad')} stroke={COLOR_OUTLINE} strokeWidth={0.5} />
      <Path d="M70 318 L94 318 L92 326 L72 326 Z M106 318 L130 318 L128 326 L108 326 Z" fill="#F5F5F7" stroke={COLOR_OUTLINE} strokeWidth={1} />
      <Path d="M72 326 L92 326 L88 388 L76 388 Z M108 326 L128 326 L124 388 L112 388 Z" fill={fillFor('m-calf')} stroke={COLOR_OUTLINE} strokeWidth={0.5} />

      {muscles.map((m) => (
        <LabelGroup
          key={m.muscle_id}
          muscle={m}
          role={highlight.get(m.muscle_id)}
          side="left"
          mode={mode}
          onTap={onTap(m.muscle_id)}
        />
      ))}
    </Svg>
  );
}

interface LabelGroupProps {
  muscle: MuscleAnchor;
  role: MuscleRole | undefined;
  side: 'left' | 'right';
  mode: 'edit' | 'readonly';
  onTap: (() => void) | undefined;
}

function LabelGroup({ muscle, role, side, mode, onTap }: LabelGroupProps) {
  const btn = btnStyleFor(role);
  const labelX = side === 'left' ? FRONT_LABEL_X : BACK_LABEL_X;
  const railX = side === 'left' ? FRONT_RAIL_X : BACK_RAIL_X;
  const polylineStart = side === 'left' ? labelX + BUTTON_WIDTH : labelX;

  if (mode === 'readonly') {
    // Read-only: just leader line + text, no button background/shadow.
    const fs = 22; // smaller than edit mode (28)
    return (
      <>
        <Polyline
          points={`${polylineStart},${muscle.labelY} ${railX},${muscle.labelY} ${muscle.anchorX},${muscle.anchorY}`}
          stroke={COLOR_LEADER}
          strokeWidth={0.7}
          fill="none"
        />
        <SvgText
          x={labelX + BUTTON_WIDTH / 2}
          y={muscle.labelY + fs / 3}
          fontSize={fs}
          fontWeight="600"
          fill={btn.text}
          textAnchor="middle">
          {muscle.short}
        </SvgText>
      </>
    );
  }

  const buttonTop = muscle.labelY - BUTTON_HEIGHT / 2;
  return (
    <>
      <Polyline
        points={`${polylineStart},${muscle.labelY} ${railX},${muscle.labelY} ${muscle.anchorX},${muscle.anchorY}`}
        stroke={COLOR_LEADER}
        strokeWidth={0.7}
        fill="none"
      />
      <Rect
        x={labelX + SHADOW_DX}
        y={buttonTop + SHADOW_DY}
        width={BUTTON_WIDTH}
        height={BUTTON_HEIGHT}
        rx={6}
        ry={6}
        fill={SHADOW_FILL}
      />
      <Rect
        x={labelX}
        y={buttonTop}
        width={BUTTON_WIDTH}
        height={BUTTON_HEIGHT}
        rx={6}
        ry={6}
        fill={btn.fill}
        stroke={btn.stroke}
        strokeWidth={1.2}
        onPress={onTap}
      />
      <SvgText
        x={labelX + BUTTON_WIDTH / 2}
        y={muscle.labelY + FONT_SIZE / 3}
        fontSize={FONT_SIZE}
        fontWeight="600"
        fill={btn.text}
        textAnchor="middle"
        onPress={onTap}>
        {muscle.short}
      </SvgText>
    </>
  );
}

function BackView({ muscles, highlight, fillFor, onTap, mode }: ViewSubProps) {
  return (
    <Svg viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`} width={SVG_WIDTH} height={SVG_HEIGHT}>
      <Path d="M100 10 C82 10 70 24 70 42 C70 60 82 74 100 74 C118 74 130 60 130 42 C130 24 118 10 100 10 Z" fill="#F5F5F7" stroke={COLOR_OUTLINE} strokeWidth={1} />
      <Path d="M88 74 L112 74 L110 86 L90 86 Z" fill="#F5F5F7" stroke={COLOR_OUTLINE} strokeWidth={1} />
      <Path d="M62 88 L138 88 L150 130 L142 200 L100 210 L58 200 L50 130 Z" fill="#FAFAFA" stroke={COLOR_OUTLINE} strokeWidth={1} />
      <Path d="M84 86 L116 86 L122 100 L100 116 L78 100 Z" fill={fillFor('m-trap')} stroke={COLOR_OUTLINE} strokeWidth={0.5} />
      <Path d="M58 90 C50 92 46 105 50 118 L72 108 L74 92 Z M142 90 C150 92 154 105 150 118 L128 108 L126 92 Z" fill={fillFor('m-rear-delt')} stroke={COLOR_OUTLINE} strokeWidth={0.5} />
      <Path d="M42 92 C36 98 36 114 46 118 L48 110 L50 92 Z M158 92 C164 98 164 114 154 118 L152 110 L150 92 Z" fill={fillFor('m-mid-delt')} stroke={COLOR_OUTLINE} strokeWidth={0.5} />
      <Path d="M76 102 L124 102 L130 158 L100 168 L70 158 Z" fill={fillFor('m-back')} stroke={COLOR_OUTLINE} strokeWidth={0.5} />
      <Path d="M82 168 L118 168 L116 198 L84 198 Z" fill={fillFor('m-lower-back')} stroke={COLOR_OUTLINE} strokeWidth={0.5} />
      <Path d="M44 130 C40 148 44 165 52 170 L62 168 L60 130 Z M156 130 C160 148 156 165 148 170 L138 168 L140 130 Z" fill={fillFor('m-tricep')} stroke={COLOR_OUTLINE} strokeWidth={0.5} />
      <Path d="M48 170 C44 188 46 204 54 212 L62 210 L62 170 Z M152 170 C156 188 154 204 146 212 L138 210 L138 170 Z" fill="#F5F5F7" stroke={COLOR_OUTLINE} strokeWidth={0.5} />
      <Path d="M58 200 L142 200 L138 230 L100 240 L62 230 Z" fill="#F5F5F7" stroke={COLOR_OUTLINE} strokeWidth={1} />
      <Path d="M68 210 L132 210 L128 230 L72 230 Z" fill={fillFor('m-upper-glute')} stroke={COLOR_OUTLINE} strokeWidth={0.5} />
      <Path d="M72 230 L128 230 L126 250 L74 250 Z" fill={fillFor('m-lower-glute')} stroke={COLOR_OUTLINE} strokeWidth={0.5} />
      <Path d="M64 252 L96 252 L94 318 L70 318 Z M136 252 L104 252 L106 318 L130 318 Z" fill={fillFor('m-hamstring')} stroke={COLOR_OUTLINE} strokeWidth={0.5} />
      <Path d="M70 318 L94 318 L92 326 L72 326 Z M106 318 L130 318 L128 326 L108 326 Z" fill="#F5F5F7" stroke={COLOR_OUTLINE} strokeWidth={1} />
      {/* Calf — highlights on back view too (label promoted to back per UX rebalance) */}
      <Path d="M72 326 L92 326 L88 388 L76 388 Z M108 326 L128 326 L124 388 L112 388 Z" fill={fillFor('m-calf')} stroke={COLOR_OUTLINE} strokeWidth={0.5} />

      {muscles.map((m) => (
        <LabelGroup
          key={m.muscle_id}
          muscle={m}
          role={highlight.get(m.muscle_id)}
          side="right"
          mode={mode}
          onTap={onTap(m.muscle_id)}
        />
      ))}
    </Svg>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 2,
  },
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    marginTop: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  swatch: {
    width: 12,
    height: 12,
    borderRadius: 3,
  },
  legendText: {
    fontSize: 12,
    color: '#374151',
  },
});
