import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  appendReusableSupersetToSession,
  appendSessionExercise,
  listSessionUsedExercises,
} from '../../src/adapters/sqlite/sessionRepository';
import { insertReusableSuperset } from '../../src/adapters/sqlite/supersetRepository';

/**
 * Slice 10c smoke-fix #20 — picker dim/disable for "already in this session".
 *
 * `listSessionUsedExercises` powers the in-picker dim layer so the user can't
 * accidentally add a second solo Bench Press card (or a second copy of the
 * same RS template) into one in-progress session. Solo vs RS are independent
 * buckets: solo Bench in session does NOT dim the RS(Bench+X) picker entry,
 * and an RS that contains Bench on the A-side does NOT dim the solo Bench
 * entry. Only `reusable_superset_id IS NULL` counts toward solo conflict.
 */

const BENCH = '00000000-0000-4000-8000-000000000001';
const SQUAT = '00000000-0000-4000-8000-000000000002';
const ROW = '00000000-0000-4000-8000-000000000005';

describe('listSessionUsedExercises — solo vs RS partition', () => {
  let db: BetterSqliteDatabase;
  const sessionId = 'sess-used';
  const now = 1700000000000;
  let counter = 0;
  const uuid = () => `uid-${++counter}`;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    counter = 0;
    await db.runAsync(
      `INSERT INTO session (id, started_at) VALUES (?, ?)`,
      sessionId,
      now,
    );
  });

  afterEach(() => {
    db.close();
  });

  it('empty session → both sets empty', async () => {
    const used = await listSessionUsedExercises(db, sessionId);
    expect(used.solo_exercise_ids.size).toBe(0);
    expect(used.rs_template_ids.size).toBe(0);
  });

  it('session with 2 solo exercises only → solo set has both ids, rs empty', async () => {
    await appendSessionExercise(db, {
      id: uuid(),
      session_id: sessionId,
      exercise_id: BENCH,
    });
    await appendSessionExercise(db, {
      id: uuid(),
      session_id: sessionId,
      exercise_id: SQUAT,
    });
    const used = await listSessionUsedExercises(db, sessionId);
    expect(used.solo_exercise_ids.has(BENCH)).toBe(true);
    expect(used.solo_exercise_ids.has(SQUAT)).toBe(true);
    expect(used.solo_exercise_ids.size).toBe(2);
    expect(used.rs_template_ids.size).toBe(0);
  });

  it('session with 1 RS (A+B = 2 session_exercise rows) → solo empty, rs has 1 id', async () => {
    const rsId = await insertReusableSuperset(
      db,
      { name: 'Bench + Squat', color_hex: null, exercise_ids: [BENCH, SQUAT] },
      uuid,
      () => now,
    );
    await appendReusableSupersetToSession(db, {
      session_id: sessionId,
      reusable_superset_id: rsId,
      uuid,
    });
    const used = await listSessionUsedExercises(db, sessionId);
    // Both A and B sides carry reusable_superset_id, so neither leaks into
    // the solo set — the RS template collapses to a single id.
    expect(used.solo_exercise_ids.size).toBe(0);
    expect(used.rs_template_ids.has(rsId)).toBe(true);
    expect(used.rs_template_ids.size).toBe(1);
  });

  it('mixed solo + RS sharing an exercise_id — solo bucket holds the solo id, rs bucket holds the RS id (no cross-cancel)', async () => {
    // User scenario: RS(Bench+Squat) already inserted, then user separately
    // adds a solo Bench card. Both should appear in their own bucket; the
    // picker UI dims solo Bench (because solo bucket has it) and dims the
    // RS template (because rs bucket has it), but does NOT dim a different
    // RS template that happens to contain Bench.
    const rsId = await insertReusableSuperset(
      db,
      { name: 'Bench + Squat', color_hex: null, exercise_ids: [BENCH, SQUAT] },
      uuid,
      () => now,
    );
    await appendReusableSupersetToSession(db, {
      session_id: sessionId,
      reusable_superset_id: rsId,
      uuid,
    });
    await appendSessionExercise(db, {
      id: uuid(),
      session_id: sessionId,
      exercise_id: BENCH,
    });
    await appendSessionExercise(db, {
      id: uuid(),
      session_id: sessionId,
      exercise_id: ROW,
    });
    const used = await listSessionUsedExercises(db, sessionId);
    // Solo bucket: BENCH (the standalone solo card) + ROW. RS A-side Bench
    // does NOT contribute because its row has reusable_superset_id NOT NULL.
    expect(Array.from(used.solo_exercise_ids).sort()).toEqual(
      [BENCH, ROW].sort(),
    );
    // RS bucket: just the one RS template.
    expect(Array.from(used.rs_template_ids)).toEqual([rsId]);
  });
});
