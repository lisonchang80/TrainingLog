import {
  DEFAULT_VISIBILITY,
  canWriteBwSnapshot,
  latestPerMetric,
  sortByRecordedAt,
  toggleVisibility,
  validateBodyMetric,
} from '../../src/domain/body/bodyMetricManager';
import type { BodyMetric } from '../../src/domain/body/types';
import {
  KG_TO_LB,
  displayToKg,
  formatWeight,
  kgToDisplay,
  kgToLb,
  lbToKg,
  parseWeightInput,
} from '../../src/domain/body/unitConversion';

describe('Module #8 — Body Metric Manager (domain)', () => {
  describe('validateBodyMetric', () => {
    it('rejects empty drafts (all three nulls)', () => {
      expect(
        validateBodyMetric({
          recorded_at: 1,
          bodyweight_kg: null,
          pbf: null,
          smm_kg: null,
        })
      ).toBe('EMPTY');
    });

    it('rejects non-finite recorded_at', () => {
      expect(
        validateBodyMetric({
          recorded_at: NaN,
          bodyweight_kg: 70,
          pbf: null,
          smm_kg: null,
        })
      ).toBe('RECORDED_AT_INVALID');
    });

    it('accepts a single field set', () => {
      expect(
        validateBodyMetric({
          recorded_at: 1,
          bodyweight_kg: 70,
          pbf: null,
          smm_kg: null,
        })
      ).toBeNull();
      expect(
        validateBodyMetric({
          recorded_at: 1,
          bodyweight_kg: null,
          pbf: 18.5,
          smm_kg: null,
        })
      ).toBeNull();
      expect(
        validateBodyMetric({
          recorded_at: 1,
          bodyweight_kg: null,
          pbf: null,
          smm_kg: 32.4,
        })
      ).toBeNull();
    });

    it('rejects out-of-range bodyweight', () => {
      expect(
        validateBodyMetric({
          recorded_at: 1,
          bodyweight_kg: 0,
          pbf: null,
          smm_kg: null,
        })
      ).toBe('BODYWEIGHT_OUT_OF_RANGE');
      expect(
        validateBodyMetric({
          recorded_at: 1,
          bodyweight_kg: 600,
          pbf: null,
          smm_kg: null,
        })
      ).toBe('BODYWEIGHT_OUT_OF_RANGE');
    });

    it('rejects out-of-range PBF', () => {
      expect(
        validateBodyMetric({
          recorded_at: 1,
          bodyweight_kg: null,
          pbf: -1,
          smm_kg: null,
        })
      ).toBe('PBF_OUT_OF_RANGE');
      expect(
        validateBodyMetric({
          recorded_at: 1,
          bodyweight_kg: null,
          pbf: 105,
          smm_kg: null,
        })
      ).toBe('PBF_OUT_OF_RANGE');
    });

    it('rejects out-of-range SMM', () => {
      expect(
        validateBodyMetric({
          recorded_at: 1,
          bodyweight_kg: null,
          pbf: null,
          smm_kg: 0,
        })
      ).toBe('SMM_OUT_OF_RANGE');
      expect(
        validateBodyMetric({
          recorded_at: 1,
          bodyweight_kg: null,
          pbf: null,
          smm_kg: 250,
        })
      ).toBe('SMM_OUT_OF_RANGE');
    });
  });

  describe('sortByRecordedAt', () => {
    const buildSet = (): BodyMetric[] => [
      { id: 'a', recorded_at: 200, bodyweight_kg: 70, pbf: null, smm_kg: null },
      { id: 'b', recorded_at: 100, bodyweight_kg: 71, pbf: null, smm_kg: null },
      { id: 'c', recorded_at: 200, bodyweight_kg: 69, pbf: null, smm_kg: null },
      { id: 'd', recorded_at: 300, bodyweight_kg: 68, pbf: null, smm_kg: null },
    ];

    it('sorts ascending and is stable on ties (multiple readings same day)', () => {
      const out = sortByRecordedAt(buildSet(), 'asc').map((m) => m.id);
      expect(out).toEqual(['b', 'a', 'c', 'd']);
    });

    it('sorts descending', () => {
      const out = sortByRecordedAt(buildSet(), 'desc').map((m) => m.id);
      expect(out).toEqual(['d', 'a', 'c', 'b']);
    });

    it('does not mutate the input array', () => {
      const input = buildSet();
      const original = input.map((m) => m.id);
      sortByRecordedAt(input, 'asc');
      expect(input.map((m) => m.id)).toEqual(original);
    });
  });

  describe('latestPerMetric', () => {
    it('returns latest non-null per field independently', () => {
      const metrics: BodyMetric[] = [
        { id: '1', recorded_at: 100, bodyweight_kg: 70, pbf: 20, smm_kg: 30 },
        { id: '2', recorded_at: 200, bodyweight_kg: 71, pbf: null, smm_kg: null },
        { id: '3', recorded_at: 300, bodyweight_kg: null, pbf: 19, smm_kg: null },
      ];
      expect(latestPerMetric(metrics)).toEqual({
        bodyweight_kg: 71,
        pbf: 19,
        smm_kg: 30,
      });
    });

    it('returns all-nulls for empty input', () => {
      expect(latestPerMetric([])).toEqual({
        bodyweight_kg: null,
        pbf: null,
        smm_kg: null,
      });
    });
  });

  describe('toggleVisibility', () => {
    it('toggles a single series', () => {
      const next = toggleVisibility(DEFAULT_VISIBILITY, 'pbf');
      expect(next.pbf).toBe(false);
      expect(next.bodyweight).toBe(true);
      expect(next.smm).toBe(true);
    });

    it('refuses to leave all three off', () => {
      let v = toggleVisibility(DEFAULT_VISIBILITY, 'bodyweight');
      v = toggleVisibility(v, 'pbf');
      // Now only smm is on. Try to turn smm off.
      const v2 = toggleVisibility(v, 'smm');
      expect(v2).toEqual(v); // unchanged
    });
  });

  describe('canWriteBwSnapshot — pre-session lock', () => {
    it('allows write when idle (pre-session bw confirm)', () => {
      expect(canWriteBwSnapshot({ sessionStatus: 'idle', existingSnapshot: null })).toBe(true);
      expect(canWriteBwSnapshot({ sessionStatus: 'idle', existingSnapshot: 70 })).toBe(true);
    });

    it('locks once session is in_progress with snapshot already set', () => {
      // AC: "bw_snapshot 在 pre-session 階段鎖定不再變動"
      expect(
        canWriteBwSnapshot({ sessionStatus: 'in_progress', existingSnapshot: 70 })
      ).toBe(false);
    });

    it('allows in_progress write only if snapshot is still null (recovery)', () => {
      expect(
        canWriteBwSnapshot({ sessionStatus: 'in_progress', existingSnapshot: null })
      ).toBe(true);
    });

    it('rejects write to ended sessions', () => {
      expect(
        canWriteBwSnapshot({ sessionStatus: 'ended', existingSnapshot: null })
      ).toBe(false);
      expect(
        canWriteBwSnapshot({ sessionStatus: 'ended', existingSnapshot: 70 })
      ).toBe(false);
    });
  });
});

describe('Unit conversion (slice 7)', () => {
  it('KG_TO_LB factor matches kgToLb(1)', () => {
    expect(kgToLb(1)).toBeCloseTo(KG_TO_LB, 6);
  });

  it('round-trips kg → lb → kg within float tolerance', () => {
    for (const kg of [1, 50, 70, 100, 250, 0.5]) {
      expect(lbToKg(kgToLb(kg))).toBeCloseTo(kg, 6);
    }
  });

  it('kgToDisplay returns kg unchanged when unit is kg', () => {
    expect(kgToDisplay(70, 'kg')).toBe(70);
  });

  it('kgToDisplay converts to lb when unit is lb', () => {
    expect(kgToDisplay(70, 'lb')).toBeCloseTo(154.32, 1);
  });

  it('displayToKg is inverse of kgToDisplay', () => {
    for (const kg of [1, 70, 100]) {
      expect(displayToKg(kgToDisplay(kg, 'lb'), 'lb')).toBeCloseTo(kg, 6);
      expect(displayToKg(kgToDisplay(kg, 'kg'), 'kg')).toBe(kg);
    }
  });

  it('formatWeight rounds to 1 decimal + appends unit', () => {
    expect(formatWeight(70, 'kg')).toBe('70.0 kg');
    expect(formatWeight(70.456, 'kg')).toBe('70.5 kg');
    expect(formatWeight(70, 'lb')).toBe('154.3 lb');
  });

  it('parseWeightInput rejects invalid inputs', () => {
    expect(parseWeightInput('', 'kg')).toBeNull();
    expect(parseWeightInput('   ', 'kg')).toBeNull();
    expect(parseWeightInput('abc', 'kg')).toBeNull();
    expect(parseWeightInput('-5', 'kg')).toBeNull();
    expect(parseWeightInput('0', 'kg')).toBeNull();
  });

  it('parseWeightInput returns kg regardless of unit', () => {
    expect(parseWeightInput('70', 'kg')).toBe(70);
    expect(parseWeightInput('154.3236', 'lb')).toBeCloseTo(70, 2);
  });
});
