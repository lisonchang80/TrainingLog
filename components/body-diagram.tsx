/**
 * Body Diagram — front + back human silhouette with 19 individual muscle paths.
 *
 * Each `<Path>` carries a unique `id` (matching `muscle.id` from the v006 seed)
 * so the renderer can paint each muscle independently based on a
 * `muscle_id → role` highlight map.
 *
 * Per ADR-0010:
 *   - primary muscles use a warm fill (#F26B3A — orange)
 *   - secondary muscles use a cool fill (#7CB6E0 — light blue)
 *   - inactive muscles fall back to a light grey (#E5E5EA)
 *
 * Geometry is stylised — not anatomically perfect — so 19 paths fit two
 * 200×400 viewBoxes and stay legible on a phone screen. The component
 * exposes `id` attributes per ADR-0010 acceptance criterion #6 so a future
 * SwiftUI Watch port can re-use the same path data via the same IDs.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import type { MuscleRole } from '@/src/domain/exercise/types';

const COLOR_PRIMARY = '#F26B3A';
const COLOR_SECONDARY = '#7CB6E0';
const COLOR_INACTIVE = '#E5E5EA';
const COLOR_OUTLINE = '#9CA3AF';

const fillFor = (
  highlight: Map<string, MuscleRole>,
  muscleId: string
): string => {
  const role = highlight.get(muscleId);
  if (role === 'primary') return COLOR_PRIMARY;
  if (role === 'secondary') return COLOR_SECONDARY;
  return COLOR_INACTIVE;
};

interface BodyDiagramProps {
  highlight: Map<string, MuscleRole>;
  /**
   * Optional tap-to-cycle handler. When provided, each muscle path becomes
   * pressable; the caller decides how to mutate role (e.g. unselected →
   * primary → secondary → unselected).
   */
  onMusclePress?: (muscleId: string) => void;
}

const pressHandlerFor = (onMusclePress?: (id: string) => void) =>
  onMusclePress ? (id: string) => () => onMusclePress(id) : () => undefined;

/**
 * Front view — 11 muscle paths:
 *   m-upper-chest, m-lower-chest, m-front-delt, m-mid-delt, m-bicep-long,
 *   m-bicep-short, m-forearm, m-quad, m-abs, m-oblique, m-calf
 */
function FrontBody({ highlight, onMusclePress }: BodyDiagramProps) {
  const f = (id: string) => fillFor(highlight, id);
  const mp = pressHandlerFor(onMusclePress);
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

      {/* Front delt L/R */}
      <Path
        id="m-front-delt"
        d="M58 90 C50 92 46 105 50 118 L70 110 L72 92 Z M142 90 C150 92 154 105 150 118 L130 110 L128 92 Z"
        fill={f('m-front-delt')}
        onPress={mp('m-front-delt')}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Mid delt L/R (outer cap — lateral to front-delt, at shoulder top) */}
      <Path
        id="m-mid-delt"
        d="M42 92 C36 98 36 114 46 118 L48 110 L50 92 Z M158 92 C164 98 164 114 154 118 L152 110 L150 92 Z"
        fill={f('m-mid-delt')}
        onPress={mp('m-mid-delt')}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />

      {/* Upper chest (clavicular) */}
      <Path
        id="m-upper-chest"
        d="M72 92 L128 92 L122 110 L78 110 Z"
        fill={f('m-upper-chest')}
        onPress={mp('m-upper-chest')}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Lower chest (sternal) */}
      <Path
        id="m-lower-chest"
        d="M78 110 L122 110 L118 138 L100 144 L82 138 Z"
        fill={f('m-lower-chest')}
        onPress={mp('m-lower-chest')}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />

      {/* Bicep long head L/R (lateral / outer side of upper arm) */}
      <Path
        id="m-bicep-long"
        d="M44 130 C40 145 42 160 50 168 L58 168 L60 145 L52 130 Z M156 130 C160 145 158 160 150 168 L142 168 L140 145 L148 130 Z"
        fill={f('m-bicep-long')}
        onPress={mp('m-bicep-long')}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Bicep short head L/R (medial / inner side, slightly inside long head) */}
      <Path
        id="m-bicep-short"
        d="M58 130 L62 130 L64 168 L60 168 Z M138 130 L142 130 L140 168 L136 168 Z"
        fill={f('m-bicep-short')}
        onPress={mp('m-bicep-short')}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />

      {/* Forearm L/R */}
      <Path
        id="m-forearm"
        d="M48 168 C44 184 46 200 54 210 L62 210 L62 168 Z M152 168 C156 184 154 200 146 210 L138 210 L138 168 Z"
        fill={f('m-forearm')}
        onPress={mp('m-forearm')}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />

      {/* Abs (rectus abdominis) — vertical pillar */}
      <Path
        id="m-abs"
        d="M86 144 L114 144 L112 200 L88 200 Z"
        fill={f('m-abs')}
        onPress={mp('m-abs')}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Obliques L/R (flanks) */}
      <Path
        id="m-oblique"
        d="M70 138 L86 144 L88 200 L74 198 Z M130 138 L114 144 L112 200 L126 198 Z"
        fill={f('m-oblique')}
        onPress={mp('m-oblique')}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />

      {/* Hip / pelvis outline */}
      <Path
        d="M58 200 L142 200 L138 230 L100 240 L62 230 Z"
        fill="#F5F5F7"
        stroke={COLOR_OUTLINE}
        strokeWidth={1}
      />

      {/* Quads L/R */}
      <Path
        id="m-quad"
        d="M64 232 L98 232 L94 318 L70 318 Z M136 232 L102 232 L106 318 L130 318 Z"
        fill={f('m-quad')}
        onPress={mp('m-quad')}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />

      {/* Knee */}
      <Path d="M70 318 L94 318 L92 326 L72 326 Z M106 318 L130 318 L128 326 L108 326 Z" fill="#F5F5F7" stroke={COLOR_OUTLINE} strokeWidth={1} />

      {/* Calves (front view) */}
      <Path
        id="m-calf"
        d="M72 326 L92 326 L88 388 L76 388 Z M108 326 L128 326 L124 388 L112 388 Z"
        fill={f('m-calf')}
        onPress={mp('m-calf')}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
    </Svg>
  );
}

/**
 * Back view — 8 muscle paths:
 *   m-trap, m-back (lat), m-lower-back, m-rear-delt, m-tricep,
 *   m-upper-glute, m-lower-glute, m-hamstring
 */
function BackBody({ highlight, onMusclePress }: BodyDiagramProps) {
  const f = (id: string) => fillFor(highlight, id);
  const mp = pressHandlerFor(onMusclePress);
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

      {/* Trap (upper back, between shoulders) */}
      <Path
        id="m-trap"
        d="M84 86 L116 86 L122 100 L100 116 L78 100 Z"
        fill={f('m-trap')}
        onPress={mp('m-trap')}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />

      {/* Rear delt L/R */}
      <Path
        id="m-rear-delt"
        d="M58 90 C50 92 46 105 50 118 L72 108 L74 92 Z M142 90 C150 92 154 105 150 118 L128 108 L126 92 Z"
        fill={f('m-rear-delt')}
        onPress={mp('m-rear-delt')}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Mid delt L/R (back view — outer cap, lateral to rear-delt) */}
      <Path
        id="m-mid-delt"
        d="M42 92 C36 98 36 114 46 118 L48 110 L50 92 Z M158 92 C164 98 164 114 154 118 L152 110 L150 92 Z"
        fill={f('m-mid-delt')}
        onPress={mp('m-mid-delt')}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />

      {/* Lats / back (broad mid-back) */}
      <Path
        id="m-back"
        d="M76 102 L124 102 L130 158 L100 168 L70 158 Z"
        fill={f('m-back')}
        onPress={mp('m-back')}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />

      {/* Lower back (lumbar) */}
      <Path
        id="m-lower-back"
        d="M82 168 L118 168 L116 198 L84 198 Z"
        fill={f('m-lower-back')}
        onPress={mp('m-lower-back')}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />

      {/* Tricep L/R (back of upper arm) */}
      <Path
        id="m-tricep"
        d="M44 130 C40 148 44 165 52 170 L62 168 L60 130 Z M156 130 C160 148 156 165 148 170 L138 168 L140 130 Z"
        fill={f('m-tricep')}
        onPress={mp('m-tricep')}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />

      {/* Forearm (back) — share id with front; rendered greyed if not active */}
      <Path
        d="M48 170 C44 188 46 204 54 212 L62 210 L62 170 Z M152 170 C156 188 154 204 146 212 L138 210 L138 170 Z"
        fill="#F5F5F7"
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

      {/* Upper glute */}
      <Path
        id="m-upper-glute"
        d="M68 210 L132 210 L128 230 L72 230 Z"
        fill={f('m-upper-glute')}
        onPress={mp('m-upper-glute')}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Lower glute */}
      <Path
        id="m-lower-glute"
        d="M72 230 L128 230 L126 250 L74 250 Z"
        fill={f('m-lower-glute')}
        onPress={mp('m-lower-glute')}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />

      {/* Hamstrings L/R */}
      <Path
        id="m-hamstring"
        d="M64 252 L96 252 L94 318 L70 318 Z M136 252 L104 252 L106 318 L130 318 Z"
        fill={f('m-hamstring')}
        onPress={mp('m-hamstring')}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />

      {/* Knee */}
      <Path d="M70 318 L94 318 L92 326 L72 326 Z M106 318 L130 318 L128 326 L108 326 Z" fill="#F5F5F7" stroke={COLOR_OUTLINE} strokeWidth={1} />

      {/* Calf (back) — fall-through greyed; primary calf path lives in front view */}
      <Path
        d="M72 326 L92 326 L88 388 L76 388 Z M108 326 L128 326 L124 388 L112 388 Z"
        fill="#F5F5F7"
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
    </Svg>
  );
}

/**
 * BodyDiagram — composes front + back view side by side.
 * Wraps the SVG in a `View` so it inherits parent layout styles.
 */
export function BodyDiagram({ highlight, onMusclePress }: BodyDiagramProps) {
  return (
    <View style={styles.row}>
      <View style={styles.column}>
        <Text style={styles.label}>正面</Text>
        <FrontBody highlight={highlight} onMusclePress={onMusclePress} />
      </View>
      <View style={styles.column}>
        <Text style={styles.label}>背面</Text>
        <BackBody highlight={highlight} onMusclePress={onMusclePress} />
      </View>
    </View>
  );
}

/** Legend chip showing primary / secondary color reference. */
export function BodyDiagramLegend() {
  return (
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
        <View style={[styles.swatch, { backgroundColor: COLOR_INACTIVE, borderWidth: 1, borderColor: COLOR_OUTLINE }]} />
        <Text style={styles.legendText}>未活化</Text>
      </View>
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
