/**
 * Module #4 — E1RM Engine.
 *
 * Estimated 1-rep max via the Epley formula:
 *   e1RM = weight × (1 + reps / 30)
 *
 * Edge cases:
 * - reps = 1 → e1RM = weight (no extrapolation; matches Epley boundary).
 * - reps = 0, weight = 0, or non-finite inputs → null (undefined).
 * - load_type rules:
 *     - A loaded   → use weight directly (no bw addition)
 *     - B bodyweight → same formula on the +ext weight; pure-bw set
 *       (weight_kg = 0) returns null because there's no scalar load to estimate
 *     - C assisted → use effective load = (bw_snapshot − weight); requires
 *       bw_snapshot; if missing OR effective load ≤ 0 returns null
 *
 * v1 explicitly does NOT compute "e1RM PR" (CONTEXT.md line 211). This module
 * only exposes the estimator; future bucket-PR-by-e1RM lives in v1.5+.
 */

import type { LoadType } from '../exercise/types';

interface E1RMInput {
  weight_kg: number | null;
  reps: number | null;
  load_type: LoadType;
  /** Required for load_type='assisted'; ignored otherwise. */
  bw_snapshot_kg?: number | null;
}

/** Returns Epley estimate in kg, or null when inputs don't define a meaningful 1RM. */
export function estimateE1RM(input: E1RMInput): number | null {
  const reps = input.reps;
  const weight = input.weight_kg;
  if (reps == null || !Number.isFinite(reps) || reps < 1) return null;
  if (weight == null || !Number.isFinite(weight)) return null;

  const effective = effectiveLoad(weight, input.load_type, input.bw_snapshot_kg ?? null);
  if (effective == null || effective <= 0) return null;

  return effective * (1 + reps / 30);
}

/**
 * Per-load_type effective load used for both E1RM and volume math.
 * Exported because Volume Engine needs identical branching (DRY).
 */
export function effectiveLoad(
  weight_kg: number,
  load_type: LoadType,
  bw_snapshot_kg: number | null
): number | null {
  switch (load_type) {
    case 'loaded':
      return weight_kg;
    case 'bodyweight':
      return weight_kg;
    case 'assisted': {
      if (bw_snapshot_kg == null || !Number.isFinite(bw_snapshot_kg)) return null;
      return bw_snapshot_kg - weight_kg;
    }
  }
}
