/**
 * Slice 13c — `prEngine.detectPRBreaks` defensive-guard coverage.
 *
 * The existing `tests/domain/prEngine.test.ts` is comprehensive but
 * leaves the malformed-input guards uncovered (lines 50-51, 60, 70-93
 * in the baseline coverage report). These guards exist because the
 * function is called from UI/repository code where weight_kg can be
 * null after a partial edit and bw_snapshot_kg can be NaN if a parse
 * upstream silently fails. Locking them prevents future refactors
 * from accidentally short-circuiting a real PR.
 */

import { detectPRBreaks } from '../../src/domain/pr/prEngine';
import type { SetForPR } from '../../src/domain/pr/types';

const LOADED_SET = (over: Partial<SetForPR> = {}): SetForPR => ({
  weight_kg: 100,
  reps: 5,
  load_type: 'loaded',
  bw_snapshot_kg: null,
  ...over,
});

const ASSISTED_SET = (over: Partial<SetForPR> = {}): SetForPR => ({
  weight_kg: 30,
  reps: 5,
  load_type: 'assisted',
  bw_snapshot_kg: 75,
  ...over,
});

const EMPTY_DELTA = {
  breaks: [],
  is_all_time_weight_pr: false,
  is_all_time_volume_pr: false,
};

describe('Slice 13c — prEngine defensive guards', () => {
  describe('new_set short-circuits to empty delta when', () => {
    it('reps is null (classifyBucket returns null)', () => {
      const result = detectPRBreaks({
        new_set: LOADED_SET({ reps: null }),
        prior_sets: [],
      });
      expect(result).toEqual(EMPTY_DELTA);
    });

    it('reps is NaN', () => {
      const result = detectPRBreaks({
        new_set: LOADED_SET({ reps: NaN }),
        prior_sets: [],
      });
      expect(result).toEqual(EMPTY_DELTA);
    });

    it('weight_kg is null', () => {
      const result = detectPRBreaks({
        new_set: LOADED_SET({ weight_kg: null }),
        prior_sets: [],
      });
      expect(result).toEqual(EMPTY_DELTA);
    });

    it('weight_kg is NaN', () => {
      const result = detectPRBreaks({
        new_set: LOADED_SET({ weight_kg: NaN }),
        prior_sets: [],
      });
      expect(result).toEqual(EMPTY_DELTA);
    });

    it('weight_kg is Infinity (also not finite)', () => {
      const result = detectPRBreaks({
        new_set: LOADED_SET({ weight_kg: Infinity }),
        prior_sets: [],
      });
      expect(result).toEqual(EMPTY_DELTA);
    });

    it('純徒手 (load_type=bodyweight, weight=0) — pure bodyweight skip', () => {
      const result = detectPRBreaks({
        new_set: LOADED_SET({ load_type: 'bodyweight', weight_kg: 0 }),
        prior_sets: [],
      });
      expect(result).toEqual(EMPTY_DELTA);
    });

    it('assisted without bw_snapshot_kg', () => {
      const result = detectPRBreaks({
        new_set: ASSISTED_SET({ bw_snapshot_kg: null }),
        prior_sets: [],
      });
      expect(result).toEqual(EMPTY_DELTA);
    });

    it('assisted with NaN bw_snapshot_kg (effectiveLoad returns null)', () => {
      // bw_snapshot_kg is non-null so the line-57 guard doesn't fire;
      // the !Number.isFinite check inside effectiveLoad does, producing
      // null at line 60 of prEngine.
      const result = detectPRBreaks({
        new_set: ASSISTED_SET({ bw_snapshot_kg: NaN }),
        prior_sets: [],
      });
      expect(result).toEqual(EMPTY_DELTA);
    });

    it('assisted with effective load ≤ 0 (weight ≥ bw_snapshot)', () => {
      const result = detectPRBreaks({
        new_set: ASSISTED_SET({ weight_kg: 80, bw_snapshot_kg: 75 }),
        prior_sets: [],
      });
      expect(result).toEqual(EMPTY_DELTA);
    });

    it('loaded with negative weight (newVolume === null at line 70)', () => {
      // A loaded set with negative weight survives the finite check (line 51)
      // and effectiveLoad returns the negative number (not null, so line 60
      // passes), but setVolume() returns null via its eff<0 guard — exercising
      // the `if (newVolume == null) return empty` short-circuit specifically.
      const result = detectPRBreaks({
        new_set: LOADED_SET({ weight_kg: -10, reps: 5 }),
        prior_sets: [],
      });
      expect(result).toEqual(EMPTY_DELTA);
    });
  });

  describe('prior_sets loop skips malformed entries', () => {
    // Each test pairs ONE valid new_set against a prior_sets list that
    // is entirely malformed; the new_set should always come out as a
    // first PR (bestWeightInBucket / bestVolumeInBucket stay null).
    const newSet = LOADED_SET();

    it('skips prior set with null reps (line 79 continue)', () => {
      const result = detectPRBreaks({
        new_set: newSet,
        prior_sets: [LOADED_SET({ reps: null })],
      });
      expect(result.breaks).toHaveLength(2);
      expect(result.breaks[0].prior_best).toBeNull();
    });

    it('skips prior set with null weight_kg', () => {
      const result = detectPRBreaks({
        new_set: newSet,
        prior_sets: [LOADED_SET({ weight_kg: null })],
      });
      expect(result.breaks).toHaveLength(2);
      expect(result.breaks[0].prior_best).toBeNull();
    });

    it('skips prior 純徒手 set (load=bodyweight, weight=0)', () => {
      const result = detectPRBreaks({
        new_set: newSet,
        prior_sets: [LOADED_SET({ load_type: 'bodyweight', weight_kg: 0 })],
      });
      expect(result.breaks).toHaveLength(2);
      expect(result.breaks[0].prior_best).toBeNull();
    });

    it('skips prior assisted set without bw_snapshot', () => {
      const result = detectPRBreaks({
        new_set: newSet,
        prior_sets: [ASSISTED_SET({ bw_snapshot_kg: null })],
      });
      expect(result.breaks).toHaveLength(2);
      expect(result.breaks[0].prior_best).toBeNull();
    });

    it('skips prior assisted set with NaN bw_snapshot (effectiveLoad null)', () => {
      const result = detectPRBreaks({
        new_set: newSet,
        prior_sets: [ASSISTED_SET({ bw_snapshot_kg: NaN })],
      });
      expect(result.breaks).toHaveLength(2);
      expect(result.breaks[0].prior_best).toBeNull();
    });

    it('skips prior assisted set with non-positive effective load', () => {
      const result = detectPRBreaks({
        new_set: newSet,
        prior_sets: [ASSISTED_SET({ weight_kg: 80, bw_snapshot_kg: 75 })],
      });
      expect(result.breaks).toHaveLength(2);
      expect(result.breaks[0].prior_best).toBeNull();
    });

    it('skips prior set with invalid reps that makes setVolume null', () => {
      // reps = NaN survives the null check but fails Number.isFinite —
      // both classifyBucket (line 98) and setVolume (line 93) would skip.
      const result = detectPRBreaks({
        new_set: newSet,
        prior_sets: [LOADED_SET({ reps: NaN })],
      });
      expect(result.breaks).toHaveLength(2);
    });

    it('mixed prior list: malformed sets ignored, one valid set sets the baseline', () => {
      const result = detectPRBreaks({
        new_set: LOADED_SET({ weight_kg: 110 }),
        prior_sets: [
          LOADED_SET({ weight_kg: null }),
          LOADED_SET({ reps: null }),
          LOADED_SET({ weight_kg: 100 }), // valid baseline
          LOADED_SET({ load_type: 'bodyweight', weight_kg: 0 }),
        ],
      });
      expect(result.breaks).toHaveLength(2);
      // Weight PR uses the valid prior baseline (100) → not null.
      const weightBreak = result.breaks.find((b) => b.type === 'weight');
      expect(weightBreak?.prior_best).toBe(100);
    });
  });
});
