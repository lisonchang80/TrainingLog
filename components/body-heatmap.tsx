/**
 * Body Heatmap — front + back anatomical M-layer human silhouette,
 * each muscle filled by per-Session frequency quintile.
 *
 * Round 3 redraw (2026-05-23, variant C "faithful trace"):
 *   - Complete redraw against `/tmp/anatomy-spec-r3.md` reference image.
 *   - Modest athletic male proportions (NOT bodybuilder); shoulders ~108 wide,
 *     V-taper torso, V-taper lats, twin-lobed biceps, 6-pack abs, twin-headed
 *     calves, 5-finger hands, short crew-cut hair, minimal face.
 *   - Subtle 3D depth via inner-shadow + highlight-rim layers (toned-down
 *     from variant B to avoid mannequin look).
 *   - viewBox per figure: 0 0 200 520, centerline x=100, ground y=510.
 *
 * Reference-style fidelity:
 *   - Body silhouette is one continuous Path per figure (front / back).
 *   - Each muscle is a separate Path with `fill={f(M_*)}` for quintile colors.
 *   - 6-pack abs use `fillRule="evenodd"` with linea alba holes.
 *   - Shadow + highlight overlays use semi-transparent layers, not full muscle
 *     fills, so the quintile color reads through.
 *
 * Public API (unchanged):
 *   - export type Quintile = 0 | 1 | 2 | 3 | 4
 *   - export interface BodyHeatmapProps { mQuintile, mCount? }
 *   - export function BodyHeatmap(props): JSX.Element
 *   - export function BodyHeatmapLegend(): JSX.Element
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
import Svg, { Line as SvgLine, Path, Text as SvgText } from 'react-native-svg';

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

// ---------------------------------------------------------------------------
// Color tokens
// ---------------------------------------------------------------------------

const COLOR_OUTLINE = '#9CA3AF';
const COLOR_STRIATION = 'rgba(60,60,75,0.35)';
const COLOR_SKIN = '#F5F5F7';
const COLOR_SHADOW = 'rgba(20,20,30,0.15)'; // 3D depth inner shadow (toned down)
const COLOR_HIGHLIGHT = 'rgba(255,255,255,0.18)'; // 3D depth highlight rim
const COLOR_HAIR = '#3F3A36';
const QUINTILE_COLORS: readonly string[] = [
  '#BFDBFE', // Q1 cool blue
  '#93C5FD', // Q2 light blue
  '#FCD34D', // Q3 yellow
  '#FB923C', // Q4 warm orange
  '#EF4444', // Q5 warm red
];
const COLOR_ZERO = '#E5E7EB';

export type Quintile = 0 | 1 | 2 | 3 | 4;

interface BodyHeatmapProps {
  /**
   * m_id → quintile bucket (0..4) for non-zero muscles.
   * Muscles absent from this map render in zero-grey.
   */
  mQuintile: Map<string, Quintile>;
  /**
   * Optional m_id → per-Session frequency. When provided, labels render as
   * "MuscleName · N"; otherwise show just the muscle name.
   */
  mCount?: Map<string, number>;
}

const fillForM = (m: string, mQuintile: Map<string, Quintile>): string => {
  const q = mQuintile.get(m);
  if (q == null) return COLOR_ZERO;
  return QUINTILE_COLORS[q];
};

// ---------------------------------------------------------------------------
// Label callout types
// ---------------------------------------------------------------------------

interface MuscleLabel {
  m_id: string;
  anchorX: number;
  anchorY: number;
  labelX: number;
  labelY: number;
}

// Anchor coords point to muscle bellies in the new viewBox 0..200 × 0..520.
// labelX < 0 on front view (labels to the LEFT), labelX > 200 on back view.
const FRONT_LABELS: readonly MuscleLabel[] = [
  { m_id: M_FRONT_DELT, anchorX: 56, anchorY: 118, labelX: -16, labelY: 110 },
  { m_id: M_UPPER_CHEST, anchorX: 82, anchorY: 115, labelX: -16, labelY: 132 },
  { m_id: M_LOWER_CHEST, anchorX: 82, anchorY: 142, labelX: -16, labelY: 154 },
  { m_id: M_BICEP_LONG, anchorX: 42, anchorY: 158, labelX: -16, labelY: 176 },
  { m_id: M_BICEP_SHORT, anchorX: 52, anchorY: 162, labelX: -16, labelY: 198 },
  { m_id: M_ABS, anchorX: 100, anchorY: 188, labelX: -16, labelY: 220 },
  { m_id: M_OBLIQUE, anchorX: 76, anchorY: 192, labelX: -16, labelY: 244 },
  { m_id: M_FOREARM, anchorX: 38, anchorY: 210, labelX: -16, labelY: 268 },
  { m_id: M_QUAD, anchorX: 84, anchorY: 310, labelX: -16, labelY: 320 },
  { m_id: M_CALF, anchorX: 82, anchorY: 420, labelX: -16, labelY: 410 },
];

const BACK_LABELS: readonly MuscleLabel[] = [
  { m_id: M_TRAP, anchorX: 100, anchorY: 110, labelX: 220, labelY: 102 },
  { m_id: M_REAR_DELT, anchorX: 60, anchorY: 118, labelX: 220, labelY: 122 },
  { m_id: M_MID_DELT, anchorX: 46, anchorY: 138, labelX: 220, labelY: 144 },
  { m_id: M_BACK, anchorX: 78, anchorY: 168, labelX: 220, labelY: 168 },
  { m_id: M_TRICEP, anchorX: 44, anchorY: 156, labelX: 220, labelY: 190 },
  { m_id: M_LOWER_BACK, anchorX: 100, anchorY: 240, labelX: 220, labelY: 212 },
  { m_id: M_UPPER_GLUTE, anchorX: 86, anchorY: 268, labelX: 220, labelY: 234 },
  { m_id: M_LOWER_GLUTE, anchorX: 86, anchorY: 298, labelX: 220, labelY: 256 },
  { m_id: M_HAMSTRING, anchorX: 84, anchorY: 340, labelX: 220, labelY: 300 },
  { m_id: M_CALF, anchorX: 84, anchorY: 420, labelX: 220, labelY: 410 },
];

// ---------------------------------------------------------------------------
// Label rendering helper
// ---------------------------------------------------------------------------

function MuscleLabels({
  labels,
  mCount,
  textAnchor,
}: {
  labels: readonly MuscleLabel[];
  mCount?: Map<string, number>;
  textAnchor: 'start' | 'end';
}) {
  return (
    <>
      {labels.map((l) => {
        const c = mCount?.get(l.m_id);
        const display = tMuscle(l.m_id);
        const text = c != null && c > 0 ? `${display}·${c}` : display;
        return (
          <React.Fragment key={l.m_id}>
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
              fontSize={10}
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

// ---------------------------------------------------------------------------
// Shared silhouette paths
// ---------------------------------------------------------------------------
//
// Body silhouette per spec landmarks:
//   head top y=12, eyebrow y=38, chin y=70, neck bottom y=90,
//   shoulder peak y=96 width 108 → 54..146,
//   bicep widest y=152 → x=-3..203 (arms slightly abducted),
//   waist y=188 width 78 → 61..139,
//   navel y=210 width 75 → 62..138,
//   hip crest y=240 width 92 → 54..146,
//   crotch y=270 (thigh inside x=80..120),
//   mid-thigh y=320 width 55/leg,
//   knee y=380 width 38/leg,
//   mid-calf y=430 width 38/leg,
//   ankle y=490 width 22/leg,
//   foot y=510 width 30/leg.
//
// To avoid arms extending to x=-3 / 203 (which would clip the SVG viewBox
// 0..200) we tuck the arms slightly inward to x=4 / 196 at bicep widest;
// this keeps shoulders at the spec-mandated 108 width while staying within
// the viewBox.

const FRONT_SILHOUETTE_D = `
  M 100 12
  C 86 12 76 22 76 38
  C 76 56 86 70 100 70
  C 114 70 124 56 124 38
  C 124 22 114 12 100 12
  Z
  M 88 70
  L 88 88
  C 80 90 70 92 60 94
  C 50 96 46 100 46 110
  C 30 116 16 126 10 142
  C 6 156 6 172 8 188
  L 18 212
  L 22 228
  L 26 238
  L 30 250
  C 30 250 28 254 28 258
  C 28 266 30 274 34 282
  L 38 296
  L 42 304
  L 42 232
  C 46 224 48 218 50 210
  C 54 196 58 184 61 174
  L 61 188
  L 62 210
  L 54 240
  L 50 254
  L 48 270
  L 50 290
  L 58 320
  L 64 380
  L 64 430
  L 70 490
  L 68 510
  L 100 510
  L 132 510
  L 130 490
  L 136 430
  L 136 380
  L 142 320
  L 150 290
  L 152 270
  L 150 254
  L 146 240
  L 138 210
  L 139 188
  L 139 174
  C 142 184 146 196 150 210
  C 152 218 154 224 158 232
  L 158 304
  L 162 296
  L 166 282
  C 170 274 172 266 172 258
  C 172 254 170 250 170 250
  L 174 238
  L 178 228
  L 182 212
  L 192 188
  C 194 172 194 156 190 142
  C 184 126 170 116 154 110
  C 154 100 150 96 140 94
  C 130 92 120 90 112 88
  L 112 70
  Z
`;

const BACK_SILHOUETTE_D = FRONT_SILHOUETTE_D; // same skeleton from behind

// Hand 5-finger silhouettes (front view, palms forward).
// Anchored just below forearm wrist. Width ~25 height ~35.
const FRONT_HAND_LEFT_D = `
  M 28 232
  C 22 234 18 240 16 248
  L 14 270
  C 14 274 16 276 18 274
  L 20 254
  M 20 254
  L 19 274
  C 19 276 21 278 23 276
  L 23 254
  M 23 254
  L 23 278
  C 23 280 25 282 27 280
  L 27 256
  M 27 256
  L 28 280
  C 28 282 30 284 32 282
  L 32 258
  M 32 258
  C 36 258 40 254 42 250
  L 42 232
  Z
`;
const FRONT_HAND_RIGHT_D = `
  M 172 232
  C 178 234 182 240 184 248
  L 186 270
  C 186 274 184 276 182 274
  L 180 254
  M 180 254
  L 181 274
  C 181 276 179 278 177 276
  L 177 254
  M 177 254
  L 177 278
  C 177 280 175 282 173 280
  L 173 256
  M 173 256
  L 172 280
  C 172 282 170 284 168 282
  L 168 258
  M 168 258
  C 164 258 160 254 158 250
  L 158 232
  Z
`;

// Back-view hands: palm faces backward, fingers slightly closed.
const BACK_HAND_LEFT_D = FRONT_HAND_LEFT_D;
const BACK_HAND_RIGHT_D = FRONT_HAND_RIGHT_D;

// ---------------------------------------------------------------------------
// Front view — 12 distinct M-paths + striations + 3D shading
// ---------------------------------------------------------------------------

function FrontBody({ mQuintile, mCount }: BodyHeatmapProps) {
  const f = (m: string) => fillForM(m, mQuintile);
  return (
    <Svg viewBox="-50 0 300 520" width={180} height={312}>
      {/* ===== Hair — short crew cut, sits on top of cranium ===== */}
      <Path
        d="M 76 38 C 78 22 90 14 100 14 C 110 14 122 22 124 38 C 122 32 116 28 110 28 C 106 30 100 30 100 30 C 100 30 94 30 90 28 C 84 28 78 32 76 38 Z"
        fill={COLOR_HAIR}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Slight front bang */}
      <Path
        d="M 88 32 C 94 36 106 36 112 32"
        stroke={COLOR_OUTLINE}
        strokeWidth={0.4}
        fill="none"
      />

      {/* ===== Body silhouette ===== */}
      <Path
        d={FRONT_SILHOUETTE_D}
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={1}
      />

      {/* ===== Minimal face — nose line + jaw ===== */}
      <Path
        d="M 100 42 L 100 54 L 96 56
           M 94 60 C 98 64 102 64 106 60"
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
        fill="none"
      />
      {/* SCM neck ropes (sternocleidomastoid, clavicle to ear) */}
      <Path
        d="M 90 70 C 92 78 92 84 88 90
           M 110 70 C 108 78 108 84 112 90"
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ===== Hands — 5 visible fingers ===== */}
      <Path
        d={FRONT_HAND_LEFT_D}
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.7}
      />
      <Path
        d={FRONT_HAND_RIGHT_D}
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.7}
      />

      {/* ===== Trapezius (front yoke — neck to shoulder corner) ===== */}
      <Path
        d="M 88 90 C 82 92 72 96 60 100 L 54 100 L 100 96 L 146 100 L 140 100 C 128 96 118 92 112 90 L 100 92 Z"
        fill={f(M_TRAP)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.6}
      />
      {/* Trap fiber striations (radial from neck base) */}
      <Path
        d="M 92 92 L 70 100
           M 100 94 L 60 100
           M 108 92 L 130 100
           M 100 94 L 140 100"
        stroke={COLOR_STRIATION}
        strokeWidth={0.6}
        fill="none"
      />

      {/* ===== Front Deltoid (anterior cap, left + right) =====
              Stays well INSIDE shoulder (peak 54..146). ===== */}
      <Path
        d="M 54 100 C 48 106 46 116 48 130 L 54 140 C 60 134 64 124 66 114 L 64 106 Z
           M 146 100 C 152 106 154 116 152 130 L 146 140 C 140 134 136 124 134 114 L 136 106 Z"
        fill={f(M_FRONT_DELT)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Front delt arc striations (clavicle insertion → outer) */}
      <Path
        d="M 52 108 C 56 118 60 128 62 134
           M 148 108 C 144 118 140 128 138 134"
        stroke={COLOR_STRIATION}
        strokeWidth={0.6}
        fill="none"
      />
      {/* Front delt highlight rim */}
      <Path
        d="M 55 110 C 53 120 53 128 56 134
           M 145 110 C 147 120 147 128 144 134"
        stroke={COLOR_HIGHLIGHT}
        strokeWidth={1.5}
        fill="none"
      />

      {/* ===== Mid Deltoid (lateral strip — outside of shoulder) ===== */}
      <Path
        d="M 48 124 L 42 140 L 42 160 L 48 158 L 52 140 Z
           M 152 124 L 158 140 L 158 160 L 152 158 L 148 140 Z"
        fill={f(M_MID_DELT)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />

      {/* ===== Upper Chest (pec clavicular head, fans down + in from clavicle) =====
              CRITICAL: vertices stay inside x=60..140. ===== */}
      <Path
        d="M 100 100 L 68 108 C 66 116 66 122 68 124 L 96 118 L 100 116 Z
           M 100 100 L 132 108 C 134 116 134 122 132 124 L 104 118 L 100 116 Z"
        fill={f(M_UPPER_CHEST)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Upper-chest fanning striations */}
      <Path
        d="M 76 110 L 96 117
           M 84 108 L 98 117
           M 124 110 L 104 117
           M 116 108 L 102 117"
        stroke={COLOR_STRIATION}
        strokeWidth={0.5}
        fill="none"
      />
      {/* Upper-chest highlight rim along clavicle */}
      <Path
        d="M 72 109 C 84 110 96 112 99 115
           M 128 109 C 116 110 104 112 101 115"
        stroke={COLOR_HIGHLIGHT}
        strokeWidth={1.4}
        fill="none"
      />

      {/* ===== Lower Chest (pec sternal head — lobed C with V-notch) ===== */}
      <Path
        d="M 100 118 L 68 124 C 66 138 70 148 76 152 L 96 148 C 100 142 100 138 100 134 Z
           M 100 118 L 132 124 C 134 138 130 148 124 152 L 104 148 C 100 142 100 138 100 134 Z"
        fill={f(M_LOWER_CHEST)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* V-notch sternum line + horizontal sternal striations */}
      <Path
        d="M 100 118 L 100 148
           M 72 130 L 96 134
           M 76 138 L 94 140
           M 80 146 L 92 146
           M 128 130 L 104 134
           M 124 138 L 106 140
           M 120 146 L 108 146"
        stroke={COLOR_STRIATION}
        strokeWidth={0.5}
        fill="none"
      />
      {/* Lower-chest shadow under lobe (depth) */}
      <Path
        d="M 70 142 C 74 148 82 152 96 150
           M 130 142 C 126 148 118 152 104 150"
        stroke={COLOR_SHADOW}
        strokeWidth={1.8}
        fill="none"
      />

      {/* ===== Biceps brachii — TWIN BULGE per arm =====
              Long head (outer/lateral) — drawn FIRST so short head overlays. ===== */}
      <Path
        d="M 42 140 C 36 152 36 168 40 178 C 44 182 48 182 50 178 C 50 168 48 156 48 144 Z
           M 158 140 C 164 152 164 168 160 178 C 156 182 152 182 150 178 C 150 168 152 156 152 144 Z"
        fill={f(M_BICEP_LONG)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Bicep long head striations */}
      <Path
        d="M 42 148 L 44 176
           M 46 146 L 48 176
           M 158 148 L 156 176
           M 154 146 L 152 176"
        stroke={COLOR_STRIATION}
        strokeWidth={0.5}
        fill="none"
      />
      {/* Bicep long head highlight rim */}
      <Path
        d="M 40 150 C 39 160 39 170 42 176
           M 160 150 C 161 160 161 170 158 176"
        stroke={COLOR_HIGHLIGHT}
        strokeWidth={1.2}
        fill="none"
      />

      {/* Bicep SHORT head (inner/medial lobe) — shorter, sits to the inside. */}
      <Path
        d="M 48 144 C 50 154 50 166 52 174 C 56 176 60 174 60 170 C 58 160 54 150 52 144 Z
           M 152 144 C 150 154 150 166 148 174 C 144 176 140 174 140 170 C 142 160 146 150 148 144 Z"
        fill={f(M_BICEP_SHORT)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Bicep short head striation */}
      <Path
        d="M 52 150 L 56 172
           M 148 150 L 144 172"
        stroke={COLOR_STRIATION}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ===== Forearm (brachioradialis bulge near elbow) ===== */}
      <Path
        d="M 40 180 C 36 192 34 208 36 220 C 40 228 44 232 50 232 L 50 200 C 48 192 44 184 40 180 Z
           M 160 180 C 164 192 166 208 164 220 C 160 228 156 232 150 232 L 150 200 C 152 192 156 184 160 180 Z"
        fill={f(M_FOREARM)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Forearm striations */}
      <Path
        d="M 40 192 L 44 226
           M 46 188 L 48 228
           M 160 192 L 156 226
           M 154 188 L 152 228"
        stroke={COLOR_STRIATION}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ===== Abs (rectus abdominis 6-pack) =====
              Single Path with evenodd fill-rule. Outer rectangle x=75..125 y=152..224
              with linea alba vertical hole at x=98..102 and 3 horizontal grooves at
              y=170..174, y=192..196 (creating 3 × 2 = 6 pack). ===== */}
      <Path
        d={[
          // outer perimeter
          'M 75 152',
          'L 125 152',
          'L 125 224',
          'L 75 224',
          'Z',
          // linea alba vertical hole
          'M 98 154 L 102 154 L 102 222 L 98 222 Z',
          // top tendinous intersection
          'M 76 170 L 98 170 L 98 174 L 76 174 Z',
          'M 102 170 L 124 170 L 124 174 L 102 174 Z',
          // mid tendinous intersection
          'M 76 192 L 98 192 L 98 196 L 76 196 Z',
          'M 102 192 L 124 192 L 124 196 L 102 196 Z',
        ].join(' ')}
        fill={f(M_ABS)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
        fillRule="evenodd"
      />
      {/* Abs subtle shading (vertical highlight on each pack column) */}
      <Path
        d="M 86 158 L 86 168
           M 86 178 L 86 190
           M 86 200 L 86 222
           M 114 158 L 114 168
           M 114 178 L 114 190
           M 114 200 L 114 222"
        stroke={COLOR_HIGHLIGHT}
        strokeWidth={1.2}
        fill="none"
      />

      {/* ===== Obliques (side wedges sloping down-and-in to hip) ===== */}
      <Path
        d="M 66 150 L 70 180 L 74 210 L 88 220 L 84 180 L 74 155 Z
           M 134 150 L 130 180 L 126 210 L 112 220 L 116 180 L 126 155 Z"
        fill={f(M_OBLIQUE)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Oblique serration striations (slanted) */}
      <Path
        d="M 68 160 L 80 168
           M 70 178 L 82 184
           M 72 198 L 84 206
           M 132 160 L 120 168
           M 130 178 L 118 184
           M 128 198 L 116 206"
        stroke={COLOR_STRIATION}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ===== Quadriceps (rectus femoris + vastus lateralis + vastus medialis per leg) =====
              Each leg has 3 sub-paths reading as 3 heads. ===== */}
      <Path
        d="M 78 260 L 90 260 L 90 370 L 78 370 Z
           M 65 275 L 76 275 L 78 360 L 70 360 Z
           M 88 340 L 96 340 L 94 375 L 86 375 Z
           M 110 260 L 122 260 L 122 370 L 110 370 Z
           M 124 275 L 135 275 L 130 360 L 122 360 Z
           M 104 340 L 112 340 L 114 375 L 106 375 Z"
        fill={f(M_QUAD)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Quad-head separation lines + vertical striations */}
      <Path
        d="M 84 268 L 84 368
           M 116 268 L 116 368
           M 72 290 L 74 358
           M 128 290 L 126 358
           M 90 350 L 90 372
           M 110 350 L 110 372"
        stroke={COLOR_STRIATION}
        strokeWidth={0.6}
        fill="none"
      />
      {/* Quad rectus femoris highlight (center stripe) */}
      <Path
        d="M 84 270 L 84 365
           M 116 270 L 116 365"
        stroke={COLOR_HIGHLIGHT}
        strokeWidth={1.3}
        fill="none"
      />

      {/* ===== Calf (gastrocnemius two-headed + tibialis anterior strip) ===== */}
      <Path
        d="M 74 390 L 84 390 L 80 440 L 72 440 Z
           M 84 390 L 94 390 L 96 440 L 86 440 Z
           M 116 390 L 126 390 L 128 440 L 120 440 Z
           M 106 390 L 116 390 L 114 440 L 104 440 Z"
        fill={f(M_CALF)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Calf two-head midline + striations */}
      <Path
        d="M 84 392 L 84 438
           M 116 392 L 116 438
           M 78 400 L 78 432
           M 90 400 L 90 432
           M 110 400 L 110 432
           M 122 400 L 122 432"
        stroke={COLOR_STRIATION}
        strokeWidth={0.5}
        fill="none"
      />

      {/* Achilles tendon strip + tibialis anterior */}
      <Path
        d="M 80 440 L 78 480
           M 90 440 L 92 480
           M 108 440 L 110 480
           M 120 440 L 118 480"
        stroke={COLOR_STRIATION}
        strokeWidth={0.4}
        fill="none"
      />

      <MuscleLabels labels={FRONT_LABELS} mCount={mCount} textAnchor="end" />
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// Back view — 10 distinct M-paths + striations + 3D shading
// ---------------------------------------------------------------------------

function BackBody({ mQuintile, mCount }: BodyHeatmapProps) {
  const f = (m: string) => fillForM(m, mQuintile);
  return (
    <Svg viewBox="0 0 300 520" width={180} height={312}>
      {/* ===== Hair — back of crew cut, fills cranium ===== */}
      <Path
        d="M 76 38 C 78 22 90 14 100 14 C 110 14 122 22 124 38 C 124 50 124 60 122 66 C 116 70 106 72 100 72 C 94 72 84 70 78 66 C 76 60 76 50 76 38 Z"
        fill={COLOR_HAIR}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Hair lower margin */}
      <Path
        d="M 84 62 C 92 66 108 66 116 62"
        stroke={COLOR_OUTLINE}
        strokeWidth={0.4}
        fill="none"
      />

      {/* ===== Body silhouette ===== */}
      <Path
        d={BACK_SILHOUETTE_D}
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={1}
      />

      {/* ===== Nape (occipital) ===== */}
      <Path
        d="M 90 72 C 92 80 92 86 94 90
           M 110 72 C 108 80 108 86 106 90"
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ===== Hands (back of hand) ===== */}
      <Path
        d={BACK_HAND_LEFT_D}
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.7}
      />
      <Path
        d={BACK_HAND_RIGHT_D}
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.7}
      />

      {/* ===== Trapezius (back kite — base of skull → shoulders → mid-back) ===== */}
      <Path
        d="M 100 82 L 60 110 L 54 130 L 100 170 L 146 130 L 140 110 Z"
        fill={f(M_TRAP)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.6}
      />
      {/* Spine center groove */}
      <Path
        d="M 100 82 L 100 170"
        stroke={COLOR_STRIATION}
        strokeWidth={0.7}
        fill="none"
      />
      {/* Trap diagonal fibers */}
      <Path
        d="M 100 90 L 64 112
           M 100 90 L 136 112
           M 100 110 L 60 128
           M 100 110 L 140 128
           M 100 130 L 72 160
           M 100 130 L 128 160"
        stroke={COLOR_STRIATION}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ===== Rear Deltoid (posterior head — wider/rounder than front delt) ===== */}
      <Path
        d="M 62 98 C 52 108 50 124 54 140 L 66 132 C 68 124 68 116 66 108 Z
           M 138 98 C 148 108 150 124 146 140 L 134 132 C 132 124 132 116 134 108 Z"
        fill={f(M_REAR_DELT)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Rear delt striation arcs */}
      <Path
        d="M 56 110 C 58 120 60 130 62 134
           M 144 110 C 142 120 140 130 138 134"
        stroke={COLOR_STRIATION}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ===== Mid Deltoid (lateral cap visible from behind too) ===== */}
      <Path
        d="M 48 124 L 42 140 L 42 160 L 48 158 L 52 140 Z
           M 152 124 L 158 140 L 158 160 L 152 158 L 148 140 Z"
        fill={f(M_MID_DELT)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />

      {/* ===== Latissimus dorsi — V-TAPER ▽ shape =====
              Widest at lower scapula, narrowing toward lumbar.
              CRITICAL: must read as triangular sweep, NOT round blob. ===== */}
      <Path
        d="M 60 138 L 50 178 L 76 220 L 96 200 L 96 150 L 80 140 Z
           M 140 138 L 150 178 L 124 220 L 104 200 L 104 150 L 120 140 Z"
        fill={f(M_BACK)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.6}
      />
      {/* Lat diagonal striations (spine center → armpit) */}
      <Path
        d="M 60 138 L 92 156
           M 56 152 L 88 170
           M 52 168 L 84 188
           M 60 192 L 80 210
           M 140 138 L 108 156
           M 144 152 L 112 170
           M 148 168 L 116 188
           M 140 192 L 120 210"
        stroke={COLOR_STRIATION}
        strokeWidth={0.55}
        fill="none"
      />
      {/* Lat V outer-edge shadow (depth) */}
      <Path
        d="M 60 138 L 50 178 L 76 220
           M 140 138 L 150 178 L 124 220"
        stroke={COLOR_SHADOW}
        strokeWidth={1.8}
        fill="none"
      />

      {/* ===== Triceps brachii (horseshoe, 3-head split) ===== */}
      <Path
        d="M 38 135 C 34 148 34 168 38 180 C 42 184 50 184 56 180 L 58 160 L 56 135 Z
           M 162 135 C 166 148 166 168 162 180 C 158 184 150 184 144 180 L 142 160 L 144 135 Z"
        fill={f(M_TRICEP)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Tricep 3-head split striations */}
      <Path
        d="M 42 142 L 44 178
           M 50 138 L 48 180
           M 56 142 L 54 178
           M 158 142 L 156 178
           M 150 138 L 152 180
           M 144 142 L 146 178"
        stroke={COLOR_STRIATION}
        strokeWidth={0.5}
        fill="none"
      />
      {/* Tricep highlight (outer lateral head) */}
      <Path
        d="M 40 145 C 38 160 38 172 42 178
           M 160 145 C 162 160 162 172 158 178"
        stroke={COLOR_HIGHLIGHT}
        strokeWidth={1.2}
        fill="none"
      />

      {/* ===== Forearm (back extensor compartment) ===== */}
      <Path
        d="M 40 180 C 36 192 34 208 36 220 C 40 228 44 232 50 232 L 50 200 C 48 192 44 184 40 180 Z
           M 160 180 C 164 192 166 208 164 220 C 160 228 156 232 150 232 L 150 200 C 152 192 156 184 160 180 Z"
        fill={f(M_FOREARM)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Forearm striations */}
      <Path
        d="M 40 192 L 44 226
           M 46 188 L 48 228
           M 160 192 L 156 226
           M 154 188 L 152 228"
        stroke={COLOR_STRIATION}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ===== Lower Back (erector spinae columns + thoracolumbar fascia) ===== */}
      <Path
        d="M 94 220 L 98 220 L 98 260 L 94 260 Z
           M 102 220 L 106 220 L 106 260 L 102 260 Z"
        fill={f(M_LOWER_BACK)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Spine groove + sacral dimples */}
      <Path
        d="M 100 220 L 100 264"
        stroke={COLOR_STRIATION}
        strokeWidth={0.6}
        fill="none"
      />
      <Path
        d="M 95 261 L 97 263
           M 105 261 L 103 263"
        stroke={COLOR_SHADOW}
        strokeWidth={1.4}
        fill="none"
      />

      {/* ===== Upper Glute (rounded hill, upper portion of buttock) ===== */}
      <Path
        d="M 70 250 C 70 250 84 246 98 250 L 100 288 L 72 288 C 70 274 70 262 70 250 Z
           M 130 250 C 130 250 116 246 102 250 L 100 288 L 128 288 C 130 274 130 262 130 250 Z"
        fill={f(M_UPPER_GLUTE)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Upper glute crescent striations */}
      <Path
        d="M 74 258 L 96 262
           M 76 270 L 96 274
           M 126 258 L 104 262
           M 124 270 L 104 274"
        stroke={COLOR_STRIATION}
        strokeWidth={0.5}
        fill="none"
      />
      {/* Upper glute highlight (dome top) */}
      <Path
        d="M 78 256 C 86 252 94 252 98 254
           M 122 256 C 114 252 106 252 102 254"
        stroke={COLOR_HIGHLIGHT}
        strokeWidth={1.4}
        fill="none"
      />

      {/* ===== Lower Glute (fold of buttock below upper glute) ===== */}
      <Path
        d="M 72 288 L 100 288 L 102 308 L 74 308 C 72 300 72 294 72 288 Z
           M 128 288 L 100 288 L 98 308 L 126 308 C 128 300 128 294 128 288 Z"
        fill={f(M_LOWER_GLUTE)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Lower glute fold line + heart cleft */}
      <Path
        d="M 72 288 L 100 288 L 128 288
           M 100 288 L 100 308"
        stroke={COLOR_SHADOW}
        strokeWidth={1.4}
        fill="none"
      />

      {/* ===== Hamstrings (biceps femoris outer + semitendinosus inner per leg) ===== */}
      <Path
        d="M 66 310 L 82 310 L 80 375 L 68 375 Z
           M 86 310 L 96 310 L 94 375 L 88 375 Z
           M 134 310 L 118 310 L 120 375 L 132 375 Z
           M 114 310 L 104 310 L 106 375 L 112 375 Z"
        fill={f(M_HAMSTRING)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Hamstring vertical striations */}
      <Path
        d="M 72 318 L 74 370
           M 78 316 L 78 372
           M 90 316 L 90 372
           M 128 318 L 126 370
           M 122 316 L 122 372
           M 110 316 L 110 372"
        stroke={COLOR_STRIATION}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ===== Calf (gastrocnemius diamond — INNER + OUTER head split prominent) ===== */}
      <Path
        d="M 84 390 L 94 390 L 96 440 L 86 440 Z
           M 74 390 L 84 390 L 80 440 L 72 440 Z
           M 106 390 L 116 390 L 114 440 L 104 440 Z
           M 116 390 L 126 390 L 128 440 L 120 440 Z"
        fill={f(M_CALF)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Calf midline + diamond apex striations */}
      <Path
        d="M 84 392 L 84 438
           M 116 392 L 116 438
           M 78 400 L 92 420
           M 122 400 L 108 420
           M 80 400 L 80 435
           M 120 400 L 120 435"
        stroke={COLOR_STRIATION}
        strokeWidth={0.55}
        fill="none"
      />
      {/* Calf inner-head highlight (medial larger lobe) */}
      <Path
        d="M 88 396 C 90 412 92 426 90 436
           M 112 396 C 110 412 108 426 110 436"
        stroke={COLOR_HIGHLIGHT}
        strokeWidth={1.3}
        fill="none"
      />
      {/* Achilles tendon strip */}
      <Path
        d="M 84 440 L 84 480
           M 116 440 L 116 480"
        stroke={COLOR_STRIATION}
        strokeWidth={0.5}
        fill="none"
      />

      <MuscleLabels labels={BACK_LABELS} mCount={mCount} textAnchor="start" />
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

export function BodyHeatmap({ mQuintile, mCount }: BodyHeatmapProps) {
  return (
    <View style={styles.row}>
      <View style={styles.column}>
        <Text style={styles.label}>{t('page', 'bodyFront')}</Text>
        <FrontBody mQuintile={mQuintile} mCount={mCount} />
      </View>
      <View style={styles.column}>
        <Text style={styles.label}>{t('page', 'bodyBack')}</Text>
        <BackBody mQuintile={mQuintile} mCount={mCount} />
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
