/**
 * Rep Bucket Filter — 動作歷史頁 / 圖表頁 chip filter helpers (ADR-0017 Q14,
 * ADR-0009 2026-05-13 amendment).
 *
 * The Library detail page's history + chart tabs show a chip row:
 *     [全部] [1-3] [4-6] [7-10] [11-15] [16+]
 * Toggling a chip narrows the visible sets to those whose reps fall in the
 * selected bucket. The 1RM line on the chart is exempt — see Q14.
 *
 * `BucketKey` and `classifyBucket` already live in `src/domain/pr/buckets.ts`;
 * this module adds the `'all'` widening and the chip-label mapping.
 */

import { BUCKETS, classifyBucket } from '../pr/buckets';
import type { BucketKey } from '../pr/types';

/** Chip selection: `'all'` shows everything; otherwise narrow to one bucket. */
export type RepBucketChip = 'all' | BucketKey;

/** All chip keys in display order. `'all'` leads, then buckets low→high reps. */
export const REP_BUCKET_CHIPS: readonly RepBucketChip[] = [
  'all',
  ...BUCKETS.map((b) => b.key),
] as const;

/**
 * Reps-range label per ADR-0017 Q14 default ("1-3", "4-6", …, "16+", "全部").
 * Compact and unambiguous on a chip row.
 */
export function repRangeLabel(chip: RepBucketChip): string {
  if (chip === 'all') return '全部';
  const b = BUCKETS.find((x) => x.key === chip);
  if (!b) return chip;
  return b.max == null ? `${b.min}+` : `${b.min}-${b.max}`;
}

/**
 * Domain-named label per ADR-0017 Q14 alternative ("最大力量" / "力量" / …).
 * Caller picks whichever set fits the surface.
 */
export function bucketDomainLabel(chip: RepBucketChip): string {
  if (chip === 'all') return '全部';
  const b = BUCKETS.find((x) => x.key === chip);
  return b ? b.label : chip;
}

/** Does `reps` fall in `chip`? `'all'` always matches (including invalid reps). */
export function matchesChip(reps: number | null | undefined, chip: RepBucketChip): boolean {
  if (chip === 'all') return true;
  return classifyBucket(reps) === chip;
}

/**
 * Filter a list of sets by chip. Returns input unchanged when chip = `'all'`.
 *
 * Generic over any row shape with a `reps` field — works for raw `set` rows
 * from the DB or chart-input tuples. Sets with invalid reps (null / NaN / ≤0)
 * are kept when chip = `'all'` and dropped otherwise, matching the chip row's
 * visible intent.
 */
export function filterSetsByBucket<T extends { reps: number | null }>(
  sets: readonly T[],
  chip: RepBucketChip
): T[] {
  if (chip === 'all') return [...sets];
  return sets.filter((s) => classifyBucket(s.reps) === chip);
}
