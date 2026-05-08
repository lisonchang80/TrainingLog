import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { listExercises } from '../../src/adapters/sqlite/exerciseRepository';
import {
  createSession,
  endSession,
  setSessionBwSnapshot,
} from '../../src/adapters/sqlite/sessionRepository';
import { recordSetInSession, insertSet } from '../../src/adapters/sqlite/setRepository';
import {
  listExerciseHistorySets,
  listExerciseHistoryBySession,
  getExerciseHistoryHeader,
  listPriorSetsForExercise,
} from '../../src/adapters/sqlite/exerciseHistoryRepository';

/**
 * Slice 8 acceptance: cross-Template aggregation works against real schema.
 * Each test seeds two distinct sessions for the same exercise, then verifies
 * the history queries glue them together.
 */
describe('exerciseHistoryRepository — cross-Session aggregation', () => {
  let db: BetterSqliteDatabase;
  let benchId: string;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    const all = await listExercises(db);
    benchId = all.find((e) => e.name === 'Bench Press')!.id;
  });

  afterEach(() => {
    db.close();
  });

  it('lists every set for an exercise across multiple sessions, latest first', async () => {
    let counter = 0;
    const uuid = () => `id-${++counter}`;

    // Session A: 3 sets at 80×10
    await createSession(db, { id: 'sess-A', started_at: 1_000 });
    for (let i = 0; i < 3; i++) {
      await recordSetInSession(db, {
        session_id: 'sess-A',
        input: { exercise_id: benchId, weight_kg: 80, reps: 10 },
        uuid,
        now: () => 1_000 + i,
      });
    }
    await endSession(db, { id: 'sess-A', ended_at: 1_010 });

    // Session B: 2 sets at 85×8
    await createSession(db, { id: 'sess-B', started_at: 2_000 });
    for (let i = 0; i < 2; i++) {
      await recordSetInSession(db, {
        session_id: 'sess-B',
        input: { exercise_id: benchId, weight_kg: 85, reps: 8 },
        uuid,
        now: () => 2_000 + i,
      });
    }

    const sets = await listExerciseHistorySets(db, benchId);
    expect(sets).toHaveLength(5);
    // Latest first — session B's sets appear before A's
    expect(sets[0].weight_kg).toBe(85);
    expect(sets[0].session_id).toBe('sess-B');
    expect(sets[4].weight_kg).toBe(80);
    expect(sets[4].session_id).toBe('sess-A');
    // load_type is joined from exercise table
    expect(sets[0].load_type).toBe('loaded');
    // bw_snapshot null for sessions that didn't set one
    expect(sets[0].bw_snapshot_kg).toBeNull();
  });

  it('groups sets by session, sessions DESC, sets within session ASC by ordering', async () => {
    let counter = 0;
    const uuid = () => `id-${++counter}`;

    await createSession(db, { id: 'sess-A', started_at: 1_000 });
    await recordSetInSession(db, {
      session_id: 'sess-A',
      input: { exercise_id: benchId, weight_kg: 80, reps: 10 },
      uuid,
      now: () => 1_001,
    });
    await recordSetInSession(db, {
      session_id: 'sess-A',
      input: { exercise_id: benchId, weight_kg: 85, reps: 8 },
      uuid,
      now: () => 1_002,
    });

    await createSession(db, { id: 'sess-B', started_at: 2_000 });
    await recordSetInSession(db, {
      session_id: 'sess-B',
      input: { exercise_id: benchId, weight_kg: 90, reps: 6 },
      uuid,
      now: () => 2_001,
    });

    const grouped = await listExerciseHistoryBySession(db, benchId);
    expect(grouped).toHaveLength(2);
    expect(grouped[0].session_id).toBe('sess-B');
    expect(grouped[0].sets).toHaveLength(1);
    expect(grouped[1].session_id).toBe('sess-A');
    expect(grouped[1].sets).toHaveLength(2);
    expect(grouped[1].sets[0].ordering).toBe(1);
    expect(grouped[1].sets[1].ordering).toBe(2);
  });

  it('skips is_skipped=1 rows', async () => {
    await createSession(db, { id: 'sess-A', started_at: 1_000 });
    await insertSet(db, {
      id: 'set-1',
      session_id: 'sess-A',
      exercise_id: benchId,
      weight_kg: 80,
      reps: 10,
      is_skipped: 0,
      ordering: 1,
      created_at: 1_000,
    });
    await insertSet(db, {
      id: 'set-2',
      session_id: 'sess-A',
      exercise_id: benchId,
      weight_kg: 80,
      reps: 10,
      is_skipped: 1,
      ordering: 2,
      created_at: 1_001,
    });

    const sets = await listExerciseHistorySets(db, benchId);
    expect(sets).toHaveLength(1);
    expect(sets[0].set_id).toBe('set-1');
  });

  it('exposes session bw_snapshot for assisted-class effective-load math', async () => {
    // Find an assisted-class exercise from v006 seed
    const all = await listExercises(db);
    const assisted = all.find((e) => e.load_type === 'assisted');
    expect(assisted).toBeDefined();

    await createSession(db, {
      id: 'sess-A',
      started_at: 1_000,
      bodyweight_snapshot_kg: 75,
    });
    await insertSet(db, {
      id: 'set-1',
      session_id: 'sess-A',
      exercise_id: assisted!.id,
      weight_kg: 30,
      reps: 8,
      is_skipped: 0,
      ordering: 1,
      created_at: 1_001,
    });

    const sets = await listExerciseHistorySets(db, assisted!.id);
    expect(sets).toHaveLength(1);
    expect(sets[0].bw_snapshot_kg).toBe(75);
    expect(sets[0].load_type).toBe('assisted');
  });

  it('header returns null for an unknown exercise', async () => {
    const h = await getExerciseHistoryHeader(db, 'not-a-real-id');
    expect(h).toBeNull();
  });

  it('header counts distinct sessions, including 7-day window', async () => {
    const NOW = 1_700_000_000_000;
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;

    // Old session — 30 days ago
    await createSession(db, { id: 'sess-old', started_at: NOW - 30 * ONE_DAY_MS });
    await insertSet(db, {
      id: 'set-old',
      session_id: 'sess-old',
      exercise_id: benchId,
      weight_kg: 70,
      reps: 10,
      is_skipped: 0,
      ordering: 1,
      created_at: NOW - 30 * ONE_DAY_MS,
    });

    // Recent session — 2 days ago
    await createSession(db, { id: 'sess-recent', started_at: NOW - 2 * ONE_DAY_MS });
    await insertSet(db, {
      id: 'set-recent',
      session_id: 'sess-recent',
      exercise_id: benchId,
      weight_kg: 80,
      reps: 8,
      is_skipped: 0,
      ordering: 1,
      created_at: NOW - 2 * ONE_DAY_MS,
    });

    const h = await getExerciseHistoryHeader(db, benchId, () => NOW);
    expect(h).not.toBeNull();
    expect(h!.exercise_name).toBe('Bench Press');
    expect(h!.total_sessions).toBe(2);
    expect(h!.sessions_last_7_days).toBe(1);
    expect(h!.load_type).toBe('loaded');
  });

  it('listPriorSetsForExercise excludes the cutoff timestamp itself (strict <)', async () => {
    await createSession(db, { id: 'sess-A', started_at: 1_000 });
    await insertSet(db, {
      id: 'set-1',
      session_id: 'sess-A',
      exercise_id: benchId,
      weight_kg: 70,
      reps: 10,
      is_skipped: 0,
      ordering: 1,
      created_at: 1_000,
    });
    await insertSet(db, {
      id: 'set-2',
      session_id: 'sess-A',
      exercise_id: benchId,
      weight_kg: 80,
      reps: 8,
      is_skipped: 0,
      ordering: 2,
      created_at: 2_000,
    });

    // Asking for "priors before set-2" should return set-1 only
    const priors = await listPriorSetsForExercise(db, benchId, 2_000);
    expect(priors).toHaveLength(1);
    expect(priors[0].set_id).toBe('set-1');
  });

  it('only returns sets for the requested exercise (filter works)', async () => {
    const all = await listExercises(db);
    const squat = all.find((e) => e.name === 'Back Squat')!;

    await createSession(db, { id: 'sess-A', started_at: 1_000 });
    await insertSet(db, {
      id: 'set-bench',
      session_id: 'sess-A',
      exercise_id: benchId,
      weight_kg: 80,
      reps: 8,
      is_skipped: 0,
      ordering: 1,
      created_at: 1_000,
    });
    await insertSet(db, {
      id: 'set-squat',
      session_id: 'sess-A',
      exercise_id: squat.id,
      weight_kg: 100,
      reps: 5,
      is_skipped: 0,
      ordering: 2,
      created_at: 1_001,
    });

    const benchHistory = await listExerciseHistorySets(db, benchId);
    expect(benchHistory).toHaveLength(1);
    expect(benchHistory[0].set_id).toBe('set-bench');

    const squatHistory = await listExerciseHistorySets(db, squat.id);
    expect(squatHistory).toHaveLength(1);
    expect(squatHistory[0].set_id).toBe('set-squat');
  });

  it('setSessionBwSnapshot value flows through the join', async () => {
    await createSession(db, { id: 'sess-A', started_at: 1_000 });
    await setSessionBwSnapshot(db, { id: 'sess-A', bodyweight_snapshot_kg: 78.5 });
    await insertSet(db, {
      id: 'set-1',
      session_id: 'sess-A',
      exercise_id: benchId,
      weight_kg: 80,
      reps: 8,
      is_skipped: 0,
      ordering: 1,
      created_at: 1_001,
    });

    const sets = await listExerciseHistorySets(db, benchId);
    expect(sets[0].bw_snapshot_kg).toBe(78.5);
  });
});
