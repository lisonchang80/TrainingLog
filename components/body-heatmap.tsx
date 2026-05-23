/**
 * Body Heatmap — front + back anatomical M-layer human silhouette,
 * each muscle filled by per-Session frequency quintile.
 *
 * Variant A (2026-05-23 redraw):
 *   - Athletic male silhouette, ~7-8 heads tall, V-taper.
 *   - 18 distinct muscle bellies painted individually (上胸 / 中下胸 / 前束 /
 *     中束 / 後束 / 二頭長短 / 三頭 / 上下臀部 / 股四 / 膕繩 / 腹肌 / 側腹 /
 *     斜方 / 背部 / 下背 / 小腿 / 小臂).
 *   - Each muscle has a primary fill path + striation strokes suggesting
 *     fiber direction (horizontal sweep for pec/abs, vertical for bicep
 *     /tricep/quad/calf, diagonal for lats/obliques).
 *   - Enlarged to viewBox -80 0 320 520 @ width 200 for thumbnail readability.
 *   - Style: lean fitness-app medical illustration with subtle 3D depth.
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
const COLOR_OUTLINE_BODY = '#6B7280';
const COLOR_STRIATION = 'rgba(60,60,75,0.35)';
const COLOR_SKIN = '#F5F5F7';
const QUINTILE_COLORS: readonly string[] = [
  '#BFDBFE', // Q1 cool blue
  '#93C5FD', // Q2 light blue
  '#FCD34D', // Q3 yellow
  '#FB923C', // Q4 warm orange
  '#EF4444', // Q5 warm red
];
const COLOR_ZERO = '#E5E7EB';

const STROKE_BODY = 0.8;
const STROKE_MUSCLE = 0.6;
const STROKE_STRIATION = 0.7;

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

// Anchor coords align with new geometry (centerline x=100, ~520 tall body).
// Label coords sit outside the body silhouette so leader lines never overlap.
const FRONT_LABELS: readonly MuscleLabel[] = [
  { m_id: M_FRONT_DELT, anchorX: 56, anchorY: 120, labelX: -14, labelY: 112 },
  { m_id: M_UPPER_CHEST, anchorX: 88, anchorY: 122, labelX: -14, labelY: 136 },
  { m_id: M_LOWER_CHEST, anchorX: 88, anchorY: 152, labelX: -14, labelY: 160 },
  { m_id: M_BICEP_LONG, anchorX: 42, anchorY: 170, labelX: -14, labelY: 184 },
  { m_id: M_BICEP_SHORT, anchorX: 56, anchorY: 178, labelX: -14, labelY: 208 },
  { m_id: M_ABS, anchorX: 100, anchorY: 210, labelX: -14, labelY: 232 },
  { m_id: M_OBLIQUE, anchorX: 74, anchorY: 222, labelX: -14, labelY: 256 },
  { m_id: M_FOREARM, anchorX: 46, anchorY: 244, labelX: -14, labelY: 280 },
  { m_id: M_QUAD, anchorX: 82, anchorY: 330, labelX: -14, labelY: 340 },
  { m_id: M_CALF, anchorX: 82, anchorY: 430, labelX: -14, labelY: 432 },
];

const BACK_LABELS: readonly MuscleLabel[] = [
  { m_id: M_TRAP, anchorX: 100, anchorY: 112, labelX: 220, labelY: 108 },
  { m_id: M_REAR_DELT, anchorX: 150, anchorY: 124, labelX: 220, labelY: 132 },
  { m_id: M_MID_DELT, anchorX: 158, anchorY: 140, labelX: 220, labelY: 156 },
  { m_id: M_BACK, anchorX: 100, anchorY: 158, labelX: 220, labelY: 180 },
  { m_id: M_TRICEP, anchorX: 154, anchorY: 174, labelX: 220, labelY: 204 },
  { m_id: M_LOWER_BACK, anchorX: 100, anchorY: 226, labelX: 220, labelY: 228 },
  { m_id: M_UPPER_GLUTE, anchorX: 100, anchorY: 258, labelX: 220, labelY: 252 },
  { m_id: M_LOWER_GLUTE, anchorX: 100, anchorY: 290, labelX: 220, labelY: 276 },
  { m_id: M_HAMSTRING, anchorX: 118, anchorY: 340, labelX: 220, labelY: 320 },
  { m_id: M_CALF, anchorX: 118, anchorY: 430, labelX: 220, labelY: 420 },
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
// Front view — athletic male anatomy, 18 distinct M-paths + striations
//
// Geometry overview (centerline x=100):
//   head        y=12-74     (oval cranium r≈18×30)
//   neck        y=74-94
//   shoulders   y=94-110    (delt caps span x=38..162, shoulder width ~124)
//   chest       y=104-164
//   abs/torso   y=160-242
//   pelvis      y=240-278
//   thighs      y=278-388
//   knee        y=388-402
//   calves      y=402-484
//   feet        y=484-516
// ---------------------------------------------------------------------------

function FrontBody({ mQuintile, mCount }: BodyHeatmapProps) {
  const f = (m: string) => fillForM(m, mQuintile);
  return (
    <Svg viewBox="-80 0 320 520" width={200} height={325}>
      {/* ============================ HEAD ============================ */}
      {/* Cranium oval */}
      <Path
        d="M100 12 C82 12 68 28 68 46 C68 64 76 76 82 80 C84 86 88 90 92 92 C96 94 104 94 108 92 C112 90 116 86 118 80 C124 76 132 64 132 46 C132 28 118 12 100 12 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE_BODY}
        strokeWidth={STROKE_BODY}
      />
      {/* Jaw shadow / chin highlight */}
      <Path
        d="M82 80 C88 88 112 88 118 80"
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ============================ NECK ============================ */}
      <Path
        d="M88 92 L88 104 C92 108 96 110 100 110 C104 110 108 108 112 104 L112 92 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE_BODY}
        strokeWidth={STROKE_BODY}
      />
      {/* Sternocleidomastoid hint */}
      <Path
        d="M90 94 L96 108 M110 94 L104 108"
        stroke={COLOR_STRIATION}
        strokeWidth={STROKE_STRIATION}
        fill="none"
      />

      {/* ============================ TRAPEZIUS (front yoke) ============================ */}
      {/* Triangular wedge from neck base out to shoulder peak */}
      <Path
        d="M88 104 C76 108 64 114 56 120 C66 116 80 112 92 112 L100 110 L108 112 C120 112 134 116 144 120 C136 114 124 108 112 104 Z"
        fill={f(M_TRAP)}
        stroke={COLOR_OUTLINE}
        strokeWidth={STROKE_MUSCLE}
      />
      {/* Trap fiber sweep */}
      <Path
        d="M92 108 L60 118 M108 108 L140 118"
        stroke={COLOR_STRIATION}
        strokeWidth={STROKE_STRIATION}
        fill="none"
      />

      {/* ============================ TORSO SILHOUETTE ============================ */}
      {/* V-taper torso — wide shoulders, narrow waist */}
      <Path
        d="M56 120
           C50 128 44 142 42 158
           C40 178 40 196 44 214
           C46 226 50 238 56 246
           L72 256 L100 250 L128 256 L144 246
           C150 238 154 226 156 214
           C160 196 160 178 158 158
           C156 142 150 128 144 120
           L128 124 L100 122 L72 124 Z"
        fill="#FAFAFA"
        stroke={COLOR_OUTLINE_BODY}
        strokeWidth={STROKE_BODY}
      />

      {/* ============================ DELTOID — ANTERIOR (front cap) ============================ */}
      {/* Curved triangle from clavicle out to upper arm */}
      <Path
        d="M56 120 C46 128 38 142 38 158 C38 164 42 168 48 168 C52 156 56 142 60 132 C62 126 60 122 56 120 Z
           M144 120 C154 128 162 142 162 158 C162 164 158 168 152 168 C148 156 144 142 140 132 C138 126 140 122 144 120 Z"
        fill={f(M_FRONT_DELT)}
        stroke={COLOR_OUTLINE}
        strokeWidth={STROKE_MUSCLE}
      />
      {/* Anterior delt arc striations (fan from clavicle) */}
      <Path
        d="M46 130 C48 142 50 156 52 164
           M154 130 C152 142 150 156 148 164
           M52 124 C54 138 56 150 56 162
           M148 124 C146 138 144 150 144 162"
        stroke={COLOR_STRIATION}
        strokeWidth={STROKE_STRIATION}
        fill="none"
      />

      {/* ============================ DELTOID — LATERAL (side strip visible on front) ============================ */}
      <Path
        d="M38 158 C34 168 34 180 38 190 C42 184 46 174 46 162 C46 158 42 156 38 158 Z
           M162 158 C166 168 166 180 162 190 C158 184 154 174 154 162 C154 158 158 156 162 158 Z"
        fill={f(M_MID_DELT)}
        stroke={COLOR_OUTLINE}
        strokeWidth={STROKE_MUSCLE}
      />
      {/* Lateral delt vertical fibers */}
      <Path
        d="M38 168 L40 188 M42 164 L44 188
           M162 168 L160 188 M158 164 L156 188"
        stroke={COLOR_STRIATION}
        strokeWidth={STROKE_STRIATION}
        fill="none"
      />

      {/* ============================ PECTORALIS — CLAVICULAR (upper chest) ============================ */}
      {/* Upper half of pec, fans down-and-out from clavicle */}
      <Path
        d="M100 122 C92 124 82 128 72 136 C66 142 64 148 66 154 L100 144 Z
           M100 122 C108 124 118 128 128 136 C134 142 136 148 134 154 L100 144 Z"
        fill={f(M_UPPER_CHEST)}
        stroke={COLOR_OUTLINE}
        strokeWidth={STROKE_MUSCLE}
      />
      {/* Upper-pec horizontal-sweep striations (clavicular fibers) */}
      <Path
        d="M78 130 L96 140
           M86 128 L98 142
           M122 130 L104 140
           M114 128 L102 142
           M70 142 L96 144
           M130 142 L104 144"
        stroke={COLOR_STRIATION}
        strokeWidth={STROKE_STRIATION}
        fill="none"
      />

      {/* ============================ PECTORALIS — STERNAL (lower chest, lobed C with V-notch) ============================ */}
      <Path
        d="M100 144 L66 154 C64 162 66 172 72 178 C82 180 92 174 100 162 Z
           M100 144 L134 154 C136 162 134 172 128 178 C118 180 108 174 100 162 Z"
        fill={f(M_LOWER_CHEST)}
        stroke={COLOR_OUTLINE}
        strokeWidth={STROKE_MUSCLE}
      />
      {/* Sternum V-notch + horizontal sternal-head fibers */}
      <Path
        d="M100 144 L100 162
           M70 160 L96 158
           M76 168 L96 166
           M82 174 L96 172
           M130 160 L104 158
           M124 168 L104 166
           M118 174 L104 172"
        stroke={COLOR_STRIATION}
        strokeWidth={STROKE_STRIATION}
        fill="none"
      />

      {/* ============================ BICEPS — LONG HEAD (outer lobe) ============================ */}
      <Path
        d="M38 168 C32 180 32 198 36 214 C40 222 46 226 50 224 C52 210 54 196 54 184 C54 176 50 170 44 168 Z
           M162 168 C168 180 168 198 164 214 C160 222 154 226 150 224 C148 210 146 196 146 184 C146 176 150 170 156 168 Z"
        fill={f(M_BICEP_LONG)}
        stroke={COLOR_OUTLINE}
        strokeWidth={STROKE_MUSCLE}
      />

      {/* ============================ BICEPS — SHORT HEAD (inner lobe parallel to long) ============================ */}
      <Path
        d="M54 174 C52 186 52 202 54 216 C58 222 62 222 64 218 C64 204 62 190 60 178 C58 172 56 172 54 174 Z
           M146 174 C148 186 148 202 146 216 C142 222 138 222 136 218 C136 204 138 190 140 178 C142 172 144 172 146 174 Z"
        fill={f(M_BICEP_SHORT)}
        stroke={COLOR_OUTLINE}
        strokeWidth={STROKE_MUSCLE}
      />
      {/* Bicep longitudinal fibers — twin bulge centerlines */}
      <Path
        d="M40 178 L46 220
           M48 176 L50 222
           M58 184 L60 218
           M160 178 L154 220
           M152 176 L150 222
           M142 184 L140 218"
        stroke={COLOR_STRIATION}
        strokeWidth={STROKE_STRIATION}
        fill="none"
      />

      {/* ============================ FOREARM (flexor bulge tapering to wrist) ============================ */}
      <Path
        d="M42 226 C36 240 34 258 38 274 C42 282 48 286 52 284 C56 270 58 254 58 240 C58 232 52 226 46 226 Z
           M158 226 C164 240 166 258 162 274 C158 282 152 286 148 284 C144 270 142 254 142 240 C142 232 148 226 154 226 Z"
        fill={f(M_FOREARM)}
        stroke={COLOR_OUTLINE}
        strokeWidth={STROKE_MUSCLE}
      />
      {/* Forearm longitudinal striations */}
      <Path
        d="M44 240 L50 282
           M50 236 L54 284
           M156 240 L150 282
           M150 236 L146 284"
        stroke={COLOR_STRIATION}
        strokeWidth={STROKE_STRIATION}
        fill="none"
      />

      {/* Wrist / hand */}
      <Path
        d="M40 284 C40 290 42 296 46 300 L56 300 C58 296 58 290 56 284 Z
           M160 284 C160 290 158 296 154 300 L144 300 C142 296 142 290 144 284 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE_BODY}
        strokeWidth={STROKE_BODY}
      />

      {/* ============================ ABS — RECTUS ABDOMINIS (6-pack grid) ============================ */}
      {/* Central column with two parallel rows of 3 segments separated by linea alba */}
      <Path
        d="M84 168 C82 188 82 214 84 240 C88 244 96 244 100 242 C104 244 112 244 116 240 C118 214 118 188 116 168 C110 170 100 172 100 172 C100 172 90 170 84 168 Z"
        fill={f(M_ABS)}
        stroke={COLOR_OUTLINE}
        strokeWidth={STROKE_MUSCLE}
      />
      {/* 6-pack tendinous intersections (linea alba + 3 horizontal lines) */}
      <Path
        d="M100 172 L100 240
           M85 184 L115 184
           M85 200 L115 200
           M85 216 L115 216
           M85 230 L115 230"
        stroke={COLOR_STRIATION}
        strokeWidth={STROKE_STRIATION}
        fill="none"
      />

      {/* ============================ OBLIQUES (side wedge rib→hip) ============================ */}
      <Path
        d="M66 174 C62 192 62 214 66 236 C72 242 80 244 84 240 C84 218 84 194 84 168 C76 168 70 170 66 174 Z
           M134 174 C138 192 138 214 134 236 C128 242 120 244 116 240 C116 218 116 194 116 168 C124 168 130 170 134 174 Z"
        fill={f(M_OBLIQUE)}
        stroke={COLOR_OUTLINE}
        strokeWidth={STROKE_MUSCLE}
      />
      {/* Oblique serration striations (slanted rib→hip) */}
      <Path
        d="M68 184 L82 196
           M68 202 L82 214
           M68 220 L82 232
           M132 184 L118 196
           M132 202 L118 214
           M132 220 L118 232"
        stroke={COLOR_STRIATION}
        strokeWidth={STROKE_STRIATION}
        fill="none"
      />

      {/* ============================ PELVIS / HIP ============================ */}
      <Path
        d="M56 246 C60 258 66 268 74 274 L126 274 C134 268 140 258 144 246 L128 256 L100 250 L72 256 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE_BODY}
        strokeWidth={STROKE_BODY}
      />
      {/* Iliac crest hint */}
      <Path
        d="M64 256 L80 268 M136 256 L120 268"
        stroke={COLOR_STRIATION}
        strokeWidth={STROKE_STRIATION}
        fill="none"
      />

      {/* ============================ QUADRICEPS — 3-head visible: vastus lateralis (outer) +
              rectus femoris (center vertical strip) + vastus medialis (inner teardrop above knee) ============================ */}
      <Path
        d="M62 278 C56 300 54 336 60 372 C64 380 70 384 76 380 C80 350 86 318 90 290 C84 282 72 278 62 278 Z
           M138 278 C144 300 146 336 140 372 C136 380 130 384 124 380 C120 350 114 318 110 290 C116 282 128 278 138 278 Z
           M90 290 C88 318 88 350 92 380 L98 380 C100 354 100 322 100 294 C96 290 92 290 90 290 Z
           M110 290 C112 318 112 350 108 380 L102 380 C100 354 100 322 100 294 C104 290 108 290 110 290 Z"
        fill={f(M_QUAD)}
        stroke={COLOR_OUTLINE}
        strokeWidth={STROKE_MUSCLE}
      />
      {/* Quad head separation + vertical rectus striations */}
      <Path
        d="M70 292 L78 380
           M82 294 L86 380
           M90 296 L92 380
           M100 294 L100 380
           M110 296 L108 380
           M118 294 L114 380
           M130 292 L122 380"
        stroke={COLOR_STRIATION}
        strokeWidth={STROKE_STRIATION}
        fill="none"
      />
      {/* Vastus medialis teardrop accent (just above knee, inner thigh) */}
      <Path
        d="M86 364 C90 372 96 378 98 378
           M114 364 C110 372 104 378 102 378"
        stroke={COLOR_STRIATION}
        strokeWidth={STROKE_STRIATION}
        fill="none"
      />

      {/* ============================ KNEE ============================ */}
      <Path
        d="M64 382 C66 392 74 400 84 400 L96 400 C98 396 98 388 96 382 Z
           M104 382 C104 388 104 396 106 400 L116 400 C126 400 134 392 136 382 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE_BODY}
        strokeWidth={STROKE_BODY}
      />
      {/* Patella centerline */}
      <Path
        d="M82 388 L94 396 M118 388 L106 396"
        stroke={COLOR_STRIATION}
        strokeWidth={STROKE_STRIATION}
        fill="none"
      />

      {/* ============================ CALF — GASTROCNEMIUS DIAMOND (front view, tapering to ankle) ============================ */}
      <Path
        d="M68 402 C62 420 60 446 66 466 C70 476 76 482 82 482 L88 482 C90 466 92 444 92 422 C92 412 86 404 80 402 Z
           M132 402 C138 420 140 446 134 466 C130 476 124 482 118 482 L112 482 C110 466 108 444 108 422 C108 412 114 404 120 402 Z"
        fill={f(M_CALF)}
        stroke={COLOR_OUTLINE}
        strokeWidth={STROKE_MUSCLE}
      />
      {/* Calf vertical midline + outer/inner head split */}
      <Path
        d="M78 412 L82 478
           M122 412 L118 478
           M70 432 L88 430
           M130 432 L112 430"
        stroke={COLOR_STRIATION}
        strokeWidth={STROKE_STRIATION}
        fill="none"
      />

      {/* ============================ ANKLE / FOOT ============================ */}
      <Path
        d="M72 482 L92 482 L96 500 L70 500 Z
           M108 482 L128 482 L130 500 L104 500 Z
           M68 500 L98 500 L100 514 L66 514 Z
           M102 500 L132 500 L134 514 L100 514 Z"
        fill="#FAFAFA"
        stroke={COLOR_OUTLINE_BODY}
        strokeWidth={STROKE_BODY}
      />

      <MuscleLabels labels={FRONT_LABELS} mCount={mCount} textAnchor="end" />
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// Back view — athletic male anatomy, 18 distinct M-paths + striations
// Same geometry as front (centerline x=100), with back-specific muscle shapes:
//   - Trap diamond kite (skull → mid-back, widest at shoulder line)
//   - Lats V-taper (armpit → lumbar)
//   - Erector spinae lumbar columns
//   - Tricep horseshoe (upper bulk + lower fork)
//   - Glute upper hill + lower fold
//   - Hamstring split (biceps femoris outer + semi inner)
// ---------------------------------------------------------------------------

function BackBody({ mQuintile, mCount }: BodyHeatmapProps) {
  const f = (m: string) => fillForM(m, mQuintile);
  return (
    <Svg viewBox="0 0 320 520" width={200} height={325}>
      {/* ============================ HEAD (occipital) ============================ */}
      <Path
        d="M100 12 C82 12 68 28 68 46 C68 64 76 76 82 80 C84 86 88 90 92 92 C96 94 104 94 108 92 C112 90 116 86 118 80 C124 76 132 64 132 46 C132 28 118 12 100 12 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE_BODY}
        strokeWidth={STROKE_BODY}
      />
      {/* Hairline on back of head */}
      <Path
        d="M78 64 C86 72 114 72 122 64"
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ============================ NECK (nape) ============================ */}
      <Path
        d="M88 92 L88 104 C92 108 96 110 100 110 C104 110 108 108 112 104 L112 92 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE_BODY}
        strokeWidth={STROKE_BODY}
      />

      {/* ============================ TORSO SILHOUETTE ============================ */}
      <Path
        d="M56 120
           C50 128 44 142 42 158
           C40 178 40 196 44 214
           C46 226 50 238 56 246
           L72 256 L100 250 L128 256 L144 246
           C150 238 154 226 156 214
           C160 196 160 178 158 158
           C156 142 150 128 144 120
           L128 124 L100 122 L72 124 Z"
        fill="#FAFAFA"
        stroke={COLOR_OUTLINE_BODY}
        strokeWidth={STROKE_BODY}
      />

      {/* ============================ TRAPEZIUS — BACK DIAMOND KITE (skull → mid-back) ============================ */}
      {/* Upper trap yoke + middle trap diamond down to T12 */}
      <Path
        d="M100 100 C90 102 78 108 68 116 C62 122 66 128 72 130 C84 126 92 122 100 120 C108 122 116 126 128 130 C134 128 138 122 132 116 C122 108 110 102 100 100 Z
           M100 120 C88 128 78 142 76 158 C82 162 90 166 100 170 C110 166 118 162 124 158 C122 142 112 128 100 120 Z"
        fill={f(M_TRAP)}
        stroke={COLOR_OUTLINE}
        strokeWidth={STROKE_MUSCLE}
      />
      {/* Trap fiber sweep (radiating from spine) */}
      <Path
        d="M76 114 L100 122
           M124 114 L100 122
           M82 138 L100 158
           M118 138 L100 158
           M88 150 L100 168
           M112 150 L100 168"
        stroke={COLOR_STRIATION}
        strokeWidth={STROKE_STRIATION}
        fill="none"
      />

      {/* ============================ DELTOID — POSTERIOR (back of shoulder lobe) ============================ */}
      <Path
        d="M56 120 C46 128 38 142 38 158 C38 164 42 168 48 168 C52 156 56 142 60 132 C62 126 60 122 56 120 Z
           M144 120 C154 128 162 142 162 158 C162 164 158 168 152 168 C148 156 144 142 140 132 C138 126 140 122 144 120 Z"
        fill={f(M_REAR_DELT)}
        stroke={COLOR_OUTLINE}
        strokeWidth={STROKE_MUSCLE}
      />
      {/* Posterior delt fibers converging towards humerus */}
      <Path
        d="M44 130 C48 140 52 152 54 162
           M156 130 C152 140 148 152 146 162
           M50 124 C52 134 54 146 54 158
           M150 124 C148 134 146 146 146 158"
        stroke={COLOR_STRIATION}
        strokeWidth={STROKE_STRIATION}
        fill="none"
      />

      {/* ============================ DELTOID — LATERAL (visible on back view) ============================ */}
      <Path
        d="M38 158 C34 168 34 180 38 190 C42 184 46 174 46 162 C46 158 42 156 38 158 Z
           M162 158 C166 168 166 180 162 190 C158 184 154 174 154 162 C154 158 158 156 162 158 Z"
        fill={f(M_MID_DELT)}
        stroke={COLOR_OUTLINE}
        strokeWidth={STROKE_MUSCLE}
      />

      {/* ============================ LATISSIMUS DORSI + ERECTOR ROW (M_BACK) ============================ */}
      {/* Lat wings V-taper from armpit down to lower scapula widest, then narrow at waist.
              Plus thin erector spinae columns flanking spine in upper torso. */}
      <Path
        d="M62 132 C56 152 56 180 64 206 C72 216 84 220 92 218 C90 188 86 162 80 138 C76 132 70 130 62 132 Z
           M138 132 C144 152 144 180 136 206 C128 216 116 220 108 218 C110 188 114 162 120 138 C124 132 130 130 138 132 Z
           M94 170 C92 184 92 202 94 218 L98 218 L98 170 Z
           M106 170 C108 184 108 202 106 218 L102 218 L102 170 Z"
        fill={f(M_BACK)}
        stroke={COLOR_OUTLINE}
        strokeWidth={STROKE_MUSCLE}
      />
      {/* Lat V-taper diagonal fibers (spine → armpit, downward sweep) */}
      <Path
        d="M68 144 L88 206
           M76 138 L94 204
           M82 134 L96 208
           M132 144 L112 206
           M124 138 L106 204
           M118 134 L104 208"
        stroke={COLOR_STRIATION}
        strokeWidth={STROKE_STRIATION}
        fill="none"
      />

      {/* ============================ TRICEPS — HORSESHOE (upper bulk + lower fork) ============================ */}
      <Path
        d="M38 158 C32 174 32 196 36 212 C40 220 46 222 50 220 C52 208 54 194 54 182 C54 172 50 164 44 162 Z
           M52 168 C50 184 50 202 52 216 C56 220 60 220 62 216 C62 202 60 188 58 176 C56 170 54 168 52 168 Z
           M162 158 C168 174 168 196 164 212 C160 220 154 222 150 220 C148 208 146 194 146 182 C146 172 150 164 156 162 Z
           M148 168 C150 184 150 202 148 216 C144 220 140 220 138 216 C138 202 140 188 142 176 C144 170 146 168 148 168 Z"
        fill={f(M_TRICEP)}
        stroke={COLOR_OUTLINE}
        strokeWidth={STROKE_MUSCLE}
      />
      {/* Tricep 3-head fibers — upper bulk + lower fork */}
      <Path
        d="M40 172 L48 218
           M46 168 L52 218
           M58 178 L60 216
           M160 172 L152 218
           M154 168 L148 218
           M142 178 L140 216"
        stroke={COLOR_STRIATION}
        strokeWidth={STROKE_STRIATION}
        fill="none"
      />

      {/* ============================ FOREARM (extensor compartment) ============================ */}
      <Path
        d="M42 226 C36 240 34 258 38 274 C42 282 48 286 52 284 C56 270 58 254 58 240 C58 232 52 226 46 226 Z
           M158 226 C164 240 166 258 162 274 C158 282 152 286 148 284 C144 270 142 254 142 240 C142 232 148 226 154 226 Z"
        fill={f(M_FOREARM)}
        stroke={COLOR_OUTLINE}
        strokeWidth={STROKE_MUSCLE}
      />
      <Path
        d="M44 240 L50 282
           M50 236 L54 284
           M156 240 L150 282
           M150 236 L146 284"
        stroke={COLOR_STRIATION}
        strokeWidth={STROKE_STRIATION}
        fill="none"
      />

      {/* Wrist / hand */}
      <Path
        d="M40 284 C40 290 42 296 46 300 L56 300 C58 296 58 290 56 284 Z
           M160 284 C160 290 158 296 154 300 L144 300 C142 296 142 290 144 284 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE_BODY}
        strokeWidth={STROKE_BODY}
      />

      {/* ============================ LOWER BACK — ERECTOR SPINAE (paired vertical lumbar columns) ============================ */}
      <Path
        d="M86 222 C82 232 82 244 86 254 L100 256 L114 254 C118 244 118 232 114 222 C108 224 100 226 100 226 C100 226 92 224 86 222 Z"
        fill={f(M_LOWER_BACK)}
        stroke={COLOR_OUTLINE}
        strokeWidth={STROKE_MUSCLE}
      />
      {/* Erector spinae paired columns flanking spine */}
      <Path
        d="M92 226 L92 250
           M100 228 L100 254
           M108 226 L108 250
           M88 240 L96 240
           M104 240 L112 240"
        stroke={COLOR_STRIATION}
        strokeWidth={STROKE_STRIATION}
        fill="none"
      />

      {/* ============================ PELVIS / HIP ============================ */}
      <Path
        d="M56 246 C60 258 66 268 74 274 L126 274 C134 268 140 258 144 246 L128 256 L100 250 L72 256 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE_BODY}
        strokeWidth={STROKE_BODY}
      />

      {/* ============================ UPPER GLUTE (gluteus medius hill — upper hip curve) ============================ */}
      <Path
        d="M70 256 C62 260 56 268 56 280 C62 284 70 284 78 280 C86 274 94 268 100 262 C96 258 86 256 70 256 Z
           M130 256 C138 260 144 268 144 280 C138 284 130 284 122 280 C114 274 106 268 100 262 C104 258 114 256 130 256 Z"
        fill={f(M_UPPER_GLUTE)}
        stroke={COLOR_OUTLINE}
        strokeWidth={STROKE_MUSCLE}
      />
      {/* Upper glute crescent sweep */}
      <Path
        d="M68 264 L84 278
           M132 264 L116 278"
        stroke={COLOR_STRIATION}
        strokeWidth={STROKE_STRIATION}
        fill="none"
      />

      {/* ============================ LOWER GLUTE (gluteus maximus dome — heart cleft fold) ============================ */}
      <Path
        d="M78 280 C68 286 60 304 60 320 C60 330 64 340 76 340 C88 340 96 332 100 318 C100 308 100 290 100 282 C94 280 84 278 78 280 Z
           M122 280 C132 286 140 304 140 320 C140 330 136 340 124 340 C112 340 104 332 100 318 C100 308 100 290 100 282 C106 280 116 278 122 280 Z"
        fill={f(M_LOWER_GLUTE)}
        stroke={COLOR_OUTLINE}
        strokeWidth={STROKE_MUSCLE}
      />
      {/* Glute cleft fold + lower-fold separation */}
      <Path
        d="M100 282 L100 340
           M70 304 L88 322
           M130 304 L112 322
           M64 332 L86 336
           M136 332 L114 336"
        stroke={COLOR_STRIATION}
        strokeWidth={STROKE_STRIATION}
        fill="none"
      />

      {/* ============================ HAMSTRINGS (biceps femoris outer + semitendinosus inner per leg) ============================ */}
      <Path
        d="M64 342 C58 362 56 380 60 380 C64 384 70 384 74 380 C78 360 82 344 86 326 C80 326 70 334 64 342 Z
           M86 326 C84 348 84 368 88 380 L98 380 C100 360 100 340 100 324 C96 324 90 324 86 326 Z
           M136 342 C142 362 144 380 140 380 C136 384 130 384 126 380 C122 360 118 344 114 326 C120 326 130 334 136 342 Z
           M114 326 C116 348 116 368 112 380 L102 380 C100 360 100 340 100 324 C104 324 110 324 114 326 Z"
        fill={f(M_HAMSTRING)}
        stroke={COLOR_OUTLINE}
        strokeWidth={STROKE_MUSCLE}
      />
      {/* Hamstring longitudinal fibers (biceps femoris + semi split) */}
      <Path
        d="M72 340 L78 380
           M84 332 L92 380
           M100 328 L100 380
           M116 332 L108 380
           M128 340 L122 380"
        stroke={COLOR_STRIATION}
        strokeWidth={STROKE_STRIATION}
        fill="none"
      />

      {/* ============================ KNEE (popliteal) ============================ */}
      <Path
        d="M64 382 C66 392 74 400 84 400 L96 400 C98 396 98 388 96 382 Z
           M104 382 C104 388 104 396 106 400 L116 400 C126 400 134 392 136 382 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE_BODY}
        strokeWidth={STROKE_BODY}
      />

      {/* ============================ CALF — GASTROCNEMIUS DIAMOND (back view — most prominent) ============================ */}
      <Path
        d="M68 402 C60 422 58 448 64 466 C68 476 74 480 80 480 L88 480 C90 460 92 436 92 420 C92 410 86 404 80 402 Z
           M132 402 C140 422 142 448 136 466 C132 476 126 480 120 480 L112 480 C110 460 108 436 108 420 C108 410 114 404 120 402 Z"
        fill={f(M_CALF)}
        stroke={COLOR_OUTLINE}
        strokeWidth={STROKE_MUSCLE}
      />
      {/* Gastroc diamond midline + outer/inner head split */}
      <Path
        d="M78 412 L84 476
           M122 412 L116 476
           M70 432 L88 428
           M130 432 L112 428
           M76 456 L90 452
           M124 456 L110 452"
        stroke={COLOR_STRIATION}
        strokeWidth={STROKE_STRIATION}
        fill="none"
      />

      {/* ============================ ANKLE / HEEL ============================ */}
      <Path
        d="M72 480 L92 480 L96 500 L70 500 Z
           M108 480 L128 480 L130 500 L104 500 Z
           M68 500 L98 500 L100 514 L66 514 Z
           M102 500 L132 500 L134 514 L100 514 Z"
        fill="#FAFAFA"
        stroke={COLOR_OUTLINE_BODY}
        strokeWidth={STROKE_BODY}
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
