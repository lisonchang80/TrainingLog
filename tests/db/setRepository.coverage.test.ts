import { randomUUID } from 'node:crypto';
import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  addClusterCycleAtEnd,
  addSessionDropsetCluster,
  cloneClusterCycle,
  insertSessionSet,
  listSetsBySession,
  removeSessionDropsetRow,
  replayCardSetsFromHistoricalSession,
  replayClusterCardSetsFromHistoricalSession,
} from '../../src/adapters/sqlite/setRepository';

/**
 * Coverage fill (overnight 2026-06-03 r2) — reachable branches the prior
 * waves left uncovered in setRepository.ts:
 *
 *   - cloneClusterCycle / addClusterCycleAtEnd `maxFor` WITH-session_exercise_id
 *     branch (existing clusterCycleOps.test.ts only passes the legacy shape
 *     WITHOUT session_exercise_id, so the v019-isolation MAX(ordering) query
 *     scoped to session_exercise_id was never exercised).
 *   - addSessionDropsetCluster source-not-found throw.
 *   - removeSessionDropsetRow set-not-found throw (existing dropsetRow test
 *     covers not-a-dropset + is-HEAD + chain-too-short, but never the
 *     entirely-absent id path).
 *   - replayCardSetsFromHistoricalSession + replayClusterCardSetsFromHistorical
 *     `return false` filter branch — a source UNLOGGED working set (not a
 *     dropset follower) must be dropped from the replay set.
 */
describe('setRepository coverage fill', () => {
  let db: BetterSqliteDatabase;
  const exA = '00000000-0000-4000-8000-000000000001';
  const exB = '00000000-0000-4000-8000-000000000002';
  const sessionId = 'sess-cov';
  const now = 1_700_000_000_000;

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

  async function insertSet(args: {
    id: string;
    session_id?: string;
    exercise_id?: string;
    ordering: number;
    weight_kg?: number;
    reps?: number;
    set_kind?: 'warmup' | 'working' | 'dropset';
    parent_set_id?: string | null;
    session_exercise_id?: string | null;
    is_logged?: 0 | 1;
  }) {
    await insertSessionSet(db, {
      id: args.id,
      session_id: args.session_id ?? sessionId,
      exercise_id: args.exercise_id ?? exA,
      weight_kg: args.weight_kg ?? 50,
      reps: args.reps ?? 10,
      is_skipped: 0,
      ordering: args.ordering,
      created_at: now + args.ordering,
      set_kind: args.set_kind ?? 'working',
      parent_set_id: args.parent_set_id ?? null,
      session_exercise_id: args.session_exercise_id ?? null,
    });
    if (args.is_logged === 1) {
      await db.runAsync(`UPDATE "set" SET is_logged = 1 WHERE id = ?`, args.id);
    }
  }

  // ── maxFor WITH session_exercise_id ──────────────────────────────────────

  it('cloneClusterCycle: MAX(ordering) is scoped to session_exercise_id when supplied', async () => {
    // Two cards share exercise_id exA but have distinct session_exercise_ids.
    // The card we clone has the LOWER max-ordering; the sibling has a HIGHER
    // ordering. If maxFor accidentally used the (session_id, exercise_id)
    // bare MAX, the new clone would jump to ordering 31 (sibling's bucket).
    // Scoped to seCard's session_exercise_id, it should land at 6.
    await insertSet({ id: 'card-a1', ordering: 5, session_exercise_id: 'se-card' });
    await insertSet({ id: 'sibling', ordering: 30, session_exercise_id: 'se-sibling' });

    await cloneClusterCycle(db, {
      a_source: { id: 'card-a1', exercise_id: exA, session_exercise_id: 'se-card' },
      b_source: null,
      session_id: sessionId,
      new_a_set_id: 'new-a',
      new_b_set_id: 'new-b',
      now: () => now,
    });

    const rows = await listSetsBySession(db, sessionId);
    const newRow = rows.find((r) => r.id === 'new-a')!;
    expect(newRow).toBeTruthy();
    // Scoped MAX = 5 (card-a1) → +1 = 6, NOT 31 (which the sibling would force).
    expect(newRow.ordering).toBe(6);
    expect(newRow.session_exercise_id).toBe('se-card');
  });

  it('addClusterCycleAtEnd: MAX(ordering) is scoped to session_exercise_id when supplied', async () => {
    await insertSet({ id: 'a-card', ordering: 3, exercise_id: exA, session_exercise_id: 'se-a' });
    await insertSet({ id: 'b-card', ordering: 4, exercise_id: exB, session_exercise_id: 'se-b' });
    // Siblings with the same exercise_ids but HIGHER ordering on other cards.
    await insertSet({ id: 'a-sib', ordering: 50, exercise_id: exA, session_exercise_id: 'se-a-sib' });
    await insertSet({ id: 'b-sib', ordering: 60, exercise_id: exB, session_exercise_id: 'se-b-sib' });

    await addClusterCycleAtEnd(db, {
      session_id: sessionId,
      a: { exercise_id: exA, new_set_id: 'na', weight_kg: 70, reps: 5, session_exercise_id: 'se-a' },
      b: { exercise_id: exB, new_set_id: 'nb', weight_kg: 80, reps: 6, session_exercise_id: 'se-b' },
      now: () => now,
    });

    const rows = await listSetsBySession(db, sessionId);
    const na = rows.find((r) => r.id === 'na')!;
    const nb = rows.find((r) => r.id === 'nb')!;
    // Scoped to each card's own session_exercise_id → 3+1, 4+1 — not 51 / 61.
    expect(na.ordering).toBe(4);
    expect(nb.ordering).toBe(5);
    expect(na.weight_kg).toBe(70);
    expect(nb.reps).toBe(6);
  });

  // ── addSessionDropsetCluster not-found throw ─────────────────────────────

  it('addSessionDropsetCluster: throws when source set is absent from session', async () => {
    await expect(
      addSessionDropsetCluster(db, {
        session_id: sessionId,
        after_set_id: 'does-not-exist',
        uuid: randomUUID,
      }),
    ).rejects.toThrow(/not found in session/);
  });

  it('addSessionDropsetCluster: clones whole source chain after the source last row', async () => {
    // Sanity / happy-path so the throw test isn't the only caller. Head + 1
    // follower → cluster appended after follower.
    await insertSet({ id: 'h', ordering: 1, set_kind: 'dropset', weight_kg: 100, reps: 5 });
    await insertSet({ id: 'f', ordering: 2, set_kind: 'dropset', parent_set_id: 'h', weight_kg: 80, reps: 6 });

    const res = await addSessionDropsetCluster(db, {
      session_id: sessionId,
      after_set_id: 'f',
      uuid: randomUUID,
      now: () => now,
    });

    expect(res.follower_ids).toHaveLength(1);
    const rows = await listSetsBySession(db, sessionId);
    // h(1), f(2), new-head(3), new-follower(4)
    expect(rows).toHaveLength(4);
    const newHead = rows.find((r) => r.id === res.head_id)!;
    expect(newHead.ordering).toBe(3);
    expect(newHead.parent_set_id).toBeNull();
    expect(newHead.weight_kg).toBe(100);
    const newFollower = rows.find((r) => r.id === res.follower_ids[0])!;
    expect(newFollower.parent_set_id).toBe(res.head_id);
    expect(newFollower.weight_kg).toBe(80);
  });

  // ── removeSessionDropsetRow not-found throw ──────────────────────────────

  it('removeSessionDropsetRow: throws when the set id is absent from session', async () => {
    await expect(
      removeSessionDropsetRow(db, {
        session_id: sessionId,
        set_id: 'ghost',
      }),
    ).rejects.toThrow(/not found in session/);
  });

  // ── replay filter: unlogged non-dropset set is dropped ───────────────────

  it('replayCardSetsFromHistoricalSession: drops an unlogged working set from the source', async () => {
    // Source: 1 logged working set + 1 UNLOGGED working set. Only the logged
    // one survives the chain-aware filter (the unlogged one hits `return false`).
    const srcSession = 'src-replay';
    await db.runAsync(
      `INSERT INTO session (id, started_at, ended_at) VALUES (?, ?, ?)`,
      srcSession,
      now - 1_000_000,
      now - 900_000,
    );
    await db.runAsync(
      `INSERT INTO session_exercise (id, session_id, exercise_id, ordering,
         planned_sets, is_evergreen) VALUES (?, ?, ?, 1, 3, 0)`,
      'src-se',
      srcSession,
      exA,
    );
    await insertSet({ id: 'src-logged', session_id: srcSession, exercise_id: exA, ordering: 1, session_exercise_id: 'src-se', weight_kg: 90, reps: 5, is_logged: 1 });
    await insertSet({ id: 'src-unlogged', session_id: srcSession, exercise_id: exA, ordering: 2, session_exercise_id: 'src-se', weight_kg: 999, reps: 1, is_logged: 0 });

    await db.runAsync(
      `INSERT INTO session_exercise (id, session_id, exercise_id, ordering,
         planned_sets, is_evergreen) VALUES (?, ?, ?, 1, 3, 0)`,
      'cur-se',
      sessionId,
      exA,
    );

    const result = await replayCardSetsFromHistoricalSession(db, {
      current_session_id: sessionId,
      current_se_id: 'cur-se',
      source_session_id: srcSession,
      source_session_exercise_id: 'src-se',
      source_exercise_id: exA,
      uuid: randomUUID,
    });

    // Only the logged set was copied; the unlogged one was filtered out.
    expect(result.inserted).toBe(1);
    const rows = await listSetsBySession(db, sessionId);
    expect(rows).toHaveLength(1);
    expect(rows[0].weight_kg).toBe(90);
  });

  it('replayCardSetsFromHistoricalSession: source with ONLY unlogged sets → target wiped, 0 inserted', async () => {
    // Filter leaves sourceSets empty → the `sourceSets.length === 0` early
    // return fires (card ends up empty, DELETE already applied). Target had
    // a stale set that must be removed.
    const srcSession = 'src-empty';
    await db.runAsync(
      `INSERT INTO session (id, started_at, ended_at) VALUES (?, ?, ?)`,
      srcSession,
      now - 1_000_000,
      now - 900_000,
    );
    await db.runAsync(
      `INSERT INTO session_exercise (id, session_id, exercise_id, ordering,
         planned_sets, is_evergreen) VALUES (?, ?, ?, 1, 3, 0)`,
      'src-se',
      srcSession,
      exA,
    );
    // Only an UNLOGGED working set in the source → filtered to nothing.
    await insertSet({ id: 'src-un', session_id: srcSession, exercise_id: exA, ordering: 1, session_exercise_id: 'src-se', weight_kg: 999, reps: 1, is_logged: 0 });

    await db.runAsync(
      `INSERT INTO session_exercise (id, session_id, exercise_id, ordering,
         planned_sets, is_evergreen) VALUES (?, ?, ?, 1, 3, 0)`,
      'cur-se',
      sessionId,
      exA,
    );
    await insertSet({ id: 'stale', ordering: 1, session_exercise_id: 'cur-se', weight_kg: 50, reps: 8 });

    const result = await replayCardSetsFromHistoricalSession(db, {
      current_session_id: sessionId,
      current_se_id: 'cur-se',
      source_session_id: srcSession,
      source_session_exercise_id: 'src-se',
      source_exercise_id: exA,
      uuid: randomUUID,
    });

    expect(result.inserted).toBe(0);
    const rows = await listSetsBySession(db, sessionId);
    // Stale set wiped, nothing re-inserted.
    expect(rows).toHaveLength(0);
  });

  it('replayClusterCardSetsFromHistoricalSession: drops an unlogged working set per side', async () => {
    const srcSession = 'src-cluster';
    await db.runAsync(
      `INSERT INTO session (id, started_at, ended_at) VALUES (?, ?, ?)`,
      srcSession,
      now - 1_000_000,
      now - 900_000,
    );
    await db.runAsync(
      `INSERT INTO session_exercise (id, session_id, exercise_id, ordering,
         planned_sets, is_evergreen) VALUES (?, ?, ?, 1, 3, 0)`,
      'src-A',
      srcSession,
      exA,
    );
    await db.runAsync(
      `INSERT INTO session_exercise (id, session_id, exercise_id, ordering,
         planned_sets, is_evergreen, parent_id) VALUES (?, ?, ?, 2, 3, 0, ?)`,
      'src-B',
      srcSession,
      exB,
      'src-A',
    );
    // A side: 1 logged + 1 unlogged. B side: 1 logged + 1 unlogged.
    await insertSet({ id: 'cA-log', session_id: srcSession, exercise_id: exA, ordering: 1, session_exercise_id: 'src-A', weight_kg: 60, reps: 10, is_logged: 1 });
    await insertSet({ id: 'cA-un', session_id: srcSession, exercise_id: exA, ordering: 2, session_exercise_id: 'src-A', weight_kg: 999, reps: 1, is_logged: 0 });
    await insertSet({ id: 'cB-log', session_id: srcSession, exercise_id: exB, ordering: 3, session_exercise_id: 'src-B', weight_kg: 40, reps: 12, is_logged: 1 });
    await insertSet({ id: 'cB-un', session_id: srcSession, exercise_id: exB, ordering: 4, session_exercise_id: 'src-B', weight_kg: 888, reps: 1, is_logged: 0 });

    await db.runAsync(
      `INSERT INTO session_exercise (id, session_id, exercise_id, ordering,
         planned_sets, is_evergreen) VALUES (?, ?, ?, 1, 3, 0)`,
      'cur-A',
      sessionId,
      exA,
    );
    await db.runAsync(
      `INSERT INTO session_exercise (id, session_id, exercise_id, ordering,
         planned_sets, is_evergreen, parent_id) VALUES (?, ?, ?, 2, 3, 0, ?)`,
      'cur-B',
      sessionId,
      exB,
      'cur-A',
    );

    const result = await replayClusterCardSetsFromHistoricalSession(db, {
      current_session_id: sessionId,
      current_se_id_a: 'cur-A',
      current_se_id_b: 'cur-B',
      source_session_id: srcSession,
      source_session_exercise_id_a: 'src-A',
      source_session_exercise_id_b: 'src-B',
      source_exercise_id_a: exA,
      source_exercise_id_b: exB,
      uuid: randomUUID,
    });

    // Each side drops its unlogged set → exactly 1 copied per side.
    expect(result.inserted_a).toBe(1);
    expect(result.inserted_b).toBe(1);
    const rows = await listSetsBySession(db, sessionId);
    const aRows = rows.filter((r) => r.session_exercise_id === 'cur-A');
    const bRows = rows.filter((r) => r.session_exercise_id === 'cur-B');
    expect(aRows).toHaveLength(1);
    expect(bRows).toHaveLength(1);
    expect(aRows[0].weight_kg).toBe(60);
    expect(bRows[0].weight_kg).toBe(40);
  });
});
