import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  insertDropsetFollower,
  insertSessionSet,
  listSetsBySession,
} from '../../src/adapters/sqlite/setRepository';

/**
 * `insertDropsetFollower` — report 09 #1 (2026-06-20).
 *
 * Single-sourced extraction of the tap-label-cycle `insertFollower` op that
 * was previously a non-transactional 2-step duplicated verbatim across
 * app/(tabs)/index.tsx + app/session/[id].tsx (warmup→dropset promotion:
 * the tapped row becomes a head, one follower is appended directly below).
 *
 * Invariants under test:
 *   - follower lands at head.ordering + 1
 *   - every set at/after that slot shifts +1 (chain stays contiguous, no
 *     orphan rows — the bug the 2026-05-20 ordering fix prevented)
 *   - set_kind='dropset', parent_set_id = head, weight/reps from the op args
 *   - v019: follower inherits session_exercise_id from the HEAD row (read
 *     from the DB inside the txn), not from the caller
 *   - null weight/reps pass through (the op carries number | null)
 */
describe('insertDropsetFollower', () => {
  let db: BetterSqliteDatabase;
  const exId = '00000000-0000-4000-8000-000000000001';
  const otherExId = '00000000-0000-4000-8000-000000000002';
  const sessionId = 'sess-1';
  const seId = 'se-card-A';
  const now = 1700000000000;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    await db.runAsync(`INSERT INTO session (id, started_at) VALUES (?, ?)`, sessionId, now);
  });

  afterEach(() => {
    db.close();
  });

  async function seedSet(
    id: string,
    ordering: number,
    exercise_id: string,
    set_kind: 'warmup' | 'working' | 'dropset' = 'working',
    session_exercise_id: string | null = seId,
  ) {
    await insertSessionSet(db, {
      id,
      session_id: sessionId,
      exercise_id,
      weight_kg: 80,
      reps: 10,
      is_skipped: 0,
      ordering,
      created_at: now,
      set_kind,
      parent_set_id: null,
      session_exercise_id,
    });
  }

  it('inserts follower at head.ordering+1, shifts later sets, inherits head session_exercise_id', async () => {
    // head (now a dropset head) at ordering 1; an unrelated later set at 2.
    await seedSet('head', 1, exId, 'dropset', seId);
    await seedSet('later', 2, otherExId, 'working', 'se-other');

    await insertDropsetFollower(db, {
      session_id: sessionId,
      parent_set_id: 'head',
      exercise_id: exId,
      weight_kg: 60,
      reps: 8,
      new_set_id: 'f1',
      now: () => now,
    });

    const rows = await listSetsBySession(db, sessionId);
    // Contiguity: head(1), f1(2), later shifted to 3.
    expect(rows.map((r) => [r.id, r.ordering])).toEqual([
      ['head', 1],
      ['f1', 2],
      ['later', 3],
    ]);
    const f1 = rows.find((r) => r.id === 'f1')!;
    expect(f1.set_kind).toBe('dropset');
    expect(f1.parent_set_id).toBe('head');
    expect(f1.weight_kg).toBe(60);
    expect(f1.reps).toBe(8);
    expect(f1.is_logged).toBe(0);
    // v019: inherited from the HEAD row, not passed by caller.
    expect(f1.session_exercise_id).toBe(seId);
  });

  it('NON-LAST middle insert shifts EVERY subsequent ordinal by +1 (reverse-sync root cause)', async () => {
    // This is the exact mechanic the 2026-06-28 Swift id-first reverse-apply
    // fix exists to tolerate. The iPhone `insertDropsetFollower` does
    //   UPDATE "set" SET ordering = ordering + 1 WHERE ordering >= newOrd
    // and the wire `ordinal = ordering`, so inserting a follower in the
    // MIDDLE of a session shifts the ordinal of every set AFTER it. A
    // Watch reverse-apply that matched by ordinal (not setId) would then
    // mis-align — hence the Swift fix matches setId-first. Lock the shift
    // so a future TS refactor can't silently stop producing it (which would
    // make the Swift id-first path look unnecessary and invite a regression).
    //
    // Layout BEFORE: [head(1, exA), tailA(2, exA), tailB(3, exB), tailC(4, exB)]
    // Insert a follower under `head` → it lands at ordering 2; tailA→3,
    // tailB→4, tailC→5 ALL shift (three rows, two of them a DIFFERENT
    // exercise — the shift is session-global, not card-scoped).
    await seedSet('head', 1, exId, 'dropset', seId);
    await seedSet('tailA', 2, exId, 'working', seId);
    await seedSet('tailB', 3, otherExId, 'working', 'se-other');
    await seedSet('tailC', 4, otherExId, 'working', 'se-other');

    await insertDropsetFollower(db, {
      session_id: sessionId,
      parent_set_id: 'head',
      exercise_id: exId,
      weight_kg: 60,
      reps: 8,
      new_set_id: 'f1',
      now: () => now,
    });

    const rows = await listSetsBySession(db, sessionId);
    expect(rows.map((r) => [r.id, r.ordering])).toEqual([
      ['head', 1],
      ['f1', 2],
      ['tailA', 3],
      ['tailB', 4],
      ['tailC', 5],
    ]);
  });

  it('display_rank lands the follower IMMEDIATELY after its parent head (renumberCardAfterInsert)', async () => {
    // The follower must sort directly under its head on the card, not at the
    // bottom — even when the card was previously Watch-reordered (per-card
    // display_rank space, distinct from the session-global `ordering`). Seed a
    // card whose two existing sets carry explicit display_rank 0,1, then insert
    // a follower under the head: the head keeps rank 0, the new follower takes
    // rank 1, and the old second row is pushed to rank 2.
    await seedSet('head', 1, exId, 'dropset', seId);
    await seedSet('second', 2, exId, 'working', seId);
    await db.runAsync(`UPDATE "set" SET display_rank = 0 WHERE id = 'head'`);
    await db.runAsync(`UPDATE "set" SET display_rank = 1 WHERE id = 'second'`);

    await insertDropsetFollower(db, {
      session_id: sessionId,
      parent_set_id: 'head',
      exercise_id: exId,
      weight_kg: 60,
      reps: 8,
      new_set_id: 'f1',
      now: () => now,
    });

    const byId = new Map(
      (await listSetsBySession(db, sessionId)).map((r) => [r.id, r] as const),
    );
    // Render order (display_rank): head(0) → f1(1) → second(2).
    expect(byId.get('head')!.display_rank).toBe(0);
    expect(byId.get('f1')!.display_rank).toBe(1);
    expect(byId.get('second')!.display_rank).toBe(2);
  });

  it('passes through null weight/reps from the op', async () => {
    await seedSet('head', 1, exId, 'dropset', seId);

    await insertDropsetFollower(db, {
      session_id: sessionId,
      parent_set_id: 'head',
      exercise_id: exId,
      weight_kg: null,
      reps: null,
      new_set_id: 'f1',
      now: () => now,
    });

    const f1 = (await listSetsBySession(db, sessionId)).find((r) => r.id === 'f1')!;
    expect(f1.weight_kg).toBeNull();
    expect(f1.reps).toBeNull();
  });

  it('inherits NULL session_exercise_id when the head row has none (legacy)', async () => {
    await seedSet('head', 1, exId, 'dropset', null);

    await insertDropsetFollower(db, {
      session_id: sessionId,
      parent_set_id: 'head',
      exercise_id: exId,
      weight_kg: 50,
      reps: 5,
      new_set_id: 'f1',
      now: () => now,
    });

    const f1 = (await listSetsBySession(db, sessionId)).find((r) => r.id === 'f1')!;
    expect(f1.session_exercise_id).toBeNull();
  });
});
