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
  { mg_id: MG_SHOULDER, short: '肩', anchorX: 48, anchorY: 118, labelX: -8, labelY: 105 },
  { mg_id: MG_CHEST, short: '胸', anchorX: 85, anchorY: 122, labelX: -8, labelY: 135 },
  { mg_id: MG_BICEP, short: '二頭', anchorX: 48, anchorY: 150, labelX: -8, labelY: 165 },
  { mg_id: MG_CORE, short: '核心', anchorX: 100, anchorY: 172, labelX: -8, labelY: 195 },
  { mg_id: MG_FOREARM, short: '小臂', anchorX: 50, anchorY: 192, labelX: -8, labelY: 225 },
  { mg_id: MG_LEG, short: '腿', anchorX: 82, anchorY: 278, labelX: -8, labelY: 280 },
  { mg_id: MG_CALF, short: '小腿', anchorX: 82, anchorY: 360, labelX: -8, labelY: 360 },
];
const BACK_LABELS: readonly MgLabel[] = [
  { mg_id: MG_TRAP, short: '斜方', anchorX: 100, anchorY: 102, labelX: 208, labelY: 100 },
  { mg_id: MG_SHOULDER, short: '肩', anchorX: 152, anchorY: 118, labelX: 208, labelY: 130 },
  { mg_id: MG_BACK, short: '背', anchorX: 85, anchorY: 150, labelX: 208, labelY: 160 },
  { mg_id: MG_TRICEP, short: '三頭', anchorX: 152, anchorY: 150, labelX: 208, labelY: 195 },
  { mg_id: MG_GLUTE, short: '臀', anchorX: 85, anchorY: 240, labelX: 208, labelY: 235 },
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
      {/* Head — oval cranium */}
      <Path
        d="M100 10 C82 10 70 24 70 42 C70 60 82 74 100 74 C118 74 130 60 130 42 C130 24 118 10 100 10 Z"
        fill="#F5F5F7"
        stroke={COLOR_OUTLINE}
        strokeWidth={1}
      />
      {/* Neck — sternocleidomastoid silhouette */}
      <Path
        d="M88 74 L112 74 L113 86 L100 90 L87 86 Z"
        fill="#F5F5F7"
        stroke={COLOR_OUTLINE}
        strokeWidth={1}
      />
      {/* Torso outline — clavicle line, ribcage taper, narrow waist */}
      <Path
        d="M60 92 C70 88 130 88 140 92 C146 100 152 116 152 130 C150 156 146 184 142 200 L100 208 L58 200 C54 184 50 156 48 130 C48 116 54 100 60 92 Z"
        fill="#FAFAFA"
        stroke={COLOR_OUTLINE}
        strokeWidth={1}
      />

      {/* Deltoid (front + mid head as one combined cap hugging the upper shoulder).
          Left cap arches from clavicle insertion over the humeral head down to
          mid-upper-arm; right cap mirrored. Single path so both heads recolor together. */}
      <Path
        d="M60 92 C48 94 40 104 38 122 C38 132 42 138 50 138 C54 128 56 116 60 108 C62 100 62 96 60 92 Z
           M140 92 C152 94 160 104 162 122 C162 132 158 138 150 138 C146 128 144 116 140 108 C138 100 138 96 140 92 Z"
        fill={f(MG_SHOULDER)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />

      {/* Pectoralis major — two lobes (clavicular + sternal heads) with V-shaped
          sternal notch in the centre; each lobe tapers to the armpit insertion. */}
      <Path
        d="M100 96 C92 98 84 102 76 108 C70 114 66 122 64 132 C64 140 70 144 78 144 C86 142 94 138 100 132 C100 120 100 108 100 96 Z
           M100 96 C108 98 116 102 124 108 C130 114 134 122 136 132 C136 140 130 144 122 144 C114 142 106 138 100 132 C100 120 100 108 100 96 Z"
        fill={f(MG_CHEST)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />

      {/* Biceps brachii — long + short head twin bulge per arm.
          Left arm: outer (long head) lobe + inner (short head) lobe, taper at elbow.
          Right mirrored. */}
      <Path
        d="M40 124 C36 132 36 144 38 156 C40 164 44 170 48 172 C52 168 54 158 54 148 C54 138 50 130 46 126 C44 124 42 124 40 124 Z
           M48 130 C46 138 46 150 50 162 C54 168 58 170 60 168 C62 160 60 150 58 140 C56 132 52 128 50 128 C49 128 48 129 48 130 Z
           M160 124 C164 132 164 144 162 156 C160 164 156 170 152 172 C148 168 146 158 146 148 C146 138 150 130 154 126 C156 124 158 124 160 124 Z
           M152 130 C154 138 154 150 150 162 C146 168 142 170 140 168 C138 160 140 150 142 140 C144 132 148 128 150 128 C151 128 152 129 152 130 Z"
        fill={f(MG_BICEP)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />

      {/* Brachioradialis — bulge near elbow tapering to wrist (both forearms). */}
      <Path
        d="M44 172 C40 180 40 192 44 202 C48 210 54 214 58 212 C60 204 60 192 58 182 C56 176 52 172 48 172 Z
           M156 172 C160 180 160 192 156 202 C152 210 146 214 142 212 C140 204 140 192 142 182 C144 176 148 172 152 172 Z"
        fill={f(MG_FOREARM)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />

      {/* Core — rectus abdominis 6-pack columnar segmentation + lateral obliques wings.
          Single combined path: outer obliques wing on each side, then central
          rectus block (drawn as one filled shape — the underlying linea alba /
          tendinous intersections are visual; we keep one fill colour). */}
      <Path
        d="M72 140 C70 150 70 168 72 188 C74 196 80 200 88 200 L88 144 C82 142 76 140 72 140 Z
           M128 140 C130 150 130 168 128 188 C126 196 120 200 112 200 L112 144 C118 142 124 140 128 140 Z
           M88 144 L112 144 L112 200 L88 200 Z"
        fill={f(MG_CORE)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />

      {/* Hip / pelvis — iliac crest curve */}
      <Path
        d="M58 200 C62 212 70 224 80 232 L120 232 C130 224 138 212 142 200 L100 210 Z"
        fill="#F5F5F7"
        stroke={COLOR_OUTLINE}
        strokeWidth={1}
      />

      {/* Quadriceps — vastus medialis (inner teardrop) + vastus lateralis (outer
          bulge) + rectus femoris (centre column) per leg. One path, one fill. */}
      <Path
        d="M68 234 C62 250 60 280 64 312 C66 318 70 320 76 318 C78 290 82 260 84 240 C80 236 74 234 68 234 Z
           M84 240 C82 264 82 296 86 316 L98 316 C100 296 100 268 100 244 C96 240 90 238 84 240 Z
           M132 234 C138 250 140 280 136 312 C134 318 130 320 124 318 C122 290 118 260 116 240 C120 236 126 234 132 234 Z
           M116 240 C118 264 118 296 114 316 L102 316 C100 296 100 268 100 244 C104 240 110 238 116 240 Z"
        fill={f(MG_LEG)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />

      {/* Knee */}
      <Path
        d="M70 318 C72 322 76 326 82 326 L92 326 C94 322 94 320 92 318 Z
           M108 318 C108 320 108 322 110 326 L120 326 C124 326 128 322 130 318 Z"
        fill="#F5F5F7"
        stroke={COLOR_OUTLINE}
        strokeWidth={1}
      />

      {/* Gastrocnemius — two-headed diamond bulge near knee, soleus underline taper
          to ankle. Front view shows the calf silhouette curving outward then in. */}
      <Path
        d="M74 326 C70 340 70 356 74 370 C76 378 80 384 84 386 L88 386 C90 376 92 360 92 344 C92 336 90 330 86 326 Z
           M108 326 C104 330 104 336 104 344 C104 360 106 376 108 386 L114 386 C118 384 122 378 124 370 C128 356 128 340 126 326 Z"
        fill={f(MG_CALF)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />

      {/* Ankle / foot */}
      <Path
        d="M76 386 L92 386 L94 396 L74 396 Z M108 386 L124 386 L126 396 L106 396 Z"
        fill="#FAFAFA"
        stroke={COLOR_OUTLINE}
        strokeWidth={1}
      />

      <MgLabels labels={FRONT_LABELS} mgCount={mgCount} textAnchor="end" />
    </Svg>
  );
}

function BackBody({ mgQuintile, mgCount }: BodyHeatmapProps) {
  const f = (mg: string) => fillForMg(mg, mgQuintile);
  return (
    <Svg viewBox="0 0 280 400" width={160} height={228}>
      {/* Head — occipital cranium */}
      <Path
        d="M100 10 C82 10 70 24 70 42 C70 60 82 74 100 74 C118 74 130 60 130 42 C130 24 118 10 100 10 Z"
        fill="#F5F5F7"
        stroke={COLOR_OUTLINE}
        strokeWidth={1}
      />
      {/* Neck — nape silhouette */}
      <Path
        d="M88 74 L112 74 L113 86 L100 90 L87 86 Z"
        fill="#F5F5F7"
        stroke={COLOR_OUTLINE}
        strokeWidth={1}
      />
      {/* Torso outline — broad back tapering to narrower waist */}
      <Path
        d="M60 92 C70 88 130 88 140 92 C146 100 152 116 152 130 C150 156 146 184 142 200 L100 208 L58 200 C54 184 50 156 48 130 C48 116 54 100 60 92 Z"
        fill="#FAFAFA"
        stroke={COLOR_OUTLINE}
        strokeWidth={1}
      />

      {/* Trapezius — upper trap kite from neck base to mid-shoulder + lower trap
          diamond tapering down between scapulae to mid-back. Single combined path. */}
      <Path
        d="M100 86 C90 88 82 92 76 100 C74 104 76 108 80 110 C88 108 94 106 100 104 C106 106 112 108 120 110 C124 108 126 104 124 100 C118 92 110 88 100 86 Z
           M100 104 C92 108 86 116 84 126 C90 132 96 136 100 142 C104 136 110 132 116 126 C114 116 108 108 100 104 Z
           M100 142 C96 152 94 164 96 178 C98 184 100 186 100 186 C100 186 102 184 104 178 C106 164 104 152 100 142 Z"
        fill={f(MG_TRAP)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />

      {/* Posterior deltoid — rear-head arc hugging upper shoulder cap.
          Same MG_SHOULDER fill so front+rear views recolor together. */}
      <Path
        d="M60 92 C48 94 40 104 38 122 C38 132 42 138 50 138 C54 128 56 116 60 108 C62 100 62 96 60 92 Z
           M140 92 C152 94 160 104 162 122 C162 132 158 138 150 138 C146 128 144 116 140 108 C138 100 138 96 140 92 Z"
        fill={f(MG_SHOULDER)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />

      {/* Latissimus dorsi — V-shape from armpits sweeping inward to waist +
          lower back (erector spinae columns) as separate sub-region in the SAME path.
          Left lat wing, right lat wing, then erector columns flanking the spine. */}
      <Path
        d="M62 108 C58 130 60 156 70 178 C78 186 88 188 96 184 C92 158 86 134 80 116 C76 110 70 108 62 108 Z
           M138 108 C142 130 140 156 130 178 C122 186 112 188 104 184 C108 158 114 134 120 116 C124 110 130 108 138 108 Z
           M94 144 C92 160 92 180 94 196 L98 196 L98 144 Z
           M106 144 C108 160 108 180 106 196 L102 196 L102 144 Z"
        fill={f(MG_BACK)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />

      {/* Triceps brachii — horseshoe: long head (medial column) + lateral head
          (outer bulge) + medial head (lower visible patch near elbow). Per arm. */}
      <Path
        d="M40 124 C36 134 36 148 38 160 C40 168 44 172 48 172 C50 162 52 150 52 140 C52 132 48 126 44 124 Z
           M50 130 C48 142 48 156 50 168 C54 172 58 172 60 168 C60 156 58 142 56 132 C54 128 52 128 50 130 Z
           M48 168 C50 174 54 178 58 178 C60 176 60 174 60 172 C56 170 52 168 48 168 Z
           M160 124 C164 134 164 148 162 160 C160 168 156 172 152 172 C150 162 148 150 148 140 C148 132 152 126 156 124 Z
           M150 130 C152 142 152 156 150 168 C146 172 142 172 140 168 C140 156 142 142 144 132 C146 128 148 128 150 130 Z
           M152 168 C150 174 146 178 142 178 C140 176 140 174 140 172 C144 170 148 168 152 168 Z"
        fill={f(MG_TRICEP)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />

      {/* Forearm (back / extensor compartment) — bulge near elbow tapering. */}
      <Path
        d="M44 178 C40 188 40 198 44 208 C48 214 54 216 58 214 C60 206 60 196 58 188 C56 182 52 178 48 178 Z
           M156 178 C160 188 160 198 156 208 C152 214 146 216 142 214 C140 206 140 196 142 188 C144 182 148 178 152 178 Z"
        fill={f(MG_FOREARM)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />

      {/* Hip / pelvic outline */}
      <Path
        d="M58 200 C62 210 68 218 76 222 L124 222 C132 218 138 210 142 200 L100 208 Z"
        fill="#F5F5F7"
        stroke={COLOR_OUTLINE}
        strokeWidth={1}
      />

      {/* Gluteus maximus — rounded heart-like silhouette: two domes meeting at
          gluteal cleft. Single combined path with the cleft drawn into the contour. */}
      <Path
        d="M76 218 C68 222 62 232 62 244 C62 254 66 262 74 262 C84 262 92 256 98 244 C100 238 100 230 100 224 C96 220 88 218 76 218 Z
           M124 218 C132 222 138 232 138 244 C138 254 134 262 126 262 C116 262 108 256 102 244 C100 238 100 230 100 224 C104 220 112 218 124 218 Z"
        fill={f(MG_GLUTE)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />

      {/* Hamstrings — biceps femoris (outer) + semitendinosus / semimembranosus
          (inner) per leg. Single fill, full back-of-thigh coverage. */}
      <Path
        d="M68 262 C64 280 62 304 66 314 C70 318 74 318 78 316 C82 296 86 278 88 264 C84 262 76 262 68 262 Z
           M88 264 C86 282 86 304 90 316 L98 316 C100 296 100 278 100 264 C96 262 92 262 88 264 Z
           M132 262 C136 280 138 304 134 314 C130 318 126 318 122 316 C118 296 114 278 112 264 C116 262 124 262 132 262 Z
           M112 264 C114 282 114 304 110 316 L102 316 C100 296 100 278 100 264 C104 262 108 262 112 264 Z"
        fill={f(MG_LEG)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />

      {/* Knee (back of knee — popliteal) */}
      <Path
        d="M70 318 C72 322 76 326 82 326 L92 326 C94 322 94 320 92 318 Z
           M108 318 C108 320 108 322 110 326 L120 326 C124 326 128 322 130 318 Z"
        fill="#F5F5F7"
        stroke={COLOR_OUTLINE}
        strokeWidth={1}
      />

      {/* Gastrocnemius — two-headed diamond bulge prominent on back view. */}
      <Path
        d="M74 326 C68 340 68 358 74 372 C78 380 82 384 86 386 L90 386 C92 372 94 354 94 340 C94 332 90 328 86 326 Z
           M108 326 C106 328 106 332 106 340 C106 354 108 372 110 386 L114 386 C118 384 122 380 126 372 C132 358 132 340 126 326 Z"
        fill={f(MG_CALF)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />

      {/* Ankle / heel */}
      <Path
        d="M76 386 L92 386 L94 396 L74 396 Z M108 386 L124 386 L126 396 L106 396 Z"
        fill="#FAFAFA"
        stroke={COLOR_OUTLINE}
        strokeWidth={1}
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
