/**
 * Bucket Constants Provider — single source of truth for v1 rep buckets.
 *
 * Acceptance criterion (issue #9):
 *   "5 桶 PR boundaries 由 Constants Provider 提供"
 *
 * v1 boundaries are hard-coded here; v1.5+ may load user overrides via the
 * same provider interface so call sites need not change.
 */

import type { BucketKey, BucketRange } from './types';

/** v1 fixed bucket boundaries, ordered low→high reps. */
export const BUCKETS: readonly BucketRange[] = [
  { key: 'max_strength', label: '最大力量', min: 1, max: 3 },
  { key: 'strength', label: '力量', min: 4, max: 6 },
  { key: 'hypertrophy', label: '增肌', min: 7, max: 10 },
  { key: 'muscle_endurance', label: '肌耐力', min: 11, max: 15 },
  { key: 'endurance', label: '耐力', min: 16, max: null },
];

/**
 * Classify a rep count into one of the 5 buckets.
 * Returns null when reps is invalid (≤ 0, non-finite, or null).
 */
export function classifyBucket(reps: number | null | undefined): BucketKey | null {
  if (reps == null || !Number.isFinite(reps) || reps < 1) return null;
  for (const b of BUCKETS) {
    if (reps >= b.min && (b.max == null || reps <= b.max)) return b.key;
  }
  return null;
}

/** Lookup helper for UI labels. */
export function bucketLabel(key: BucketKey): string {
  const b = BUCKETS.find((x) => x.key === key);
  return b ? b.label : key;
}

/**
 * UI display priority when a single set breaks multiple PRs simultaneously.
 * Higher index = higher priority (we want the most "impressive" first).
 *
 * Rationale: weight PR in a heavier (lower rep) bucket is the most
 * eye-catching badge for a lifter; volume PR in muscle-endurance / endurance
 * is meaningful but reads quieter on the chip.
 */
const BUCKET_DISPLAY_RANK: Record<BucketKey, number> = {
  max_strength: 5,
  strength: 4,
  hypertrophy: 3,
  muscle_endurance: 2,
  endurance: 1,
};

const TYPE_DISPLAY_RANK = { weight: 1, volume: 0 };

/**
 * Sort PRBreaks for chip display: heaviest bucket first, weight PR before
 * volume PR within the same bucket. Stable across multi-bucket simultaneous
 * breaks (which can happen when a Set's reps fall in one bucket but its
 * weight beats a different bucket's prior best — though in v1 each Set's PR
 * is bounded to its own bucket only, so multi-bucket here means the test
 * harness or future cross-bucket extensions).
 */
export function sortBreaksForDisplay<T extends { bucket: BucketKey; type: 'weight' | 'volume' }>(
  breaks: readonly T[]
): T[] {
  return [...breaks].sort((a, b) => {
    const dr = BUCKET_DISPLAY_RANK[b.bucket] - BUCKET_DISPLAY_RANK[a.bucket];
    if (dr !== 0) return dr;
    return TYPE_DISPLAY_RANK[b.type] - TYPE_DISPLAY_RANK[a.type];
  });
}
