import {
  groupClusterSides,
  computeClusterCycles,
  computeClusterVolume,
  type ClusterExerciseInput,
  type ClusterSetInput,
} from '../../src/domain/session/clusterCard';

/**
 * Cluster card pure logic tests (ADR-0019 Q8/Q15.5/Q16, slice 10c Phase 7).
 * Cover symmetric / asymmetric / empty / warmup-only / mixed-warmup cases
 * plus atomic-cycle implications and stale-leaf isolation.
 */

function mkEx(
  id: string,
  ordering: number,
  parent_id: string | null = null,
): ClusterExerciseInput {
  return { id, ordering, parent_id };
}

function mkSet(
  id: string,
  session_exercise_id: string,
  ordering: number,
  opts: {
    set_kind?: 'warmup' | 'working' | 'dropset';
    is_logged?: number;
    weight_kg?: number | null;
    reps?: number | null;
  } = {},
): ClusterSetInput {
  return {
    id,
    session_exercise_id,
    ordering,
    set_kind: opts.set_kind ?? 'working',
    is_logged: opts.is_logged ?? 0,
    // Use `in opts` to distinguish "not set" (defaults to 50) vs explicit null.
    weight_kg: 'weight_kg' in opts ? (opts.weight_kg as number | null) : 50,
    reps: 'reps' in opts ? (opts.reps as number | null) : 8,
  };
}

describe('groupClusterSides', () => {
  it('returns [] when no exercise has a follower (all solos)', () => {
    const exs = [mkEx('a', 1, null), mkEx('b', 2, null)];
    expect(groupClusterSides(exs, [])).toEqual([]);
  });

  it('groups one parent + one follower into a single 2-side cluster', () => {
    const exs = [mkEx('p', 1, null), mkEx('f', 2, 'p')];
    const sets = [mkSet('s1', 'p', 1), mkSet('s2', 'f', 1)];
    const groups = groupClusterSides(exs, sets);
    expect(groups).toHaveLength(1);
    expect(groups[0].a.exercise.id).toBe('p');
    expect(groups[0].b.exercise.id).toBe('f');
    expect(groups[0].a.sets.map((s) => s.id)).toEqual(['s1']);
    expect(groups[0].b.sets.map((s) => s.id)).toEqual(['s2']);
  });

  it('preserves cluster block ordering by A side', () => {
    const exs = [
      mkEx('p1', 1, null),
      mkEx('f1', 2, 'p1'),
      mkEx('p2', 5, null),
      mkEx('f2', 6, 'p2'),
    ];
    const groups = groupClusterSides(exs, []);
    expect(groups.map((g) => g.a.exercise.id)).toEqual(['p1', 'p2']);
  });

  it('ignores solo exercises that have no followers', () => {
    const exs = [
      mkEx('solo', 1, null),
      mkEx('p', 2, null),
      mkEx('f', 3, 'p'),
    ];
    const groups = groupClusterSides(exs, []);
    expect(groups).toHaveLength(1);
    expect(groups[0].a.exercise.id).toBe('p');
  });

  it('drops 3rd+ follower silently (2-side restriction for v1)', () => {
    const exs = [
      mkEx('p', 1, null),
      mkEx('f1', 2, 'p'),
      mkEx('f2', 3, 'p'),
    ];
    const groups = groupClusterSides(exs, []);
    expect(groups).toHaveLength(1);
    // First follower by ordering becomes the B side
    expect(groups[0].b.exercise.id).toBe('f1');
  });

  it('sorts per-side sets by ordering ASC', () => {
    const exs = [mkEx('p', 1, null), mkEx('f', 2, 'p')];
    const sets = [
      mkSet('s3', 'p', 3),
      mkSet('s1', 'p', 1),
      mkSet('s2', 'p', 2),
    ];
    const groups = groupClusterSides(exs, sets);
    expect(groups[0].a.sets.map((s) => s.id)).toEqual(['s1', 's2', 's3']);
  });
});

describe('computeClusterCycles', () => {
  it('returns [] for empty cluster (both sides 0 sets)', () => {
    const group = groupClusterSides(
      [mkEx('p', 1, null), mkEx('f', 2, 'p')],
      [],
    )[0];
    expect(computeClusterCycles(group)).toEqual([]);
  });

  it('aligns symmetric 3-cycle cluster', () => {
    const exs = [mkEx('p', 1, null), mkEx('f', 2, 'p')];
    const sets = [
      mkSet('p1', 'p', 1, { is_logged: 1 }),
      mkSet('p2', 'p', 2, { is_logged: 1 }),
      mkSet('p3', 'p', 3, { is_logged: 0 }),
      mkSet('f1', 'f', 1, { is_logged: 1 }),
      mkSet('f2', 'f', 2, { is_logged: 1 }),
      mkSet('f3', 'f', 3, { is_logged: 0 }),
    ];
    const group = groupClusterSides(exs, sets)[0];
    const cycles = computeClusterCycles(group);
    expect(cycles).toHaveLength(3);
    expect(cycles[0]).toMatchObject({
      cycle_idx: 1,
      both_logged: true,
    });
    expect(cycles[0].a_set!.id).toBe('p1');
    expect(cycles[0].b_set!.id).toBe('f1');
    expect(cycles[2].both_logged).toBe(false); // both unlogged
  });

  it('asymmetric A=4 B=3 → cycle 4 b_set=null (B short)', () => {
    const exs = [mkEx('p', 1, null), mkEx('f', 2, 'p')];
    const sets = [
      mkSet('p1', 'p', 1),
      mkSet('p2', 'p', 2),
      mkSet('p3', 'p', 3),
      mkSet('p4', 'p', 4),
      mkSet('f1', 'f', 1),
      mkSet('f2', 'f', 2),
      mkSet('f3', 'f', 3),
    ];
    const group = groupClusterSides(exs, sets)[0];
    const cycles = computeClusterCycles(group);
    expect(cycles).toHaveLength(4);
    expect(cycles[3].a_set!.id).toBe('p4');
    expect(cycles[3].b_set).toBeNull();
    expect(cycles[3].both_logged).toBe(false);
  });

  it('asymmetric A=2 B=5 → cycles 3-5 a_set=null (A short)', () => {
    const exs = [mkEx('p', 1, null), mkEx('f', 2, 'p')];
    const sets = [
      mkSet('p1', 'p', 1),
      mkSet('p2', 'p', 2),
      mkSet('f1', 'f', 1),
      mkSet('f2', 'f', 2),
      mkSet('f3', 'f', 3),
      mkSet('f4', 'f', 4),
      mkSet('f5', 'f', 5),
    ];
    const group = groupClusterSides(exs, sets)[0];
    const cycles = computeClusterCycles(group);
    expect(cycles).toHaveLength(5);
    expect(cycles[2].a_set).toBeNull();
    expect(cycles[2].b_set!.id).toBe('f3');
    expect(cycles[4].a_set).toBeNull();
    expect(cycles[4].b_set!.id).toBe('f5');
  });

  it("both_logged=false when only one side is logged in a paired cycle", () => {
    const exs = [mkEx('p', 1, null), mkEx('f', 2, 'p')];
    const sets = [
      mkSet('p1', 'p', 1, { is_logged: 1 }),
      mkSet('f1', 'f', 1, { is_logged: 0 }),
    ];
    const group = groupClusterSides(exs, sets)[0];
    const cycles = computeClusterCycles(group);
    expect(cycles[0].both_logged).toBe(false);
  });
});

describe('computeClusterVolume', () => {
  it('returns 0/0 for empty cluster (no sets either side)', () => {
    const group = groupClusterSides(
      [mkEx('p', 1, null), mkEx('f', 2, 'p')],
      [],
    )[0];
    expect(computeClusterVolume(group)).toEqual({ numerator: 0, denominator: 0 });
  });

  it('excludes warmup from BOTH numerator and denominator', () => {
    const exs = [mkEx('p', 1, null), mkEx('f', 2, 'p')];
    const sets = [
      mkSet('p1', 'p', 1, { set_kind: 'warmup', weight_kg: 30, reps: 12 }),
      mkSet('p2', 'p', 2, { set_kind: 'working', weight_kg: 60, reps: 10, is_logged: 1 }),
      mkSet('f1', 'f', 1, { set_kind: 'warmup', weight_kg: 20, reps: 12 }),
      mkSet('f2', 'f', 2, { set_kind: 'working', weight_kg: 40, reps: 8, is_logged: 0 }),
    ];
    const group = groupClusterSides(exs, sets)[0];
    const vol = computeClusterVolume(group);
    expect(vol.numerator).toBe(60 * 10); // only p2 logged
    expect(vol.denominator).toBe(60 * 10 + 40 * 8); // both working sets, no warmup
  });

  it('aggregates volume across BOTH A+B sides (Q15.5 cluster rule)', () => {
    const exs = [mkEx('p', 1, null), mkEx('f', 2, 'p')];
    const sets = [
      mkSet('p1', 'p', 1, { weight_kg: 100, reps: 5, is_logged: 1 }),
      mkSet('p2', 'p', 2, { weight_kg: 100, reps: 5, is_logged: 1 }),
      mkSet('f1', 'f', 1, { weight_kg: 50, reps: 12, is_logged: 1 }),
      mkSet('f2', 'f', 2, { weight_kg: 50, reps: 12, is_logged: 1 }),
    ];
    const group = groupClusterSides(exs, sets)[0];
    const vol = computeClusterVolume(group);
    // numerator = denominator since everything is logged + non-warmup
    expect(vol.numerator).toBe(2 * 500 + 2 * 600);
    expect(vol.denominator).toBe(2 * 500 + 2 * 600);
  });

  it('all warmup → numerator 0, denominator 0', () => {
    const exs = [mkEx('p', 1, null), mkEx('f', 2, 'p')];
    const sets = [
      mkSet('p1', 'p', 1, { set_kind: 'warmup', is_logged: 1 }),
      mkSet('f1', 'f', 1, { set_kind: 'warmup', is_logged: 1 }),
    ];
    const group = groupClusterSides(exs, sets)[0];
    expect(computeClusterVolume(group)).toEqual({ numerator: 0, denominator: 0 });
  });

  it('dropset is_logged=1 counts toward numerator (non-warmup)', () => {
    const exs = [mkEx('p', 1, null), mkEx('f', 2, 'p')];
    const sets = [
      mkSet('p1', 'p', 1, { set_kind: 'dropset', weight_kg: 40, reps: 10, is_logged: 1 }),
      mkSet('p2', 'p', 2, { set_kind: 'dropset', weight_kg: 30, reps: 10, is_logged: 1 }),
    ];
    const group = groupClusterSides(exs, sets)[0];
    const vol = computeClusterVolume(group);
    expect(vol.numerator).toBe(40 * 10 + 30 * 10);
    expect(vol.denominator).toBe(40 * 10 + 30 * 10);
  });

  it('null weight or reps contribute 0 (defensive)', () => {
    const exs = [mkEx('p', 1, null), mkEx('f', 2, 'p')];
    const sets = [
      mkSet('p1', 'p', 1, { weight_kg: null, reps: 8, is_logged: 1 }),
      mkSet('f1', 'f', 1, { weight_kg: 50, reps: null, is_logged: 1 }),
    ];
    const group = groupClusterSides(exs, sets)[0];
    expect(computeClusterVolume(group)).toEqual({ numerator: 0, denominator: 0 });
  });

  it('numerator excludes B-side rows when only A is logged in a cycle', () => {
    // Asymmetric atomic-✓ test: if a tap-✓ wrote A.is_logged=1 but B was
    // missed (hypothetical bug), the cluster volume must reflect the actual
    // state per row — not assume cycle-level invariants.
    const exs = [mkEx('p', 1, null), mkEx('f', 2, 'p')];
    const sets = [
      mkSet('p1', 'p', 1, { weight_kg: 60, reps: 10, is_logged: 1 }),
      mkSet('f1', 'f', 1, { weight_kg: 40, reps: 8, is_logged: 0 }),
    ];
    const group = groupClusterSides(exs, sets)[0];
    const vol = computeClusterVolume(group);
    expect(vol.numerator).toBe(60 * 10); // only p1
    expect(vol.denominator).toBe(60 * 10 + 40 * 8); // both non-warmup
  });

  it('after atomic cycle-✓ both A.set[i] AND B.set[i] count toward numerator', () => {
    const exs = [mkEx('p', 1, null), mkEx('f', 2, 'p')];
    const sets = [
      mkSet('p1', 'p', 1, { weight_kg: 60, reps: 10, is_logged: 1 }),
      mkSet('f1', 'f', 1, { weight_kg: 40, reps: 8, is_logged: 1 }),
      mkSet('p2', 'p', 2, { weight_kg: 60, reps: 10, is_logged: 0 }),
      mkSet('f2', 'f', 2, { weight_kg: 40, reps: 8, is_logged: 0 }),
    ];
    const group = groupClusterSides(exs, sets)[0];
    const vol = computeClusterVolume(group);
    expect(vol.numerator).toBe(60 * 10 + 40 * 8); // cycle 1 atomic
    expect(vol.denominator).toBe(2 * (60 * 10) + 2 * (40 * 8));
  });

  it('asymmetric A=3 B=2: short side contributes only the rows that exist', () => {
    const exs = [mkEx('p', 1, null), mkEx('f', 2, 'p')];
    const sets = [
      mkSet('p1', 'p', 1, { weight_kg: 60, reps: 10, is_logged: 1 }),
      mkSet('p2', 'p', 2, { weight_kg: 60, reps: 10, is_logged: 1 }),
      mkSet('p3', 'p', 3, { weight_kg: 60, reps: 10, is_logged: 0 }),
      mkSet('f1', 'f', 1, { weight_kg: 40, reps: 8, is_logged: 1 }),
      mkSet('f2', 'f', 2, { weight_kg: 40, reps: 8, is_logged: 1 }),
    ];
    const group = groupClusterSides(exs, sets)[0];
    const vol = computeClusterVolume(group);
    expect(vol.numerator).toBe(2 * (60 * 10) + 2 * (40 * 8));
    expect(vol.denominator).toBe(3 * (60 * 10) + 2 * (40 * 8));
  });
});
