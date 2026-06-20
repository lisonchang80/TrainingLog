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
