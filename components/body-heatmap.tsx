/**
 * Body Heatmap — front + back anatomical M-layer human silhouette,
 * each muscle filled by per-Session frequency quintile.
 *
 * 2026-05-23 variant E (vision-traced): redrawn from 19 user reference
 * screenshots (IMG_1359..IMG_1377). Every muscle's location + shape now
 * mirrors the reference's GREEN highlight — see mapping table below.
 *
 *   IMG_1359 → 斜方肌 (M_TRAP)        — back, kite between neck & shoulder blades
 *   IMG_1360 → 上胸 (M_UPPER_CHEST)   — front, upper pec slab under clavicle
 *   IMG_1361 → 中下胸 (M_LOWER_CHEST) — front, lower pec lobes w/ V-notch
 *   IMG_1362 → 背部 (M_BACK)          — back, butterfly between scapulae
 *   IMG_1363 → 下背 (M_LOWER_BACK)    — back, small lumbar slab above sacrum
 *   IMG_1364 → 小腿 (M_CALF)          — both views, diamond gastroc
 *   IMG_1365 → 小臂 (M_FOREARM)       — both views, tapered forearm
 *   IMG_1366 → 三頭 (M_TRICEP)        — back, small wing on outer upper-arm
 *   IMG_1367 → 內側二頭 (M_BICEP_SHORT) — front, inner oval on upper-arm
 *   IMG_1368 → 外側二頭 (M_BICEP_LONG)  — front, outer oval on upper-arm
 *   IMG_1369 → 后束 (M_REAR_DELT)     — back, rear shoulder cap
 *   IMG_1370 → 中束 (M_MID_DELT)      — front, lateral shoulder cap
 *   IMG_1371 → 前束 (M_FRONT_DELT)    — front, anterior shoulder cap
 *   IMG_1372 → 側腹 (M_OBLIQUE)       — front, oblique wings flanking abs
 *   IMG_1373 → 腹肌 (M_ABS)           — front, central rectus column
 *   IMG_1374 → 上臀部 (M_UPPER_GLUTE) — back, upper hip crescents
 *   IMG_1375 → 下臀部 (M_LOWER_GLUTE) — back, main glute dome
 *   IMG_1376 → 膕繩 (M_HAMSTRING)     — back, posterior thigh
 *   IMG_1377 → 股四 (M_QUAD)          — front, anterior thigh
 *
 * Style:
 *   - Body silhouette with thin light-grey outline (~0.8px).
 *   - Arms & legs slightly apart from torso (visible negative-space gaps).
 *   - Athletic V-taper male, crew-cut blue-grey hair, nose ridge + SCM neck
 *     ropes, hands with five-finger pose.
 *   - Each muscle: primary `fill={f(M_*)}` + a subtle inner contour line
 *     suggesting 3-D bulge (no heavy striations).
 *
 * Used by the Stats sub-tab of History (slice 9 / ADR-0009 §人體部位圖).
 *
 * Quintile palette:
 *   0    → #E5E7EB grey
 *   Q1   → #BFDBFE cool blue
 *   Q2   → #93C5FD light blue
 *   Q3   → #FCD34D yellow
 *   Q4   → #FB923C orange
 *   Q5   → #EF4444 red
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
const COLOR_CONTOUR = 'rgba(60,60,70,0.28)';
const COLOR_SKIN = '#F5F5F7';
const COLOR_TORSO_BG = '#FAFAFA';
const COLOR_HAIR = '#6B7B8C';
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

// Front-view labels render to the LEFT of the silhouette, text-anchor="end".
const FRONT_LABELS: readonly MuscleLabel[] = [
  { m_id: M_UPPER_CHEST, anchorX: 84, anchorY: 108, labelX: -4, labelY: 96 },
  { m_id: M_FRONT_DELT, anchorX: 58, anchorY: 106, labelX: -4, labelY: 116 },
  { m_id: M_MID_DELT, anchorX: 48, anchorY: 122, labelX: -4, labelY: 136 },
  { m_id: M_LOWER_CHEST, anchorX: 86, anchorY: 130, labelX: -4, labelY: 156 },
  { m_id: M_BICEP_LONG, anchorX: 42, anchorY: 150, labelX: -4, labelY: 176 },
  { m_id: M_BICEP_SHORT, anchorX: 60, anchorY: 156, labelX: -4, labelY: 196 },
  { m_id: M_ABS, anchorX: 100, anchorY: 178, labelX: -4, labelY: 216 },
  { m_id: M_OBLIQUE, anchorX: 76, anchorY: 186, labelX: -4, labelY: 236 },
  { m_id: M_FOREARM, anchorX: 46, anchorY: 200, labelX: -4, labelY: 256 },
  { m_id: M_QUAD, anchorX: 84, anchorY: 280, labelX: -4, labelY: 290 },
  { m_id: M_CALF, anchorX: 80, anchorY: 358, labelX: -4, labelY: 366 },
];

// Back-view labels render to the RIGHT of the silhouette, text-anchor="start".
const BACK_LABELS: readonly MuscleLabel[] = [
  { m_id: M_TRAP, anchorX: 100, anchorY: 100, labelX: 206, labelY: 92 },
  { m_id: M_REAR_DELT, anchorX: 150, anchorY: 106, labelX: 206, labelY: 114 },
  { m_id: M_BACK, anchorX: 100, anchorY: 138, labelX: 206, labelY: 138 },
  { m_id: M_TRICEP, anchorX: 154, anchorY: 144, labelX: 206, labelY: 162 },
  { m_id: M_LOWER_BACK, anchorX: 100, anchorY: 196, labelX: 206, labelY: 188 },
  { m_id: M_UPPER_GLUTE, anchorX: 100, anchorY: 218, labelX: 206, labelY: 212 },
  { m_id: M_LOWER_GLUTE, anchorX: 100, anchorY: 250, labelX: 206, labelY: 240 },
  { m_id: M_HAMSTRING, anchorX: 120, anchorY: 290, labelX: 206, labelY: 290 },
  { m_id: M_FOREARM, anchorX: 156, anchorY: 200, labelX: 206, labelY: 250 },
  { m_id: M_CALF, anchorX: 120, anchorY: 358, labelX: 206, labelY: 358 },
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
          <React.Fragment key={`${l.m_id}-${l.labelY}`}>
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
// Common head/hair/face geometry shared by front + back
// ---------------------------------------------------------------------------
//
// Body axis at x = 100. Frame is 282×408.
//
//   y ≈ 8..72   head
//   y ≈ 72..92  neck
//   y ≈ 92..212 torso (shoulders 92..98, chest 98..140, abs 140..200, hip 200..235)
//   y ≈ 100..230 arms (slightly OUT from torso — see arm paths)
//   y ≈ 235..325 thigh
//   y ≈ 325..340 knee
//   y ≈ 340..395 calf
//   y ≈ 395..405 foot

// ---------------------------------------------------------------------------
// Front view
// ---------------------------------------------------------------------------

function FrontBody({ mQuintile, mCount }: BodyHeatmapProps) {
  const f = (m: string) => fillForM(m, mQuintile);
  return (
    <Svg viewBox="-72 0 282 408" width={170} height={246}>
      {/* ===== Layer 1: body silhouette (skin) ===== */}
      {/* Head */}
      <Path
        d="M100 14 C82 14 70 28 70 46 C70 64 80 76 92 80 L92 90 L108 90 L108 80 C120 76 130 64 130 46 C130 28 118 14 100 14 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.9}
      />
      {/* Hair crew-cut cap */}
      <Path
        d="M76 38 C78 24 88 16 100 16 C112 16 122 24 124 38 C120 30 110 26 100 26 C90 26 80 30 76 38 Z"
        fill={COLOR_HAIR}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Face: nose ridge + chin shading (no eyes/mouth) */}
      <Path d="M100 46 L100 58 M98 58 L102 58" stroke={COLOR_CONTOUR} strokeWidth={0.5} fill="none" />
      <Path d="M88 66 C94 70 106 70 112 66" stroke={COLOR_CONTOUR} strokeWidth={0.5} fill="none" />

      {/* Neck w/ SCM ropes */}
      <Path
        d="M92 80 L108 80 L110 92 L100 96 L90 92 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.8}
      />
      <Path
        d="M94 82 L98 94 M106 82 L102 94"
        stroke={COLOR_CONTOUR}
        strokeWidth={0.5}
        fill="none"
      />

      {/* Torso silhouette — broad shoulders, V-taper to waist, slight hip flare. */}
      <Path
        d="M64 96 C58 100 56 106 56 114 L52 132 C50 156 50 182 56 204 C62 218 70 228 80 234 L120 234 C130 228 138 218 144 204 C150 182 150 156 148 132 L144 114 C144 106 142 100 136 96 L110 90 L90 90 Z"
        fill={COLOR_TORSO_BG}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.9}
      />

      {/* Arms — slightly apart from torso (visible gap), bent slightly,
         tapering from shoulder cap → upper arm → elbow → forearm → hand.
         LEFT arm (viewer-left, anatomical-right). */}
      <Path
        d="M56 100 C46 104 38 116 36 132 C32 152 30 174 32 196 C32 212 36 224 42 232 L48 234 L52 234 C52 218 52 200 50 184 C50 168 52 150 56 136 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.8}
      />
      {/* RIGHT arm */}
      <Path
        d="M144 100 C154 104 162 116 164 132 C168 152 170 174 168 196 C168 212 164 224 158 232 L152 234 L148 234 C148 218 148 200 150 184 C150 168 148 150 144 136 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.8}
      />

      {/* Hands — five-finger relaxed pose beside upper thigh */}
      <Path
        d="M40 232 L52 232 L54 246 L48 250 L42 250 L38 246 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.7}
      />
      {/* Finger separations (left hand) */}
      <Path
        d="M43 234 L43 248 M46 234 L46 250 M49 234 L49 248 M52 234 L52 246"
        stroke={COLOR_CONTOUR}
        strokeWidth={0.5}
        fill="none"
      />
      <Path
        d="M160 232 L148 232 L146 246 L152 250 L158 250 L162 246 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.7}
      />
      {/* Finger separations (right hand) */}
      <Path
        d="M157 234 L157 248 M154 234 L154 250 M151 234 L151 248 M148 234 L148 246"
        stroke={COLOR_CONTOUR}
        strokeWidth={0.5}
        fill="none"
      />

      {/* Thighs — slightly apart, with center gap (groin shadow) */}
      <Path
        d="M62 232 C58 252 58 286 64 322 C70 330 76 332 84 332 L94 332 C96 304 98 274 98 244 C96 238 92 234 88 232 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.8}
      />
      <Path
        d="M138 232 C142 252 142 286 136 322 C130 330 124 332 116 332 L106 332 C104 304 102 274 102 244 C104 238 108 234 112 232 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.8}
      />
      {/* Knees */}
      <Path
        d="M68 330 C72 336 78 340 86 340 L96 340 L96 332 L70 332 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.8}
      />
      <Path
        d="M132 330 C128 336 122 340 114 340 L104 340 L104 332 L130 332 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.8}
      />

      {/* Lower legs (calf + shin silhouette) */}
      <Path
        d="M70 340 C66 360 68 384 76 396 L94 396 C96 380 96 358 94 340 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.8}
      />
      <Path
        d="M130 340 C134 360 132 384 124 396 L106 396 C104 380 104 358 106 340 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.8}
      />

      {/* Feet */}
      <Path
        d="M74 396 L94 396 L96 404 L72 404 Z"
        fill={COLOR_TORSO_BG}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.8}
      />
      <Path
        d="M126 396 L106 396 L104 404 L128 404 Z"
        fill={COLOR_TORSO_BG}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.8}
      />

      {/* ===== Layer 2: shoulder caps / deltoids ===== */}
      {/* Front Deltoid (anterior, IMG_1371) — front-face shoulder cap, leaving
         lateral edge for mid-delt strip. */}
      <Path
        d="M64 96 C56 100 52 110 52 122 C56 124 62 124 68 122 C70 114 72 106 72 100 Z
           M136 96 C144 100 148 110 148 122 C144 124 138 124 132 122 C130 114 128 106 128 100 Z"
        fill={f(M_FRONT_DELT)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Front-delt inner contour */}
      <Path
        d="M58 110 C62 116 66 120 70 120 M142 110 C138 116 134 120 130 120"
        stroke={COLOR_CONTOUR}
        strokeWidth={0.5}
        fill="none"
      />

      {/* Mid Deltoid (lateral, IMG_1370) — outer cap, side-of-shoulder strip
         on the front view. Sits next to front-delt on the OUTSIDE. */}
      <Path
        d="M52 122 C44 124 40 132 40 142 C44 144 50 142 54 138 C54 130 54 124 52 122 Z
           M148 122 C156 124 160 132 160 142 C156 144 150 142 146 138 C146 130 146 124 148 122 Z"
        fill={f(M_MID_DELT)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />

      {/* ===== Layer 3: chest ===== */}
      {/* Upper Chest (IMG_1360) — slab under clavicle. */}
      <Path
        d="M100 96 L72 100 C68 106 68 114 72 120 L100 116 Z
           M100 96 L128 100 C132 106 132 114 128 120 L100 116 Z"
        fill={f(M_UPPER_CHEST)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Upper-chest fanning contour */}
      <Path
        d="M82 104 L96 116 M118 104 L104 116"
        stroke={COLOR_CONTOUR}
        strokeWidth={0.5}
        fill="none"
      />

      {/* Lower Chest (IMG_1361) — bigger lobed pec body with central V-notch. */}
      <Path
        d="M100 116 L70 120 C66 130 70 142 80 146 C90 144 96 138 100 132 Z
           M100 116 L130 120 C134 130 130 142 120 146 C110 144 104 138 100 132 Z"
        fill={f(M_LOWER_CHEST)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Pec V-notch */}
      <Path
        d="M100 116 L100 134"
        stroke={COLOR_CONTOUR}
        strokeWidth={0.7}
        fill="none"
      />
      <Path
        d="M76 132 L94 138 M124 132 L106 138"
        stroke={COLOR_CONTOUR}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ===== Layer 4: arms ===== */}
      {/* Bicep LONG (outer head, IMG_1368) — OUTER oval on the upper arm. */}
      <Path
        d="M40 140 C36 150 36 168 40 184 C42 192 46 196 50 196 L52 196 C52 184 54 168 54 154 C54 144 50 140 46 140 Z
           M160 140 C164 150 164 168 160 184 C158 192 154 196 150 196 L148 196 C148 184 146 168 146 154 C146 144 150 140 154 140 Z"
        fill={f(M_BICEP_LONG)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Long-head bulge contour */}
      <Path
        d="M44 152 C42 164 42 178 46 192 M156 152 C158 164 158 178 154 192"
        stroke={COLOR_CONTOUR}
        strokeWidth={0.5}
        fill="none"
      />

      {/* Bicep SHORT (inner head, IMG_1367) — INNER oval on the upper arm. */}
      <Path
        d="M54 144 C52 156 52 174 54 188 C58 192 62 192 64 188 C64 174 62 158 60 148 C58 144 56 144 54 144 Z
           M146 144 C148 156 148 174 146 188 C142 192 138 192 136 188 C136 174 138 158 140 148 C142 144 144 144 146 144 Z"
        fill={f(M_BICEP_SHORT)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Short-head contour */}
      <Path
        d="M56 156 C56 168 56 180 58 188 M144 156 C144 168 144 180 142 188"
        stroke={COLOR_CONTOUR}
        strokeWidth={0.5}
        fill="none"
      />

      {/* Forearm (IMG_1365 front face) — brachioradialis-lead bulge tapering to wrist. */}
      <Path
        d="M40 196 C36 208 34 222 38 232 L52 232 C54 222 54 210 54 198 C50 196 44 196 40 196 Z
           M160 196 C164 208 166 222 162 232 L148 232 C146 222 146 210 146 198 C150 196 156 196 160 196 Z"
        fill={f(M_FOREARM)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Forearm tapering contour */}
      <Path
        d="M44 204 L48 230 M52 200 L52 230 M156 204 L152 230 M148 200 L148 230"
        stroke={COLOR_CONTOUR}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ===== Layer 5: abdomen ===== */}
      {/* Abs (IMG_1373) — central rectus column, 4-grid intersections. */}
      <Path
        d="M88 142 C86 158 86 180 88 204 C92 208 96 208 100 206 C104 208 108 208 112 204 C114 180 114 158 112 142 C108 144 100 146 100 146 C100 146 92 144 88 142 Z"
        fill={f(M_ABS)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* 6-pack tendinous intersections */}
      <Path
        d="M100 146 L100 206
           M90 158 L110 158
           M90 174 L110 174
           M90 190 L110 190"
        stroke={COLOR_CONTOUR}
        strokeWidth={0.6}
        fill="none"
      />

      {/* Obliques (IMG_1372) — side wings flanking the abs. */}
      <Path
        d="M72 146 C70 162 70 180 72 198 C76 204 82 206 86 204 C86 184 86 162 86 144 C80 144 74 144 72 146 Z
           M128 146 C130 162 130 180 128 198 C124 204 118 206 114 204 C114 184 114 162 114 144 C120 144 126 144 128 146 Z"
        fill={f(M_OBLIQUE)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Oblique serration contour */}
      <Path
        d="M74 156 L84 164 M74 172 L84 180 M74 188 L84 196
           M126 156 L116 164 M126 172 L116 180 M126 188 L116 196"
        stroke={COLOR_CONTOUR}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ===== Layer 6: thigh ===== */}
      {/* Quadriceps (IMG_1377) — full anterior thigh, 3 visible heads. */}
      <Path
        d="M64 240 C60 258 60 290 66 322 C70 328 76 330 82 330 L92 330 C94 304 96 276 98 248 C96 242 92 240 88 240 Z
           M136 240 C140 258 140 290 134 322 C130 328 124 330 118 330 L108 330 C106 304 104 276 102 248 C104 242 108 240 112 240 Z"
        fill={f(M_QUAD)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Quad-head separation lines (rectus center + vastus lateralis/medialis) */}
      <Path
        d="M78 252 L84 328
           M88 254 L88 328
           M122 252 L116 328
           M112 254 L112 328"
        stroke={COLOR_CONTOUR}
        strokeWidth={0.6}
        fill="none"
      />

      {/* ===== Layer 7: calf (front face) ===== */}
      {/* Calf (IMG_1364) — gastroc diamond visible on front edges. */}
      <Path
        d="M72 342 C68 360 70 384 78 394 L86 394 C88 378 90 360 90 344 C88 342 80 342 72 342 Z
           M128 342 C132 360 130 384 122 394 L114 394 C112 378 110 360 110 344 C112 342 120 342 128 342 Z"
        fill={f(M_CALF)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Calf inner contour */}
      <Path
        d="M80 350 L84 392 M120 350 L116 392"
        stroke={COLOR_CONTOUR}
        strokeWidth={0.5}
        fill="none"
      />

      <MuscleLabels labels={FRONT_LABELS} mCount={mCount} textAnchor="end" />
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// Back view
// ---------------------------------------------------------------------------

function BackBody({ mQuintile, mCount }: BodyHeatmapProps) {
  const f = (m: string) => fillForM(m, mQuintile);
  return (
    <Svg viewBox="0 0 282 408" width={170} height={246}>
      {/* ===== Layer 1: body silhouette (skin) ===== */}
      {/* Head (back) */}
      <Path
        d="M100 14 C82 14 70 28 70 46 C70 64 80 76 92 80 L92 90 L108 90 L108 80 C120 76 130 64 130 46 C130 28 118 14 100 14 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.9}
      />
      {/* Hair (occipital crew-cut) */}
      <Path
        d="M74 36 C76 22 88 16 100 16 C112 16 124 22 126 36 C124 50 122 64 116 72 L84 72 C78 64 76 50 74 36 Z"
        fill={COLOR_HAIR}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Hair-nape line */}
      <Path d="M84 72 L116 72" stroke={COLOR_CONTOUR} strokeWidth={0.5} fill="none" />

      {/* Neck nape */}
      <Path
        d="M92 80 L108 80 L110 92 L100 96 L90 92 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.8}
      />

      {/* Torso silhouette — broad shoulders, V-taper, lumbar dimple. */}
      <Path
        d="M64 96 C58 100 56 106 56 114 L52 132 C50 156 50 182 56 204 C62 218 70 228 80 234 L120 234 C130 228 138 218 144 204 C150 182 150 156 148 132 L144 114 C144 106 142 100 136 96 L110 90 L90 90 Z"
        fill={COLOR_TORSO_BG}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.9}
      />

      {/* Arms (slightly apart, back face). */}
      <Path
        d="M56 100 C46 104 38 116 36 132 C32 152 30 174 32 196 C32 212 36 224 42 232 L48 234 L52 234 C52 218 52 200 50 184 C50 168 52 150 56 136 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.8}
      />
      <Path
        d="M144 100 C154 104 162 116 164 132 C168 152 170 174 168 196 C168 212 164 224 158 232 L152 234 L148 234 C148 218 148 200 150 184 C150 168 148 150 144 136 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.8}
      />

      {/* Hands (back of hand) */}
      <Path
        d="M40 232 L52 232 L54 246 L48 250 L42 250 L38 246 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.7}
      />
      <Path
        d="M43 234 L43 248 M46 234 L46 250 M49 234 L49 248 M52 234 L52 246"
        stroke={COLOR_CONTOUR}
        strokeWidth={0.5}
        fill="none"
      />
      <Path
        d="M160 232 L148 232 L146 246 L152 250 L158 250 L162 246 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.7}
      />
      <Path
        d="M157 234 L157 248 M154 234 L154 250 M151 234 L151 248 M148 234 L148 246"
        stroke={COLOR_CONTOUR}
        strokeWidth={0.5}
        fill="none"
      />

      {/* Thighs (back). Slightly apart, gluteal cleft visible. */}
      <Path
        d="M62 232 C58 252 58 286 64 322 C70 330 76 332 84 332 L94 332 C96 304 98 274 98 244 C96 238 92 234 88 232 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.8}
      />
      <Path
        d="M138 232 C142 252 142 286 136 322 C130 330 124 332 116 332 L106 332 C104 304 102 274 102 244 C104 238 108 234 112 232 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.8}
      />

      {/* Knees (popliteal) */}
      <Path
        d="M68 330 C72 336 78 340 86 340 L96 340 L96 332 L70 332 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.8}
      />
      <Path
        d="M132 330 C128 336 122 340 114 340 L104 340 L104 332 L130 332 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.8}
      />

      {/* Lower legs */}
      <Path
        d="M70 340 C66 360 68 384 76 396 L94 396 C96 380 96 358 94 340 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.8}
      />
      <Path
        d="M130 340 C134 360 132 384 124 396 L106 396 C104 380 104 358 106 340 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.8}
      />

      {/* Feet (heels) */}
      <Path
        d="M74 396 L94 396 L96 404 L72 404 Z"
        fill={COLOR_TORSO_BG}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.8}
      />
      <Path
        d="M126 396 L106 396 L104 404 L128 404 Z"
        fill={COLOR_TORSO_BG}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.8}
      />

      {/* ===== Layer 2: Trapezius (IMG_1359) ===== */}
      {/* Upper trap kite (neck → shoulder) + middle-trap diamond (between scapulae). */}
      <Path
        d="M100 90 C88 92 78 96 70 102 C72 110 80 114 90 114 C94 110 98 108 100 106 C102 108 106 110 110 114 C120 114 128 110 130 102 C122 96 112 92 100 90 Z
           M100 106 C92 114 86 126 84 140 C90 142 96 142 100 138 C104 142 110 142 116 140 C114 126 108 114 100 106 Z"
        fill={f(M_TRAP)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Trap fiber contour */}
      <Path
        d="M82 104 L100 112 M118 104 L100 112 M92 124 L100 136 M108 124 L100 136"
        stroke={COLOR_CONTOUR}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ===== Layer 3: deltoids (back) ===== */}
      {/* Rear Deltoid (IMG_1369) — rear shoulder cap. */}
      <Path
        d="M64 96 C56 100 52 110 52 122 C56 124 62 124 68 122 C70 114 72 106 72 100 Z
           M136 96 C144 100 148 110 148 122 C144 124 138 124 132 122 C130 114 128 106 128 100 Z"
        fill={f(M_REAR_DELT)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Rear-delt 3-fiber contour */}
      <Path
        d="M58 110 C62 116 66 120 70 120 M142 110 C138 116 134 120 130 120"
        stroke={COLOR_CONTOUR}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ===== Layer 4: Back / lats (IMG_1362) =====
         User feedback: 背部 = BUTTERFLY/HOURGLASS in mid-upper back between
         shoulder blades, NOT lat V-taper. Shape: two outer lobes meeting at
         a narrow waist along the spine, contained within shoulder blades. */}
      <Path
        d="M100 110 C92 112 84 118 78 128 C74 138 76 150 84 158 C90 162 94 162 100 156 C100 142 100 124 100 110 Z
           M100 110 C108 112 116 118 122 128 C126 138 124 150 116 158 C110 162 106 162 100 156 C100 142 100 124 100 110 Z
           M84 162 C86 174 92 184 100 188 C108 184 114 174 116 162 C110 168 106 170 100 170 C94 170 90 168 84 162 Z"
        fill={f(M_BACK)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Butterfly center spine + wing contour */}
      <Path
        d="M100 112 L100 186
           M86 130 C92 138 96 144 100 148
           M114 130 C108 138 104 144 100 148"
        stroke={COLOR_CONTOUR}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ===== Layer 5: triceps (IMG_1366) =====
         User feedback: SMALL wing on outer-upper-back-arm, NOT large horseshoe. */}
      <Path
        d="M40 130 C36 142 36 162 40 180 C44 186 48 188 52 184 C54 172 54 156 54 142 C52 134 48 130 44 130 Z
           M160 130 C164 142 164 162 160 180 C156 186 152 188 148 184 C146 172 146 156 146 142 C148 134 152 130 156 130 Z"
        fill={f(M_TRICEP)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Tricep wing contour */}
      <Path
        d="M44 144 L48 180 M156 144 L152 180"
        stroke={COLOR_CONTOUR}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ===== Layer 6: forearm (back face, IMG_1365) ===== */}
      <Path
        d="M40 196 C36 208 34 222 38 232 L52 232 C54 222 54 210 54 198 C50 196 44 196 40 196 Z
           M160 196 C164 208 166 222 162 232 L148 232 C146 222 146 210 146 198 C150 196 156 196 160 196 Z"
        fill={f(M_FOREARM)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      <Path
        d="M44 204 L48 230 M52 200 L52 230 M156 204 L152 230 M148 200 L148 230"
        stroke={COLOR_CONTOUR}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ===== Layer 7: Lower Back (IMG_1363) =====
         Small horizontal lumbar slab right above sacrum. */}
      <Path
        d="M88 190 C84 196 84 206 88 212 L112 212 C116 206 116 196 112 190 C108 194 100 196 100 196 C100 196 92 194 88 190 Z"
        fill={f(M_LOWER_BACK)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Erector spinae contour */}
      <Path
        d="M94 194 L94 210
           M100 196 L100 212
           M106 194 L106 210"
        stroke={COLOR_CONTOUR}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ===== Layer 8: Glutes ===== */}
      {/* Upper Glute (IMG_1374) — upper hip crescents above main glute. */}
      <Path
        d="M70 214 C64 220 62 228 64 234 C70 236 78 234 84 230 C88 226 94 222 98 218 C92 214 80 212 70 214 Z
           M130 214 C136 220 138 228 136 234 C130 236 122 234 116 230 C112 226 106 222 102 218 C108 214 120 212 130 214 Z"
        fill={f(M_UPPER_GLUTE)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      <Path
        d="M70 222 L84 230 M130 222 L116 230"
        stroke={COLOR_CONTOUR}
        strokeWidth={0.5}
        fill="none"
      />

      {/* Lower Glute (IMG_1375) — main glute dome (two rounded buttocks). */}
      <Path
        d="M76 234 C68 240 62 254 62 268 C62 278 68 286 78 286 C88 286 96 280 100 268 C100 258 100 244 100 238 C94 234 86 234 76 234 Z
           M124 234 C132 240 138 254 138 268 C138 278 132 286 122 286 C112 286 104 280 100 268 C100 258 100 244 100 238 C106 234 114 234 124 234 Z"
        fill={f(M_LOWER_GLUTE)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Glute cleft + sweep contour */}
      <Path
        d="M100 238 L100 286
           M74 252 L88 274
           M126 252 L112 274"
        stroke={COLOR_CONTOUR}
        strokeWidth={0.6}
        fill="none"
      />

      {/* ===== Layer 9: Hamstrings (IMG_1376) — posterior thigh ===== */}
      <Path
        d="M66 286 C62 304 62 322 68 328 L82 330 C86 318 90 304 92 286 C84 282 74 282 66 286 Z
           M92 286 C90 304 90 318 94 330 L96 330 C98 308 100 290 100 270 C96 270 94 278 92 286 Z
           M134 286 C138 304 138 322 132 328 L118 330 C114 318 110 304 108 286 C116 282 126 282 134 286 Z
           M108 286 C110 304 110 318 106 330 L104 330 C102 308 100 290 100 270 C104 270 106 278 108 286 Z"
        fill={f(M_HAMSTRING)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Hamstring head separation contour */}
      <Path
        d="M74 290 L80 326
           M88 286 L92 328
           M100 280 L100 328
           M112 286 L108 328
           M126 290 L120 326"
        stroke={COLOR_CONTOUR}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ===== Layer 10: calf (back face, IMG_1364) ===== */}
      <Path
        d="M72 342 C68 360 70 384 78 394 L86 394 C88 378 90 360 90 344 C88 342 80 342 72 342 Z
           M128 342 C132 360 130 384 122 394 L114 394 C112 378 110 360 110 344 C112 342 120 342 128 342 Z"
        fill={f(M_CALF)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Calf gastroc midline */}
      <Path
        d="M80 350 L84 392 M120 350 L116 392
           M76 372 L86 368 M124 372 L114 368"
        stroke={COLOR_CONTOUR}
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
