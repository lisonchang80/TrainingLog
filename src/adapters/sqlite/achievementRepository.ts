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
  CumulativePRCounts,
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
  is_logged: number;
  created_at: number;
}

export async function loadReplayRecords(db: Database): Promise<ReplaySetRecord[]> {
  // ADR-0012 line 173 / line 100: PR engine只看 working sets。
  // warmup + dropset cluster (含 parent root) 必須在 SQL 邊界排除，
  // 才不會把 backoff set 或熱身誤判為 PR 突破。Sibling to
  // listPriorSetsForExercise's set_kind filter (2026-05-27).
  //
  // F3-sibling fix (2026-06-25): also filter `AND s.is_logged = 1` so planned-
  // but-unchecked sets (template / 動作記憶 defaults that `endSession` never
  // purges — they persist with real weight/reps and is_logged=0) don't reach
  // PR detection / achievement unlocks. The JS flag below USED to derive
  // is_logged from a stale proxy (`is_skipped === 0`), which wrongly treated
  // those unchecked sets as logged (their is_skipped is 0). This MIRRORS the
  // History/PR canonical `listExercisePRSetRows` (plain `is_logged = 1`, NOT
  // chain-aware) so achievement PR replay agrees with the PR-detail surface.
  // Dropset followers are already excluded here by `set_kind = 'working'`
  // (followers carry set_kind='dropset'), so this filter doesn't change
  // dropset behaviour — it only drops genuinely-unchecked working sets.
  const rows = await db.getAllAsync<ReplayRowDB>(
    `SELECT s.id                  AS set_id,
            s.session_id           AS session_id,
            s.exercise_id          AS exercise_id,
            e.muscle_group_id      AS mg_id,
            e.load_type            AS load_type,
            s.weight_kg            AS weight_kg,
            s.reps                 AS reps,
            ss.bodyweight_snapshot_kg AS bw_snapshot_kg,
            s.is_logged            AS is_logged,
            s.created_at           AS created_at
       FROM "set" s
       JOIN session ss ON ss.id = s.session_id
       JOIN exercise e ON e.id = s.exercise_id
      WHERE s.set_kind = 'working'
        AND s.is_logged = 1
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
    // Rows are already SQL-filtered to `is_logged = 1`; the value-validity
    // guard below keeps a logged-but-blank row (null/invalid weight·reps) from
    // qualifying as a PR-eligible "touched" set (mirrors the prior proxy's
    // weight/reps guard, now anchored on the real column).
    is_logged:
      r.is_logged === 1 &&
      r.weight_kg != null &&
      r.reps != null &&
      Number.isFinite(r.reps) &&
      r.reps >= 1,
    created_at: r.created_at,
  }));
}

// ---- Panel view-model loader (Slice 17 / ADR-0009 amendment) ----

/**
 * Everything the redesigned achievements panel needs, in one focus-time read.
 *
 * - `defs` / `unlockedIds`: definition rows + unlocked ids (first_combo level-0).
 * - `perMg` / `perBucket`: cumulative PR counts replayed from the FULL working-set
 *   history via the SAME `replayPRs` the engine uses to decide thresholds — so
 *   the panel's progress numerators are in lock-step with unlocking.
 * - `touchedMgs` / `touchedBuckets`: 碰過 signal = the mg/bucket has ≥1 working
 *   (non-warmup) set logged. Derived from the same replay records (a set is
 *   "touched" the moment it is logged, regardless of whether it broke a PR),
 *   so no extra query and it respects the user's edited bucket ranges.
 * - `totalSessionCount`: drives the always-shown milestone ladder.
 */
export interface AchievementPanelData {
  defs: AchievementDefinitionRow[];
  unlockedIds: Set<number>;
  perMg: Map<string, { weight: number; volume: number }>;
  perBucket: Map<BucketKey, { weight: number; volume: number }>;
  touchedMgs: Set<string>;
  touchedBuckets: Set<string>;
  totalSessionCount: number;
}

export async function loadAchievementPanelData(
  db: Database
): Promise<AchievementPanelData> {
  const [defs, unlockedIds, replayRecords, totalSessions] = await Promise.all([
    listAchievementDefinitions(db),
    listUnlockedDefinitionIds(db),
    loadReplayRecords(db),
    countLoggedSessions(db),
  ]);

  const replay = replayPRs(replayRecords);

  // 碰過 = ≥1 logged working set in that mg / bucket. Derive from the same
  // records: classify each logged set's bucket (reflects edited ranges) and
  // mark its mg.
  const touchedMgs = new Set<string>();
  const touchedBuckets = new Set<string>();
  for (const r of replayRecords) {
    if (!r.is_logged) continue;
    if (r.mg_id != null) touchedMgs.add(r.mg_id);
    const bucket = classifyBucket(r.reps);
    if (bucket != null) touchedBuckets.add(bucket);
  }

  return {
    defs,
    unlockedIds,
    perMg: replay.cumulative.per_mg,
    perBucket: replay.cumulative.per_bucket,
    touchedMgs,
    touchedBuckets,
    totalSessionCount: totalSessions,
  };
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
 * Walk every previously-ended session in chronological order and persist the
 * retroactive unlocks each one earns, so users who logged sessions before
 * slice 9 deployed still get their achievements. A sentinel timestamp in
 * `app_settings` short-circuits subsequent calls.
 *
 * Performance (perf audit 2026-06-17, report 08 — runs on the boot await in
 * `database-provider.tsx` BEFORE the first paint)
 * --------------------------------------------------------------------------
 * This used to call `evaluateAndPersistAchievements` once per session, and
 * THAT re-loaded the full working-set history (`loadReplayRecords`) and
 * re-ran `replayPRs` over the WHOLE history on every iteration → O(N²) in the
 * number of ended sessions (measured quadratic; ~50 s at 2000 sessions). Now
 * the whole-history load + replay happen exactly ONCE, and the per-session
 * unlock evaluation reuses the cached replay → O(N). It only ever runs with N
 * large when the sentinel is absent AND the history is large (the one-time
 * pre-backfill upgrade, or a restore of a sentinel-less older backup), but the
 * boot-await placement makes the O(N²) a visible freeze, so this is fixed for
 * robustness pre-launch (ADR-0009 § 2026-06-17 Amendment).
 *
 * Attribution (ADR-0009 § 2026-06-17 Amendment, grill Q2-B)
 * ---------------------------------------------------------
 * The old loop fed every session the FINAL whole-history cumulative counts, so
 * `pr_per_mg` / `pr_per_bucket` unlocks were timestamped to the FIRST
 * PR-breaking session rather than the session that actually crossed the
 * threshold. This rewrite advances a running PR cumulative session-by-session,
 * so those unlocks now land on the crossing session (a strictly more accurate
 * historical timeline; the SET of unlocked definitions is unchanged — cumulative
 * counts are monotonic, so an achievement unlocks iff its final count ≥ its
 * threshold either way).
 *
 * `session_count` is the deliberate exception: it is still fed the FINAL
 * `countLoggedSessions` total on every call (NOT a progressive count). Reason:
 * `evaluate()` gates the `session_count` ladder on the *current* session having
 * a logged WORKING set (`hasLogged`), but `countLoggedSessions` counts any
 * session with a non-skipped set — including warmup-only sessions, which carry
 * zero working sets here (the loader filters `set_kind = 'working'`). A
 * progressive count could therefore cross a threshold on a warmup-only session
 * that `evaluate()` skips, dropping an unlock the old loop produced. Feeding the
 * final total preserves the exact old-loop SET + attribution (first working-set
 * session) with no warmup-only edge case.
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

  // O(N): load + replay the whole working-set history ONCE (was: per session).
  const [defs, replayRecords, totalSessions] = await Promise.all([
    listAchievementDefinitions(db),
    loadReplayRecords(db),
    countLoggedSessions(db),
  ]);
  const replay = replayPRs(replayRecords);

  // Group replay records by session (working sets only — the loader excludes
  // warmup; created_at order within a session is preserved by push order).
  const recordsBySession = new Map<string, ReplaySetRecord[]>();
  for (const r of replayRecords) {
    const arr = recordsBySession.get(r.session_id);
    if (arr) arr.push(r);
    else recordsBySession.set(r.session_id, [r]);
  }

  // Seed the unlocked set from any pre-existing unlocks, then accumulate
  // in-memory across the walk (mirrors the old loop's per-iteration DB re-query
  // + insert, minus the re-query).
  const unlockedIds = new Set(await listUnlockedDefinitionIds(db));

  // Running PR cumulative, advanced session-by-session so pr_per_mg /
  // pr_per_bucket unlocks land on the crossing session (see docblock). By the
  // final session this equals `replay.cumulative` exactly (same increments,
  // just grouped by session).
  const runningCumul: CumulativePRCounts = {
    per_mg: new Map(),
    per_bucket: new Map(),
  };
  const incMg = (mg: string, kind: 'weight' | 'volume') => {
    const c = runningCumul.per_mg.get(mg) ?? { weight: 0, volume: 0 };
    c[kind] += 1;
    runningCumul.per_mg.set(mg, c);
  };
  const incBucket = (bucket: BucketKey, kind: 'weight' | 'volume') => {
    const c = runningCumul.per_bucket.get(bucket) ?? { weight: 0, volume: 0 };
    c[kind] += 1;
    runningCumul.per_bucket.set(bucket, c);
  };

  let totalNew = 0;
  for (const s of sessions) {
    const sRecords = recordsBySession.get(s.id) ?? [];

    // Advance the running cumulative by THIS session's PR breaks BEFORE eval,
    // so the count is "as of end of this session" (mirrors live evaluation,
    // where loadReplayRecords includes the just-ended session).
    for (const r of sRecords) {
      const f = replay.flagsBySetId.get(r.set_id);
      if (!f) continue;
      if (f.weight_pr_broken) {
        if (r.mg_id != null) incMg(r.mg_id, 'weight');
        if (f.bucket != null) incBucket(f.bucket, 'weight');
      }
      if (f.volume_pr_broken) {
        if (r.mg_id != null) incMg(r.mg_id, 'volume');
        if (f.bucket != null) incBucket(f.bucket, 'volume');
      }
    }

    const evalSets: SessionEvalSet[] = sRecords.map((r) => {
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
      session: { session_id: s.id, sets: evalSets },
      defs,
      unlockedIds,
      cumulativePRCounts: runningCumul,
      // session_count uses the FINAL total — see docblock (warmup-only guard).
      totalSessionCount: totalSessions,
    });

    if (newUnlocks.length > 0) {
      await insertUnlocks(db, newUnlocks, s.ended_at);
      for (const u of newUnlocks) unlockedIds.add(u.definition_id);
      totalNew += newUnlocks.length;
    }
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
 * Count of ended sessions that have at least one *performed* set.
 * Used as `totalSessionCount` for the session_count ladder.
 *
 * `AND s.is_logged = 1` is load-bearing (is-logged-surfaces / F3 class): a
 * session opened from a plan/template and ended WITHOUT ✓-tapping any set still
 * carries set rows with real weight_kg/reps and `is_logged = 0` (endSession
 * never purges planned sets — see sessionRepository.endSession). Without this
 * filter those never-performed sets pass the `is_skipped = 0 AND weight/reps
 * NOT NULL` guard and wrongly count the abandoned session toward the milestone,
 * inflating the displayed/unlock total. The function's stated contract was
 * always "≥1 logged set"; the SQL had drifted off it. Mirrors the sibling
 * `loadReplayRecords` filter (added 2026-06-25) and the canonical
 * `exerciseHistoryRepository.listExercisePRSetRows`. Plain `is_logged = 1` (NOT
 * chain-aware) is correct here — this is an aggregate "did a session happen"
 * count, per is-logged-surfaces (vs dropset-chain-semantics' effective-logged).
 */
async function countLoggedSessions(db: Database): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(DISTINCT ss.id) AS n
       FROM session ss
       JOIN "set" s ON s.session_id = ss.id
      WHERE ss.ended_at IS NOT NULL
        AND s.is_skipped = 0
        AND s.is_logged = 1
        AND s.weight_kg IS NOT NULL
        AND s.reps IS NOT NULL`
  );
  return row?.n ?? 0;
}
