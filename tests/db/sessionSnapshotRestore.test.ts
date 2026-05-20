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
