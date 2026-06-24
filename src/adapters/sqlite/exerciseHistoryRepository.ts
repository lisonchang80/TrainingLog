/**
 * Exercise History — cross-Template, cross-Program aggregate (ADR-0006 scope c).
 *
 * Returns every set ever recorded for a given exercise_id, joined with its
 * session start time and bw snapshot (needed for load_type='assisted'
 * effective-load math).
 *
 * Includes only `is_skipped = 0 AND is_logged = 1` sets. The `is_logged = 1`
 * filter (slice 10c overnight #10) is the source-of-truth definition of
 * "this set actually happened" — planned-but-unticked rows from an
 * in-progress session must NOT bleed into the historical aggregate. Session
 * `ended_at` is intentionally NOT a gate: a user can complete a set
 * (✓-tap → is_logged=1) and we surface it immediately, even mid-session.
 */

import type { Database } from '../../db/types';
import type { LoadType } from '../../domain/exercise/types';
import type { BucketKey } from '../../domain/pr/types';
import { BUCKETS, classifyBucket } from '../../domain/pr/buckets';
import type { RepBucketChip } from '../../domain/exercise/repBucketFilter';
import type { SetKind } from '../../domain/set/setLabels';

/** One row per set; fields needed by PR / Volume engines + UI display. */
interface ExerciseHistorySet {
  set_id: string;
  session_id: string;
  session_started_at: number;
  session_ended_at: number | null;
  bw_snapshot_kg: number | null;
  weight_kg: number | null;
  reps: number | null;
  ordering: number;
  /**
   * v025 (slice 13d 2026-06-02, #1/#2) — Watch display rank. The RENDER sort
   * key for the per-session history card: a Watch reorder / mid-insert moves
   * this while identity stays `ordering`. NULL for iPhone-authored / legacy
   * rows → the consumer falls back to `display_rank ?? ordering`. See
   * `computeSessionSetLayout` / `computeHistorySetLabels`.
   */
  display_rank: number | null;
  created_at: number;
  load_type: LoadType;
  /**
   * v015 lifecycle column — 'warmup' | 'working' | 'dropset'. Slice 10c
   * overnight #22: surfaced to history rows so the expanded session card
   * can render per-row labels (熱 / 1 / 2 / D1 …) via
   * `computeHistorySetLabels`. (Previously the column was unused by this
   * query path and the type for the parallel `ExerciseHistoryRow` shape
   * still pegs it to `null` — only `ExerciseHistorySet` carries the real
   * enum today.)
   */
  set_kind: SetKind;
  /**
   * v015 lifecycle column — dropset followers reference their head's
   * `set.id`; `null` for cluster heads / warmup / working rows. Slice 10c
   * overnight #22 surfaces it so future dropset-chain rendering can find
   * the head without an extra query.
   */
  parent_set_id: string | null;
  /**
   * True iff the originating `session_exercise` belongs to a cluster (slice 10c).
   * Drives the 3-段 cluster filter on the timeline list — see
   * `domain/exercise/clusterFilter.ts`.
   */
  is_in_cluster: boolean;
  /**
   * The cluster partner's `exercise_id` if this set's `session_exercise`
   * belongs to a cluster, NULL otherwise (solo row).
   *
   * - A side (this `session_exercise` is the parent): partner = its child's `exercise_id`
   * - B side (this `session_exercise.parent_id != NULL`): partner = parent's `exercise_id`
   * - solo: NULL
   *
   * Surfaced 2026-05-21 wave 14 to gate the「↻ 再次訓練」button on
   * source/target shape compatibility (solo→solo / cluster→same-partner cluster).
   * Source row with a different partner means the cluster replay helper
   * wouldn't find a B-side source row anyway — pre-emptive UI gate avoids
   * the「找不到該超級組 B 側來源卡」alert.
   */
  cluster_partner_exercise_id: string | null;
}

/**
 * Single grouping unit by Session, used by the timeline list on
 * the Exercise History page.
 */
export interface ExerciseHistorySession {
  session_id: string;
  session_started_at: number;
  session_ended_at: number | null;
  bw_snapshot_kg: number | null;
  /** session.template_id may be NULL (自由 session). */
  template_id: string | null;
  /** template.program_id may be NULL (自由 template or no template). */
  program_id: string | null;
  /** template.sub_tag may be NULL. */
  sub_tag: string | null;
  sets: ExerciseHistorySet[];
}

export interface ExerciseHistoryHeader {
  exercise_id: string;
  exercise_name: string;
  load_type: LoadType;
  total_sessions: number;
  /** Sessions in last 7 days (started_at >= now - 7*24h) */
  sessions_last_7_days: number;
}

/**
 * All performed sets for one exercise, joined with session metadata.
 * Order: latest set first (created_at DESC).
 */
export async function listExerciseHistorySets(
  db: Database,
  exercise_id: string
): Promise<ExerciseHistorySet[]> {
  type Row = Omit<ExerciseHistorySet, 'is_in_cluster' | 'set_kind'> & {
    is_in_cluster: number;
    // v015 column — sqlite returns the raw string 'warmup' | 'working' | 'dropset'.
    set_kind: SetKind;
  };
  const rows = await db.getAllAsync<Row>(
    `SELECT s.id           AS set_id,
            s.session_id   AS session_id,
            ss.started_at  AS session_started_at,
            ss.ended_at    AS session_ended_at,
            ss.bodyweight_snapshot_kg AS bw_snapshot_kg,
            s.weight_kg    AS weight_kg,
            s.reps         AS reps,
            s.ordering     AS ordering,
            s.display_rank AS display_rank,
            s.created_at   AS created_at,
            e.load_type    AS load_type,
            s.set_kind     AS set_kind,
            s.parent_set_id AS parent_set_id,
            CASE
              WHEN se.parent_id IS NOT NULL THEN 1
              WHEN EXISTS (
                SELECT 1 FROM session_exercise se2
                 WHERE se2.parent_id = se.id
              ) THEN 1
              ELSE 0
            END AS is_in_cluster,
            CASE
              WHEN se.parent_id IS NOT NULL THEN (
                SELECT seP.exercise_id FROM session_exercise seP
                 WHERE seP.id = se.parent_id
              )
              ELSE (
                SELECT seC.exercise_id FROM session_exercise seC
                 WHERE seC.parent_id = se.id
                 LIMIT 1
              )
            END AS cluster_partner_exercise_id
       FROM "set" s
       JOIN session ss ON ss.id = s.session_id
       JOIN exercise e ON e.id = s.exercise_id
       LEFT JOIN session_exercise se
         ON (se.id = s.session_exercise_id)
         OR (s.session_exercise_id IS NULL
             AND se.session_id = s.session_id
             AND se.exercise_id = s.exercise_id)
      WHERE s.exercise_id = ?
        AND s.is_skipped = 0
        AND s.is_logged = 1
      ORDER BY s.created_at DESC, s.id DESC`,
    exercise_id
  );
  return rows.map((r) => ({ ...r, is_in_cluster: r.is_in_cluster === 1 }));
}

/**
 * PR-input row for the Today-screen PR snapshot. `weight_kg`/`reps` feed
 * `computePRSnapshot`; `set_kind` + `bw_snapshot_kg` let the caller drop
 * non-working sets and apply the assisted `effectiveLoad` (assist → strength)
 * BEFORE the Pareto/max comparison, matching the per-exercise history page
 * (`historyPrSnapshot.computePRs`). Without that an assisted lift surfaces its
 * most-assisted (easiest) set as the "heaviest PR" (2026-06-25 audit 🟠).
 */
export interface ExercisePRSetRow {
  weight_kg: number | null;
  reps: number | null;
  /** Working / warmup / dropset — the caller keeps only `working`. */
  set_kind: SetKind;
  /** This set's session bodyweight snapshot (assisted effectiveLoad input). */
  bw_snapshot_kg: number | null;
}

/**
 * Lean PR-input query for the Today-screen PR snapshot (perf #2, scale audit
 * 2026-06-17 report 08). `computePRSnapshot` only reads `weight_kg` + `reps`,
 * so this returns JUST those two columns and drops everything
 * `listExerciseHistorySets` carries for the history UI: the cluster
 * `CASE … is_in_cluster` / `cluster_partner_exercise_id` correlated
 * subqueries, the `session` / `session_exercise` JOINs, and the
 * `ORDER BY created_at DESC` (PR math is order-independent — Pareto frontier +
 * max are commutative). At scale this turns a ~32 ms/exercise query
 * (uncovered `SCAN se2` + `TEMP B-TREE` sort) into a plain
 * `idx_set_exercise` range scan.
 *
 * **Row-set invariant (behaviour-preserving)**: the WHERE clause is BYTE-FOR-
 * BYTE the same predicate `listExerciseHistorySets` applies —
 * `exercise_id = ? AND is_skipped = 0 AND is_logged = 1`. That means the SAME
 * multiset of rows reaches `computePRSnapshot`:
 *   - warmups: NOT excluded by the WHERE (and weren't by the old path either);
 *     the equivalence proof still feeds them. (The Today *caller* now drops
 *     `set_kind != 'working'` in JS — see below.)
 *   - dropset FOLLOWERS: already excluded by `is_logged = 1` — a follower's DB
 *     `is_logged` stays 0 (UI toggles the head only; see dropset-chain-semantics
 *     skill DB invariant #2), so neither path includes them.
 * No WHERE/ORDER BY change can alter which rows count toward a PR; the proof is
 * `tests/db/exercisePRSetRows.equivalence.test.ts`.
 *
 * **2026-06-25 (audit 🟠)**: the SELECT now ALSO returns `set_kind` +
 * `bw_snapshot_kg` (one PK JOIN onto `session`, cheap — not the correlated
 * cluster subqueries the perf work removed). The WHERE is unchanged, so the
 * equivalence test holds. The new columns let `loadTrainingTabState` filter to
 * working sets and apply `effectiveLoad` for assisted lifts BEFORE the Pareto
 * comparison, so the Today card no longer surfaces the most-assisted set as the
 * "heaviest PR" and now agrees with `historyPrSnapshot.computePRs`.
 */
export async function listExercisePRSetRows(
  db: Database,
  exercise_id: string
): Promise<ExercisePRSetRow[]> {
  return db.getAllAsync<ExercisePRSetRow>(
    `SELECT s.weight_kg AS weight_kg,
            s.reps      AS reps,
            s.set_kind  AS set_kind,
            ss.bodyweight_snapshot_kg AS bw_snapshot_kg
       FROM "set" s
       JOIN session ss ON ss.id = s.session_id
      WHERE s.exercise_id = ?
        AND s.is_skipped = 0
        AND s.is_logged = 1`,
    exercise_id
  );
}

/**
 * Same data, regrouped per Session (session DESC, sets within session ASC).
 * Each session row carries its bw snapshot once for assisted-class display.
 */
type HistorySetWithSessionMeta = ExerciseHistorySet & {
  template_id: string | null;
  program_id: string | null;
  sub_tag: string | null;
};

export async function listExerciseHistoryBySession(
  db: Database,
  exercise_id: string
): Promise<ExerciseHistorySession[]> {
  type RawRow = Omit<HistorySetWithSessionMeta, 'is_in_cluster' | 'set_kind'> & {
    is_in_cluster: number;
    set_kind: SetKind;
  };
  const rows = await db.getAllAsync<RawRow>(
    `SELECT s.id           AS set_id,
            s.session_id   AS session_id,
            ss.started_at  AS session_started_at,
            ss.ended_at    AS session_ended_at,
            ss.bodyweight_snapshot_kg AS bw_snapshot_kg,
            s.weight_kg    AS weight_kg,
            s.reps         AS reps,
            s.ordering     AS ordering,
            s.display_rank AS display_rank,
            s.created_at   AS created_at,
            e.load_type    AS load_type,
            s.set_kind     AS set_kind,
            s.parent_set_id AS parent_set_id,
            se.template_id AS template_id,
            t.program_id   AS program_id,
            t.sub_tag      AS sub_tag,
            CASE
              WHEN se.parent_id IS NOT NULL THEN 1
              WHEN EXISTS (
                SELECT 1 FROM session_exercise se2
                 WHERE se2.parent_id = se.id
              ) THEN 1
              ELSE 0
            END AS is_in_cluster,
            CASE
              WHEN se.parent_id IS NOT NULL THEN (
                SELECT seP.exercise_id FROM session_exercise seP
                 WHERE seP.id = se.parent_id
              )
              ELSE (
                SELECT seC.exercise_id FROM session_exercise seC
                 WHERE seC.parent_id = se.id
                 LIMIT 1
              )
            END AS cluster_partner_exercise_id
       FROM "set" s
       JOIN session ss ON ss.id = s.session_id
       JOIN exercise e ON e.id = s.exercise_id
       LEFT JOIN session_exercise se
         ON (se.id = s.session_exercise_id)
         OR (s.session_exercise_id IS NULL
             AND se.session_id = s.session_id
             AND se.exercise_id = s.exercise_id)
       LEFT JOIN template t ON t.id = se.template_id
      WHERE s.exercise_id = ?
        AND s.is_skipped = 0
        AND s.is_logged = 1
      ORDER BY ss.started_at DESC, s.ordering ASC`,
    exercise_id
  );

  const grouped = new Map<string, ExerciseHistorySession>();
  const order: string[] = [];

  for (const r of rows) {
    let sess = grouped.get(r.session_id);
    if (!sess) {
      sess = {
        session_id: r.session_id,
        session_started_at: r.session_started_at,
        session_ended_at: r.session_ended_at,
        bw_snapshot_kg: r.bw_snapshot_kg,
        template_id: r.template_id,
        program_id: r.program_id,
        sub_tag: r.sub_tag,
        sets: [],
      };
      grouped.set(r.session_id, sess);
      order.push(r.session_id);
    }
    // Strip JOIN-only columns from the set row before pushing; coerce
    // SQLite 0/1 to boolean for is_in_cluster.
    const { template_id, program_id, sub_tag, is_in_cluster, ...rest } = r;
    sess.sets.push({ ...rest, is_in_cluster: is_in_cluster === 1 });
  }

  return order.map((id) => grouped.get(id)!);
}

/**
 * List Programs that have at least one done set of `exercise_id`. Used to
 * populate the 進階篩選 Program dropdown (ADR-0017 Q14 amendment).
 */
export async function listProgramsForExercise(
  db: Database,
  exercise_id: string
): Promise<{ id: string; name: string }[]> {
  return db.getAllAsync<{ id: string; name: string }>(
    `SELECT DISTINCT p.id AS id, p.name AS name
       FROM "set" s
       JOIN session_exercise se
         ON se.session_id = s.session_id
        AND se.exercise_id = s.exercise_id
       JOIN template t ON t.id = se.template_id
       JOIN program p  ON p.id = t.program_id
      WHERE s.exercise_id = ?
        AND s.is_skipped = 0
        AND s.is_logged = 1
      ORDER BY p.name ASC`,
    exercise_id
  );
}

/**
 * Header stats for the page top: name, total sessions performing this exercise,
 * sessions in last 7 days.
 */
export async function getExerciseHistoryHeader(
  db: Database,
  exercise_id: string,
  now: () => number = Date.now
): Promise<ExerciseHistoryHeader | null> {
  const ex = await db.getFirstAsync<{
    id: string;
    name: string;
    load_type: LoadType;
  }>(`SELECT id, name, load_type FROM exercise WHERE id = ?`, exercise_id);
  if (!ex) return null;

  const totalRow = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(DISTINCT session_id) AS n
       FROM "set"
      WHERE exercise_id = ? AND is_skipped = 0 AND is_logged = 1`,
    exercise_id
  );

  const cutoff = now() - 7 * 24 * 60 * 60 * 1000;
  const recentRow = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(DISTINCT s.session_id) AS n
       FROM "set" s
       JOIN session ss ON ss.id = s.session_id
      WHERE s.exercise_id = ?
        AND s.is_skipped = 0
        AND s.is_logged = 1
        AND ss.started_at >= ?`,
    exercise_id,
    cutoff
  );

  return {
    exercise_id: ex.id,
    exercise_name: ex.name,
    load_type: ex.load_type,
    total_sessions: totalRow?.n ?? 0,
    sessions_last_7_days: recentRow?.n ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Slice 9.8c — data layer for the per-Exercise / per-Reusable-Superset
// 詳情頁 歷史頁 (Exercise + Reusable Superset detail page 「歷史」 sub-tab).
//
// Function A: queryExerciseHistory(db, exerciseId, options?)
// Function B: queryReusableSupersetHistory(db, rsId, options?)
//
// SCHEMA CONTEXT (load-bearing):
//   - `set.set_kind` (warmup / working / dropset) + `set.parent_set_id` landed
//     via v015 (2026-05-16). Both are available on the session-side `set`
//     table. queryExerciseHistory exposes the real `set_kind` value;
//     listPriorSetsForExercise additionally filters `s.set_kind = 'working'`
//     per ADR-0012 line 100/173 (整 cluster 跳過 PR、含 parent root step)
//     so warmup + dropset cluster rows never reach the PR engine.
//   - `reusable_superset_id` is still template-side only. Function B joins
//     `set` → `session_exercise` → `template_exercise` to scope to a reusable
//     superset. Freestyle sessions and blank/no-template sessions can never
//     be scoped to a reusable superset.
// ---------------------------------------------------------------------------

/** Filter chip values matching `RepBucketChip`. `'all'` widens to every set. */
type ExerciseHistoryBucketFilter = RepBucketChip;

interface QueryExerciseHistoryOptions {
  /** `'all'` (default) or one of the 5 `BucketKey`s. */
  repBucket?: ExerciseHistoryBucketFilter;
  /** Max rows to return; defaults to 200. Use `Number.POSITIVE_INFINITY` for unbounded (NOT recommended). */
  limit?: number;
  /** Offset for pagination; defaults to 0. */
  offset?: number;
}

/**
 * One row in the per-exercise history view. Newest first.
 *
 * `set_kind` is the v015 column ('warmup' | 'working' | 'dropset'); UI can use
 * it to colour-code or fold cluster steps per ADR-0012 line 175 (history modal
 * GROUP BY parent_set_id + e1RM trend skips dropset cluster).
 *
 * `rep_bucket` is derived from `reps` via the same provider used by PR
 * engine (`classifyBucket`). May be `null` for invalid / null reps.
 */
interface ExerciseHistoryRow {
  session_id: string;
  /** session.started_at — unix ms; the "date" the work was performed. */
  session_started_at: number;
  set_id: string;
  reps: number | null;
  weight_kg: number | null;
  /** v015 column: 'warmup' | 'working' | 'dropset'. */
  set_kind: SetKind;
  /** Domain-bucket key — `'max_strength' | 'strength' | 'hypertrophy' | 'muscle_endurance' | 'endurance' | null`. */
  rep_bucket: BucketKey | null;
  /** ordering within the session (1-based for ASC display, but caller is free to ignore). */
  ordering: number;
  /** Convenience: load_type joined from exercise row, for downstream volume / e1rm math. */
  load_type: LoadType;
  /** session.bodyweight_snapshot_kg — null when unset. */
  bw_snapshot_kg: number | null;
  /**
   * True iff the originating `session_exercise` belongs to a cluster (A side =
   * parent of another se row in the same session, OR B side = `parent_id` set).
   * Drives the 3-段 cluster filter on the history / chart pages (slice 10c —
   * see `domain/exercise/clusterFilter.ts`).
   */
  is_in_cluster: boolean;
}

const DEFAULT_LIMIT = 200;

/**
 * Compose the WHERE/AND `reps BETWEEN` clause for a bucket filter.
 * Returns `{ sql: '', params: [] }` when filter is `'all'`.
 *
 * Inclusive both ends; top bucket (`endurance`, min=16, max=null) becomes
 * `reps >= 16`.
 */
function bucketWhereFragment(
  filter: ExerciseHistoryBucketFilter
): { sql: string; params: number[] } {
  if (filter === 'all') return { sql: '', params: [] };
  const b = BUCKETS.find((x) => x.key === filter);
  if (!b) return { sql: '', params: [] };
  if (b.max == null) {
    return { sql: ' AND s.reps >= ?', params: [b.min] };
  }
  return { sql: ' AND s.reps BETWEEN ? AND ?', params: [b.min, b.max] };
}

/**
 * Function A — per-exercise completed-set history, newest first, paginated.
 *
 * Spec (Slice 9.8c overnight, derived from ADR-0017 Q14 + CONTEXT L324):
 *   - JOIN `set` + `session` + `exercise` (need load_type + bw snapshot)
 *   - Exclude `is_skipped = 1` rows (matches every other history query in
 *     this file)
 *   - Newest first: ORDER BY session.started_at DESC, set.ordering ASC
 *   - rep_bucket derived from reps using BUCKETS provider
 *   - Bucket filter narrows in-SQL (no client-side post-filter) so LIMIT/OFFSET
 *     pagination is correct
 *
 * @example
 *   const recent = await queryExerciseHistory(db, benchId);          // all, newest 200
 *   const power  = await queryExerciseHistory(db, benchId, {         // 1-3 rep sets only
 *     repBucket: 'max_strength',
 *     limit: 50,
 *   });
 */
export async function queryExerciseHistory(
  db: Database,
  exerciseId: string,
  options: QueryExerciseHistoryOptions = {}
): Promise<ExerciseHistoryRow[]> {
  const filter: ExerciseHistoryBucketFilter = options.repBucket ?? 'all';
  const limit = options.limit ?? DEFAULT_LIMIT;
  const offset = options.offset ?? 0;
  const bucket = bucketWhereFragment(filter);

  type Row = {
    set_id: string;
    session_id: string;
    session_started_at: number;
    reps: number | null;
    weight_kg: number | null;
    set_kind: SetKind;
    ordering: number;
    load_type: LoadType;
    bw_snapshot_kg: number | null;
    /** 0 / 1 from SQLite — coerced to boolean below. */
    is_in_cluster: number;
  };

  // is_in_cluster: cluster B (parent_id != NULL) OR cluster A (this se's id
  // is referenced by another se's parent_id within the same session). The
  // LEFT JOIN matches on `set.session_exercise_id` first (v019+, supports
  // multiple `(session_id, exercise_id)` cards) — see slice 10c #24.
  const rows = await db.getAllAsync<Row>(
    `SELECT s.id           AS set_id,
            s.session_id   AS session_id,
            ss.started_at  AS session_started_at,
            s.reps         AS reps,
            s.weight_kg    AS weight_kg,
            s.set_kind     AS set_kind,
            s.ordering     AS ordering,
            e.load_type    AS load_type,
            ss.bodyweight_snapshot_kg AS bw_snapshot_kg,
            CASE
              WHEN se.parent_id IS NOT NULL THEN 1
              WHEN EXISTS (
                SELECT 1 FROM session_exercise se2
                 WHERE se2.parent_id = se.id
              ) THEN 1
              ELSE 0
            END AS is_in_cluster
       FROM "set" s
       JOIN session ss ON ss.id = s.session_id
       JOIN exercise e ON e.id = s.exercise_id
       LEFT JOIN session_exercise se
         ON (se.id = s.session_exercise_id)
         OR (s.session_exercise_id IS NULL
             AND se.session_id = s.session_id
             AND se.exercise_id = s.exercise_id)
      WHERE s.exercise_id = ?
        AND s.is_skipped = 0
        AND s.is_logged = 1${bucket.sql}
      ORDER BY ss.started_at DESC, s.ordering ASC, s.id ASC
      LIMIT ? OFFSET ?`,
    exerciseId,
    ...bucket.params,
    limit,
    offset
  );

  return rows.map((r) => ({
    session_id: r.session_id,
    session_started_at: r.session_started_at,
    set_id: r.set_id,
    reps: r.reps,
    weight_kg: r.weight_kg,
    set_kind: r.set_kind,
    rep_bucket: classifyBucket(r.reps),
    ordering: r.ordering,
    load_type: r.load_type,
    bw_snapshot_kg: r.bw_snapshot_kg,
    is_in_cluster: r.is_in_cluster === 1,
  }));
}

/**
 * Does this exercise ever appear in a cluster (A side or B side) across all
 * sessions? Used by the history / chart UI to decide whether to render the
 * 3-段 cluster filter segmented control — if false, all bars would be identical
 * so the control is hidden.
 *
 * Slice 10c — replaces the standalone `/superset-history/[id]` route. Cheap
 * EXISTS query; no need to cache. Returns false for unknown exercise_id.
 */
export async function hasClusterHistory(
  db: Database,
  exerciseId: string
): Promise<boolean> {
  const row = await db.getFirstAsync<{ flag: number }>(
    `SELECT EXISTS (
       SELECT 1
         FROM session_exercise se
        WHERE se.exercise_id = ?
          AND (
            se.parent_id IS NOT NULL
            OR EXISTS (
              SELECT 1 FROM session_exercise se2
               WHERE se2.parent_id = se.id
            )
          )
     ) AS flag`,
    exerciseId
  );
  return (row?.flag ?? 0) === 1;
}

// ---------------------------------------------------------------------------
// Function B — Reusable Superset cluster history
//
// SCHEMA GAP (see overnight report 02-9.8c-data-layer.md):
//   v013 added `template_exercise.reusable_superset_id` (planning side) but
//   the session-side `set` / `session_exercise` tables were NOT touched. To
//   associate a recorded set with the reusable superset it was performed
//   under, we must JOIN through the template snapshot:
//
//       set
//        └─ session_exercise (session_id + exercise_id → template_id)
//             └─ template_exercise (template_id + exercise_id
//                                    + reusable_superset_id = ?)
//
//   This works for sessions started from a Template that contained the
//   exploded cluster. It does NOT cover:
//     - freestyle sessions (session_exercise.template_id IS NULL)
//     - sessions started from a template that didn't contain the cluster
//     - data corruption (template_exercise deleted but session_exercise stale)
//
//   A future v014 migration could ADD `session_exercise.reusable_superset_id`
//   (and `parent_id`) to remove this indirection — flagged in the report.
//
// CLUSTER PAIRING:
//   A reusable superset always explodes into exactly 2 template_exercise
//   rows in its source template (one with parent_id IS NULL = position 0,
//   one with parent_id = parentRow.id = position 1). We look up which two
//   exercise_ids belong to the superset via `superset_exercise` (position
//   0 = "A", position 1 = "B"), then for each session that recorded sets
//   for BOTH exercises, emit a paired row.
//
// REP BUCKET FILTER on Reusable Superset (genuine ambiguity — see report):
//   Spec L36 was open: "filter when EITHER side falls in the bucket".
//   Decision adopted: **at least one of the two sides has at least one set
//   in the bucket** → keep the pairing. Rationale: a cluster's identity is
//   "both done in the same session"; if filter wipes one side entirely but
//   leaves the other, dropping the pair forces the user to clear the chip
//   to see the asymmetric session — losing data.
// ---------------------------------------------------------------------------

/**
 * Same shape as {@link QueryExerciseHistoryOptions} today — kept as its own
 * type alias so Function B's signature can evolve independently if v014
 * adds rs-id-specific filters (e.g. "cluster intent only").
 */
type QueryReusableSupersetHistoryOptions = QueryExerciseHistoryOptions;

/** One side of a reusable-superset cluster pairing within a single session. */
interface ReusableSupersetSide {
  /** position in the reusable superset's slot table — 0 = "A", 1 = "B". */
  position: 0 | 1;
  exercise_id: string;
  exercise_name: string;
  load_type: LoadType;
  /** All non-skipped sets for this side in the session, ordering ASC. */
  sets: ExerciseHistoryRow[];
}

/** One session's pairing — both A and B sides if both were performed. */
interface ReusableSupersetHistoryRow {
  session_id: string;
  /** session.started_at — unix ms. */
  session_started_at: number;
  bw_snapshot_kg: number | null;
  /** Exactly 2 entries, position 0 then position 1. */
  sides: [ReusableSupersetSide, ReusableSupersetSide];
}

/**
 * Function B — Reusable Superset cluster history, newest first, paginated.
 *
 * Returns one entry per Session that recorded sets for BOTH sides of the
 * superset (via the template-snapshot indirection — see schema gap note
 * above). Sessions where only one side was performed are dropped — they
 * are not "cluster instances" by definition.
 *
 * The `repBucket` filter applies on a per-side basis: a session is kept
 * if AT LEAST ONE side has at least one set falling in the bucket.
 * (Spec ambiguity resolved — see header note.)
 *
 * @example
 *   const all = await queryReusableSupersetHistory(db, rsId);
 *   // all[0].sides[0] = A-side history within most recent paired session
 *   // all[0].sides[1] = B-side history within the same session
 */
export async function queryReusableSupersetHistory(
  db: Database,
  reusableSupersetId: string,
  options: QueryReusableSupersetHistoryOptions = {}
): Promise<ReusableSupersetHistoryRow[]> {
  const filter: ExerciseHistoryBucketFilter = options.repBucket ?? 'all';
  const limit = options.limit ?? DEFAULT_LIMIT;
  const offset = options.offset ?? 0;

  // Step 1: resolve which 2 exercise_ids the superset comprises (position-ordered).
  const slots = await db.getAllAsync<{
    position: number;
    exercise_id: string;
    name: string;
    load_type: LoadType;
  }>(
    `SELECT se.position, se.exercise_id, e.name, e.load_type
       FROM superset_exercise se
       JOIN exercise e ON e.id = se.exercise_id
      WHERE se.superset_id = ?
      ORDER BY se.position ASC`,
    reusableSupersetId
  );

  // Defensive: if not exactly 2 slots, the superset is corrupted (UI prevents
  // creation outside size=2). Treat as empty history rather than throwing —
  // matches the "data quality" tolerance noted in supersetRepository.ts L91.
  if (slots.length !== 2) return [];
  const [slotA, slotB] = slots;

  // Step 2: pull every (non-skipped) set whose session is associated with this
  //         reusable superset via TWO paths (ADR-0018 v014 augment with fallback):
  //
  //         Primary (post-v014 + β' backfilled):
  //           session_exercise.reusable_superset_id = ?  (direct query)
  //
  //         Fallback (β'-skipped ambiguous template sessions, or pre-v014
  //         data that wasn't backfilled):
  //           session_exercise.reusable_superset_id IS NULL
  //             AND session_exercise.template_id IS NOT NULL
  //             JOIN template_exercise WHERE reusable_superset_id = ?
  //
  //         The two paths are mutually exclusive on `se.reusable_superset_id`
  //         (NOT NULL vs IS NULL), so UNION ALL cannot duplicate. The fallback
  //         survives in one read function only; new sessions never produce
  //         NULL rs_id with non-NULL template_id (snapshotForSession copies
  //         rs_id through), so the fallback path naturally decays.
  type RawRow = {
    set_id: string;
    session_id: string;
    session_started_at: number;
    bw_snapshot_kg: number | null;
    reps: number | null;
    weight_kg: number | null;
    set_kind: SetKind;
    ordering: number;
    exercise_id: string;
    load_type: LoadType;
  };

  const rawRows = await db.getAllAsync<RawRow>(
    `SELECT set_id, session_id, session_started_at, bw_snapshot_kg,
            reps, weight_kg, set_kind, ordering, exercise_id, load_type
       FROM (
         -- Primary path: session_exercise.reusable_superset_id direct query
         SELECT DISTINCT
                s.id           AS set_id,
                s.session_id   AS session_id,
                ss.started_at  AS session_started_at,
                ss.bodyweight_snapshot_kg AS bw_snapshot_kg,
                s.reps         AS reps,
                s.weight_kg    AS weight_kg,
                s.set_kind     AS set_kind,
                s.ordering     AS ordering,
                s.exercise_id  AS exercise_id,
                e.load_type    AS load_type
           FROM "set" s
           JOIN session ss          ON ss.id = s.session_id
           JOIN exercise e          ON e.id  = s.exercise_id
           JOIN session_exercise se ON se.session_id  = s.session_id
                                   AND se.exercise_id = s.exercise_id
          WHERE se.reusable_superset_id = ?
            AND s.is_skipped = 0
            AND s.is_logged = 1
            AND s.exercise_id IN (?, ?)

         UNION ALL

         -- Fallback path: indirection through template_exercise for sessions
         -- where backfill was skipped (β' ambiguous templates) or pre-v014
         -- data that didn't run backfill.
         SELECT DISTINCT
                s.id           AS set_id,
                s.session_id   AS session_id,
                ss.started_at  AS session_started_at,
                ss.bodyweight_snapshot_kg AS bw_snapshot_kg,
                s.reps         AS reps,
                s.weight_kg    AS weight_kg,
                s.set_kind     AS set_kind,
                s.ordering     AS ordering,
                s.exercise_id  AS exercise_id,
                e.load_type    AS load_type
           FROM "set" s
           JOIN session ss          ON ss.id = s.session_id
           JOIN exercise e          ON e.id  = s.exercise_id
           JOIN session_exercise se ON se.session_id  = s.session_id
                                   AND se.exercise_id = s.exercise_id
           JOIN template_exercise te ON te.template_id = se.template_id
                                    AND te.exercise_id = s.exercise_id
          WHERE se.reusable_superset_id IS NULL
            AND se.template_id IS NOT NULL
            AND te.reusable_superset_id = ?
            AND s.is_skipped = 0
            AND s.is_logged = 1
            AND s.exercise_id IN (?, ?)
       )
      ORDER BY session_started_at DESC, ordering ASC, set_id ASC`,
    reusableSupersetId,
    slotA.exercise_id,
    slotB.exercise_id,
    reusableSupersetId,
    slotA.exercise_id,
    slotB.exercise_id
  );

  // Step 3: group by session_id, partition by exercise_id, keep only sessions
  //         where BOTH sides had at least one set.
  interface Bucket {
    session_id: string;
    session_started_at: number;
    bw_snapshot_kg: number | null;
    sideA: ExerciseHistoryRow[];
    sideB: ExerciseHistoryRow[];
  }
  const bySession = new Map<string, Bucket>();
  const order: string[] = [];

  for (const r of rawRows) {
    let b = bySession.get(r.session_id);
    if (!b) {
      b = {
        session_id: r.session_id,
        session_started_at: r.session_started_at,
        bw_snapshot_kg: r.bw_snapshot_kg,
        sideA: [],
        sideB: [],
      };
      bySession.set(r.session_id, b);
      order.push(r.session_id);
    }
    const setRow: ExerciseHistoryRow = {
      session_id: r.session_id,
      session_started_at: r.session_started_at,
      set_id: r.set_id,
      reps: r.reps,
      weight_kg: r.weight_kg,
      set_kind: r.set_kind,
      rep_bucket: classifyBucket(r.reps),
      ordering: r.ordering,
      load_type: r.load_type,
      bw_snapshot_kg: r.bw_snapshot_kg,
      // Function B is invoked from a reusable-superset surface — every row it
      // returns is by definition in a cluster. (The deprecated `/superset-*`
      // routes are the only callers; slice 10c step 5 deletes them.)
      is_in_cluster: true,
    };
    if (r.exercise_id === slotA.exercise_id) b.sideA.push(setRow);
    else if (r.exercise_id === slotB.exercise_id) b.sideB.push(setRow);
  }

  const pairedSessions = order
    .map((id) => bySession.get(id)!)
    .filter((b) => b.sideA.length > 0 && b.sideB.length > 0);

  // Step 4: apply rep bucket filter — keep the pair if EITHER side has at
  //         least one matching set.
  const bucketMatches = (rows: ExerciseHistoryRow[]): boolean => {
    if (filter === 'all') return true;
    return rows.some((r) => r.rep_bucket === filter);
  };

  const filtered = pairedSessions.filter(
    (b) => bucketMatches(b.sideA) || bucketMatches(b.sideB)
  );

  // Step 5: pagination — already newest first (rawRows ORDER BY).
  const page = filtered.slice(offset, offset + limit);

  // Step 6: shape output.
  return page.map((b) => ({
    session_id: b.session_id,
    session_started_at: b.session_started_at,
    bw_snapshot_kg: b.bw_snapshot_kg,
    sides: [
      {
        position: 0,
        exercise_id: slotA.exercise_id,
        exercise_name: slotA.name,
        load_type: slotA.load_type,
        sets: b.sideA,
      },
      {
        position: 1,
        exercise_id: slotB.exercise_id,
        exercise_name: slotB.name,
        load_type: slotB.load_type,
        sets: b.sideB,
      },
    ],
  }));
}

/**
 * Helper: list prior-set rows for the SAME (exercise_id) BEFORE a cutoff
 * timestamp, restricted to `set_kind = 'working'` (per ADR-0012 line 100/173:
 * warmup sets + entire dropset cluster including parent root step are
 * excluded from PR engine input). Used by the PR-chip-on-save flow to ask
 * "given this set was just inserted, what PR did it break?". Caller passes
 * new set's created_at as cutoff (exclusive).
 */
export async function listPriorSetsForExercise(
  db: Database,
  exercise_id: string,
  before_created_at: number
): Promise<ExerciseHistorySet[]> {
  type Row = Omit<ExerciseHistorySet, 'is_in_cluster'> & {
    is_in_cluster: number;
  };
  const rows = await db.getAllAsync<Row>(
    `SELECT s.id           AS set_id,
            s.session_id   AS session_id,
            ss.started_at  AS session_started_at,
            ss.ended_at    AS session_ended_at,
            ss.bodyweight_snapshot_kg AS bw_snapshot_kg,
            s.weight_kg    AS weight_kg,
            s.reps         AS reps,
            s.ordering     AS ordering,
            s.display_rank AS display_rank,
            s.created_at   AS created_at,
            e.load_type    AS load_type,
            s.set_kind     AS set_kind,
            s.parent_set_id AS parent_set_id,
            CASE
              WHEN se.parent_id IS NOT NULL THEN 1
              WHEN EXISTS (
                SELECT 1 FROM session_exercise se2
                 WHERE se2.parent_id = se.id
              ) THEN 1
              ELSE 0
            END AS is_in_cluster,
            CASE
              WHEN se.parent_id IS NOT NULL THEN (
                SELECT seP.exercise_id FROM session_exercise seP
                 WHERE seP.id = se.parent_id
              )
              ELSE (
                SELECT seC.exercise_id FROM session_exercise seC
                 WHERE seC.parent_id = se.id
                 LIMIT 1
              )
            END AS cluster_partner_exercise_id
       FROM "set" s
       JOIN session ss ON ss.id = s.session_id
       JOIN exercise e ON e.id = s.exercise_id
       LEFT JOIN session_exercise se
         ON (se.id = s.session_exercise_id)
         OR (s.session_exercise_id IS NULL
             AND se.session_id = s.session_id
             AND se.exercise_id = s.exercise_id)
      WHERE s.exercise_id = ?
        AND s.is_skipped = 0
        AND s.is_logged = 1
        AND s.set_kind = 'working'
        AND s.created_at < ?
      ORDER BY s.created_at DESC, s.id DESC`,
    exercise_id,
    before_created_at
  );
  return rows.map((r) => ({ ...r, is_in_cluster: r.is_in_cluster === 1 }));
}
