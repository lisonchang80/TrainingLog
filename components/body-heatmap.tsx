/**
 * Body Heatmap — front + back anatomical M-layer human silhouette,
 * each muscle filled by per-Session frequency quintile.
 *
 * Variant B (2026-05-23) — Sports-magazine "pumped" rendition:
 *   - Larger viewBox (-80 0 320 520) at 200×290 render size for thumbnail
 *     readability.
 *   - Dramatic muscle bulk: deeper Bezier control points giving pronounced
 *     bellies on biceps, chest, lats, quads, calves.
 *   - 3D depth via inner-shadow path layers (a darker rgba path inset from
 *     each major muscle outline → rim-light / volume rendering).
 *   - Thicker striation strokes (0.8-1.0 px) — 3-5 fiber lines per muscle
 *     in anatomical fiber direction.
 *   - 18 distinct muscle bellies painted individually (上胸 / 中下胸 / 前束 /
 *     中束 / 後束 / 二頭內外 / 三頭 / 上下臀部 / 股四 / 膕繩 / 腹肌 / 側腹 /
 *     斜方 / 背部 / 下背 / 小腿 / 小臂).
 *   - Each muscle still has a primary fill path coloured by quintile so the
 *     heatmap semantics are preserved.
 *
 * Reference style: athletic-male anatomy chart with visible muscle bellies
 * (pec V-notch, deltoid 3-head split, bicep twin bulge, tricep horseshoe,
 * lat V-taper, quad 3-head teardrop, gastroc diamond, etc).
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

const COLOR_OUTLINE = '#6B7280';
const COLOR_STRIATION = 'rgba(40,40,55,0.45)';
const COLOR_SHADOW = 'rgba(20,20,30,0.18)';
const COLOR_HIGHLIGHT = 'rgba(255,255,255,0.22)';
const COLOR_SKIN = '#F2F2F5';
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

// Label coordinates are tuned to the new viewBox `-80 0 320 520`.
// Anchor points sit on the muscle belly; label endpoints fan out to the
// negative-X gutter (front) or positive-X gutter (back) of the viewBox.

const FRONT_LABELS: readonly MuscleLabel[] = [
  { m_id: M_FRONT_DELT, anchorX: 52, anchorY: 118, labelX: -10, labelY: 110 },
  { m_id: M_UPPER_CHEST, anchorX: 92, anchorY: 116, labelX: -10, labelY: 134 },
  { m_id: M_LOWER_CHEST, anchorX: 92, anchorY: 146, labelX: -10, labelY: 158 },
  { m_id: M_BICEP_LONG, anchorX: 38, anchorY: 162, labelX: -10, labelY: 182 },
  { m_id: M_BICEP_SHORT, anchorX: 52, anchorY: 174, labelX: -10, labelY: 206 },
  { m_id: M_ABS, anchorX: 100, anchorY: 196, labelX: -10, labelY: 230 },
  { m_id: M_OBLIQUE, anchorX: 70, anchorY: 208, labelX: -10, labelY: 254 },
  { m_id: M_FOREARM, anchorX: 44, anchorY: 226, labelX: -10, labelY: 278 },
  { m_id: M_QUAD, anchorX: 80, anchorY: 320, labelX: -10, labelY: 332 },
  { m_id: M_CALF, anchorX: 80, anchorY: 432, labelX: -10, labelY: 420 },
];

const BACK_LABELS: readonly MuscleLabel[] = [
  { m_id: M_TRAP, anchorX: 100, anchorY: 108, labelX: 230, labelY: 102 },
  { m_id: M_REAR_DELT, anchorX: 152, anchorY: 118, labelX: 230, labelY: 126 },
  { m_id: M_MID_DELT, anchorX: 160, anchorY: 134, labelX: 230, labelY: 150 },
  { m_id: M_BACK, anchorX: 100, anchorY: 152, labelX: 230, labelY: 174 },
  { m_id: M_TRICEP, anchorX: 156, anchorY: 168, labelX: 230, labelY: 198 },
  { m_id: M_LOWER_BACK, anchorX: 100, anchorY: 218, labelX: 230, labelY: 222 },
  { m_id: M_UPPER_GLUTE, anchorX: 100, anchorY: 248, labelX: 230, labelY: 246 },
  { m_id: M_LOWER_GLUTE, anchorX: 100, anchorY: 290, labelX: 230, labelY: 274 },
  { m_id: M_HAMSTRING, anchorX: 118, anchorY: 340, labelX: 230, labelY: 322 },
  { m_id: M_CALF, anchorX: 120, anchorY: 432, labelX: 230, labelY: 418 },
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
              strokeWidth={0.7}
            />
            <SvgText
              x={l.labelX}
              y={l.labelY + 4}
              fontSize={11}
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
// Front view — 10 distinct M-paths + striations + 3D inner shadows
// ---------------------------------------------------------------------------

function FrontBody({ mQuintile, mCount }: BodyHeatmapProps) {
  const f = (m: string) => fillForM(m, mQuintile);
  return (
    <Svg viewBox="-80 0 320 520" width={200} height={290}>
      {/* ============================================================ */}
      {/* Head — strong square jaw + occipital dome                    */}
      {/* ============================================================ */}
      <Path
        d="M100 8 C78 8 64 24 64 44 C64 60 70 72 78 80 C82 86 88 90 100 90 C112 90 118 86 122 80 C130 72 136 60 136 44 C136 24 122 8 100 8 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.9}
      />
      {/* Brow shadow */}
      <Path d="M76 36 C86 30 114 30 124 36" stroke={COLOR_OUTLINE} strokeWidth={0.7} fill="none" />
      {/* Jawline shadow */}
      <Path d="M82 70 C90 80 110 80 118 70" stroke={COLOR_OUTLINE} strokeWidth={0.6} fill="none" />

      {/* Neck — broad sternocleidomastoid pillars */}
      <Path
        d="M86 88 L114 88 L116 104 L100 110 L84 104 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.9}
      />
      {/* SCM rope shadow */}
      <Path d="M92 90 L96 108 M108 90 L104 108" stroke={COLOR_STRIATION} strokeWidth={0.8} fill="none" />

      {/* ============================================================ */}
      {/* Trapezius — front yoke (broad triangular wedge clavicle→neck) */}
      {/* ============================================================ */}
      <Path
        d="M86 104 C72 108 58 112 50 116 L60 124 L100 116 L140 124 L150 116 C142 112 128 108 114 104 L100 112 Z"
        fill={f(M_TRAP)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.8}
      />
      {/* Trap inner shadow rim */}
      <Path
        d="M88 110 C76 114 64 118 58 122 M112 110 C124 114 136 118 142 122"
        stroke={COLOR_SHADOW}
        strokeWidth={1.6}
        fill="none"
      />
      {/* Trap fiber striations (radiating from neck base) */}
      <Path
        d="M70 118 L94 114
           M82 122 L98 116
           M130 118 L106 114
           M118 122 L102 116"
        stroke={COLOR_STRIATION}
        strokeWidth={0.9}
        fill="none"
      />

      {/* ============================================================ */}
      {/* Torso silhouette — pronounced V-taper                         */}
      {/* ============================================================ */}
      <Path
        d="M50 116 C44 126 36 144 36 162 C34 188 32 214 38 234 L100 244 L162 234 C168 214 166 188 164 162 C164 144 156 126 150 116 L100 118 Z"
        fill="#FAFAFA"
        stroke={COLOR_OUTLINE}
        strokeWidth={0.9}
      />

      {/* ============================================================ */}
      {/* Front Deltoid — chunky 3D anterior cap                        */}
      {/* ============================================================ */}
      <Path
        d="M50 116 C34 120 24 138 22 158 C22 168 30 176 42 174 C46 162 50 146 54 130 C56 122 56 116 50 116 Z
           M150 116 C166 120 176 138 178 158 C178 168 170 176 158 174 C154 162 150 146 146 130 C144 122 144 116 150 116 Z"
        fill={f(M_FRONT_DELT)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.8}
      />
      {/* Front delt inner shadow (rim-light effect) */}
      <Path
        d="M30 142 C30 152 32 164 38 172 M170 142 C170 152 168 164 162 172"
        stroke={COLOR_SHADOW}
        strokeWidth={1.8}
        fill="none"
      />
      {/* Front delt highlight (top arc — pumped-up gleam) */}
      <Path
        d="M34 130 C40 124 46 122 50 124 M166 130 C160 124 154 122 150 124"
        stroke={COLOR_HIGHLIGHT}
        strokeWidth={1.4}
        fill="none"
      />
      {/* Front delt fiber striations (clavicle fan outward) */}
      <Path
        d="M30 130 C34 144 38 162 42 172
           M40 124 C42 138 44 156 46 172
           M170 130 C166 144 162 162 158 172
           M160 124 C158 138 156 156 154 172"
        stroke={COLOR_STRIATION}
        strokeWidth={0.9}
        fill="none"
      />

      {/* ============================================================ */}
      {/* Mid Deltoid — lateral cap edge visible from front              */}
      {/* ============================================================ */}
      <Path
        d="M24 158 C18 168 18 184 24 196 C32 192 36 180 34 168 C34 162 30 158 24 158 Z
           M176 158 C182 168 182 184 176 196 C168 192 164 180 166 168 C166 162 170 158 176 158 Z"
        fill={f(M_MID_DELT)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.8}
      />
      {/* Mid delt shadow */}
      <Path d="M22 174 C22 184 24 192 28 196 M178 174 C178 184 176 192 172 196" stroke={COLOR_SHADOW} strokeWidth={1.4} fill="none" />

      {/* ============================================================ */}
      {/* Upper Chest — pec major clavicular head (dramatic upper arc)  */}
      {/* ============================================================ */}
      <Path
        d="M100 116 C86 118 74 124 64 134 C56 142 54 152 58 158 L100 144 Z
           M100 116 C114 118 126 124 136 134 C144 142 146 152 142 158 L100 144 Z"
        fill={f(M_UPPER_CHEST)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.8}
      />
      {/* Upper chest inner shadow — pec rim under deltoid */}
      <Path
        d="M64 128 C58 138 56 148 60 156 M136 128 C142 138 144 148 140 156"
        stroke={COLOR_SHADOW}
        strokeWidth={1.6}
        fill="none"
      />
      {/* Upper chest highlight — clavicle gleam */}
      <Path
        d="M76 120 C68 124 64 130 62 138 M124 120 C132 124 136 130 138 138"
        stroke={COLOR_HIGHLIGHT}
        strokeWidth={1.4}
        fill="none"
      />
      {/* Upper chest fiber striations (clavicular fan, down-and-out) */}
      <Path
        d="M76 120 L92 144
           M86 118 L96 146
           M114 118 L104 146
           M124 120 L108 144"
        stroke={COLOR_STRIATION}
        strokeWidth={0.9}
        fill="none"
      />

      {/* ============================================================ */}
      {/* Lower Chest — pec sternal lobe (lobed C with deep V-notch)    */}
      {/* ============================================================ */}
      <Path
        d="M100 144 L58 158 C54 172 58 184 68 188 C80 188 92 178 100 162 Z
           M100 144 L142 158 C146 172 142 184 132 188 C120 188 108 178 100 162 Z"
        fill={f(M_LOWER_CHEST)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.8}
      />
      {/* Lower chest inner shadow — under-pec shadow line */}
      <Path
        d="M64 174 C72 184 84 188 96 184 M136 174 C128 184 116 188 104 184"
        stroke={COLOR_SHADOW}
        strokeWidth={1.8}
        fill="none"
      />
      {/* Lower chest highlight — bulge gleam */}
      <Path
        d="M72 154 C80 158 88 160 96 156 M128 154 C120 158 112 160 104 156"
        stroke={COLOR_HIGHLIGHT}
        strokeWidth={1.4}
        fill="none"
      />
      {/* V-notch + lower-chest sternal fibers (horizontal sweep) */}
      <Path
        d="M100 144 L100 162
           M64 162 L96 168
           M72 178 L94 174
           M136 162 L104 168
           M128 178 L106 174"
        stroke={COLOR_STRIATION}
        strokeWidth={0.9}
        fill="none"
      />

      {/* ============================================================ */}
      {/* Biceps brachii — TWIN BULGE per arm (long + short heads)      */}
      {/* ============================================================ */}
      {/* Bicep LONG (outer/lateral head) — pumped outer lobe */}
      <Path
        d="M22 160 C12 174 10 192 16 210 C20 220 28 224 34 222 C38 208 42 192 42 178 C42 168 34 160 22 160 Z
           M178 160 C188 174 190 192 184 210 C180 220 172 224 166 222 C162 208 158 192 158 178 C158 168 166 160 178 160 Z"
        fill={f(M_BICEP_LONG)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.8}
      />
      {/* Bicep long head shadow — outer rim */}
      <Path
        d="M14 184 C14 198 18 212 26 220 M186 184 C186 198 182 212 174 220"
        stroke={COLOR_SHADOW}
        strokeWidth={1.8}
        fill="none"
      />
      {/* Bicep long head highlight — peak gleam */}
      <Path
        d="M22 174 C28 174 34 178 36 184 M178 174 C172 174 166 178 164 184"
        stroke={COLOR_HIGHLIGHT}
        strokeWidth={1.4}
        fill="none"
      />

      {/* Bicep SHORT (inner/medial head) — inner lobe */}
      <Path
        d="M42 168 C38 184 40 202 46 214 C52 218 58 218 60 212 C60 198 56 184 54 174 C50 168 46 166 42 168 Z
           M158 168 C162 184 160 202 154 214 C148 218 142 218 140 212 C140 198 144 184 146 174 C150 168 154 166 158 168 Z"
        fill={f(M_BICEP_SHORT)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.8}
      />
      {/* Bicep short head shadow — inner gully between heads */}
      <Path
        d="M42 184 C42 198 46 210 52 216 M158 184 C158 198 154 210 148 216"
        stroke={COLOR_SHADOW}
        strokeWidth={1.4}
        fill="none"
      />
      {/* Bicep striations (longitudinal muscle-belly fibers) */}
      <Path
        d="M18 178 L30 218
           M26 174 L34 218
           M48 178 L54 214
           M54 184 L58 212
           M182 178 L170 218
           M174 174 L166 218
           M152 178 L146 214
           M146 184 L142 212"
        stroke={COLOR_STRIATION}
        strokeWidth={0.9}
        fill="none"
      />

      {/* ============================================================ */}
      {/* Abs — rectus abdominis 6-pack grid (3 rows × 2 cols)          */}
      {/* ============================================================ */}
      <Path
        d="M82 158 C78 178 78 206 82 232 C88 238 96 238 100 234 C104 238 112 238 118 232 C122 206 122 178 118 158 C110 162 100 164 100 164 C100 164 90 162 82 158 Z"
        fill={f(M_ABS)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.8}
      />
      {/* Abs deep linea alba shadow */}
      <Path d="M100 166 L100 234" stroke={COLOR_SHADOW} strokeWidth={2.0} fill="none" />
      {/* Abs 6-pack tendinous intersections + highlight ridges */}
      <Path
        d="M86 178 L114 178
           M86 196 L114 196
           M86 214 L114 214"
        stroke={COLOR_SHADOW}
        strokeWidth={1.6}
        fill="none"
      />
      <Path
        d="M100 166 L100 234
           M86 178 L114 178
           M86 196 L114 196
           M86 214 L114 214"
        stroke={COLOR_STRIATION}
        strokeWidth={0.9}
        fill="none"
      />
      {/* Abs highlight (ridge top of each ab box) */}
      <Path
        d="M92 170 L92 176
           M108 170 L108 176
           M92 184 L92 194
           M108 184 L108 194"
        stroke={COLOR_HIGHLIGHT}
        strokeWidth={1.2}
        fill="none"
      />

      {/* ============================================================ */}
      {/* Obliques — side wedge flanking abs                            */}
      {/* ============================================================ */}
      <Path
        d="M62 168 C58 188 58 212 62 228 C68 234 76 236 82 234 C82 208 82 182 82 162 C74 162 66 164 62 168 Z
           M138 168 C142 188 142 212 138 228 C132 234 124 236 118 234 C118 208 118 182 118 162 C126 162 134 164 138 168 Z"
        fill={f(M_OBLIQUE)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.8}
      />
      {/* Oblique shadow — under-rib shadow */}
      <Path d="M60 182 C60 200 62 218 66 230 M140 182 C140 200 138 218 134 230" stroke={COLOR_SHADOW} strokeWidth={1.4} fill="none" />
      {/* Oblique serration striations (slanted lateral fibers) */}
      <Path
        d="M64 176 L80 188
           M64 196 L80 208
           M62 214 L80 226
           M136 176 L120 188
           M136 196 L120 208
           M138 214 L120 226"
        stroke={COLOR_STRIATION}
        strokeWidth={0.9}
        fill="none"
      />

      {/* ============================================================ */}
      {/* Forearm — brachioradialis bulge tapering to wrist             */}
      {/* ============================================================ */}
      <Path
        d="M34 212 C28 224 28 246 34 262 C40 270 48 274 54 270 C58 256 58 236 54 220 C50 214 42 210 34 212 Z
           M166 212 C172 224 172 246 166 262 C160 270 152 274 146 270 C142 256 142 236 146 220 C150 214 158 210 166 212 Z"
        fill={f(M_FOREARM)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.8}
      />
      {/* Forearm shadow — under-flexor mass */}
      <Path d="M30 234 C30 250 32 264 38 270 M170 234 C170 250 168 264 162 270" stroke={COLOR_SHADOW} strokeWidth={1.6} fill="none" />
      {/* Forearm striations */}
      <Path
        d="M36 220 L48 266
           M42 218 L52 268
           M50 220 L54 266
           M164 220 L152 266
           M158 218 L148 268
           M150 220 L146 266"
        stroke={COLOR_STRIATION}
        strokeWidth={0.9}
        fill="none"
      />

      {/* ============================================================ */}
      {/* Hip / pelvis silhouette + inguinal V                          */}
      {/* ============================================================ */}
      <Path
        d="M38 234 C46 254 60 270 74 278 L126 278 C140 270 154 254 162 234 L100 250 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.9}
      />
      {/* Inguinal V (apollo's belt) shadow */}
      <Path
        d="M80 246 L100 270 M120 246 L100 270"
        stroke={COLOR_SHADOW}
        strokeWidth={1.4}
        fill="none"
      />

      {/* ============================================================ */}
      {/* Quadriceps — 3 visible heads with teardrop vastus medialis    */}
      {/* ============================================================ */}
      <Path
        d="M58 282 C50 306 46 348 52 388 C58 394 64 396 70 392 C74 354 80 318 86 290 C76 284 64 282 58 282 Z
           M142 282 C150 306 154 348 148 388 C142 394 136 396 130 392 C126 354 120 318 114 290 C124 284 136 282 142 282 Z
           M86 290 C82 322 82 364 88 392 L100 392 C102 358 102 320 100 294 C96 288 90 286 86 290 Z
           M114 290 C118 322 118 364 112 392 L100 392 C98 358 98 320 100 294 C104 288 110 286 114 290 Z"
        fill={f(M_QUAD)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.8}
      />
      {/* Quad inner shadow — vastus lateralis sweep */}
      <Path
        d="M56 318 C54 340 54 366 60 388 M144 318 C146 340 146 366 140 388"
        stroke={COLOR_SHADOW}
        strokeWidth={2.0}
        fill="none"
      />
      {/* Quad highlight — rectus femoris ridge gleam */}
      <Path
        d="M100 298 L100 380"
        stroke={COLOR_HIGHLIGHT}
        strokeWidth={1.6}
        fill="none"
      />
      {/* Quad rectus + vastus separation grooves */}
      <Path
        d="M88 308 C84 340 84 372 90 388 M112 308 C116 340 116 372 110 388"
        stroke={COLOR_SHADOW}
        strokeWidth={1.4}
        fill="none"
      />
      {/* Quad teardrop (vastus medialis) accent */}
      <Path
        d="M74 376 C72 384 76 392 84 392 M126 376 C128 384 124 392 116 392"
        stroke={COLOR_SHADOW}
        strokeWidth={1.6}
        fill="none"
      />
      {/* Quad fiber striations (3 head separation lines) */}
      <Path
        d="M66 300 L78 388
           M84 304 L90 388
           M100 298 L100 388
           M114 304 L110 388
           M134 300 L120 388"
        stroke={COLOR_STRIATION}
        strokeWidth={0.9}
        fill="none"
      />

      {/* Knee — patella + skin */}
      <Path
        d="M60 392 C64 400 72 406 82 406 L94 406 C98 400 98 396 94 392 Z
           M106 392 C106 396 106 400 110 406 L120 406 C128 406 136 400 140 392 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.9}
      />

      {/* ============================================================ */}
      {/* Calf — gastrocnemius diamond visible from front               */}
      {/* ============================================================ */}
      <Path
        d="M66 406 C58 426 58 458 64 480 C68 492 74 500 80 502 L86 502 C90 482 92 458 92 434 C92 422 88 412 82 406 Z
           M108 406 C112 412 112 422 108 434 C108 458 110 482 114 502 L120 502 C126 500 132 492 136 480 C142 458 142 426 134 406 Z"
        fill={f(M_CALF)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.8}
      />
      {/* Calf inner shadow */}
      <Path d="M62 432 C62 462 66 488 74 500 M138 432 C138 462 134 488 126 500" stroke={COLOR_SHADOW} strokeWidth={1.8} fill="none" />
      {/* Calf highlight (gastroc belly gleam) */}
      <Path
        d="M78 420 L80 472 M122 420 L120 472"
        stroke={COLOR_HIGHLIGHT}
        strokeWidth={1.4}
        fill="none"
      />
      {/* Calf diamond mid-line striations */}
      <Path
        d="M76 414 L82 498
           M84 418 L86 496
           M124 414 L118 498
           M116 418 L114 496"
        stroke={COLOR_STRIATION}
        strokeWidth={0.9}
        fill="none"
      />

      {/* Ankle / foot */}
      <Path
        d="M74 502 L92 502 L94 516 L72 516 Z M108 502 L126 502 L128 516 L106 516 Z"
        fill="#FAFAFA"
        stroke={COLOR_OUTLINE}
        strokeWidth={0.9}
      />

      <MuscleLabels labels={FRONT_LABELS} mCount={mCount} textAnchor="end" />
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// Back view — 10 distinct M-paths + striations + 3D inner shadows
// ---------------------------------------------------------------------------

function BackBody({ mQuintile, mCount }: BodyHeatmapProps) {
  const f = (m: string) => fillForM(m, mQuintile);
  return (
    <Svg viewBox="0 0 320 520" width={200} height={290}>
      {/* Head — occipital cranium */}
      <Path
        d="M100 8 C78 8 64 24 64 44 C64 60 70 72 78 80 C82 86 88 90 100 90 C112 90 118 86 122 80 C130 72 136 60 136 44 C136 24 122 8 100 8 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.9}
      />
      {/* Occipital hairline */}
      <Path d="M76 64 C86 72 114 72 124 64" stroke={COLOR_OUTLINE} strokeWidth={0.7} fill="none" />

      {/* Neck nape */}
      <Path
        d="M86 88 L114 88 L116 104 L100 110 L84 104 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.9}
      />
      <Path d="M92 90 L96 108 M108 90 L104 108" stroke={COLOR_STRIATION} strokeWidth={0.8} fill="none" />

      {/* ============================================================ */}
      {/* Torso outline                                                 */}
      {/* ============================================================ */}
      <Path
        d="M50 116 C44 126 36 144 36 162 C34 188 32 214 38 234 L100 244 L162 234 C168 214 166 188 164 162 C164 144 156 126 150 116 L100 118 Z"
        fill="#FAFAFA"
        stroke={COLOR_OUTLINE}
        strokeWidth={0.9}
      />

      {/* ============================================================ */}
      {/* Trapezius — back kite + middle diamond down between scapulae  */}
      {/* ============================================================ */}
      <Path
        d="M100 96 C86 100 70 108 58 118 C56 124 62 128 68 130 C82 128 92 124 100 120 C108 124 118 128 132 130 C138 128 144 124 142 118 C130 108 114 100 100 96 Z
           M100 120 C90 130 82 142 78 158 C86 164 94 170 100 178 C106 170 114 164 122 158 C118 142 110 130 100 120 Z"
        fill={f(M_TRAP)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.8}
      />
      {/* Trap inner shadow (kite + diamond bevels) */}
      <Path
        d="M68 122 C76 116 86 110 100 108 M132 122 C124 116 114 110 100 108
           M84 142 C90 132 96 124 100 122 M116 142 C110 132 104 124 100 122"
        stroke={COLOR_SHADOW}
        strokeWidth={1.6}
        fill="none"
      />
      {/* Trap highlight */}
      <Path
        d="M80 116 L98 118 M120 116 L102 118"
        stroke={COLOR_HIGHLIGHT}
        strokeWidth={1.4}
        fill="none"
      />
      {/* Trap fiber striations (radiating from spine/neck) */}
      <Path
        d="M76 116 L100 126
           M124 116 L100 126
           M86 146 L100 164
           M114 146 L100 164
           M92 134 L100 144
           M108 134 L100 144"
        stroke={COLOR_STRIATION}
        strokeWidth={0.9}
        fill="none"
      />

      {/* ============================================================ */}
      {/* Rear Deltoid — posterior head lobe                            */}
      {/* ============================================================ */}
      <Path
        d="M50 116 C34 120 24 138 22 158 C22 168 30 174 42 172 C46 160 50 144 54 130 C56 122 56 116 50 116 Z
           M150 116 C166 120 176 138 178 158 C178 168 170 174 158 172 C154 160 150 144 146 130 C144 122 144 116 150 116 Z"
        fill={f(M_REAR_DELT)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.8}
      />
      {/* Rear delt shadow */}
      <Path
        d="M30 140 C30 152 32 164 38 172 M170 140 C170 152 168 164 162 172"
        stroke={COLOR_SHADOW}
        strokeWidth={1.6}
        fill="none"
      />
      {/* Rear delt highlight */}
      <Path
        d="M34 130 C40 124 46 122 50 124 M166 130 C160 124 154 122 150 124"
        stroke={COLOR_HIGHLIGHT}
        strokeWidth={1.4}
        fill="none"
      />
      {/* Rear delt striations (posterior fibers converging at olecranon) */}
      <Path
        d="M30 132 C34 146 38 162 42 172
           M40 126 C42 140 44 158 46 170
           M170 132 C166 146 162 162 158 172
           M160 126 C158 140 156 158 154 170"
        stroke={COLOR_STRIATION}
        strokeWidth={0.9}
        fill="none"
      />

      {/* ============================================================ */}
      {/* Mid Deltoid — lateral cap visible at upper outer edge         */}
      {/* ============================================================ */}
      <Path
        d="M24 158 C18 168 20 184 28 194 C32 186 34 174 30 158 Z
           M176 158 C182 168 180 184 172 194 C168 186 166 174 170 158 Z"
        fill={f(M_MID_DELT)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.8}
      />
      {/* Mid delt shadow */}
      <Path d="M22 174 C22 184 24 192 28 196 M178 174 C178 184 176 192 172 196" stroke={COLOR_SHADOW} strokeWidth={1.4} fill="none" />

      {/* ============================================================ */}
      {/* Latissimus dorsi + erector spinae — pumped V-taper            */}
      {/* ============================================================ */}
      <Path
        d="M52 130 C46 158 52 192 64 218 C76 226 90 228 100 224 C94 192 86 158 78 134 C72 128 62 126 52 130 Z
           M148 130 C154 158 148 192 136 218 C124 226 110 228 100 224 C106 192 114 158 122 134 C128 128 138 126 148 130 Z
           M90 158 C86 178 86 200 90 220 L98 220 L98 158 Z
           M110 158 C114 178 114 200 110 220 L102 220 L102 158 Z"
        fill={f(M_BACK)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.8}
      />
      {/* Lat inner shadow — under-armpit lat sweep */}
      <Path
        d="M58 144 C56 174 64 206 78 222 M142 144 C144 174 136 206 122 222"
        stroke={COLOR_SHADOW}
        strokeWidth={2.0}
        fill="none"
      />
      {/* Lat highlight — pumped outer ridge gleam */}
      <Path
        d="M62 138 L76 218 M138 138 L124 218"
        stroke={COLOR_HIGHLIGHT}
        strokeWidth={1.4}
        fill="none"
      />
      {/* Erector spinae deep groove */}
      <Path
        d="M100 130 L100 220"
        stroke={COLOR_SHADOW}
        strokeWidth={1.6}
        fill="none"
      />
      {/* Lat V striations (diagonal fibers sweeping down-and-inward) */}
      <Path
        d="M60 144 L86 218
           M70 140 L92 216
           M80 138 L98 214
           M140 144 L114 218
           M130 140 L108 216
           M120 138 L102 214"
        stroke={COLOR_STRIATION}
        strokeWidth={0.9}
        fill="none"
      />

      {/* ============================================================ */}
      {/* Triceps brachii — horseshoe with 3-head fork                  */}
      {/* ============================================================ */}
      <Path
        d="M22 144 C12 158 10 180 14 200 C18 210 26 214 32 212 C36 198 40 180 40 162 C40 152 32 144 22 144 Z
           M40 156 C36 174 36 196 40 210 C46 214 52 214 54 208 C54 192 50 174 48 162 C46 156 44 154 40 156 Z
           M178 144 C188 158 190 180 186 200 C182 210 174 214 168 212 C164 198 160 180 160 162 C160 152 168 144 178 144 Z
           M160 156 C164 174 164 196 160 210 C154 214 148 214 146 208 C146 192 150 174 152 162 C154 156 156 154 160 156 Z"
        fill={f(M_TRICEP)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.8}
      />
      {/* Tricep inner shadow — horseshoe rim */}
      <Path
        d="M14 168 C14 188 18 206 26 212 M186 168 C186 188 182 206 174 212"
        stroke={COLOR_SHADOW}
        strokeWidth={1.8}
        fill="none"
      />
      {/* Tricep highlight — lateral head gleam */}
      <Path
        d="M22 158 C28 158 34 162 36 168 M178 158 C172 158 166 162 164 168"
        stroke={COLOR_HIGHLIGHT}
        strokeWidth={1.4}
        fill="none"
      />
      {/* Tricep horseshoe striations (longitudinal + medial dip) */}
      <Path
        d="M18 160 L30 210
           M26 156 L34 210
           M48 162 L52 206
           M182 160 L170 210
           M174 156 L166 210
           M152 162 L148 206"
        stroke={COLOR_STRIATION}
        strokeWidth={0.9}
        fill="none"
      />

      {/* ============================================================ */}
      {/* Forearm (back / extensor compartment)                         */}
      {/* ============================================================ */}
      <Path
        d="M34 212 C28 224 28 246 34 262 C40 270 48 274 54 270 C58 256 58 236 54 220 C50 214 42 210 34 212 Z
           M166 212 C172 224 172 246 166 262 C160 270 152 274 146 270 C142 256 142 236 146 220 C150 214 158 210 166 212 Z"
        fill={f(M_FOREARM)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.8}
      />
      {/* Forearm shadow */}
      <Path d="M30 234 C30 250 32 264 38 270 M170 234 C170 250 168 264 162 270" stroke={COLOR_SHADOW} strokeWidth={1.6} fill="none" />

      {/* ============================================================ */}
      {/* Lower Back — erector spinae lumbar columns + sacral diamond   */}
      {/* ============================================================ */}
      <Path
        d="M82 220 C76 232 76 248 82 256 L118 256 C124 248 124 232 118 220 C112 226 100 230 100 230 C100 230 88 226 82 220 Z"
        fill={f(M_LOWER_BACK)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.8}
      />
      {/* Lower-back deep groove + sacral dimples */}
      <Path
        d="M100 228 L100 256
           M88 240 L92 254
           M112 240 L108 254"
        stroke={COLOR_SHADOW}
        strokeWidth={1.6}
        fill="none"
      />
      <Path
        d="M88 228 L88 250
           M100 230 L100 256
           M112 228 L112 250"
        stroke={COLOR_STRIATION}
        strokeWidth={0.9}
        fill="none"
      />

      {/* ============================================================ */}
      {/* Hip / pelvic outline                                          */}
      {/* ============================================================ */}
      <Path
        d="M38 256 C46 266 56 274 68 280 L132 280 C144 274 154 266 162 256 L100 256 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.9}
      />

      {/* ============================================================ */}
      {/* Upper Glute — gluteus medius hill (upper crescent)            */}
      {/* ============================================================ */}
      <Path
        d="M60 258 C50 266 44 278 44 290 C50 294 60 294 70 290 C80 286 92 278 100 268 C98 260 88 254 74 256 Z
           M140 258 C150 266 156 278 156 290 C150 294 140 294 130 290 C120 286 108 278 100 268 C102 260 112 254 126 256 Z"
        fill={f(M_UPPER_GLUTE)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.8}
      />
      {/* Upper glute shadow — hill underline */}
      <Path d="M52 280 C58 286 68 290 80 288 M148 280 C142 286 132 290 120 288" stroke={COLOR_SHADOW} strokeWidth={1.6} fill="none" />
      {/* Upper glute highlight */}
      <Path d="M62 268 L86 282 M138 268 L114 282" stroke={COLOR_HIGHLIGHT} strokeWidth={1.4} fill="none" />
      {/* Upper-glute striations (crescent fiber sweep) */}
      <Path
        d="M62 268 L82 286
           M138 268 L118 286"
        stroke={COLOR_STRIATION}
        strokeWidth={0.9}
        fill="none"
      />

      {/* ============================================================ */}
      {/* Lower Glute — gluteus maximus heart-cleft dome                */}
      {/* ============================================================ */}
      <Path
        d="M70 288 C58 296 50 318 50 340 C50 354 56 366 70 366 C86 366 96 358 100 340 C100 326 100 304 100 294 C94 288 82 286 70 288 Z
           M130 288 C142 296 150 318 150 340 C150 354 144 366 130 366 C114 366 104 358 100 340 C100 326 100 304 100 294 C106 288 118 286 130 288 Z"
        fill={f(M_LOWER_GLUTE)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.8}
      />
      {/* Lower glute shadow — under-glute fold */}
      <Path d="M58 348 C64 360 76 366 90 364 M142 348 C136 360 124 366 110 364" stroke={COLOR_SHADOW} strokeWidth={2.0} fill="none" />
      {/* Lower glute highlight */}
      <Path d="M76 306 L88 340 M124 306 L112 340" stroke={COLOR_HIGHLIGHT} strokeWidth={1.4} fill="none" />
      {/* Lower-glute heart cleft + striations */}
      <Path
        d="M100 294 L100 366
           M66 314 L84 346
           M134 314 L116 346"
        stroke={COLOR_STRIATION}
        strokeWidth={0.9}
        fill="none"
      />

      {/* ============================================================ */}
      {/* Hamstrings — biceps femoris (outer) + semi-tendinosus (inner) */}
      {/* ============================================================ */}
      <Path
        d="M58 368 C52 388 50 414 56 404 L56 404 C62 408 68 408 74 404 C80 380 86 360 88 340 C84 340 72 358 58 368 Z
           M88 340 C86 366 86 388 92 404 L98 404 C100 374 100 354 100 338 C96 338 92 338 88 340 Z
           M142 368 C148 388 150 414 144 404 L144 404 C138 408 132 408 126 404 C120 380 114 360 112 340 C116 340 128 358 142 368 Z
           M112 340 C114 366 114 388 108 404 L102 404 C100 374 100 354 100 338 C104 338 108 338 112 340 Z"
        fill={f(M_HAMSTRING)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.8}
      />
      {/* Hamstring inner shadow — under-glute hamstring tie-in */}
      <Path
        d="M62 376 C58 390 56 402 60 408 M138 376 C142 390 144 402 140 408"
        stroke={COLOR_SHADOW}
        strokeWidth={1.8}
        fill="none"
      />
      {/* Hamstring highlight */}
      <Path
        d="M76 354 L82 402 M124 354 L118 402"
        stroke={COLOR_HIGHLIGHT}
        strokeWidth={1.4}
        fill="none"
      />
      {/* Hamstring striations (longitudinal posterior-thigh fibers) */}
      <Path
        d="M66 358 L74 402
           M82 354 L88 402
           M100 340 L100 402
           M118 354 L112 402
           M134 358 L126 402"
        stroke={COLOR_STRIATION}
        strokeWidth={0.9}
        fill="none"
      />

      {/* Knee (popliteal) */}
      <Path
        d="M60 404 C64 410 72 416 82 416 L94 416 C98 410 98 406 94 404 Z
           M106 404 C106 406 106 410 110 416 L120 416 C128 416 136 410 140 404 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.9}
      />

      {/* ============================================================ */}
      {/* Calf — gastrocnemius prominent diamond (back view dominant)   */}
      {/* ============================================================ */}
      <Path
        d="M66 416 C58 432 58 462 64 484 C68 494 74 502 80 500 L86 500 C90 480 92 456 92 432 C92 422 86 418 80 416 Z
           M108 416 C108 418 108 422 108 432 C108 456 110 480 114 500 L120 500 C126 502 132 494 136 484 C142 462 142 432 134 416 Z"
        fill={f(M_CALF)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.8}
      />
      {/* Calf inner shadow */}
      <Path d="M62 432 C62 462 66 488 74 500 M138 432 C138 462 134 488 126 500" stroke={COLOR_SHADOW} strokeWidth={2.0} fill="none" />
      {/* Calf highlight (gastroc belly gleam — pumped on back view) */}
      <Path
        d="M76 426 L80 472 M124 426 L120 472"
        stroke={COLOR_HIGHLIGHT}
        strokeWidth={1.6}
        fill="none"
      />
      {/* Gastroc midline + soleus underline striations */}
      <Path
        d="M78 426 L84 496
           M86 432 L88 494
           M122 426 L116 496
           M114 432 L112 494
           M68 462 L92 458
           M132 462 L108 458"
        stroke={COLOR_STRIATION}
        strokeWidth={0.9}
        fill="none"
      />

      {/* Ankle / heel */}
      <Path
        d="M74 500 L92 500 L94 516 L72 516 Z M108 500 L126 500 L128 516 L106 516 Z"
        fill="#FAFAFA"
        stroke={COLOR_OUTLINE}
        strokeWidth={0.9}
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
