import { countPerformedExercises } from '../../src/domain/session/countPerformedExercises';

describe('countPerformedExercises', () => {
  it('returns 0 for an empty set list', () => {
    expect(countPerformedExercises([])).toBe(0);
  });

  it('counts an exercise once even with multiple logged sets', () => {
    expect(
      countPerformedExercises([
        { exercise_id: 'A', is_logged: 1 },
        { exercise_id: 'A', is_logged: 1 },
        { exercise_id: 'A', is_logged: 1 },
      ]),
    ).toBe(1);
  });

  it('excludes an exercise whose sets are ALL unchecked (排除沒打勾的)', () => {
    expect(
      countPerformedExercises([
        { exercise_id: 'A', is_logged: 0 },
        { exercise_id: 'A', is_logged: 0 },
      ]),
    ).toBe(0);
  });

  it('counts an exercise with at least one checked set, ignores its unchecked ones', () => {
    expect(
      countPerformedExercises([
        { exercise_id: 'A', is_logged: 0 },
        { exercise_id: 'A', is_logged: 1 },
        { exercise_id: 'A', is_logged: 0 },
      ]),
    ).toBe(1);
  });

  it('counts distinct exercises, mixing checked + unchecked across exercises', () => {
    // A: checked → count. B: only unchecked → exclude. C: checked → count.
    expect(
      countPerformedExercises([
        { exercise_id: 'A', is_logged: 1 },
        { exercise_id: 'B', is_logged: 0 },
        { exercise_id: 'C', is_logged: 1 },
        { exercise_id: 'C', is_logged: 0 },
      ]),
    ).toBe(2);
  });

  it('treats only is_logged===1 as checked (not truthy coercion)', () => {
    // Guard: a stray non-1 numeric must NOT count as checked.
    expect(
      countPerformedExercises([
        { exercise_id: 'A', is_logged: 2 },
        { exercise_id: 'B', is_logged: 0 },
      ]),
    ).toBe(0);
  });
});
