import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  insertSessionSet,
  listSetsBySession,
  reorderSessionSetsForExercise,
} from '../../src/adapters/sqlite/setRepository';

/**
 * Slice 10c overnight (2026-05-17) 第 5 點 — cluster cycle inline drag.
 *
 * The cluster card's drag UI dispatches `reorderSessionSetsForExercise` ×2
 * (once per side: A's exercise, B's exercise), threading the per-side ordered
 * set-id arrays derived from the new cycle order. These tests cover the
 * cluster-mode invariant: each call commits independently AND together they
 * keep A/B cycle alignment intact (A.set[i] still paired with B.set[i]).
 */

describe('cluster cycle reorder (two reorderSessionSetsForExercise calls)', () => {
  let db: BetterSqliteDatabase;
  const exA = '00000000-0000-4000-8000-000000000001'; // cluster side A (Bench)
  const exB = '00000000-0000-4000-8000-000000000002'; // cluster side B (Row)
  const sessionId = 'sess-rcc';
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

  it('reorders both sides in lockstep — cycle alignment preserved', async () => {
    // 3-cycle symmetric cluster. A interleaved with B by ordering.
    // ordering: 1=a1, 2=b1, 3=a2, 4=b2, 5=a3, 6=b3.
    await insertSet('a1', exA, 1, 80, 5);
    await insertSet('b1', exB, 2, 60, 8);
    await insertSet('a2', exA, 3, 85, 5);
    await insertSet('b2', exB, 4, 65, 8);
    await insertSet('a3', exA, 5, 90, 5);
    await insertSet('b3', exB, 6, 70, 8);

    // User drags cycle 3 (a3,b3) to top → new order: cycle3, cycle1, cycle2.
    // Per-side ordered ids derived by UI: A side = [a3,a1,a2]; B side = [b3,b1,b2].
    await reorderSessionSetsForExercise(db, {
      session_id: sessionId,
      exercise_id: exA,
      orderedIds: ['a3', 'a1', 'a2'],
    });
    await reorderSessionSetsForExercise(db, {
      session_id: sessionId,
      exercise_id: exB,
      orderedIds: ['b3', 'b1', 'b2'],
    });

    // A's slots were [1,3,5] → now hold [a3,a1,a2].
    // B's slots were [2,4,6] → now hold [b3,b1,b2].
    // ASC order: 1=a3, 2=b3, 3=a1, 4=b1, 5=a2, 6=b2 — cycle alignment kept.
    const rows = await listSetsBySession(db, sessionId);
    expect(rows.map((r) => r.id)).toEqual([
      'a3',
      'b3',
      'a1',
      'b1',
      'a2',
      'b2',
    ]);
  });

  it('handles asymmetric cluster (A=3, B=2) — short side reordered only with present ids', async () => {
    // A has 3 sets, B only 2 (e.g. template-built asymmetric per Q8 AS1).
    // ordering: 1=a1, 2=b1, 3=a2, 4=b2, 5=a3.
    await insertSet('a1', exA, 1, 80, 5);
    await insertSet('b1', exB, 2, 60, 8);
    await insertSet('a2', exA, 3, 85, 5);
    await insertSet('b2', exB, 4, 65, 8);
    await insertSet('a3', exA, 5, 90, 5);

    // User drags cycle 3 (a3, null) to top.
    // Per-side ordered ids: A = [a3,a1,a2]; B = [b1,b2] (filtered, B unchanged).
    await reorderSessionSetsForExercise(db, {
      session_id: sessionId,
      exercise_id: exA,
      orderedIds: ['a3', 'a1', 'a2'],
    });
    await reorderSessionSetsForExercise(db, {
      session_id: sessionId,
      exercise_id: exB,
      orderedIds: ['b1', 'b2'],
    });

    // A's slots [1,3,5] → [a3,a1,a2]. B's slots [2,4] → unchanged [b1,b2].
    // ASC: 1=a3, 2=b1, 3=a1, 4=b2, 5=a2.
    const rows = await listSetsBySession(db, sessionId);
    expect(rows.map((r) => r.id)).toEqual([
      'a3',
      'b1',
      'a1',
      'b2',
      'a2',
    ]);
  });

  it('no-op when cluster has only 1 cycle (drag dispatched but nothing changes)', async () => {
    await insertSet('a1', exA, 1, 80, 5);
    await insertSet('b1', exB, 2, 60, 8);

    await reorderSessionSetsForExercise(db, {
      session_id: sessionId,
      exercise_id: exA,
      orderedIds: ['a1'],
    });
    await reorderSessionSetsForExercise(db, {
      session_id: sessionId,
      exercise_id: exB,
      orderedIds: ['b1'],
    });

    const rows = await listSetsBySession(db, sessionId);
    expect(rows.map((r) => r.id)).toEqual(['a1', 'b1']);
  });
});
