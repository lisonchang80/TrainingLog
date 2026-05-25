import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  insertSessionSet,
  listSetsBySession,
  reorderSessionSetsForExercise,
} from '../../src/adapters/sqlite/setRepository';

/**
 * Slice 10c Phase 2 commit 9 留尾 — set-row long-press reorder modal.
 * Tests that reorder within one exercise preserves OTHER exercises'
 * set orderings (slot-based renumber).
 */

describe('reorderSessionSetsForExercise', () => {
  let db: BetterSqliteDatabase;
  const exA = '00000000-0000-4000-8000-000000000001'; // Bench
  const exB = '00000000-0000-4000-8000-000000000002'; // Squat
  const sessionId = 'sess-reorder';
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

  async function insertSet(
    id: string,
    exercise_id: string,
    ordering: number,
    weight_kg: number,
    reps: number,
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
      set_kind: 'working',
      parent_set_id: null,
    });
  }

  it('basic reorder within one exercise: 3 sets, swap first & last', async () => {
    await insertSet('a1', exA, 1, 80, 5);
    await insertSet('a2', exA, 2, 85, 5);
    await insertSet('a3', exA, 3, 90, 5);

    await reorderSessionSetsForExercise(db, {
      session_id: sessionId,
      exercise_id: exA,
      orderedIds: ['a3', 'a2', 'a1'],
    });

    const rows = await listSetsBySession(db, sessionId);
    // listSetsBySession returns ORDER BY ordering ASC.
    expect(rows.map((r) => r.id)).toEqual(['a3', 'a2', 'a1']);
  });

  it('preserves other exercises set orderings (slot-based renumber)', async () => {
    // exA sets at orderings [1, 3, 5]; exB sets at [2, 4].
    await insertSet('a1', exA, 1, 80, 5);
    await insertSet('b1', exB, 2, 60, 8);
    await insertSet('a2', exA, 3, 85, 5);
    await insertSet('b2', exB, 4, 65, 8);
    await insertSet('a3', exA, 5, 90, 5);

    await reorderSessionSetsForExercise(db, {
      session_id: sessionId,
      exercise_id: exA,
      orderedIds: ['a3', 'a1', 'a2'],
    });

    const rows = await listSetsBySession(db, sessionId);
    // exA's slots [1, 3, 5] now hold [a3, a1, a2]; exB unchanged.
    // Sorted by ordering ASC: 1=a3, 2=b1, 3=a1, 4=b2, 5=a2.
    expect(rows.map((r) => r.id)).toEqual(['a3', 'b1', 'a1', 'b2', 'a2']);
  });

  it('single set is a no-op', async () => {
    await insertSet('a1', exA, 1, 80, 5);

    await reorderSessionSetsForExercise(db, {
      session_id: sessionId,
      exercise_id: exA,
      orderedIds: ['a1'],
    });

    const rows = await listSetsBySession(db, sessionId);
    expect(rows.map((r) => r.id)).toEqual(['a1']);
  });

  it('throws on id-count mismatch (caller drift)', async () => {
    await insertSet('a1', exA, 1, 80, 5);
    await insertSet('a2', exA, 2, 85, 5);

    await expect(
      reorderSessionSetsForExercise(db, {
        session_id: sessionId,
        exercise_id: exA,
        orderedIds: ['a1'], // missing a2
      }),
    ).rejects.toThrow(/id-count mismatch/);
  });

  it('throws if orderedIds includes a foreign set id (count matches)', async () => {
    await insertSet('a1', exA, 1, 80, 5);
    await insertSet('a2', exA, 2, 85, 5);
    await insertSet('b1', exB, 3, 60, 8);

    // Count matches (2 ids for exA's 2 sets), but b1 belongs to exB.
    await expect(
      reorderSessionSetsForExercise(db, {
        session_id: sessionId,
        exercise_id: exA,
        orderedIds: ['a1', 'b1'],
      }),
    ).rejects.toThrow(/not in this exercise's sets/);
  });
});
