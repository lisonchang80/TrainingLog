import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  createSession,
  insertSessionExercise,
} from '../../src/adapters/sqlite/sessionRepository';
import {
  insertSet,
  updateSetFields,
} from '../../src/adapters/sqlite/setRepository';
import {
  listExerciseHistorySets,
  listExercisePRSetRows,
} from '../../src/adapters/sqlite/exerciseHistoryRepository';
import { computePRSnapshot } from '../../src/domain/pr/prQuery';

/**
 * Behaviour-preserving proof for the Today-screen lean PR query (perf #2,
 * scale-audit report 08).
 *
 * The Today PR snapshot used to feed EVERY column of `listExerciseHistorySets`
 * (which carries cluster subqueries + a created_at sort) into
 * `computePRSnapshot`, even though the engine only reads `weight_kg` + `reps`.
 * `listExercisePRSetRows` returns just those two columns with the IDENTICAL
 * WHERE predicate (`is_skipped=0 AND is_logged=1`) and no JOIN/ORDER BY.
 *
 * This suite seeds a representative dataset — working sets, warmups, a dropset
 * chain (head logged, follower is_logged=0), a skipped set, and an unlogged
 * working set, spread across multiple sessions — then asserts the PR snapshot
 * computed from BOTH paths is deeply equal. That guards the row-set invariant:
 * the lean query must not change which sets count toward a PR.
 */

// Real builtin exercise UUIDs (v001 / v006 seeds — FK targets).
const BENCH = '00000000-0000-4000-8000-000000000001';
const SQUAT = '00000000-0000-4000-8000-000000000002';

describe('listExercisePRSetRows — PR-snapshot equivalence with listExerciseHistorySets', () => {
  let db: BetterSqliteDatabase;
  let seId = 0;
  let setId = 0;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    seId = 0;
    setId = 0;
  });

  afterEach(() => {
    db.close();
  });

  async function addExercise(args: {
    session_id: string;
    exercise_id: string;
    ordering: number;
  }): Promise<string> {
    const id = `se-${++seId}`;
    await insertSessionExercise(db, {
      id,
      session_id: args.session_id,
      exercise_id: args.exercise_id,
      ordering: args.ordering,
      planned_sets: 3,
      planned_reps: 8,
      planned_weight_kg: 60,
      template_id: null,
      is_evergreen: 0,
      parent_id: null,
      reusable_superset_id: null,
      rest_sec: null,
    });
    return id;
  }

  /**
   * Insert a set + apply lifecycle patch. Returns the set id so a dropset
   * follower can reference its head via parent_set_id.
   *
   * NOTE per dropset-chain-semantics skill: a follower's production
   * `is_logged` stays 0 (UI toggles head only) — pass is_logged:false for
   * followers, which is exactly what exercises the `is_logged=1` filter both
   * paths apply.
   */
  async function addSet(args: {
    session_id: string;
    exercise_id: string;
    session_exercise_id: string;
    ordering: number;
    weight_kg: number | null;
    reps: number | null;
    set_kind?: 'warmup' | 'working' | 'dropset';
    parent_set_id?: string | null;
    is_logged?: boolean;
    is_skipped?: number;
  }): Promise<string> {
    const id = `set-${++setId}`;
    await insertSet(db, {
      id,
      session_id: args.session_id,
      exercise_id: args.exercise_id,
      weight_kg: args.weight_kg,
      reps: args.reps,
      is_skipped: args.is_skipped ?? 0,
      ordering: args.ordering,
      created_at: 1000 + setId,
      session_exercise_id: args.session_exercise_id,
    });
    const patch: {
      set_kind?: 'warmup' | 'working' | 'dropset';
      parent_set_id?: string | null;
      is_logged?: number;
    } = {};
    if (args.set_kind && args.set_kind !== 'working') patch.set_kind = args.set_kind;
    if (args.parent_set_id !== undefined) patch.parent_set_id = args.parent_set_id;
    if (args.is_logged) patch.is_logged = 1;
    if (Object.keys(patch).length > 0) await updateSetFields(db, id, patch);
    return id;
  }

  /** Oracle: the OLD Today path — full history rows → (weight,reps) → snapshot. */
  async function oldSnapshot(exercise_id: string) {
    const history = await listExerciseHistorySets(db, exercise_id);
    return computePRSnapshot(
      history.map((h) => ({ weight_kg: h.weight_kg, reps: h.reps })),
    );
  }

  /** New path: lean rows → snapshot. */
  async function leanSnapshot(exercise_id: string) {
    const rows = await listExercisePRSetRows(db, exercise_id);
    return computePRSnapshot(
      rows.map((h) => ({ weight_kg: h.weight_kg, reps: h.reps })),
    );
  }

  it('returns the empty snapshot for an exercise with no history', async () => {
    const lean = await leanSnapshot(BENCH);
    expect(lean).toEqual(await oldSnapshot(BENCH));
    expect(lean).toEqual({
      weightPRs: [],
      volumePR: null,
      topWeightSet: null,
      topVolumeSet: null,
    });
  });

  it('PR snapshot is identical across a mixed multi-session dataset', async () => {
    // ── Session 1 — working + warmup + a dropset chain ───────────────────
    await createSession(db, { id: 'sess-1', started_at: 5000, title: 'S1' });
    const se1 = await addExercise({ session_id: 'sess-1', exercise_id: BENCH, ordering: 1 });
    // warmup logged — INCLUDED by both paths (Today PR has always fed warmups in).
    await addSet({ session_id: 'sess-1', exercise_id: BENCH, session_exercise_id: se1, ordering: 1, weight_kg: 40, reps: 12, set_kind: 'warmup', is_logged: true });
    // top working set: heaviest weight.
    await addSet({ session_id: 'sess-1', exercise_id: BENCH, session_exercise_id: se1, ordering: 2, weight_kg: 100, reps: 5, set_kind: 'working', is_logged: true });
    // unlogged working — EXCLUDED by both (is_logged=0). Heavier than the logged top → if it leaked, topWeightSet would change.
    await addSet({ session_id: 'sess-1', exercise_id: BENCH, session_exercise_id: se1, ordering: 3, weight_kg: 200, reps: 5, set_kind: 'working', is_logged: false });
    // dropset HEAD (logged) — INCLUDED.
    const head = await addSet({ session_id: 'sess-1', exercise_id: BENCH, session_exercise_id: se1, ordering: 4, weight_kg: 80, reps: 8, set_kind: 'dropset', is_logged: true });
    // dropset FOLLOWER (is_logged stays 0) — EXCLUDED by both. Big volume → if leaked, topVolumeSet would change.
    await addSet({ session_id: 'sess-1', exercise_id: BENCH, session_exercise_id: se1, ordering: 5, weight_kg: 70, reps: 30, set_kind: 'dropset', parent_set_id: head, is_logged: false });

    // ── Session 2 — another bench session, Pareto-relevant point ─────────
    await createSession(db, { id: 'sess-2', started_at: 4000, title: 'S2' });
    const se2 = await addExercise({ session_id: 'sess-2', exercise_id: BENCH, ordering: 1 });
    // high-rep moderate-weight set — neither dominates 100×5, so both on the frontier.
    await addSet({ session_id: 'sess-2', exercise_id: BENCH, session_exercise_id: se2, ordering: 1, weight_kg: 60, reps: 20, set_kind: 'working', is_logged: true });
    // skipped working — EXCLUDED by both (is_skipped=1).
    await addSet({ session_id: 'sess-2', exercise_id: BENCH, session_exercise_id: se2, ordering: 2, weight_kg: 150, reps: 3, set_kind: 'working', is_logged: true, is_skipped: 1 });
    // logged working with NULL reps — contributes nothing (engine filters nulls).
    await addSet({ session_id: 'sess-2', exercise_id: BENCH, session_exercise_id: se2, ordering: 3, weight_kg: 90, reps: null, set_kind: 'working', is_logged: true });

    // ── Noise: a different exercise that must NOT bleed in ───────────────
    const seSq = await addExercise({ session_id: 'sess-2', exercise_id: SQUAT, ordering: 4 });
    await addSet({ session_id: 'sess-2', exercise_id: SQUAT, session_exercise_id: seSq, ordering: 5, weight_kg: 300, reps: 5, set_kind: 'working', is_logged: true });

    const lean = await leanSnapshot(BENCH);
    const old = await oldSnapshot(BENCH);

    // Core guardrail: byte-for-byte equal PR snapshot.
    expect(lean).toEqual(old);

    // Pin exact values so a regression in BOTH paths can't pass silently.
    // Included logged non-skipped bench sets: 40×12, 100×5, 80×8, 60×20.
    expect(lean.topWeightSet).toEqual({ weight_kg: 100, reps: 5 }); // NOT the 200×5 unlogged leak
    // top volume = 60×20 = 1200 (vs 100×5=500, 80×8=640, 40×12=480) — NOT the 70×30=2100 follower leak.
    expect(lean.volumePR).toBe(1200);
    expect(lean.topVolumeSet).toEqual({ weight_kg: 60, reps: 20 });
    // Pareto frontier (weight DESC, reps DESC): 100×5, 80×8, 60×20 are each
    // non-dominated (more weight OR more reps than the others); 40×12 warmup
    // IS dominated by 60×20 so it drops off.
    expect(lean.weightPRs).toEqual([
      { weight_kg: 100, reps: 5 },
      { weight_kg: 80, reps: 8 },
      { weight_kg: 60, reps: 20 },
    ]);

    // And the lean query also matches the SQUAT exercise independently.
    expect(await leanSnapshot(SQUAT)).toEqual(await oldSnapshot(SQUAT));
  });

  it('returns the SAME row multiset (weight,reps) as listExerciseHistorySets', async () => {
    await createSession(db, { id: 'sess-X', started_at: 9000, title: 'X' });
    const se = await addExercise({ session_id: 'sess-X', exercise_id: BENCH, ordering: 1 });
    await addSet({ session_id: 'sess-X', exercise_id: BENCH, session_exercise_id: se, ordering: 1, weight_kg: 50, reps: 10, is_logged: true });
    await addSet({ session_id: 'sess-X', exercise_id: BENCH, session_exercise_id: se, ordering: 2, weight_kg: 50, reps: 10, set_kind: 'warmup', is_logged: true });
    await addSet({ session_id: 'sess-X', exercise_id: BENCH, session_exercise_id: se, ordering: 3, weight_kg: 999, reps: 1, is_logged: false }); // excluded
    await addSet({ session_id: 'sess-X', exercise_id: BENCH, session_exercise_id: se, ordering: 4, weight_kg: 888, reps: 1, is_logged: true, is_skipped: 1 }); // excluded

    const lean = (await listExercisePRSetRows(db, BENCH))
      .map((r) => `${r.weight_kg}x${r.reps}`)
      .sort();
    const full = (await listExerciseHistorySets(db, BENCH))
      .map((r) => `${r.weight_kg}x${r.reps}`)
      .sort();
    expect(lean).toEqual(full);
    // Two included rows: 50×10 working + 50×10 warmup; excluded the 999 + 888.
    expect(lean).toEqual(['50x10', '50x10']);
  });
});
