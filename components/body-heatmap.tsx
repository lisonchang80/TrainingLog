/**
 * Body Heatmap — anatomically-precise front + back human silhouette,
 * each muscle filled by per-Session frequency quintile.
 *
 * Round 3 redraw (medical-anatomy precision variant): drawn FROM SCRATCH
 * to match a reference fitness-app body chart. Built in 5 layers from
 * back to front so each layer occludes the previous naturally:
 *   1. Silhouette outline (V-taper torso + athletic-tapered legs)
 *   2. Deep muscles (trap back diamond, lats V, erector spinae)
 *   3. Mid muscles (pec layers, abs 6-pack, oblique serrations,
 *      glute upper+lower fold, quad 3-heads, hamstring 2-heads)
 *   4. Top muscles (deltoid 3 heads, bicep twin lobes, tricep horseshoe,
 *      forearm taper, gastroc inner/outer with achilles)
 *   5. Skin features (SCM neck ropes, nose ridge, hair crew cut,
 *      5-finger hands, feet)
 *
 * Fiber direction in striations follows real anatomy:
 *   - Pec clavicular: fans DOWN from collarbone
 *   - Pec sternal: horizontal sweep from sternum out
 *   - Bicep / tricep / quad rectus / forearm / calf: vertical
 *   - Lat: diagonal from spine UP+OUT to humeral insertion
 *   - Oblique: external fibers run DOWN+FORWARD (hands in pockets)
 *   - Trap (back): diagonal from spine outward to acromion
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
const COLOR_SHADOW = 'rgba(20,20,30,0.15)';
const COLOR_HIGHLIGHT = 'rgba(255,255,255,0.18)';
const COLOR_TORSO_BG = '#FAFAFA';
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

// Anchors point at muscle bellies; labels land outside the body silhouette
// (labelX = -16 for front view (right-anchored) or +220 for back view).
const FRONT_LABELS: readonly MuscleLabel[] = [
  { m_id: M_FRONT_DELT, anchorX: 58, anchorY: 110, labelX: -16, labelY: 96 },
  { m_id: M_UPPER_CHEST, anchorX: 82, anchorY: 112, labelX: -16, labelY: 116 },
  { m_id: M_LOWER_CHEST, anchorX: 84, anchorY: 142, labelX: -16, labelY: 140 },
  { m_id: M_BICEP_LONG, anchorX: 42, anchorY: 160, labelX: -16, labelY: 160 },
  { m_id: M_BICEP_SHORT, anchorX: 54, anchorY: 162, labelX: -16, labelY: 184 },
  { m_id: M_ABS, anchorX: 100, anchorY: 188, labelX: -16, labelY: 206 },
  { m_id: M_OBLIQUE, anchorX: 76, anchorY: 192, labelX: -16, labelY: 228 },
  { m_id: M_FOREARM, anchorX: 40, anchorY: 210, labelX: -16, labelY: 250 },
  { m_id: M_QUAD, anchorX: 84, anchorY: 310, labelX: -16, labelY: 300 },
  { m_id: M_CALF, anchorX: 80, anchorY: 420, labelX: -16, labelY: 420 },
];

const BACK_LABELS: readonly MuscleLabel[] = [
  { m_id: M_TRAP, anchorX: 100, anchorY: 116, labelX: 220, labelY: 96 },
  { m_id: M_REAR_DELT, anchorX: 142, anchorY: 112, labelX: 220, labelY: 120 },
  { m_id: M_MID_DELT, anchorX: 156, anchorY: 134, labelX: 220, labelY: 144 },
  { m_id: M_TRICEP, anchorX: 152, anchorY: 160, labelX: 220, labelY: 168 },
  { m_id: M_BACK, anchorX: 120, anchorY: 168, labelX: 220, labelY: 192 },
  { m_id: M_LOWER_BACK, anchorX: 100, anchorY: 232, labelX: 220, labelY: 216 },
  { m_id: M_UPPER_GLUTE, anchorX: 84, anchorY: 264, labelX: 220, labelY: 248 },
  { m_id: M_LOWER_GLUTE, anchorX: 84, anchorY: 296, labelX: 220, labelY: 280 },
  { m_id: M_HAMSTRING, anchorX: 116, anchorY: 340, labelX: 220, labelY: 320 },
  { m_id: M_CALF, anchorX: 118, anchorY: 420, labelX: 220, labelY: 410 },
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
// Shared body geometry constants (centerline x=100; viewBox y 0..520)
// ---------------------------------------------------------------------------

// Silhouette outline path — V-taper torso + athletic legs.
//   shoulder span 108 (x=46 → x=154) — NOT 120 like variant B
//   waist 78 (x=61 → x=139)
//   hip 92 (x=54 → x=146)
//   thigh per-side 55, knee 38, calf 38, ankle 22
const SILHOUETTE_FRONT = [
  // start: top-of-head (x=100, y=12), trace clockwise from left side of head
  'M100 12',
  'C82 12 70 22 70 38',
  'C70 54 76 66 88 70', // left side of skull to jaw
  'L86 78', // left jaw-to-neck
  'L84 90', // neck side
  'C72 92 60 94 46 96', // left clavicle ramp to shoulder peak (x=46)
  'C42 104 38 118 36 138', // outer deltoid to upper arm outer (x=36)
  'C34 156 36 172 38 184', // bicep outer bulge
  'C40 202 40 218 38 232', // forearm outer
  'C36 244 32 252 36 256', // wrist outer
  'L52 258', // hand bottom outside
  'L60 234', // back up forearm inside
  'L56 196', // inside upper arm
  'L60 150', // inner bicep
  'L66 116', // inner deltoid into pec
  'L72 100', // shoulder back to base of neck
  'L78 96',
  // descend left torso (shoulder 108 → waist 78 → hip 92):
  'C72 110 66 132 64 152',
  'C62 170 61 184 61 192', // waist tight (x=61)
  'C58 208 54 224 54 238', // hip flare (x=54)
  // left thigh outer
  'L62 264',
  'C58 296 56 332 60 372', // outer thigh down to knee
  'L78 382', // knee outer
  // left calf outer
  'C76 396 74 420 76 450',
  'L80 488', // ankle outer
  'L88 510', // foot left
  'L112 510', // foot bottom (both feet meet at midline-ish)
  'L104 488', // ankle inner
  'C102 458 100 430 96 408', // inner calf
  'L92 382', // inner knee
  'C90 350 92 320 94 296',
  'L98 268', // crotch inner
  // crotch at (100, 270) — minimal V
  'L100 270',
  // right side mirror
  'L102 268',
  'C104 296 106 320 108 296', // (mirror of left's inner thigh)
  'L108 382',
  'C100 430 102 458 104 488',
  'L112 510', // (already there)
  'L136 510',
  'L120 488',
  'C124 420 124 396 124 382',
  'L138 372',
  'C144 332 142 296 138 264',
  'L146 238',
  'C146 224 142 208 139 192',
  'C139 184 138 170 136 152',
  'C134 132 128 110 122 100',
  'L128 96',
  'L134 100',
  'L140 116',
  'L144 150',
  'L148 196',
  'L144 234',
  'L152 258',
  'L168 256',
  'C172 252 168 244 166 232',
  'C164 218 164 202 166 184',
  'C168 172 170 156 168 138',
  'C166 118 162 104 158 96',
  'C144 94 132 92 120 90',
  'L116 78',
  'L114 70',
  'C124 66 130 54 130 38',
  'C130 22 118 12 100 12',
  'Z',
].join(' ');

// ---------------------------------------------------------------------------
// Front view
// ---------------------------------------------------------------------------

function FrontBody({ mQuintile, mCount }: BodyHeatmapProps) {
  const f = (m: string) => fillForM(m, mQuintile);
  return (
    <Svg viewBox="-72 0 292 530" width={170} height={306}>
      {/* ---------------- LAYER 1: silhouette outline (filled with skin so muscle
                paths layer on top cleanly) ---------------- */}
      <Path d={SILHOUETTE_FRONT} fill={COLOR_TORSO_BG} stroke={COLOR_OUTLINE} strokeWidth={1} />

      {/* ---------------- LAYER 2: hair crew cut (slight bangs forehead) ---------- */}
      <Path
        d="M70 36 C70 22 82 12 100 12 C118 12 130 22 130 38 C128 30 124 26 120 26 C118 30 112 32 100 32 C88 32 82 30 80 26 C76 26 72 30 70 36 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* hairline brow */}
      <Path d="M78 34 C86 32 114 32 122 34" stroke={COLOR_OUTLINE} strokeWidth={0.4} fill="none" />

      {/* ---------------- LAYER 2 (back-most muscles): TRAP front yoke ----------- */}
      {/* Trapezius — neck-to-shoulder triangular wedge */}
      <Path
        d="M88 78 C82 86 76 92 70 96 C66 99 54 100 50 102 L58 108 C66 104 76 100 88 96 C94 92 100 90 100 90 C100 90 106 92 112 96 C124 100 134 104 142 108 L150 102 C146 100 134 99 130 96 C124 92 118 86 112 78 L100 88 Z"
        fill={f(M_TRAP)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />

      {/* ---------------- LAYER 3 (mid): TORSO BACKDROP for chest + abs --------- */}
      {/* The silhouette path is already drawn beneath — no need for a separate
                background; just paint muscles directly on top. */}

      {/* ---------------- UPPER CHEST (pec clavicular head) ---------------------- */}
      {/* Strictly INSIDE silhouette: pec stays within x=64 to x=136. */}
      <Path
        d="M100 100 C92 102 84 106 76 110 C72 113 68 118 66 122 C68 124 76 124 88 122 C94 121 98 120 100 118 Z
           M100 100 C108 102 116 106 124 110 C128 113 132 118 134 122 C132 124 124 124 112 122 C106 121 102 120 100 118 Z"
        fill={f(M_UPPER_CHEST)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Upper-chest 3D depth: shadow along lower edge, highlight along upper-clavicle edge */}
      <Path
        d="M68 121 C76 123 86 122 96 119
           M132 121 C124 123 114 122 104 119"
        stroke={COLOR_SHADOW}
        strokeWidth={1.0}
        fill="none"
      />
      <Path
        d="M84 105 C90 104 96 103 100 102
           M116 105 C110 104 104 103 100 102"
        stroke={COLOR_HIGHLIGHT}
        strokeWidth={0.8}
        fill="none"
      />
      {/* Clavicular fibers: fan DOWNWARD from collarbone */}
      <Path
        d="M82 104 L94 118
           M88 102 L96 120
           M94 101 L98 120
           M118 104 L106 118
           M112 102 L104 120
           M106 101 L102 120"
        stroke={COLOR_STRIATION}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ---------------- LOWER CHEST (pec sternal head) ------------------------ */}
      {/* Lobed C-shape with deep V-notch at sternum (centerline x=100) */}
      <Path
        d="M100 118 C92 122 82 130 72 138 C68 144 68 150 72 154 C80 156 88 154 96 148 C99 145 100 142 100 138 Z
           M100 118 C108 122 118 130 128 138 C132 144 132 150 128 154 C120 156 112 154 104 148 C101 145 100 142 100 138 Z"
        fill={f(M_LOWER_CHEST)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Lower chest 3D depth: shadow on lower-outer rim, highlight along sternum */}
      <Path
        d="M74 152 C82 154 90 152 96 146
           M126 152 C118 154 110 152 104 146"
        stroke={COLOR_SHADOW}
        strokeWidth={1.0}
        fill="none"
      />
      <Path
        d="M100 122 L100 140"
        stroke={COLOR_HIGHLIGHT}
        strokeWidth={0.8}
        fill="none"
      />
      {/* Sternal fibers: HORIZONTAL sweep from sternum outward to armpit */}
      <Path
        d="M100 124 L78 138
           M100 130 L75 144
           M100 136 L78 152
           M100 141 L84 152
           M100 124 L122 138
           M100 130 L125 144
           M100 136 L122 152
           M100 141 L116 152"
        stroke={COLOR_STRIATION}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ---------------- ABS (rectus abdominis 6-pack) ------------------------- */}
      {/* Linea alba at x=100 divides into L+R columns. 3 horizontal segments per side. */}
      <Path
        d="M74 152
           C72 168 71 188 72 210
           C74 220 84 226 99 226
           L99 152 Z
           M126 152
           C128 168 129 188 128 210
           C126 220 116 226 101 226
           L101 152 Z"
        fill={f(M_ABS)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Linea alba center groove + 3 horizontal tendinous intersections per side */}
      <Path
        d="M100 152 L100 226
           M76 170 L99 170
           M101 170 L124 170
           M75 188 L99 188
           M101 188 L125 188
           M74 208 L99 208
           M101 208 L126 208"
        stroke={COLOR_SHADOW}
        strokeWidth={0.7}
        fill="none"
      />
      {/* Subtle highlight rim along linea alba on each ab block */}
      <Path
        d="M82 158 L82 168
           M118 158 L118 168
           M82 176 L82 186
           M118 176 L118 186
           M82 194 L82 206
           M118 194 L118 206"
        stroke={COLOR_HIGHLIGHT}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ---------------- OBLIQUE (external oblique + serratus serration) ------- */}
      {/* External oblique fibers run DOWN+FORWARD ("hands in pockets" direction). */}
      <Path
        d="M64 150 C62 168 62 186 65 205 C68 215 75 222 84 224 C85 210 84 192 80 178 C76 162 72 154 70 150 Z
           M136 150 C138 168 138 186 135 205 C132 215 125 222 116 224 C115 210 116 192 120 178 C124 162 128 154 130 150 Z"
        fill={f(M_OBLIQUE)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Oblique 3D shadow on lateral edge */}
      <Path
        d="M64 162 C62 180 63 200 66 216
           M136 162 C138 180 137 200 134 216"
        stroke={COLOR_SHADOW}
        strokeWidth={1.0}
        fill="none"
      />
      {/* Serratus anterior serrations — finger-like extensions under pec into upper oblique */}
      <Path
        d="M72 152 L78 158
           M70 158 L77 164
           M70 165 L77 170
           M128 152 L122 158
           M130 158 L123 164
           M130 165 L123 170"
        stroke={COLOR_STRIATION}
        strokeWidth={0.5}
        fill="none"
      />
      {/* External oblique fibers: down + forward */}
      <Path
        d="M66 165 L82 195
           M65 178 L80 208
           M67 190 L82 218
           M134 165 L118 195
           M135 178 L120 208
           M133 190 L118 218"
        stroke={COLOR_STRIATION}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ---------------- LAYER 4 (top): SCM neck ropes ------------------------- */}
      {/* Two diagonal ropes from clavicle to mastoid */}
      <Path
        d="M93 70 L88 88
           M107 70 L112 88"
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ---------------- FRONT DELT (anterior deltoid cap) --------------------- */}
      {/* Curved triangle covering front of shoulder, fanning inward toward pec. */}
      <Path
        d="M46 96 C44 102 42 110 42 120 C42 130 46 138 52 142 C56 138 60 130 62 120 C64 110 66 100 66 96 C58 96 50 96 46 96 Z
           M154 96 C156 102 158 110 158 120 C158 130 154 138 148 142 C144 138 140 130 138 120 C136 110 134 100 134 96 C142 96 150 96 154 96 Z"
        fill={f(M_FRONT_DELT)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Front delt 3D depth */}
      <Path
        d="M50 102 C46 112 44 124 46 138"
        stroke={COLOR_SHADOW}
        strokeWidth={1.0}
        fill="none"
      />
      <Path
        d="M150 102 C154 112 156 124 154 138"
        stroke={COLOR_SHADOW}
        strokeWidth={1.0}
        fill="none"
      />
      <Path
        d="M58 100 C58 110 60 120 60 130
           M142 100 C142 110 140 120 140 130"
        stroke={COLOR_HIGHLIGHT}
        strokeWidth={0.7}
        fill="none"
      />
      {/* Front delt arc striations — fan from acromion */}
      <Path
        d="M48 108 C52 116 56 128 58 138
           M52 102 C56 112 60 124 60 134
           M152 108 C148 116 144 128 142 138
           M148 102 C144 112 140 124 140 134"
        stroke={COLOR_STRIATION}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ---------------- MID DELT (lateral deltoid, visible side strip) -------- */}
      {/* Thin strip on outside of shoulder/upper arm. */}
      <Path
        d="M42 120 C38 128 36 138 38 148 C42 156 46 158 50 156 C50 144 50 132 50 122 C48 120 44 120 42 120 Z
           M158 120 C162 128 164 138 162 148 C158 156 154 158 150 156 C150 144 150 132 150 122 C152 120 156 120 158 120 Z"
        fill={f(M_MID_DELT)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      <Path
        d="M44 130 C42 140 42 150 44 156
           M156 130 C158 140 158 150 156 156"
        stroke={COLOR_HIGHLIGHT}
        strokeWidth={0.6}
        fill="none"
      />

      {/* ---------------- BICEP — twin lobes per arm ---------------------------- */}
      {/* Long head (outer/lateral) */}
      <Path
        d="M38 144 C34 156 32 172 34 184 C38 190 44 192 48 188 C49 176 50 162 50 150 C48 144 42 142 38 144 Z
           M162 144 C166 156 168 172 166 184 C162 190 156 192 152 188 C151 176 150 162 150 150 C152 144 158 142 162 144 Z"
        fill={f(M_BICEP_LONG)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Bicep long shadow on medial side (where it meets short head) */}
      <Path
        d="M48 150 C49 164 49 178 47 186"
        stroke={COLOR_SHADOW}
        strokeWidth={1.0}
        fill="none"
      />
      <Path
        d="M152 150 C151 164 151 178 153 186"
        stroke={COLOR_SHADOW}
        strokeWidth={1.0}
        fill="none"
      />
      {/* Bicep long highlight on lateral (outward-facing) edge */}
      <Path
        d="M38 152 C36 166 36 178 38 186
           M162 152 C164 166 164 178 162 186"
        stroke={COLOR_HIGHLIGHT}
        strokeWidth={0.7}
        fill="none"
      />
      {/* Long-head vertical fibers */}
      <Path
        d="M40 152 L42 184
           M44 150 L45 184
           M156 150 L155 184
           M160 152 L158 184"
        stroke={COLOR_STRIATION}
        strokeWidth={0.5}
        fill="none"
      />
      {/* Short head (inner/medial) */}
      <Path
        d="M50 150 C50 162 50 174 52 180 C56 184 60 184 60 180 C60 170 58 160 56 152 C54 150 52 150 50 150 Z
           M150 150 C150 162 150 174 148 180 C144 184 140 184 140 180 C140 170 142 160 144 152 C146 150 148 150 150 150 Z"
        fill={f(M_BICEP_SHORT)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      <Path
        d="M52 156 L54 178
           M58 156 L58 178
           M148 156 L146 178
           M142 156 L142 178"
        stroke={COLOR_STRIATION}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ---------------- FOREARM (brachioradialis bulge → wrist taper) --------- */}
      <Path
        d="M40 192 C36 204 36 218 38 230 C40 240 42 244 46 244 C50 232 52 218 52 204 C52 196 48 192 44 192 Z
           M160 192 C164 204 164 218 162 230 C160 240 158 244 154 244 C150 232 148 218 148 204 C148 196 152 192 156 192 Z"
        fill={f(M_FOREARM)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Forearm shadow + highlight */}
      <Path
        d="M48 200 C50 214 50 228 48 240"
        stroke={COLOR_SHADOW}
        strokeWidth={0.8}
        fill="none"
      />
      <Path
        d="M152 200 C150 214 150 228 152 240"
        stroke={COLOR_SHADOW}
        strokeWidth={0.8}
        fill="none"
      />
      {/* Forearm vertical fibers */}
      <Path
        d="M40 200 L44 240
           M44 198 L46 240
           M160 200 L156 240
           M156 198 L154 240"
        stroke={COLOR_STRIATION}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ---------------- HANDS — 5 fingers per side ---------------------------- */}
      {/* Left hand: palm + 4 finger creases + thumb */}
      <Path
        d="M36 246 L52 248 L54 268 L36 270 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.8}
      />
      {/* Finger separators on left palm */}
      <Path
        d="M40 250 L40 268
           M44 250 L44 268
           M48 250 L48 268
           M52 252 L54 266"
        stroke={COLOR_OUTLINE}
        strokeWidth={0.4}
        fill="none"
      />
      {/* Thumb */}
      <Path
        d="M52 246 C54 244 56 244 56 248 L54 254"
        stroke={COLOR_OUTLINE}
        strokeWidth={0.6}
        fill={COLOR_SKIN}
      />
      {/* Right hand */}
      <Path
        d="M164 246 L148 248 L146 268 L164 270 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.8}
      />
      <Path
        d="M160 250 L160 268
           M156 250 L156 268
           M152 250 L152 268
           M148 252 L146 266"
        stroke={COLOR_OUTLINE}
        strokeWidth={0.4}
        fill="none"
      />
      <Path
        d="M148 246 C146 244 144 244 144 248 L146 254"
        stroke={COLOR_OUTLINE}
        strokeWidth={0.6}
        fill={COLOR_SKIN}
      />

      {/* ---------------- QUAD — 3 heads per leg ------------------------------- */}
      {/* Rectus femoris (center, vertical), Vastus lateralis (outer, diagonal),
                Vastus medialis (inner teardrop near knee). */}
      {/* Left leg: x≈84 centerline */}
      <Path
        d="M68 264 C64 280 62 320 64 360 C66 372 72 376 78 374 C80 350 82 320 82 286 C80 274 74 266 68 264 Z
           M82 270 C82 296 82 326 82 370 L92 370 C92 326 92 296 92 270 C90 268 84 268 82 270 Z
           M92 320 C94 340 94 360 94 374 C90 376 86 374 84 370 C84 354 84 340 86 320 C88 318 90 318 92 320 Z
           M132 264 C136 280 138 320 136 360 C134 372 128 376 122 374 C120 350 118 320 118 286 C120 274 126 266 132 264 Z
           M118 270 C118 296 118 326 118 370 L108 370 C108 326 108 296 108 270 C110 268 116 268 118 270 Z
           M108 320 C106 340 106 360 106 374 C110 376 114 374 116 370 C116 354 116 340 114 320 C112 318 110 318 108 320 Z"
        fill={f(M_QUAD)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Quad 3D depth: vastus lateralis outer rim shadow, rectus femoris center highlight */}
      <Path
        d="M66 280 C64 320 64 356 70 370
           M134 280 C136 320 136 356 130 370"
        stroke={COLOR_SHADOW}
        strokeWidth={1.0}
        fill="none"
      />
      <Path
        d="M86 280 L86 360
           M114 280 L114 360"
        stroke={COLOR_HIGHLIGHT}
        strokeWidth={0.6}
        fill="none"
      />
      {/* Quad striations — rectus vertical, lateralis slight diagonal outward, medialis diagonal inward */}
      <Path
        d="M70 280 L74 360
           M78 280 L80 360
           M86 270 L86 360
           M92 270 L92 360
           M130 280 L126 360
           M122 280 L120 360
           M114 270 L114 360
           M108 270 L108 360
           M84 340 L96 372
           M116 340 L104 372"
        stroke={COLOR_STRIATION}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ---------------- CALF — gastrocnemius diamond + achilles --------------- */}
      {/* Inner head (medial, larger) + outer head (lateral, smaller). */}
      <Path
        d="M72 384 C68 400 68 430 72 460 C74 470 80 476 84 478 L86 478 C88 462 90 442 90 422 C90 408 88 394 86 384 Z
           M86 384 C88 396 90 410 90 426 C90 446 88 462 86 478 L96 478 C96 462 94 442 94 422 C94 406 92 392 90 384 Z
           M128 384 C132 400 132 430 128 460 C126 470 120 476 116 478 L114 478 C112 462 110 442 110 422 C110 408 112 394 114 384 Z
           M114 384 C112 396 110 410 110 426 C110 446 112 462 114 478 L104 478 C104 462 106 442 106 422 C106 406 108 392 110 384 Z"
        fill={f(M_CALF)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Calf 3D depth + central tendon */}
      <Path
        d="M76 400 C74 430 74 458 80 472
           M124 400 C126 430 126 458 120 472"
        stroke={COLOR_SHADOW}
        strokeWidth={0.9}
        fill="none"
      />
      <Path
        d="M84 392 L86 470
           M116 392 L114 470"
        stroke={COLOR_HIGHLIGHT}
        strokeWidth={0.7}
        fill="none"
      />
      {/* Calf vertical fibers (inner + outer head separated by central tendon) */}
      <Path
        d="M76 400 L80 468
           M82 396 L84 468
           M88 396 L88 466
           M94 400 L92 466
           M124 400 L120 468
           M118 396 L116 468
           M112 396 L112 466
           M106 400 L108 466"
        stroke={COLOR_STRIATION}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ---------------- LAYER 5: face features (nose ridge only) -------------- */}
      <Path d="M100 44 L98 56 L100 60 L102 56 Z" stroke={COLOR_OUTLINE} strokeWidth={0.4} fill="none" />
      {/* jawline subtle */}
      <Path
        d="M84 64 C90 70 98 72 100 72 C102 72 110 70 116 64"
        stroke={COLOR_OUTLINE}
        strokeWidth={0.4}
        fill="none"
      />

      {/* ---------------- LAYER 5: feet ----------------------------------------- */}
      <Path
        d="M82 488 L96 488 L98 510 L80 510 Z
           M104 488 L118 488 L120 510 L102 510 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.8}
      />
      {/* toe lines */}
      <Path
        d="M84 502 L96 502
           M104 502 L116 502"
        stroke={COLOR_OUTLINE}
        strokeWidth={0.4}
        fill="none"
      />

      <MuscleLabels labels={FRONT_LABELS} mCount={mCount} textAnchor="end" />
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// Back view silhouette path (reuse front shape — same skeleton)
// ---------------------------------------------------------------------------

const SILHOUETTE_BACK = SILHOUETTE_FRONT;

// ---------------------------------------------------------------------------
// Back view
// ---------------------------------------------------------------------------

function BackBody({ mQuintile, mCount }: BodyHeatmapProps) {
  const f = (m: string) => fillForM(m, mQuintile);
  return (
    <Svg viewBox="0 0 292 530" width={170} height={306}>
      {/* ---------------- LAYER 1: silhouette ----------------------------------- */}
      <Path d={SILHOUETTE_BACK} fill={COLOR_TORSO_BG} stroke={COLOR_OUTLINE} strokeWidth={1} />

      {/* ---------------- LAYER 2: hair (back view — full crown coverage) ------- */}
      <Path
        d="M70 38 C70 22 82 12 100 12 C118 12 130 22 130 38 C130 50 128 60 124 66 C120 64 110 64 100 64 C90 64 80 64 76 66 C72 60 70 50 70 38 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />

      {/* ---------------- LAYER 2: TRAP back diamond --------------------------- */}
      {/* Large kite from base-of-skull to mid-back, fanning out to acromion. */}
      <Path
        d="M100 78 C92 80 84 86 78 94 C72 100 66 106 60 110 C56 113 54 116 56 118 C66 116 76 116 88 120 C92 122 96 124 100 126 C104 124 108 122 112 120 C124 116 134 116 144 118 C146 116 144 113 140 110 C134 106 128 100 122 94 C116 86 108 80 100 78 Z
           M100 126 C94 134 88 144 84 156 C80 166 78 174 80 180 C88 184 94 188 100 192 C106 188 112 184 120 180 C122 174 120 166 116 156 C112 144 106 134 100 126 Z"
        fill={f(M_TRAP)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Spine groove (down center of trap) */}
      <Path
        d="M100 80 L100 192"
        stroke={COLOR_SHADOW}
        strokeWidth={0.8}
        fill="none"
      />
      {/* Trap fibers — diagonal from spine center out to acromion */}
      <Path
        d="M100 84 L72 100
           M100 92 L68 108
           M100 100 L80 118
           M100 84 L128 100
           M100 92 L132 108
           M100 100 L120 118
           M100 130 L84 156
           M100 138 L86 170
           M100 130 L116 156
           M100 138 L114 170"
        stroke={COLOR_STRIATION}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ---------------- BACK / LATS — V-taper ▽ shape ------------------------ */}
      {/* MUST narrow downward: widest at lower-scapula y=178, narrowing to lumbar. */}
      <Path
        d="M64 122 C56 140 54 162 58 180 C64 190 74 196 84 198 C86 184 84 168 80 154 C76 140 72 130 70 122 C68 120 66 120 64 122 Z
           M136 122 C144 140 146 162 142 180 C136 190 126 196 116 198 C114 184 116 168 120 154 C124 140 128 130 130 122 C132 120 134 120 136 122 Z"
        fill={f(M_BACK)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Lat 3D depth: shadow on lower (lumbar-attachment) rim, highlight along upper sweep */}
      <Path
        d="M62 168 C66 182 74 192 84 196
           M138 168 C134 182 126 192 116 196"
        stroke={COLOR_SHADOW}
        strokeWidth={1.0}
        fill="none"
      />
      <Path
        d="M70 130 C72 144 76 160 80 174
           M130 130 C128 144 124 160 120 174"
        stroke={COLOR_HIGHLIGHT}
        strokeWidth={0.7}
        fill="none"
      />
      {/* Lat fibers — diagonal from spinal/iliac insertion UP+OUT to humeral */}
      <Path
        d="M84 196 L98 140
           M82 192 L96 144
           M80 184 L94 148
           M78 174 L92 152
           M116 196 L102 140
           M118 192 L104 144
           M120 184 L106 148
           M122 174 L108 152"
        stroke={COLOR_STRIATION}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ---------------- LOWER BACK / erector spinae columns ------------------ */}
      {/* Two vertical columns flanking spine; sacral dimples optional. */}
      <Path
        d="M92 200 C90 212 90 230 92 250 C94 256 98 258 99 256 L99 200 Z
           M108 200 C110 212 110 230 108 250 C106 256 102 258 101 256 L101 200 Z"
        fill={f(M_LOWER_BACK)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Spine groove darker line */}
      <Path
        d="M100 198 L100 254"
        stroke={COLOR_SHADOW}
        strokeWidth={0.8}
        fill="none"
      />
      {/* Erector vertical fibers */}
      <Path
        d="M94 208 L96 248
           M97 208 L98 248
           M103 208 L102 248
           M106 208 L104 248"
        stroke={COLOR_STRIATION}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ---------------- UPPER GLUTE — rounded hill --------------------------- */}
      <Path
        d="M62 250 C58 258 56 270 58 282 C66 286 76 286 84 282 C92 278 98 270 100 260 C92 252 76 248 62 250 Z
           M138 250 C142 258 144 270 142 282 C134 286 124 286 116 282 C108 278 102 270 100 260 C108 252 124 248 138 250 Z"
        fill={f(M_UPPER_GLUTE)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Glute 3D depth: shadow on outer rim, highlight on upper crescent */}
      <Path
        d="M60 268 C62 278 70 284 80 284
           M140 268 C138 278 130 284 120 284"
        stroke={COLOR_SHADOW}
        strokeWidth={1.0}
        fill="none"
      />
      <Path
        d="M70 256 C74 258 80 260 84 262
           M130 256 C126 258 120 260 116 262"
        stroke={COLOR_HIGHLIGHT}
        strokeWidth={0.7}
        fill="none"
      />

      {/* ---------------- LOWER GLUTE — fold below ----------------------------- */}
      <Path
        d="M62 284 C60 292 60 302 64 310 C72 312 82 310 90 306 C96 302 100 296 100 290 C94 286 78 282 62 284 Z
           M138 284 C140 292 140 302 136 310 C128 312 118 310 110 306 C104 302 100 296 100 290 C106 286 122 282 138 284 Z"
        fill={f(M_LOWER_GLUTE)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Glute cleft (heart-shape midline) */}
      <Path
        d="M100 250 L100 310"
        stroke={COLOR_SHADOW}
        strokeWidth={0.8}
        fill="none"
      />
      {/* Glute fold under */}
      <Path
        d="M64 290 C72 296 82 298 90 296
           M136 290 C128 296 118 298 110 296"
        stroke={COLOR_STRIATION}
        strokeWidth={0.6}
        fill="none"
      />

      {/* ---------------- HAMSTRING — biceps femoris + semitendinosus ---------- */}
      {/* 2 visible heads per leg: biceps femoris (outer) + semitendinosus (inner). */}
      <Path
        d="M64 312 C60 332 60 360 64 372 C68 376 74 376 78 372 C80 354 82 332 84 314 C80 312 70 310 64 312 Z
           M86 314 C88 332 88 354 86 372 C90 376 96 376 98 372 C98 354 98 332 98 314 C94 312 88 312 86 314 Z
           M136 312 C140 332 140 360 136 372 C132 376 126 376 122 372 C120 354 118 332 116 314 C120 312 130 310 136 312 Z
           M114 314 C112 332 112 354 114 372 C110 376 104 376 102 372 C102 354 102 332 102 314 C106 312 112 312 114 314 Z"
        fill={f(M_HAMSTRING)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Hamstring 3D depth */}
      <Path
        d="M66 326 C64 348 64 368 70 372
           M134 326 C136 348 136 368 130 372"
        stroke={COLOR_SHADOW}
        strokeWidth={0.9}
        fill="none"
      />
      <Path
        d="M86 322 L86 370
           M114 322 L114 370"
        stroke={COLOR_HIGHLIGHT}
        strokeWidth={0.6}
        fill="none"
      />
      {/* Hamstring vertical fibers */}
      <Path
        d="M68 320 L72 368
           M76 320 L78 368
           M82 320 L82 368
           M88 320 L90 370
           M94 320 L96 370
           M132 320 L128 368
           M124 320 L122 368
           M118 320 L118 368
           M112 320 L110 370
           M106 320 L104 370"
        stroke={COLOR_STRIATION}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ---------------- REAR DELT (posterior deltoid) ------------------------ */}
      {/* Slightly wider lobe behind/outside the shoulder than front delt. */}
      <Path
        d="M46 96 C44 102 42 112 42 122 C42 134 46 142 52 144 C56 138 60 130 62 120 C64 110 66 100 66 96 C58 96 50 96 46 96 Z
           M154 96 C156 102 158 112 158 122 C158 134 154 142 148 144 C144 138 140 130 138 120 C136 110 134 100 134 96 C142 96 150 96 154 96 Z"
        fill={f(M_REAR_DELT)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Rear delt 3D depth + posterior fiber sweep */}
      <Path
        d="M50 104 C46 116 44 128 48 140
           M150 104 C154 116 156 128 152 140"
        stroke={COLOR_SHADOW}
        strokeWidth={1.0}
        fill="none"
      />
      <Path
        d="M48 106 C50 118 54 130 58 140
           M152 106 C150 118 146 130 142 140
           M52 102 C56 114 58 124 60 134
           M148 102 C144 114 142 124 140 134"
        stroke={COLOR_STRIATION}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ---------------- MID DELT (lateral, visible from back also) ----------- */}
      <Path
        d="M42 124 C38 132 36 142 38 152 C42 156 46 158 50 156 C50 144 50 132 50 124 C48 122 44 122 42 124 Z
           M158 124 C162 132 164 142 162 152 C158 156 154 158 150 156 C150 144 150 132 150 124 C152 122 156 122 158 124 Z"
        fill={f(M_MID_DELT)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      <Path
        d="M44 130 C42 140 42 150 44 154
           M156 130 C158 140 158 150 156 154"
        stroke={COLOR_HIGHLIGHT}
        strokeWidth={0.6}
        fill="none"
      />

      {/* ---------------- TRICEP — horseshoe with 3 heads ---------------------- */}
      {/* Long head (medial, inner-upper), lateral head (outer-upper), medial head (lower). */}
      {/* Left arm */}
      <Path
        d="M38 142 C34 156 32 172 36 184 C40 190 46 192 50 188 C50 180 52 170 52 158 C52 150 48 144 44 142 Z
           M52 148 C50 160 50 174 52 184 C56 188 60 186 60 180 C60 168 58 158 56 150 C54 146 52 146 52 148 Z
           M45 178 C44 186 44 192 46 196 L52 196 C52 192 52 186 52 180 C50 178 46 178 45 178 Z"
        fill={f(M_TRICEP)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Right arm */}
      <Path
        d="M162 142 C166 156 168 172 164 184 C160 190 154 192 150 188 C150 180 148 170 148 158 C148 150 152 144 156 142 Z
           M148 148 C150 160 150 174 148 184 C144 188 140 186 140 180 C140 168 142 158 144 150 C146 146 148 146 148 148 Z
           M155 178 C156 186 156 192 154 196 L148 196 C148 192 148 186 148 180 C150 178 154 178 155 178 Z"
        fill={f(M_TRICEP)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Tricep 3D + striations */}
      <Path
        d="M38 156 C36 172 38 184 44 190
           M162 156 C164 172 162 184 156 190"
        stroke={COLOR_SHADOW}
        strokeWidth={1.0}
        fill="none"
      />
      <Path
        d="M48 150 L48 186
           M58 156 L58 182"
        stroke={COLOR_HIGHLIGHT}
        strokeWidth={0.6}
        fill="none"
      />
      <Path
        d="M152 150 L152 186
           M142 156 L142 182"
        stroke={COLOR_HIGHLIGHT}
        strokeWidth={0.6}
        fill="none"
      />
      {/* Tricep 3-head fibers */}
      <Path
        d="M40 152 L44 188
           M44 150 L46 188
           M52 154 L52 184
           M58 158 L57 180
           M160 152 L156 188
           M156 150 L154 188
           M148 154 L148 184
           M142 158 L143 180"
        stroke={COLOR_STRIATION}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ---------------- FOREARM (back / extensors) --------------------------- */}
      <Path
        d="M40 200 C36 212 36 226 38 238 C40 244 42 248 46 248 C50 236 52 222 52 208 C52 202 48 200 44 200 Z
           M160 200 C164 212 164 226 162 238 C160 244 158 248 154 248 C150 236 148 222 148 208 C148 202 152 200 156 200 Z"
        fill={f(M_FOREARM)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      <Path
        d="M48 208 C50 222 50 236 48 246
           M152 208 C150 222 150 236 152 246"
        stroke={COLOR_SHADOW}
        strokeWidth={0.8}
        fill="none"
      />
      <Path
        d="M40 208 L44 244
           M44 206 L46 244
           M160 208 L156 244
           M156 206 L154 244"
        stroke={COLOR_STRIATION}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ---------------- HANDS (back of hand visible) ------------------------- */}
      <Path
        d="M36 250 L52 252 L54 270 L36 272 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.8}
      />
      <Path
        d="M40 254 L40 270
           M44 254 L44 270
           M48 254 L48 270
           M52 256 L54 268"
        stroke={COLOR_OUTLINE}
        strokeWidth={0.4}
        fill="none"
      />
      <Path
        d="M164 250 L148 252 L146 270 L164 272 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.8}
      />
      <Path
        d="M160 254 L160 270
           M156 254 L156 270
           M152 254 L152 270
           M148 256 L146 268"
        stroke={COLOR_OUTLINE}
        strokeWidth={0.4}
        fill="none"
      />

      {/* ---------------- CALF (back view — gastroc diamond more prominent) ---- */}
      {/* Medial head (larger inner lobe) + lateral head (smaller outer lobe) +
                visible achilles tendon strip. */}
      <Path
        d="M72 384 C68 400 68 432 72 460 C76 470 80 476 84 478 L86 478 C88 462 90 442 90 420 C90 406 88 392 86 384 Z
           M86 384 C88 396 90 412 90 428 C90 448 88 466 86 478 L96 478 C96 462 94 442 94 420 C94 404 92 390 90 384 Z
           M128 384 C132 400 132 432 128 460 C124 470 120 476 116 478 L114 478 C112 462 110 442 110 420 C110 406 112 392 114 384 Z
           M114 384 C112 396 110 412 110 428 C110 448 112 466 114 478 L104 478 C104 462 106 442 106 420 C106 404 108 390 110 384 Z"
        fill={f(M_CALF)}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.5}
      />
      {/* Gastroc central tendon (down midline) + achilles strip */}
      <Path
        d="M86 392 L86 470
           M94 392 L94 470
           M106 392 L106 470
           M114 392 L114 470"
        stroke={COLOR_HIGHLIGHT}
        strokeWidth={0.6}
        fill="none"
      />
      <Path
        d="M90 460 L90 480
           M110 460 L110 480"
        stroke={COLOR_SHADOW}
        strokeWidth={0.7}
        fill="none"
      />
      {/* Gastroc fibers — vertical, with diamond apex meeting near midline */}
      <Path
        d="M76 400 L82 466
           M80 396 L84 466
           M88 396 L88 460
           M94 400 L92 460
           M124 400 L118 466
           M120 396 L116 466
           M112 396 L112 460
           M106 400 L108 460"
        stroke={COLOR_STRIATION}
        strokeWidth={0.5}
        fill="none"
      />

      {/* ---------------- LAYER 5: feet (back / heel view) --------------------- */}
      <Path
        d="M82 488 L96 488 L98 510 L80 510 Z
           M104 488 L118 488 L120 510 L102 510 Z"
        fill={COLOR_SKIN}
        stroke={COLOR_OUTLINE}
        strokeWidth={0.8}
      />
      {/* heel line */}
      <Path
        d="M82 500 L96 500
           M104 500 L118 500"
        stroke={COLOR_OUTLINE}
        strokeWidth={0.4}
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
