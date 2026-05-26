/**
 * Slice 13c — `validateRecordSet` coverage.
 *
 * Pure UI-side validation for recording a Set. The function predates the
 * service-extraction wave but had no jest coverage; this suite locks every
 * branch so the live-feedback message strings can be refactored safely.
 *
 * Branches covered (matches `validateRecordSet.ts` line-for-line):
 *   1. exercise_id falsy        → 'Exercise is required'
 *   2. weight_kg NaN            → 'Weight must be a non-negative number'
 *   3. weight_kg Infinity       → 'Weight must be a non-negative number'
 *   4. weight_kg negative       → 'Weight must be a non-negative number'
 *   5. weight_kg = 0            → valid (bodyweight sets)
 *   6. reps non-integer         → 'Reps must be a positive integer'
 *   7. reps = 0                 → 'Reps must be a positive integer'
 *   8. reps negative            → 'Reps must be a positive integer'
 *   9. happy path               → null
 */

import { validateRecordSet } from '../../src/domain/set/validateRecordSet';
import type { RecordSetInput } from '../../src/domain/set/types';

const BASE: RecordSetInput = {
  exercise_id: 'ex-1',
  weight_kg: 80,
  reps: 5,
};

describe('Slice 13c — validateRecordSet', () => {
  it('returns null for a valid loaded set', () => {
    expect(validateRecordSet(BASE)).toBeNull();
  });

  it('accepts weight_kg = 0 (純徒手 / bodyweight set)', () => {
    expect(validateRecordSet({ ...BASE, weight_kg: 0 })).toBeNull();
  });

  it('rejects empty exercise_id', () => {
    expect(validateRecordSet({ ...BASE, exercise_id: '' })).toBe(
      'Exercise is required'
    );
  });

  it('rejects undefined-coerced exercise_id', () => {
    // Caller might pass an empty string from a controlled input; covers the
    // !exercise_id falsy branch which also catches null/undefined.
    expect(
      validateRecordSet({ ...BASE, exercise_id: undefined as unknown as string })
    ).toBe('Exercise is required');
  });

  it('rejects NaN weight_kg', () => {
    expect(validateRecordSet({ ...BASE, weight_kg: NaN })).toBe(
      'Weight must be a non-negative number'
    );
  });

  it('rejects Infinity weight_kg', () => {
    expect(validateRecordSet({ ...BASE, weight_kg: Infinity })).toBe(
      'Weight must be a non-negative number'
    );
  });

  it('rejects negative weight_kg', () => {
    expect(validateRecordSet({ ...BASE, weight_kg: -1 })).toBe(
      'Weight must be a non-negative number'
    );
  });

  it('rejects non-integer reps', () => {
    expect(validateRecordSet({ ...BASE, reps: 5.5 })).toBe(
      'Reps must be a positive integer'
    );
  });

  it('rejects reps = 0', () => {
    expect(validateRecordSet({ ...BASE, reps: 0 })).toBe(
      'Reps must be a positive integer'
    );
  });

  it('rejects negative reps', () => {
    expect(validateRecordSet({ ...BASE, reps: -3 })).toBe(
      'Reps must be a positive integer'
    );
  });

  it('rejects NaN reps (also a non-integer)', () => {
    expect(validateRecordSet({ ...BASE, reps: NaN })).toBe(
      'Reps must be a positive integer'
    );
  });
});
