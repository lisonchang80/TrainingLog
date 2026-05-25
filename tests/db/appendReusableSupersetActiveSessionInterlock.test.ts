import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  createSession,
  endSession,
  getActiveSession,
  appendReusableSupersetToSession,
} from '../../src/adapters/sqlite/sessionRepository';
import { insertReusableSuperset } from '../../src/adapters/sqlite/supersetRepository';

/**
 * `appendReusableSupersetToSession` × active-session interlock
 *
 * Test gap from `docs/audit/2026-05-24-test-gap-and-dead-code.md` § 5 #1 (deferred
 * follow-up). The existing dup guard in `appendReusableSupersetToSession` is
 * scoped to ONE session (`WHERE session_id = ? AND reusable_superset_id = ?`);
 * it does NOT prevent the same RS template from appearing in multiple sessions.
 *
 * These tests lock in the cross-session behavior so a future refactor that
 * (mistakenly) tightens the guard to "RS template can only ever appear in ONE
 * active session" would be caught here. The current contract is:
 *
 *   1. Append RS into a fresh active session (ended_at IS NULL) → succeeds, A+B
 *      atomically appended with parent_id linkage + shared reusable_superset_id.
 *   2. Append RS into a finished (ended_at IS NOT NULL) session → also succeeds.
 *      The function does NOT inspect session.ended_at; the caller's UX
 *      decides which sessions are "writable". This is intentional —
 *      `restoreSessionFromSnapshot` / edit-mode flows need to re-append into
 *      finished sessions.
 *   3. Append RS when NO active session exists → succeeds against any explicit
 *      target session_id (the function takes session_id as a parameter; it does
 *      not implicitly resolve "the active session"). Caller must check active
 *      session first via getActiveSession() if that's the UX policy.
 *   4. Dup append into the SAME session → second call rejected with
 *      "duplicate RS in session" (existing guard).
 *   5. SAME RS template appended into TWO DIFFERENT sessions (one finished, one
 *      active) → both succeed. Each session is an independent bucket.
 *   6. SAME RS template appended into TWO DIFFERENT active sessions → both
 *      succeed (production UI keeps only one active session at a time, but the
 *      DB layer doesn't enforce that — only the dup guard within a single
 *      session applies).
 *
 * Slice 10c regression net for the [+動作] picker `consumePick` path.
 */

const BENCH = '00000000-0000-4000-8000-000000000001';
const SQUAT = '00000000-0000-4000-8000-000000000002';

describe('appendReusableSupersetToSession × active-session interlock', () => {
  let db: BetterSqliteDatabase;
  const now = 1700000000000;
  let counter = 0;
  const uuid = () => `uid-${++counter}`;
  let rsId: string;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    counter = 0;
    rsId = await insertReusableSuperset(
      db,
      { name: 'Bench + Squat', color_hex: null, exercise_ids: [BENCH, SQUAT] },
      uuid,
      () => now,
    );
  });

  afterEach(() => {
    db.close();
  });

  it('append into a fresh active session: A+B atomically appended with cluster linkage', async () => {
    await createSession(db, { id: 'sess-active', started_at: now });
    const active = await getActiveSession(db);
    expect(active?.id).toBe('sess-active');

    const { a_id, b_id } = await appendReusableSupersetToSession(db, {
      session_id: 'sess-active',
      reusable_superset_id: rsId,
      uuid,
    });

    const rows = await db.getAllAsync<{
      id: string;
      exercise_id: string;
      ordering: number;
      parent_id: string | null;
      reusable_superset_id: string | null;
    }>(
      `SELECT id, exercise_id, ordering, parent_id, reusable_superset_id
         FROM session_exercise
        WHERE session_id = ?
        ORDER BY ordering ASC`,
      'sess-active',
    );
    expect(rows).toHaveLength(2);
    // A side: parent_id NULL, ordering = 1, both share rsId
    expect(rows[0]).toEqual({
      id: a_id,
      exercise_id: BENCH,
      ordering: 1,
      parent_id: null,
      reusable_superset_id: rsId,
    });
    // B side: parent_id points at A, ordering = 2
    expect(rows[1]).toEqual({
      id: b_id,
      exercise_id: SQUAT,
      ordering: 2,
      parent_id: a_id,
      reusable_superset_id: rsId,
    });
  });

  it('append into a FINISHED session also succeeds — function does not gate on ended_at', async () => {
    // 2026-05-21 wave 12 finish-dialog work clarified that edit-mode flows
    // may legitimately re-append into a finished session via
    // restoreSessionFromSnapshot's helpers. If a future change adds an
    // ended_at NULL guard here it must come with a deliberate caller migration.
    await createSession(db, { id: 'sess-fin', started_at: now });
    await endSession(db, { id: 'sess-fin', ended_at: now + 60_000 });

    const result = await appendReusableSupersetToSession(db, {
      session_id: 'sess-fin',
      reusable_superset_id: rsId,
      uuid,
    });
    expect(result.a_id).toBeTruthy();
    expect(result.b_id).toBeTruthy();

    const count = await db.getFirstAsync<{ c: number }>(
      `SELECT COUNT(*) AS c FROM session_exercise WHERE session_id = ?`,
      'sess-fin',
    );
    expect(count?.c).toBe(2);
  });

  it('append when NO active session exists: succeeds against an explicit session_id (function is target-explicit, not active-implicit)', async () => {
    // Create a session and immediately end it → no active sessions in DB.
    await createSession(db, { id: 'sess-only', started_at: now });
    await endSession(db, { id: 'sess-only', ended_at: now + 1000 });
    const active = await getActiveSession(db);
    expect(active).toBeNull();

    // The function takes an explicit session_id — there is no implicit
    // "active session" resolution. Appending to the still-existing (finished)
    // session works.
    await expect(
      appendReusableSupersetToSession(db, {
        session_id: 'sess-only',
        reusable_superset_id: rsId,
        uuid,
      }),
    ).resolves.toBeDefined();
  });

  it('append targeting a non-existent session_id: rows insert FAIL because of FK on session_exercise.session_id', async () => {
    // No session row exists at all.
    // session_exercise has FK session_id → session(id) (v007 schema), so INSERT
    // should fail. Better-sqlite3 enforces FK in tests; this locks down the
    // invariant that callers must seed the session row first.
    await expect(
      appendReusableSupersetToSession(db, {
        session_id: 'sess-missing',
        reusable_superset_id: rsId,
        uuid,
      }),
    ).rejects.toThrow();
  });

  it('dup append into the SAME session: second call rejected with the existing guard', async () => {
    await createSession(db, { id: 'sess-dup', started_at: now });
    await appendReusableSupersetToSession(db, {
      session_id: 'sess-dup',
      reusable_superset_id: rsId,
      uuid,
    });
    await expect(
      appendReusableSupersetToSession(db, {
        session_id: 'sess-dup',
        reusable_superset_id: rsId,
        uuid,
      }),
    ).rejects.toThrow(/duplicate RS/i);
    // First pair still intact — second call's pre-throw guard means no
    // partial second-pair rows leaked.
    const count = await db.getFirstAsync<{ c: number }>(
      `SELECT COUNT(*) AS c FROM session_exercise WHERE session_id = ?`,
      'sess-dup',
    );
    expect(count?.c).toBe(2);
  });

  it('SAME RS template across TWO sessions (one finished, one active): both succeed independently', async () => {
    // Session 1: finished
    await createSession(db, { id: 'sess-fin-1', started_at: now });
    await appendReusableSupersetToSession(db, {
      session_id: 'sess-fin-1',
      reusable_superset_id: rsId,
      uuid,
    });
    await endSession(db, { id: 'sess-fin-1', ended_at: now + 10_000 });

    // Session 2: active
    await createSession(db, { id: 'sess-act-1', started_at: now + 100_000 });
    await appendReusableSupersetToSession(db, {
      session_id: 'sess-act-1',
      reusable_superset_id: rsId,
      uuid,
    });

    const rowsByRs = await db.getAllAsync<{
      session_id: string;
      ordering: number;
    }>(
      `SELECT session_id, ordering FROM session_exercise
        WHERE reusable_superset_id = ?
        ORDER BY session_id ASC, ordering ASC`,
      rsId,
    );
    // 2 rows per session × 2 sessions = 4 rows total
    expect(rowsByRs).toHaveLength(4);
    expect(rowsByRs.map((r) => r.session_id)).toEqual([
      'sess-act-1',
      'sess-act-1',
      'sess-fin-1',
      'sess-fin-1',
    ]);
  });

  it('SAME RS template across TWO DIFFERENT active sessions: both succeed — dup guard is per-session only', async () => {
    // Production UI policy is "one active session at a time", but the DB
    // layer does not enforce that. This test pins the DB-layer contract so
    // a future caller bug (or test fixture) that races two open sessions
    // doesn't get a silent dup-throw from the wrong guard.
    await createSession(db, { id: 'sess-act-A', started_at: now });
    await createSession(db, { id: 'sess-act-B', started_at: now + 1000 });
    expect((await getActiveSession(db))?.id).toBe('sess-act-B'); // most-recent wins

    await appendReusableSupersetToSession(db, {
      session_id: 'sess-act-A',
      reusable_superset_id: rsId,
      uuid,
    });
    await expect(
      appendReusableSupersetToSession(db, {
        session_id: 'sess-act-B',
        reusable_superset_id: rsId,
        uuid,
      }),
    ).resolves.toBeDefined();
  });

  it('ordering: append into a session that already has solo cards starts at MAX(ordering)+1', async () => {
    // Pre-seed two existing session_exercise rows with orderings 5 and 10
    // (gaps fine — ordering is monotonic, not contiguous).
    await createSession(db, { id: 'sess-ord', started_at: now });
    await db.runAsync(
      `INSERT INTO session_exercise
         (id, session_id, exercise_id, ordering, planned_sets,
          planned_reps, planned_weight_kg, template_id, is_evergreen, parent_id,
          reusable_superset_id, rest_sec)
       VALUES ('pre-1', 'sess-ord', ?, 5, 3, NULL, NULL, NULL, 0, NULL, NULL, NULL)`,
      '00000000-0000-4000-8000-000000000010',
    );
    await db.runAsync(
      `INSERT INTO session_exercise
         (id, session_id, exercise_id, ordering, planned_sets,
          planned_reps, planned_weight_kg, template_id, is_evergreen, parent_id,
          reusable_superset_id, rest_sec)
       VALUES ('pre-2', 'sess-ord', ?, 10, 3, NULL, NULL, NULL, 0, NULL, NULL, NULL)`,
      '00000000-0000-4000-8000-000000000011',
    );
    const { a_id, b_id } = await appendReusableSupersetToSession(db, {
      session_id: 'sess-ord',
      reusable_superset_id: rsId,
      uuid,
    });

    const newRows = await db.getAllAsync<{ id: string; ordering: number }>(
      `SELECT id, ordering FROM session_exercise
        WHERE id IN (?, ?) ORDER BY ordering ASC`,
      a_id,
      b_id,
    );
    expect(newRows).toEqual([
      { id: a_id, ordering: 11 },
      { id: b_id, ordering: 12 },
    ]);
  });
});
