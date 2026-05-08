/**
 * Module #2 — PR Engine.
 *
 * Detects PR breaks for a newly recorded Set against the prior set history
 * of the same Exercise. PR identity = (Exercise, rep bucket); this module
 * is exercise-scoped — caller passes only sets for the current exercise.
 *
 * Two PR types per bucket:
 *   - weight PR: max weight_kg in that bucket (for assisted, max effective load)
 *   - volume PR: max per-set volume in that bucket
 *
 * Plus two cross-bucket flags:
 *   - all-time weight PR: heaviest single set across ALL buckets for this exercise
 *   - all-time volume PR: highest per-set volume across ALL buckets
 *
 * Skip rules (ADR-0007):
 *   - load_type='bodyweight' AND weight_kg = 0 → skip PR check entirely
 *     (純徒手 set; weight=0 PR is meaningless)
 *   - load_type='assisted' WITHOUT bw_snapshot → skip volume / weight PR
 *     (effective load undefined; UI shows "—")
 *   - reps not in any bucket (≤ 0 or invalid) → skip
 */

import type { BucketKey, PRBreak, PRDelta, SetForPR } from './types';
import { classifyBucket } from './buckets';
import { setVolume } from './volumeEngine';
import { effectiveLoad } from './e1rmEngine';

export interface DetectPRArgs {
  /** The set just recorded. */
  new_set: SetForPR;
  /** All prior sets of the SAME exercise (any session, any template). Order doesn't matter. */
  prior_sets: readonly SetForPR[];
}

/**
 * Compare new_set against prior_sets and return everything it broke.
 * If new_set itself is unqualified for PR (skip rules above), returns
 * an empty delta — caller treats as "no chip to show".
 */
export function detectPRBreaks(args: DetectPRArgs): PRDelta {
  const empty: PRDelta = {
    breaks: [],
    is_all_time_weight_pr: false,
    is_all_time_volume_pr: false,
  };

  const ns = args.new_set;
  const bucket = classifyBucket(ns.reps);
  if (bucket == null) return empty;
  if (ns.weight_kg == null || !Number.isFinite(ns.weight_kg)) return empty;

  // Pure bodyweight skip
  if (ns.load_type === 'bodyweight' && ns.weight_kg === 0) return empty;

  // Assisted without snapshot skip
  if (ns.load_type === 'assisted' && ns.bw_snapshot_kg == null) return empty;

  const newEffWeight = effectiveLoad(ns.weight_kg, ns.load_type, ns.bw_snapshot_kg);
  if (newEffWeight == null) return empty;
  // For assisted, non-positive effective load is meaningless for PR
  if (ns.load_type === 'assisted' && newEffWeight <= 0) return empty;

  const newVolume = setVolume({
    weight_kg: ns.weight_kg,
    reps: ns.reps,
    load_type: ns.load_type,
    bw_snapshot_kg: ns.bw_snapshot_kg,
  });
  if (newVolume == null) return empty;

  // Aggregate prior bests by bucket + cross-bucket
  let bestWeightInBucket: number | null = null;
  let bestVolumeInBucket: number | null = null;
  let bestWeightAllTime: number | null = null;
  let bestVolumeAllTime: number | null = null;

  for (const ps of args.prior_sets) {
    if (ps.weight_kg == null || ps.reps == null) continue;
    if (ps.load_type === 'bodyweight' && ps.weight_kg === 0) continue;
    if (ps.load_type === 'assisted' && ps.bw_snapshot_kg == null) continue;

    const eff = effectiveLoad(ps.weight_kg, ps.load_type, ps.bw_snapshot_kg);
    if (eff == null) continue;
    if (ps.load_type === 'assisted' && eff <= 0) continue;

    const v = setVolume({
      weight_kg: ps.weight_kg,
      reps: ps.reps,
      load_type: ps.load_type,
      bw_snapshot_kg: ps.bw_snapshot_kg,
    });
    if (v == null) continue;

    if (bestWeightAllTime == null || eff > bestWeightAllTime) bestWeightAllTime = eff;
    if (bestVolumeAllTime == null || v > bestVolumeAllTime) bestVolumeAllTime = v;

    const psBucket = classifyBucket(ps.reps);
    if (psBucket === bucket) {
      if (bestWeightInBucket == null || eff > bestWeightInBucket) bestWeightInBucket = eff;
      if (bestVolumeInBucket == null || v > bestVolumeInBucket) bestVolumeInBucket = v;
    }
  }

  const breaks: PRBreak[] = [];

  // Weight PR within bucket
  if (bestWeightInBucket == null || newEffWeight > bestWeightInBucket) {
    breaks.push({
      bucket,
      type: 'weight',
      new_value: newEffWeight,
      prior_best: bestWeightInBucket,
    });
  }

  // Volume PR within bucket
  if (bestVolumeInBucket == null || newVolume > bestVolumeInBucket) {
    breaks.push({
      bucket,
      type: 'volume',
      new_value: newVolume,
      prior_best: bestVolumeInBucket,
    });
  }

  return {
    breaks,
    is_all_time_weight_pr: bestWeightAllTime == null || newEffWeight > bestWeightAllTime,
    is_all_time_volume_pr: bestVolumeAllTime == null || newVolume > bestVolumeAllTime,
  };
}

/**
 * Aggregate PR snapshot for a list of sets (e.g. all sets of one exercise).
 * Used by the Exercise History page header to render "全時 PR" per bucket.
 *
 * Returns one entry per bucket that has at least one qualifying set.
 */
export interface BucketPRSnapshot {
  bucket: BucketKey;
  weight_best: number | null;
  weight_best_reps: number | null;
  volume_best: number | null;
  volume_best_weight: number | null;
  volume_best_reps: number | null;
}

export function aggregateBucketPRs(
  sets: readonly SetForPR[]
): BucketPRSnapshot[] {
  const byBucket = new Map<BucketKey, BucketPRSnapshot>();

  for (const s of sets) {
    if (s.weight_kg == null || s.reps == null) continue;
    if (s.load_type === 'bodyweight' && s.weight_kg === 0) continue;
    if (s.load_type === 'assisted' && s.bw_snapshot_kg == null) continue;

    const bucket = classifyBucket(s.reps);
    if (bucket == null) continue;

    const eff = effectiveLoad(s.weight_kg, s.load_type, s.bw_snapshot_kg);
    if (eff == null) continue;
    if (s.load_type === 'assisted' && eff <= 0) continue;

    const v = setVolume({
      weight_kg: s.weight_kg,
      reps: s.reps,
      load_type: s.load_type,
      bw_snapshot_kg: s.bw_snapshot_kg,
    });
    if (v == null) continue;

    let snap = byBucket.get(bucket);
    if (!snap) {
      snap = {
        bucket,
        weight_best: null,
        weight_best_reps: null,
        volume_best: null,
        volume_best_weight: null,
        volume_best_reps: null,
      };
      byBucket.set(bucket, snap);
    }

    if (snap.weight_best == null || eff > snap.weight_best) {
      snap.weight_best = eff;
      snap.weight_best_reps = s.reps;
    }
    if (snap.volume_best == null || v > snap.volume_best) {
      snap.volume_best = v;
      snap.volume_best_weight = eff;
      snap.volume_best_reps = s.reps;
    }
  }

  // Stable ordering by bucket index (max_strength → endurance)
  const order: BucketKey[] = [
    'max_strength',
    'strength',
    'hypertrophy',
    'muscle_endurance',
    'endurance',
  ];
  return order.flatMap((k) => {
    const v = byBucket.get(k);
    return v ? [v] : [];
  });
}
