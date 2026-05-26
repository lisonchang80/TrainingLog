/**
 * Slice 13c — `repBucketFilter` defensive-label coverage.
 *
 * Existing `tests/domain/repBucketFilter.test.ts` covers labels for the
 * known chip values. Lines 33 and 44 (the `BUCKETS.find(...) ?? chip`
 * fallbacks in `repRangeLabel` + `bucketDomainLabel`) only fire when an
 * unknown chip key reaches the function — e.g. a stored chip preference
 * from a future schema migration. Lock that fallback so the UI never
 * renders `undefined`.
 *
 * Also pins:
 *   - `matchesChip` invalid-reps cases (null/undefined/NaN) — `'all'`
 *     matches all, specific bucket matches none.
 *   - `filterSetsByBucket` empty-array behaviour.
 */

import {
  REP_BUCKET_CHIPS,
  repRangeLabel,
  bucketDomainLabel,
  matchesChip,
  filterSetsByBucket,
  type RepBucketChip,
} from '../../src/domain/exercise/repBucketFilter';

const UNKNOWN_CHIP = 'super_endurance' as unknown as RepBucketChip;

describe('Slice 13c — repBucketFilter edge cases', () => {
  describe('repRangeLabel — unknown chip fallback', () => {
    it('returns the raw chip string when key is not in BUCKETS', () => {
      // Defensive against future BucketKey additions / stored prefs.
      expect(repRangeLabel(UNKNOWN_CHIP)).toBe('super_endurance');
    });

    it('still renders "全部" for the all chip (regression guard)', () => {
      expect(repRangeLabel('all')).toBe('全部');
    });
  });

  describe('bucketDomainLabel — unknown chip fallback', () => {
    it('returns the raw chip string when key is not in BUCKETS', () => {
      expect(bucketDomainLabel(UNKNOWN_CHIP)).toBe('super_endurance');
    });

    it('still renders "全部" for the all chip (regression guard)', () => {
      expect(bucketDomainLabel('all')).toBe('全部');
    });
  });

  describe('matchesChip — invalid reps boundary', () => {
    it('"all" matches null reps', () => {
      expect(matchesChip(null, 'all')).toBe(true);
    });

    it('"all" matches undefined reps', () => {
      expect(matchesChip(undefined, 'all')).toBe(true);
    });

    it('"all" matches NaN reps', () => {
      expect(matchesChip(NaN, 'all')).toBe(true);
    });

    it('specific bucket rejects null reps', () => {
      expect(matchesChip(null, 'hypertrophy')).toBe(false);
    });

    it('specific bucket rejects NaN reps', () => {
      expect(matchesChip(NaN, 'strength')).toBe(false);
    });

    it('specific bucket rejects unknown chip even with valid reps', () => {
      // classifyBucket(5) === 'strength' which !== UNKNOWN_CHIP
      expect(matchesChip(5, UNKNOWN_CHIP)).toBe(false);
    });
  });

  describe('filterSetsByBucket — empty input', () => {
    it('returns an empty array unchanged for "all"', () => {
      const out = filterSetsByBucket([], 'all');
      expect(out).toEqual([]);
    });

    it('returns an empty array for a specific bucket', () => {
      const out = filterSetsByBucket([], 'max_strength');
      expect(out).toEqual([]);
    });

    it('"all" returns a shallow copy (not the same reference)', () => {
      const input: { reps: number | null }[] = [{ reps: 5 }, { reps: 10 }];
      const out = filterSetsByBucket(input, 'all');
      expect(out).toEqual(input);
      expect(out).not.toBe(input);
    });
  });

  describe('REP_BUCKET_CHIPS — shape', () => {
    it('is length 6 (all + 5 buckets) and starts with all', () => {
      // This duplicates the existing layout test but guards against a
      // re-ordering that would silently break the chip row.
      expect(REP_BUCKET_CHIPS.length).toBe(6);
      expect(REP_BUCKET_CHIPS[0]).toBe('all');
    });
  });
});
