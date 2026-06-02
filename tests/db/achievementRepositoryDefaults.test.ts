import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  createSession,
  endSession,
} from '../../src/adapters/sqlite/sessionRepository';
import { insertSessionSet } from '../../src/adapters/sqlite/setRepository';
import { listExercises } from '../../src/adapters/sqlite/exerciseRepository';
import {
  evaluateAndPersistAchievements,
  backfillAchievementsIfNeeded,
  listUnlocks,
} from '../../src/adapters/sqlite/achievementRepository';
import { getSetting } from '../../src/adapters/sqlite/settingsRepository';

/**
 * Default-argument + fallback-branch coverage for achievementRepository that
 * the integration tests skip because they always pass every optional arg.
 *
 * Reachable branches exercised here:
 *   - evaluateAndPersistAchievements: `unlocked_at ?? Date.now()` (line 190) —
 *     called without `unlocked_at`.
 *   - evaluateAndPersistAchievements: `flags?.bucket ?? classifyBucket(r.reps)`
 *     (line 205) — a logged-but-unqualified working set (null reps) makes the
 *     replay flag's bucket null so the fallback runs.
 *   - backfillAchievementsIfNeeded: `opts = {}` default-arg (line 261) and
 *     `opts.now ?? (() => Date.now())` (line 283) — called with no args.
 *
 * (The `?? false` flag fallbacks at lines 211-212 and the `row?.n ?? 0` at
 * line 307 are unreachable defensive defaults: every replay record gets a flag
 * object, and a COUNT() query always returns exactly one row.)
 */

async function insertWorkingSet(
  db: BetterSqliteDatabase,
  args: {
    id: string;
    session_id: string;
    exercise_id: string;
    weight_kg: number | null;
    reps: number | null;
    ordering: number;
    created_at: number;
  }
): Promise<void> {
  await insertSessionSet(db, {
    id: args.id,
    session_id: args.session_id,
    exercise_id: args.exercise_id,
    weight_kg: args.weight_kg,
    reps: args.reps,
    is_skipped: 0,
    ordering: args.ordering,
    created_at: args.created_at,
    set_kind: 'working',
    parent_set_id: null,
  });
  await db.runAsync(`UPDATE "set" SET is_logged = 1 WHERE id = ?`, args.id);
}

describe('achievementRepository — optional-arg / fallback branches', () => {
  let db: BetterSqliteDatabase;
  let benchId: string;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    const all = await listExercises(db);
    benchId = all.find((e) => e.name === 'Bench Press')!.id;
  });

  afterEach(() => {
    db.close();
  });

  it('evaluateAndPersistAchievements defaults unlocked_at to the real clock (line 190)', async () => {
    const before = Date.now();
    await createSession(db, { id: 'sess-1', started_at: 1_000 });
    await insertWorkingSet(db, {
      id: 's1',
      session_id: 'sess-1',
      exercise_id: benchId,
      weight_kg: 60,
      reps: 8,
      ordering: 1,
      created_at: 1_001,
    });
    await endSession(db, { id: 'sess-1', ended_at: 60_000 });

    // No `unlocked_at` → Date.now() fallback.
    const outcome = await evaluateAndPersistAchievements(db, {
      ended_session_id: 'sess-1',
    });
    expect(outcome.newUnlocks.length).toBeGreaterThan(0);

    const after = Date.now();
    const unlocks = await listUnlocks(db);
    // Every persisted unlock got a wall-clock timestamp, not a passed-in value.
    for (const u of unlocks) {
      expect(u.unlocked_at).toBeGreaterThanOrEqual(before);
      expect(u.unlocked_at).toBeLessThanOrEqual(after);
    }
  });

  it('handles a logged working set with null reps — flag.bucket null → classifyBucket fallback (line 205)', async () => {
    await createSession(db, { id: 'sess-2', started_at: 2_000 });
    // A logged working set with null reps is unqualified for PR; its replay
    // flag exists but flag.bucket is null, exercising the `?? classifyBucket`
    // fallback in the SessionEval build. Must not throw and must not award a PR.
    await insertWorkingSet(db, {
      id: 's-null-reps',
      session_id: 'sess-2',
      exercise_id: benchId,
      weight_kg: 60,
      reps: null,
      ordering: 1,
      created_at: 2_001,
    });
    // A second, valid set so the session still has a logged-PR set.
    await insertWorkingSet(db, {
      id: 's-valid',
      session_id: 'sess-2',
      exercise_id: benchId,
      weight_kg: 60,
      reps: 8,
      ordering: 2,
      created_at: 2_002,
    });
    await endSession(db, { id: 'sess-2', ended_at: 120_000 });

    const outcome = await evaluateAndPersistAchievements(db, {
      ended_session_id: 'sess-2',
      unlocked_at: 120_000,
    });
    // The valid set still drives the first PR / first_combo unlocks.
    expect(outcome.newUnlocks.length).toBeGreaterThan(0);
    // The null-reps set must not have produced its own bucket-anchored unlock.
    const unlocks = await listUnlocks(db);
    expect(unlocks.some((u) => u.set_id === 's-null-reps')).toBe(false);
  });

  it('backfillAchievementsIfNeeded works with no opts arg (lines 261/283 default → Date.now())', async () => {
    const before = Date.now();
    await createSession(db, { id: 'sess-3', started_at: 3_000 });
    await insertWorkingSet(db, {
      id: 's1',
      session_id: 'sess-3',
      exercise_id: benchId,
      weight_kg: 60,
      reps: 8,
      ordering: 1,
      created_at: 3_001,
    });
    await endSession(db, { id: 'sess-3', ended_at: 180_000 });

    // Called with NO second argument → `opts = {}` default-arg + `opts.now`
    // falls back to () => Date.now().
    const out = await backfillAchievementsIfNeeded(db);
    expect(out.ranBackfill).toBe(true);
    expect(out.sessionsReplayed).toBe(1);
    expect(out.newUnlocks).toBeGreaterThan(0);

    const after = Date.now();
    const sentinel = await getSetting<number>(db, 'achievements_backfilled_at');
    expect(sentinel).not.toBeNull();
    expect(sentinel!).toBeGreaterThanOrEqual(before);
    expect(sentinel!).toBeLessThanOrEqual(after);
  });
});
