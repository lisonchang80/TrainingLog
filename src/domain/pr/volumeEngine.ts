/**
 * Module #3 — Volume Engine.
 *
 * Per-set volume with load_type asymmetry (ADR-0007):
 *   A loaded     → weight × reps
 *   B bodyweight → weight × reps (純徒手 weight_kg=0 → 0; not null)
 *   C assisted   → (bw_snapshot − weight) × reps; null if no snapshot
 *                  or if effective load ≤ 0
 *
 * Returns null when volume is undefined for the set (invalid reps,
 * missing C-class snapshot, or non-positive effective load for C).
 * Returns 0 (not null) for pure-bodyweight sets — they're valid sets,
 * they just contribute zero scalar volume.
 */

import type { LoadType } from '../exercise/types';
import { effectiveLoad } from './e1rmEngine';

export interface VolumeInput {
  weight_kg: number | null;
  reps: number | null;
  load_type: LoadType;
  /** Required for assisted; ignored for loaded/bodyweight. */
  bw_snapshot_kg?: number | null;
}

/** Per-set volume in kg-reps, or null when undefined. */
export function setVolume(input: VolumeInput): number | null {
  const reps = input.reps;
  const weight = input.weight_kg;
  if (reps == null || !Number.isFinite(reps) || reps < 1) return null;
  if (weight == null || !Number.isFinite(weight)) return null;

  const eff = effectiveLoad(weight, input.load_type, input.bw_snapshot_kg ?? null);
  if (eff == null) return null; // C without snapshot

  // Bodyweight class allows weight=0 → eff=0 → volume 0 (valid).
  // Assisted class with eff ≤ 0 (lifter heavier than weight, OR weight ≥ bw) returns null.
  if (input.load_type === 'assisted' && eff <= 0) return null;
  if (eff < 0) return null;

  return eff * reps;
}

/** Sum-of-volumes helper for an array of sets; nulls are skipped. */
export function sumVolume(sets: readonly VolumeInput[]): number {
  let total = 0;
  for (const s of sets) {
    const v = setVolume(s);
    if (v != null) total += v;
  }
  return total;
}
