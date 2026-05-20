import { setVolume } from '../../src/domain/pr/volumeEngine';

describe('Module #3 — Volume Engine (load_type asymmetry)', () => {
  describe('A loaded', () => {
    it('weight × reps', () => {
      expect(setVolume({ weight_kg: 80, reps: 10, load_type: 'loaded' })).toBe(800);
      expect(setVolume({ weight_kg: 100, reps: 5, load_type: 'loaded' })).toBe(500);
    });

    it('bw_snapshot is ignored', () => {
      expect(
        setVolume({ weight_kg: 80, reps: 10, load_type: 'loaded', bw_snapshot_kg: 75 })
      ).toBe(800);
    });
  });

  describe('B bodyweight', () => {
    it('weight × reps (no bw addition)', () => {
      // +10kg × 8 → 80
      expect(setVolume({ weight_kg: 10, reps: 8, load_type: 'bodyweight' })).toBe(80);
    });

    it('pure bodyweight (weight=0) returns 0 — valid set, zero scalar volume', () => {
      // Per ADR-0007: 純徒手 set is valid but contributes 0 to volume math.
      // PR check skips it separately; volume here is 0 not null.
      expect(setVolume({ weight_kg: 0, reps: 10, load_type: 'bodyweight' })).toBe(0);
    });

    it('with bw_snapshot does NOT add bw (community convention)', () => {
      expect(
        setVolume({ weight_kg: 10, reps: 8, load_type: 'bodyweight', bw_snapshot_kg: 75 })
      ).toBe(80);
    });
  });

  describe('C assisted', () => {
    it('(bw_snapshot − weight) × reps', () => {
      // bw 75, assist 30, 8 reps → effective 45 × 8 = 360
      expect(
        setVolume({ weight_kg: 30, reps: 8, load_type: 'assisted', bw_snapshot_kg: 75 })
      ).toBe(360);
    });

    it('null bw_snapshot returns null (volume undefined)', () => {
      expect(
        setVolume({ weight_kg: 30, reps: 8, load_type: 'assisted', bw_snapshot_kg: null })
      ).toBeNull();
    });

    it('weight ≥ bw_snapshot returns null (effective load ≤ 0)', () => {
      // weight 80, bw 75 → effective -5 → null (nonsense input)
      expect(
        setVolume({ weight_kg: 80, reps: 5, load_type: 'assisted', bw_snapshot_kg: 75 })
      ).toBeNull();
      expect(
        setVolume({ weight_kg: 75, reps: 5, load_type: 'assisted', bw_snapshot_kg: 75 })
      ).toBeNull();
    });
  });

  describe('invalid inputs', () => {
    it('reps null returns null', () => {
      expect(setVolume({ weight_kg: 80, reps: null, load_type: 'loaded' })).toBeNull();
    });

    it('reps 0 returns null', () => {
      expect(setVolume({ weight_kg: 80, reps: 0, load_type: 'loaded' })).toBeNull();
    });

    it('weight null returns null', () => {
      expect(setVolume({ weight_kg: null, reps: 5, load_type: 'loaded' })).toBeNull();
    });

    it('NaN inputs return null', () => {
      expect(setVolume({ weight_kg: NaN, reps: 5, load_type: 'loaded' })).toBeNull();
      expect(setVolume({ weight_kg: 80, reps: NaN, load_type: 'loaded' })).toBeNull();
    });
  });

});
