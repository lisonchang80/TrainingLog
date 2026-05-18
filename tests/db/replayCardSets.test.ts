import { randomUUID } from 'node:crypto';
import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  insertSessionSet,
  listSetsBySession,
  replayCardSetsFromHistoricalSession,
  replayClusterCardSetsFromHistoricalSession,
} from '../../src/adapters/sqlite/setRepository';

/**
 * Slice 10c overnight #21 —「再次訓練」button repo helpers.
 *
 * Covers:
 *   Case 1 — solo replay: 5 stale sets in target → 3 source sets → target ends
 *            with exactly 3 sets matching source (weight/reps/set_kind), all
 *            is_logged=0.
 *   Case 2 — dropset chain: source has head + follower (parent_set_id chain).
 *            After replay, the follower's parent_set_id points to the NEW head
 *            id (UUID remap correct).
 *   Case 3 — cluster replay: both A and B sides cleared and refilled from
 *            source.
 *   Case 4 — cluster asymmetric source: source has A-side sets but 0 B-side
 *            sets → target A side replaced, target B side ends empty (DELETED,
 *            not preserved).
 *   Case 5 — same-card replay (source_se == current): source rows captured
 *            BEFORE DELETE, so the card ends up with its OWN sets re-inserted
 *            (data-preserving rather than silently wiped).
 *   Case 6 — sibling solo card (same exercise_id as cluster A) is untouched
 *            by replay (#17 isolation regression).
 */
describe('replayCardSetsFromHistoricalSession (solo + cluster)', () => {
  let db: BetterSqliteDatabase;
  const exA = '00000000-0000-4000-8000-000000000001';
  const exB = '00000000-0000-4000-8000-000000000002';

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  async function mkSession(id: string, started_at: number) {
    await db.runAsync(
      `INSERT INTO session (id, started_at, ended_at) VALUES (?, ?, ?)`,
      id,
      started_at,
      started_at + 3600_000,
    );
  }

  async function mkActiveSession(id: string, started_at: number) {
    // ended_at NULL — current in-progress session.
    await db.runAsync(
      `INSERT INTO session (id, started_at, ended_at) VALUES (?, ?, NULL)`,
      id,
      started_at,
    );
  }

  async function mkSE(id: string, session_id: string, exercise_id: string, ordering: number, parent_id: string | null = null) {
    await db.runAsync(
      `INSERT INTO session_exercise
         (id, session_id, exercise_id, ordering, planned_sets,
          planned_reps, planned_weight_kg, template_id, is_evergreen, parent_id)
       VALUES (?, ?, ?, ?, 3, NULL, NULL, NULL, 0, ?)`,
      id,
      session_id,
      exercise_id,
      ordering,
      parent_id,
    );
  }

  async function addSet(
    id: string,
    session_id: string,
    exercise_id: string,
    se_id: string,
    ordering: number,
    weight_kg: number,
    reps: number,
    set_kind: 'warmup' | 'working' | 'dropset' = 'working',
    parent_set_id: string | null = null,
    is_logged: 0 | 1 = 1,
  ) {
    await insertSessionSet(db, {
      id,
      session_id,
      exercise_id,
      weight_kg,
      reps,
      is_skipped: 0,
      ordering,
      created_at: 1_700_000_000_000 + ordering * 1000,
      set_kind,
      parent_set_id,
      session_exercise_id: se_id,
    });
    if (is_logged === 1) {
      await db.runAsync(`UPDATE "set" SET is_logged = 1 WHERE id = ?`, id);
    }
  }

  it('Case 1 — solo replay: wipes 5 stale sets, inserts 3 source sets with is_logged=0', async () => {
    // Source session — 3 logged sets for exA.
    await mkSession('src', 1_000_000);
    await mkSE('src-seA', 'src', exA, 1);
    await addSet('src1', 'src', exA, 'src-seA', 1, 50, 12, 'warmup');
    await addSet('src2', 'src', exA, 'src-seA', 2, 80, 5);
    await addSet('src3', 'src', exA, 'src-seA', 3, 80, 5);

    // Current session — 5 stale sets in target card (different values).
    await mkActiveSession('cur', 2_000_000);
    await mkSE('cur-seA', 'cur', exA, 1);
    for (let i = 1; i <= 5; i++) {
      await addSet(`stale${i}`, 'cur', exA, 'cur-seA', i, 100 + i, 8, 'working', null, 0);
    }

    const result = await replayCardSetsFromHistoricalSession(db, {
      current_session_id: 'cur',
      current_se_id: 'cur-seA',
      source_session_id: 'src',
      source_session_exercise_id: 'src-seA',
      source_exercise_id: exA,
      uuid: randomUUID,
    });

    expect(result.inserted).toBe(3);
    const rows = await listSetsBySession(db, 'cur');
    expect(rows.length).toBe(3);
    expect(rows.map((r) => ({ w: r.weight_kg, r: r.reps, k: r.set_kind }))).toEqual([
      { w: 50, r: 12, k: 'warmup' },
      { w: 80, r: 5, k: 'working' },
      { w: 80, r: 5, k: 'working' },
    ]);
    expect(rows.every((r) => r.is_logged === 0)).toBe(true);
    expect(rows.every((r) => r.session_exercise_id === 'cur-seA')).toBe(true);
    // No row carries the original stale ids (UUID re-mint).
    expect(rows.every((r) => !r.id.startsWith('stale'))).toBe(true);
    expect(rows.every((r) => !r.id.startsWith('src'))).toBe(true);
  });

  it('Case 2 — dropset chain: parent_set_id remapped to NEW head id', async () => {
    // Source: 1 head set + 1 dropset follower pointing at head.
    await mkSession('src', 1_000_000);
    await mkSE('src-seA', 'src', exA, 1);
    await addSet('src-head', 'src', exA, 'src-seA', 1, 100, 5);
    await addSet('src-drop', 'src', exA, 'src-seA', 2, 80, 6, 'dropset', 'src-head');

    // Current: empty target card.
    await mkActiveSession('cur', 2_000_000);
    await mkSE('cur-seA', 'cur', exA, 1);

    const result = await replayCardSetsFromHistoricalSession(db, {
      current_session_id: 'cur',
      current_se_id: 'cur-seA',
      source_session_id: 'src',
      source_session_exercise_id: 'src-seA',
      source_exercise_id: exA,
      uuid: randomUUID,
    });

    expect(result.inserted).toBe(2);
    const rows = await listSetsBySession(db, 'cur');
    expect(rows.length).toBe(2);
    const newHead = rows.find((r) => r.set_kind === 'working');
    const newDrop = rows.find((r) => r.set_kind === 'dropset');
    expect(newHead).toBeTruthy();
    expect(newDrop).toBeTruthy();
    expect(newHead!.parent_set_id).toBeNull();
    // The remap is the load-bearing assertion — follower's parent must point
    // at the NEW head, NOT the stale src-head id.
    expect(newDrop!.parent_set_id).toBe(newHead!.id);
    expect(newDrop!.parent_set_id).not.toBe('src-head');
  });

  it('Case 3 — cluster replay: both A and B sides cleared and refilled', async () => {
    // Source — cluster pair done historically (A: 3 sets, B: 3 sets).
    await mkSession('src', 1_000_000);
    await mkSE('src-A', 'src', exA, 1);
    await mkSE('src-B', 'src', exB, 2, 'src-A');
    for (let i = 1; i <= 3; i++) {
      await addSet(`sA${i}`, 'src', exA, 'src-A', i, 60, 10);
      await addSet(`sB${i}`, 'src', exB, 'src-B', i + 10, 0, 12);
    }

    // Current — same cluster pair, different stale values.
    await mkActiveSession('cur', 2_000_000);
    await mkSE('cur-A', 'cur', exA, 1);
    await mkSE('cur-B', 'cur', exB, 2, 'cur-A');
    await addSet('curA1', 'cur', exA, 'cur-A', 1, 999, 1, 'working', null, 0);
    await addSet('curB1', 'cur', exB, 'cur-B', 2, 888, 1, 'working', null, 0);

    const result = await replayClusterCardSetsFromHistoricalSession(db, {
      current_session_id: 'cur',
      current_se_id_a: 'cur-A',
      current_se_id_b: 'cur-B',
      source_session_id: 'src',
      source_session_exercise_id_a: 'src-A',
      source_session_exercise_id_b: 'src-B',
      source_exercise_id_a: exA,
      source_exercise_id_b: exB,
      uuid: randomUUID,
    });

    expect(result.inserted_a).toBe(3);
    expect(result.inserted_b).toBe(3);
    const rows = await listSetsBySession(db, 'cur');
    const aRows = rows.filter((r) => r.session_exercise_id === 'cur-A');
    const bRows = rows.filter((r) => r.session_exercise_id === 'cur-B');
    expect(aRows.length).toBe(3);
    expect(bRows.length).toBe(3);
    expect(aRows.every((r) => r.weight_kg === 60 && r.reps === 10)).toBe(true);
    expect(bRows.every((r) => r.weight_kg === 0 && r.reps === 12)).toBe(true);
    // No stale rows survive on either side.
    expect(rows.find((r) => r.id === 'curA1')).toBeUndefined();
    expect(rows.find((r) => r.id === 'curB1')).toBeUndefined();
  });

  it('Case 4 — cluster asymmetric source: B side empty in source → B side wiped in target', async () => {
    // Source: A has 2 logged sets, B has 0 (user skipped B day).
    await mkSession('src', 1_000_000);
    await mkSE('src-A', 'src', exA, 1);
    await mkSE('src-B', 'src', exB, 2, 'src-A');
    await addSet('sA1', 'src', exA, 'src-A', 1, 60, 10);
    await addSet('sA2', 'src', exA, 'src-A', 2, 60, 10);
    // (no exB sets)

    // Current: cluster pair with 2 stale sets on each side.
    await mkActiveSession('cur', 2_000_000);
    await mkSE('cur-A', 'cur', exA, 1);
    await mkSE('cur-B', 'cur', exB, 2, 'cur-A');
    await addSet('curA1', 'cur', exA, 'cur-A', 1, 100, 1, 'working', null, 0);
    await addSet('curA2', 'cur', exA, 'cur-A', 2, 100, 1, 'working', null, 0);
    await addSet('curB1', 'cur', exB, 'cur-B', 3, 100, 1, 'working', null, 0);
    await addSet('curB2', 'cur', exB, 'cur-B', 4, 100, 1, 'working', null, 0);

    const result = await replayClusterCardSetsFromHistoricalSession(db, {
      current_session_id: 'cur',
      current_se_id_a: 'cur-A',
      current_se_id_b: 'cur-B',
      source_session_id: 'src',
      source_session_exercise_id_a: 'src-A',
      source_session_exercise_id_b: 'src-B',
      source_exercise_id_a: exA,
      source_exercise_id_b: exB,
      uuid: randomUUID,
    });

    expect(result.inserted_a).toBe(2);
    expect(result.inserted_b).toBe(0);

    const rows = await listSetsBySession(db, 'cur');
    const aRows = rows.filter((r) => r.session_exercise_id === 'cur-A');
    const bRows = rows.filter((r) => r.session_exercise_id === 'cur-B');
    expect(aRows.length).toBe(2);
    expect(bRows.length).toBe(0); // wiped, not preserved
  });

  it('Case 5 — same-card replay (source == current): source captured before DELETE, card ends with its own sets re-inserted', async () => {
    // Single session, single card, 2 logged sets. Replay using the same
    // se as both source and current target.
    await mkActiveSession('cur', 2_000_000);
    await mkSE('cur-seA', 'cur', exA, 1);
    await addSet('s1', 'cur', exA, 'cur-seA', 1, 50, 10);
    await addSet('s2', 'cur', exA, 'cur-seA', 2, 60, 8);

    const result = await replayCardSetsFromHistoricalSession(db, {
      current_session_id: 'cur',
      current_se_id: 'cur-seA',
      source_session_id: 'cur', // same session
      source_session_exercise_id: 'cur-seA',
      source_exercise_id: exA,
      uuid: randomUUID,
    });

    // Source rows were captured before DELETE, so we get 2 fresh inserts.
    expect(result.inserted).toBe(2);
    const rows = await listSetsBySession(db, 'cur');
    expect(rows.length).toBe(2);
    expect(rows.map((r) => ({ w: r.weight_kg, r: r.reps }))).toEqual([
      { w: 50, r: 10 },
      { w: 60, r: 8 },
    ]);
    // is_logged reset to 0 (replay = needs re-ticking).
    expect(rows.every((r) => r.is_logged === 0)).toBe(true);
  });

  it('Case 6 — sibling solo card sharing exercise_id is untouched (#17 isolation)', async () => {
    // Source: simple A history.
    await mkSession('src', 1_000_000);
    await mkSE('src-A', 'src', exA, 1);
    await addSet('srcA1', 'src', exA, 'src-A', 1, 70, 8);

    // Current: cluster A (exA) + sibling solo (exA, different se_id).
    await mkActiveSession('cur', 2_000_000);
    await mkSE('cur-clusterA', 'cur', exA, 1);
    await mkSE('cur-clusterB', 'cur', exB, 2, 'cur-clusterA');
    await mkSE('cur-solo-A', 'cur', exA, 3); // SAME exercise_id as cluster A
    await addSet('clusA1', 'cur', exA, 'cur-clusterA', 1, 999, 1, 'working', null, 0);
    await addSet('solo1', 'cur', exA, 'cur-solo-A', 5, 77, 7); // sibling — must survive

    await replayCardSetsFromHistoricalSession(db, {
      current_session_id: 'cur',
      current_se_id: 'cur-clusterA',
      source_session_id: 'src',
      source_session_exercise_id: 'src-A',
      source_exercise_id: exA,
      uuid: randomUUID,
    });

    const rows = await listSetsBySession(db, 'cur');
    const soloRows = rows.filter((r) => r.session_exercise_id === 'cur-solo-A');
    // Sibling solo card sets survive untouched.
    expect(soloRows.length).toBe(1);
    expect(soloRows[0].id).toBe('solo1');
    expect(soloRows[0].weight_kg).toBe(77);
    expect(soloRows[0].reps).toBe(7);
    // Stale cluster A set wiped.
    expect(rows.find((r) => r.id === 'clusA1')).toBeUndefined();
  });

  // ── #27 source-side isolation cases (added after the 5/18 prefill bug
  // where a source session had 2 cards sharing the same exercise_id and
  // the replay helper scooped BOTH into a single side). ────────────────

  it('Case 7 — solo replay source isolation: source session has solo + RS-A for same exercise → only target SE matched is pulled', async () => {
    // Source session: a solo Bench card (3 sets) AND an RS A-side Bench card
    // (1 set) — same exercise_id. We're replaying the solo card → must get
    // exactly 3 sets, not the RS A-side's 1 set mixed in.
    await mkSession('src', 1_000_000);
    await mkSE('src-solo', 'src', exA, 1);
    await mkSE('src-rsA', 'src', exA, 2); // RS A-side, same exercise_id
    await mkSE('src-rsB', 'src', exB, 3, 'src-rsA');
    await addSet('soloS1', 'src', exA, 'src-solo', 1, 20, 10);
    await addSet('soloS2', 'src', exA, 'src-solo', 2, 20, 10);
    await addSet('soloS3', 'src', exA, 'src-solo', 3, 20, 10);
    await addSet('rsA1', 'src', exA, 'src-rsA', 4, 999, 1); // different values

    // Current empty target.
    await mkActiveSession('cur', 2_000_000);
    await mkSE('cur-target', 'cur', exA, 1);

    const result = await replayCardSetsFromHistoricalSession(db, {
      current_session_id: 'cur',
      current_se_id: 'cur-target',
      source_session_id: 'src',
      source_session_exercise_id: 'src-solo', // <- specifically the solo card
      source_exercise_id: exA,
      uuid: randomUUID,
    });

    expect(result.inserted).toBe(3);
    const rows = await listSetsBySession(db, 'cur');
    expect(rows.length).toBe(3);
    // No 999 from the RS A side bled in.
    expect(rows.every((r) => r.weight_kg === 20 && r.reps === 10)).toBe(true);
  });

  it('Case 8 — cluster replay source isolation: source has RS-A + sibling solo + RS-B → only RS cards pulled per side', async () => {
    // Source session: RS A Bench (1 set) + solo Bench (3 sets) + RS B Dip (1 set).
    // Replaying the cluster → A side should pull just 1 set (RS A) and B side
    // just 1 set (RS B), NOT the 3 solo-Bench sets.
    await mkSession('src', 1_000_000);
    await mkSE('src-rsA', 'src', exA, 1);
    await mkSE('src-rsB', 'src', exB, 2, 'src-rsA');
    await mkSE('src-solo', 'src', exA, 3); // sibling solo, same exercise as RS A
    await addSet('rsA1', 'src', exA, 'src-rsA', 1, 20, 10); // RS A target
    await addSet('rsB1', 'src', exB, 'src-rsB', 2, 5, 10);  // RS B target
    await addSet('soloS1', 'src', exA, 'src-solo', 3, 999, 1);
    await addSet('soloS2', 'src', exA, 'src-solo', 4, 999, 1);
    await addSet('soloS3', 'src', exA, 'src-solo', 5, 999, 1);

    // Current empty cluster pair.
    await mkActiveSession('cur', 2_000_000);
    await mkSE('cur-A', 'cur', exA, 1);
    await mkSE('cur-B', 'cur', exB, 2, 'cur-A');

    const result = await replayClusterCardSetsFromHistoricalSession(db, {
      current_session_id: 'cur',
      current_se_id_a: 'cur-A',
      current_se_id_b: 'cur-B',
      source_session_id: 'src',
      source_session_exercise_id_a: 'src-rsA',
      source_session_exercise_id_b: 'src-rsB',
      source_exercise_id_a: exA,
      source_exercise_id_b: exB,
      uuid: randomUUID,
    });

    expect(result.inserted_a).toBe(1);
    expect(result.inserted_b).toBe(1);
    const rows = await listSetsBySession(db, 'cur');
    const aRows = rows.filter((r) => r.session_exercise_id === 'cur-A');
    const bRows = rows.filter((r) => r.session_exercise_id === 'cur-B');
    expect(aRows.length).toBe(1);
    expect(bRows.length).toBe(1);
    expect(aRows[0].weight_kg).toBe(20);
    expect(aRows[0].reps).toBe(10);
    expect(bRows[0].weight_kg).toBe(5);
    expect(bRows[0].reps).toBe(10);
  });

  it('Case 9 — legacy fallback: source rows with session_exercise_id NULL fall back to (session_id, exercise_id)', async () => {
    // Pre-v019 source session: rows untagged (session_exercise_id NULL).
    // Replay should still find them by the legacy exercise_id match.
    await mkSession('src', 1_000_000);
    await mkSE('src-seA', 'src', exA, 1);
    // Insert sets directly with session_exercise_id NULL to simulate
    // pre-v019 data shape.
    await db.runAsync(
      `INSERT INTO "set" (id, session_id, exercise_id, weight_kg, reps,
                          is_skipped, ordering, created_at, is_logged,
                          set_kind, parent_set_id, session_exercise_id)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, 1, 'working', NULL, NULL)`,
      'legacy1',
      'src',
      exA,
      40,
      8,
      1,
      1_700_000_000_001,
    );
    await db.runAsync(
      `INSERT INTO "set" (id, session_id, exercise_id, weight_kg, reps,
                          is_skipped, ordering, created_at, is_logged,
                          set_kind, parent_set_id, session_exercise_id)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, 1, 'working', NULL, NULL)`,
      'legacy2',
      'src',
      exA,
      40,
      8,
      2,
      1_700_000_000_002,
    );

    await mkActiveSession('cur', 2_000_000);
    await mkSE('cur-seA', 'cur', exA, 1);

    const result = await replayCardSetsFromHistoricalSession(db, {
      current_session_id: 'cur',
      current_se_id: 'cur-seA',
      source_session_id: 'src',
      source_session_exercise_id: 'src-seA', // primary key — but legacy rows
      source_exercise_id: exA,                // fall through this fallback
      uuid: randomUUID,
    });

    expect(result.inserted).toBe(2);
    const rows = await listSetsBySession(db, 'cur');
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.weight_kg === 40 && r.reps === 8)).toBe(true);
  });
});
