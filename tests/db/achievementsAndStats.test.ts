import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { createSession, endSession } from '../../src/adapters/sqlite/sessionRepository';
import { recordSetInSession } from '../../src/adapters/sqlite/setRepository';

const recSet = (
  db: BetterSqliteDatabase,
  args: {
    session_id: string;
    exercise_id: string;
    weight_kg: number;
    reps: number;
    ordering: number;
    now: () => number;
    uuid: () => string;
  }
) =>
  recordSetInSession(db, {
    session_id: args.session_id,
    input: {
      exercise_id: args.exercise_id,
      weight_kg: args.weight_kg,
      reps: args.reps,
    },
    uuid: args.uuid,
    now: args.now,
  });
import { listExercises } from '../../src/adapters/sqlite/exerciseRepository';
import {
  evaluateAndPersistAchievements,
  listAchievementDefinitions,
  listUnlockedDefinitionIds,
  listUnlocks,
  loadAchievementPanelData,
} from '../../src/adapters/sqlite/achievementRepository';
import { loadStatsSetRecords } from '../../src/adapters/sqlite/statsRepository';
import { mgFrequencyOverPeriod } from '../../src/domain/stats/statsEngine';

describe('Slice 9 — Achievement + Stats integration via SQLite', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it('seeds 255 achievement definitions on migration', async () => {
    const defs = await listAchievementDefinitions(db);
    expect(defs).toHaveLength(255);
    // Sanity-check distribution
    const counts = defs.reduce(
      (acc, d) => {
        acc[d.category] = (acc[d.category] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );
    expect(counts.first_combo).toBe(55);
    expect(counts.pr_per_mg).toBe(132);
    expect(counts.pr_per_bucket).toBe(60);
    expect(counts.session_count).toBe(8);
  });

  it('end of first session unlocks first_combo + first PR + session_count(1)', async () => {
    const exercises = await listExercises(db);
    const benchPress = exercises.find((e) => e.name === 'Bench Press')!;
    expect(benchPress.muscle_group_id).toBe('mg-chest');

    const session_id = 'session-test-1';
    const t0 = 1_700_000_000_000;
    let nextId = 0;
    const uuid = () => `set-${nextId++}`;

    await createSession(db, { id: session_id, started_at: t0 });
    // 3 sets in hypertrophy bucket (8 reps), valid weight
    await recSet(db, {
      session_id,
      exercise_id: benchPress.id,
      weight_kg: 50,
      reps: 8,
      ordering: 0,
      now: () => t0 + 1000,
      uuid,
    });
    await recSet(db, {
      session_id,
      exercise_id: benchPress.id,
      weight_kg: 60,
      reps: 8,
      ordering: 1,
      now: () => t0 + 2000,
      uuid,
    });
    await recSet(db, {
      session_id,
      exercise_id: benchPress.id,
      weight_kg: 60,
      reps: 8,
      ordering: 2,
      now: () => t0 + 3000,
      uuid,
    });
    // recordSetInSession writes is_logged=0; simulate the user's ✓-tap so the
    // sets count toward PR/achievements (loadReplayRecords filters is_logged=1).
    await db.runAsync(`UPDATE "set" SET is_logged = 1 WHERE session_id = ?`, session_id);
    await endSession(db, { id: session_id, ended_at: t0 + 60_000 });

    const outcome = await evaluateAndPersistAchievements(db, {
      ended_session_id: session_id,
      unlocked_at: t0 + 60_000,
    });

    const codes = outcome.newDefinitions.map((d) => d.code).sort();
    // Should include:
    //  - first_mg-chest__hypertrophy (first_combo)
    //  - pr_mg_mg-chest__weight__1 (first weight PR for chest mg, tier 1)
    //  - pr_mg_mg-chest__volume__1
    //  - pr_bucket_hypertrophy__weight__1
    //  - pr_bucket_hypertrophy__volume__1
    //  - session_count__1
    expect(codes).toContain('first_mg-chest__hypertrophy');
    expect(codes).toContain('pr_mg_mg-chest__weight__1');
    expect(codes).toContain('pr_mg_mg-chest__volume__1');
    expect(codes).toContain('pr_bucket_hypertrophy__weight__1');
    expect(codes).toContain('pr_bucket_hypertrophy__volume__1');
    expect(codes).toContain('session_count__1');

    // Persisted
    const unlocked = await listUnlockedDefinitionIds(db);
    expect(unlocked.size).toBe(outcome.newUnlocks.length);
    const allUnlocks = await listUnlocks(db);
    expect(allUnlocks).toHaveLength(outcome.newUnlocks.length);
  });

  it('second eval pass with same session is idempotent (UNIQUE constraint blocks dupes)', async () => {
    const exercises = await listExercises(db);
    const benchPress = exercises.find((e) => e.name === 'Bench Press')!;

    const session_id = 'session-test-2';
    const t0 = 1_700_000_000_000;
    let nextId = 0;
    const uuid = () => `set-${nextId++}`;

    await createSession(db, { id: session_id, started_at: t0 });
    await recSet(db, {
      session_id,
      exercise_id: benchPress.id,
      weight_kg: 50,
      reps: 8,
      ordering: 0,
      now: () => t0 + 1000,
      uuid,
    });
    // recordSetInSession writes is_logged=0; simulate the ✓-tap (loadReplayRecords
    // filters is_logged=1).
    await db.runAsync(`UPDATE "set" SET is_logged = 1 WHERE session_id = ?`, session_id);
    await endSession(db, { id: session_id, ended_at: t0 + 60_000 });

    const first = await evaluateAndPersistAchievements(db, {
      ended_session_id: session_id,
      unlocked_at: t0 + 60_000,
    });
    const second = await evaluateAndPersistAchievements(db, {
      ended_session_id: session_id,
      unlocked_at: t0 + 60_000,
    });

    // First pass populated unlocks; second pass returns "newly unlocked = []"
    expect(first.newUnlocks.length).toBeGreaterThan(0);
    expect(second.newUnlocks).toHaveLength(0);

    const allUnlocks = await listUnlocks(db);
    expect(allUnlocks).toHaveLength(first.newUnlocks.length);
  });

  it('Stats Repository → Stats Engine: per-MG frequency + capacity over a date range', async () => {
    const exercises = await listExercises(db);
    const benchPress = exercises.find((e) => e.name === 'Bench Press')!;
    const backSquat = exercises.find((e) => e.name === 'Back Squat')!;

    const t0 = 1_700_000_000_000;
    const dayMs = 24 * 60 * 60 * 1000;

    // Day 1: chest session
    await createSession(db, { id: 'sess-day1', started_at: t0 });
    let nextId = 0;
    const uuid = () => `set-${nextId++}`;
    const day1Set = await recSet(db, {
      session_id: 'sess-day1',
      exercise_id: benchPress.id,
      weight_kg: 50,
      reps: 8,
      ordering: 0,
      now: () => t0 + 1000,
      uuid,
    });
    // recordSetInSession writes is_logged=0; mark it logged (user ✓-tap) so it
    // counts toward stats volume/frequency (F3: stats filters is_logged=1).
    await db.runAsync(`UPDATE "set" SET is_logged = 1 WHERE id = ?`, day1Set.set_id);
    await endSession(db, { id: 'sess-day1', ended_at: t0 + 60 * 60 * 1000 });

    // Day 2: leg session
    await createSession(db, { id: 'sess-day2', started_at: t0 + dayMs });
    const day2Set = await recSet(db, {
      session_id: 'sess-day2',
      exercise_id: backSquat.id,
      weight_kg: 100,
      reps: 5,
      ordering: 0,
      now: () => t0 + dayMs + 1000,
      uuid,
    });
    await db.runAsync(`UPDATE "set" SET is_logged = 1 WHERE id = ?`, day2Set.set_id);
    await endSession(db, { id: 'sess-day2', ended_at: t0 + dayMs + 60 * 60 * 1000 });

    // Range covering both days
    const recs = await loadStatsSetRecords(db, {
      start_ms: t0,
      end_ms: t0 + 2 * dayMs,
    });
    expect(recs).toHaveLength(2);
    const freq = mgFrequencyOverPeriod(recs);
    expect(freq.get('mg-chest')).toBe(1);
    expect(freq.get('mg-leg')).toBe(1);

    // Range covering only day 2
    const recsDay2 = await loadStatsSetRecords(db, {
      start_ms: t0 + dayMs,
      end_ms: t0 + 2 * dayMs,
    });
    expect(mgFrequencyOverPeriod(recsDay2).has('mg-chest')).toBe(false);
  });

  // --- F3-sibling regression (2026-06-25): unchecked sets don't unlock --------
  // Planned-but-unchecked working sets (real weight/reps, is_logged=0, which
  // `endSession` never purges) must NOT count toward PR detection or achievement
  // unlocks. loadReplayRecords now filters `is_logged = 1`, mirroring the
  // History/PR canonical query. recordSetInSession leaves is_logged=0, so an
  // un-marked set models the unchecked case directly.

  it('a session of ONLY unchecked sets unlocks nothing (is_logged=0 excluded)', async () => {
    const benchPress = (await listExercises(db)).find((e) => e.name === 'Bench Press')!;
    const session_id = 'session-unchecked-only';
    const t0 = 1_700_000_000_000;
    let nextId = 0;
    const uuid = () => `set-${nextId++}`;

    await createSession(db, { id: session_id, started_at: t0 });
    // Two working sets with real weight/reps — but the user never tapped ✓, so
    // recordSetInSession leaves is_logged=0. NOT marked logged on purpose.
    await recSet(db, {
      session_id,
      exercise_id: benchPress.id,
      weight_kg: 60,
      reps: 8,
      ordering: 0,
      now: () => t0 + 1000,
      uuid,
    });
    await recSet(db, {
      session_id,
      exercise_id: benchPress.id,
      weight_kg: 80,
      reps: 8,
      ordering: 1,
      now: () => t0 + 2000,
      uuid,
    });
    await endSession(db, { id: session_id, ended_at: t0 + 60_000 });

    const outcome = await evaluateAndPersistAchievements(db, {
      ended_session_id: session_id,
      unlocked_at: t0 + 60_000,
    });

    // No first_combo, no PR, and no session_count(1): the session carries zero
    // logged working sets after the SQL filter.
    expect(outcome.newUnlocks).toHaveLength(0);
    expect(outcome.newDefinitions).toHaveLength(0);
    expect(await listUnlocks(db)).toHaveLength(0);
  });

  it('an unchecked set in a different bucket does NOT unlock that bucket (only the logged one does)', async () => {
    const benchPress = (await listExercises(db)).find((e) => e.name === 'Bench Press')!;
    expect(benchPress.muscle_group_id).toBe('mg-chest');
    const session_id = 'session-mixed-checked';
    const t0 = 1_700_000_000_000;
    let nextId = 0;
    const uuid = () => `set-${nextId++}`;

    await createSession(db, { id: session_id, started_at: t0 });
    // Logged set: 8 reps → hypertrophy bucket. ✓-tapped.
    const loggedSet = await recSet(db, {
      session_id,
      exercise_id: benchPress.id,
      weight_kg: 50,
      reps: 8,
      ordering: 0,
      now: () => t0 + 1000,
      uuid,
    });
    await db.runAsync(`UPDATE "set" SET is_logged = 1 WHERE id = ?`, loggedSet.set_id);
    // Unchecked set: 5 reps → strength bucket, heavier weight. NOT ticked, so it
    // would (pre-fix) have unlocked the strength first_combo + a strength PR.
    await recSet(db, {
      session_id,
      exercise_id: benchPress.id,
      weight_kg: 100,
      reps: 5,
      ordering: 1,
      now: () => t0 + 2000,
      uuid,
    });
    await endSession(db, { id: session_id, ended_at: t0 + 60_000 });

    const outcome = await evaluateAndPersistAchievements(db, {
      ended_session_id: session_id,
      unlocked_at: t0 + 60_000,
    });
    const codes = outcome.newDefinitions.map((d) => d.code);

    // The logged hypertrophy set unlocks its bucket combo + PRs.
    expect(codes).toContain('first_mg-chest__hypertrophy');
    expect(codes).toContain('pr_bucket_hypertrophy__weight__1');
    // The unchecked strength set unlocks NOTHING in the strength bucket.
    expect(codes).not.toContain('first_mg-chest__strength');
    expect(codes).not.toContain('pr_bucket_strength__weight__1');
    expect(codes).not.toContain('pr_bucket_strength__volume__1');
    // And no unlock is anchored to the unchecked set's id.
    const unchecked = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM "set" WHERE session_id = ? AND reps = 5`,
      session_id
    );
    expect(await listUnlocks(db)).not.toContainEqual(
      expect.objectContaining({ set_id: unchecked!.id })
    );
  });
});

// --- session_count ladder: LIVE path (evaluate + panel) ----------------------
// Companion to the backfill-path regression in achievementBackfill.test.ts
// ('session_count ladder excludes planned-but-never-tapped sessions'). The src
// fix lives in `countLoggedSessions` (`AND s.is_logged = 1`, 226b004). This
// pins the two LIVE surfaces that also read that count — `loadAchievementPanelData`
// (the achievements-panel `totalSessionCount`) and `evaluateAndPersistAchievements`
// (the end-of-session unlock) — so a session opened from a template / 動作記憶
// default and ended WITHOUT ✓-tapping any set ("ghost": real weight·reps,
// is_logged=0, is_skipped=0, never purged by `endSession`) can never inflate the
// 「完成 N 次訓練」ladder there either.
//
// NB: `set_kind = 'working'` is deliberately NOT part of the fix (ADR-0009 §D3):
// warmup-only sessions are intentionally counted (compensated by `evaluate()`'s
// working-set `hasLogged` gate + the FINAL-total feed), and a dropset HEAD is
// `set_kind='dropset'` so a working-only filter would wrongly drop pure-dropset
// sessions. These tests therefore only exercise the planned-vs-performed axis.
describe('session_count ladder — live path excludes planned-but-never-tapped sessions', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  const dayMs = 24 * 60 * 60 * 1000;

  // A "ghost" session: sets carry real weight·reps but were NEVER ✓-tapped.
  // `recordSetInSession` (via recSet) writes is_logged=0 and we deliberately
  // skip the ✓-tap UPDATE — modelling a template / 動作記憶 plan the user opened
  // and ended without ticking. `endSession` only writes ended_at, so the
  // unchecked rows persist (is_logged=0, is_skipped=0, real weight·reps).
  const seedGhostSession = async (args: {
    id: string;
    exercise_id: string;
    started_at: number;
    uuid: () => string;
  }) => {
    await createSession(db, { id: args.id, started_at: args.started_at });
    await recSet(db, {
      session_id: args.id,
      exercise_id: args.exercise_id,
      weight_kg: 100,
      reps: 5,
      ordering: 0,
      now: () => args.started_at + 1000,
      uuid: args.uuid,
    });
    // NO is_logged=1 UPDATE — typed but never ticked.
    await endSession(db, { id: args.id, ended_at: args.started_at + 60_000 });
  };

  it('a ghost (zero-✓) session does NOT increment totalSessionCount; a real ✓ one does', async () => {
    const bench = (await listExercises(db)).find((e) => e.name === 'Bench Press')!;
    const t0 = 1_700_000_000_000;
    let nextId = 0;
    const uuid = () => `set-${nextId++}`;

    // Ghost session first — the user performed nothing.
    await seedGhostSession({ id: 'ghost', exercise_id: bench.id, started_at: t0, uuid });

    // The panel's session count must still be 0 (pre-fix it was 1).
    expect((await loadAchievementPanelData(db)).totalSessionCount).toBe(0);

    // Real session: the user ✓-tapped a working set.
    await createSession(db, { id: 'real', started_at: t0 + dayMs });
    const realSet = await recSet(db, {
      session_id: 'real',
      exercise_id: bench.id,
      weight_kg: 60,
      reps: 8,
      ordering: 0,
      now: () => t0 + dayMs + 1000,
      uuid,
    });
    await db.runAsync(`UPDATE "set" SET is_logged = 1 WHERE id = ?`, realSet.set_id);
    await endSession(db, { id: 'real', ended_at: t0 + dayMs + 60_000 });

    // Only the real session counts — the ghost never increments the ladder
    // (pre-fix this would read 2).
    expect((await loadAchievementPanelData(db)).totalSessionCount).toBe(1);
  });

  it('4 ghost sessions do NOT let a later real session cross session_count(5) early', async () => {
    const bench = (await listExercises(db)).find((e) => e.name === 'Bench Press')!;
    const t0 = 1_700_000_000_000;
    let nextId = 0;
    const uuid = () => `set-${nextId++}`;

    // 4 ghost (template-started, zero-✓, ended) sessions. Pre-fix these inflated
    // countLoggedSessions to 4.
    for (let i = 0; i < 4; i++) {
      await seedGhostSession({
        id: `ghost-${i}`,
        exercise_id: bench.id,
        started_at: t0 + i * dayMs,
        uuid,
      });
    }

    // 1 genuinely-performed (✓-tapped) session, evaluated via the live
    // end-of-session path.
    const realId = 'real';
    await createSession(db, { id: realId, started_at: t0 + 5 * dayMs });
    const realSet = await recSet(db, {
      session_id: realId,
      exercise_id: bench.id,
      weight_kg: 60,
      reps: 8,
      ordering: 0,
      now: () => t0 + 5 * dayMs + 1000,
      uuid,
    });
    await db.runAsync(`UPDATE "set" SET is_logged = 1 WHERE id = ?`, realSet.set_id);
    await endSession(db, { id: realId, ended_at: t0 + 5 * dayMs + 60_000 });

    const outcome = await evaluateAndPersistAchievements(db, {
      ended_session_id: realId,
      unlocked_at: t0 + 5 * dayMs + 60_000,
    });
    const codes = outcome.newDefinitions.map((d) => d.code);

    // Real performed count = 1: only the 1-session milestone unlocks. Pre-fix
    // totalSessionCount = 4 ghosts + 1 real = 5, so session_count__5 fired one
    // session early off sets the user only typed.
    expect(codes).toContain('session_count__1');
    expect(codes).not.toContain('session_count__5');

    // The panel count agrees — just the 1 real session.
    expect((await loadAchievementPanelData(db)).totalSessionCount).toBe(1);
  });
});
