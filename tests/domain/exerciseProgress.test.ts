import {
  computeExerciseProgress,
  type ExerciseProgressInput,
} from '../../src/domain/session/exerciseProgress';

/**
 * Per-exercise progress computation (ADR-0019 Q4, slice 10c Phase 3
 * commit 14, dropset 納入 wave 12 2026-05-20).
 *
 * Counting rule:
 *   - 1 set unit = 1 working row OR 1 dropset chain head
 *   - Dropset followers count toward volume (via head's effective is_logged)
 *     but not toward the set-unit count
 *   - Warmup excluded from everything
 */

let __id = 0;
function mk(opts: {
  kind: 'warmup' | 'working' | 'dropset';
  logged: 0 | 1;
  w?: number | null;
  r?: number | null;
  id?: string;
  parent?: string | null;
}): ExerciseProgressInput {
  // `'w' in opts` distinguishes "field omitted" from "explicit null" — the
  // latter must stay null so the defensive null-handling test path actually
  // exercises null (??-coalesce would silently fall back to 60).
  return {
    id: opts.id ?? `s${++__id}`,
    set_kind: opts.kind,
    is_logged: opts.logged,
    weight_kg: 'w' in opts ? (opts.w as number | null) : 60,
    reps: 'r' in opts ? (opts.r as number | null) : 10,
    parent_set_id: opts.parent ?? null,
  };
}

describe('computeExerciseProgress', () => {
  beforeEach(() => {
    __id = 0;
  });

  it('empty input → all zero', () => {
    expect(computeExerciseProgress([])).toEqual({
      setsDone: 0,
      setsTotal: 0,
      volumeDone: 0,
      volumeTotal: 0,
    });
  });

  it('working sets: setsTotal = count, setsDone = is_logged count', () => {
    const sets = [
      mk({ kind: 'working', logged: 1, w: 60, r: 10 }),
      mk({ kind: 'working', logged: 0, w: 70, r: 8 }),
      mk({ kind: 'working', logged: 1, w: 75, r: 8 }),
    ];
    const out = computeExerciseProgress(sets);
    expect(out.setsTotal).toBe(3);
    expect(out.setsDone).toBe(2);
  });

  it('warmup excluded from set count AND volume entirely', () => {
    const sets = [
      mk({ kind: 'warmup', logged: 1, w: 40, r: 12 }),
      mk({ kind: 'working', logged: 1, w: 60, r: 10 }),
    ];
    const out = computeExerciseProgress(sets);
    expect(out.setsTotal).toBe(1); // warmup excluded
    expect(out.setsDone).toBe(1);
    expect(out.volumeTotal).toBe(600); // warmup excluded
    expect(out.volumeDone).toBe(600);
  });

  it('dropset HEAD counts as 1 unit; logged → counted in setsDone', () => {
    const sets = [
      mk({ kind: 'working', logged: 1, w: 60, r: 10 }),
      mk({ kind: 'dropset', logged: 1, w: 45, r: 8, id: 'h' }), // head, logged
    ];
    const out = computeExerciseProgress(sets);
    expect(out.setsTotal).toBe(2);
    expect(out.setsDone).toBe(2); // both counted
    expect(out.volumeDone).toBe(60 * 10 + 45 * 8);
    expect(out.volumeTotal).toBe(60 * 10 + 45 * 8);
  });

  it('dropset HEAD unlogged → counted in total, not in done', () => {
    const sets = [
      mk({ kind: 'working', logged: 1, w: 60, r: 10 }),
      mk({ kind: 'dropset', logged: 0, w: 45, r: 8, id: 'h' }),
    ];
    const out = computeExerciseProgress(sets);
    expect(out.setsTotal).toBe(2);
    expect(out.setsDone).toBe(1); // working only
    expect(out.volumeDone).toBe(600); // dropset not effectively logged
    expect(out.volumeTotal).toBe(60 * 10 + 45 * 8);
  });

  it('dropset FOLLOWERS do NOT add to set count (1 chain = 1 unit)', () => {
    const sets = [
      mk({ kind: 'dropset', logged: 1, w: 60, r: 10, id: 'h' }), // head
      mk({ kind: 'dropset', logged: 0, w: 45, r: 8, id: 'f1', parent: 'h' }),
      mk({ kind: 'dropset', logged: 0, w: 30, r: 6, id: 'f2', parent: 'h' }),
    ];
    const out = computeExerciseProgress(sets);
    expect(out.setsTotal).toBe(1); // head only
    expect(out.setsDone).toBe(1);
  });

  it('dropset FOLLOWER volume inherits head is_logged (chain-aware volumeDone)', () => {
    // Head logged → all 3 rows contribute to volumeDone.
    const sets = [
      mk({ kind: 'dropset', logged: 1, w: 60, r: 10, id: 'h' }),
      mk({ kind: 'dropset', logged: 0, w: 45, r: 8, id: 'f1', parent: 'h' }),
      mk({ kind: 'dropset', logged: 0, w: 30, r: 6, id: 'f2', parent: 'h' }),
    ];
    const out = computeExerciseProgress(sets);
    const total = 60 * 10 + 45 * 8 + 30 * 6;
    expect(out.volumeTotal).toBe(total);
    expect(out.volumeDone).toBe(total);
  });

  it('dropset chain UNLOGGED head: 0 volumeDone, full volumeTotal', () => {
    const sets = [
      mk({ kind: 'dropset', logged: 0, w: 60, r: 10, id: 'h' }),
      mk({ kind: 'dropset', logged: 0, w: 45, r: 8, id: 'f1', parent: 'h' }),
    ];
    const out = computeExerciseProgress(sets);
    expect(out.volumeDone).toBe(0);
    expect(out.volumeTotal).toBe(60 * 10 + 45 * 8);
  });

  it('null weight/reps treated as 0 (defensive)', () => {
    const sets = [
      mk({ kind: 'working', logged: 1, w: null, r: 10 }),
      mk({ kind: 'working', logged: 1, w: 60, r: null }),
    ];
    const out = computeExerciseProgress(sets);
    expect(out.setsDone).toBe(2);
    expect(out.volumeDone).toBe(0);
  });

  it('mixed: 1 warmup + 2 working + 1 dropset chain (head+f1, head logged)', () => {
    const sets = [
      mk({ kind: 'warmup', logged: 1, w: 40, r: 12 }),
      mk({ kind: 'working', logged: 1, w: 60, r: 10 }),
      mk({ kind: 'working', logged: 0, w: 65, r: 10 }),
      mk({ kind: 'dropset', logged: 1, w: 45, r: 8, id: 'h' }),
      mk({ kind: 'dropset', logged: 0, w: 30, r: 6, id: 'f1', parent: 'h' }),
    ];
    const out = computeExerciseProgress(sets);
    // Units: 2 working + 1 dropset head = 3 total
    expect(out.setsTotal).toBe(3);
    // Done: 1 working logged + 1 dropset head logged = 2
    expect(out.setsDone).toBe(2);
    // Volume (non-warmup): 60*10 + 65*10 + 45*8 + 30*6 = 600+650+360+180 = 1790
    expect(out.volumeTotal).toBe(60 * 10 + 65 * 10 + 45 * 8 + 30 * 6);
    // Done volume: working#1 (logged) + dropset chain (head logged → both contribute)
    expect(out.volumeDone).toBe(60 * 10 + 45 * 8 + 30 * 6);
  });
});
