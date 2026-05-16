import { randomUUID } from 'node:crypto';
import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  insertSessionSet,
  insertSessionSetAfter,
  listSetsBySession,
} from '../../src/adapters/sqlite/setRepository';

/**
 * Right-swipe `+1` should drop new set directly below source — not at end.
 * Slice 10c Phase 2 fix (post-`3af54bf`).
 */

describe('insertSessionSetAfter', () => {
  let db: BetterSqliteDatabase;
  const exA = '00000000-0000-4000-8000-000000000001'; // Bench
  const exB = '00000000-0000-4000-8000-000000000002'; // Squat
  const sessionId = 'sess-after';
  const now = 1700000000000;

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

  async function insertSet(
    id: string,
    exercise_id: string,
    ordering: number,
    weight_kg: number,
    reps: number,
    set_kind: 'warmup' | 'working' | 'dropset' = 'working',
  ) {
    await insertSessionSet(db, {
      id,
      session_id: sessionId,
      exercise_id,
      weight_kg,
      reps,
      is_skipped: 0,
      ordering,
      created_at: now,
      set_kind,
      parent_set_id: null,
    });
  }

  it('inserts new set immediately after source (single-exercise case)', async () => {
    await insertSet('a1', exA, 1, 80, 5);
    await insertSet('a2', exA, 2, 85, 5);
    await insertSet('a3', exA, 3, 90, 5);

    const res = await insertSessionSetAfter(db, {
      session_id: sessionId,
      source_set_id: 'a1', // swipe `+1` on a1
      uuid: randomUUID,
    });

    expect(res.ordering).toBe(2);
    const rows = await listSetsBySession(db, sessionId);
    // listSetsBySession returns ordering ASC.
    expect(rows.map((r) => r.id)).toEqual(['a1', res.set_id, 'a2', 'a3']);
  });

  it('mirrors source weight / reps / set_kind to new row', async () => {
    await insertSet('w1', exA, 1, 50, 12, 'warmup');

    const res = await insertSessionSetAfter(db, {
      session_id: sessionId,
      source_set_id: 'w1',
      uuid: randomUUID,
    });

    const rows = await listSetsBySession(db, sessionId);
    const newRow = rows.find((r) => r.id === res.set_id)!;
    expect(newRow.weight_kg).toBe(50);
    expect(newRow.reps).toBe(12);
    expect(newRow.set_kind).toBe('warmup');
    expect(newRow.is_logged).toBe(0); // never inherits logged state
  });

  it('preserves other exercises relative ordering (multi-exercise case)', async () => {
    // exA at orderings [1, 3, 5]; exB at [2, 4].
    await insertSet('a1', exA, 1, 80, 5);
    await insertSet('b1', exB, 2, 60, 8);
    await insertSet('a2', exA, 3, 85, 5);
    await insertSet('b2', exB, 4, 65, 8);
    await insertSet('a3', exA, 5, 90, 5);

    // Swipe `+1` on a2 (ordering 3) → new exA set at ordering 4.
    // Downstream shift: b2 (4) → 5; a3 (5) → 6.
    const res = await insertSessionSetAfter(db, {
      session_id: sessionId,
      source_set_id: 'a2',
      uuid: randomUUID,
    });

    expect(res.ordering).toBe(4);
    const rows = await listSetsBySession(db, sessionId);
    // ordering ASC: 1=a1, 2=b1, 3=a2, 4=new, 5=b2, 6=a3.
    expect(rows.map((r) => r.id)).toEqual([
      'a1',
      'b1',
      'a2',
      res.set_id,
      'b2',
      'a3',
    ]);
  });

  it('source is last set in session → new becomes new last', async () => {
    await insertSet('a1', exA, 1, 80, 5);

    const res = await insertSessionSetAfter(db, {
      session_id: sessionId,
      source_set_id: 'a1',
      uuid: randomUUID,
    });

    expect(res.ordering).toBe(2);
    const rows = await listSetsBySession(db, sessionId);
    expect(rows.map((r) => r.id)).toEqual(['a1', res.set_id]);
  });

  it('throws when source set not found', async () => {
    await expect(
      insertSessionSetAfter(db, {
        session_id: sessionId,
        source_set_id: 'nonexistent',
        uuid: randomUUID,
      }),
    ).rejects.toThrow(/source set.*not found/);
  });
});
