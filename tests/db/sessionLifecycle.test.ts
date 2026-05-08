import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { listExercises } from '../../src/adapters/sqlite/exerciseRepository';
import {
  createSession,
  endSession,
  getActiveSession,
  getSession,
  listSessions,
} from '../../src/adapters/sqlite/sessionRepository';
import {
  listSetsBySession,
  recordSetInSession,
} from '../../src/adapters/sqlite/setRepository';
import { summarize } from '../../src/domain/session/sessionManager';

/**
 * Acceptance tests for slice 2: a Session can host many sets across many
 * exercises, transitions through start → record → end, and round-trips
 * through the History list + detail summary.
 *
 * Same architecture as slice 1: better-sqlite3 :memory: implements the
 * Database interface so these run as pure node jest cases.
 */
describe('Session lifecycle — multi-exercise + summary (slice 2)', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it('seeds the full Exercise Library after v001 + v002 + v006', async () => {
    const exercises = await listExercises(db);
    expect(exercises).toHaveLength(66);
    const names = exercises.map((e) => e.name).sort();
    expect(names).toContain('Bench Press');
    expect(names).toContain('Back Squat');
    expect(names).toContain('Deadlift');
    expect(names).toContain('Overhead Press');
    expect(names).toContain('Barbell Row');
    expect(names).toContain('Pull-up');
    expect(names).toContain('Push-up');
  });

  it('records multiple sets across multiple exercises in one session', async () => {
    const exercises = await listExercises(db);
    const bench = exercises.find((e) => e.name === 'Bench Press')!;
    const squat = exercises.find((e) => e.name === 'Back Squat')!;

    const session_id = 'session-1';
    const started_at = 1_700_000_000_000;
    let counter = 0;
    const uuid = () => `set-${++counter}`;
    const now = () => started_at + counter * 60_000;

    await createSession(db, { id: session_id, started_at });

    // Three sets on bench, two on squat.
    await recordSetInSession(db, {
      session_id,
      input: { exercise_id: bench.id, weight_kg: 60, reps: 10 },
      uuid,
      now,
    });
    await recordSetInSession(db, {
      session_id,
      input: { exercise_id: bench.id, weight_kg: 65, reps: 8 },
      uuid,
      now,
    });
    await recordSetInSession(db, {
      session_id,
      input: { exercise_id: squat.id, weight_kg: 80, reps: 5 },
      uuid,
      now,
    });
    await recordSetInSession(db, {
      session_id,
      input: { exercise_id: bench.id, weight_kg: 70, reps: 6 },
      uuid,
      now,
    });
    await recordSetInSession(db, {
      session_id,
      input: { exercise_id: squat.id, weight_kg: 85, reps: 5 },
      uuid,
      now,
    });

    const sets = await listSetsBySession(db, session_id);
    expect(sets).toHaveLength(5);
    // Ordering is per-session, ascending = recording order.
    expect(sets.map((s) => s.ordering)).toEqual([1, 2, 3, 4, 5]);
    expect(sets.map((s) => s.exercise_name)).toEqual([
      'Bench Press',
      'Bench Press',
      'Back Squat',
      'Bench Press',
      'Back Squat',
    ]);
  });

  it('end transitions the session and summary aggregates correctly', async () => {
    const [bench] = await listExercises(db);
    const session_id = 's-end';
    await createSession(db, { id: session_id, started_at: 1_000 });

    let counter = 0;
    const uuid = () => `set-${++counter}`;

    await recordSetInSession(db, {
      session_id,
      input: { exercise_id: bench.id, weight_kg: 60, reps: 10 },
      uuid,
      now: () => 2_000,
    });
    await recordSetInSession(db, {
      session_id,
      input: { exercise_id: bench.id, weight_kg: 60, reps: 10 },
      uuid,
      now: () => 3_000,
    });

    await endSession(db, { id: session_id, ended_at: 5_000 });

    const session = await getSession(db, session_id);
    expect(session?.ended_at).toBe(5_000);

    const sets = await listSetsBySession(db, session_id);
    const summary = summarize(session!, sets);
    expect(summary.totalSets).toBe(2);
    expect(summary.exerciseCount).toBe(1);
    expect(summary.durationMs).toBe(4_000);
    expect(summary.perExercise[0]).toEqual({
      exercise_id: bench.id,
      exercise_name: bench.name,
      setCount: 2,
    });
  });

  it('getActiveSession returns the open session, null after it ends', async () => {
    expect(await getActiveSession(db)).toBeNull();

    await createSession(db, { id: 'open-1', started_at: 1_000 });
    const active = await getActiveSession(db);
    expect(active?.id).toBe('open-1');
    expect(active?.ended_at).toBeNull();

    await endSession(db, { id: 'open-1', ended_at: 2_000 });
    expect(await getActiveSession(db)).toBeNull();
  });

  it('listSessions returns sessions newest first', async () => {
    await createSession(db, { id: 'old', started_at: 1_000 });
    await endSession(db, { id: 'old', ended_at: 2_000 });
    await createSession(db, { id: 'new', started_at: 3_000 });
    await endSession(db, { id: 'new', ended_at: 4_000 });

    const rows = await listSessions(db);
    expect(rows.map((r) => r.id)).toEqual(['new', 'old']);
  });

  it('recordSetInSession rejects invalid input without writing', async () => {
    const [bench] = await listExercises(db);
    await createSession(db, { id: 's', started_at: 1 });

    await expect(
      recordSetInSession(db, {
        session_id: 's',
        input: { exercise_id: bench.id, weight_kg: -1, reps: 10 },
        uuid: () => 'never',
      })
    ).rejects.toThrow(/non-negative/);

    expect(await listSetsBySession(db, 's')).toHaveLength(0);
  });

  it('migration is idempotent — re-running keeps the full Exercise Library', async () => {
    await migrate(db);
    const exercises = await listExercises(db);
    expect(exercises).toHaveLength(66);
  });
});
