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
 * Slice 10c overnight (2026-05-17) 第 6 點 — right-swipe `+1` on a cluster
 * cycle should drop the new A+B pair DIRECTLY BELOW source cycle, not at
 * each side's end.
 *
 * Implementation strategy: call `insertSessionSetAfter` twice (once for A
 * source, once for B source).
 *
 * A1 no-shift (2026-06-28): each `insertSessionSetAfter` now APPENDS at
 * session-wide MAX(ordering)+1 instead of shifting later rows; the "directly
 * below source" placement is carried entirely by per-card `display_rank`
 * (each cluster side is its own session_exercise_id / exercise_id, sorted
 * independently). So these tests assert per-SIDE render order
 * (`sortSetsByDisplayRank` over each exercise's rows), not the global
 * `ORDER BY ordering` interleave.
 */

/** Per-side render order via display_rank (one card per exercise here). */
function sideRenderOrder(
  rows: Array<{ id: string; exercise_id: string; ordering: number; display_rank?: number | null }>,
  exercise_id: string,
): string[] {
  return sortSetsByDisplayRank(rows.filter((r) => r.exercise_id === exercise_id)).map(
    (r) => r.id,
  );
}

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

    // A1: newA appends at MAX+1 = 7, newB at MAX+1 = 8 (no shift of a3/b3).
    expect(aRes.ordering).toBe(7);
    expect(bRes.ordering).toBe(8);
    const rows = await listSetsBySession(db, sessionId);
    // Pre-existing ordinals untouched.
    const ordById = new Map(rows.map((r) => [r.id, r.ordering] as const));
    expect(ordById.get('a3')).toBe(5);
    expect(ordById.get('b3')).toBe(6);
    // Per-side render order: new row sits BELOW source cycle on each side.
    expect(sideRenderOrder(rows, exA)).toEqual(['a1', 'a2', aRes.set_id, 'a3']);
    expect(sideRenderOrder(rows, exB)).toEqual(['b1', 'b2', bRes.set_id, 'b3']);
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
    // A1 (no shift): newA appends at MAX+1 = 5, newB at MAX+1 = 6. The source
    // cycle (a2,b2) is the last cycle, so render order still ends with the new
    // pair on each side — but verify via per-side display_rank, not the global
    // ordering interleave.
    expect(aRes.ordering).toBe(5);
    expect(bRes.ordering).toBe(6);
    expect(sideRenderOrder(rows, exA)).toEqual(['a1', 'a2', aRes.set_id]);
    expect(sideRenderOrder(rows, exB)).toEqual(['b1', 'b2', bRes.set_id]);
  });
});
