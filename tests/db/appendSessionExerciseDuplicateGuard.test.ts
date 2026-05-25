import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  appendReusableSupersetToSession,
  appendSessionExercise,
} from '../../src/adapters/sqlite/sessionRepository';
import { insertReusableSuperset } from '../../src/adapters/sqlite/supersetRepository';

/**
 * Defensive duplicate guards on appendSessionExercise +
 * appendReusableSupersetToSession (slice 10c #20). These are belt-and-
 * suspenders backup for the picker dim/disable UI layer. The picker should
 * never let a user fire these calls with a duplicate to begin with — but if
 * a race / future caller / test bug slips through we want hard failure
 * instead of silent dup-card pollution.
 *
 * Solo and RS are independent buckets (same rule that listSessionUsedExercises
 * encodes): solo Bench + RS(Bench+X) coexist fine; only solo×solo and
 * RS_template×RS_template clash.
 */

const BENCH = '00000000-0000-4000-8000-000000000001';
const SQUAT = '00000000-0000-4000-8000-000000000002';

describe('append* duplicate guards', () => {
  let db: BetterSqliteDatabase;
  const sessionId = 'sess-guard';
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

  it('appendSessionExercise throws on duplicate solo exercise_id in same session', async () => {
    await appendSessionExercise(db, {
      id: uuid(),
      session_id: sessionId,
      exercise_id: BENCH,
    });
    await expect(
      appendSessionExercise(db, {
        id: uuid(),
        session_id: sessionId,
        exercise_id: BENCH,
      }),
    ).rejects.toThrow(/duplicate solo exercise/i);
  });

  it('appendReusableSupersetToSession throws on duplicate RS template in same session', async () => {
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
    await expect(
      appendReusableSupersetToSession(db, {
        session_id: sessionId,
        reusable_superset_id: rsId,
        uuid,
      }),
    ).rejects.toThrow(/duplicate RS/i);
  });

  it('solo Bench + RS(Bench+Squat) may coexist — guards do NOT cross-block', async () => {
    // Solo first → then RS containing the same exercise on A side.
    await appendSessionExercise(db, {
      id: uuid(),
      session_id: sessionId,
      exercise_id: BENCH,
    });
    const rsId = await insertReusableSuperset(
      db,
      { name: 'Bench + Squat', color_hex: null, exercise_ids: [BENCH, SQUAT] },
      uuid,
      () => now,
    );
    // Must NOT throw — RS bucket is independent of solo bucket.
    await expect(
      appendReusableSupersetToSession(db, {
        session_id: sessionId,
        reusable_superset_id: rsId,
        uuid,
      }),
    ).resolves.toBeDefined();
  });

  it('RS(Bench+Squat) + solo Bench may coexist — RS A-side Bench does NOT trip the solo guard', async () => {
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
    // Solo Bench afterwards — solo guard only counts reusable_superset_id IS NULL.
    await expect(
      appendSessionExercise(db, {
        id: uuid(),
        session_id: sessionId,
        exercise_id: BENCH,
      }),
    ).resolves.toBeUndefined();
  });
});
