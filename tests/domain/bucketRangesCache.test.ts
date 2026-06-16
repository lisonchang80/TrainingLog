import {
  BUCKETS,
  DEFAULT_BUCKETS,
  applyBucketRanges,
  classifyBucket,
  getBucketBoundaries,
  resetBucketRanges,
  validateBucketBoundaries,
} from '../../src/domain/pr/buckets';
import type { BucketBoundary } from '../../src/domain/pr/types';

/**
 * Slice 17 / ADR-0027 — editable rep-bucket cache.
 *
 * The `BUCKETS` cache is module-level + mutated in place, so every test must
 * `resetBucketRanges()` afterwards to avoid leaking edits into sibling tests.
 */
const VALID_EDIT: BucketBoundary[] = [
  { key: 'max_strength', min: 1, max: 5 }, // widened 1–3 → 1–5
  { key: 'strength', min: 6, max: 8 }, // shifted
  { key: 'hypertrophy', min: 9, max: 12 },
  { key: 'muscle_endurance', min: 13, max: 20 },
  { key: 'endurance', min: 21, max: null },
];

describe('Slice 17 — bucket ranges cache', () => {
  afterEach(() => {
    resetBucketRanges();
  });

  describe('validateBucketBoundaries', () => {
    it('accepts the default boundaries', () => {
      expect(validateBucketBoundaries(getBucketBoundaries())).toBe(true);
    });

    it('accepts a valid contiguous edit', () => {
      expect(validateBucketBoundaries(VALID_EDIT)).toBe(true);
    });

    it('rejects null / wrong length', () => {
      expect(validateBucketBoundaries(null)).toBe(false);
      expect(validateBucketBoundaries([])).toBe(false);
      expect(validateBucketBoundaries(VALID_EDIT.slice(0, 4))).toBe(false);
    });

    it('rejects a gap between buckets (non-contiguous)', () => {
      const gap = VALID_EDIT.map((b) => ({ ...b }));
      gap[1].min = 7; // prev max is 5 → expected 6, so a gap at rep 6
      expect(validateBucketBoundaries(gap)).toBe(false);
    });

    it('rejects an overlap between buckets', () => {
      const overlap = VALID_EDIT.map((b) => ({ ...b }));
      overlap[0].max = 6; // next.min is 6 → overlap
      expect(validateBucketBoundaries(overlap)).toBe(false);
    });

    it('rejects first bucket not starting at 1', () => {
      const bad = VALID_EDIT.map((b) => ({ ...b }));
      bad[0].min = 2;
      expect(validateBucketBoundaries(bad)).toBe(false);
    });

    it('rejects a non-null max on the last bucket', () => {
      const bad = VALID_EDIT.map((b) => ({ ...b }));
      bad[4] = { ...bad[4], max: 30 };
      expect(validateBucketBoundaries(bad)).toBe(false);
    });

    it('rejects min > max within a bucket', () => {
      const bad = VALID_EDIT.map((b) => ({ ...b }));
      bad[2] = { key: 'hypertrophy', min: 12, max: 9 };
      expect(validateBucketBoundaries(bad)).toBe(false);
    });

    it('rejects wrong key order', () => {
      const swapped = VALID_EDIT.map((b) => ({ ...b }));
      [swapped[1].key, swapped[2].key] = [swapped[2].key, swapped[1].key];
      expect(validateBucketBoundaries(swapped)).toBe(false);
    });
  });

  describe('applyBucketRanges + classifyBucket', () => {
    it('classifies with default ranges before any edit', () => {
      expect(classifyBucket(2)).toBe('max_strength'); // 1–3
      expect(classifyBucket(5)).toBe('strength'); //     4–6
      expect(classifyBucket(8)).toBe('hypertrophy'); //  7–10
      expect(classifyBucket(13)).toBe('muscle_endurance'); // 11–15
      expect(classifyBucket(30)).toBe('endurance'); // 16+
    });

    it('reflects an applied edit at call time (live cache)', () => {
      applyBucketRanges(VALID_EDIT);
      // 5 reps is now max_strength (was strength under defaults).
      expect(classifyBucket(5)).toBe('max_strength');
      expect(classifyBucket(6)).toBe('strength');
      expect(classifyBucket(12)).toBe('hypertrophy');
      expect(classifyBucket(20)).toBe('muscle_endurance');
      expect(classifyBucket(21)).toBe('endurance');
    });

    it('mutates BUCKETS in place (array identity stable)', () => {
      const ref = BUCKETS;
      applyBucketRanges(VALID_EDIT);
      expect(BUCKETS).toBe(ref); // same array object — ref-holders see the edit
      expect(BUCKETS[0].max).toBe(5);
    });

    it('preserves canonical labels across an edit', () => {
      applyBucketRanges(VALID_EDIT);
      expect(BUCKETS[0].label).toBe('最大力量');
      expect(BUCKETS[4].label).toBe('耐力');
    });

    it('invalid input resets the cache to defaults', () => {
      applyBucketRanges(VALID_EDIT);
      applyBucketRanges(null);
      expect(getBucketBoundaries()).toEqual(
        DEFAULT_BUCKETS.map((b) => ({ key: b.key, min: b.min, max: b.max }))
      );
      expect(classifyBucket(5)).toBe('strength'); // back to default mapping
    });

    it('resetBucketRanges restores defaults', () => {
      applyBucketRanges(VALID_EDIT);
      resetBucketRanges();
      expect(getBucketBoundaries()).toEqual(
        DEFAULT_BUCKETS.map((b) => ({ key: b.key, min: b.min, max: b.max }))
      );
    });
  });

  describe('getBucketBoundaries', () => {
    it('returns label-free boundaries matching the cache', () => {
      applyBucketRanges(VALID_EDIT);
      expect(getBucketBoundaries()).toEqual(VALID_EDIT);
    });
  });
});
