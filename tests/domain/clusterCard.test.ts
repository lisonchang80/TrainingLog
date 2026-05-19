import {
  computeClusterCycleProgress,
  computeClusterCycles,
  computeClusterVolume,
  groupClusterSides,
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
  exercise_id?: string,
): ClusterExerciseInput {
  // For tests, by default exercise_id = id (most tests use distinct ids per side).
  return { id, exercise_id: exercise_id ?? `ex-${id}`, ordering, parent_id };
}

function mkSet(
  id: string,
  // `parent_token` is the owning session_exercise's id (e.g. 'p' or 'f').
  // exercise_id is derived (matches mkEx default `ex-${id}`); session_exercise_id
  // defaults to the same token so #17 isolation tests can override it
  // independently to simulate cross-card bleed.
  parent_token: string,
  ordering: number,
  opts: {
    set_kind?: 'warmup' | 'working' | 'dropset';
    is_logged?: number;
    weight_kg?: number | null;
    reps?: number | null;
    /** Override session_exercise_id (default: parent_token). Pass `null`
     *  to simulate legacy pre-v019 untagged rows. Pass another card's
     *  id to simulate a row owned by a different card. */
    session_exercise_id?: string | null;
    /** Override exercise_id (default: `ex-${parent_token}`). */
    exercise_id?: string;
  } = {},
): ClusterSetInput {
  return {
    id,
    exercise_id: opts.exercise_id ?? `ex-${parent_token}`,
    session_exercise_id:
      'session_exercise_id' in opts
        ? (opts.session_exercise_id as string | null)
        : parent_token,
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

  // v019 isolation (#17 漏網) — cluster filter must scope by
  // session_exercise_id, not just exercise_id, so a coincidentally-
  // same-exercise solo card in the same session doesn't bleed sets
  // into a cluster A/B side. Mirrors the solo path in
  // `app/(tabs)/index.tsx` line ~1969.

  it('isolates RS A side from solo card with same exercise_id (#17 漏網)', () => {
    // Setup: same session contains a solo Bench Press card (SE1) +
    // an RS [Bench Press, Chest Dip] card (SE2 A / SE3 B). Both
    // Bench Press cards share `exercise_id = ex-bench`. The 3 sets
    // belong to the solo card (session_exercise_id = SE1). The RS
    // A side must come back EMPTY — the cluster grouper only sees
    // SE2 + SE3 in `exercises`, so SE1's sets must not leak in even
    // though they share exercise_id.
    const exs = [
      mkEx('SE2', 1, null, 'ex-bench'), // RS A side
      mkEx('SE3', 2, 'SE2', 'ex-dip'), // RS B side
    ];
    const sets = [
      // 3 sets owned by the (out-of-group) solo Bench Press card SE1
      mkSet('s1', 'SE1', 1, { exercise_id: 'ex-bench', weight_kg: 70, reps: 12 }),
      mkSet('s2', 'SE1', 2, { exercise_id: 'ex-bench', weight_kg: 75, reps: 10 }),
      mkSet('s3', 'SE1', 3, { exercise_id: 'ex-bench', weight_kg: 80, reps: 8 }),
    ];
    const groups = groupClusterSides(exs, sets);
    expect(groups).toHaveLength(1);
    expect(groups[0].a.sets).toEqual([]); // <-- the bug: was returning all 3
    expect(groups[0].b.sets).toEqual([]);
  });

  it('picks only RS A side own sets when solo card with same exercise_id coexists', () => {
    // Same shape as above, but now SE2 (RS A) owns 2 sets and SE1
    // (solo) owns 1. RS A must surface ONLY its own 2 sets.
    const exs = [
      mkEx('SE2', 1, null, 'ex-bench'),
      mkEx('SE3', 2, 'SE2', 'ex-dip'),
    ];
    const sets = [
      mkSet('rsA1', 'SE2', 1, { exercise_id: 'ex-bench' }),
      mkSet('rsA2', 'SE2', 2, { exercise_id: 'ex-bench' }),
      mkSet('solo1', 'SE1', 1, { exercise_id: 'ex-bench' }), // bleed candidate
    ];
    const groups = groupClusterSides(exs, sets);
    expect(groups[0].a.sets.map((s) => s.id)).toEqual(['rsA1', 'rsA2']);
    expect(groups[0].b.sets).toEqual([]);
  });

  it('legacy untagged set (session_exercise_id=null) falls back to exercise_id match', () => {
    // Pre-v019 row the backfill couldn't tag. Same exercise_id as the
    // RS A side → should be pulled into A.sets via the fallback branch.
    const exs = [
      mkEx('SE2', 1, null, 'ex-bench'),
      mkEx('SE3', 2, 'SE2', 'ex-dip'),
    ];
    const sets = [
      mkSet('legacy', 'unused', 1, {
        exercise_id: 'ex-bench',
        session_exercise_id: null,
      }),
    ];
    const groups = groupClusterSides(exs, sets);
    expect(groups[0].a.sets.map((s) => s.id)).toEqual(['legacy']);
    expect(groups[0].b.sets).toEqual([]);
  });

  it('keeps ordering ASC after session_exercise_id filtering', () => {
    // Mix of in-card + out-of-card rows, plus a legacy fallback. Output
    // must be the 3 in-card rows in ordering ASC.
    const exs = [
      mkEx('SE2', 1, null, 'ex-bench'),
      mkEx('SE3', 2, 'SE2', 'ex-dip'),
    ];
    const sets = [
      mkSet('a3', 'SE2', 3, { exercise_id: 'ex-bench' }),
      mkSet('solo', 'SE1', 99, { exercise_id: 'ex-bench' }), // out of group — must drop
      mkSet('a1', 'SE2', 1, { exercise_id: 'ex-bench' }),
      mkSet('a2', 'SE2', 2, { exercise_id: 'ex-bench' }),
    ];
    const groups = groupClusterSides(exs, sets);
    expect(groups[0].a.sets.map((s) => s.id)).toEqual(['a1', 'a2', 'a3']);
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

// ---------------------------------------------------------------------------
// computeClusterCycleProgress — slice 10c overnight #46 第 3 點
// ---------------------------------------------------------------------------

describe('computeClusterCycleProgress', () => {
  it('all working cycles: total = cycle count, done counts both_logged', () => {
    const exs = [mkEx('p', 1, null), mkEx('f', 2, 'p')];
    const sets = [
      mkSet('p1', 'p', 1, { set_kind: 'working', is_logged: 1 }),
      mkSet('p2', 'p', 2, { set_kind: 'working', is_logged: 1 }),
      mkSet('p3', 'p', 3, { set_kind: 'working', is_logged: 0 }),
      mkSet('f1', 'f', 1, { set_kind: 'working', is_logged: 1 }),
      mkSet('f2', 'f', 2, { set_kind: 'working', is_logged: 1 }),
      mkSet('f3', 'f', 3, { set_kind: 'working', is_logged: 0 }),
    ];
    const group = groupClusterSides(exs, sets)[0];
    const cycles = computeClusterCycles(group);
    expect(computeClusterCycleProgress(cycles)).toEqual({ done: 2, total: 3 });
  });

  it('warmup cycles excluded from both numerator and denominator', () => {
    // 用戶 #46 截圖場景 — cluster card「0/250」warmup 虛胖 denominator
    const exs = [mkEx('p', 1, null), mkEx('f', 2, 'p')];
    const sets = [
      // cycle 1: warmup (both logged) → 不算
      mkSet('p1', 'p', 1, { set_kind: 'warmup', is_logged: 1 }),
      mkSet('f1', 'f', 1, { set_kind: 'warmup', is_logged: 1 }),
      // cycle 2: working (both logged) → done + total
      mkSet('p2', 'p', 2, { set_kind: 'working', is_logged: 1 }),
      mkSet('f2', 'f', 2, { set_kind: 'working', is_logged: 1 }),
      // cycle 3: working (not logged) → total only
      mkSet('p3', 'p', 3, { set_kind: 'working', is_logged: 0 }),
      mkSet('f3', 'f', 3, { set_kind: 'working', is_logged: 0 }),
    ];
    const group = groupClusterSides(exs, sets)[0];
    const cycles = computeClusterCycles(group);
    expect(computeClusterCycleProgress(cycles)).toEqual({ done: 1, total: 2 });
  });

  it('dropset cycles excluded (mirror solo: solo bar only counts working)', () => {
    // Solo card bar 也排除 dropset (`sets.filter(s => s.set_kind === 'working')`)
    const exs = [mkEx('p', 1, null), mkEx('f', 2, 'p')];
    const sets = [
      mkSet('p1', 'p', 1, { set_kind: 'working', is_logged: 1 }),
      mkSet('p2', 'p', 2, { set_kind: 'dropset', is_logged: 1 }),
      mkSet('f1', 'f', 1, { set_kind: 'working', is_logged: 1 }),
      mkSet('f2', 'f', 2, { set_kind: 'dropset', is_logged: 1 }),
    ];
    const group = groupClusterSides(exs, sets)[0];
    const cycles = computeClusterCycles(group);
    expect(computeClusterCycleProgress(cycles)).toEqual({ done: 1, total: 1 });
  });

  it('mixed cycle (A=warmup, B=working): counted (at least one side working)', () => {
    // 任一側 working 即算工作 cycle — practically rare but defined.
    const exs = [mkEx('p', 1, null), mkEx('f', 2, 'p')];
    const sets = [
      mkSet('p1', 'p', 1, { set_kind: 'warmup', is_logged: 1 }),
      mkSet('f1', 'f', 1, { set_kind: 'working', is_logged: 1 }),
    ];
    const group = groupClusterSides(exs, sets)[0];
    const cycles = computeClusterCycles(group);
    expect(computeClusterCycleProgress(cycles)).toEqual({ done: 1, total: 1 });
  });

  it('asymmetric A=working, B=null: counted; both_logged=false', () => {
    // Asymmetric short-side (ADR-0019 Q8 (d) AS1) — A 側 working、B 側 null
    // 計入 total，但 both_logged=false (B 不存在) 所以 done=0.
    const exs = [mkEx('p', 1, null), mkEx('f', 2, 'p')];
    const sets = [
      mkSet('p1', 'p', 1, { set_kind: 'working', is_logged: 1 }),
      mkSet('p2', 'p', 2, { set_kind: 'working', is_logged: 1 }),
      // B 側只有 1 row → cycle 2 b_set=null
      mkSet('f1', 'f', 1, { set_kind: 'working', is_logged: 1 }),
    ];
    const group = groupClusterSides(exs, sets)[0];
    const cycles = computeClusterCycles(group);
    // cycle 1: both working both logged → done+total
    // cycle 2: A=working logged, B=null → total only (both_logged false)
    expect(computeClusterCycleProgress(cycles)).toEqual({ done: 1, total: 2 });
  });

  it('empty cluster: 0/0', () => {
    expect(computeClusterCycleProgress([])).toEqual({ done: 0, total: 0 });
  });

  it('all-warmup cluster: 0/0 (zero working cycles)', () => {
    const exs = [mkEx('p', 1, null), mkEx('f', 2, 'p')];
    const sets = [
      mkSet('p1', 'p', 1, { set_kind: 'warmup', is_logged: 1 }),
      mkSet('f1', 'f', 1, { set_kind: 'warmup', is_logged: 1 }),
    ];
    const group = groupClusterSides(exs, sets)[0];
    const cycles = computeClusterCycles(group);
    expect(computeClusterCycleProgress(cycles)).toEqual({ done: 0, total: 0 });
  });
});
