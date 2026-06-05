/**
 * Unit conversion edge coverage (src/domain/body/unitConversion.ts).
 *
 * Storage is always kg; this module is the single source of truth for kg↔lb
 * display conversion. Reached only indirectly via settingsBodyweightRow before
 * this file — these tests pin the conversion factor, rounding behaviour, and
 * the 0 / negative / large-value / precision edges directly.
 *
 * Overnight 2026-05-30 — agent C (DB/domain edge tests).
 */

import {
  KG_TO_LB,
  kgToLb,
  lbToKg,
  kgToDisplay,
  displayToKg,
  displayWeight,
  formatWeight,
  parseWeightInput,
} from '../../src/domain/body/unitConversion';

describe('unitConversion — KG_TO_LB factor', () => {
  it('exposes the NIST-derived 8-sig-fig factor', () => {
    expect(KG_TO_LB).toBe(2.20462262);
  });
});

describe('kgToLb', () => {
  it('multiplies by the canonical factor', () => {
    expect(kgToLb(1)).toBe(2.20462262);
    expect(kgToLb(100)).toBeCloseTo(220.462262, 6);
  });

  it('returns 0 for 0 kg', () => {
    expect(kgToLb(0)).toBe(0);
  });

  it('passes negative inputs straight through the math (no clamping)', () => {
    // SUSPECT-NOT: module intentionally does no validation here; parseWeightInput
    // is the guard. A negative kg simply maps to a negative lb.
    expect(kgToLb(-10)).toBeCloseTo(-22.0462262, 6);
  });

  it('handles large gym-scale + beyond values without overflow', () => {
    expect(kgToLb(500)).toBeCloseTo(1102.31131, 4);
    expect(kgToLb(1_000_000)).toBeCloseTo(2_204_622.62, 2);
  });
});

describe('lbToKg', () => {
  it('divides by the canonical factor', () => {
    expect(lbToKg(2.20462262)).toBeCloseTo(1, 12);
    expect(lbToKg(220.462262)).toBeCloseTo(100, 6);
  });

  it('returns 0 for 0 lb', () => {
    expect(lbToKg(0)).toBe(0);
  });

  it('passes negative inputs through', () => {
    expect(lbToKg(-22.0462262)).toBeCloseTo(-10, 6);
  });
});

describe('kg → lb → kg round-trip stability', () => {
  // Float division then multiplication is not bit-exact; assert it stays within
  // sub-milligram tolerance across the tested gym range and beyond.
  it.each([0, 0.5, 20, 72.5, 100, 222.22, 500, 1000])(
    'round-trips %d kg within 1e-9',
    (kg) => {
      expect(lbToKg(kgToLb(kg))).toBeCloseTo(kg, 9);
    }
  );

  it('round-trips a negative value too', () => {
    expect(lbToKg(kgToLb(-37.3))).toBeCloseTo(-37.3, 9);
  });
});

describe('kgToDisplay / displayToKg', () => {
  it('kg unit is identity in both directions', () => {
    expect(kgToDisplay(80, 'kg')).toBe(80);
    expect(displayToKg(80, 'kg')).toBe(80);
    expect(kgToDisplay(0, 'kg')).toBe(0);
    expect(displayToKg(-5, 'kg')).toBe(-5);
  });

  it('lb unit converts via the canonical factor', () => {
    expect(kgToDisplay(100, 'lb')).toBeCloseTo(220.462262, 6);
    expect(displayToKg(220.462262, 'lb')).toBeCloseTo(100, 6);
  });

  it('display ↔ kg round-trips in lb mode', () => {
    const kg = 64.2;
    expect(displayToKg(kgToDisplay(kg, 'lb'), 'lb')).toBeCloseTo(kg, 9);
  });
});

describe('displayWeight (F4 — editable cell / keypad value)', () => {
  it('kg unit is exact identity (zero-regression, no rounding applied)', () => {
    expect(displayWeight(60, 'kg')).toBe(60);
    expect(displayWeight(62.55, 'kg')).toBe(62.55); // NOT rounded for kg
    expect(displayWeight(0, 'kg')).toBe(0);
    expect(displayWeight(-5, 'kg')).toBe(-5);
  });

  it('lb unit converts and rounds to 1 decimal', () => {
    expect(displayWeight(100, 'lb')).toBe(220.5); // 220.462262 → 220.5
    expect(displayWeight(60, 'lb')).toBe(132.3); // 132.277... → 132.3
    expect(displayWeight(0, 'lb')).toBe(0);
  });

  it('lb round-trips cleanly for whole-lb entries (no field clobber)', () => {
    // A user enters 225 lb → stored kg = lbToKg(225); displayWeight back must
    // reproduce 225.0 so the inline field/useEffect guard does not overwrite it.
    const kg = lbToKg(225);
    expect(displayWeight(kg, 'lb')).toBe(225);
  });
});

describe('formatWeight', () => {
  it('rounds to 1 decimal and appends the unit label (kg)', () => {
    expect(formatWeight(70, 'kg')).toBe('70.0 kg');
    expect(formatWeight(72.55, 'kg')).toBe('72.5 kg'); // toFixed banker-free round
    expect(formatWeight(0, 'kg')).toBe('0.0 kg');
  });

  it('converts then formats in lb mode', () => {
    expect(formatWeight(70, 'lb')).toBe('154.3 lb');
    expect(formatWeight(0, 'lb')).toBe('0.0 lb');
  });

  it('formats negative values with the sign preserved', () => {
    expect(formatWeight(-5, 'kg')).toBe('-5.0 kg');
  });

  it('formats large values', () => {
    expect(formatWeight(500, 'kg')).toBe('500.0 kg');
    // 500 kg → 1102.31131 lb → '1102.3 lb'
    expect(formatWeight(500, 'lb')).toBe('1102.3 lb');
  });
});

describe('parseWeightInput', () => {
  it('parses a plain positive kg value', () => {
    expect(parseWeightInput('72.5', 'kg')).toBe(72.5);
  });

  it('trims surrounding whitespace', () => {
    expect(parseWeightInput('  60  ', 'kg')).toBe(60);
  });

  it('converts an lb entry to kg', () => {
    const kg = parseWeightInput('160', 'lb');
    expect(kg).not.toBeNull();
    expect(kg!).toBeCloseTo(72.5747792, 5);
  });

  it('returns null for blank / whitespace-only input', () => {
    expect(parseWeightInput('', 'kg')).toBeNull();
    expect(parseWeightInput('   ', 'kg')).toBeNull();
  });

  it('returns null for non-numeric input', () => {
    expect(parseWeightInput('abc', 'kg')).toBeNull();
    expect(parseWeightInput('12abc', 'kg')).toBeNull();
  });

  it('returns null for zero and negative (non-positive guard)', () => {
    expect(parseWeightInput('0', 'kg')).toBeNull();
    expect(parseWeightInput('-5', 'kg')).toBeNull();
    expect(parseWeightInput('0', 'lb')).toBeNull();
  });

  it('returns null for Infinity / NaN literals', () => {
    expect(parseWeightInput('Infinity', 'kg')).toBeNull();
    expect(parseWeightInput('NaN', 'kg')).toBeNull();
  });

  it('accepts a large positive value', () => {
    expect(parseWeightInput('500', 'kg')).toBe(500);
  });
});
