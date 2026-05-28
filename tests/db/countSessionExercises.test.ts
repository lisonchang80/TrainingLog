/**
 * Slice 13d D9 — countSessionExercises adapter (NEW-Q49 support).
 *
 * Smoke tests for the COUNT(*) helper used by the freestyle first-add push
 * gate. Verifies count transitions across createSession + appendSessionExercise
 * + appendReusableSupersetToSession + startSessionFromTemplate to catch
 * regressions if the schema or insert paths change.
 */

import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  appendReusableSupersetToSession,
  appendSessionExercise,
  countSessionExercises,
  createSession,
} from '../../src/adapters/sqlite/sessionRepository';
import { insertReusableSuperset } from '../../src/adapters/sqlite/supersetRepository';

const BENCH = '00000000-0000-4000-8000-000000000001';
const SQUAT = '00000000-0000-4000-8000-000000000002';

describe('countSessionExercises', () => {
  let db: BetterSqliteDatabase;
  const sessionId = 'sess-count-q49';
  const otherSessionId = 'sess-count-q49-other';
  const now = 1700000000000;
  let counter = 0;
  const uuid = () => `uid-${++counter}`;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    counter = 0;
    // BENCH + SQUAT UUIDs above match the v001 / v006 migration seeds,
    // so we don't insert them here — same convention as
    // listSessionUsedExercises.test.ts.
    await createSession(db, { id: sessionId, started_at: now });
    await createSession(db, { id: otherSessionId, started_at: now + 1000 });
  });

  afterEach(() => {
    db.close();
  });

  it('returns 0 for a freshly-created session with no exercises', async () => {
    // The canonical NEW-Q49 pre-condition: iPhone freestyle session 創建,
    // session_exercise table 沒有 row, gate 預期 fire.
    expect(await countSessionExercises(db, sessionId)).toBe(0);
  });

  it('increments by 1 after appendSessionExercise (solo)', async () => {
    await appendSessionExercise(db, {
      id: 'se-1',
      session_id: sessionId,
      exercise_id: BENCH,
    });
    expect(await countSessionExercises(db, sessionId)).toBe(1);

    await appendSessionExercise(db, {
      id: 'se-2',
      session_id: sessionId,
      exercise_id: SQUAT,
    });
    expect(await countSessionExercises(db, sessionId)).toBe(2);
  });

  it('increments by 2 after appendReusableSupersetToSession (RS = A+B pair)', async () => {
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
    // RS explodes into 2 session_exercise rows linked via parent_id.
    expect(await countSessionExercises(db, sessionId)).toBe(2);
  });

  it('scopes count to the given session_id (other sessions do not leak)', async () => {
    await appendSessionExercise(db, {
      id: 'se-A',
      session_id: sessionId,
      exercise_id: BENCH,
    });
    await appendSessionExercise(db, {
      id: 'se-B',
      session_id: otherSessionId,
      exercise_id: SQUAT,
    });
    expect(await countSessionExercises(db, sessionId)).toBe(1);
    expect(await countSessionExercises(db, otherSessionId)).toBe(1);
  });

  it('returns 0 for a non-existent session_id (no throw)', async () => {
    expect(await countSessionExercises(db, 'does-not-exist')).toBe(0);
  });
});
