import {
  resolveSetDefaults,
  type SetDefaultsInput,
} from '../../src/domain/set/resolveSetDefaults';

describe('resolveSetDefaults', () => {
  it('returns starter defaults (0 / 10) when both inputs are null', () => {
    expect(resolveSetDefaults(null, null)).toEqual({ weight_kg: 0, reps: 10 });
  });

  it('takes the last-set-in-session values when present', () => {
    const last: SetDefaultsInput = { weight_kg: 47.5, reps: 8 };
    expect(resolveSetDefaults(last, null)).toEqual({ weight_kg: 47.5, reps: 8 });
  });

  it('prefers last-set-in-session over historical when both present', () => {
    const last: SetDefaultsInput = { weight_kg: 60, reps: 5 };
    const historical: SetDefaultsInput = { weight_kg: 40, reps: 12 };
    expect(resolveSetDefaults(last, historical)).toEqual({
      weight_kg: 60,
      reps: 5,
    });
  });

  it('uses historical only when there is no last-set-in-session', () => {
    const historical: SetDefaultsInput = { weight_kg: 42.5, reps: 6 };
    expect(resolveSetDefaults(null, historical)).toEqual({
      weight_kg: 42.5,
      reps: 6,
    });
  });

  it('falls back to 0 weight / 10 reps when last-set fields are null', () => {
    const last: SetDefaultsInput = { weight_kg: null, reps: null };
    expect(resolveSetDefaults(last, null)).toEqual({ weight_kg: 0, reps: 10 });
  });

  it('falls back to 0 weight / 10 reps when historical fields are null', () => {
    const historical: SetDefaultsInput = { weight_kg: null, reps: null };
    expect(resolveSetDefaults(null, historical)).toEqual({
      weight_kg: 0,
      reps: 10,
    });
  });

  it('keeps a non-null weight even when reps is null (last-set)', () => {
    const last: SetDefaultsInput = { weight_kg: 80, reps: null };
    expect(resolveSetDefaults(last, null)).toEqual({ weight_kg: 80, reps: 10 });
  });

  it('clamps reps to 10 when reps is zero', () => {
    const last: SetDefaultsInput = { weight_kg: 50, reps: 0 };
    expect(resolveSetDefaults(last, null)).toEqual({ weight_kg: 50, reps: 10 });
  });

  it('clamps reps to 10 when reps is negative', () => {
    const last: SetDefaultsInput = { weight_kg: 50, reps: -3 };
    expect(resolveSetDefaults(last, null)).toEqual({ weight_kg: 50, reps: 10 });
  });

  it('clamps reps to 10 when reps is non-integer', () => {
    const last: SetDefaultsInput = { weight_kg: 50, reps: 8.5 };
    expect(resolveSetDefaults(last, null)).toEqual({ weight_kg: 50, reps: 10 });
  });

  it('clamps a non-integer historical reps to 10', () => {
    const historical: SetDefaultsInput = { weight_kg: 30, reps: 7.25 };
    expect(resolveSetDefaults(null, historical)).toEqual({
      weight_kg: 30,
      reps: 10,
    });
  });

  it('preserves a valid positive integer reps and fractional weight', () => {
    const last: SetDefaultsInput = { weight_kg: 22.5, reps: 15 };
    expect(resolveSetDefaults(last, null)).toEqual({
      weight_kg: 22.5,
      reps: 15,
    });
  });
});
