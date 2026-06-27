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
 * Invariants under test (A1 no-shift, 2026-06-28):
 *   - follower lands at session-wide MAX(ordering)+1 — a NON-colliding append
 *     ordinal; NO later set's `ordering` is shifted (the reverse-sync fix)
 *   - render position is carried by `display_rank`: the follower sorts
 *     IMMEDIATELY after its head per `display_rank ?? ordering`
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

  it('inserts follower at MAX(ordering)+1 WITHOUT shifting later sets, inherits head session_exercise_id', async () => {
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

    const byId = new Map(
      (await listSetsBySession(db, sessionId)).map((r) => [r.id, r] as const),
    );
    // A1 no-shift: existing ordinals are UNTOUCHED (forward reconcile keys on
    // them). The follower appends at MAX+1 = 3 (NOT head+1, which would have
    // shifted `later`). `later` keeps ordering 2.
    expect(byId.get('head')!.ordering).toBe(1);
    expect(byId.get('later')!.ordering).toBe(2);
    expect(byId.get('f1')!.ordering).toBe(3);
    const f1 = byId.get('f1')!;
    expect(f1.set_kind).toBe('dropset');
    expect(f1.parent_set_id).toBe('head');
    expect(f1.weight_kg).toBe(60);
    expect(f1.reps).toBe(8);
    expect(f1.is_logged).toBe(0);
    // v019: inherited from the HEAD row, not passed by caller.
    expect(f1.session_exercise_id).toBe(seId);
  });

  it('NON-LAST middle insert does NOT shift any later ordinal (A1 reverse-sync fix)', async () => {
    // A1 (2026-06-28) REPLACED the old `UPDATE … ordering+1 WHERE ordering >=
    // newOrd` shift with a non-colliding MAX(ordering)+1 append. This test
    // locks the new contract: inserting a follower in the MIDDLE of a session
    // leaves EVERY pre-existing set's `ordering` byte-identical, so the
    // reverse-sync wire ordinal (= `ordering`) no longer collides a shifted
    // value onto a neighbour base set on the immutable Watch — the exact bug
    // ("非末組遞減亂跳 / 1,2,2 / D2") A1 fixes. The new follower gets a unique
    // high ordinal (MAX+1) absent from the base → reverse-apply's ordinal
    // fallback routes it cleanly to addedSet.
    //
    // Layout BEFORE: [head(1, exA), tailA(2, exA), tailB(3, exB), tailC(4, exB)]
    // Insert a follower under `head` → it appends at ordering 5; head/tailA/
    // tailB/tailC ALL keep their ordinals.
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

    const byId = new Map(
      (await listSetsBySession(db, sessionId)).map((r) => [r.id, r.ordering] as const),
    );
    // No shift: every pre-existing ordinal is unchanged.
    expect(byId.get('head')).toBe(1);
    expect(byId.get('tailA')).toBe(2);
    expect(byId.get('tailB')).toBe(3);
    expect(byId.get('tailC')).toBe(4);
    // New follower appends at MAX+1 = 5 (unique, non-colliding).
    expect(byId.get('f1')).toBe(5);
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
