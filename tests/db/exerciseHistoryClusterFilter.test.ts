import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { listExercises } from '../../src/adapters/sqlite/exerciseRepository';
import {
  createSession,
  insertSessionExercise,
} from '../../src/adapters/sqlite/sessionRepository';
import { insertSet } from '../../src/adapters/sqlite/setRepository';
import {
  hasClusterHistory,
  queryExerciseHistory,
} from '../../src/adapters/sqlite/exerciseHistoryRepository';

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
