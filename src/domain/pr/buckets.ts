/**
 * Bucket Constants Provider — single source of truth for rep buckets.
 *
 * Acceptance criterion (issue #9):
 *   "5 桶 PR boundaries 由 Constants Provider 提供"
 *
 * Slice 17 / ADR-0027 — 「可編輯訓練目的次數範圍」. The boundaries used to be
 * a `readonly` const; they are now a **mutable module-level cache** that the
 * user can edit from Settings. The cache is:
 *   - seeded with the v1 defaults (`DEFAULT_BUCKETS`) at module load,
 *   - hydrated from `app_settings.bucket_ranges` once at boot
 *     (`components/bucket-ranges-hydrator.tsx` → `applyBucketRanges`),
 *   - updated in place when the user moves a boundary in Settings.
 *
 * WHY in-place mutation (`BUCKETS.splice`) instead of reassigning the export
 * or threading a config object through every call site: the ~18 consumers
 * (PR engine, history repo, rep-bucket filter, achievement replay, seed,
 * Watch history…) all read the ranges at CALL TIME via `classifyBucket` or
 * `BUCKETS.find(...)`. Mutating the same array object in place means every
 * one of them sees the new boundaries with ZERO edits — and the array
 * identity stays stable, so any consumer holding a reference is safe too.
 * (The only top-level capture, `repBucketFilter`'s chip key list, captures
 * `key`s only — and keys never change, only ranges do.)
 *
 * Labels are canonical (keyed by `key`) and never user-editable, so a range
 * edit preserves the label from `DEFAULT_BUCKETS`.
 */

import type { BucketBoundary, BucketKey, BucketRange } from './types';

/** v1 fixed bucket boundaries, ordered low→high reps. Canonical labels live here. */
export const DEFAULT_BUCKETS: readonly BucketRange[] = [
  { key: 'max_strength', label: '最大力量', min: 1, max: 3 },
  { key: 'strength', label: '力量', min: 4, max: 6 },
  { key: 'hypertrophy', label: '增肌', min: 7, max: 10 },
  { key: 'muscle_endurance', label: '肌耐力', min: 11, max: 15 },
  { key: 'endurance', label: '耐力', min: 16, max: null },
];

/** Canonical key→label map (range edits never touch labels). */
const LABELS: Record<BucketKey, string> = {
  max_strength: '最大力量',
  strength: '力量',
  hypertrophy: '增肌',
  muscle_endurance: '肌耐力',
  endurance: '耐力',
};

/** Canonical bucket order (low→high reps). The top bucket is open-ended. */
const ORDER: readonly BucketKey[] = [
  'max_strength',
  'strength',
  'hypertrophy',
  'muscle_endurance',
  'endurance',
];

/**
 * Live bucket boundaries — MUTATED IN PLACE by `applyBucketRanges`.
 * Read this (via `classifyBucket` / `.find`) at call time; never capture a
 * derived value at module top level (capture the array, derive at call time).
 */
export const BUCKETS: BucketRange[] = DEFAULT_BUCKETS.map((b) => ({ ...b }));

/**
 * Validate a candidate boundary list. Valid ⇔ exactly the 5 canonical keys in
 * canonical order, contiguous coverage of 1..∞:
 *   - 5 entries, keys === ORDER
 *   - entry[0].min === 1
 *   - every min/max a positive integer with min ≤ max (last max === null)
 *   - entry[i].min === entry[i-1].max + 1 (no gaps / overlaps)
 *   - last entry max === null (open-ended top bucket)
 */
export function validateBucketBoundaries(
  boundaries: readonly BucketBoundary[] | null | undefined
): boundaries is BucketBoundary[] {
  if (!Array.isArray(boundaries) || boundaries.length !== ORDER.length) return false;
  for (let i = 0; i < ORDER.length; i++) {
    const b = boundaries[i];
    if (!b || b.key !== ORDER[i]) return false;
    if (!Number.isInteger(b.min) || b.min < 1) return false;
    const isLast = i === ORDER.length - 1;
    if (isLast) {
      if (b.max !== null) return false;
    } else {
      if (!Number.isInteger(b.max as number) || (b.max as number) < b.min) return false;
    }
    if (i > 0) {
      const prevMax = boundaries[i - 1].max;
      if (prevMax == null || b.min !== prevMax + 1) return false;
    }
  }
  if (boundaries[0].min !== 1) return false;
  return true;
}

/**
 * Apply user-edited (or hydrated) boundaries to the live `BUCKETS` cache,
 * IN PLACE. Invalid / null input → reset to defaults (never leave the cache
 * in a half-applied / non-contiguous state that would break `classifyBucket`).
 * Labels are taken from the canonical `LABELS` map regardless of input.
 */
export function applyBucketRanges(
  boundaries: readonly BucketBoundary[] | null | undefined
): void {
  const next: BucketRange[] = validateBucketBoundaries(boundaries)
    ? boundaries.map((b) => ({ key: b.key, label: LABELS[b.key], min: b.min, max: b.max }))
    : DEFAULT_BUCKETS.map((b) => ({ ...b }));
  // In-place replace — keeps the array identity stable for all consumers.
  BUCKETS.splice(0, BUCKETS.length, ...next);
}

/** Reset the live cache to the v1 defaults (used by tests + a Settings reset). */
export function resetBucketRanges(): void {
  BUCKETS.splice(0, BUCKETS.length, ...DEFAULT_BUCKETS.map((b) => ({ ...b })));
}

/** Current boundaries as the persisted/wire shape (label dropped). */
export function getBucketBoundaries(): BucketBoundary[] {
  return BUCKETS.map((b) => ({ key: b.key, min: b.min, max: b.max }));
}

/**
 * Classify a rep count into one of the 5 buckets.
 * Returns null when reps is invalid (≤ 0, non-finite, or null).
 * Reads the live `BUCKETS` cache at call time → reflects user edits.
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
