/**
 * Body Heatmap — front + back anatomical M-layer human silhouette,
 * each muscle filled by per-Session frequency quintile.
 *
 * Upgraded 2026-05-23 from MG (粗) layer → M (細) layer:
 *   - 18 distinct muscle bellies painted individually (上胸 / 中下胸 / 前束 /
 *     中束 / 後束 / 二頭內外 / 三頭 / 上下臀部 / 股四 / 膕繩 / 腹肌 / 側腹 /
 *     斜方 / 背部 / 下背 / 小腿 / 小臂).
 *   - Each muscle has a primary fill path + 2-4 decorative striation strokes
 *     suggesting fiber direction (ripped/muscular appearance).
 *   - Two-tone style: grey outline + flat fill colored by quintile.
 *
 * Reference style: anatomical illustration with visible muscle bellies (pec
 * V-notch, deltoid 3-head split, bicep twin bulge, quad 3-head split, etc).
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

const FRONT_LABELS: readonly MuscleLabel[] = [
  { m_id: M_FRONT_DELT, anchorX: 56, anchorY: 102, labelX: -6, labelY: 96 },
  { m_id: M_UPPER_CHEST, anchorX: 86, anchorY: 102, labelX: -6, labelY: 118 },
  { m_id: M_LOWER_CHEST, anchorX: 86, anchorY: 126, labelX: -6, labelY: 140 },
  { m_id: M_BICEP_LONG, anchorX: 44, anchorY: 144, labelX: -6, labelY: 162 },
  { m_id: M_BICEP_SHORT, anchorX: 56, anchorY: 152, labelX: -6, labelY: 184 },
  { m_id: M_ABS, anchorX: 100, anchorY: 170, labelX: -6, labelY: 206 },
  { m_id: M_OBLIQUE, anchorX: 74, anchorY: 180, labelX: -6, labelY: 228 },
  { m_id: M_FOREARM, anchorX: 50, anchorY: 196, labelX: -6, labelY: 250 },
  { m_id: M_QUAD, anchorX: 84, anchorY: 274, labelX: -6, labelY: 290 },
  { m_id: M_CALF, anchorX: 82, anchorY: 354, labelX: -6, labelY: 362 },
];

const BACK_LABELS: readonly MuscleLabel[] = [
  { m_id: M_TRAP, anchorX: 100, anchorY: 96, labelX: 206, labelY: 92 },
  { m_id: M_REAR_DELT, anchorX: 152, anchorY: 102, labelX: 206, labelY: 114 },
  { m_id: M_MID_DELT, anchorX: 158, anchorY: 116, labelX: 206, labelY: 136 },
  { m_id: M_BACK, anchorX: 100, anchorY: 132, labelX: 206, labelY: 158 },
  { m_id: M_TRICEP, anchorX: 156, anchorY: 148, labelX: 206, labelY: 180 },
  { m_id: M_LOWER_BACK, anchorX: 100, anchorY: 188, labelX: 206, labelY: 202 },
  { m_id: M_UPPER_GLUTE, anchorX: 100, anchorY: 218, labelX: 206, labelY: 224 },
  { m_id: M_LOWER_GLUTE, anchorX: 100, anchorY: 252, labelX: 206, labelY: 246 },
  { m_id: M_HAMSTRING, anchorX: 116, anchorY: 290, labelX: 206, labelY: 286 },
  { m_id: M_CALF, anchorX: 118, anchorY: 354, labelX: 206, labelY: 350 },
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
// Front view — 10 distinct M-paths + striations
// ---------------------------------------------------------------------------

function FrontBody({ mQuintile, mCount }: BodyHeatmapProps) {
  const f = (m: string) => fillForM(m, mQuintile);
  return (
    <Svg viewBox="-72 0 282 408" width={170} height={246}>
      {/* Head — oval cranium */}
      <Path
        d="M100 10 C82 10 70 24 70 42 C70 60 82 74 100 74 C118 74 130 60 130 42 C130 24 118 10 100 10 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={1}
      />
      {/* Hairline */}
      <Path d="M76 30 C86 22 114 22 124 30" stroke={COLOR_OUTLINE} strokeWidth={0.6} fill="none" />
      {/* Neck — sternocleidomastoid silhouette */}
      <Path
        d="M88 74 L112 74 L113 86 L100 90 L87 86 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={1}
      />

      {/* ------ Trapezius (front view — neck-to-shoulder yoke). Painted with TRAP fill
              so front + back stay in sync. ------- */}
      <Path
        d="M88 86 C76 92 64 92 60 94 L72 100 L100 96 L128 100 L140 94 C136 92 124 92 112 86 Z"
        fill={f(M_TRAP)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />

      {/* ------ Torso outline (background — fill stays light) ------- */}
      <Path
        d="M60 94 C56 102 50 116 50 132 C48 158 46 184 52 204 L100 212 L148 204 C154 184 152 158 150 132 C150 116 144 102 140 94 L100 96 Z"
        fill="#FAFAFA"
        stroke={COLOR_OUTLINE}
        strokeWidth={1}
      />

      {/* ------ Front Deltoid (left + right cap, anterior head) ------- */}
      <Path
        d="M60 94 C50 100 44 112 42 126 C42 134 46 140 54 140 C58 130 60 116 62 108 C62 100 62 96 60 94 Z
           M140 94 C150 100 156 112 158 126 C158 134 154 140 146 140 C142 130 140 116 138 108 C138 100 138 96 140 94 Z"
        fill={f(M_FRONT_DELT)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Front-delt striations (arc fibers from clavicle insertion outward) */}
      <Path
        d="M50 108 C54 116 56 128 56 134
           M156 134 C156 128 154 116 150 108"
        stroke={COLOR_STRIATION}
        strokeWidth={0.6}
        fill="none"
      />

      {/* ------ Mid Deltoid lateral cap edge (visible side strip from front view) ------- */}
      <Path
        d="M44 126 C40 134 40 144 44 152 C46 144 46 132 44 126 Z
           M156 126 C160 134 160 144 156 152 C154 144 154 132 156 126 Z"
        fill={f(M_MID_DELT)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />

      {/* ------ Upper Chest (pec major clavicular head, top arc near clavicle) ------- */}
      <Path
        d="M100 96 C92 98 84 104 76 110 C70 116 68 122 68 128 L100 122 Z
           M100 96 C108 98 116 104 124 110 C130 116 132 122 132 128 L100 122 Z"
        fill={f(M_UPPER_CHEST)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Upper-chest striations (clavicle insertion fibers, fanning down-and-out) */}
      <Path
        d="M82 102 L94 118
           M90 100 L98 120
           M118 100 L110 120
           M126 102 L114 118"
        stroke={COLOR_STRIATION}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ------ Lower Chest (pec major sternal head — lobed shape under upper chest with V-notch) ------- */}
      <Path
        d="M100 122 L68 128 C66 138 70 146 78 148 C86 146 94 142 100 134 Z
           M100 122 L132 128 C134 138 130 146 122 148 C114 146 106 142 100 134 Z"
        fill={f(M_LOWER_CHEST)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* V-notch + lower-chest striations (sternal fibers, horizontal sweep) */}
      <Path
        d="M100 122 L100 134
           M72 134 L96 138
           M80 142 L94 142
           M128 134 L104 138
           M120 142 L106 142"
        stroke={COLOR_STRIATION}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ------ Biceps brachii — TWIN BULGE per arm
              Long head (outer, lateral) + Short head (inner, medial). ------- */}
      {/* Bicep LONG (outer/lateral head) — left arm outer lobe + right arm outer lobe */}
      <Path
        d="M40 136 C36 144 36 156 38 168 C40 174 44 178 48 178 C50 168 52 158 52 148 C52 142 48 138 44 136 Z
           M160 136 C164 144 164 156 162 168 C160 174 156 178 152 178 C150 168 148 158 148 148 C148 142 152 138 156 136 Z"
        fill={f(M_BICEP_LONG)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Bicep SHORT (inner/medial head) — left arm inner lobe + right arm inner lobe */}
      <Path
        d="M52 142 C50 150 50 162 52 172 C56 176 60 176 62 172 C62 160 60 150 58 144 C56 140 54 140 52 142 Z
           M148 142 C150 150 150 162 148 172 C144 176 140 176 138 172 C138 160 140 150 142 144 C144 140 146 140 148 142 Z"
        fill={f(M_BICEP_SHORT)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Bicep striations (longitudinal muscle-belly fibers) */}
      <Path
        d="M42 144 L46 170
           M48 144 L50 170
           M56 148 L58 172
           M152 144 L148 170
           M158 144 L154 170
           M144 148 L142 172"
        stroke={COLOR_STRIATION}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ------ Abs (rectus abdominis — 6-pack columnar segmentation, central column) ------- */}
      <Path
        d="M86 138 C84 152 84 172 86 196 C90 200 96 200 100 198 C104 200 110 200 114 196 C116 172 116 152 114 138 C108 140 100 142 100 142 C100 142 92 140 86 138 Z"
        fill={f(M_ABS)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Abs 6-pack tendinous intersection cross-hatching (linea alba + 3 horizontal) */}
      <Path
        d="M100 142 L100 198
           M88 154 L112 154
           M88 168 L112 168
           M88 182 L112 182"
        stroke={COLOR_STRIATION}
        strokeWidth={0.6}
        fill="none"
      />

      {/* ------ Obliques (side abdominal wings, lateral panels flanking the abs) ------- */}
      <Path
        d="M70 144 C68 158 68 174 70 192 C74 198 80 200 84 198 C84 178 84 158 84 142 C78 142 72 142 70 144 Z
           M130 144 C132 158 132 174 130 192 C126 198 120 200 116 198 C116 178 116 158 116 142 C122 142 128 142 130 144 Z"
        fill={f(M_OBLIQUE)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Oblique serration striations (slanted lateral fibers) */}
      <Path
        d="M72 152 L82 160
           M72 168 L82 176
           M72 184 L82 192
           M128 152 L118 160
           M128 168 L118 176
           M128 184 L118 192"
        stroke={COLOR_STRIATION}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ------ Forearm (brachioradialis bulge near elbow, tapering to wrist) ------- */}
      <Path
        d="M44 180 C40 190 40 204 44 216 C48 222 54 224 58 222 C60 212 60 200 58 190 C56 184 52 180 48 180 Z
           M156 180 C160 190 160 204 156 216 C152 222 146 224 142 222 C140 212 140 200 142 190 C144 184 148 180 152 180 Z"
        fill={f(M_FOREARM)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Forearm striations */}
      <Path
        d="M46 190 L52 218
           M52 188 L56 218
           M154 190 L148 218
           M148 188 L144 218"
        stroke={COLOR_STRIATION}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ------ Hip / pelvis silhouette ------- */}
      <Path
        d="M52 204 C58 218 70 230 80 236 L120 236 C130 230 142 218 148 204 L100 214 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={1}
      />

      {/* ------ Quadriceps (3 visible heads): rectus femoris (center) + vastus lateralis (outer) + vastus medialis (inner).
              Single M_QUAD fill — heads drawn as separate sub-paths for shape detail. ------- */}
      <Path
        d="M68 238 C62 256 60 286 64 316 C68 320 72 320 76 318 C78 290 82 264 86 244 C80 240 72 238 68 238 Z
           M132 238 C138 256 140 286 136 316 C132 320 128 320 124 318 C122 290 118 264 114 244 C120 240 128 238 132 238 Z
           M86 244 C84 270 84 300 88 318 L98 318 C100 296 100 268 100 246 C96 242 90 240 86 244 Z
           M114 244 C116 270 116 300 112 318 L102 318 C100 296 100 268 100 246 C104 242 110 240 114 244 Z"
        fill={f(M_QUAD)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Quad-head separation lines + striations */}
      <Path
        d="M76 250 L84 318
           M86 254 L88 316
           M100 246 L100 316
           M112 254 L112 316
           M124 250 L116 318"
        stroke={COLOR_STRIATION}
        strokeWidth={0.6}
        fill="none"
      />

      {/* ------ Knee ------- */}
      <Path
        d="M70 320 C72 324 76 328 82 328 L92 328 C94 324 94 322 92 320 Z
           M108 320 C108 322 108 324 110 328 L120 328 C124 328 128 324 130 320 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={1}
      />

      {/* ------ Calf (gastrocnemius two-headed diamond on front view, tapers to ankle) ------- */}
      <Path
        d="M74 328 C70 342 70 360 74 374 C76 382 80 388 84 390 L88 390 C90 378 92 360 92 346 C92 338 90 332 86 328 Z
           M108 328 C104 332 104 338 104 346 C104 360 106 378 108 390 L114 390 C118 388 122 382 124 374 C128 360 128 342 126 328 Z"
        fill={f(M_CALF)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Calf diamond mid-line striation */}
      <Path
        d="M82 336 L84 386
           M118 336 L116 386"
        stroke={COLOR_STRIATION}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ------ Ankle / foot ------- */}
      <Path
        d="M76 390 L92 390 L94 400 L74 400 Z M108 390 L124 390 L126 400 L106 400 Z"
        fill="#FAFAFA"
        stroke={COLOR_OUTLINE}
        strokeWidth={1}
      />

      <MuscleLabels labels={FRONT_LABELS} mCount={mCount} textAnchor="end" />
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// Back view — 10 distinct M-paths + striations
// ---------------------------------------------------------------------------

function BackBody({ mQuintile, mCount }: BodyHeatmapProps) {
  const f = (m: string) => fillForM(m, mQuintile);
  return (
    <Svg viewBox="0 0 282 408" width={170} height={246}>
      {/* Head — occipital cranium */}
      <Path
        d="M100 10 C82 10 70 24 70 42 C70 60 82 74 100 74 C118 74 130 60 130 42 C130 24 118 10 100 10 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={1}
      />
      {/* Hairline (back) */}
      <Path d="M76 56 C86 64 114 64 124 56" stroke={COLOR_OUTLINE} strokeWidth={0.6} fill="none" />
      {/* Neck nape */}
      <Path
        d="M88 74 L112 74 L113 86 L100 90 L87 86 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={1}
      />

      {/* ------ Torso outline ------- */}
      <Path
        d="M60 94 C56 102 50 116 50 132 C48 158 46 184 52 204 L100 212 L148 204 C154 184 152 158 150 132 C150 116 144 102 140 94 L100 96 Z"
        fill="#FAFAFA"
        stroke={COLOR_OUTLINE}
        strokeWidth={1}
      />

      {/* ------ Trapezius — upper trap kite + middle trap diamond down between scapulae ------- */}
      <Path
        d="M100 86 C90 88 80 92 72 100 C70 104 74 108 78 110 C88 108 94 106 100 104 C106 106 112 108 122 110 C126 108 130 104 128 100 C120 92 110 88 100 86 Z
           M100 104 C92 110 86 118 84 130 C90 134 96 138 100 144 C104 138 110 134 116 130 C114 118 108 110 100 104 Z"
        fill={f(M_TRAP)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Trap fiber striations (radiating from spine/neck) */}
      <Path
        d="M84 100 L100 108
           M116 100 L100 108
           M90 122 L100 134
           M110 122 L100 134"
        stroke={COLOR_STRIATION}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ------ Rear Deltoid (posterior head) ------- */}
      <Path
        d="M60 94 C50 100 44 112 42 124 C42 132 46 136 52 136 C56 126 60 116 62 108 C62 100 62 96 60 94 Z
           M140 94 C150 100 156 112 158 124 C158 132 154 136 148 136 C144 126 140 116 138 108 C138 100 138 96 140 94 Z"
        fill={f(M_REAR_DELT)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Rear delt striations (rear fibers converging at olecranon) */}
      <Path
        d="M48 108 C52 116 54 124 56 132
           M152 108 C148 116 146 124 144 132"
        stroke={COLOR_STRIATION}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ------ Mid Deltoid (lateral cap visible from back at upper outer edge) ------- */}
      <Path
        d="M44 124 C40 134 42 146 48 152 C50 144 50 132 46 124 Z
           M156 124 C160 134 158 146 152 152 C150 144 150 132 154 124 Z"
        fill={f(M_MID_DELT)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />

      {/* ------ Latissimus dorsi + central back: M_BACK fill ------- */}
      {/* Lat wings sweep from armpit down to lumbar; plus erector spinae columns flanking spine */}
      <Path
        d="M62 110 C56 132 60 156 70 178 C78 184 88 186 96 184 C92 156 86 132 80 116 C76 110 70 108 62 110 Z
           M138 110 C144 132 140 156 130 178 C122 184 112 186 104 184 C108 156 114 132 120 116 C124 110 130 108 138 110 Z
           M94 142 C92 158 92 174 94 188 L98 188 L98 142 Z
           M106 142 C108 158 108 174 106 188 L102 188 L102 142 Z"
        fill={f(M_BACK)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Lat V striations (diagonal fibers sweeping down-and-inward) */}
      <Path
        d="M68 124 L88 178
           M76 120 L92 176
           M132 124 L112 178
           M124 120 L108 176"
        stroke={COLOR_STRIATION}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ------ Triceps brachii — horseshoe: long head (medial) + lateral head (outer) ------- */}
      <Path
        d="M40 124 C36 134 36 148 38 162 C40 170 44 174 48 174 C50 164 52 152 52 142 C52 132 48 126 44 124 Z
           M50 132 C48 144 48 158 50 170 C54 174 58 174 60 170 C60 158 58 144 56 134 C54 130 52 130 50 132 Z
           M160 124 C164 134 164 148 162 162 C160 170 156 174 152 174 C150 164 148 152 148 142 C148 132 152 126 156 124 Z
           M150 132 C152 144 152 158 150 170 C146 174 142 174 140 170 C140 158 142 144 144 134 C146 130 148 130 150 132 Z"
        fill={f(M_TRICEP)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Tricep horseshoe striations (longitudinal + medial dip) */}
      <Path
        d="M42 134 L50 172
           M48 132 L54 172
           M58 138 L58 170
           M158 134 L150 172
           M152 132 L146 172
           M142 138 L142 170"
        stroke={COLOR_STRIATION}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ------ Forearm (back / extensor compartment) ------- */}
      <Path
        d="M44 180 C40 190 40 204 44 216 C48 222 54 224 58 222 C60 212 60 200 58 190 C56 184 52 180 48 180 Z
           M156 180 C160 190 160 204 156 216 C152 222 146 224 142 222 C140 212 140 200 142 190 C144 184 148 180 152 180 Z"
        fill={f(M_FOREARM)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />

      {/* ------ Lower Back (erector spinae lumbar columns + thoracolumbar fascia diamond) ------- */}
      <Path
        d="M88 188 C84 196 84 206 88 214 L112 214 C116 206 116 196 112 188 C108 192 100 194 100 194 C100 194 92 192 88 188 Z"
        fill={f(M_LOWER_BACK)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Lower-back fascia diamond striations */}
      <Path
        d="M92 192 L92 210
           M100 194 L100 214
           M108 192 L108 210"
        stroke={COLOR_STRIATION}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ------ Hip / pelvic outline ------- */}
      <Path
        d="M52 214 C58 222 64 228 72 232 L128 232 C136 228 142 222 148 214 L100 214 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={1}
      />

      {/* ------ Upper Glute (gluteus medius/upper-max crescent, upper hip curve) ------- */}
      <Path
        d="M70 216 C64 220 60 228 60 236 C64 238 70 238 76 236 C82 232 90 226 96 220 C94 216 86 214 76 216 Z
           M130 216 C136 220 140 228 140 236 C136 238 130 238 124 236 C118 232 110 226 104 220 C106 216 114 214 124 216 Z"
        fill={f(M_UPPER_GLUTE)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Upper-glute striations (crescent fiber sweep) */}
      <Path
        d="M68 222 L82 232
           M132 222 L118 232"
        stroke={COLOR_STRIATION}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ------ Lower Glute (gluteus maximus lower dome — two rounded buttocks meeting at cleft) ------- */}
      <Path
        d="M76 236 C68 240 62 254 62 268 C62 278 66 286 76 286 C86 286 94 280 100 268 C100 260 100 246 100 240 C96 236 86 236 76 236 Z
           M124 236 C132 240 138 254 138 268 C138 278 134 286 124 286 C114 286 106 280 100 268 C100 260 100 246 100 240 C104 236 114 236 124 236 Z"
        fill={f(M_LOWER_GLUTE)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Lower-glute heart cleft + striations */}
      <Path
        d="M100 240 L100 286
           M72 250 L86 274
           M128 250 L114 274"
        stroke={COLOR_STRIATION}
        strokeWidth={0.6}
        fill="none"
      />

      {/* ------ Hamstrings (biceps femoris outer + semitendinosus/semimembranosus inner per leg) ------- */}
      <Path
        d="M68 288 C64 304 62 326 66 318 L66 318 C70 320 74 320 78 318 C82 300 86 286 88 270 C84 270 76 282 68 288 Z
           M88 270 C86 290 86 308 90 318 L98 318 C100 296 100 280 100 268 C96 268 92 268 88 270 Z
           M132 288 C136 304 138 326 134 318 L134 318 C130 320 126 320 122 318 C118 300 114 286 112 270 C116 270 124 282 132 288 Z
           M112 270 C114 290 114 308 110 318 L102 318 C100 296 100 280 100 268 C104 268 108 268 112 270 Z"
        fill={f(M_HAMSTRING)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Hamstring striations (longitudinal posterior-thigh fibers) */}
      <Path
        d="M74 280 L80 318
           M86 276 L92 318
           M100 272 L100 318
           M114 276 L108 318
           M126 280 L120 318"
        stroke={COLOR_STRIATION}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ------ Knee (popliteal) ------- */}
      <Path
        d="M70 320 C72 324 76 328 82 328 L92 328 C94 324 94 322 92 320 Z
           M108 320 C108 322 108 324 110 328 L120 328 C124 328 128 324 130 320 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={1}
      />

      {/* ------ Calf (gastrocnemius two-headed diamond — prominent on back view) ------- */}
      <Path
        d="M74 328 C68 342 68 360 74 374 C78 382 82 386 86 388 L90 388 C92 374 94 356 94 342 C94 334 90 330 86 328 Z
           M108 328 C106 330 106 334 106 342 C106 356 108 374 110 388 L114 388 C118 386 122 382 126 374 C132 360 132 342 126 328 Z"
        fill={f(M_CALF)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Gastroc midline + soleus underline */}
      <Path
        d="M84 340 L88 384
           M116 340 L112 384
           M76 364 L92 360
           M124 364 L108 360"
        stroke={COLOR_STRIATION}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ------ Ankle / heel ------- */}
      <Path
        d="M76 388 L92 388 L94 400 L74 400 Z M108 388 L124 388 L126 400 L106 400 Z"
        fill="#FAFAFA"
        stroke={COLOR_OUTLINE}
        strokeWidth={1}
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
