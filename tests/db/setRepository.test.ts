import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { listExercises } from '../../src/adapters/sqlite/exerciseRepository';
import {
  recordSetAsAutoSession,
  listAllSets,
  listAllSetsWithExercise,
} from '../../src/adapters/sqlite/setRepository';
import { getSession } from '../../src/adapters/sqlite/sessionRepository';

/**
 * Acceptance test for slice 1: a Set written via the public API can be read
 * back with all fields intact, including the auto-created Session.
 *
 * Uses better-sqlite3 in-memory (not expo-sqlite) so jest can run in pure
 * node. The shared `Database` interface guarantees this exercises the same
 * repository code paths the production iOS build will run.
 */
describe('setRepository — Set write/read round-trip (slice 1)', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it('seeds the built-in Bench Press exercise via v001 migration', async () => {
    const exercises = await listExercises(db);
    expect(exercises).toHaveLength(1);
    expect(exercises[0]).toMatchObject({
      name: 'Bench Press',
      load_type: 'loaded',
      is_builtin: 1,
      is_archived: 0,
    });
  });

  it('records a set + auto-session and reads them back identically', async () => {
    // Inject deterministic UUID + clock for predictable assertions.
    const ids = ['session-1', 'set-1'];
    const uuid = () => ids.shift()!;
    const now = () => 1_700_000_000_000; // fixed unix ms

    const [exercise] = await listExercises(db);

    const result = await recordSetAsAutoSession(
      db,
      { exercise_id: exercise.id, weight_kg: 60, reps: 10 },
      uuid,
      now
    );

    expect(result).toEqual({ session_id: 'session-1', set_id: 'set-1' });

    const sets = await listAllSets(db);
    expect(sets).toHaveLength(1);
    expect(sets[0]).toEqual({
      id: 'set-1',
      session_id: 'session-1',
      exercise_id: exercise.id,
      weight_kg: 60,
      reps: 10,
      is_skipped: 0,
      ordering: 1,
      created_at: 1_700_000_000_000,
    });

    const session = await getSession(db, 'session-1');
    expect(session).toEqual({
      id: 'session-1',
      started_at: 1_700_000_000_000,
      ended_at: 1_700_000_000_000,
      bodyweight_snapshot_kg: null,
    });
  });

  it('joins exercise name when reading via listAllSetsWithExercise', async () => {
    const [exercise] = await listExercises(db);
    let counter = 0;
    const uuid = () => `id-${++counter}`;

    await recordSetAsAutoSession(
      db,
      { exercise_id: exercise.id, weight_kg: 80, reps: 5 },
      uuid
    );

    const rows = await listAllSetsWithExercise(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].exercise_name).toBe('Bench Press');
    expect(rows[0].weight_kg).toBe(80);
    expect(rows[0].reps).toBe(5);
  });

  it('rejects invalid input without writing anything', async () => {
    const [exercise] = await listExercises(db);
    const uuid = () => 'never-used'; // validation throws before uuid is called

    await expect(
      recordSetAsAutoSession(
        db,
        { exercise_id: exercise.id, weight_kg: -1, reps: 10 },
        uuid
      )
    ).rejects.toThrow(/non-negative/);

    await expect(
      recordSetAsAutoSession(
        db,
        { exercise_id: exercise.id, weight_kg: 60, reps: 0 },
        uuid
      )
    ).rejects.toThrow(/positive integer/);

    expect(await listAllSets(db)).toHaveLength(0);
  });

  it('migration is idempotent — running twice does not create extra exercise rows', async () => {
    await migrate(db); // already ran in beforeEach; this is the second call
    const exercises = await listExercises(db);
    expect(exercises).toHaveLength(1);
  });
});
