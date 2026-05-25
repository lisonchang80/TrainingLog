import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { insertSessionSet, listSetsBySession } from '../../src/adapters/sqlite/setRepository';
import { deleteSessionExerciseAndSets } from '../../src/adapters/sqlite/sessionRepository';

/**
 * Slice 10c overnight #18 — cluster cascade-delete integration test.
 *
 * Validates that the UI-layer "delete cluster" flow (two sequential
 * `deleteSessionExerciseAndSets` calls — one per side) correctly:
 *   1. removes BOTH cluster session_exercise rows
 *   2. removes EVERY set on either side of the cluster
 *   3. leaves an independent session_exercise that happens to share the
 *      same exercise_id as the cluster's A side completely untouched
 *
 * This is the combined regression for #17 (within-session isolation by
 * session_exercise_id) + #18 (cluster cascade across A+B). If either layer
 * regresses, this test fails: #17 regressing would wipe the independent
 * card's sets via the coarse (session, exercise) filter; #18 regressing
 * would leave the B-side orphan behind.
 *
 * Setup mirrors the user-reported scenario:
 *   - 1 session
 *   - 1 cluster (A = Cable Crossover, B = Chest Dip), 2 sets per side
 *   - 1 independent Cable Crossover card (same exercise_id as A), 1 set
 */
describe('cluster cascade delete — #17 isolation + #18 cascade', () => {
  let db: BetterSqliteDatabase;
  const cableCrossoverId = '00000000-0000-4000-8000-000000000001';
  const chestDipId = '00000000-0000-4000-8000-000000000002';
  const sessionId = 'sess-cascade-1';
  const aSeId = 'se-cluster-A'; // Cable Crossover, cluster parent
  const bSeId = 'se-cluster-B'; // Chest Dip, cluster follower
  const soloSeId = 'se-solo-cable'; // Cable Crossover, independent solo card
  const now = Date.now();

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    await db.runAsync(
      `INSERT INTO session (id, started_at) VALUES (?, ?)`,
      sessionId,
      now,
    );
    // Cluster A side — Cable Crossover, parent_id=NULL
    await db.runAsync(
      `INSERT INTO session_exercise
         (id, session_id, exercise_id, ordering, planned_sets,
          planned_reps, planned_weight_kg, template_id, is_evergreen, parent_id)
       VALUES (?, ?, ?, 1, 2, NULL, NULL, NULL, 0, NULL)`,
      aSeId,
      sessionId,
      cableCrossoverId,
    );
    // Cluster B side — Chest Dip, parent_id = A's session_exercise.id
    await db.runAsync(
      `INSERT INTO session_exercise
         (id, session_id, exercise_id, ordering, planned_sets,
          planned_reps, planned_weight_kg, template_id, is_evergreen, parent_id)
       VALUES (?, ?, ?, 2, 2, NULL, NULL, NULL, 0, ?)`,
      bSeId,
      sessionId,
      chestDipId,
      aSeId,
    );
    // Independent solo Cable Crossover — SAME exercise_id as A but a
    // separate session_exercise row. This is the row #17 isolation
    // exists to protect.
    await db.runAsync(
      `INSERT INTO session_exercise
         (id, session_id, exercise_id, ordering, planned_sets,
          planned_reps, planned_weight_kg, template_id, is_evergreen, parent_id)
       VALUES (?, ?, ?, 3, 1, NULL, NULL, NULL, 0, NULL)`,
      soloSeId,
      sessionId,
      cableCrossoverId,
    );
    // Cluster A: 2 sets
    await insertSessionSet(db, {
      id: 'A1',
      session_id: sessionId,
      exercise_id: cableCrossoverId,
      weight_kg: 20,
      reps: 12,
      is_skipped: 0,
      ordering: 1,
      created_at: now,
      set_kind: 'working',
      parent_set_id: null,
      session_exercise_id: aSeId,
    });
    await insertSessionSet(db, {
      id: 'A2',
      session_id: sessionId,
      exercise_id: cableCrossoverId,
      weight_kg: 22.5,
      reps: 10,
      is_skipped: 0,
      ordering: 2,
      created_at: now,
      set_kind: 'working',
      parent_set_id: null,
      session_exercise_id: aSeId,
    });
    // Cluster B: 2 sets
    await insertSessionSet(db, {
      id: 'B1',
      session_id: sessionId,
      exercise_id: chestDipId,
      weight_kg: 0,
      reps: 8,
      is_skipped: 0,
      ordering: 1,
      created_at: now,
      set_kind: 'working',
      parent_set_id: null,
      session_exercise_id: bSeId,
    });
    await insertSessionSet(db, {
      id: 'B2',
      session_id: sessionId,
      exercise_id: chestDipId,
      weight_kg: 0,
      reps: 6,
      is_skipped: 0,
      ordering: 2,
      created_at: now,
      set_kind: 'working',
      parent_set_id: null,
      session_exercise_id: bSeId,
    });
    // Independent solo Cable Crossover: 1 set (same exercise_id as A!)
    await insertSessionSet(db, {
      id: 'S1',
      session_id: sessionId,
      exercise_id: cableCrossoverId,
      weight_kg: 25,
      reps: 8,
      is_skipped: 0,
      ordering: 3,
      created_at: now,
      set_kind: 'working',
      parent_set_id: null,
      session_exercise_id: soloSeId,
    });
  });

  afterEach(() => {
    db.close();
  });

  it('baseline: 3 session_exercise rows, 5 sets, 3 sets owned by Cable Crossover exercise_id', async () => {
    const ses = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM session_exercise WHERE session_id = ? ORDER BY ordering ASC`,
      sessionId,
    );
    expect(ses.map((r) => r.id)).toEqual([aSeId, bSeId, soloSeId]);

    const sets = await listSetsBySession(db, sessionId);
    expect(sets.map((s) => s.id).sort()).toEqual(['A1', 'A2', 'B1', 'B2', 'S1']);

    // Three sets across two session_exercise rows share the same
    // exercise_id (cableCrossoverId) — this is the bug surface.
    const cableSets = sets.filter((s) => s.exercise_id === cableCrossoverId);
    expect(cableSets.map((s) => s.id).sort()).toEqual(['A1', 'A2', 'S1']);
  });

  it('cluster cascade (A then B) wipes both cluster sides, independent solo Cable Crossover survives', async () => {
    // Mirror the UI flow: two sequential deleteSessionExerciseAndSets
    // calls, one per cluster side.
    await deleteSessionExerciseAndSets(db, {
      session_id: sessionId,
      exercise_id: cableCrossoverId,
      session_exercise_id: aSeId,
    });
    await deleteSessionExerciseAndSets(db, {
      session_id: sessionId,
      exercise_id: chestDipId,
      session_exercise_id: bSeId,
    });

    // Both cluster session_exercise rows gone; the independent solo
    // Cable Crossover row is preserved.
    const ses = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM session_exercise WHERE session_id = ?`,
      sessionId,
    );
    expect(ses.map((r) => r.id)).toEqual([soloSeId]);

    // All cluster sets gone (A1/A2/B1/B2); independent S1 survives.
    const sets = await listSetsBySession(db, sessionId);
    expect(sets.map((s) => s.id)).toEqual(['S1']);

    // S1 still has its original weight/reps — proves #17 isolation kept
    // the per-card filter from leaking into this row when A was deleted
    // (both A and S share cableCrossoverId).
    const s1 = sets.find((s) => s.id === 'S1');
    expect(s1?.weight_kg).toBe(25);
    expect(s1?.reps).toBe(8);
    expect(s1?.session_exercise_id).toBe(soloSeId);
  });

  it('cluster cascade order-independent: B first then A behaves identically', async () => {
    // Same end state regardless of which side is deleted first — the
    // UI shouldn't have to care about deletion order.
    await deleteSessionExerciseAndSets(db, {
      session_id: sessionId,
      exercise_id: chestDipId,
      session_exercise_id: bSeId,
    });
    await deleteSessionExerciseAndSets(db, {
      session_id: sessionId,
      exercise_id: cableCrossoverId,
      session_exercise_id: aSeId,
    });

    const ses = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM session_exercise WHERE session_id = ?`,
      sessionId,
    );
    expect(ses.map((r) => r.id)).toEqual([soloSeId]);

    const sets = await listSetsBySession(db, sessionId);
    expect(sets.map((s) => s.id)).toEqual(['S1']);
  });
});
