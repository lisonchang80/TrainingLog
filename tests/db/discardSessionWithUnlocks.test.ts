import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { insertSessionSet } from '../../src/adapters/sqlite/setRepository';
import { discardSession } from '../../src/adapters/sqlite/sessionRepository';

/**
 * Regression: `discardSession` used to throw FOREIGN KEY constraint failed
 * whenever the session being discarded had any `achievement_unlock` rows
 * pointing at it (PR / first-combo unlocks earned during the session).
 *
 * v008 schema:
 *   - achievement_unlock.session_id TEXT NOT NULL REFERENCES session(id)
 *   - achievement_unlock.set_id     TEXT REFERENCES "set"(id)
 *   Both FKs lack ON DELETE clauses.
 *
 * Fix (2026-05-20 wave 12 完工): the discard transaction now (a) NULLs any
 * cross-session set_id back-refs into this session's sets (defensive — same-
 * session refs are about to be deleted anyway) and (b) DELETEs all unlocks
 * owned by this session before deleting the sets/session_exercise/session
 * rows.
 *
 * Semantic: discardSession = "this session never happened" → unlocks earned
 * here are revoked (re-earnable later via UNIQUE achievement_definition_id).
 *
 * User-facing symptom (pre-fix): "Discard failed → FOREIGN KEY constraint
 * failed" Alert in the [⋯] menu when a PR was hit during the session.
 */
describe('discardSession × achievement_unlock back-refs', () => {
  let db: BetterSqliteDatabase;
  const exA = '00000000-0000-4000-8000-000000000001';
  const sessionId = 'sess-discard-1';
  const otherSessionId = 'sess-other-1';
  const seId = 'se-discard';
  const otherSeId = 'se-other';
  const now = Date.now();

  let achDefId1: number;
  let achDefId2: number;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);

    const defs = await db.getAllAsync<{ id: number }>(
      `SELECT id FROM achievement_definition ORDER BY id ASC LIMIT 2`,
    );
    achDefId1 = defs[0].id;
    achDefId2 = defs[1].id;

    await db.runAsync(
      `INSERT INTO session (id, started_at) VALUES (?, ?)`,
      sessionId,
      now,
    );
    await db.runAsync(
      `INSERT INTO session_exercise
         (id, session_id, exercise_id, ordering, planned_sets,
          planned_reps, planned_weight_kg, template_id, is_evergreen, parent_id)
       VALUES (?, ?, ?, 1, 1, NULL, NULL, NULL, 0, NULL)`,
      seId,
      sessionId,
      exA,
    );
  });

  afterEach(() => {
    db.close();
  });

  async function insertUnlock(opts: {
    defId: number;
    session_id: string;
    set_id: string | null;
  }): Promise<void> {
    await db.runAsync(
      `INSERT INTO achievement_unlock
         (achievement_definition_id, unlocked_at, session_id, set_id)
       VALUES (?, ?, ?, ?)`,
      opts.defId,
      now,
      opts.session_id,
      opts.set_id,
    );
  }

  it('does not throw when session has unlocks with set_id back-refs', async () => {
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
      session_exercise_id: seId,
    });
    await insertUnlock({ defId: achDefId1, session_id: sessionId, set_id: 'S1' });

    await expect(discardSession(db, sessionId)).resolves.not.toThrow();

    // Session + descendant rows are gone.
    const sessRow = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM session WHERE id = ?`,
      sessionId,
    );
    expect(sessRow).toBeNull();
    const setRow = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM "set" WHERE id = 'S1'`,
    );
    expect(setRow).toBeNull();
    const seRow = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM session_exercise WHERE session_id = ?`,
      sessionId,
    );
    expect(seRow).toBeNull();
    // Unlock for this session is revoked.
    const unlockRow = await db.getFirstAsync<{ id: number }>(
      `SELECT id FROM achievement_unlock WHERE achievement_definition_id = ?`,
      achDefId1,
    );
    expect(unlockRow).toBeNull();
  });

  it('does not throw when session has unlocks with NULL set_id (session-only back-ref)', async () => {
    // session_count category unlocks have set_id NULL but session_id NOT NULL —
    // this is the original FK that the bug fix targets.
    await insertUnlock({
      defId: achDefId1,
      session_id: sessionId,
      set_id: null,
    });

    await expect(discardSession(db, sessionId)).resolves.not.toThrow();

    const sessRow = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM session WHERE id = ?`,
      sessionId,
    );
    expect(sessRow).toBeNull();
    const unlockRow = await db.getFirstAsync<{ id: number }>(
      `SELECT id FROM achievement_unlock WHERE session_id = ?`,
      sessionId,
    );
    expect(unlockRow).toBeNull();
  });

  it('revokes ALL unlocks for the discarded session, regardless of set_id status', async () => {
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
      session_exercise_id: seId,
    });
    // Two unlocks owned by this session: one with set_id, one without.
    await insertUnlock({ defId: achDefId1, session_id: sessionId, set_id: 'S1' });
    await insertUnlock({ defId: achDefId2, session_id: sessionId, set_id: null });

    await discardSession(db, sessionId);

    const remaining = await db.getAllAsync<{ id: number }>(
      `SELECT id FROM achievement_unlock`,
    );
    expect(remaining).toEqual([]);
  });

  it('does not touch unlocks owned by OTHER sessions', async () => {
    // Other session with its own unlock — should survive untouched.
    await db.runAsync(
      `INSERT INTO session (id, started_at) VALUES (?, ?)`,
      otherSessionId,
      now,
    );
    await db.runAsync(
      `INSERT INTO session_exercise
         (id, session_id, exercise_id, ordering, planned_sets,
          planned_reps, planned_weight_kg, template_id, is_evergreen, parent_id)
       VALUES (?, ?, ?, 1, 1, NULL, NULL, NULL, 0, NULL)`,
      otherSeId,
      otherSessionId,
      exA,
    );
    await insertSessionSet(db, {
      id: 'OTHER_S1',
      session_id: otherSessionId,
      exercise_id: exA,
      weight_kg: 90,
      reps: 4,
      is_skipped: 0,
      ordering: 1,
      created_at: now,
      set_kind: 'working',
      parent_set_id: null,
      session_exercise_id: otherSeId,
    });
    await insertUnlock({
      defId: achDefId1,
      session_id: otherSessionId,
      set_id: 'OTHER_S1',
    });
    // Discarded session has its own unlock too.
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
      session_exercise_id: seId,
    });
    await insertUnlock({ defId: achDefId2, session_id: sessionId, set_id: 'S1' });

    await discardSession(db, sessionId);

    const surviving = await db.getAllAsync<{
      achievement_definition_id: number;
      session_id: string;
      set_id: string | null;
    }>(
      `SELECT achievement_definition_id, session_id, set_id
         FROM achievement_unlock`,
    );
    expect(surviving).toHaveLength(1);
    expect(surviving[0].achievement_definition_id).toBe(achDefId1);
    expect(surviving[0].session_id).toBe(otherSessionId);
    expect(surviving[0].set_id).toBe('OTHER_S1');
  });

  it('defensively NULLs cross-session set_id refs pointing into discarded session', async () => {
    // Pathological: an unlock OWNED by other session, but its set_id back-ref
    // points at a set INSIDE the session we're about to discard. Production
    // achievement code never writes this combination (session_id and set_id
    // come from the same context), but the schema doesn't enforce the
    // invariant — so defensive code NULLs the back-ref before the set is
    // deleted, instead of cascading the unlock revocation.
    await db.runAsync(
      `INSERT INTO session (id, started_at) VALUES (?, ?)`,
      otherSessionId,
      now,
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
      session_exercise_id: seId,
    });
    await insertUnlock({
      defId: achDefId1,
      session_id: otherSessionId,
      set_id: 'S1', // cross-session ref
    });

    await expect(discardSession(db, sessionId)).resolves.not.toThrow();

    // The unlock survives (it's owned by other session) but the cross-session
    // back-ref is NULLed since the target set is being deleted.
    const survivor = await db.getFirstAsync<{
      session_id: string;
      set_id: string | null;
    }>(`SELECT session_id, set_id FROM achievement_unlock`);
    expect(survivor).not.toBeNull();
    expect(survivor!.session_id).toBe(otherSessionId);
    expect(survivor!.set_id).toBeNull();
  });

  it('is a no-op on the unlock table when session has zero unlocks', async () => {
    // Sanity: discarding a session with no PR / combo unlocks should not
    // change the achievement_unlock table (regression against accidentally
    // deleting unrelated rows).
    await db.runAsync(
      `INSERT INTO session (id, started_at) VALUES (?, ?)`,
      otherSessionId,
      now,
    );
    await insertUnlock({
      defId: achDefId1,
      session_id: otherSessionId,
      set_id: null,
    });

    await discardSession(db, sessionId);

    const all = await db.getAllAsync<{ id: number }>(
      `SELECT id FROM achievement_unlock`,
    );
    expect(all).toHaveLength(1);
  });
});
