import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  insertSessionSet,
  listSetsBySession,
  insertSessionSetAfter,
  insertDropsetFollower,
  recordSetInSession,
  cloneClusterCycle,
  replayCardSetsFromHistoricalSession,
} from '../../src/adapters/sqlite/setRepository';
import { sortSetsByDisplayRank } from '../../src/domain/set/sessionSetLayout';

/**
 * F1 fix (Opt A, 2026-06-26) — every iPhone-local set mutation now renumbers the
 * affected card's `display_rank` to clean integers 0..N-1 in render order, so an
 * insert lands in the right slot even on a card the Watch had reordered (where
 * existing rows carry per-card `display_rank` and a fresh insert's NULL would
 * previously fall back to its global `ordering` and sort to the wrong end).
 *
 * The canonical repro: take a card whose display order diverges from its
 * creation `ordering` (a Watch reorder), insert into the MIDDLE, and assert the
 * new row lands where the user dropped it — not at the bottom.
 */

describe('display_rank Opt A — iPhone inserts speak the per-card display space (F1)', () => {
  let db: BetterSqliteDatabase;
  const exA = '00000000-0000-4000-8000-000000000001';
  const exB = '00000000-0000-4000-8000-000000000002';
  const sessionId = 'sess-optA';
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

  async function seed(
    id: string,
    exercise_id: string,
    ordering: number,
    opts: { set_kind?: 'working' | 'dropset'; parent_set_id?: string | null } = {},
  ) {
    await insertSessionSet(db, {
      id,
      session_id: sessionId,
      exercise_id,
      weight_kg: 50 + ordering,
      reps: 8,
      is_skipped: 0,
      ordering,
      created_at: now,
      set_kind: opts.set_kind ?? 'working',
      parent_set_id: opts.parent_set_id ?? null,
    });
  }

  async function renderOrder(exercise_id: string): Promise<string[]> {
    const rows = await listSetsBySession(db, sessionId);
    return sortSetsByDisplayRank(
      rows.filter((r) => r.exercise_id === exercise_id),
    ).map((r) => r.id);
  }

  async function displayRanks(
    exercise_id: string,
  ): Promise<Array<number | null>> {
    const rows = await listSetsBySession(db, sessionId);
    return sortSetsByDisplayRank(rows.filter((r) => r.exercise_id === exercise_id)).map(
      (r) => r.display_rank,
    );
  }

  it('F1 — insertSessionSetAfter lands right after anchor on a Watch-reordered card (not at bottom)', async () => {
    // Creation order a,b,c (ordering 1,2,3). Watch reordered to display [c,b,a].
    await seed('a', exA, 1);
    await seed('b', exA, 2);
    await seed('c', exA, 3);
    await db.runAsync(`UPDATE "set" SET display_rank = 0 WHERE id = 'c'`);
    await db.runAsync(`UPDATE "set" SET display_rank = 1 WHERE id = 'b'`);
    await db.runAsync(`UPDATE "set" SET display_rank = 2 WHERE id = 'a'`);
    expect(await renderOrder(exA)).toEqual(['c', 'b', 'a']);

    // Insert after the DISPLAYED-FIRST row (c). The new row gets a large
    // global ordering (c.ordering+1) — pre-fix it would sort to the bottom.
    let n = 0;
    const { set_id } = await insertSessionSetAfter(db, {
      session_id: sessionId,
      source_set_id: 'c',
      uuid: () => `new-${++n}`,
      now: () => now,
    });

    // FIX: new row lands right after c in render order.
    expect(await renderOrder(exA)).toEqual(['c', set_id, 'b', 'a']);
    // Whole card is clean integers 0..N-1 (no NULL coordinate-space mixing).
    expect(await displayRanks(exA)).toEqual([0, 1, 2, 3]);
  });

  it('F1 — recordSetInSession append: card ends up all clean integers, new row last in render order', async () => {
    await seed('a', exA, 1);
    await seed('b', exA, 2);
    await db.runAsync(`UPDATE "set" SET display_rank = 0 WHERE id = 'b'`);
    await db.runAsync(`UPDATE "set" SET display_rank = 1 WHERE id = 'a'`);
    expect(await renderOrder(exA)).toEqual(['b', 'a']);

    let n = 0;
    const { set_id } = await recordSetInSession(db, {
      session_id: sessionId,
      input: { exercise_id: exA, weight_kg: 99, reps: 5 },
      uuid: () => `app-${++n}`,
      now: () => now,
    });

    // Append lands at the END of the card's render order.
    expect(await renderOrder(exA)).toEqual(['b', 'a', set_id]);
    expect(await displayRanks(exA)).toEqual([0, 1, 2]);
  });

  it('F1 — insertDropsetFollower lands right after its head on a reordered card', async () => {
    // Two working sets a (head-to-be), b. Watch reorder display [b, a].
    await seed('a', exA, 1);
    await seed('b', exA, 2);
    await db.runAsync(`UPDATE "set" SET display_rank = 0 WHERE id = 'b'`);
    await db.runAsync(`UPDATE "set" SET display_rank = 1 WHERE id = 'a'`);
    expect(await renderOrder(exA)).toEqual(['b', 'a']);

    // Seed a dropset follower under head 'a'.
    await insertDropsetFollower(db, {
      session_id: sessionId,
      parent_set_id: 'a',
      exercise_id: exA,
      weight_kg: 30,
      reps: 12,
      new_set_id: 'a-d1',
      now: () => now,
    });

    // Follower sits right after its head 'a' in render order.
    expect(await renderOrder(exA)).toEqual(['b', 'a', 'a-d1']);
    expect(await displayRanks(exA)).toEqual([0, 1, 2]);
  });

  it('cluster — cloneClusterCycle stamps clean display_rank on BOTH sides independently', async () => {
    // 2-cycle cluster: A=[a1,a2], B=[b1,b2] interleaved by ordering.
    await seed('a1', exA, 1);
    await seed('b1', exB, 2);
    await seed('a2', exA, 3);
    await seed('b2', exB, 4);

    await cloneClusterCycle(db, {
      a_source: { id: 'a2', exercise_id: exA },
      b_source: { id: 'b2', exercise_id: exB },
      session_id: sessionId,
      new_a_set_id: 'a3',
      new_b_set_id: 'b3',
      now: () => now,
    });

    // New cycle appended at the end of each side; clean per-side integers.
    expect(await renderOrder(exA)).toEqual(['a1', 'a2', 'a3']);
    expect(await renderOrder(exB)).toEqual(['b1', 'b2', 'b3']);
    expect(await displayRanks(exA)).toEqual([0, 1, 2]);
    expect(await displayRanks(exB)).toEqual([0, 1, 2]);
  });

  it('replay — a replayed card carries clean integer display_rank (never NULL)', async () => {
    // Source session with 2 logged sets for exA.
    const srcSession = 'sess-src';
    await db.runAsync(
      `INSERT INTO session (id, started_at) VALUES (?, ?)`,
      srcSession,
      now - 1000,
    );
    await db.runAsync(
      `INSERT INTO "set" (id, session_id, exercise_id, weight_kg, reps,
                          is_skipped, ordering, created_at, set_kind,
                          parent_set_id, is_logged, session_exercise_id)
       VALUES ('s1', ?, ?, 80, 5, 0, 1, ?, 'working', NULL, 1, NULL),
              ('s2', ?, ?, 85, 5, 0, 2, ?, 'working', NULL, 1, NULL)`,
      srcSession,
      exA,
      now - 1000,
      srcSession,
      exA,
      now - 1000,
    );
    // Current card (target) — a real session_exercise row to scope by.
    const seId = 'se-cur-A';
    await db.runAsync(
      `INSERT INTO session_exercise
         (id, session_id, exercise_id, ordering, planned_sets,
          planned_reps, planned_weight_kg, template_id, is_evergreen)
       VALUES (?, ?, ?, 1, 3, NULL, NULL, NULL, 0)`,
      seId,
      sessionId,
      exA,
    );

    let n = 0;
    const { inserted } = await replayCardSetsFromHistoricalSession(db, {
      current_session_id: sessionId,
      current_se_id: seId,
      source_session_id: srcSession,
      source_exercise_id: exA,
      uuid: () => `r-${++n}`,
      now: () => now,
    });

    expect(inserted).toBe(2);
    const rows = (await listSetsBySession(db, sessionId)).filter(
      (r) => r.session_exercise_id === seId,
    );
    const ranks = sortSetsByDisplayRank(rows).map((r) => r.display_rank);
    expect(ranks).toEqual([0, 1]); // clean integers, no NULL
  });
});
