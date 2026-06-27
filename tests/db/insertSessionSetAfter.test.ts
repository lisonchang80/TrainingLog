import { randomUUID } from 'node:crypto';
import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  insertSessionSet,
  insertSessionSetAfter,
  listSetsBySession,
} from '../../src/adapters/sqlite/setRepository';
import { sortSetsByDisplayRank } from '../../src/domain/set/sessionSetLayout';

/**
 * Right-swipe `+1` should drop new set directly below source — not at end.
 * Slice 10c Phase 2 fix (post-`3af54bf`).
 *
 * A1 no-shift (2026-06-28): the "directly below source" placement is carried
 * by `display_rank` (render order), NOT by the global `ordering` integer. The
 * new row appends at session-wide MAX(ordering)+1 (no later set is shifted),
 * and `renumberCardAfterInsert` splices it after the source in the card's
 * `display_rank` space. So these tests assert RENDER order (per-card
 * `display_rank ?? ordering` via `sortSetsByDisplayRank`), not raw
 * `ORDER BY ordering`. Existing ordinals stay untouched (forward reconcile
 * keys on `(session_exercise_id, ordering)`).
 */

/** Render-ordered set ids for one card (session_exercise scope by exercise_id
 *  here — the fixtures use one card per exercise). */
function renderOrderForExercise(
  rows: Array<{ id: string; exercise_id: string; ordering: number; display_rank?: number | null }>,
  exercise_id: string,
): string[] {
  return sortSetsByDisplayRank(rows.filter((r) => r.exercise_id === exercise_id)).map(
    (r) => r.id,
  );
}

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

    // A1: appends at MAX(ordering)+1 = 4 (no shift), not source.ordering+1.
    expect(res.ordering).toBe(4);
    const rows = await listSetsBySession(db, sessionId);
    // Existing ordinals untouched.
    const ordById = new Map(rows.map((r) => [r.id, r.ordering] as const));
    expect(ordById.get('a1')).toBe(1);
    expect(ordById.get('a2')).toBe(2);
    expect(ordById.get('a3')).toBe(3);
    expect(ordById.get(res.set_id)).toBe(4);
    // Render order (display_rank) drops the new row right after the source a1.
    expect(renderOrderForExercise(rows, exA)).toEqual(['a1', res.set_id, 'a2', 'a3']);
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

  it('A1: does NOT touch any other set ordinal; render order still drops new row after source (multi-exercise case)', async () => {
    // exA at orderings [1, 3, 5]; exB at [2, 4].
    await insertSet('a1', exA, 1, 80, 5);
    await insertSet('b1', exB, 2, 60, 8);
    await insertSet('a2', exA, 3, 85, 5);
    await insertSet('b2', exB, 4, 65, 8);
    await insertSet('a3', exA, 5, 90, 5);

    // Swipe `+1` on a2 (ordering 3). A1: new exA set appends at MAX+1 = 6.
    // NO downstream shift — b2 stays 4, a3 stays 5 (the forward-reconcile
    // `(session_exercise_id, ordering)` invariant for the OTHER card holds).
    const res = await insertSessionSetAfter(db, {
      session_id: sessionId,
      source_set_id: 'a2',
      uuid: randomUUID,
    });

    expect(res.ordering).toBe(6);
    const rows = await listSetsBySession(db, sessionId);
    const ordById = new Map(rows.map((r) => [r.id, r.ordering] as const));
    // Every pre-existing ordinal is byte-identical — crucially the OTHER
    // exercise's sets (b1, b2) are untouched, so a Watch reverse-apply still
    // matches them by ordinal.
    expect(ordById.get('a1')).toBe(1);
    expect(ordById.get('b1')).toBe(2);
    expect(ordById.get('a2')).toBe(3);
    expect(ordById.get('b2')).toBe(4);
    expect(ordById.get('a3')).toBe(5);
    expect(ordById.get(res.set_id)).toBe(6);
    // Render order within the exA card: new row right after a2.
    expect(renderOrderForExercise(rows, exA)).toEqual(['a1', 'a2', res.set_id, 'a3']);
    // exB card render order is unchanged.
    expect(renderOrderForExercise(rows, exB)).toEqual(['b1', 'b2']);
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
