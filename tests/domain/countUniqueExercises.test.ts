import { countUniqueExercises } from '../../src/domain/session/countUniqueExercises';

describe('countUniqueExercises (overnight #47 第 5 點)', () => {
  it('empty input → 0', () => {
    expect(countUniqueExercises([])).toBe(0);
  });

  it('3 distinct exercise_id → 3', () => {
    expect(
      countUniqueExercises([
        { exercise_id: 'a' },
        { exercise_id: 'b' },
        { exercise_id: 'c' },
      ]),
    ).toBe(3);
  });

  it('cluster(A,B) + solo(B) → 2 unique (B dedup)', () => {
    // cluster A+B = 2 rows, solo B = 1 row, total 3 rows but 2 unique.
    expect(
      countUniqueExercises([
        { exercise_id: 'A' },
        { exercise_id: 'B' },
        { exercise_id: 'B' },
      ]),
    ).toBe(2);
  });

  it('user screenshot scenario: cluster(CC,CD) + cluster(BP,CD) + solo(BP) → 3 unique', () => {
    // 5 session_exercise rows, unique set {CC, CD, BP} → 3.
    expect(
      countUniqueExercises([
        { exercise_id: 'CC' },
        { exercise_id: 'CD' },
        { exercise_id: 'BP' },
        { exercise_id: 'CD' },
        { exercise_id: 'BP' },
      ]),
    ).toBe(3);
  });
});
