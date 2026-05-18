import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { listExercises } from '../../src/adapters/sqlite/exerciseRepository';
import {
  createSession,
  insertSessionExercise,
} from '../../src/adapters/sqlite/sessionRepository';
import {
  insertSet,
  insertSessionSet,
} from '../../src/adapters/sqlite/setRepository';
import {
  hasClusterHistory,
  listExerciseHistoryBySession,
  queryExerciseHistory,
} from '../../src/adapters/sqlite/exerciseHistoryRepository';
import { insertReusableSuperset } from '../../src/adapters/sqlite/supersetRepository';
import { filterSetsByClusterMode } from '../../src/domain/exercise/clusterFilter';

/**
 * Slice 10c — `queryExerciseHistory` must tag each set row with
 * `is_in_cluster` based on the session-side `session_exercise` shape
 * (A side = parent of another se row, B side = parent_id set, else solo).
 *
 * Also covers `hasClusterHistory` — feature-flag for showing the
 * 3-段 segmented control on the history / chart pages.
 *
 * Schema: v014 added `session_exercise.parent_id` + `reusable_superset_id`.
 */

const NOW_MS = 1_700_000_000_000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

interface TestExercises {
  bench: string;
  squat: string;
  deadlift: string;
}

async function pickThreeExercises(
  db: BetterSqliteDatabase
): Promise<TestExercises> {
  const all = await listExercises(db);
  const bench = all.find((e) => e.name === 'Bench Press')!.id;
  const squat = all.find((e) => e.name === 'Back Squat')!.id;
  const deadlift = all.find((e) => e.name === 'Deadlift')!.id;
  return { bench, squat, deadlift };
}

async function seedSet(
  db: BetterSqliteDatabase,
  args: {
    set_id: string;
    session_id: string;
    exercise_id: string;
    reps: number;
    weight_kg: number;
    ordering: number;
  }
): Promise<void> {
  await insertSet(db, {
    id: args.set_id,
    session_id: args.session_id,
    exercise_id: args.exercise_id,
    weight_kg: args.weight_kg,
    reps: args.reps,
    is_skipped: 0,
    ordering: args.ordering,
    created_at: NOW_MS + args.ordering,
  });
  // Slice 10c overnight #10 — history queries filter is_logged=1; mark
  // every seeded row as logged so the existing "exists in history" assertions
  // still hold post-filter.
  await db.runAsync(`UPDATE "set" SET is_logged = 1 WHERE id = ?`, args.set_id);
}

describe('queryExerciseHistory — is_in_cluster flag', () => {
  let db: BetterSqliteDatabase;
  let ex: TestExercises;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    ex = await pickThreeExercises(db);
  });

  afterEach(() => {
    db.close();
  });

  it('flags solo rows as is_in_cluster=false', async () => {
    await createSession(db, { id: 'sess-1', started_at: NOW_MS });
    await insertSessionExercise(db, {
      id: 'se-1',
      session_id: 'sess-1',
      exercise_id: ex.bench,
      ordering: 0,
      planned_sets: 3,
      planned_reps: null,
      planned_weight_kg: null,
      template_id: null,
      is_evergreen: 0,
      parent_id: null,
      reusable_superset_id: null,
    });
    await seedSet(db, {
      set_id: 'set-1',
      session_id: 'sess-1',
      exercise_id: ex.bench,
      reps: 8,
      weight_kg: 80,
      ordering: 1,
    });

    const rows = await queryExerciseHistory(db, ex.bench);
    expect(rows).toHaveLength(1);
    expect(rows[0].is_in_cluster).toBe(false);
  });

  it('flags cluster B (parent_id != null) as is_in_cluster=true', async () => {
    await createSession(db, { id: 'sess-1', started_at: NOW_MS });
    // Parent (A side) — bench
    await insertSessionExercise(db, {
      id: 'se-A',
      session_id: 'sess-1',
      exercise_id: ex.bench,
      ordering: 0,
      planned_sets: 3,
      planned_reps: null,
      planned_weight_kg: null,
      template_id: null,
      is_evergreen: 0,
      parent_id: null,
      reusable_superset_id: null,
    });
    // Child (B side) — squat with parent_id pointing back at A
    await insertSessionExercise(db, {
      id: 'se-B',
      session_id: 'sess-1',
      exercise_id: ex.squat,
      ordering: 1,
      planned_sets: 3,
      planned_reps: null,
      planned_weight_kg: null,
      template_id: null,
      is_evergreen: 0,
      parent_id: 'se-A',
      reusable_superset_id: null,
    });
    await seedSet(db, {
      set_id: 'set-b',
      session_id: 'sess-1',
      exercise_id: ex.squat,
      reps: 10,
      weight_kg: 100,
      ordering: 1,
    });

    const rows = await queryExerciseHistory(db, ex.squat);
    expect(rows).toHaveLength(1);
    expect(rows[0].is_in_cluster).toBe(true);
  });

  it('flags cluster A (parent of another se row) as is_in_cluster=true', async () => {
    await createSession(db, { id: 'sess-1', started_at: NOW_MS });
    await insertSessionExercise(db, {
      id: 'se-A',
      session_id: 'sess-1',
      exercise_id: ex.bench,
      ordering: 0,
      planned_sets: 3,
      planned_reps: null,
      planned_weight_kg: null,
      template_id: null,
      is_evergreen: 0,
      parent_id: null,
      reusable_superset_id: null,
    });
    await insertSessionExercise(db, {
      id: 'se-B',
      session_id: 'sess-1',
      exercise_id: ex.squat,
      ordering: 1,
      planned_sets: 3,
      planned_reps: null,
      planned_weight_kg: null,
      template_id: null,
      is_evergreen: 0,
      parent_id: 'se-A',
      reusable_superset_id: null,
    });
    await seedSet(db, {
      set_id: 'set-a',
      session_id: 'sess-1',
      exercise_id: ex.bench,
      reps: 5,
      weight_kg: 100,
      ordering: 1,
    });

    const rows = await queryExerciseHistory(db, ex.bench);
    expect(rows).toHaveLength(1);
    expect(rows[0].is_in_cluster).toBe(true);
  });

  it('mixes solo + cluster rows across sessions correctly', async () => {
    // Session 1 — bench solo
    await createSession(db, { id: 'sess-1', started_at: NOW_MS });
    await insertSessionExercise(db, {
      id: 'se1-bench',
      session_id: 'sess-1',
      exercise_id: ex.bench,
      ordering: 0,
      planned_sets: 3,
      planned_reps: null,
      planned_weight_kg: null,
      template_id: null,
      is_evergreen: 0,
      parent_id: null,
      reusable_superset_id: null,
    });
    await seedSet(db, {
      set_id: 'set-1',
      session_id: 'sess-1',
      exercise_id: ex.bench,
      reps: 8,
      weight_kg: 80,
      ordering: 1,
    });

    // Session 2 (later) — bench in cluster A with squat as B
    await createSession(db, {
      id: 'sess-2',
      started_at: NOW_MS + ONE_DAY_MS,
    });
    await insertSessionExercise(db, {
      id: 'se2-bench',
      session_id: 'sess-2',
      exercise_id: ex.bench,
      ordering: 0,
      planned_sets: 3,
      planned_reps: null,
      planned_weight_kg: null,
      template_id: null,
      is_evergreen: 0,
      parent_id: null,
      // null = manual / ad-hoc cluster (no superset row needed; avoids FK).
      reusable_superset_id: null,
    });
    await insertSessionExercise(db, {
      id: 'se2-squat',
      session_id: 'sess-2',
      exercise_id: ex.squat,
      ordering: 1,
      planned_sets: 3,
      planned_reps: null,
      planned_weight_kg: null,
      template_id: null,
      is_evergreen: 0,
      parent_id: 'se2-bench',
      reusable_superset_id: null,
    });
    await seedSet(db, {
      set_id: 'set-2',
      session_id: 'sess-2',
      exercise_id: ex.bench,
      reps: 6,
      weight_kg: 90,
      ordering: 1,
    });

    const rows = await queryExerciseHistory(db, ex.bench);
    expect(rows).toHaveLength(2);
    // Newest first — sess-2 (cluster) leads
    expect(rows[0].session_id).toBe('sess-2');
    expect(rows[0].is_in_cluster).toBe(true);
    expect(rows[1].session_id).toBe('sess-1');
    expect(rows[1].is_in_cluster).toBe(false);
  });
});

describe('hasClusterHistory', () => {
  let db: BetterSqliteDatabase;
  let ex: TestExercises;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    ex = await pickThreeExercises(db);
  });

  afterEach(() => {
    db.close();
  });

  it('returns false for an exercise that has never been in a cluster', async () => {
    await createSession(db, { id: 'sess-1', started_at: NOW_MS });
    await insertSessionExercise(db, {
      id: 'se-bench',
      session_id: 'sess-1',
      exercise_id: ex.bench,
      ordering: 0,
      planned_sets: 3,
      planned_reps: null,
      planned_weight_kg: null,
      template_id: null,
      is_evergreen: 0,
      parent_id: null,
      reusable_superset_id: null,
    });
    expect(await hasClusterHistory(db, ex.bench)).toBe(false);
  });

  it('returns false for an unknown exercise id', async () => {
    expect(await hasClusterHistory(db, 'no-such-ex')).toBe(false);
  });

  it('returns true when exercise was once the B side of a cluster', async () => {
    await createSession(db, { id: 'sess-1', started_at: NOW_MS });
    await insertSessionExercise(db, {
      id: 'se-A',
      session_id: 'sess-1',
      exercise_id: ex.bench,
      ordering: 0,
      planned_sets: 3,
      planned_reps: null,
      planned_weight_kg: null,
      template_id: null,
      is_evergreen: 0,
      parent_id: null,
      reusable_superset_id: null,
    });
    await insertSessionExercise(db, {
      id: 'se-B',
      session_id: 'sess-1',
      exercise_id: ex.squat,
      ordering: 1,
      planned_sets: 3,
      planned_reps: null,
      planned_weight_kg: null,
      template_id: null,
      is_evergreen: 0,
      parent_id: 'se-A',
      reusable_superset_id: null,
    });
    expect(await hasClusterHistory(db, ex.squat)).toBe(true);
    expect(await hasClusterHistory(db, ex.bench)).toBe(true);
  });
});

/**
 * Slice 10c overnight #24 — JOIN session_exercise must use
 * `set.session_exercise_id` (v019 isolation key) so when a single session
 * holds TWO session_exercise cards with the SAME exercise_id (e.g. solo
 * Bench Press + RS A-side Bench Press), `is_in_cluster` is computed per-row,
 * not multiplied across both cards.
 *
 * Pre-fix: `LEFT JOIN session_exercise ON (session_id, exercise_id)` matched
 * BOTH cards, row-multiplied sets, and the CASE expression flipped to 1 even
 * for solo sets. → 「只含超級組」filter showed all bench sets (solo + RS), and
 * 「不含超級組」filter showed nothing.
 */
describe('queryExerciseHistory / listExerciseHistoryBySession — session_exercise_id isolation (#24)', () => {
  let db: BetterSqliteDatabase;
  let ex: TestExercises;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    ex = await pickThreeExercises(db);
  });

  afterEach(() => {
    db.close();
  });

  async function seedSameSessionSoloAndRsBench(): Promise<void> {
    // Real superset row (FK on session_exercise.reusable_superset_id)
    const rsId = await insertReusableSuperset(
      db,
      {
        name: 'Bench + Squat RS',
        color_hex: null,
        exercise_ids: [ex.bench, ex.squat],
      },
      () => 'rs-template-1',
      () => NOW_MS
    );
    await createSession(db, { id: 'sess-1', started_at: NOW_MS });

    // Card 1: solo Bench Press (no cluster — no parent_id, nobody's parent)
    await insertSessionExercise(db, {
      id: 'se-solo-bench',
      session_id: 'sess-1',
      exercise_id: ex.bench,
      ordering: 0,
      planned_sets: 3,
      planned_reps: null,
      planned_weight_kg: null,
      template_id: null,
      is_evergreen: 0,
      parent_id: null,
      reusable_superset_id: null,
    });
    // Card 2: RS A-side Bench Press (parent of Squat B-side)
    await insertSessionExercise(db, {
      id: 'se-rs-bench',
      session_id: 'sess-1',
      exercise_id: ex.bench,
      ordering: 1,
      planned_sets: 3,
      planned_reps: null,
      planned_weight_kg: null,
      template_id: null,
      is_evergreen: 0,
      parent_id: null,
      reusable_superset_id: rsId,
    });
    // Card 3: RS B-side Squat (parent_id = se-rs-bench)
    await insertSessionExercise(db, {
      id: 'se-rs-squat',
      session_id: 'sess-1',
      exercise_id: ex.squat,
      ordering: 2,
      planned_sets: 3,
      planned_reps: null,
      planned_weight_kg: null,
      template_id: null,
      is_evergreen: 0,
      parent_id: 'se-rs-bench',
      reusable_superset_id: rsId,
    });

    // 3 solo Bench sets — heavy (matches user's reported scenario: 90×5/95×3/95×3)
    await insertSessionSet(db, {
      id: 'set-solo-1',
      session_id: 'sess-1',
      exercise_id: ex.bench,
      weight_kg: 90,
      reps: 5,
      is_skipped: 0,
      ordering: 1,
      created_at: NOW_MS + 1,
      set_kind: 'working',
      parent_set_id: null,
      session_exercise_id: 'se-solo-bench',
    });
    await insertSessionSet(db, {
      id: 'set-solo-2',
      session_id: 'sess-1',
      exercise_id: ex.bench,
      weight_kg: 95,
      reps: 3,
      is_skipped: 0,
      ordering: 2,
      created_at: NOW_MS + 2,
      set_kind: 'working',
      parent_set_id: null,
      session_exercise_id: 'se-solo-bench',
    });
    await insertSessionSet(db, {
      id: 'set-solo-3',
      session_id: 'sess-1',
      exercise_id: ex.bench,
      weight_kg: 95,
      reps: 3,
      is_skipped: 0,
      ordering: 3,
      created_at: NOW_MS + 3,
      set_kind: 'working',
      parent_set_id: null,
      session_exercise_id: 'se-solo-bench',
    });

    // 1 RS A-side Bench set — light (20×10)
    await insertSessionSet(db, {
      id: 'set-rs-bench',
      session_id: 'sess-1',
      exercise_id: ex.bench,
      weight_kg: 20,
      reps: 10,
      is_skipped: 0,
      ordering: 4,
      created_at: NOW_MS + 4,
      set_kind: 'working',
      parent_set_id: null,
      session_exercise_id: 'se-rs-bench',
    });
    // 1 RS B-side Squat set
    await insertSessionSet(db, {
      id: 'set-rs-squat',
      session_id: 'sess-1',
      exercise_id: ex.squat,
      weight_kg: 60,
      reps: 8,
      is_skipped: 0,
      ordering: 5,
      created_at: NOW_MS + 5,
      set_kind: 'working',
      parent_set_id: null,
      session_exercise_id: 'se-rs-squat',
    });

    // history queries filter is_logged=1
    await db.runAsync(
      `UPDATE "set" SET is_logged = 1 WHERE id IN
         ('set-solo-1', 'set-solo-2', 'set-solo-3', 'set-rs-bench', 'set-rs-squat')`
    );
  }

  it('queryExerciseHistory tags solo Bench rows as is_in_cluster=false and RS A-side Bench row as true (no row-multiply)', async () => {
    await seedSameSessionSoloAndRsBench();
    const rows = await queryExerciseHistory(db, ex.bench);
    // Exactly 4 rows for Bench (3 solo + 1 RS); pre-fix this row-multiplied.
    expect(rows).toHaveLength(4);
    const byId = new Map(rows.map((r) => [r.set_id, r]));
    expect(byId.get('set-solo-1')!.is_in_cluster).toBe(false);
    expect(byId.get('set-solo-2')!.is_in_cluster).toBe(false);
    expect(byId.get('set-solo-3')!.is_in_cluster).toBe(false);
    expect(byId.get('set-rs-bench')!.is_in_cluster).toBe(true);
  });

  it('filterSetsByClusterMode(rows, "cluster_only") returns ONLY the RS A-side set (not the 3 solo)', async () => {
    await seedSameSessionSoloAndRsBench();
    const rows = await queryExerciseHistory(db, ex.bench);
    const clusterOnly = filterSetsByClusterMode(rows, 'cluster_only');
    expect(clusterOnly.map((r) => r.set_id)).toEqual(['set-rs-bench']);
  });

  it('filterSetsByClusterMode(rows, "exclude_cluster") returns ONLY the 3 solo sets', async () => {
    await seedSameSessionSoloAndRsBench();
    const rows = await queryExerciseHistory(db, ex.bench);
    const soloOnly = filterSetsByClusterMode(rows, 'exclude_cluster');
    expect(soloOnly.map((r) => r.set_id).sort()).toEqual([
      'set-solo-1',
      'set-solo-2',
      'set-solo-3',
    ]);
  });

  it('listExerciseHistoryBySession returns per-row is_in_cluster correctly (4 rows, mixed flags)', async () => {
    await seedSameSessionSoloAndRsBench();
    const sessions = await listExerciseHistoryBySession(db, ex.bench);
    expect(sessions).toHaveLength(1);
    const sets = sessions[0].sets;
    expect(sets).toHaveLength(4);
    const bySetId = new Map(sets.map((s) => [s.set_id, s]));
    expect(bySetId.get('set-solo-1')!.is_in_cluster).toBe(false);
    expect(bySetId.get('set-solo-2')!.is_in_cluster).toBe(false);
    expect(bySetId.get('set-solo-3')!.is_in_cluster).toBe(false);
    expect(bySetId.get('set-rs-bench')!.is_in_cluster).toBe(true);
  });

  it('legacy NULL session_exercise_id rows still resolve via (session_id, exercise_id) fallback', async () => {
    // Pre-v019 — only one card per (session, exercise) so fallback is safe.
    await createSession(db, { id: 'sess-legacy', started_at: NOW_MS });
    await insertSessionExercise(db, {
      id: 'se-legacy',
      session_id: 'sess-legacy',
      exercise_id: ex.bench,
      ordering: 0,
      planned_sets: 3,
      planned_reps: null,
      planned_weight_kg: null,
      template_id: null,
      is_evergreen: 0,
      parent_id: null,
      reusable_superset_id: null,
    });
    // insertSet with session_exercise_id omitted (defaults to NULL)
    await insertSet(db, {
      id: 'set-legacy',
      session_id: 'sess-legacy',
      exercise_id: ex.bench,
      weight_kg: 100,
      reps: 5,
      is_skipped: 0,
      ordering: 1,
      created_at: NOW_MS + 1,
    });
    await db.runAsync(`UPDATE "set" SET is_logged = 1 WHERE id = 'set-legacy'`);

    const rows = await queryExerciseHistory(db, ex.bench);
    expect(rows).toHaveLength(1);
    expect(rows[0].set_id).toBe('set-legacy');
    expect(rows[0].is_in_cluster).toBe(false);
  });
});
