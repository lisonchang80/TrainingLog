/**
 * Achievement Repository — slice 9.
 *
 * - Loads achievement_definition rows
 * - Loads currently-unlocked definition IDs
 * - Persists newly-triggered unlocks
 * - Loads the full set history (joined with exercise + session) for PR replay
 *
 * The actual achievement evaluation pipeline lives in
 * `evaluateAndPersistAchievements()` here, which:
 *   1. Loads definitions + current unlocks + full PR-replay-ready set history
 *   2. Replays PRs to derive cumulative counts + per-set PR flags
 *   3. Builds the SessionEval input for the just-ended session
 *   4. Calls `evaluate()` from the achievement engine
 *   5. INSERTs new unlock rows in a single transaction
 *
 * Returns the newly-unlocked definitions so the UI can render a "本次解鎖"
 * summary on the post-session screen.
 */

import type { Database } from '../../db/types';
import type { LoadType } from '../../domain/exercise/types';
import type { BucketKey } from '../../domain/pr/types';
import { classifyBucket } from '../../domain/pr/buckets';
import type {
  AchievementDefinitionRow,
  NewUnlock,
  SessionEvalSet,
} from '../../domain/achievement/types';
import { evaluate } from '../../domain/achievement/achievementEngine';
import {
  replayPRs,
  type ReplaySetRecord,
} from '../../domain/achievement/prReplay';
import { getSetting, setSetting } from './settingsRepository';

// ---- Definitions ----

interface DefRowDB {
  id: number;
  code: string;
  category: AchievementDefinitionRow['category'];
  display_name: string;
  description: string | null;
  mg_id: string | null;
  bucket_id: string | null;
  pr_type: 'weight' | 'volume' | null;
  threshold: number | null;
  tier: number;
}

export async function listAchievementDefinitions(
  db: Database
): Promise<AchievementDefinitionRow[]> {
  const rows = await db.getAllAsync<DefRowDB>(
    `SELECT id, code, category, display_name, description,
            mg_id, bucket_id, pr_type, threshold, tier
       FROM achievement_definition
      ORDER BY category, mg_id, bucket_id, tier`
  );
  return rows;
}

// ---- Unlocks ----

export interface AchievementUnlockRow {
  id: number;
  achievement_definition_id: number;
  unlocked_at: number;
  session_id: string;
  set_id: string | null;
}

export async function listUnlocks(db: Database): Promise<AchievementUnlockRow[]> {
  return db.getAllAsync<AchievementUnlockRow>(
    `SELECT id, achievement_definition_id, unlocked_at, session_id, set_id
       FROM achievement_unlock
      ORDER BY unlocked_at DESC`
  );
}

export async function listUnlockedDefinitionIds(
  db: Database
): Promise<Set<number>> {
  const rows = await db.getAllAsync<{ achievement_definition_id: number }>(
    `SELECT achievement_definition_id FROM achievement_unlock`
  );
  return new Set(rows.map((r) => r.achievement_definition_id));
}

async function insertUnlocks(
  db: Database,
  rows: readonly NewUnlock[],
  unlocked_at: number
): Promise<void> {
  if (rows.length === 0) return;
  await db.withTransactionAsync(async () => {
    for (const r of rows) {
      // INSERT OR IGNORE protects against double-eval — `achievement_definition_id`
      // is UNIQUE, so a second call with the same id is a no-op.
      await db.runAsync(
        `INSERT OR IGNORE INTO achievement_unlock
           (achievement_definition_id, unlocked_at, session_id, set_id)
         VALUES (?, ?, ?, ?)`,
        r.definition_id,
        unlocked_at,
        r.session_id,
        r.set_id
      );
    }
  });
}

// ---- Replay loader ----

interface ReplayRowDB {
  set_id: string;
  session_id: string;
  exercise_id: string;
  mg_id: string | null;
  load_type: LoadType;
  weight_kg: number | null;
  reps: number | null;
  bw_snapshot_kg: number | null;
  is_skipped: number;
  created_at: number;
}

async function loadReplayRecords(db: Database): Promise<ReplaySetRecord[]> {
  const rows = await db.getAllAsync<ReplayRowDB>(
    `SELECT s.id                  AS set_id,
            s.session_id           AS session_id,
            s.exercise_id          AS exercise_id,
            e.muscle_group_id      AS mg_id,
            e.load_type            AS load_type,
            s.weight_kg            AS weight_kg,
            s.reps                 AS reps,
            ss.bodyweight_snapshot_kg AS bw_snapshot_kg,
            s.is_skipped           AS is_skipped,
            s.created_at           AS created_at
       FROM "set" s
       JOIN session ss ON ss.id = s.session_id
       JOIN exercise e ON e.id = s.exercise_id
      ORDER BY s.created_at ASC, s.id ASC`
  );
  return rows.map((r) => ({
    set_id: r.set_id,
    session_id: r.session_id,
    exercise_id: r.exercise_id,
    mg_id: r.mg_id,
    load_type: r.load_type,
    weight_kg: r.weight_kg,
    reps: r.reps,
    bw_snapshot_kg: r.bw_snapshot_kg,
    is_logged:
      r.is_skipped === 0 &&
      r.weight_kg != null &&
      r.reps != null &&
      Number.isFinite(r.reps) &&
      r.reps >= 1,
    created_at: r.created_at,
  }));
}

// ---- Pipeline ----

interface EvaluationOutcome {
  newUnlocks: NewUnlock[];
  /** The full definition rows for the new unlocks, for UI display. */
  newDefinitions: AchievementDefinitionRow[];
}

/**
 * End-of-session evaluator. Call after `endSession()` writes ended_at and the
 * just-ended session's sets are saved. Returns the newly unlocked rows so the
 * caller can show a "本次解鎖" UI segment.
 *
 * `unlocked_at` defaults to Date.now() but is injectable for testing.
 */
export async function evaluateAndPersistAchievements(
  db: Database,
  args: { ended_session_id: string; unlocked_at?: number }
): Promise<EvaluationOutcome> {
  const { ended_session_id } = args;
  const unlocked_at = args.unlocked_at ?? Date.now();

  const [defs, unlockedIds, replayRecords, totalSessions] = await Promise.all([
    listAchievementDefinitions(db),
    listUnlockedDefinitionIds(db),
    loadReplayRecords(db),
    countLoggedSessions(db),
  ]);

  const replay = replayPRs(replayRecords);

  // Build SessionEval for the ended session.
  const sessionRecords = replayRecords.filter((r) => r.session_id === ended_session_id);
  const evalSets: SessionEvalSet[] = sessionRecords.map((r) => {
    const flags = replay.flagsBySetId.get(r.set_id);
    const bucket: BucketKey | null = flags?.bucket ?? classifyBucket(r.reps);
    return {
      set_id: r.set_id,
      mg_id: r.mg_id,
      bucket,
      is_logged: r.is_logged,
      weight_pr_broken: flags?.weight_pr_broken ?? false,
      volume_pr_broken: flags?.volume_pr_broken ?? false,
    };
  });

  const newUnlocks = evaluate({
    session: { session_id: ended_session_id, sets: evalSets },
    defs,
    unlockedIds,
    cumulativePRCounts: replay.cumulative,
    totalSessionCount: totalSessions,
  });

  await insertUnlocks(db, newUnlocks, unlocked_at);

  const defById = new Map(defs.map((d) => [d.id, d]));
  const newDefinitions = newUnlocks
    .map((u) => defById.get(u.definition_id))
    .filter((d): d is AchievementDefinitionRow => d != null);

  return { newUnlocks, newDefinitions };
}

// ---- Retroactive backfill ----

const BACKFILL_SETTING_KEY = 'achievements_backfilled_at';

interface BackfillOutcome {
  ranBackfill: boolean;
  sessionsReplayed: number;
  newUnlocks: number;
}

/**
 * Walk every previously-ended session in chronological order and call
 * `evaluateAndPersistAchievements` for each, so users who logged sessions
 * before slice 9 deployed still get their retroactive unlocks. A sentinel
 * timestamp in `app_settings` short-circuits subsequent calls.
 *
 * Idempotent two ways:
 *   - Sentinel present → return immediately (the cheap path on every launch
 *     after the first).
 *   - Even without the sentinel, `insertUnlocks` uses INSERT OR IGNORE on a
 *     UNIQUE definition_id index, so repeat runs would not double-write.
 *
 * Each session's unlocks are timestamped to that session's `ended_at` so the
 * historical achievement timeline stays sensible.
 */
export async function backfillAchievementsIfNeeded(
  db: Database,
  opts: { now?: () => number } = {}
): Promise<BackfillOutcome> {
  const existing = await getSetting<number>(db, BACKFILL_SETTING_KEY);
  if (existing != null) {
    return { ranBackfill: false, sessionsReplayed: 0, newUnlocks: 0 };
  }

  const sessions = await db.getAllAsync<{ id: string; ended_at: number }>(
    `SELECT id, ended_at FROM session
      WHERE ended_at IS NOT NULL
      ORDER BY started_at ASC, id ASC`
  );

  let totalNew = 0;
  for (const s of sessions) {
    const outcome = await evaluateAndPersistAchievements(db, {
      ended_session_id: s.id,
      unlocked_at: s.ended_at,
    });
    totalNew += outcome.newUnlocks.length;
  }

  const now = opts.now ?? (() => Date.now());
  await setSetting<number>(db, BACKFILL_SETTING_KEY, now());

  return {
    ranBackfill: true,
    sessionsReplayed: sessions.length,
    newUnlocks: totalNew,
  };
}

/**
 * Count of sessions where ended_at IS NOT NULL AND at least one logged set.
 * Used as `totalSessionCount` for the session_count ladder.
 */
async function countLoggedSessions(db: Database): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(DISTINCT ss.id) AS n
       FROM session ss
       JOIN "set" s ON s.session_id = ss.id
      WHERE ss.ended_at IS NOT NULL
        AND s.is_skipped = 0
        AND s.weight_kg IS NOT NULL
        AND s.reps IS NOT NULL`
  );
  return row?.n ?? 0;
}
