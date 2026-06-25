import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { createSession, endSession } from '../../src/adapters/sqlite/sessionRepository';
import { recordSetInSession } from '../../src/adapters/sqlite/setRepository';
import { listExercises } from '../../src/adapters/sqlite/exerciseRepository';
import {
  backfillAchievementsIfNeeded,
  listUnlocks,
} from '../../src/adapters/sqlite/achievementRepository';
import { getSetting } from '../../src/adapters/sqlite/settingsRepository';

interface SeedSet {
  exercise_id: string;
  weight_kg: number;
  reps: number;
}

interface SeedSession {
  id: string;
  started_at: number;
  ended_at: number;
  sets: SeedSet[];
}

const seedSessions = async (
  db: BetterSqliteDatabase,
  sessions: readonly SeedSession[]
) => {
  let nextId = 0;
  const uuid = () => `set-${nextId++}`;
  for (const s of sessions) {
    await createSession(db, { id: s.id, started_at: s.started_at });
    for (const [ord, set] of s.sets.entries()) {
      await recordSetInSession(db, {
        session_id: s.id,
        input: {
          exercise_id: set.exercise_id,
          weight_kg: set.weight_kg,
          reps: set.reps,
        },
        uuid,
        now: () => s.started_at + 1000 + ord,
      });
    }
    // recordSetInSession writes is_logged=0; simulate the user's ✓-tap so the
    // backfill replay counts these sets (loadReplayRecords filters is_logged=1).
    await db.runAsync(`UPDATE "set" SET is_logged = 1 WHERE session_id = ?`, s.id);
    await endSession(db, { id: s.id, ended_at: s.ended_at });
  }
};

describe('backfillAchievementsIfNeeded', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it('empty DB: backfill runs, replays 0 sessions, sets sentinel', async () => {
    const out = await backfillAchievementsIfNeeded(db, { now: () => 9_999 });
    expect(out).toEqual({
      ranBackfill: true,
      sessionsReplayed: 0,
      newUnlocks: 0,
    });
    expect(await getSetting<number>(db, 'achievements_backfilled_at')).toBe(9_999);
    expect(await listUnlocks(db)).toHaveLength(0);
  });

  it('skips when sentinel is already set (cheap path on every launch after first)', async () => {
    // Pre-populate sentinel
    await backfillAchievementsIfNeeded(db, { now: () => 1_111 });
    const out = await backfillAchievementsIfNeeded(db, { now: () => 2_222 });
    expect(out).toEqual({
      ranBackfill: false,
      sessionsReplayed: 0,
      newUnlocks: 0,
    });
    // Sentinel timestamp unchanged on subsequent calls
    expect(await getSetting<number>(db, 'achievements_backfilled_at')).toBe(1_111);
  });

  it('replays multi-session history and unlocks first_combo + PR + session_count tiers', async () => {
    const exercises = await listExercises(db);
    const benchPress = exercises.find((e) => e.name === 'Bench Press')!;
    const backSquat = exercises.find((e) => e.name === 'Back Squat')!;

    const t0 = 1_700_000_000_000;
    const dayMs = 24 * 60 * 60 * 1000;

    // 5 ended sessions: 3 chest hypertrophy, 2 leg strength.
    // Each progressively heavier so PR cumulative counts grow.
    await seedSessions(db, [
      {
        id: 'sess-1',
        started_at: t0 + 0 * dayMs,
        ended_at: t0 + 0 * dayMs + 60_000,
        sets: [{ exercise_id: benchPress.id, weight_kg: 50, reps: 8 }],
      },
      {
        id: 'sess-2',
        started_at: t0 + 1 * dayMs,
        ended_at: t0 + 1 * dayMs + 60_000,
        sets: [{ exercise_id: backSquat.id, weight_kg: 80, reps: 5 }],
      },
      {
        id: 'sess-3',
        started_at: t0 + 2 * dayMs,
        ended_at: t0 + 2 * dayMs + 60_000,
        sets: [{ exercise_id: benchPress.id, weight_kg: 60, reps: 8 }],
      },
      {
        id: 'sess-4',
        started_at: t0 + 3 * dayMs,
        ended_at: t0 + 3 * dayMs + 60_000,
        sets: [{ exercise_id: backSquat.id, weight_kg: 90, reps: 5 }],
      },
      {
        id: 'sess-5',
        started_at: t0 + 4 * dayMs,
        ended_at: t0 + 4 * dayMs + 60_000,
        sets: [{ exercise_id: benchPress.id, weight_kg: 70, reps: 8 }],
      },
    ]);

    // Pre-condition: no unlocks yet — sessions ended without evaluate() ever firing.
    expect(await listUnlocks(db)).toHaveLength(0);

    const out = await backfillAchievementsIfNeeded(db, { now: () => 8_888 });
    expect(out.ranBackfill).toBe(true);
    expect(out.sessionsReplayed).toBe(5);
    expect(out.newUnlocks).toBeGreaterThan(0);

    const all = await listUnlocks(db);
    expect(all).toHaveLength(out.newUnlocks);

    // Sentinel persisted
    expect(await getSetting<number>(db, 'achievements_backfilled_at')).toBe(8_888);
  });

  it('idempotency: rerun produces 0 new rows and sentinel timestamp is unchanged', async () => {
    const exercises = await listExercises(db);
    const benchPress = exercises.find((e) => e.name === 'Bench Press')!;
    const t0 = 1_700_000_000_000;

    await seedSessions(db, [
      {
        id: 'sess-1',
        started_at: t0,
        ended_at: t0 + 60_000,
        sets: [{ exercise_id: benchPress.id, weight_kg: 50, reps: 8 }],
      },
    ]);

    const first = await backfillAchievementsIfNeeded(db, { now: () => 5_000 });
    expect(first.ranBackfill).toBe(true);
    expect(first.newUnlocks).toBeGreaterThan(0);
    const initialUnlockCount = (await listUnlocks(db)).length;
    const sentinelAfterFirst = await getSetting<number>(
      db,
      'achievements_backfilled_at'
    );
    expect(sentinelAfterFirst).toBe(5_000);

    // Second call — even with a different `now`, the sentinel short-circuits.
    const second = await backfillAchievementsIfNeeded(db, { now: () => 7_777 });
    expect(second.ranBackfill).toBe(false);
    expect(second.newUnlocks).toBe(0);
    expect((await listUnlocks(db)).length).toBe(initialUnlockCount);
    // Sentinel timestamp unchanged on subsequent calls
    expect(await getSetting<number>(db, 'achievements_backfilled_at')).toBe(5_000);
  });

  it('historical unlocks timestamped at each session ended_at (not the backfill clock)', async () => {
    const exercises = await listExercises(db);
    const benchPress = exercises.find((e) => e.name === 'Bench Press')!;
    const t0 = 1_700_000_000_000;
    const dayMs = 24 * 60 * 60 * 1000;

    await seedSessions(db, [
      {
        id: 'old-session',
        started_at: t0,
        ended_at: t0 + 60_000,
        sets: [{ exercise_id: benchPress.id, weight_kg: 50, reps: 8 }],
      },
      {
        id: 'newer-session',
        started_at: t0 + dayMs,
        ended_at: t0 + dayMs + 60_000,
        sets: [{ exercise_id: benchPress.id, weight_kg: 60, reps: 8 }],
      },
    ]);

    await backfillAchievementsIfNeeded(db, { now: () => 9_999 });

    const all = await listUnlocks(db);
    // Each unlock_at must be one of the two session ended_at values, not 9_999.
    const allowed = new Set([t0 + 60_000, t0 + dayMs + 60_000]);
    for (const u of all) {
      expect(allowed.has(u.unlocked_at)).toBe(true);
    }
    expect(all.some((u) => u.unlocked_at === t0 + 60_000)).toBe(true);
  });
});

/**
 * O(N) single-pass rewrite attribution (2026-06-17, ADR-0009 § Amendment).
 *
 * The backfill no longer re-replays the whole history per session (was O(N²));
 * it loads + replays ONCE and advances a running PR cumulative session-by-
 * session. Two attribution guarantees fall out of that design:
 *   1. pr_per_mg / pr_per_bucket unlocks land on the session that CROSSED the
 *      threshold (progressive) — the meaningful timeline correction.
 *   2. session_count unlocks are deliberately fed the FINAL count (NOT
 *      progressive), so they attribute to the first logged session exactly like
 *      the old loop — sidestepping the warmup-only edge case where a progressive
 *      count could cross on a session evaluate() skips, dropping an unlock.
 */
describe('backfillAchievementsIfNeeded — O(N) single-pass attribution', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  // 10 sessions, each a NEW chest weight PR (Bench Press, increasing weight,
  // reps 8 → 增肌 bucket), one per day. So per-(mg-chest) weight PR count climbs
  // 1→10 across sessions[0..9], and there are 10 logged sessions.
  const seedTenChestPRSessions = async (exId: string) => {
    const t0 = 1_700_000_000_000;
    const dayMs = 24 * 60 * 60 * 1000;
    const sessions = Array.from({ length: 10 }, (_, i) => ({
      id: `pr-${i}`,
      started_at: t0 + i * dayMs,
      ended_at: t0 + i * dayMs + 60_000,
      sets: [{ exercise_id: exId, weight_kg: 50 + i * 5, reps: 8 }],
    }));
    await seedSessions(db, sessions);
    return sessions;
  };

  it('pr_per_mg weight unlocks land on the CROSSING session (progressive), not the first', async () => {
    const bench = (await listExercises(db)).find((e) => e.name === 'Bench Press')!;
    const sessions = await seedTenChestPRSessions(bench.id);
    await backfillAchievementsIfNeeded(db, { now: () => 9_999 });

    const unlockedAtForThreshold = async (threshold: number) =>
      (
        await db.getFirstAsync<{ unlocked_at: number }>(
          `SELECT au.unlocked_at
             FROM achievement_unlock au
             JOIN achievement_definition ad ON ad.id = au.achievement_definition_id
            WHERE ad.category = 'pr_per_mg' AND ad.pr_type = 'weight'
              AND ad.mg_id = 'mg-chest' AND ad.threshold = ?`,
          threshold
        )
      )?.unlocked_at;

    // threshold-1 fires on the 1st PR (session 0); threshold-10 fires on the
    // 10th PR (session 9). The OLD loop fed the FINAL cumulative to every
    // session, so BOTH would have landed on session 0 — this is the regression
    // guard for the progressive (Q2-B) attribution.
    expect(await unlockedAtForThreshold(1)).toBe(sessions[0].ended_at);
    expect(await unlockedAtForThreshold(10)).toBe(sessions[9].ended_at);
  });

  it('session_count unlocks use the FINAL count → attributed to the first logged session', async () => {
    const bench = (await listExercises(db)).find((e) => e.name === 'Bench Press')!;
    const sessions = await seedTenChestPRSessions(bench.id); // 10 logged sessions

    await backfillAchievementsIfNeeded(db, { now: () => 9_999 });

    const unlockedAtForThreshold = async (threshold: number) =>
      (
        await db.getFirstAsync<{ unlocked_at: number }>(
          `SELECT au.unlocked_at
             FROM achievement_unlock au
             JOIN achievement_definition ad ON ad.id = au.achievement_definition_id
            WHERE ad.category = 'session_count' AND ad.threshold = ?`,
          threshold
        )
      )?.unlocked_at;

    // Deliberately NOT progressive (see describe docblock + backfill source):
    // the 1 / 5 / 10-session milestones all unlock at the FIRST session because
    // the final total (10) already satisfies them on session 0. If this ever
    // flips to a progressive count, revisit the warmup-only drop-an-unlock risk.
    expect(await unlockedAtForThreshold(1)).toBe(sessions[0].ended_at);
    expect(await unlockedAtForThreshold(5)).toBe(sessions[0].ended_at);
    expect(await unlockedAtForThreshold(10)).toBe(sessions[0].ended_at);
  });
});
