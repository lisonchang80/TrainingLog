import type { Database } from '../../db/types';
import type { Session } from '../../domain/session/types';
import { editSnapshotKey } from '../../domain/session/editSnapshotPersistence';
import { listBodyMetrics } from './bodyMetricRepository';
import { getReusableSupersetWithExercises } from './supersetRepository';

/**
 * Resolve the bodyweight snapshot for a new Session per ADR-0024 § 4:
 * "session 開始時 system 自動 snapshot 的 latest body_metric, 無時效性限制".
 *
 * Implementation note: `listBodyMetrics` returns rows in `recorded_at ASC`
 * order (tuned for the body-trend chart consumer), so "latest" is `.at(-1)`,
 * NOT `.at(0)` as the ADR pseudocode reads. ADR doc follow-up flagged.
 *
 * Returns null when the user has no body_metric on record — the assisted
 * modal (ADR-0024 § 4 補丁) handles the blocking case in the UI layer.
 */
async function resolveBwSnapshot(db: Database): Promise<number | null> {
  const rows = await listBodyMetrics(db);
  return rows.at(-1)?.bodyweight_kg ?? null;
}

export async function createSession(
  db: Database,
  args: {
    id: string;
    started_at: number;
    bodyweight_snapshot_kg?: number | null;
    /**
     * Card 11 / ADR-0014. Optional display title; defaults to '' which the UI
     * renders as the freestyle placeholder. `startSessionFromTemplate` passes
     * `template.name` so template-based sessions arrive pre-named.
     */
    title?: string;
  }
): Promise<void> {
  // ADR-0024 § 4 — if the caller didn't supply a snapshot explicitly, pull
  // the latest body_metric. Passing an explicit `null` (or any number) wins
  // over auto-pull so test fixtures and migrations stay deterministic.
  const snapshot =
    args.bodyweight_snapshot_kg === undefined
      ? await resolveBwSnapshot(db)
      : args.bodyweight_snapshot_kg;

  await db.runAsync(
    `INSERT INTO session (id, started_at, bodyweight_snapshot_kg, title)
     VALUES (?, ?, ?, ?)`,
    args.id,
    args.started_at,
    snapshot,
    args.title ?? ''
  );
}

/**
 * Update one session's display title. Card 11 / ADR-0014 — wired from the
 * in-session header tap-to-edit. Empty string is allowed (= freestyle /
 * placeholder); caller is responsible for the trim. No-op when no row
 * matches the given id (defensive — the UI guards via getSessionId, but a
 * stale snapshot calling this on a discarded session won't throw).
 */
export async function updateSessionTitle(
  db: Database,
  sessionId: string,
  title: string
): Promise<void> {
  await db.runAsync(
    `UPDATE session SET title = ? WHERE id = ?`,
    title,
    sessionId
  );
}

/**
 * Set the bodyweight snapshot for a session. Caller is responsible for
 * enforcing the lock semantics (see `bodyMetricManager.canWriteBwSnapshot`) —
 * this function blindly overwrites the column. UI gates this behind
 * "session is idle" or "snapshot is still null".
 */
export async function setSessionBwSnapshot(
  db: Database,
  args: { id: string; bodyweight_snapshot_kg: number | null }
): Promise<void> {
  await db.runAsync(
    `UPDATE session SET bodyweight_snapshot_kg = ? WHERE id = ?`,
    args.bodyweight_snapshot_kg,
    args.id
  );
}

export async function endSession(
  db: Database,
  args: { id: string; ended_at: number }
): Promise<void> {
  await db.runAsync(
    `UPDATE session SET ended_at = ? WHERE id = ?`,
    args.ended_at,
    args.id
  );
}

/**
 * Flip the `session.is_watch_tracked` column.
 *
 * Slice 13d D6 (ADR-0019 § Q19 + NEW-Q42). v024 schema only added the
 * column with DEFAULT 0; this setter is the write boundary. Used by:
 *   - `pushStartToWatch` (D6): set true on Watch ack ≤2s
 *   - `reconcileWatchAck` (D7): set false on ack timeout 5s
 *
 * Boolean is normalised to 0/1 at the SQL layer — the column type is
 * `INTEGER NOT NULL` per v024 migration. No row-existence check —
 * UPDATE on missing id is a silent no-op, which matches the rest of
 * this repository's setters.
 */
export async function setIsWatchTracked(
  db: Database,
  args: { id: string; value: boolean }
): Promise<void> {
  await db.runAsync(
    `UPDATE session SET is_watch_tracked = ? WHERE id = ?`,
    args.value ? 1 : 0,
    args.id
  );
}

/**
 * Persist HealthKit-side data after session finish (slice 13c C3).
 *
 * `kcal` = sum of activeEnergyBurned in [started_at, ended_at] (from
 * `aggregateActiveEnergyBurned`); `healthkit_workout_uuid` = uuid returned
 * by `saveTrainingLogWorkout` (HKWorkout row Apple Fitness app surfaces).
 *
 * Both are nullable — when HK permission denied or write fails, the finish
 * flow passes `null` for the missing piece (Q8 best-effort). Detail page
 * shows '—' for NULL kcal + grey overlay for missing HR chart.
 */
export async function setSessionHealthKitData(
  db: Database,
  args: {
    id: string;
    kcal: number | null;
    healthkit_workout_uuid: string | null;
  }
): Promise<void> {
  await db.runAsync(
    `UPDATE session SET kcal = ?, healthkit_workout_uuid = ? WHERE id = ?`,
    args.kcal,
    args.healthkit_workout_uuid,
    args.id
  );
}

/**
 * SQLite row shape for the `session` table SELECTs in this repository —
 * mirrors the column types exactly (`is_watch_tracked INTEGER NOT NULL`
 * arrives as 0/1, not a JS boolean). Mapped to the domain `Session` type
 * at the read boundary by `mapSessionRow` so callers see `boolean` while
 * the SQL layer keeps the integer contract.
 *
 * Slice 13d D5 (ADR-0019 § Q19) — added `is_watch_tracked` for the Today
 * 5-tile predicate switch off `dev_simulate_watch_tracked`.
 */
interface SessionRow {
  id: string;
  started_at: number;
  ended_at: number | null;
  bodyweight_snapshot_kg: number | null;
  title: string;
  is_watch_tracked: number;
}

function mapSessionRow(row: SessionRow): Session {
  return {
    id: row.id,
    started_at: row.started_at,
    ended_at: row.ended_at,
    bodyweight_snapshot_kg: row.bodyweight_snapshot_kg,
    title: row.title,
    is_watch_tracked: row.is_watch_tracked === 1,
  };
}

export async function getSession(db: Database, id: string): Promise<Session | null> {
  const row = await db.getFirstAsync<SessionRow>(
    `SELECT id, started_at, ended_at, bodyweight_snapshot_kg, title, is_watch_tracked
       FROM session WHERE id = ?`,
    id
  );
  return row ? mapSessionRow(row) : null;
}

/**
 * Returns the session that's currently in progress (ended_at IS NULL),
 * or null when no Session is active.
 *
 * If multiple unfinished sessions exist (shouldn't normally happen — UI only
 * keeps one open at a time), returns the most recently started.
 */
export async function getActiveSession(db: Database): Promise<Session | null> {
  const row = await db.getFirstAsync<SessionRow>(
    `SELECT id, started_at, ended_at, bodyweight_snapshot_kg, title, is_watch_tracked
       FROM session
      WHERE ended_at IS NULL
      ORDER BY started_at DESC
      LIMIT 1`
  );
  return row ? mapSessionRow(row) : null;
}

/** All sessions, newest first. Used by the History tab list. */
export async function listSessions(db: Database): Promise<Session[]> {
  const rows = await db.getAllAsync<SessionRow>(
    `SELECT id, started_at, ended_at, bodyweight_snapshot_kg, title, is_watch_tracked
       FROM session
      ORDER BY started_at DESC`
  );
  return rows.map(mapSessionRow);
}

// ─────────────────────────────────────────────────────────────────────────
// History tab — aggregate list read (perf: collapse N+1 fan-out)
// ─────────────────────────────────────────────────────────────────────────

/**
 * The per-session triple of the session's "linked template" — identical
 * shape to `getSessionLinkedTemplateTriple`'s return, plus `color_hex` so the
 * History row can render the side bar without a second `getTemplateFull` call.
 * NULL on `HistoryListRow.triple` when the session is freestyle (no
 * session_exercise row carries a non-null template_id).
 */
export interface HistoryListTriple {
  template_id: string;
  template_name: string;
  program_id: string | null;
  program_name: string | null;
  sub_tag: string | null;
  /** Linked template's `template.color_hex` — '' when unset (pre-v020 backfill). */
  color_hex: string;
}

/**
 * One History-tab list row, pre-shaped so the UI's `loadInto` can map it
 * straight into a view-model with zero per-session DB round-trips.
 *
 * `volume` and `exerciseCount` are computed in SQL with the EXACT same
 * filtering the old per-session JS path applied:
 *   - volume      = Σ weight_kg × reps over rows WHERE is_logged=1 AND
 *                   set_kind != 'warmup' (mirrors `computeSessionVolume` over
 *                   `listSetsBySession`'s output — NULL weight/reps → 0; note
 *                   `is_skipped` is NOT filtered, matching the old path which
 *                   fed every row from `listSetsBySession` into the volume fn).
 *   - exerciseCount = COUNT(DISTINCT exercise_id) over the session's `set`
 *                   rows WHERE is_logged=1 — i.e. only exercises the user
 *                   actually performed (≥1 checked set). Exercises that were
 *                   added but never checked off do NOT count. Mirrors the
 *                   `countPerformedExercises(sets)` domain helper used by the
 *                   session detail page so list ↔ detail agree. (warmup is NOT
 *                   excluded here — any checked set, warmup included, marks the
 *                   exercise as "done"; matches the user's "排除沒打勾的" spec.)
 */
export interface HistoryListRow {
  session: Session;
  /** Σ weight_kg × reps over logged non-warmup sets (kg, un-rounded). */
  volume: number;
  /** Distinct exercise_id across the session's set rows. */
  exerciseCount: number;
  /** Linked-template triple + color, or null for a freestyle session. */
  triple: HistoryListTriple | null;
}

/**
 * Load every History-tab row in a FIXED number of queries (independent of
 * session count), replacing the old 1 + 3N fan-out (`listSessions` then,
 * per session, `listSetsBySession` + `getSessionLinkedTemplateTriple` +
 * `getTemplateFull`).
 *
 * Three set-based reads, joined in JS by session_id:
 *   1. all sessions, newest first (same `ORDER BY started_at DESC` as
 *      `listSessions`).
 *   2. per-session volume + distinct-exercise count via `GROUP BY session_id`
 *      over the `set` table (filters match the old JS path exactly — see
 *      `HistoryListRow`).
 *   3. per-session linked template (most-common non-null
 *      `session_exercise.template_id`, tie-break MIN(ordering) — identical to
 *      `getSessionLinkedTemplateTriple`) LEFT-joined to `template` + `program`
 *      so the triple AND color_hex come back in one pass. Sessions with no
 *      linked template simply have no entry → `triple: null`.
 *
 * Behaviour-preserving: the returned rows are equivalent to what the old
 * per-session loop produced (proven by `tests/repository/loadHistoryListRows`).
 */
export async function loadHistoryListRows(db: Database): Promise<HistoryListRow[]> {
  const sessionRows = await db.getAllAsync<SessionRow>(
    `SELECT id, started_at, ended_at, bodyweight_snapshot_kg, title, is_watch_tracked
       FROM session
      ORDER BY started_at DESC`
  );

  // 2. Per-session volume + performed-exercise count. SUM over a CASE that
  //    mirrors computeSessionVolume's filter; COUNT(DISTINCT … is_logged=1)
  //    mirrors countPerformedExercises — only exercises with ≥1 checked set
  //    count toward 動作數 (added-but-never-checked exercises are excluded).
  //    GROUP BY session_id → one row per session that has ≥1 set (sessions
  //    with no sets fall through to defaults below).
  const aggRows = await db.getAllAsync<{
    session_id: string;
    volume: number;
    exercise_count: number;
  }>(
    `SELECT session_id,
            COALESCE(SUM(
              CASE WHEN is_logged = 1 AND set_kind != 'warmup'
                   THEN COALESCE(weight_kg, 0) * COALESCE(reps, 0)
                   ELSE 0 END
            ), 0) AS volume,
            COUNT(DISTINCT CASE WHEN is_logged = 1 THEN exercise_id END) AS exercise_count
       FROM "set"
      GROUP BY session_id`
  );
  const aggBySession = new Map<string, { volume: number; exerciseCount: number }>();
  for (const r of aggRows) {
    aggBySession.set(r.session_id, {
      volume: r.volume,
      exerciseCount: r.exercise_count,
    });
  }

  // 3. Per-session winning linked template (+ color, + program). ROW_NUMBER
  //    over (COUNT(*) DESC, MIN(ordering) ASC) reproduces
  //    getSessionLinkedTemplateTriple's "most common, tie-break earliest
  //    ordering" pick for ALL sessions at once. LEFT JOIN program so a
  //    program-less template still yields program_name = NULL.
  const tplRows = await db.getAllAsync<{
    session_id: string;
    template_id: string;
    template_name: string;
    program_id: string | null;
    program_name: string | null;
    sub_tag: string | null;
    color_hex: string | null;
  }>(
    `WITH ranked AS (
       SELECT se.session_id AS session_id,
              se.template_id AS template_id,
              COUNT(*) AS cnt,
              MIN(se.ordering) AS min_ord,
              ROW_NUMBER() OVER (
                PARTITION BY se.session_id
                ORDER BY COUNT(*) DESC, MIN(se.ordering) ASC
              ) AS rn
         FROM session_exercise se
        WHERE se.template_id IS NOT NULL
        GROUP BY se.session_id, se.template_id
     )
     SELECT r.session_id AS session_id,
            r.template_id AS template_id,
            t.name        AS template_name,
            t.program_id  AS program_id,
            p.name        AS program_name,
            t.sub_tag     AS sub_tag,
            t.color_hex   AS color_hex
       FROM ranked r
       JOIN template t ON t.id = r.template_id
       LEFT JOIN program p ON p.id = t.program_id
      WHERE r.rn = 1`
  );
  const tripleBySession = new Map<string, HistoryListTriple>();
  for (const r of tplRows) {
    tripleBySession.set(r.session_id, {
      template_id: r.template_id,
      template_name: r.template_name,
      program_id: r.program_id ?? null,
      program_name: r.program_name ?? null,
      sub_tag: r.sub_tag ?? null,
      color_hex: r.color_hex ?? '',
    });
  }

  return sessionRows.map((row) => {
    const agg = aggBySession.get(row.id);
    return {
      session: mapSessionRow(row),
      volume: agg?.volume ?? 0,
      exerciseCount: agg?.exerciseCount ?? 0,
      triple: tripleBySession.get(row.id) ?? null,
    };
  });
}

/**
 * One row per planned exercise inside a Session. Snapshot of a Template
 * captured at Session start (slice 3). `template_id` is nullable so a
 * "blank" Session (started without a Template) holds zero rows here.
 */
interface SessionExerciseRow {
  id: string;
  session_id: string;
  exercise_id: string;
  ordering: number;
  planned_sets: number;
  planned_reps: number | null;
  planned_weight_kg: number | null;
  template_id: string | null;
  /** Frozen copy of the source template_exercise.is_evergreen at snapshot time. */
  is_evergreen: 0 | 1;
  /**
   * Cluster linkage on the session side (ADR-0018, v014). Points to another
   * session_exercise.id in the same session. NULL = solo / cluster parent.
   */
  parent_id: string | null;
  /**
   * Reusable Superset identity on the session side (ADR-0018, v014). NULL =
   * solo / manual cluster / ad-hoc; NOT NULL = templated RS-explode cluster.
   * FK to superset(id) ON DELETE SET NULL.
   */
  reusable_superset_id: string | null;
  /**
   * Per-exercise rest seconds (ADR-0019 Q2 + slice 10b bridge). NULL = inherit
   * hardcoded 60s system default. snapshotForSession copies this from the
   * source template_exercise.rest_seconds (legacy column name) verbatim;
   * future ⚙️ menu sheet (slice 10c) lets users edit per-session.
   *
   * Optional on the input type so older test fixtures (pre-slice-10b) that
   * don't model rest_sec still compile — they default to null on insert,
   * which matches the v016 column nullability semantics. Production callers
   * always set the field via snapshotForSession.
   */
  rest_sec?: number | null;
}

export async function insertSessionExercise(
  db: Database,
  row: SessionExerciseRow
): Promise<void> {
  await db.runAsync(
    `INSERT INTO session_exercise
       (id, session_id, exercise_id, ordering,
        planned_sets, planned_reps, planned_weight_kg, template_id, is_evergreen,
        parent_id, reusable_superset_id, rest_sec)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id,
    row.session_id,
    row.exercise_id,
    row.ordering,
    row.planned_sets,
    row.planned_reps,
    row.planned_weight_kg,
    row.template_id,
    row.is_evergreen,
    row.parent_id,
    row.reusable_superset_id,
    row.rest_sec ?? null
  );
}

/**
 * Picker dim/disable input — what the current in-progress session already
 * contains, partitioned so the [+動作] picker can render the right items
 * as "已在訓練中" (dim + tap-disabled, ⓘ still tappable for detail
 * preview).
 *
 * Rule recap (user pinned 2026-05-18):
 *   - Solo: 1 session × same exercise_id allows at most 1 solo card
 *   - RS:   1 session × same RS template allows at most 1 instance (multiple
 *           different RS templates can coexist)
 *   - Solo and RS are independent — solo Cable Crossover + RS(Cable+Dip)
 *     may live side-by-side; RS A-side Cable does NOT dim the solo Cable
 *     picker entry (and vice versa)
 *
 * Implementation: only rows with `reusable_superset_id IS NULL` count
 * toward solo conflicts; rows where it's NOT NULL contribute to the RS
 * template set (distinct on the template id, both A and B sides collapse
 * to the same id).
 */
interface SessionUsedExercises {
  /** session_exercise.exercise_id where reusable_superset_id IS NULL. */
  solo_exercise_ids: Set<string>;
  /** Distinct session_exercise.reusable_superset_id (NOT NULL only). */
  rs_template_ids: Set<string>;
}

export async function listSessionUsedExercises(
  db: Database,
  session_id: string
): Promise<SessionUsedExercises> {
  const rows = await db.getAllAsync<{
    exercise_id: string;
    reusable_superset_id: string | null;
  }>(
    `SELECT exercise_id, reusable_superset_id
       FROM session_exercise
      WHERE session_id = ?`,
    session_id
  );
  const solo = new Set<string>();
  const rs = new Set<string>();
  for (const r of rows) {
    if (r.reusable_superset_id == null) {
      solo.add(r.exercise_id);
    } else {
      rs.add(r.reusable_superset_id);
    }
  }
  return { solo_exercise_ids: solo, rs_template_ids: rs };
}

/**
 * Delete one session_exercise + all of its sets (per ADR-0019 ⚙️ menu's
 * 🗑️ option). Manual cascade because the v003 FK between set and
 * session_exercise is via (exercise_id, session_id) not a real CASCADE.
 *
 * Slice 10c Phase 4 commit 17 introduced this.
 *
 * v019 isolation fix (slice 10c #17): the set DELETE now scopes by
 * `session_exercise_id = ?` (the card-scoped column from v019). When two
 * session_exercise rows in the same session shared an `exercise_id` (e.g.
 * RS A-side Cable Crossover + a solo Cable Crossover card) the prior
 * `WHERE session_id = ? AND exercise_id = ?` would wipe BOTH cards' sets
 * — a leak. The fallback `OR (session_exercise_id IS NULL AND ...)` arm
 * keeps the old behavior alive for any legacy / pre-v019 rows the
 * migration's backfill couldn't tag; those rows still respond to the
 * coarse (session, exercise) filter exactly as they did pre-#17.
 *
 * rest_sec / set_kind / parent_set_id state on the orphaned sets is
 * gone with them — no need to clean up elsewhere.
 */
export async function deleteSessionExerciseAndSets(
  db: Database,
  args: { session_id: string; exercise_id: string; session_exercise_id: string }
): Promise<void> {
  await db.withTransactionAsync(async () => {
    // 清 achievement_unlock 的 set_id back-ref，避免被刪 set 撞 FK constraint。
    // (v008 schema: `achievement_unlock.set_id TEXT REFERENCES "set"(id)`、無 ON DELETE)
    await db.runAsync(
      `UPDATE achievement_unlock SET set_id = NULL
        WHERE set_id IN (
          SELECT id FROM "set"
           WHERE session_exercise_id = ?
              OR (session_exercise_id IS NULL
                  AND session_id = ?
                  AND exercise_id = ?)
        )`,
      args.session_exercise_id,
      args.session_id,
      args.exercise_id
    );
    await db.runAsync(
      `DELETE FROM "set"
        WHERE session_exercise_id = ?
           OR (session_exercise_id IS NULL
               AND session_id = ?
               AND exercise_id = ?)`,
      args.session_exercise_id,
      args.session_id,
      args.exercise_id
    );
    await db.runAsync(
      `DELETE FROM session_exercise WHERE id = ?`,
      args.session_exercise_id
    );
  });
}

/**
 * Update one session_exercise's rest_sec (per ADR-0019 ⚙️ menu's ⏱️
 * option). NULL means "use default" (60s) at the UI layer.
 *
 * Slice 10c Phase 4 commit 18.
 */
/**
 * Reorder session_exercise rows within one session (per ADR-0019 Q10).
 * Caller passes the new desired sequence of session_exercise IDs; we
 * assign ordering = (1, 2, 3, ...) in that order via batch UPDATE.
 *
 * Slice 10c Phase 6 commit 30. Within a transaction so partial failure
 * rolls back cleanly. No constraint on `ordering` so intermediate
 * duplicates are fine — final state has the correct sequence.
 */
export async function reorderSessionExercises(
  db: Database,
  args: { session_id: string; orderedIds: string[] }
): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < args.orderedIds.length; i++) {
      await db.runAsync(
        `UPDATE session_exercise SET ordering = ?
          WHERE id = ? AND session_id = ?`,
        i + 1,
        args.orderedIds[i],
        args.session_id
      );
    }
  });
}

/**
 * Append one ad-hoc exercise to an in-progress session (per ADR-0019 Q15
 * bottom sticky bar [+ 動作]). Order goes to MAX(ordering)+1 within the
 * session. planned_sets defaults to 3 (typical user expectation when
 * adding mid-session). template_id stays null since this is ad-hoc.
 *
 * Slice 10c Phase 5 commit 28.
 */
export async function appendSessionExercise(
  db: Database,
  args: {
    id: string;
    session_id: string;
    exercise_id: string;
    planned_sets?: number;
  }
): Promise<void> {
  // Defensive guard (slice 10c #20) — picker UI is supposed to dim already-
  // used solo exercises so this throw should never fire in practice, but if
  // a race / future caller / test bug slips through we'd rather hard-fail
  // than create a second card the user can't easily distinguish from the
  // first. Scoped to solo only (reusable_superset_id IS NULL); RS-spawned
  // rows are a different bucket.
  const dup = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM session_exercise
      WHERE session_id = ?
        AND exercise_id = ?
        AND reusable_superset_id IS NULL
      LIMIT 1`,
    args.session_id,
    args.exercise_id
  );
  if (dup) {
    throw new Error('duplicate solo exercise in session');
  }
  const row = await db.getFirstAsync<{ max_ordering: number | null }>(
    `SELECT MAX(ordering) AS max_ordering FROM session_exercise
      WHERE session_id = ?`,
    args.session_id
  );
  const ordering = (row?.max_ordering ?? 0) + 1;
  await db.runAsync(
    `INSERT INTO session_exercise
       (id, session_id, exercise_id, ordering,
        planned_sets, planned_reps, planned_weight_kg, template_id, is_evergreen,
        parent_id, reusable_superset_id, rest_sec)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, 0, NULL, NULL, NULL)`,
    args.id,
    args.session_id,
    args.exercise_id,
    ordering,
    args.planned_sets ?? 3
  );
}

/**
 * Append a Reusable Superset (RS) into an in-progress session as a cluster
 * pair — 2 session_exercise rows linked via `parent_id` chain, both sharing
 * `reusable_superset_id`. Mirrors the template editor's RS-explode pattern.
 *
 * Layout produced:
 *   - A row (cluster parent): ordering = MAX+1, parent_id = null,
 *     reusable_superset_id = rs.id
 *   - B row (cluster follower): ordering = MAX+2, parent_id = A.id,
 *     reusable_superset_id = rs.id
 *
 * Reads RS via `getReusableSupersetWithExercises(db, rs_id)` — throws if
 * not found or doesn't have exactly 2 exercises (data-quality bug).
 *
 * No transaction here — caller can wrap multiple RS appends in one if
 * atomicity matters. For [+動作] picker single-shot pick this is fine.
 *
 * Slice 10c — fix「超級組出不來」(2026-05-17 ultra-late) — Today consumePick
 * handler was processing only `exerciseIds`, silently dropping
 * `reusableSupersetIds`. This func is the missing link.
 */
export async function appendReusableSupersetToSession(
  db: Database,
  args: {
    session_id: string;
    reusable_superset_id: string;
    uuid: () => string;
  }
): Promise<{ a_id: string; b_id: string }> {
  const rs = await getReusableSupersetWithExercises(db, args.reusable_superset_id);
  if (!rs) {
    throw new Error(
      `appendReusableSupersetToSession: RS "${args.reusable_superset_id}" not found`
    );
  }
  if (rs.exercises.length !== 2) {
    throw new Error(
      `appendReusableSupersetToSession: RS "${args.reusable_superset_id}" has ${rs.exercises.length} exercises, expected 2`
    );
  }

  // Defensive guard (slice 10c #20) — picker UI dims already-used RS
  // templates so this throw should never fire, but if a race / future
  // caller bug slips through we fail loud rather than silently insert a
  // second cluster pair sharing the same RS template id.
  const dup = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM session_exercise
      WHERE session_id = ?
        AND reusable_superset_id = ?
      LIMIT 1`,
    args.session_id,
    args.reusable_superset_id
  );
  if (dup) {
    throw new Error('duplicate RS in session');
  }

  const row = await db.getFirstAsync<{ max_ordering: number | null }>(
    `SELECT MAX(ordering) AS max_ordering FROM session_exercise
      WHERE session_id = ?`,
    args.session_id
  );
  const baseOrdering = row?.max_ordering ?? 0;
  const a_id = args.uuid();
  const b_id = args.uuid();

  // A side — cluster parent.
  await db.runAsync(
    `INSERT INTO session_exercise
       (id, session_id, exercise_id, ordering,
        planned_sets, planned_reps, planned_weight_kg, template_id, is_evergreen,
        parent_id, reusable_superset_id, rest_sec)
     VALUES (?, ?, ?, ?, 3, NULL, NULL, NULL, 0, NULL, ?, NULL)`,
    a_id,
    args.session_id,
    rs.exercises[0].id,
    baseOrdering + 1,
    args.reusable_superset_id
  );
  // B side — follower, parent_id = A.
  await db.runAsync(
    `INSERT INTO session_exercise
       (id, session_id, exercise_id, ordering,
        planned_sets, planned_reps, planned_weight_kg, template_id, is_evergreen,
        parent_id, reusable_superset_id, rest_sec)
     VALUES (?, ?, ?, ?, 3, NULL, NULL, NULL, 0, ?, ?, NULL)`,
    b_id,
    args.session_id,
    rs.exercises[1].id,
    baseOrdering + 2,
    a_id,
    args.reusable_superset_id
  );

  return { a_id, b_id };
}

/**
 * 放棄訓練 — discard an in-progress session entirely (per ADR-0019 Q15
 * Header [⋯] menu). Removes every set, every session_exercise, then the
 * session row itself in one transaction. No undo; caller must confirm.
 *
 * Slice 10c Phase 5 commit 26.
 *
 * Achievement back-ref handling (2026-05-20 wave 12 完工):
 *   v008 schema declares `achievement_unlock.session_id NOT NULL REFERENCES
 *   session(id)` and `achievement_unlock.set_id REFERENCES "set"(id)` — both
 *   FKs lack `ON DELETE` actions. Naively deleting the session's rows trips
 *   FOREIGN KEY constraint failed whenever a PR / first-combo unlocked during
 *   the session.
 *
 *   Semantic decision: discardSession means "this session never happened",
 *   so unlocks earned within it are revoked (the `achievement_definition_id
 *   UNIQUE` constraint allows re-unlocking in a future session — no leak).
 *
 *   Order of operations (all inside the existing transaction):
 *     1. NULL `set_id` on any unlock OUTSIDE this session that happens to
 *        point at a set inside this session (defensive — production
 *        achievementRepository writes session_id+set_id from the same
 *        context so this should be a no-op, but the schema doesn't enforce
 *        the invariant).
 *     2. DELETE all unlocks for this session (handles both back-refs in
 *        one shot since their session_id matches).
 *     3-5. Original cascade: sets → session_exercise → session.
 */
export async function discardSession(
  db: Database,
  session_id: string
): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE achievement_unlock SET set_id = NULL
         WHERE set_id IN (SELECT id FROM "set" WHERE session_id = ?)
           AND session_id != ?`,
      session_id,
      session_id
    );
    await db.runAsync(
      `DELETE FROM achievement_unlock WHERE session_id = ?`,
      session_id
    );
    await db.runAsync(
      `DELETE FROM "set" WHERE session_id = ?`,
      session_id
    );
    await db.runAsync(
      `DELETE FROM session_exercise WHERE session_id = ?`,
      session_id
    );
    await db.runAsync(`DELETE FROM session WHERE id = ?`, session_id);
    // Card 12R / Round G Q2b cascade — discardSession 等於「該 session
    // 從未發生」，因此也清掉可能殘留的 edit-mode snapshot row（FK semantic、
    // 避免 orphan）。setSetting / deleteSetting 用 INSERT OR REPLACE /
    // DELETE，沒有 row 也是 no-op，不會 throw。
    await db.runAsync(
      `DELETE FROM app_settings WHERE key = ?`,
      editSnapshotKey(session_id)
    );
  });
}

export async function updateSessionExerciseRestSec(
  db: Database,
  session_exercise_id: string,
  rest_sec: number | null
): Promise<void> {
  await db.runAsync(
    `UPDATE session_exercise SET rest_sec = ? WHERE id = ?`,
    rest_sec,
    session_exercise_id
  );
}

export interface SessionExerciseRowWithName extends SessionExerciseRow {
  exercise_name: string;
  /**
   * exercise.load_type — needed for session detail cluster render (I5) to
   * choose per-side cell formatting (loaded shows kg×reps, bodyweight hides
   * kg, assisted subtracts kg from BW).
   */
  exercise_load_type: 'loaded' | 'bodyweight' | 'assisted';
  /**
   * Per-exercise global notes (ADR-0013 + ADR-0017 amendment — owned by
   * `exercise.notes`, shared across all templates/sessions using this
   * exercise). NULL or empty string = no notes; UI renders inline notes
   * box in expanded session card body when non-empty.
   *
   * Slice 10e bundle 1 — surface notes in session 上下文 (was previously
   * only visible in template editor 📝 indicator).
   */
  exercise_notes: string | null;
}

/**
 * Count rows in `session_exercise` for a given session. Used by the
 * NEW-Q49 first-add gate (ADR-0019) — iPhone freestyle session 不立即
 * push 到 Watch、首動作 append 前若 count === 0、append 後觸發
 * `pushStartToWatch`. Template-based sessions snapshot template rows
 * at start so count > 0 by the time +動作 path runs, so the same
 * predicate naturally short-circuits the push for them.
 *
 * Slice 13d D9 — NEW-Q49 patch.
 */
export async function countSessionExercises(
  db: Database,
  session_id: string
): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM session_exercise WHERE session_id = ?`,
    session_id
  );
  return row?.n ?? 0;
}

/** Same as `listSessionExercises` but joins exercise.name + load_type for UI display. */
export async function listSessionExercisesWithName(
  db: Database,
  session_id: string
): Promise<SessionExerciseRowWithName[]> {
  return db.getAllAsync<SessionExerciseRowWithName>(
    `SELECT se.id, se.session_id, se.exercise_id, se.ordering,
            se.planned_sets, se.planned_reps, se.planned_weight_kg, se.template_id, se.is_evergreen,
            se.parent_id, se.reusable_superset_id, se.rest_sec,
            e.name      AS exercise_name,
            e.load_type AS exercise_load_type,
            e.notes     AS exercise_notes
       FROM session_exercise se
       JOIN exercise e ON e.id = se.exercise_id
      WHERE se.session_id = ?
      ORDER BY se.ordering ASC`,
    session_id
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Session snapshot / restore — transactional edit mode (2026-05-20 night)
// ─────────────────────────────────────────────────────────────────────────
/**
 * 在進入歷史 session 詳情頁的「編輯訓練」模式時 snapshot 整個 session 的可變
 * 狀態（session.started_at / ended_at + 所有 session_exercise + 所有 set
 * + achievement_unlock 對該 session 的 back-ref）。`restoreSessionFromSnapshot`
 * 可用此 snapshot 在使用者按「返回（捨棄修改）」時還原。
 *
 * 為什麼不單純走 SQLite BEGIN TRANSACTION + ROLLBACK：UI 期間 session 仍要
 * 被其他 query 讀取（畫面渲染、stats、PR）、長期持有交易會把 DB lock 起來、
 * expo-sqlite 也不支援跨 async 邊界的手動交易。snapshot-restore 用獨立交易
 * 在 commit 點觸發、不影響中間的 read。
 *
 * 為什麼也 snapshot achievement_unlock：fix(set-delete) wave 之後刪除登錄
 * 過的 set 會 UPDATE achievement_unlock SET set_id = NULL，這個副作用必須
 * 也能還原 — 不然 restore 後 set 回來、unlock 對應仍是 NULL 不一致。
 */
export interface SessionSnapshot {
  session: {
    id: string;
    started_at: number;
    ended_at: number | null;
  };
  sessionExercises: ReadonlyArray<{
    id: string;
    session_id: string;
    exercise_id: string;
    ordering: number;
    planned_sets: number;
    planned_reps: number | null;
    planned_weight_kg: number | null;
    template_id: string | null;
    is_evergreen: number;
    parent_id: string | null;
    reusable_superset_id: string | null;
    rest_sec: number | null;
  }>;
  sets: ReadonlyArray<{
    id: string;
    session_id: string;
    exercise_id: string;
    weight_kg: number | null;
    reps: number | null;
    is_skipped: number;
    ordering: number;
    created_at: number;
    set_kind: string;
    parent_set_id: string | null;
    is_logged: number;
    notes: string | null;
    session_exercise_id: string | null;
  }>;
  achievementUnlocks: ReadonlyArray<{ id: number; set_id: string }>;
}

export async function captureSessionSnapshot(
  db: Database,
  session_id: string
): Promise<SessionSnapshot | null> {
  const session = await db.getFirstAsync<{
    id: string;
    started_at: number;
    ended_at: number | null;
  }>(
    `SELECT id, started_at, ended_at FROM session WHERE id = ?`,
    session_id
  );
  if (!session) return null;

  const sessionExercises = await db.getAllAsync<
    SessionSnapshot['sessionExercises'][number]
  >(
    `SELECT id, session_id, exercise_id, ordering, planned_sets, planned_reps,
            planned_weight_kg, template_id, is_evergreen, parent_id,
            reusable_superset_id, rest_sec
       FROM session_exercise
      WHERE session_id = ?`,
    session_id
  );

  const sets = await db.getAllAsync<SessionSnapshot['sets'][number]>(
    `SELECT id, session_id, exercise_id, weight_kg, reps, is_skipped, ordering,
            created_at, set_kind, parent_set_id, is_logged, notes,
            session_exercise_id
       FROM "set"
      WHERE session_id = ?`,
    session_id
  );

  const achievementUnlocks = await db.getAllAsync<{
    id: number;
    set_id: string;
  }>(
    `SELECT id, set_id FROM achievement_unlock
      WHERE set_id IS NOT NULL
        AND set_id IN (SELECT id FROM "set" WHERE session_id = ?)`,
    session_id
  );

  return { session, sessionExercises, sets, achievementUnlocks };
}

/**
 * Atomic 還原：把 session 的 (session row 時間欄位 + 所有 session_exercise
 * + 所有 set + 該 session 範圍內的 achievement_unlock 反向指標) 還原到
 * snapshot 拍照時的狀態。Edit mode 「返回 → 捨棄修改」走這條 path。
 *
 * 流程：
 *   1. 清掉當前 session 範圍內 achievement_unlock.set_id back-ref（避免
 *      被刪的 set 撞 FK；同 fix(set-delete) 註解）
 *   2. DELETE 當前 session 的 set + session_exercise
 *   3. UPDATE session.started_at / ended_at 還原（DateTimePickerSheet 改的）
 *   4. 重新 INSERT snapshot 的 session_exercise rows
 *   5. 重新 INSERT snapshot 的 set rows（含 is_logged / notes / parent_set_id
 *      等所有欄位、保留原 id）
 *   6. 重連 achievement_unlock.set_id back-ref（snapshot 拍的時候 set 還在
 *      原 id、restore 後 set 用相同 id 回來、所以 back-ref 可恢復）
 */
export async function restoreSessionFromSnapshot(
  db: Database,
  snapshot: SessionSnapshot
): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE achievement_unlock SET set_id = NULL
        WHERE set_id IN (SELECT id FROM "set" WHERE session_id = ?)`,
      snapshot.session.id
    );
    await db.runAsync(
      `DELETE FROM "set" WHERE session_id = ?`,
      snapshot.session.id
    );
    await db.runAsync(
      `DELETE FROM session_exercise WHERE session_id = ?`,
      snapshot.session.id
    );

    await db.runAsync(
      `UPDATE session SET started_at = ?, ended_at = ? WHERE id = ?`,
      snapshot.session.started_at,
      snapshot.session.ended_at,
      snapshot.session.id
    );

    for (const se of snapshot.sessionExercises) {
      await db.runAsync(
        `INSERT INTO session_exercise
           (id, session_id, exercise_id, ordering, planned_sets, planned_reps,
            planned_weight_kg, template_id, is_evergreen, parent_id,
            reusable_superset_id, rest_sec)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        se.id,
        se.session_id,
        se.exercise_id,
        se.ordering,
        se.planned_sets,
        se.planned_reps,
        se.planned_weight_kg,
        se.template_id,
        se.is_evergreen,
        se.parent_id,
        se.reusable_superset_id,
        se.rest_sec
      );
    }

    for (const s of snapshot.sets) {
      await db.runAsync(
        `INSERT INTO "set"
           (id, session_id, exercise_id, weight_kg, reps, is_skipped,
            ordering, created_at, set_kind, parent_set_id, is_logged,
            notes, session_exercise_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        s.id,
        s.session_id,
        s.exercise_id,
        s.weight_kg,
        s.reps,
        s.is_skipped,
        s.ordering,
        s.created_at,
        s.set_kind,
        s.parent_set_id,
        s.is_logged,
        s.notes,
        s.session_exercise_id
      );
    }

    for (const unlock of snapshot.achievementUnlocks) {
      await db.runAsync(
        `UPDATE achievement_unlock SET set_id = ? WHERE id = ?`,
        unlock.set_id,
        unlock.id
      );
    }
  });
}
