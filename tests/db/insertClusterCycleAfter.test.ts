import { randomUUID } from 'node:crypto';
import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  insertSessionSet,
  insertSessionSetAfter,
  listSetsBySession,
} from '../../src/adapters/sqlite/setRepository';

/**
 * Slice 10c overnight (2026-05-17) 第 6 點 — right-swipe `+1` on a cluster
 * cycle should drop the new A+B pair DIRECTLY BELOW source cycle, not at
 * each side's end.
 *
 * Implementation strategy: call `insertSessionSetAfter` twice (once for A
 * source, once for B source). Each call shifts everything `>= new_ordering`
 * by +1 in the session, so by the time the B call runs, b_source's ordering
 * has been pushed down by 1 — but the repo re-reads source ordering inside
 * the call, so transitive correctness is preserved.
 */

describe('cluster cycle insert after source (two insertSessionSetAfter calls)', () => {
  let db: BetterSqliteDatabase;
  const exA = '00000000-0000-4000-8000-000000000001'; // cluster A
  const exB = '00000000-0000-4000-8000-000000000002'; // cluster B
  const sessionId = 'sess-icc';
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

  it('inserts new pair directly below source cycle (middle cycle case)', async () => {
    // 3-cycle symmetric cluster, interleaved A/B by ordering.
    // 1=a1, 2=b1, 3=a2, 4=b2, 5=a3, 6=b3.
    await insertSet('a1', exA, 1, 80, 5);
    await insertSet('b1', exB, 2, 60, 8);
    await insertSet('a2', exA, 3, 85, 5);
    await insertSet('b2', exB, 4, 65, 8);
    await insertSet('a3', exA, 5, 90, 5);
    await insertSet('b3', exB, 6, 70, 8);

    // User swipes +1 on cycle 2 (a2,b2).
    const aRes = await insertSessionSetAfter(db, {
      session_id: sessionId,
      source_set_id: 'a2',
      uuid: randomUUID,
    });
    const bRes = await insertSessionSetAfter(db, {
      session_id: sessionId,
      source_set_id: 'b2',
      uuid: randomUUID,
    });

    // Expected ordering ASC after both shifts:
    //   1=a1, 2=b1, 3=a2, 4=newA, 5=b2, 6=newB, 7=a3, 8=b3.
    const rows = await listSetsBySession(db, sessionId);
    expect(rows.map((r) => r.id)).toEqual([
      'a1',
      'b1',
      'a2',
      aRes.set_id,
      'b2',
      bRes.set_id,
      'a3',
      'b3',
    ]);
    // New pair sits BELOW source cycle's A and B respectively.
    expect(aRes.ordering).toBe(4);
    expect(bRes.ordering).toBe(6);
  });

  it('mirrors source weight/reps/set_kind on each side', async () => {
    // Asymmetric set_kind to verify each side independently carries source kind.
    await insertSet('a1', exA, 1, 100, 3, 'working');
    await insertSet('b1', exB, 2, 30, 12, 'warmup');

    const aRes = await insertSessionSetAfter(db, {
      session_id: sessionId,
      source_set_id: 'a1',
      uuid: randomUUID,
    });
    const bRes = await insertSessionSetAfter(db, {
      session_id: sessionId,
      source_set_id: 'b1',
      uuid: randomUUID,
    });

    const rows = await listSetsBySession(db, sessionId);
    const newA = rows.find((r) => r.id === aRes.set_id)!;
    const newB = rows.find((r) => r.id === bRes.set_id)!;
    expect(newA.weight_kg).toBe(100);
    expect(newA.reps).toBe(3);
    expect(newA.set_kind).toBe('working');
    expect(newA.is_logged).toBe(0); // clone never inherits logged
    expect(newB.weight_kg).toBe(30);
    expect(newB.reps).toBe(12);
    expect(newB.set_kind).toBe('warmup');
    expect(newB.is_logged).toBe(0);
  });

  it('asymmetric cluster (a present, b missing) inserts only A side', async () => {
    // A has 2 sets, B has 1 — short-side cycle 2's b is null.
    // 1=a1, 2=b1, 3=a2.
    await insertSet('a1', exA, 1, 80, 5);
    await insertSet('b1', exB, 2, 60, 8);
    await insertSet('a2', exA, 3, 85, 5);

    // User swipes +1 on cycle 2 (a2 only, b is null).
    // Caller passes args.b_set_id = null → skips B call.
    const aRes = await insertSessionSetAfter(db, {
      session_id: sessionId,
      source_set_id: 'a2',
      uuid: randomUUID,
    });
    // (No B call)

    const rows = await listSetsBySession(db, sessionId);
    // a2 is last ordering → newA gets MAX+1 = 4.
    expect(aRes.ordering).toBe(4);
    expect(rows.map((r) => r.id)).toEqual([
      'a1',
      'b1',
      'a2',
      aRes.set_id,
    ]);
  });

  it('source is last cycle — new pair becomes new last (correct ordering still)', async () => {
    // 2-cycle cluster: 1=a1, 2=b1, 3=a2, 4=b2.
    await insertSet('a1', exA, 1, 80, 5);
    await insertSet('b1', exB, 2, 60, 8);
    await insertSet('a2', exA, 3, 85, 5);
    await insertSet('b2', exB, 4, 65, 8);

    // Swipe +1 on cycle 2 (last cycle).
    const aRes = await insertSessionSetAfter(db, {
      session_id: sessionId,
      source_set_id: 'a2',
      uuid: randomUUID,
    });
    const bRes = await insertSessionSetAfter(db, {
      session_id: sessionId,
      source_set_id: 'b2',
      uuid: randomUUID,
    });

    const rows = await listSetsBySession(db, sessionId);
    // After both:
    //   First call: src a2 at 3 → newA at 4. Shift: 1=a1, 2=b1, 3=a2, 4=newA, 5=b2.
    //   Second call: src b2 now at 5 → newB at 6. Shift: nothing >= 6.
    // Final: 1=a1, 2=b1, 3=a2, 4=newA, 5=b2, 6=newB.
    expect(rows.map((r) => r.id)).toEqual([
      'a1',
      'b1',
      'a2',
      aRes.set_id,
      'b2',
      bRes.set_id,
    ]);
  });
});
