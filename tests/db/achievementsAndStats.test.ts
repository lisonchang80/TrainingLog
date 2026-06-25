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
});
