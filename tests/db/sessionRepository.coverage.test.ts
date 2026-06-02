import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  appendReusableSupersetToSession,
  createSession,
  reorderSessionExercises,
  updateSessionExerciseRestSec,
} from '../../src/adapters/sqlite/sessionRepository';

/**
 * Coverage fill (overnight 2026-06-03 r2) — reachable branches/functions the
 * prior waves left untouched in sessionRepository.ts:
 *
 *   - reorderSessionExercises: had NO test at all. Assigns ordering 1..N in
 *     the supplied id sequence; scoped to session_id.
 *   - updateSessionExerciseRestSec: had NO test. Sets / clears rest_sec.
 *   - appendReusableSupersetToSession: RS-not-found throw + RS-has-wrong-
 *     exercise-count throw (existing interlock test only exercises the
 *     happy / dup paths, never these two guards).
 */

const BENCH = '00000000-0000-4000-8000-000000000001';
const SQUAT = '00000000-0000-4000-8000-000000000002';
const DEADLIFT = '00000000-0000-4000-8000-000000000003';

describe('sessionRepository coverage fill', () => {
  let db: BetterSqliteDatabase;
  const now = 1_700_000_000_000;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    await createSession(db, { id: 'sess', started_at: now });
  });

  afterEach(() => {
    db.close();
  });

  async function mkSE(id: string, exercise_id: string, ordering: number) {
    await db.runAsync(
      `INSERT INTO session_exercise
         (id, session_id, exercise_id, ordering, planned_sets, is_evergreen)
       VALUES (?, 'sess', ?, ?, 3, 0)`,
      id,
      exercise_id,
      ordering,
    );
  }

  async function orderingOf(id: string): Promise<number> {
    const row = await db.getFirstAsync<{ ordering: number }>(
      `SELECT ordering FROM session_exercise WHERE id = ?`,
      id,
    );
    return row!.ordering;
  }

  // ── reorderSessionExercises ──────────────────────────────────────────────

  it('reorderSessionExercises: assigns ordering 1..N in the supplied sequence', async () => {
    await mkSE('se-a', BENCH, 1);
    await mkSE('se-b', SQUAT, 2);
    await mkSE('se-c', DEADLIFT, 3);

    // Reverse the order.
    await reorderSessionExercises(db, {
      session_id: 'sess',
      orderedIds: ['se-c', 'se-b', 'se-a'],
    });

    expect(await orderingOf('se-c')).toBe(1);
    expect(await orderingOf('se-b')).toBe(2);
    expect(await orderingOf('se-a')).toBe(3);
  });

  it('reorderSessionExercises: is scoped to session_id — rows in another session are untouched', async () => {
    await createSession(db, { id: 'other', started_at: now });
    await mkSE('se-a', BENCH, 5);
    await db.runAsync(
      `INSERT INTO session_exercise
         (id, session_id, exercise_id, ordering, planned_sets, is_evergreen)
       VALUES ('other-se', 'other', ?, 9, 3, 0)`,
      SQUAT,
    );

    // The id belongs to a different session — UPDATE WHERE session_id='sess'
    // must NOT touch it even though it's listed.
    await reorderSessionExercises(db, {
      session_id: 'sess',
      orderedIds: ['other-se', 'se-a'],
    });

    expect(await orderingOf('se-a')).toBe(2);
    // other-se untouched (scoped out by session_id mismatch).
    expect(await orderingOf('other-se')).toBe(9);
  });

  it('reorderSessionExercises: empty list is a no-op', async () => {
    await mkSE('se-a', BENCH, 1);
    await reorderSessionExercises(db, { session_id: 'sess', orderedIds: [] });
    expect(await orderingOf('se-a')).toBe(1);
  });

  // ── updateSessionExerciseRestSec ─────────────────────────────────────────

  it('updateSessionExerciseRestSec: sets a numeric rest_sec', async () => {
    await mkSE('se-a', BENCH, 1);
    await updateSessionExerciseRestSec(db, 'se-a', 90);
    const row = await db.getFirstAsync<{ rest_sec: number | null }>(
      `SELECT rest_sec FROM session_exercise WHERE id = 'se-a'`,
    );
    expect(row!.rest_sec).toBe(90);
  });

  it('updateSessionExerciseRestSec: null clears the rest_sec', async () => {
    await mkSE('se-a', BENCH, 1);
    await updateSessionExerciseRestSec(db, 'se-a', 120);
    await updateSessionExerciseRestSec(db, 'se-a', null);
    const row = await db.getFirstAsync<{ rest_sec: number | null }>(
      `SELECT rest_sec FROM session_exercise WHERE id = 'se-a'`,
    );
    expect(row!.rest_sec).toBeNull();
  });

  // ── appendReusableSupersetToSession guards ───────────────────────────────

  it('appendReusableSupersetToSession: throws when the RS does not exist', async () => {
    await expect(
      appendReusableSupersetToSession(db, {
        session_id: 'sess',
        reusable_superset_id: 'no-such-rs',
        uuid: () => 'uid-1',
      }),
    ).rejects.toThrow(/not found/);
  });

  it('appendReusableSupersetToSession: throws when the RS has != 2 exercises', async () => {
    // Seed a malformed RS with a single exercise (UI prevents this; the guard
    // is the last line of defence).
    await db.runAsync(
      `INSERT INTO superset (id, name, color_hex, use_count, created_at, updated_at)
       VALUES ('rs-bad', 'Solo', NULL, 0, ?, ?)`,
      now,
      now,
    );
    await db.runAsync(
      `INSERT INTO superset_exercise (superset_id, position, exercise_id)
       VALUES ('rs-bad', 0, ?)`,
      BENCH,
    );

    await expect(
      appendReusableSupersetToSession(db, {
        session_id: 'sess',
        reusable_superset_id: 'rs-bad',
        uuid: () => 'uid-1',
      }),
    ).rejects.toThrow(/expected 2/);
  });
});
