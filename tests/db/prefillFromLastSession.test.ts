import { randomUUID } from 'node:crypto';
import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  insertSessionSet,
  listSetsBySession,
  prefillSessionExerciseFromLastSession,
} from '../../src/adapters/sqlite/setRepository';

/**
 * Slice 10c — [+ 動作] picker post-add: copy last session's set list verbatim
 * so user only needs to tick. Per user "如果有以前的記錄，會載入最後一次的紀錄".
 */

describe('prefillSessionExerciseFromLastSession', () => {
  let db: BetterSqliteDatabase;
  const exA = '00000000-0000-4000-8000-000000000001';
  const exB = '00000000-0000-4000-8000-000000000002';

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  async function createSession(id: string, started_at: number) {
    await db.runAsync(
      `INSERT INTO session (id, started_at, ended_at) VALUES (?, ?, ?)`,
      id,
      started_at,
      started_at + 3600_000,
    );
  }

  async function addSet(
    id: string,
    session_id: string,
    exercise_id: string,
    ordering: number,
    weight_kg: number,
    reps: number,
    set_kind: 'warmup' | 'working' | 'dropset' = 'working',
    created_at = 1_700_000_000_000,
  ) {
    await insertSessionSet(db, {
      id,
      session_id,
      exercise_id,
      weight_kg,
      reps,
      is_skipped: 0,
      ordering,
      created_at,
      set_kind,
      parent_set_id: null,
    });
  }

  it('copies last session sets into current (weight / reps / set_kind verbatim)', async () => {
    await createSession('past', 1_000_000);
    await addSet('p1', 'past', exA, 1, 50, 12, 'warmup', 1_100_000);
    await addSet('p2', 'past', exA, 2, 80, 5, 'working', 1_200_000);
    await addSet('p3', 'past', exA, 3, 85, 5, 'working', 1_300_000);

    await createSession('current', 2_000_000);

    const count = await prefillSessionExerciseFromLastSession(db, {
      session_id: 'current',
      exercise_id: exA,
      uuid: randomUUID,
    });

    expect(count).toBe(3);
    const rows = await listSetsBySession(db, 'current');
    expect(rows.map((r) => ({ w: r.weight_kg, r: r.reps, k: r.set_kind })))
      .toEqual([
        { w: 50, r: 12, k: 'warmup' },
        { w: 80, r: 5, k: 'working' },
        { w: 85, r: 5, k: 'working' },
      ]);
    // is_logged 0 for all (fresh, user must tick)
    expect(rows.every((r) => r.is_logged === 0)).toBe(true);
  });

  it('returns 0 when no prior session exists for this exercise', async () => {
    await createSession('current', 2_000_000);
    const count = await prefillSessionExerciseFromLastSession(db, {
      session_id: 'current',
      exercise_id: exA,
      uuid: randomUUID,
    });
    expect(count).toBe(0);
    const rows = await listSetsBySession(db, 'current');
    expect(rows).toHaveLength(0);
  });

  it('appends after current session MAX(ordering) — preserves earlier rows', async () => {
    await createSession('past', 1_000_000);
    await addSet('p1', 'past', exA, 1, 80, 5, 'working', 1_100_000);

    await createSession('current', 2_000_000);
    // Already have 2 sets of exB in current.
    await addSet('c1', 'current', exB, 1, 60, 8, 'working', 2_100_000);
    await addSet('c2', 'current', exB, 2, 65, 8, 'working', 2_200_000);

    await prefillSessionExerciseFromLastSession(db, {
      session_id: 'current',
      exercise_id: exA,
      uuid: randomUUID,
    });

    const rows = await listSetsBySession(db, 'current');
    expect(rows).toHaveLength(3);
    // ordering ASC = c1(1), c2(2), prefilled(3)
    expect(rows[0].id).toBe('c1');
    expect(rows[1].id).toBe('c2');
    expect(rows[2].exercise_id).toBe(exA);
    expect(rows[2].weight_kg).toBe(80);
    expect(rows[2].reps).toBe(5);
  });

  it('finds the MOST recent session (not arbitrary one)', async () => {
    await createSession('old', 1_000_000);
    await addSet('o1', 'old', exA, 1, 70, 5, 'working', 1_100_000);

    await createSession('mid', 1_500_000);
    await addSet('m1', 'mid', exA, 1, 85, 5, 'working', 1_500_100);

    await createSession('current', 2_000_000);
    await prefillSessionExerciseFromLastSession(db, {
      session_id: 'current',
      exercise_id: exA,
      uuid: randomUUID,
    });

    const rows = await listSetsBySession(db, 'current');
    expect(rows).toHaveLength(1);
    expect(rows[0].weight_kg).toBe(85); // mid is latest before current
  });

  it('does NOT copy from the same (current) session if user re-adds same exercise', async () => {
    await createSession('current', 2_000_000);
    // User already has a set of exA in current session.
    await addSet('c1', 'current', exA, 1, 100, 3, 'working', 2_100_000);

    const count = await prefillSessionExerciseFromLastSession(db, {
      session_id: 'current',
      exercise_id: exA,
      uuid: randomUUID,
    });

    expect(count).toBe(0); // Current excluded; no prior session → 0.
  });

  it('skips is_skipped rows', async () => {
    await createSession('past', 1_000_000);
    await addSet('p1', 'past', exA, 1, 80, 5, 'working', 1_100_000);
    // Mark p1 as skipped manually.
    await db.runAsync(`UPDATE "set" SET is_skipped = 1 WHERE id = ?`, 'p1');

    await createSession('current', 2_000_000);
    const count = await prefillSessionExerciseFromLastSession(db, {
      session_id: 'current',
      exercise_id: exA,
      uuid: randomUUID,
    });

    expect(count).toBe(0);
  });
});
