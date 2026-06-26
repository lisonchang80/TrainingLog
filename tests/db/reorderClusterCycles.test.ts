import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  insertSessionSet,
  listSetsBySession,
  reorderSessionSetsForExercise,
} from '../../src/adapters/sqlite/setRepository';
import { sortSetsByDisplayRank } from '../../src/domain/set/sessionSetLayout';

/**
 * Cluster cycle inline drag — F2 fix (Opt A, 2026-06-26).
 *
 * The cluster card's drag UI dispatches `reorderSessionSetsForExercise` ×2 (once
 * per side), threading per-side ordered set-id arrays. Each call now writes
 * `display_rank` (0..N-1 per side), leaving `ordering` untouched. The cluster
 * card pairs A.set[i] with B.set[i] by each side's RENDER order
 * (`display_rank ?? ordering`, see `clusterCard.sortedSetsFor`), so cycle
 * alignment is asserted on the per-side render order, not on global ordering.
 */

describe('cluster cycle reorder (two reorderSessionSetsForExercise calls, F2 fix)', () => {
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

  /** One side's set ids in RENDER order (`display_rank ?? ordering`). */
  async function sideRenderOrder(exercise_id: string): Promise<string[]> {
    const rows = await listSetsBySession(db, sessionId);
    return sortSetsByDisplayRank(
      rows.filter((r) => r.exercise_id === exercise_id),
    ).map((r) => r.id);
  }

  it('reorders both sides in lockstep — cycle alignment preserved', async () => {
    await insertSet('a1', exA, 1, 80, 5);
    await insertSet('b1', exB, 2, 60, 8);
    await insertSet('a2', exA, 3, 85, 5);
    await insertSet('b2', exB, 4, 65, 8);
    await insertSet('a3', exA, 5, 90, 5);
    await insertSet('b3', exB, 6, 70, 8);

    // User drags cycle 3 (a3,b3) to top → new order: cycle3, cycle1, cycle2.
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

    // Per-side render order reflects the drop; pairing A[i]/B[i] by index gives
    // the cycles (a3,b3), (a1,b1), (a2,b2) — alignment kept.
    expect(await sideRenderOrder(exA)).toEqual(['a3', 'a1', 'a2']);
    expect(await sideRenderOrder(exB)).toEqual(['b3', 'b1', 'b2']);
  });

  it('handles asymmetric cluster (A=3, B=2) — short side reordered only with present ids', async () => {
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
    await reorderSessionSetsForExercise(db, {
      session_id: sessionId,
      exercise_id: exB,
      orderedIds: ['b1', 'b2'],
    });

    expect(await sideRenderOrder(exA)).toEqual(['a3', 'a1', 'a2']);
    expect(await sideRenderOrder(exB)).toEqual(['b1', 'b2']);
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

    expect(await sideRenderOrder(exA)).toEqual(['a1']);
    expect(await sideRenderOrder(exB)).toEqual(['b1']);
  });
});
