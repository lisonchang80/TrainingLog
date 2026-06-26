import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  insertSessionSet,
  listSetsBySession,
  reorderSessionSetsForExercise,
} from '../../src/adapters/sqlite/setRepository';
import { sortSetsByDisplayRank } from '../../src/domain/set/sessionSetLayout';

/**
 * reorderSessionSetsForExercise — F2 fix (Opt A, 2026-06-26).
 *
 * A long-press reorder now writes the new order to `display_rank` (the display
 * sort key every render surface reads via `display_rank ?? ordering`), 0..N-1 in
 * the dropped order, and LEAVES `ordering` untouched as the immutable reconcile
 * identity key (ADR-0019 §2026-06-02). Previously it rewrote `ordering`, which
 * the comparator ignores on any card carrying `display_rank` → silent no-op (F2).
 *
 * So assertions are on the RENDER order (`sortSetsByDisplayRank`) + the
 * `display_rank` values, NOT on `listSetsBySession`'s `ORDER BY ordering`
 * (= creation / identity order, which now stays put).
 */

describe('reorderSessionSetsForExercise (F2 fix — writes display_rank)', () => {
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

  /** A card's set ids in RENDER order (`display_rank ?? ordering`). */
  async function renderOrder(exercise_id: string): Promise<string[]> {
    const rows = await listSetsBySession(db, sessionId);
    return sortSetsByDisplayRank(
      rows.filter((r) => r.exercise_id === exercise_id),
    ).map((r) => r.id);
  }

  it('basic reorder: render order = new order, display_rank stamped 0..N, ordering untouched', async () => {
    await insertSet('a1', exA, 1, 80, 5);
    await insertSet('a2', exA, 2, 85, 5);
    await insertSet('a3', exA, 3, 90, 5);

    await reorderSessionSetsForExercise(db, {
      session_id: sessionId,
      exercise_id: exA,
      orderedIds: ['a3', 'a2', 'a1'],
    });

    // Render order reflects the drop.
    expect(await renderOrder(exA)).toEqual(['a3', 'a2', 'a1']);

    const rows = await listSetsBySession(db, sessionId);
    const byId = new Map(rows.map((r) => [r.id, r]));
    // display_rank = 0..N-1 in dropped order.
    expect(byId.get('a3')!.display_rank).toBe(0);
    expect(byId.get('a2')!.display_rank).toBe(1);
    expect(byId.get('a1')!.display_rank).toBe(2);
    // ordering (identity) untouched — NOT re-stamped for display.
    expect(byId.get('a1')!.ordering).toBe(1);
    expect(byId.get('a2')!.ordering).toBe(2);
    expect(byId.get('a3')!.ordering).toBe(3);
  });

  it('reorder is no longer a silent no-op on a card that already carries display_rank (the F2 bug)', async () => {
    // Simulate a Watch-reordered card: display_rank already non-NULL (0,1,2)
    // matching ordering. The OLD code rewrote `ordering` → comparator ignored it
    // → no-op. The fix rewrites display_rank → the reorder takes effect.
    await insertSet('a1', exA, 1, 80, 5);
    await insertSet('a2', exA, 2, 85, 5);
    await insertSet('a3', exA, 3, 90, 5);
    await db.runAsync(`UPDATE "set" SET display_rank = ordering - 1`); // 0,1,2

    await reorderSessionSetsForExercise(db, {
      session_id: sessionId,
      exercise_id: exA,
      orderedIds: ['a2', 'a3', 'a1'],
    });

    expect(await renderOrder(exA)).toEqual(['a2', 'a3', 'a1']);
  });

  it('preserves OTHER exercises (their display_rank + ordering untouched)', async () => {
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

    expect(await renderOrder(exA)).toEqual(['a3', 'a1', 'a2']);
    // exB never touched — still NULL display_rank, render falls back to ordering.
    expect(await renderOrder(exB)).toEqual(['b1', 'b2']);
    const rows = await listSetsBySession(db, sessionId);
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get('b1')!.display_rank).toBeNull();
    expect(byId.get('b2')!.display_rank).toBeNull();
  });

  it('single set is a no-op (stamps display_rank=0)', async () => {
    await insertSet('a1', exA, 1, 80, 5);

    await reorderSessionSetsForExercise(db, {
      session_id: sessionId,
      exercise_id: exA,
      orderedIds: ['a1'],
    });

    expect(await renderOrder(exA)).toEqual(['a1']);
    const rows = await listSetsBySession(db, sessionId);
    expect(rows.find((r) => r.id === 'a1')!.display_rank).toBe(0);
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
