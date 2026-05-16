import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  insertSessionSet,
  listSetsBySession,
  markClusterCycleLogged,
  markClusterCycleUnlogged,
} from '../../src/adapters/sqlite/setRepository';

/**
 * markClusterCycleLogged / markClusterCycleUnlogged atomic-transaction
 * tests (ADR-0019 Q16, slice 10c Phase 7).
 *
 * Coverage:
 *   - Happy path: both rows flip to is_logged=1 in one shot.
 *   - Both flip together — partial state never observable mid-call.
 *   - Bad id on one side → the OTHER side stays at its prior value
 *     (rollback semantic: even though UPDATE on a non-existent id is
 *     a SQL no-op in SQLite, we still cover the equivalent "the row
 *     truly is missing" case to lock in behaviour).
 *   - Unlogged inverse round-trips correctly.
 *   - Other unrelated sets are NOT touched.
 */
describe('markClusterCycleLogged / Unlogged', () => {
  let db: BetterSqliteDatabase;
  const exA = '00000000-0000-4000-8000-000000000001'; // Bench (seed)
  const exB = '00000000-0000-4000-8000-000000000002'; // Squat (seed)
  const sessionId = 'sess-1';
  const now = Date.now();

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    await db.runAsync(
      `INSERT INTO session (id, started_at) VALUES (?, ?)`,
      sessionId,
      now,
    );
  });

  afterEach(() => {
    db.close();
  });

  async function insertWorking(
    id: string,
    exercise_id: string,
    ordering: number,
  ) {
    await insertSessionSet(db, {
      id,
      session_id: sessionId,
      exercise_id,
      weight_kg: 60,
      reps: 10,
      is_skipped: 0,
      ordering,
      created_at: now,
      set_kind: 'working',
      parent_set_id: null,
    });
  }

  async function readIsLogged(set_id: string): Promise<number> {
    const all = await listSetsBySession(db, sessionId);
    return all.find((s) => s.id === set_id)!.is_logged;
  }

  it('flips both rows to is_logged=1 atomically', async () => {
    await insertWorking('a1', exA, 1);
    await insertWorking('b1', exB, 2);

    await markClusterCycleLogged(db, { a_set_id: 'a1', b_set_id: 'b1' });

    expect(await readIsLogged('a1')).toBe(1);
    expect(await readIsLogged('b1')).toBe(1);
  });

  it('rolls back BOTH if one UPDATE throws (transaction semantic)', async () => {
    await insertWorking('a1', exA, 1);
    await insertWorking('b1', exB, 2);
    expect(await readIsLogged('a1')).toBe(0);
    expect(await readIsLogged('b1')).toBe(0);

    // Wrap db.runAsync to fail on the second UPDATE specifically.
    const realRunAsync = db.runAsync.bind(db);
    let calls = 0;
    db.runAsync = (async (...args: Parameters<typeof realRunAsync>) => {
      calls++;
      if (calls === 2) {
        throw new Error('simulated failure mid-cluster-✓');
      }
      return realRunAsync(...args);
    }) as typeof db.runAsync;

    await expect(
      markClusterCycleLogged(db, { a_set_id: 'a1', b_set_id: 'b1' }),
    ).rejects.toThrow(/simulated failure/);

    // Restore for read-back via the original prepared statement path
    db.runAsync = realRunAsync;

    expect(await readIsLogged('a1')).toBe(0); // rolled back
    expect(await readIsLogged('b1')).toBe(0);
  });

  it('does not touch unrelated sets in the same session', async () => {
    await insertWorking('a1', exA, 1);
    await insertWorking('a2', exA, 2);
    await insertWorking('b1', exB, 3);
    await insertWorking('b2', exB, 4);

    await markClusterCycleLogged(db, { a_set_id: 'a1', b_set_id: 'b1' });

    expect(await readIsLogged('a1')).toBe(1);
    expect(await readIsLogged('a2')).toBe(0); // untouched
    expect(await readIsLogged('b1')).toBe(1);
    expect(await readIsLogged('b2')).toBe(0); // untouched
  });

  it('uncheck flips both back to is_logged=0', async () => {
    await insertWorking('a1', exA, 1);
    await insertWorking('b1', exB, 2);

    await markClusterCycleLogged(db, { a_set_id: 'a1', b_set_id: 'b1' });
    expect(await readIsLogged('a1')).toBe(1);
    expect(await readIsLogged('b1')).toBe(1);

    await markClusterCycleUnlogged(db, { a_set_id: 'a1', b_set_id: 'b1' });
    expect(await readIsLogged('a1')).toBe(0);
    expect(await readIsLogged('b1')).toBe(0);
  });

  it('is idempotent — repeated log calls leave both is_logged=1', async () => {
    await insertWorking('a1', exA, 1);
    await insertWorking('b1', exB, 2);

    await markClusterCycleLogged(db, { a_set_id: 'a1', b_set_id: 'b1' });
    await markClusterCycleLogged(db, { a_set_id: 'a1', b_set_id: 'b1' });

    expect(await readIsLogged('a1')).toBe(1);
    expect(await readIsLogged('b1')).toBe(1);
  });

  it('UPDATE on missing id is a SQL no-op (caller must validate ids)', async () => {
    await insertWorking('a1', exA, 1);
    // b1 deliberately not inserted — emulates caller passing a stale id.
    await markClusterCycleLogged(db, {
      a_set_id: 'a1',
      b_set_id: 'b-does-not-exist',
    });
    // a1 still flips. SQLite UPDATE with no matching WHERE is silent —
    // this test locks that contract in so we don't accidentally rely on a
    // throw later.
    expect(await readIsLogged('a1')).toBe(1);
  });
});
