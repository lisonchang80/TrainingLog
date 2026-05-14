/**
 * MuscleDiagramTagged — Slice 9.7 (ADR-0017 Q11 amendment, layout iteration).
 *
 * Combines body paths + 19 muscle labels arranged around the diagram with
 * leader lines (anatomical-textbook style). Replaces the prior
 * "BodyDiagram + chip ScrollView" pair in the Custom Exercise form so the
 * user can tap muscle labels next to where they live on the body, with both
 * front + back visible at once.
 *
 * Layout:
 *   - Two Svgs side-by-side
 *   - Front view (left): viewBox extended LEFT for 11 chips on the left lane
 *   - Back view (right): viewBox extended RIGHT for 8 chips on the right lane
 *   - Each chip = SvgText + invisible Rect (larger tap target) + SvgLine to anchor
 *   - Tap chip → onTap(muscle_id) — caller cycles unselected → primary → secondary → off
 *
 * Body path data inline-copied from body-diagram.tsx FrontBody / BackBody
 * (~80 lines each). Future refactor: extract paths into a shared "BodyPaths"
 * sub-component that both diagrams render inside their own Svg wrapper.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Polyline, Rect, Text as SvgText } from 'react-native-svg';

import type { MuscleRole } from '@/src/domain/exercise/types';

const COLOR_PRIMARY = '#F26B3A';
const COLOR_SECONDARY = '#7CB6E0';
const COLOR_INACTIVE = '#E5E5EA';
const COLOR_OUTLINE = '#9CA3AF';
const COLOR_LABEL_INACTIVE = '#374151';
const COLOR_LABEL_PRIMARY = '#C2410C';
const COLOR_LABEL_SECONDARY = '#1E40AF';
const COLOR_LEADER = '#9CA3AF';

interface MuscleAnchor {
  muscle_id: string;
  short: string;
  anchorX: number;
  anchorY: number;
  labelX: number;
  labelY: number;
}

// Front view labels — 11 chips on the LEFT lane. labelY spacing 24 to fit fontSize 16.
const FRONT_MUSCLES: readonly MuscleAnchor[] = [
  { muscle_id: 'm-mid-delt', short: '中束', anchorX: 35, anchorY: 105, labelX: -88, labelY: 95 },
  { muscle_id: 'm-front-delt', short: '前束', anchorX: 55, anchorY: 105, labelX: -88, labelY: 119 },
  { muscle_id: 'm-upper-chest', short: '上胸', anchorX: 100, anchorY: 100, labelX: -88, labelY: 143 },
  { muscle_id: 'm-lower-chest', short: '中下胸', anchorX: 100, anchorY: 124, labelX: -88, labelY: 167 },
  { muscle_id: 'm-bicep-long', short: '外側二頭', anchorX: 50, anchorY: 150, labelX: -88, labelY: 191 },
  { muscle_id: 'm-bicep-short', short: '內側二頭', anchorX: 62, anchorY: 150, labelX: -88, labelY: 215 },
  { muscle_id: 'm-forearm', short: '小臂', anchorX: 55, anchorY: 190, labelX: -88, labelY: 239 },
  { muscle_id: 'm-abs', short: '腹肌', anchorX: 100, anchorY: 172, labelX: -88, labelY: 263 },
  { muscle_id: 'm-oblique', short: '側腹', anchorX: 75, anchorY: 170, labelX: -88, labelY: 287 },
  { muscle_id: 'm-quad', short: '股四', anchorX: 80, anchorY: 275, labelX: -88, labelY: 318 },
  { muscle_id: 'm-calf', short: '小腿', anchorX: 84, anchorY: 357, labelX: -88, labelY: 360 },
];

// Back view labels — 8 chips on the RIGHT lane. More vertical breathing room than front.
const BACK_MUSCLES: readonly MuscleAnchor[] = [
  { muscle_id: 'm-trap', short: '斜方肌', anchorX: 100, anchorY: 100, labelX: 212, labelY: 100 },
  { muscle_id: 'm-rear-delt', short: '後束', anchorX: 140, anchorY: 105, labelX: 212, labelY: 130 },
  { muscle_id: 'm-back', short: '背部', anchorX: 100, anchorY: 135, labelX: 212, labelY: 160 },
  { muscle_id: 'm-lower-back', short: '下背', anchorX: 100, anchorY: 183, labelX: 212, labelY: 190 },
  { muscle_id: 'm-tricep', short: '三頭', anchorX: 148, anchorY: 150, labelX: 212, labelY: 220 },
  { muscle_id: 'm-upper-glute', short: '上臀部', anchorX: 100, anchorY: 220, labelX: 212, labelY: 255 },
  { muscle_id: 'm-lower-glute', short: '下臀部', anchorX: 100, anchorY: 240, labelX: 212, labelY: 285 },
  { muscle_id: 'm-hamstring', short: '膕繩', anchorX: 80, anchorY: 285, labelX: 212, labelY: 320 },
];

const fillFor = (highlight: Map<string, MuscleRole>, muscleId: string): string => {
  const role = highlight.get(muscleId);
  if (role === 'primary') return COLOR_PRIMARY;
  if (role === 'secondary') return COLOR_SECONDARY;
  return COLOR_INACTIVE;
};

const labelColorFor = (role: MuscleRole | undefined): string => {
  if (role === 'primary') return COLOR_LABEL_PRIMARY;
  if (role === 'secondary') return COLOR_LABEL_SECONDARY;
  return COLOR_LABEL_INACTIVE;
};

interface MuscleDiagramTaggedProps {
  highlight: Map<string, MuscleRole>;
  onTap: (muscleId: string) => void;
}

export function MuscleDiagramTagged({ highlight, onTap }: MuscleDiagramTaggedProps) {
  const f = (id: string) => fillFor(highlight, id);
  const tapBoundFor = (id: string) => () => onTap(id);

  return (
    <View>
      <View style={styles.row}>
        <FrontView highlight={highlight} fillFor={f} onTap={tapBoundFor} />
        <BackView highlight={highlight} fillFor={f} onTap={tapBoundFor} />
      </View>
      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: COLOR_PRIMARY }]} />
          <Text style={styles.legendText}>主要</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: COLOR_SECONDARY }]} />
          <Text style={styles.legendText}>次要</Text>
        </View>
        <View style={styles.legendItem}>
          <View
            style={[
              styles.swatch,
              { backgroundColor: COLOR_INACTIVE, borderWidth: 1, borderColor: COLOR_OUTLINE },
            ]}
          />
          <Text style={styles.legendText}>未活化</Text>
        </View>
      </View>
    </View>
  );
}

interface ViewSubProps {
  highlight: Map<string, MuscleRole>;
  fillFor: (id: string) => string;
  onTap: (id: string) => () => void;
}

function FrontView({ highlight, fillFor, onTap }: ViewSubProps) {
  return (
    <Svg viewBox="-100 0 300 400" width={170} height={227}>
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

      {FRONT_MUSCLES.map((m) => {
        const role = highlight.get(m.muscle_id);
        // L-shape leader: label right edge → horizontal to above anchor → vertical down/up to anchor
        const labelRightEdge = m.labelX + 70;
        return (
          <React.Fragment key={m.muscle_id}>
            <Polyline
              points={`${labelRightEdge},${m.labelY} ${m.anchorX},${m.labelY} ${m.anchorX},${m.anchorY}`}
              stroke={COLOR_LEADER}
              strokeWidth={0.6}
              fill="none"
            />
            <SvgText
              x={m.labelX}
              y={m.labelY + 6}
              fontSize={16}
              fontWeight="600"
              fill={labelColorFor(role)}
              textAnchor="start">
              {m.short}
            </SvgText>
            <Rect
              x={m.labelX - 2}
              y={m.labelY - 12}
              width={72}
              height={26}
              fill="transparent"
              onPress={onTap(m.muscle_id)}
            />
          </React.Fragment>
        );
      })}
    </Svg>
  );
}

function BackView({ highlight, fillFor, onTap }: ViewSubProps) {
  return (
    <Svg viewBox="0 0 300 400" width={170} height={227}>
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
      <Path d="M72 326 L92 326 L88 388 L76 388 Z M108 326 L128 326 L124 388 L112 388 Z" fill="#F5F5F7" stroke={COLOR_OUTLINE} strokeWidth={0.5} />

      {BACK_MUSCLES.map((m) => {
        const role = highlight.get(m.muscle_id);
        // L-shape leader: label left edge → horizontal to above anchor → vertical down/up to anchor
        const labelLeftEdge = m.labelX - 4;
        return (
          <React.Fragment key={m.muscle_id}>
            <Polyline
              points={`${labelLeftEdge},${m.labelY} ${m.anchorX},${m.labelY} ${m.anchorX},${m.anchorY}`}
              stroke={COLOR_LEADER}
              strokeWidth={0.6}
              fill="none"
            />
            <SvgText
              x={m.labelX}
              y={m.labelY + 6}
              fontSize={16}
              fontWeight="600"
              fill={labelColorFor(role)}
              textAnchor="start">
              {m.short}
            </SvgText>
            <Rect
              x={m.labelX - 2}
              y={m.labelY - 12}
              width={72}
              height={26}
              fill="transparent"
              onPress={onTap(m.muscle_id)}
            />
          </React.Fragment>
        );
      })}
    </Svg>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 4,
  },
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    marginTop: 6,
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
