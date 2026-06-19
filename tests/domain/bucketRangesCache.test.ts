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

  // ===================================================================
  // Slice 17 hardening (2026-06-16) — boundary + adversarial coverage.
  // All cases inherit the top-level `afterEach(resetBucketRanges)`.
  // ===================================================================

  describe('classifyBucket — exact boundaries (defaults)', () => {
    // Default ladder: 1–3 / 4–6 / 7–10 / 11–15 / 16+.
    it('classifies each bucket min, max, and max+1 (the next bucket min) correctly', () => {
      // max_strength 1–3
      expect(classifyBucket(1)).toBe('max_strength'); // min
      expect(classifyBucket(3)).toBe('max_strength'); // max
      expect(classifyBucket(4)).toBe('strength'); //     max+1 → next bucket min
      // strength 4–6
      expect(classifyBucket(4)).toBe('strength'); // min
      expect(classifyBucket(6)).toBe('strength'); // max
      expect(classifyBucket(7)).toBe('hypertrophy'); // max+1
      // hypertrophy 7–10
      expect(classifyBucket(7)).toBe('hypertrophy'); // min
      expect(classifyBucket(10)).toBe('hypertrophy'); // max
      expect(classifyBucket(11)).toBe('muscle_endurance'); // max+1
      // muscle_endurance 11–15
      expect(classifyBucket(11)).toBe('muscle_endurance'); // min
      expect(classifyBucket(15)).toBe('muscle_endurance'); // max
      expect(classifyBucket(16)).toBe('endurance'); // max+1
      // endurance 16+ (open-ended top — no max+1 boundary)
      expect(classifyBucket(16)).toBe('endurance'); // min
      expect(classifyBucket(10_000)).toBe('endurance'); // far above
    });

    it('returns null for reps below the first bucket min or otherwise invalid', () => {
      expect(classifyBucket(0)).toBeNull();
      expect(classifyBucket(-1)).toBeNull();
      expect(classifyBucket(0.5)).toBeNull(); // < 1
      expect(classifyBucket(null)).toBeNull();
      expect(classifyBucket(undefined)).toBeNull();
      expect(classifyBucket(NaN)).toBeNull();
      expect(classifyBucket(Infinity)).toBeNull();
      expect(classifyBucket(-Infinity)).toBeNull();
    });
  });

  describe('classifyBucket — exact boundaries after a sequence of edits', () => {
    it('reflects boundaries after applying VALID_EDIT (1–5 / 6–8 / 9–12 / 13–20 / 21+)', () => {
      applyBucketRanges(VALID_EDIT);
      // max_strength 1–5
      expect(classifyBucket(1)).toBe('max_strength');
      expect(classifyBucket(5)).toBe('max_strength');
      expect(classifyBucket(6)).toBe('strength'); // max+1
      // strength 6–8
      expect(classifyBucket(8)).toBe('strength');
      expect(classifyBucket(9)).toBe('hypertrophy'); // max+1
      // hypertrophy 9–12
      expect(classifyBucket(12)).toBe('hypertrophy');
      expect(classifyBucket(13)).toBe('muscle_endurance'); // max+1
      // muscle_endurance 13–20
      expect(classifyBucket(20)).toBe('muscle_endurance');
      expect(classifyBucket(21)).toBe('endurance'); // max+1
      // endurance 21+
      expect(classifyBucket(21)).toBe('endurance');
      expect(classifyBucket(99)).toBe('endurance');
    });

    it('reflects the LAST edit after a sequence of edits (live cache, no stale boundary leakage)', () => {
      const second: BucketBoundary[] = [
        { key: 'max_strength', min: 1, max: 1 }, // single-rep
        { key: 'strength', min: 2, max: 4 },
        { key: 'hypertrophy', min: 5, max: 9 },
        { key: 'muscle_endurance', min: 10, max: 14 },
        { key: 'endurance', min: 15, max: null },
      ];
      applyBucketRanges(VALID_EDIT); // first edit
      applyBucketRanges(second); // second edit overrides
      // Boundaries reflect ONLY the second edit.
      expect(classifyBucket(1)).toBe('max_strength'); // 1–1
      expect(classifyBucket(2)).toBe('strength'); //      2–4 (was max_strength under VALID_EDIT)
      expect(classifyBucket(5)).toBe('hypertrophy'); //   5–9
      expect(classifyBucket(14)).toBe('muscle_endurance'); // 10–14
      expect(classifyBucket(15)).toBe('endurance'); //    15+
    });

    it('an edit→invalid sequence resets to defaults (classify reflects defaults)', () => {
      applyBucketRanges(VALID_EDIT);
      applyBucketRanges(undefined); // invalid → reset
      expect(classifyBucket(5)).toBe('strength'); // default 4–6, not VALID_EDIT max_strength
      expect(classifyBucket(3)).toBe('max_strength');
    });
  });

  describe('classifyBucket — full-range contiguity + total coverage', () => {
    // Every rep in 1..60 must land in EXACTLY one bucket (no gaps → no null,
    // no overlaps → first-match wins is unambiguous because validate enforces
    // contiguity). Run under defaults AND a valid edit.
    const assertContiguousCoverage = () => {
      for (let reps = 1; reps <= 60; reps++) {
        const bucket = classifyBucket(reps);
        expect(bucket).not.toBeNull();
        // Count how many BUCKETS ranges contain `reps` — must be exactly 1.
        const matches = BUCKETS.filter(
          (b) => reps >= b.min && (b.max == null || reps <= b.max),
        );
        expect(matches).toHaveLength(1);
        expect(bucket).toBe(matches[0].key);
      }
    };

    it('covers 1..60 contiguously under defaults', () => {
      assertContiguousCoverage();
    });

    it('covers 1..60 contiguously after a valid edit', () => {
      applyBucketRanges(VALID_EDIT);
      assertContiguousCoverage();
    });
  });

  describe('validateBucketBoundaries — adversarial inputs', () => {
    const clone = () => VALID_EDIT.map((b) => ({ ...b }));

    it('rejects a duplicate key (two muscle_endurance, missing endurance)', () => {
      const dup = clone();
      // Replace the last (endurance) key with a duplicate of muscle_endurance.
      dup[4] = { key: 'muscle_endurance', min: 21, max: null };
      expect(validateBucketBoundaries(dup)).toBe(false);
    });

    it('rejects a NaN min', () => {
      const bad = clone();
      bad[1].min = NaN;
      expect(validateBucketBoundaries(bad)).toBe(false);
    });

    it('rejects a NaN max', () => {
      const bad = clone();
      bad[1].max = NaN;
      expect(validateBucketBoundaries(bad)).toBe(false);
    });

    it('rejects a float (non-integer) min', () => {
      const bad = clone();
      bad[0] = { key: 'max_strength', min: 1.5, max: 5 };
      expect(validateBucketBoundaries(bad)).toBe(false);
    });

    it('rejects a float (non-integer) max', () => {
      const bad = clone();
      bad[0].max = 5.5;
      expect(validateBucketBoundaries(bad)).toBe(false);
    });

    it('rejects a negative min', () => {
      const bad = clone();
      bad[0] = { key: 'max_strength', min: -1, max: 5 };
      expect(validateBucketBoundaries(bad)).toBe(false);
    });

    it('rejects a negative max', () => {
      const bad = clone();
      bad[0].max = -3;
      expect(validateBucketBoundaries(bad)).toBe(false);
    });

    it('rejects a missing key (only 4 entries even with correct prefix order)', () => {
      // Drop the hypertrophy entry → length 4, and keys no longer == ORDER.
      const missing = [clone()[0], clone()[1], clone()[3], clone()[4]];
      expect(validateBucketBoundaries(missing)).toBe(false);
    });

    it('rejects an extra / unknown key (length 6)', () => {
      const extra = [...clone(), { key: 'endurance' as const, min: 99, max: null }];
      expect(validateBucketBoundaries(extra)).toBe(false);
    });

    it('accepts a min===max single-rep bucket (valid degenerate range)', () => {
      const single: BucketBoundary[] = [
        { key: 'max_strength', min: 1, max: 1 }, // single rep
        { key: 'strength', min: 2, max: 4 },
        { key: 'hypertrophy', min: 5, max: 9 },
        { key: 'muscle_endurance', min: 10, max: 14 },
        { key: 'endurance', min: 15, max: null },
      ];
      expect(validateBucketBoundaries(single)).toBe(true);
    });

    it('rejects a non-null max on the last (open-ended) bucket', () => {
      const bad = clone();
      bad[4] = { key: 'endurance', min: 21, max: 30 };
      expect(validateBucketBoundaries(bad)).toBe(false);
    });

    it('rejects the first bucket min ≠ 1', () => {
      const bad = clone();
      bad[0] = { key: 'max_strength', min: 0, max: 5 }; // min 0 (also < 1 → rejected anyway)
      expect(validateBucketBoundaries(bad)).toBe(false);
      const bad2 = clone();
      bad2[0] = { key: 'max_strength', min: 2, max: 5 }; // starts at 2, leaves rep 1 uncovered
      expect(validateBucketBoundaries(bad2)).toBe(false);
    });

    it('rejects a null (non-last) max in the middle of the ladder', () => {
      const bad = clone();
      bad[2] = { key: 'hypertrophy', min: 9, max: null };
      expect(validateBucketBoundaries(bad)).toBe(false);
    });
  });

  describe('applyBucketRanges — idempotence + round-trip', () => {
    it('applying the same valid edit twice yields identical boundaries (idempotent)', () => {
      applyBucketRanges(VALID_EDIT);
      const afterFirst = getBucketBoundaries();
      applyBucketRanges(VALID_EDIT);
      const afterSecond = getBucketBoundaries();
      expect(afterSecond).toEqual(afterFirst);
      expect(afterSecond).toEqual(VALID_EDIT);
    });

    it('applying defaults (via getBucketBoundaries round-trip) is a no-op', () => {
      const defaults = getBucketBoundaries();
      applyBucketRanges(defaults);
      expect(getBucketBoundaries()).toEqual(defaults);
    });

    it('getBucketBoundaries round-trips: edit → read → re-apply → identical, then reset restores defaults', () => {
      applyBucketRanges(VALID_EDIT);
      const snapshot = getBucketBoundaries();
      // Re-applying its own output must be stable.
      applyBucketRanges(snapshot);
      expect(getBucketBoundaries()).toEqual(snapshot);
      // Reset returns to canonical defaults (label-free shape).
      resetBucketRanges();
      expect(getBucketBoundaries()).toEqual(
        DEFAULT_BUCKETS.map((b) => ({ key: b.key, min: b.min, max: b.max })),
      );
    });

    it('an applied edit does not mutate the caller-supplied input array', () => {
      const input = VALID_EDIT.map((b) => ({ ...b }));
      const before = JSON.stringify(input);
      applyBucketRanges(input);
      // The cache must hold its OWN copies — editing the cache later (via
      // another apply) must not have retroactively changed `input`.
      applyBucketRanges([
        { key: 'max_strength', min: 1, max: 1 },
        { key: 'strength', min: 2, max: 4 },
        { key: 'hypertrophy', min: 5, max: 9 },
        { key: 'muscle_endurance', min: 10, max: 14 },
        { key: 'endurance', min: 15, max: null },
      ]);
      expect(JSON.stringify(input)).toBe(before);
    });
  });
});
