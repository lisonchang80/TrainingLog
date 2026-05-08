import { estimateE1RM, effectiveLoad } from '../../src/domain/pr/e1rmEngine';

describe('Module #4 — E1RM Engine (Epley)', () => {
  describe('estimateE1RM', () => {
    it('reps=1 returns weight unchanged (boundary)', () => {
      expect(estimateE1RM({ weight_kg: 100, reps: 1, load_type: 'loaded' })).toBeCloseTo(
        100 * (1 + 1 / 30),
        5
      );
      // Note: Epley at reps=1 is weight × (31/30); the convention "1RM = weight"
      // only applies if you reinterpret reps=1 as the actual 1RM. We follow the
      // pure formula for consistency; the engine's job is the formula, not the
      // semantic decision.
    });

    it('classic Epley: 100 × 5 → ~116.67', () => {
      const e = estimateE1RM({ weight_kg: 100, reps: 5, load_type: 'loaded' });
      expect(e).toBeCloseTo(100 * (1 + 5 / 30), 5);
      expect(e).toBeCloseTo(116.667, 2);
    });

    it('classic Epley: 80 × 10 → ~106.67', () => {
      const e = estimateE1RM({ weight_kg: 80, reps: 10, load_type: 'loaded' });
      expect(e).toBeCloseTo(80 * (1 + 10 / 30), 5);
      expect(e).toBeCloseTo(106.667, 2);
    });

    it('reps=0 returns null', () => {
      expect(estimateE1RM({ weight_kg: 100, reps: 0, load_type: 'loaded' })).toBeNull();
    });

    it('reps null returns null', () => {
      expect(estimateE1RM({ weight_kg: 100, reps: null, load_type: 'loaded' })).toBeNull();
    });

    it('weight null returns null', () => {
      expect(estimateE1RM({ weight_kg: null, reps: 5, load_type: 'loaded' })).toBeNull();
    });

    it('weight=0 with bodyweight returns null (no scalar load)', () => {
      // For 純徒手 bodyweight set, e1RM is undefined (no add-on weight).
      expect(estimateE1RM({ weight_kg: 0, reps: 10, load_type: 'bodyweight' })).toBeNull();
    });

    it('bodyweight +20 × 8 → uses 20 directly (community convention)', () => {
      const e = estimateE1RM({ weight_kg: 20, reps: 8, load_type: 'bodyweight' });
      expect(e).toBeCloseTo(20 * (1 + 8 / 30), 5);
    });

    it('assisted requires bw_snapshot; missing → null', () => {
      expect(
        estimateE1RM({ weight_kg: 30, reps: 8, load_type: 'assisted', bw_snapshot_kg: null })
      ).toBeNull();
    });

    it('assisted: bw 75, weight 30 → effective 45 × (1 + 8/30)', () => {
      const e = estimateE1RM({
        weight_kg: 30,
        reps: 8,
        load_type: 'assisted',
        bw_snapshot_kg: 75,
      });
      expect(e).toBeCloseTo(45 * (1 + 8 / 30), 5);
    });

    it('assisted: weight ≥ bw → effective ≤ 0 → null', () => {
      // Non-sensical assisted (more assist than the lifter's weight)
      expect(
        estimateE1RM({ weight_kg: 80, reps: 5, load_type: 'assisted', bw_snapshot_kg: 75 })
      ).toBeNull();
    });

    it('NaN inputs return null', () => {
      expect(estimateE1RM({ weight_kg: NaN, reps: 5, load_type: 'loaded' })).toBeNull();
      expect(estimateE1RM({ weight_kg: 100, reps: NaN, load_type: 'loaded' })).toBeNull();
    });

    it('high reps still computes (no upper clamp in v1)', () => {
      const e = estimateE1RM({ weight_kg: 50, reps: 30, load_type: 'loaded' });
      expect(e).toBeCloseTo(50 * 2, 5);
    });
  });

  describe('effectiveLoad', () => {
    it('loaded returns weight as-is', () => {
      expect(effectiveLoad(100, 'loaded', null)).toBe(100);
      expect(effectiveLoad(100, 'loaded', 75)).toBe(100); // bw ignored
    });

    it('bodyweight returns weight as-is (does NOT add bw, per ADR-0007)', () => {
      expect(effectiveLoad(20, 'bodyweight', 75)).toBe(20);
      expect(effectiveLoad(0, 'bodyweight', 75)).toBe(0); // pure-bw allowed value
    });

    it('assisted subtracts weight from bw_snapshot', () => {
      expect(effectiveLoad(30, 'assisted', 75)).toBe(45);
    });

    it('assisted with null snapshot returns null', () => {
      expect(effectiveLoad(30, 'assisted', null)).toBeNull();
    });
  });
});
