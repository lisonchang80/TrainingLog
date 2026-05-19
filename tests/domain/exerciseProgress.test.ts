import {
  computeExerciseProgress,
  type ExerciseProgressInput,
} from '../../src/domain/session/exerciseProgress';

/**
 * Per-exercise progress computation (ADR-0019 Q4, slice 10c Phase 3
 * commit 14).
 */

function mk(
  set_kind: 'warmup' | 'working' | 'dropset',
  is_logged: 0 | 1,
  weight_kg: number | null = 60,
  reps: number | null = 10,
): ExerciseProgressInput {
  return { set_kind, is_logged, weight_kg, reps };
}

describe('computeExerciseProgress', () => {
  it('empty input → zero counts', () => {
    expect(computeExerciseProgress([])).toEqual({
      workingDone: 0,
      volumeDone: 0,
      volumeTotal: 0,
    });
  });

  it('only is_logged working sets count toward workingDone', () => {
    const sets = [
      mk('working', 1, 60, 10),
      mk('working', 0, 70, 8), // not logged → excluded
      mk('working', 1, 75, 8),
    ];
    const out = computeExerciseProgress(sets);
    expect(out.workingDone).toBe(2);
  });

  it('warmup is_logged is excluded from workingDone and volume', () => {
    const sets = [
      mk('warmup', 1, 40, 12), // skipped
      mk('working', 1, 60, 10),
    ];
    const out = computeExerciseProgress(sets);
    expect(out.workingDone).toBe(1);
    expect(out.volumeDone).toBe(600);
    expect(out.volumeTotal).toBe(600); // warmup excluded from total too
  });

  it('dropset is_logged is NOT counted toward workingDone but DOES count toward volume', () => {
    const sets = [
      mk('working', 1, 60, 10), // working +
      mk('dropset', 1, 45, 8), // dropset head — logged, contributes to volume but not workingDone
    ];
    const out = computeExerciseProgress(sets);
    expect(out.workingDone).toBe(1); // only the working one
    expect(out.volumeDone).toBe(600); // dropset is_logged doesn't add to volumeDone (per current rule: working only)
    expect(out.volumeTotal).toBe(60 * 10 + 45 * 8); // both non-warmup
  });

  it('null weight/reps treated as 0 (defensive)', () => {
    const sets = [
      mk('working', 1, null, 10),
      mk('working', 1, 60, null),
    ];
    const out = computeExerciseProgress(sets);
    expect(out.workingDone).toBe(2);
    expect(out.volumeDone).toBe(0); // both contributed 0 to volume
  });

  it('mixed sequence: 1 warmup + 2 working (one logged) + 1 dropset head', () => {
    const sets = [
      mk('warmup', 1, 40, 12),
      mk('working', 1, 60, 10),
      mk('working', 0, 65, 10),
      mk('dropset', 0, 45, 8),
    ];
    const out = computeExerciseProgress(sets);
    expect(out.workingDone).toBe(1);
    expect(out.volumeDone).toBe(600);
    expect(out.volumeTotal).toBe(60 * 10 + 65 * 10 + 45 * 8);
  });
});
