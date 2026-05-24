/**
 * Shared anchor table + fan-layout helpers for the two body-diagram
 * components:
 *   - `muscle-body-tagger.tsx`  (interactive 19-M_* picker, tap-cycle)
 *   - `body-heatmap.tsx`        (read-only quintile-colour stats)
 *
 * Anchors are in PACKAGE viewBox units:
 *   front side: x ∈ [0, 724], y ∈ [0, 1448]
 *   back  side: x ∈ [724, 1448], y ∈ [0, 1448]
 *
 * Each M_* lives on exactly one side. Mid-delt sits on FRONT only (its
 * fill still spans both views because the overlay's role-fill propagates
 * through siblings, but a single label is enough — duplicating it on
 * BACK would clutter without adding signal).
 *
 * Front anchors pick L-arm x (subject's right) so the leader exits the
 * label lane on the LEFT of the side container and dives RIGHT toward
 * the body. Back anchors pick R-back x (subject's left, viewer's right)
 * so the leader exits the label lane on the RIGHT and dives LEFT.
 */
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

interface AnchorEntry {
  m: string;
  vbX: number;
  vbY: number;
}

export const FRONT_ANCHORS: readonly AnchorEntry[] = [
  { m: M_FRONT_DELT,  vbX: 260, vbY: 340 },
  { m: M_MID_DELT,    vbX: 200, vbY: 355 },
  { m: M_UPPER_CHEST, vbX: 320, vbY: 360 },
  { m: M_LOWER_CHEST, vbX: 320, vbY: 410 },
  { m: M_BICEP_LONG,  vbX: 190, vbY: 440 },
  { m: M_BICEP_SHORT, vbX: 220, vbY: 460 },
  { m: M_ABS,         vbX: 340, vbY: 540 },
  { m: M_OBLIQUE,     vbX: 295, vbY: 580 },
  { m: M_FOREARM,     vbX: 170, vbY: 600 },
  { m: M_QUAD,        vbX: 290, vbY: 820 },
];

export const BACK_ANCHORS: readonly AnchorEntry[] = [
  { m: M_TRAP,        vbX: 1086, vbY: 310 },
  { m: M_REAR_DELT,   vbX: 1227, vbY: 360 },
  { m: M_TRICEP,      vbX: 1250, vbY: 440 },
  { m: M_BACK,        vbX: 1140, vbY: 480 },
  { m: M_LOWER_BACK,  vbX: 1100, vbY: 620 },
  { m: M_UPPER_GLUTE, vbX: 1120, vbY: 700 },
  { m: M_LOWER_GLUTE, vbX: 1120, vbY: 760 },
  { m: M_HAMSTRING,   vbX: 1160, vbY: 870 },
  { m: M_CALF,        vbX: 1160, vbY: 1100 },
];

/**
 * Fan layout — filter anchors, sort by anchorY ASC, distribute labelY
 * evenly across the lane. Same-ordering guarantee → no leader-line
 * crossings.
 */
export function fanLayout(
  anchors: readonly AnchorEntry[],
  shouldShow: (a: AnchorEntry) => boolean,
  yMin: number,
  yMax: number
): Array<AnchorEntry & { labelY: number }> {
  const filtered = anchors.filter(shouldShow);
  if (filtered.length === 0) return [];
  const sorted = [...filtered].sort((a, b) => a.vbY - b.vbY);
  if (sorted.length === 1) {
    return [{ ...sorted[0], labelY: (yMin + yMax) / 2 }];
  }
  const step = (yMax - yMin) / (sorted.length - 1);
  return sorted.map((a, i) => ({ ...a, labelY: yMin + i * step }));
}

/**
 * Convert package viewBox X to local body-pane X in screen pixels.
 *   front: vbX ∈ [0, 724]    → screen ∈ [0, bodyWidthPx]
 *   back : vbX ∈ [724, 1448] → screen ∈ [0, bodyWidthPx] (relative to body
 *          pane left edge, the back viewBox starts at 724 in its own SVG)
 */
export function vbToBodyLocalX(vbX: number, side: 'front' | 'back', bodyWidthPx: number): number {
  const local = side === 'front' ? vbX : vbX - 724;
  return (local / 724) * bodyWidthPx;
}

export function vbToBodyLocalY(vbY: number, bodyHeightPx: number): number {
  return (vbY / 1448) * bodyHeightPx;
}
