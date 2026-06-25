import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  insertSessionSet,
  deleteSet,
} from '../../src/adapters/sqlite/setRepository';
import {
  captureSessionSnapshot,
  restoreSessionFromSnapshot,
} from '../../src/adapters/sqlite/sessionRepository';

/**
 * Snapshot/restore for transactional edit mode. Validates:
 *   - snapshot captures session.started_at + ended_at + session_exercises +
 *     sets + achievement_unlock back-refs for this session
 *   - restore wipes current state + re-inserts snapshotted rows + rebinds
 *     achievement_unlock back-refs
 *   - rows ADDED during edit are gone after restore
 *   - rows DELETED during edit are back after restore (with same id and
 *     same field values, including is_logged / notes / parent_set_id)
 *   - session.started_at / ended_at edits are reverted
 */
describe('session snapshot / restore', () => {
  let db: BetterSqliteDatabase;
  const exA = '00000000-0000-4000-8000-000000000001';
  const exB = '00000000-0000-4000-8000-000000000002';
  const sessionId = 'sess-snap-1';
  const seId = 'se-snap';

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    await db.runAsync(
      `INSERT INTO session (id, started_at, ended_at) VALUES (?, ?, ?)`,
      sessionId,
      1000,
      2000,
    );
    await db.runAsync(
      `INSERT INTO session_exercise
         (id, session_id, exercise_id, ordering, planned_sets,
          planned_reps, planned_weight_kg, template_id, is_evergreen, parent_id)
       VALUES (?, ?, ?, 1, 3, NULL, NULL, NULL, 0, NULL)`,
      seId,
      sessionId,
      exA,
    );
    await insertSessionSet(db, {
      id: 'origS1',
      session_id: sessionId,
      exercise_id: exA,
      weight_kg: 80,
      reps: 5,
      is_skipped: 0,
      ordering: 1,
      created_at: 1100,
      set_kind: 'working',
      parent_set_id: null,
      session_exercise_id: seId,
    });
    // mark is_logged + notes on origS1 so we know restore preserved them
    await db.runAsync(
      `UPDATE "set" SET is_logged = 1, notes = 'orig note' WHERE id = 'origS1'`,
    );
  });

  afterEach(() => {
    db.close();
  });

  it('captures snapshot reflecting current state', async () => {
    const snap = await captureSessionSnapshot(db, sessionId);
    expect(snap).not.toBeNull();
    expect(snap!.session.started_at).toBe(1000);
    expect(snap!.session.ended_at).toBe(2000);
    expect(snap!.sessionExercises).toHaveLength(1);
    expect(snap!.sessionExercises[0].id).toBe(seId);
    expect(snap!.sets).toHaveLength(1);
    expect(snap!.sets[0].id).toBe('origS1');
    expect(snap!.sets[0].is_logged).toBe(1);
    expect(snap!.sets[0].notes).toBe('orig note');
  });

  it('returns null when session not found', async () => {
    const snap = await captureSessionSnapshot(db, 'no-such-session');
    expect(snap).toBeNull();
  });

  it('captures and restores display_rank (Watch reorder fractional sort key)', async () => {
    // A Watch-side reorder writes a fractional display_rank that differs from
    // ordering. Discard (restore) must preserve it, not fall back to ordering.
    await db.runAsync(
      `UPDATE "set" SET display_rank = 2.5 WHERE id = 'origS1'`,
    );
    const snap = await captureSessionSnapshot(db, sessionId);
    expect(snap!.sets[0].display_rank).toBe(2.5);

    // Simulate an edit that loses the fractional rank, then restore.
    await db.runAsync(
      `UPDATE "set" SET display_rank = NULL, weight_kg = 999 WHERE id = 'origS1'`,
    );
    await restoreSessionFromSnapshot(db, snap!);

    const after = await db.getFirstAsync<{
      display_rank: number | null;
      weight_kg: number;
    }>(`SELECT display_rank, weight_kg FROM "set" WHERE id = 'origS1'`);
    expect(after).toEqual({ display_rank: 2.5, weight_kg: 80 });
  });

  it('round-trips NULL display_rank (plain iPhone-authored set)', async () => {
    await db.runAsync(
      `UPDATE "set" SET display_rank = NULL WHERE id = 'origS1'`,
    );
    const snap = await captureSessionSnapshot(db, sessionId);
    expect(snap!.sets[0].display_rank).toBeNull();
    await restoreSessionFromSnapshot(db, snap!);
    const after = await db.getFirstAsync<{ display_rank: number | null }>(
      `SELECT display_rank FROM "set" WHERE id = 'origS1'`,
    );
    expect(after!.display_rank).toBeNull();
  });

  // GAP (2026-06-25 integration hardening): the display_rank fix (f44ce9c) was
  // only verified on the solo set `origS1`. A Watch-side reorder of a DROPSET
  // CLUSTER writes fractional display_ranks on the head AND its followers. The
  // capture SELECT / restore INSERT have no set_kind clause, so they SHOULD
  // preserve the rank for clustered rows too — pin that so a future "only solo"
  // narrowing of the snapshot query can't silently lose cluster order.
  it('captures + restores display_rank for a DROPSET cluster (head + followers), not just solo sets', async () => {
    // Seed a dropset head + 2 followers, each with a distinct fractional rank a
    // Watch reorder would produce (interleaved between origS1's integers).
    await insertSessionSet(db, {
      id: 'dropHead',
      session_id: sessionId,
      exercise_id: exA,
      weight_kg: 100,
      reps: 5,
      is_skipped: 0,
      ordering: 2,
      created_at: 1200,
      set_kind: 'dropset',
      parent_set_id: null,
      session_exercise_id: seId,
    });
    await insertSessionSet(db, {
      id: 'dropFollow1',
      session_id: sessionId,
      exercise_id: exA,
      weight_kg: 80,
      reps: 6,
      is_skipped: 0,
      ordering: 3,
      created_at: 1300,
      set_kind: 'dropset',
      parent_set_id: 'dropHead',
      session_exercise_id: seId,
    });
    await insertSessionSet(db, {
      id: 'dropFollow2',
      session_id: sessionId,
      exercise_id: exA,
      weight_kg: 60,
      reps: 8,
      is_skipped: 0,
      ordering: 4,
      created_at: 1400,
      set_kind: 'dropset',
      parent_set_id: 'dropHead',
      session_exercise_id: seId,
    });
    // Watch reorder fractional ranks (head + followers all get one).
    await db.runAsync(`UPDATE "set" SET display_rank = 1.0 WHERE id = 'origS1'`);
    await db.runAsync(`UPDATE "set" SET display_rank = 1.25 WHERE id = 'dropHead'`);
    await db.runAsync(`UPDATE "set" SET display_rank = 1.5 WHERE id = 'dropFollow1'`);
    await db.runAsync(`UPDATE "set" SET display_rank = 1.75 WHERE id = 'dropFollow2'`);

    const snap = await captureSessionSnapshot(db, sessionId);
    const byId = new Map(snap!.sets.map((s) => [s.id, s.display_rank]));
    expect(byId.get('dropHead')).toBe(1.25);
    expect(byId.get('dropFollow1')).toBe(1.5);
    expect(byId.get('dropFollow2')).toBe(1.75);
    // parent_set_id must survive too (cluster identity), else restore re-creates
    // orphan followers.
    const headParent = snap!.sets.find((s) => s.id === 'dropHead')!.parent_set_id;
    const f1Parent = snap!.sets.find((s) => s.id === 'dropFollow1')!.parent_set_id;
    expect(headParent).toBeNull();
    expect(f1Parent).toBe('dropHead');

    // Simulate an edit that destroys the cluster ranks, then discard (restore).
    await db.runAsync(`UPDATE "set" SET display_rank = NULL`);
    await restoreSessionFromSnapshot(db, snap!);

    const after = await db.getAllAsync<{ id: string; display_rank: number | null; parent_set_id: string | null }>(
      `SELECT id, display_rank, parent_set_id FROM "set" WHERE session_id = ? ORDER BY display_rank ASC`,
      sessionId,
    );
    expect(after.map((r) => [r.id, r.display_rank])).toEqual([
      ['origS1', 1.0],
      ['dropHead', 1.25],
      ['dropFollow1', 1.5],
      ['dropFollow2', 1.75],
    ]);
    // Cluster linkage restored intact.
    expect(after.find((r) => r.id === 'dropFollow1')!.parent_set_id).toBe('dropHead');
    expect(after.find((r) => r.id === 'dropFollow2')!.parent_set_id).toBe('dropHead');
  });

  // GAP companion: a Watch reorder can interleave sets across DIFFERENT
  // exercises (it sorts by display_rank globally, independent of ordering /
  // session_exercise_id). Pin that capture/restore preserves a fractional rank
  // on a set belonging to a SECOND exercise card too, so the round-trip isn't
  // accidentally scoped to a single session_exercise.
  it('captures + restores display_rank across a SECOND exercise card (multi-card Watch reorder)', async () => {
    const se2 = 'se-snap-2';
    await db.runAsync(
      `INSERT INTO session_exercise
         (id, session_id, exercise_id, ordering, planned_sets,
          planned_reps, planned_weight_kg, template_id, is_evergreen, parent_id)
       VALUES (?, ?, ?, 2, 3, NULL, NULL, NULL, 0, NULL)`,
      se2,
      sessionId,
      exB,
    );
    await insertSessionSet(db, {
      id: 'exB-set',
      session_id: sessionId,
      exercise_id: exB,
      weight_kg: 50,
      reps: 10,
      is_skipped: 0,
      ordering: 1,
      created_at: 1200,
      set_kind: 'working',
      parent_set_id: null,
      session_exercise_id: se2,
    });
    // Watch interleaves exB's set BETWEEN origS1 and its (non-existent) next set
    // — a fractional rank that disagrees with the per-card ordering=1.
    await db.runAsync(`UPDATE "set" SET display_rank = 1.0 WHERE id = 'origS1'`);
    await db.runAsync(`UPDATE "set" SET display_rank = 1.5 WHERE id = 'exB-set'`);

    const snap = await captureSessionSnapshot(db, sessionId);
    expect(snap!.sets.find((s) => s.id === 'exB-set')!.display_rank).toBe(1.5);

    await db.runAsync(`UPDATE "set" SET display_rank = NULL`);
    await restoreSessionFromSnapshot(db, snap!);

    const after = await db.getAllAsync<{ id: string; display_rank: number | null }>(
      `SELECT id, display_rank FROM "set" WHERE session_id = ? ORDER BY display_rank ASC`,
      sessionId,
    );
    expect(after).toEqual([
      { id: 'origS1', display_rank: 1.0 },
      { id: 'exB-set', display_rank: 1.5 },
    ]);
  });

  it('restore reverts ADD: extra set added during edit is gone after restore', async () => {
    const snap = await captureSessionSnapshot(db, sessionId);
    // Simulate edit: add a new set
    await insertSessionSet(db, {
      id: 'editAdded',
      session_id: sessionId,
      exercise_id: exA,
      weight_kg: 100,
      reps: 3,
      is_skipped: 0,
      ordering: 2,
      created_at: 1500,
      set_kind: 'working',
      parent_set_id: null,
      session_exercise_id: seId,
    });
    const before = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM "set" WHERE session_id = ? ORDER BY ordering ASC`,
      sessionId,
    );
    expect(before.map((r) => r.id)).toEqual(['origS1', 'editAdded']);

    await restoreSessionFromSnapshot(db, snap!);

    const after = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM "set" WHERE session_id = ? ORDER BY ordering ASC`,
      sessionId,
    );
    expect(after.map((r) => r.id)).toEqual(['origS1']);
  });

  it('restore reverts DELETE: deleted set is back with same id + same is_logged + same notes', async () => {
    const snap = await captureSessionSnapshot(db, sessionId);
    // Simulate edit: delete origS1
    await deleteSet(db, 'origS1');
    const mid = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM "set" WHERE session_id = ?`,
      sessionId,
    );
    expect(mid).toHaveLength(0);

    await restoreSessionFromSnapshot(db, snap!);

    const after = await db.getFirstAsync<{
      id: string;
      is_logged: number;
      notes: string | null;
    }>(`SELECT id, is_logged, notes FROM "set" WHERE id = 'origS1'`);
    expect(after).not.toBeNull();
    expect(after!.is_logged).toBe(1);
    expect(after!.notes).toBe('orig note');
  });

  it('restore reverts UPDATE: weight change on existing set is rolled back', async () => {
    const snap = await captureSessionSnapshot(db, sessionId);
    await db.runAsync(
      `UPDATE "set" SET weight_kg = 999, reps = 1 WHERE id = 'origS1'`,
    );
    await restoreSessionFromSnapshot(db, snap!);
    const after = await db.getFirstAsync<{ weight_kg: number; reps: number }>(
      `SELECT weight_kg, reps FROM "set" WHERE id = 'origS1'`,
    );
    expect(after).toEqual({ weight_kg: 80, reps: 5 });
  });

  it('restore reverts session time edits', async () => {
    const snap = await captureSessionSnapshot(db, sessionId);
    await db.runAsync(
      `UPDATE session SET started_at = 5000, ended_at = 6000 WHERE id = ?`,
      sessionId,
    );
    await restoreSessionFromSnapshot(db, snap!);
    const after = await db.getFirstAsync<{
      started_at: number;
      ended_at: number;
    }>(`SELECT started_at, ended_at FROM session WHERE id = ?`, sessionId);
    expect(after).toEqual({ started_at: 1000, ended_at: 2000 });
  });

  it('restore re-binds achievement_unlock back-ref after deleted set comes back', async () => {
    // Seed an unlock pointing to origS1
    const def = await db.getFirstAsync<{ id: number }>(
      `SELECT id FROM achievement_definition ORDER BY id ASC LIMIT 1`,
    );
    await db.runAsync(
      `INSERT INTO achievement_unlock
         (achievement_definition_id, unlocked_at, session_id, set_id)
       VALUES (?, ?, ?, ?)`,
      def!.id,
      1100,
      sessionId,
      'origS1',
    );

    const snap = await captureSessionSnapshot(db, sessionId);
    expect(snap!.achievementUnlocks).toHaveLength(1);
    expect(snap!.achievementUnlocks[0].set_id).toBe('origS1');

    // Edit: delete origS1 (this NULLs the back-ref per fix(set-delete) wave)
    await deleteSet(db, 'origS1');
    const mid = await db.getFirstAsync<{ set_id: string | null }>(
      `SELECT set_id FROM achievement_unlock WHERE session_id = ?`,
      sessionId,
    );
    expect(mid?.set_id).toBeNull();

    // Restore should re-insert origS1 AND re-bind unlock
    await restoreSessionFromSnapshot(db, snap!);
    const after = await db.getFirstAsync<{ set_id: string | null }>(
      `SELECT set_id FROM achievement_unlock WHERE session_id = ?`,
      sessionId,
    );
    expect(after?.set_id).toBe('origS1');
  });

  it('restore reverts session_exercise addition: extra card added during edit is gone', async () => {
    const snap = await captureSessionSnapshot(db, sessionId);
    const extraSeId = 'se-extra';
    await db.runAsync(
      `INSERT INTO session_exercise
         (id, session_id, exercise_id, ordering, planned_sets,
          planned_reps, planned_weight_kg, template_id, is_evergreen, parent_id)
       VALUES (?, ?, ?, 2, 3, NULL, NULL, NULL, 0, NULL)`,
      extraSeId,
      sessionId,
      exB,
    );
    await restoreSessionFromSnapshot(db, snap!);
    const seRows = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM session_exercise WHERE session_id = ?`,
      sessionId,
    );
    expect(seRows.map((r) => r.id)).toEqual([seId]);
  });
});
