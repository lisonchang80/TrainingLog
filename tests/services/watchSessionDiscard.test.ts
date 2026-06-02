/**
 * Slice 13d D31 wave 2 — watchSessionDiscard.ts orchestrator tests.
 *
 * Per ADR-0019 § Slice 13d NEW-Q50 wave-2 abort path. The orchestrator
 * is a thin wrapper around `discardSession` so the focus here is:
 *   - Happy path — the FULL cascade: session + session_exercise + set +
 *     achievement_unlock rows are all gone after onDiscardSession returns
 *     ok. (The cascade mechanics themselves are also covered in
 *     tests/db/discardSessionWithUnlocks.test.ts; here we additionally
 *     verify the orchestrator wires through to it and reports ok.)
 *   - Idempotence — running twice on the same envelope is safe (second
 *     call is a sequence of DELETE WHERE no-ops, no throw).
 *   - Non-existent session — never-existed sessionId returns ok (the
 *     row is "gone" by virtue of never existing).
 *   - Bad payload guard — empty / missing sessionId rejected with
 *     bad-payload code, db untouched.
 *   - Side filter — only side==='watch' acts; side==='iphone' is rejected
 *     with wrong-side and the db is untouched (mirrors end-session's
 *     defensive self-echo guard).
 *
 * No WC bridge mocking — orchestrator is pure DB. Real SQLite in-memory
 * via better-sqlite3 fixture. Mirror of `watchSessionResolve.test.ts`.
 */

import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  createSession,
  getSession,
  insertSessionExercise,
} from '../../src/adapters/sqlite/sessionRepository';
import { insertSessionSet } from '../../src/adapters/sqlite/setRepository';
import { onDiscardSession } from '../../src/services/watchSessionDiscard';
import { makeEnvelope } from '../../src/adapters/watch';

describe('Slice 13d D31 wave 2 — onDiscardSession orchestrator', () => {
  let db: BetterSqliteDatabase;

  // Stable IDs reused across the cascade seed.
  const exA = '00000000-0000-4000-8000-000000000001';

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  /**
   * Seed a session with one session_exercise, one set, and one
   * achievement_unlock back-ref pointing at that set, so the happy-path
   * test can assert the full cascade fired through the orchestrator.
   * Returns the achievement_definition_id used for the unlock.
   */
  async function seedFullSession(sessionId: string): Promise<number> {
    const seId = `se-${sessionId}`;
    const setId = `set-${sessionId}`;
    const now = 1_000;

    await createSession(db, { id: sessionId, started_at: now });
    await insertSessionExercise(db, {
      id: seId,
      session_id: sessionId,
      exercise_id: exA,
      ordering: 1,
      planned_sets: 1,
      planned_reps: null,
      planned_weight_kg: null,
      template_id: null,
      is_evergreen: 0,
      parent_id: null,
      reusable_superset_id: null,
      rest_sec: null,
    });
    await insertSessionSet(db, {
      id: setId,
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

    const defRow = await db.getFirstAsync<{ id: number }>(
      `SELECT id FROM achievement_definition ORDER BY id ASC LIMIT 1`,
    );
    const defId = defRow!.id;
    await db.runAsync(
      `INSERT INTO achievement_unlock
         (achievement_definition_id, unlocked_at, session_id, set_id)
       VALUES (?, ?, ?, ?)`,
      defId,
      now,
      sessionId,
      setId,
    );
    return defId;
  }

  async function countSets(sessionId: string): Promise<number> {
    const rows = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM "set" WHERE session_id = ?`,
      sessionId,
    );
    return rows.length;
  }

  async function countSessionExercises(sessionId: string): Promise<number> {
    const rows = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM session_exercise WHERE session_id = ?`,
      sessionId,
    );
    return rows.length;
  }

  async function countUnlocks(sessionId: string): Promise<number> {
    const rows = await db.getAllAsync<{ id: number }>(
      `SELECT id FROM achievement_unlock WHERE session_id = ?`,
      sessionId,
    );
    return rows.length;
  }

  it('happy path — cascade removes session + exercises + sets + achievement_unlock', async () => {
    const sessionId = 'sess-discard-happy';
    await seedFullSession(sessionId);
    // Sanity: everything is present before discard.
    expect(await getSession(db, sessionId)).not.toBeNull();
    expect(await countSessionExercises(sessionId)).toBe(1);
    expect(await countSets(sessionId)).toBe(1);
    expect(await countUnlocks(sessionId)).toBe(1);

    const env = makeEnvelope('discard-session', {
      sessionId,
      side: 'watch',
    });
    const result = await onDiscardSession(db, env);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sessionId).toBe(sessionId);
    }
    // Full cascade gone.
    expect(await getSession(db, sessionId)).toBeNull();
    expect(await countSessionExercises(sessionId)).toBe(0);
    expect(await countSets(sessionId)).toBe(0);
    expect(await countUnlocks(sessionId)).toBe(0);
  });

  it('idempotent — second call on same envelope is a safe no-op', async () => {
    const sessionId = 'sess-discard-idem';
    await seedFullSession(sessionId);
    const env = makeEnvelope('discard-session', {
      sessionId,
      side: 'watch',
    });

    const first = await onDiscardSession(db, env);
    expect(first.ok).toBe(true);
    expect(await getSession(db, sessionId)).toBeNull();

    // Watch's TUI may redeliver — rerun must not throw and stays ok.
    const second = await onDiscardSession(db, env);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.sessionId).toBe(sessionId);
    }
  });

  it('non-existent session — returns ok (sequence of DELETE WHERE no-ops)', async () => {
    const env = makeEnvelope('discard-session', {
      sessionId: 'sess-never-existed',
      side: 'watch',
    });
    const result = await onDiscardSession(db, env);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sessionId).toBe('sess-never-existed');
    }
  });

  it('bad-payload guard — empty sessionId rejected, db untouched', async () => {
    await createSession(db, { id: 'sess-guard-canary', started_at: 3_000 });

    const env = makeEnvelope('discard-session', {
      sessionId: '',
      side: 'watch',
    });
    const result = await onDiscardSession(db, env);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('bad-payload');
    }
    // Canary session still present — we did not run any DELETE.
    expect(await getSession(db, 'sess-guard-canary')).not.toBeNull();
  });

  it('side filter — side=iphone rejected with wrong-side, db untouched', async () => {
    // Defensive self-echo guard: iPhone-initiated discard is not a defined
    // path. Only side==='watch' should act.
    const sessionId = 'sess-wrong-side';
    await seedFullSession(sessionId);

    const env = makeEnvelope('discard-session', {
      sessionId,
      side: 'iphone',
    });
    const result = await onDiscardSession(db, env);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('wrong-side');
    }
    // Session + full cascade untouched — no DELETE ran.
    expect(await getSession(db, sessionId)).not.toBeNull();
    expect(await countSessionExercises(sessionId)).toBe(1);
    expect(await countSets(sessionId)).toBe(1);
    expect(await countUnlocks(sessionId)).toBe(1);
  });

  it('never throws — a DB failure surfaces as { ok:false, code:"db-error" }', async () => {
    // The handler's contract is to catch any discardSession failure and return
    // a structured result (the addUserInfoListener caller fire-and-forgets).
    // Close the connection after the side guard passes so discardSession
    // throws into the db-error catch.
    db.close();
    const env = makeEnvelope('discard-session', {
      sessionId: 'sess-db-error',
      side: 'watch',
    });
    const result = await onDiscardSession(db, env);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('db-error');
      expect(result.message).toBeTruthy();
    }
    // Re-open so afterEach's close() is safe (the closed handle is torn down).
    db = new BetterSqliteDatabase(':memory:');
  });
});
