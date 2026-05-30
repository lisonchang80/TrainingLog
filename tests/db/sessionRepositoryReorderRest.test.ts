/**
 * sessionRepository edge coverage — reorderSessionExercises,
 * updateSessionExerciseRestSec, and the appendReusableSupersetToSession
 * defensive THROW branches (src/adapters/sqlite/sessionRepository.ts).
 *
 * The happy path for RS append lives in
 * appendReusableSupersetActiveSessionInterlock.test.ts; these pin the
 * untested branches:
 *
 *   - reorderSessionExercises rewrites ordering = 1..N in the supplied
 *     sequence (within a transaction; scoped to the given session_id only).
 *   - updateSessionExerciseRestSec sets a per-exercise rest value and can
 *     clear it back to NULL (inherit default).
 *   - appendReusableSupersetToSession throws when the RS id is unknown.
 *   - appendReusableSupersetToSession throws when the RS does not have
 *     exactly 2 exercises (malformed RS guard).
 *
 * NON-WC pure session-management surface. Additive, non-overlapping with
 * the existing append/interlock test.
 *
 * Overnight 2026-05-31 — agent 06 (non-WC coverage r2).
 */

import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  createSession,
  insertSessionExercise,
  reorderSessionExercises,
  updateSessionExerciseRestSec,
  appendReusableSupersetToSession,
} from '../../src/adapters/sqlite/sessionRepository';

const BENCH = '00000000-0000-4000-8000-000000000001';
const SQUAT = '00000000-0000-4000-8000-000000000002';
const DEADLIFT = '00000000-0000-4000-8000-000000000003';

describe('sessionRepository — reorder / rest_sec / RS-append guards', () => {
  let db: BetterSqliteDatabase;
  let counter = 0;
  const uuid = () => `uid-${++counter}`;
  const now = 1_700_000_000_000;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    counter = 0;
  });

  afterEach(() => {
    db.close();
  });

  async function seedSE(id: string, session_id: string, exercise_id: string, ordering: number) {
    await insertSessionExercise(db, {
      id,
      session_id,
      exercise_id,
      ordering,
      planned_sets: 3,
      planned_reps: null,
      planned_weight_kg: null,
      template_id: null,
      is_evergreen: 0,
      parent_id: null,
      reusable_superset_id: null,
    });
  }

  async function orderingsOf(session_id: string): Promise<Array<{ id: string; ordering: number }>> {
    return db.getAllAsync<{ id: string; ordering: number }>(
      `SELECT id, ordering FROM session_exercise WHERE session_id = ? ORDER BY ordering ASC`,
      session_id
    );
  }

  // --- reorderSessionExercises -----------------------------------------

  it('assigns ordering = 1..N following the supplied id sequence', async () => {
    await createSession(db, { id: 'sess-1', started_at: now });
    await seedSE('se-a', 'sess-1', BENCH, 1);
    await seedSE('se-b', 'sess-1', SQUAT, 2);
    await seedSE('se-c', 'sess-1', DEADLIFT, 3);

    // Reverse the order.
    await reorderSessionExercises(db, {
      session_id: 'sess-1',
      orderedIds: ['se-c', 'se-b', 'se-a'],
    });

    const rows = await orderingsOf('sess-1');
    expect(rows).toEqual([
      { id: 'se-c', ordering: 1 },
      { id: 'se-b', ordering: 2 },
      { id: 'se-a', ordering: 3 },
    ]);
  });

  it('only touches rows in the target session, not another session', async () => {
    await createSession(db, { id: 'sess-1', started_at: now });
    await createSession(db, { id: 'sess-2', started_at: now + 1 });
    await seedSE('se-a', 'sess-1', BENCH, 5);
    await seedSE('se-b', 'sess-1', SQUAT, 6);
    await seedSE('se-x', 'sess-2', DEADLIFT, 9);

    await reorderSessionExercises(db, {
      session_id: 'sess-1',
      orderedIds: ['se-b', 'se-a'],
    });

    expect(await orderingsOf('sess-1')).toEqual([
      { id: 'se-b', ordering: 1 },
      { id: 'se-a', ordering: 2 },
    ]);
    // sess-2 row untouched
    expect(await orderingsOf('sess-2')).toEqual([{ id: 'se-x', ordering: 9 }]);
  });

  it('empty orderedIds is a no-op (transaction wraps zero updates)', async () => {
    await createSession(db, { id: 'sess-1', started_at: now });
    await seedSE('se-a', 'sess-1', BENCH, 7);

    await reorderSessionExercises(db, { session_id: 'sess-1', orderedIds: [] });

    expect(await orderingsOf('sess-1')).toEqual([{ id: 'se-a', ordering: 7 }]);
  });

  // --- updateSessionExerciseRestSec ------------------------------------

  it('sets a per-exercise rest_sec value', async () => {
    await createSession(db, { id: 'sess-1', started_at: now });
    await seedSE('se-a', 'sess-1', BENCH, 1);

    await updateSessionExerciseRestSec(db, 'se-a', 90);

    const row = await db.getFirstAsync<{ rest_sec: number | null }>(
      `SELECT rest_sec FROM session_exercise WHERE id = ?`,
      'se-a'
    );
    expect(row?.rest_sec).toBe(90);
  });

  it('clears rest_sec back to NULL (inherit system default)', async () => {
    await createSession(db, { id: 'sess-1', started_at: now });
    await seedSE('se-a', 'sess-1', BENCH, 1);

    await updateSessionExerciseRestSec(db, 'se-a', 120);
    await updateSessionExerciseRestSec(db, 'se-a', null);

    const row = await db.getFirstAsync<{ rest_sec: number | null }>(
      `SELECT rest_sec FROM session_exercise WHERE id = ?`,
      'se-a'
    );
    expect(row?.rest_sec).toBeNull();
  });

  // --- appendReusableSupersetToSession defensive throws ----------------

  it('throws when the RS id does not exist', async () => {
    await createSession(db, { id: 'sess-1', started_at: now });

    await expect(
      appendReusableSupersetToSession(db, {
        session_id: 'sess-1',
        reusable_superset_id: 'no-such-rs',
        uuid,
      })
    ).rejects.toThrow(/not found/);
  });

  it('throws when the RS does not have exactly 2 exercises', async () => {
    await createSession(db, { id: 'sess-1', started_at: now });
    // Hand-build a malformed RS with a single exercise link (prod insert
    // enforces 2, but a partially-migrated / hand-edited row could have 1).
    await db.runAsync(
      `INSERT INTO superset (id, name, color_hex, use_count, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, ?)`,
      'rs-malformed',
      'Lonely',
      null,
      now,
      now
    );
    await db.runAsync(
      `INSERT INTO superset_exercise (superset_id, position, exercise_id)
       VALUES (?, ?, ?)`,
      'rs-malformed',
      0,
      BENCH
    );

    await expect(
      appendReusableSupersetToSession(db, {
        session_id: 'sess-1',
        reusable_superset_id: 'rs-malformed',
        uuid,
      })
    ).rejects.toThrow(/expected 2/);
  });
});
