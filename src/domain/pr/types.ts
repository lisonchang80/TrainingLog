/**
 * PR / Volume engine — shared types.
 *
 * Domain decisions (CONTEXT.md / ADR-0006 / ADR-0007):
 * - PR identity = (Exercise, rep bucket). 5 buckets, system-fixed in v1.
 * - Two PR types per bucket: weight PR, volume PR.
 * - Volume = load_type A/B → weight × reps; load_type C → (bw_snapshot − weight) × reps.
 * - Pure-bodyweight set (load_type=B and weight_kg=0) is excluded from PR check.
 */

import type { LoadType } from '../exercise/types';

/** v1 5 fixed buckets. Order matters — `5` (耐力) is the open-ended top. */
export type BucketKey =
  | 'max_strength' // 1-3 reps  最大力量
  | 'strength' //     4-6        力量
  | 'hypertrophy' //  7-10       增肌
  | 'muscle_endurance' // 11-15  肌耐力
  | 'endurance'; //   16+        耐力

export interface BucketRange {
  key: BucketKey;
  /** Display label (Traditional Chinese). */
  label: string;
  /** Inclusive lower bound on reps. */
  min: number;
  /** Inclusive upper bound on reps. `null` = open-ended (the top bucket). */
  max: number | null;
}

/** Two flavours of PR within a single bucket. */
export type PRType = 'weight' | 'volume';

/**
 * One PR break detected on a newly logged Set.
 *
 * `prior_best` is null when this is the first qualifying set for that
 * (Exercise, bucket, type) — we report it as a "first PR" and the UI uses
 * a slightly different chip wording.
 */
export interface PRBreak {
  bucket: BucketKey;
  type: PRType;
  /** weight (kg) for type='weight', or volume (kg-reps) for type='volume'. */
  new_value: number;
  prior_best: number | null;
}

/** Set of all PR breaks discovered for one new Set, plus a flag for cross-bucket PRs. */
export interface PRDelta {
  /** All bucket-level breaks. May be 0–2 (one weight + one volume) per matched bucket. */
  breaks: PRBreak[];
  /**
   * True when the new Set's weight beats every prior set of the same exercise
   * regardless of bucket (i.e. the heaviest single set ever for this exercise).
   * Independent of bucket-level weight PR.
   */
  is_all_time_weight_pr: boolean;
  /** True when the new Set's volume beats every prior set's volume across all buckets. */
  is_all_time_volume_pr: boolean;
}

/** Compact set tuple consumed by the engines. Used internally for prior history. */
export interface SetForPR {
  weight_kg: number | null;
  reps: number | null;
  /** load_type of the exercise this set belongs to. */
  load_type: LoadType;
  /**
   * For load_type='assisted', the session-level bw snapshot in kg.
   * Required for volume math in C; null = volume undefined.
   */
  bw_snapshot_kg: number | null;
}
