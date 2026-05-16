/**
 * `computeLoggedExerciseCount` — slice 10c overnight #4 第 1 點.
 *
 * Drives the in-session 3-tile stats panel 動作數 tile. Replaces the naive
 * `plan.length` which over-counted untouched exercises and double-counted
 * cluster B-sides.
 */
import {
  computeLoggedExerciseCount,
  type LoggedExerciseCountPlanInput,
  type LoggedExerciseCountSetInput,
} from '../../src/domain/session/sessionStats';

function planRow(
  id: string,
  exercise_id: string,
  parent_id: string | null = null
): LoggedExerciseCountPlanInput {
  return { id, exercise_id, parent_id };
}

function setRow(
  exercise_id: string,
  is_logged: 0 | 1
): LoggedExerciseCountSetInput {
  return { exercise_id, is_logged };
}

describe('computeLoggedExerciseCount', () => {
  it('counts 1 solo + 1 cluster (A+B) both with ✓ → 2', () => {
    // 1 solo (squat) + 1 cluster (bench A / row B). A and B different exercise_ids.
    const plan = [
      planRow('p1', 'squat'),
      planRow('p2', 'bench'), // cluster A (parent)
      planRow('p3', 'row', 'p2'), // cluster B (follower)
    ];
    const sets = [
      setRow('squat', 1),
      setRow('bench', 1),
      setRow('row', 1),
    ];
    expect(computeLoggedExerciseCount(plan, sets)).toBe(2);
  });

  it('1 solo with no ✓ → 0', () => {
    const plan = [planRow('p1', 'squat')];
    const sets = [setRow('squat', 0), setRow('squat', 0)];
    expect(computeLoggedExerciseCount(plan, sets)).toBe(0);
  });

  it('1 cluster, only A side has ✓ → 1', () => {
    const plan = [
      planRow('p1', 'bench'), // A
      planRow('p2', 'row', 'p1'), // B
    ];
    const sets = [
      setRow('bench', 1), // A logged
      setRow('row', 0), // B not logged
    ];
    expect(computeLoggedExerciseCount(plan, sets)).toBe(1);
  });

  it('empty plan → 0', () => {
    expect(computeLoggedExerciseCount([], [])).toBe(0);
    // Defensive: orphan sets without plan rows still → 0.
    expect(computeLoggedExerciseCount([], [setRow('squat', 1)])).toBe(0);
  });
});
