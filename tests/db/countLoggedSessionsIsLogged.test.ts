import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { createSession, endSession } from '../../src/adapters/sqlite/sessionRepository';
import { recordSetInSession } from '../../src/adapters/sqlite/setRepository';
import { listExercises } from '../../src/adapters/sqlite/exerciseRepository';
import { loadAchievementPanelData } from '../../src/adapters/sqlite/achievementRepository';

/**
 * Regression for the is-logged-surfaces / F3 class on the session-count ladder.
 *
 * `countLoggedSessions` (feeds `totalSessionCount`) must count only sessions
 * with at least one *performed* (✓-tapped, `is_logged = 1`) set. A session
 * opened from a plan/template and ended WITHOUT ticking any set still has set
 * rows with real weight_kg/reps and `is_logged = 0` (endSession never purges
 * planned sets), so it must NOT inflate the milestone count.
 *
 * This sibling helper was missed in the 2026-06-25 pass that fixed
 * `loadReplayRecords` with `AND s.is_logged = 1`. Without that filter on
 * `countLoggedSessions`, this test fails (totalSessionCount === 2).
 */
describe('countLoggedSessions — planned-only ended session must not count', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it('excludes a never-✓-tapped (is_logged=0) ended session from totalSessionCount', async () => {
    const benchPress = (await listExercises(db)).find((e) => e.name === 'Bench Press')!;
    const t0 = 1_700_000_000_000;
    let n = 0;
    const uuid = () => `set-${n++}`;

    // Session A: a real, performed session — the user ✓-tapped the set.
    await createSession(db, { id: 'A', started_at: t0 });
    const a = await recordSetInSession(db, {
      session_id: 'A',
      input: { exercise_id: benchPress.id, weight_kg: 60, reps: 8 },
      uuid,
      now: () => t0 + 1_000,
    });
    // recordSetInSession writes is_logged=0; simulate the user's ✓-tap.
    await db.runAsync(`UPDATE "set" SET is_logged = 1 WHERE id = ?`, a.set_id);
    await endSession(db, { id: 'A', ended_at: t0 + 60_000 });

    // Session B: opened from a "plan" (real weight/reps), ended without ever
    // ✓-tapping — is_logged stays 0. This is the planned-but-abandoned session.
    await createSession(db, { id: 'B', started_at: t0 + 100_000 });
    await recordSetInSession(db, {
      session_id: 'B',
      input: { exercise_id: benchPress.id, weight_kg: 100, reps: 5 },
      uuid,
      now: () => t0 + 101_000,
    });
    await endSession(db, { id: 'B', ended_at: t0 + 160_000 });

    // Guard the fixture's premise: the planned set really is is_logged=0 with
    // real weight/reps (so it would pass the is_skipped/weight/reps guard and
    // only `is_logged = 1` saves us).
    const plannedSet = await db.getFirstAsync<{ is_logged: number; weight_kg: number; reps: number }>(
      `SELECT is_logged, weight_kg, reps FROM "set" WHERE session_id = 'B'`
    );
    expect(plannedSet).toMatchObject({ is_logged: 0, weight_kg: 100, reps: 5 });

    const panel = await loadAchievementPanelData(db);
    // Only the ✓-tapped session A counts; the planned-only session B does not.
    expect(panel.totalSessionCount).toBe(1);
  });
});
