/**
 * Slice 13c — `pr/buckets.ts` edge case coverage.
 *
 * `tests/domain/prEngine.test.ts` already exercises the happy-path bucket
 * boundaries for `classifyBucket` + a couple of `sortBreaksForDisplay`
 * cases. The defensive fallback branches were uncovered:
 *
 *   - `bucketLabel` lookup-miss → returns the raw key (line 37)
 *   - `classifyBucket` open-ended bucket upper-edge (line 29 `b.max == null`)
 *   - `sortBreaksForDisplay` tie-break paths beyond "heaviest bucket first"
 *
 * These guard the contract callers depend on (UI never crashes on an
 * unknown BucketKey emerging from a future schema migration).
 */

import {
  BUCKETS,
  classifyBucket,
  bucketLabel,
  sortBreaksForDisplay,
} from '../../src/domain/pr/buckets';
import type { BucketKey } from '../../src/domain/pr/types';

describe('Slice 13c — pr/buckets edge cases', () => {
  describe('bucketLabel', () => {
    it('returns the canonical label for every known BucketKey', () => {
      for (const b of BUCKETS) {
        expect(bucketLabel(b.key)).toBe(b.label);
      }
    });

    it('falls back to the raw key when given an unknown BucketKey', () => {
      // Simulates a schema migration that adds a 6th bucket the UI
      // hasn't been rebuilt for. The fallback prevents a crash.
      const unknown = 'super_endurance' as unknown as BucketKey;
      expect(bucketLabel(unknown)).toBe('super_endurance');
    });
  });

  describe('classifyBucket — invalid inputs', () => {
    it('returns null for undefined reps', () => {
      expect(classifyBucket(undefined)).toBeNull();
    });

    it('returns null for null reps', () => {
      expect(classifyBucket(null)).toBeNull();
    });

    it('returns null for NaN', () => {
      expect(classifyBucket(NaN)).toBeNull();
    });

    it('returns null for negative Infinity', () => {
      expect(classifyBucket(-Infinity)).toBeNull();
    });

    it('returns null for reps below 1 (0, 0.9)', () => {
      expect(classifyBucket(0)).toBeNull();
      expect(classifyBucket(0.9)).toBeNull();
    });

    it('classifies very large reps as endurance (open-ended top)', () => {
      // The top bucket's max is null; ensure no fallthrough to the final
      // `return null` (line 31) happens for plausible upper values.
      expect(classifyBucket(100)).toBe('endurance');
      expect(classifyBucket(10000)).toBe('endurance');
    });

    it('returns null for Infinity (matches !Number.isFinite guard)', () => {
      // !Number.isFinite(Infinity) === true so the early guard fires.
      expect(classifyBucket(Infinity)).toBeNull();
    });
  });

  describe('sortBreaksForDisplay — tie-break behaviour', () => {
    it('orders weight PR before volume PR within the same bucket', () => {
      const sorted = sortBreaksForDisplay([
        { bucket: 'hypertrophy', type: 'volume' },
        { bucket: 'hypertrophy', type: 'weight' },
      ]);
      expect(sorted.map((b) => b.type)).toEqual(['weight', 'volume']);
    });

    it('preserves heavier-bucket-first ordering across types', () => {
      const sorted = sortBreaksForDisplay([
        { bucket: 'endurance', type: 'weight' }, // rank 1
        { bucket: 'max_strength', type: 'volume' }, // rank 5
        { bucket: 'hypertrophy', type: 'weight' }, // rank 3
      ]);
      expect(sorted.map((b) => b.bucket)).toEqual([
        'max_strength',
        'hypertrophy',
        'endurance',
      ]);
    });

    it('returns a new array rather than mutating input', () => {
      const input = [
        { bucket: 'endurance' as BucketKey, type: 'weight' as const },
        { bucket: 'max_strength' as BucketKey, type: 'weight' as const },
      ];
      const snapshot = [...input];
      const sorted = sortBreaksForDisplay(input);
      expect(input).toEqual(snapshot);
      expect(sorted).not.toBe(input);
    });

    it('handles an empty list without throwing', () => {
      expect(sortBreaksForDisplay([])).toEqual([]);
    });
  });
});
