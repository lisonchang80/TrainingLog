import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  insertSessionSet,
  deleteSet,
  deleteClusterCycle,
} from '../../src/adapters/sqlite/setRepository';
import { deleteSessionExerciseAndSets } from '../../src/adapters/sqlite/sessionRepository';

/**
 * Regression: deleting a set with a back-ref in `achievement_unlock.set_id`
 * used to trip `FOREIGN KEY constraint failed` (v008 schema declares the FK
 * without `ON DELETE` action). Fix NULLs the back-ref BEFORE the DELETE so
 * the achievement record itself stays unlocked, only the pointer is severed.
 *
 * User-facing symptom (2026-05-20 night smoke): "Delete failed → Caused by:
 * Error code 19: FOREIGN KEY constraint failed" when swipe-deleting a logged
 * dropset chain head.
 */
describe('achievement_unlock back-ref handling on set delete', () => {
  let db: BetterSqliteDatabase;
  const exA = '00000000-0000-4000-8000-000000000001';
  const exB = '00000000-0000-4000-8000-000000000002';
  const sessionId = 'sess-ach-1';
  const seSolo = 'se-solo';
  const seA = 'se-A';
  const seB = 'se-B';
  const now = Date.now();

  // We need a real `achievement_definition.id` to seed unlock rows.
  // v008 seeds ~255 rows on migrate; just grab the first.
  let achDefId: number;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);

    const def = await db.getFirstAsync<{ id: number }>(
      `SELECT id FROM achievement_definition ORDER BY id ASC LIMIT 1`,
    );
    achDefId = def!.id;

    await db.runAsync(
      `INSERT INTO session (id, started_at) VALUES (?, ?)`,
      sessionId,
      now,
    );
  });

  afterEach(() => {
    db.close();
  });

  async function insertUnlock(set_id: string, defId = achDefId): Promise<void> {
    await db.runAsync(
      `INSERT INTO achievement_unlock
         (achievement_definition_id, unlocked_at, session_id, set_id)
       VALUES (?, ?, ?, ?)`,
      defId,
      now,
      sessionId,
      set_id,
    );
  }

  it('deleteSet on solo set with unlock back-ref does not throw, NULLs back-ref', async () => {
    await db.runAsync(
      `INSERT INTO session_exercise
         (id, session_id, exercise_id, ordering, planned_sets,
          planned_reps, planned_weight_kg, template_id, is_evergreen, parent_id)
       VALUES (?, ?, ?, 1, 1, NULL, NULL, NULL, 0, NULL)`,
      seSolo,
      sessionId,
      exA,
    );
    await insertSessionSet(db, {
      id: 'S1',
      session_id: sessionId,
      exercise_id: exA,
      weight_kg: 100,
      reps: 5,
      is_skipped: 0,
      ordering: 1,
      created_at: now,
      set_kind: 'working',
      parent_set_id: null,
      session_exercise_id: seSolo,
    });
    await insertUnlock('S1');

    // Pre-condition: unlock row references S1.
    const before = await db.getFirstAsync<{ set_id: string | null }>(
      `SELECT set_id FROM achievement_unlock WHERE session_id = ?`,
      sessionId,
    );
    expect(before?.set_id).toBe('S1');

    // Without the fix this throws FOREIGN KEY constraint failed.
    await expect(deleteSet(db, 'S1')).resolves.not.toThrow();

    // Set is gone, unlock record survived with NULLed back-ref.
    const setRow = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM "set" WHERE id = 'S1'`,
    );
    expect(setRow).toBeNull();
    const after = await db.getFirstAsync<{ set_id: string | null }>(
      `SELECT set_id FROM achievement_unlock WHERE session_id = ?`,
      sessionId,
    );
    expect(after?.set_id).toBeNull();
  });

  it('deleteSet on dropset HEAD cascades unlock-NULL to followers too', async () => {
    await db.runAsync(
      `INSERT INTO session_exercise
         (id, session_id, exercise_id, ordering, planned_sets,
          planned_reps, planned_weight_kg, template_id, is_evergreen, parent_id)
       VALUES (?, ?, ?, 1, 1, NULL, NULL, NULL, 0, NULL)`,
      seSolo,
      sessionId,
      exA,
    );
    // D1 head + 2 followers
    await insertSessionSet(db, {
      id: 'H', session_id: sessionId, exercise_id: exA,
      weight_kg: 60, reps: 12, is_skipped: 0, ordering: 1, created_at: now,
      set_kind: 'dropset', parent_set_id: null, session_exercise_id: seSolo,
    });
    await insertSessionSet(db, {
      id: 'F1', session_id: sessionId, exercise_id: exA,
      weight_kg: 40, reps: 10, is_skipped: 0, ordering: 2, created_at: now,
      set_kind: 'dropset', parent_set_id: 'H', session_exercise_id: seSolo,
    });
    await insertSessionSet(db, {
      id: 'F2', session_id: sessionId, exercise_id: exA,
      weight_kg: 25, reps: 8, is_skipped: 0, ordering: 3, created_at: now,
      set_kind: 'dropset', parent_set_id: 'H', session_exercise_id: seSolo,
    });

    // Both head AND a follower have unlock back-refs (improbable but possible)
    await insertUnlock('H');

    // Pre-flight insert a 2nd unlock row pointing at F1. v008 schema has
    // UNIQUE on achievement_definition_id so use a different definition.
    const defs = await db.getAllAsync<{ id: number }>(
      `SELECT id FROM achievement_definition ORDER BY id ASC LIMIT 2`,
    );
    await insertUnlock('F1', defs[1].id);

    await expect(deleteSet(db, 'H')).resolves.not.toThrow();

    // All three sets gone.
    const remaining = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM "set" WHERE session_id = ?`,
      sessionId,
    );
    expect(remaining.length).toBe(0);

    // Both unlock rows survived with NULL back-refs.
    const unlocks = await db.getAllAsync<{ set_id: string | null }>(
      `SELECT set_id FROM achievement_unlock WHERE session_id = ?`,
      sessionId,
    );
    expect(unlocks.length).toBe(2);
    expect(unlocks.every((u) => u.set_id === null)).toBe(true);
  });

  it('deleteSessionExerciseAndSets clears back-refs for all sets in the card', async () => {
    await db.runAsync(
      `INSERT INTO session_exercise
         (id, session_id, exercise_id, ordering, planned_sets,
          planned_reps, planned_weight_kg, template_id, is_evergreen, parent_id)
       VALUES (?, ?, ?, 1, 1, NULL, NULL, NULL, 0, NULL)`,
      seSolo,
      sessionId,
      exA,
    );
    await insertSessionSet(db, {
      id: 'X1', session_id: sessionId, exercise_id: exA,
      weight_kg: 80, reps: 6, is_skipped: 0, ordering: 1, created_at: now,
      set_kind: 'working', parent_set_id: null, session_exercise_id: seSolo,
    });
    await insertSessionSet(db, {
      id: 'X2', session_id: sessionId, exercise_id: exA,
      weight_kg: 80, reps: 6, is_skipped: 0, ordering: 2, created_at: now,
      set_kind: 'working', parent_set_id: null, session_exercise_id: seSolo,
    });
    await insertUnlock('X1');

    await expect(
      deleteSessionExerciseAndSets(db, {
        session_id: sessionId,
        exercise_id: exA,
        session_exercise_id: seSolo,
      }),
    ).resolves.not.toThrow();

    const after = await db.getFirstAsync<{ set_id: string | null }>(
      `SELECT set_id FROM achievement_unlock WHERE session_id = ?`,
      sessionId,
    );
    expect(after?.set_id).toBeNull();
  });

  it('deleteClusterCycle clears back-refs on both A and B side', async () => {
    // Cluster A + B
    await db.runAsync(
      `INSERT INTO session_exercise
         (id, session_id, exercise_id, ordering, planned_sets,
          planned_reps, planned_weight_kg, template_id, is_evergreen, parent_id)
       VALUES (?, ?, ?, 1, 1, NULL, NULL, NULL, 0, NULL)`,
      seA, sessionId, exA,
    );
    await db.runAsync(
      `INSERT INTO session_exercise
         (id, session_id, exercise_id, ordering, planned_sets,
          planned_reps, planned_weight_kg, template_id, is_evergreen, parent_id)
       VALUES (?, ?, ?, 2, 1, NULL, NULL, NULL, 0, ?)`,
      seB, sessionId, exB, seA,
    );
    await insertSessionSet(db, {
      id: 'CA', session_id: sessionId, exercise_id: exA,
      weight_kg: 60, reps: 8, is_skipped: 0, ordering: 1, created_at: now,
      set_kind: 'working', parent_set_id: null, session_exercise_id: seA,
    });
    await insertSessionSet(db, {
      id: 'CB', session_id: sessionId, exercise_id: exB,
      weight_kg: 0, reps: 8, is_skipped: 0, ordering: 2, created_at: now,
      set_kind: 'working', parent_set_id: null, session_exercise_id: seB,
    });
    await insertUnlock('CA');
    const defs = await db.getAllAsync<{ id: number }>(
      `SELECT id FROM achievement_definition ORDER BY id ASC LIMIT 2`,
    );
    await insertUnlock('CB', defs[1].id);

    await expect(
      deleteClusterCycle(db, { a_set_id: 'CA', b_set_id: 'CB' }),
    ).resolves.not.toThrow();

    const unlocks = await db.getAllAsync<{ set_id: string | null }>(
      `SELECT set_id FROM achievement_unlock WHERE session_id = ?`,
      sessionId,
    );
    expect(unlocks.length).toBe(2);
    expect(unlocks.every((u) => u.set_id === null)).toBe(true);
  });
});
