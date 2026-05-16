import type { Database } from '../../db/types';
import type { Session } from '../../domain/session/types';
import { getReusableSupersetWithExercises } from './supersetRepository';

export async function createSession(
  db: Database,
  args: { id: string; started_at: number; bodyweight_snapshot_kg?: number | null }
): Promise<void> {
  await db.runAsync(
    `INSERT INTO session (id, started_at, bodyweight_snapshot_kg) VALUES (?, ?, ?)`,
    args.id,
    args.started_at,
    args.bodyweight_snapshot_kg ?? null
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

export async function getSession(db: Database, id: string): Promise<Session | null> {
  return db.getFirstAsync<Session>(
    `SELECT id, started_at, ended_at, bodyweight_snapshot_kg
       FROM session WHERE id = ?`,
    id
  );
}

/**
 * Returns the session that's currently in progress (ended_at IS NULL),
 * or null when no Session is active.
 *
 * If multiple unfinished sessions exist (shouldn't normally happen — UI only
 * keeps one open at a time), returns the most recently started.
 */
export async function getActiveSession(db: Database): Promise<Session | null> {
  return db.getFirstAsync<Session>(
    `SELECT id, started_at, ended_at, bodyweight_snapshot_kg
       FROM session
      WHERE ended_at IS NULL
      ORDER BY started_at DESC
      LIMIT 1`
  );
}

/** All sessions, newest first. Used by the History tab list. */
export async function listSessions(db: Database): Promise<Session[]> {
  return db.getAllAsync<Session>(
    `SELECT id, started_at, ended_at, bodyweight_snapshot_kg
       FROM session
      ORDER BY started_at DESC`
  );
}

/**
 * One row per planned exercise inside a Session. Snapshot of a Template
 * captured at Session start (slice 3). `template_id` is nullable so a
 * "blank" Session (started without a Template) holds zero rows here.
 */
export interface SessionExerciseRow {
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

export async function listSessionExercises(
  db: Database,
  session_id: string
): Promise<SessionExerciseRow[]> {
  return db.getAllAsync<SessionExerciseRow>(
    `SELECT id, session_id, exercise_id, ordering,
            planned_sets, planned_reps, planned_weight_kg, template_id, is_evergreen,
            parent_id, reusable_superset_id, rest_sec
       FROM session_exercise
      WHERE session_id = ?
      ORDER BY ordering ASC`,
    session_id
  );
}

/**
 * Delete one session_exercise + all of its sets (per ADR-0019 ⚙️ menu's
 * 🗑️ option). Manual cascade because the v003 FK between set and
 * session_exercise is via (exercise_id, session_id) not a real CASCADE.
 *
 * Slice 10c Phase 4 commit 17. rest_sec / set_kind / parent_set_id state
 * on the orphaned sets is gone with them — no need to clean up elsewhere.
 */
export async function deleteSessionExerciseAndSets(
  db: Database,
  args: { session_id: string; exercise_id: string; session_exercise_id: string }
): Promise<void> {
  await db.runAsync(
    `DELETE FROM "set" WHERE session_id = ? AND exercise_id = ?`,
    args.session_id,
    args.exercise_id
  );
  await db.runAsync(
    `DELETE FROM session_exercise WHERE id = ?`,
    args.session_exercise_id
  );
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
 */
export async function discardSession(
  db: Database,
  session_id: string
): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `DELETE FROM "set" WHERE session_id = ?`,
      session_id
    );
    await db.runAsync(
      `DELETE FROM session_exercise WHERE session_id = ?`,
      session_id
    );
    await db.runAsync(`DELETE FROM session WHERE id = ?`, session_id);
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
   * Reusable Superset accent color (per ADR-0019 Q8 (c) H1 — RS-color left
   * vertical bar on cluster card). NULL when:
   *   - row is solo (reusable_superset_id IS NULL), OR
   *   - row is cluster but the source RS row has color_hex NULL (manual /
   *     ad-hoc cluster, or RS created without a color choice).
   *
   * Both A and B sides of a cluster carry the same RS id, so this column
   * resolves to the same value on both sides — the cluster card consumer
   * reads it off the A (parent) row.
   *
   * Slice 10c overnight 第 2 點 — cluster color threading. LEFT JOIN so
   * solo rows still come back (the previous INNER-style behavior was an
   * accident of not joining at all).
   */
  reusable_superset_color_hex: string | null;
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
            rs.color_hex AS reusable_superset_color_hex
       FROM session_exercise se
       JOIN exercise e ON e.id = se.exercise_id
       LEFT JOIN superset rs ON rs.id = se.reusable_superset_id
      WHERE se.session_id = ?
      ORDER BY se.ordering ASC`,
    session_id
  );
}

/**
 * Compute the diff between an in-progress session and the template it was
 * snapshotted from. Used by the Today-tab finish flow (ADR-0019 Q9d) to
 * decide whether to surface the 3-option Save-back dialog.
 *
 * Returns `{ has_diff: false, diff_kinds: [] }` when:
 *   - The session has no template_id on its plan rows (Freestyle — caller
 *     should branch to the 2-option dialog instead), OR
 *   - Every plan row + set matches the template snapshot field-by-field.
 *
 * The template's planned set / rep / weight values are read from the
 * legacy `template_set` table (v009 per-set source of truth) when present
 * — falling back to `template_exercise.default_sets` /
 * `default_reps` / `default_weight_kg` when no per-set rows exist (older
 * templates). The diff compares against the modal rep/weight tuple from
 * the per-set list so a template with mixed working/warmup rows doesn't
 * accidentally trip the diff against a session where the user logged the
 * same plan.
 *
 * Slice 10c finish-dialog wire-up.
 */
export async function computeSessionDiff(
  db: Database,
  args: { session_id: string }
): Promise<{ has_diff: boolean; diff_kinds: string[] }> {
  const { computeSessionDiff: computePure } = await import(
    '../../domain/session/computeSessionDiff'
  );

  const seRows = await db.getAllAsync<{
    id: string;
    exercise_id: string;
    template_id: string | null;
    rest_sec: number | null;
    parent_id: string | null;
    reusable_superset_id: string | null;
  }>(
    `SELECT id, exercise_id, template_id, rest_sec, parent_id, reusable_superset_id
       FROM session_exercise
      WHERE session_id = ?
      ORDER BY ordering ASC`,
    args.session_id
  );

  // Derive template_id from the plan rows (all rows for a template-based
  // session share the same template_id; Freestyle rows are NULL).
  const templateId =
    seRows.find((r) => r.template_id != null)?.template_id ?? null;
  if (!templateId) {
    return { has_diff: false, diff_kinds: [] };
  }

  // Load template exercise rows + per-set rollup so we can compare.
  const teRows = await db.getAllAsync<{
    id: string;
    exercise_id: string;
    default_sets: number;
    default_reps: number | null;
    default_weight_kg: number | null;
    rest_seconds: number | null;
    parent_id: string | null;
    reusable_superset_id: string | null;
  }>(
    `SELECT id, exercise_id, default_sets, default_reps, default_weight_kg,
            rest_seconds, parent_id, reusable_superset_id
       FROM template_exercise
      WHERE template_id = ?
      ORDER BY ordering ASC`,
    templateId
  );

  // Per-set rollup: for each template_exercise, count rows + modal rep/weight.
  const tsRows = await db.getAllAsync<{
    template_exercise_id: string;
    reps: number;
    weight: number;
  }>(
    `SELECT ts.template_exercise_id, ts.reps, ts.weight
       FROM template_set ts
       JOIN template_exercise te ON te.id = ts.template_exercise_id
      WHERE te.template_id = ?`,
    templateId
  );
  const setsByTe = new Map<string, Array<{ reps: number; weight: number }>>();
  for (const r of tsRows) {
    const arr = setsByTe.get(r.template_exercise_id) ?? [];
    arr.push({ reps: r.reps, weight: r.weight });
    setsByTe.set(r.template_exercise_id, arr);
  }

  const templateExercises = teRows.map((te) => {
    const sets = setsByTe.get(te.id) ?? [];
    if (sets.length > 0) {
      // Use modal (reps, weight) so a template with mixed warmup rows
      // doesn't constantly trip diffs against working-only session rows.
      const counts = new Map<string, { reps: number; weight: number; n: number }>();
      for (const s of sets) {
        const key = `${s.reps}|${s.weight}`;
        const cur = counts.get(key);
        if (cur) cur.n += 1;
        else counts.set(key, { reps: s.reps, weight: s.weight, n: 1 });
      }
      let best: { reps: number; weight: number; n: number } | null = null;
      for (const c of counts.values()) {
        if (!best || c.n > best.n) best = c;
      }
      return {
        exercise_id: te.exercise_id,
        planned_sets: sets.length,
        planned_reps: best?.reps ?? null,
        planned_weight_kg: best?.weight ?? null,
        rest_sec: te.rest_seconds ?? null,
        parent_id: te.parent_id,
        reusable_superset_id: te.reusable_superset_id,
      };
    }
    return {
      exercise_id: te.exercise_id,
      planned_sets: te.default_sets,
      planned_reps: te.default_reps,
      planned_weight_kg: te.default_weight_kg,
      rest_sec: te.rest_seconds ?? null,
      parent_id: te.parent_id,
      reusable_superset_id: te.reusable_superset_id,
    };
  });

  // Session sets — pull is_skipped + reps + weight per exercise.
  const setRows = await db.getAllAsync<{
    exercise_id: string;
    is_skipped: number;
    reps: number | null;
    weight_kg: number | null;
  }>(
    `SELECT exercise_id, is_skipped, reps, weight_kg
       FROM "set"
      WHERE session_id = ?`,
    args.session_id
  );

  return computePure({
    sessionExercises: seRows.map((r) => ({
      id: r.id,
      exercise_id: r.exercise_id,
      rest_sec: r.rest_sec ?? null,
      parent_id: r.parent_id,
      reusable_superset_id: r.reusable_superset_id,
    })),
    sessionSets: setRows,
    template: { exercises: templateExercises },
  });
}

/**
 * Write the session's in-progress structure back to the linked template,
 * overwriting `template_exercise` + `template_set` rows. Used by the
 * finish dialog's 「儲存模板」 option (ADR-0019 Q9d Template-based path,
 * (a) Save).
 *
 * Strategy: clear the existing template_exercise + template_set rows for
 * this template_id, then re-insert from the current session_exercise +
 * non-skipped, non-warmup set rows. Keeps the template_id stable so any
 * future session created from the same Program cell still hits the same
 * row. Does NOT propagate to sibling templates (the Save-back review
 * screen handles that; this is the "blind overwrite" path for users who
 * already accepted the dialog without reviewing per-set details).
 *
 * Slice 10c finish-dialog wire-up.
 */
export async function overwriteTemplateFromSession(
  db: Database,
  args: { session_id: string; template_id: string; uuid: () => string }
): Promise<void> {
  const seRows = await db.getAllAsync<{
    id: string;
    exercise_id: string;
    ordering: number;
    is_evergreen: 0 | 1;
    parent_id: string | null;
    reusable_superset_id: string | null;
    rest_sec: number | null;
  }>(
    `SELECT id, exercise_id, ordering, is_evergreen,
            parent_id, reusable_superset_id, rest_sec
       FROM session_exercise
      WHERE session_id = ?
      ORDER BY ordering ASC`,
    args.session_id
  );

  const setRows = await db.getAllAsync<{
    id: string;
    exercise_id: string;
    weight_kg: number | null;
    reps: number | null;
    ordering: number;
    is_skipped: number;
    set_kind: 'warmup' | 'working' | 'dropset';
    parent_set_id: string | null;
    notes: string | null;
  }>(
    `SELECT id, exercise_id, weight_kg, reps, ordering, is_skipped,
            set_kind, parent_set_id, notes
       FROM "set"
      WHERE session_id = ?
      ORDER BY ordering ASC`,
    args.session_id
  );

  await db.withTransactionAsync(async () => {
    // Wipe the template's existing rows (CASCADE template_set via v009 FK).
    await db.runAsync(
      `DELETE FROM template_set WHERE template_exercise_id IN
         (SELECT id FROM template_exercise WHERE template_id = ?)`,
      args.template_id
    );
    await db.runAsync(
      `DELETE FROM template_exercise WHERE template_id = ?`,
      args.template_id
    );

    // se.id → newly-allocated te.id for parent_id remap.
    const seIdToTeId = new Map<string, string>();
    for (const se of seRows) {
      const teId = args.uuid();
      seIdToTeId.set(se.id, teId);
    }

    for (const se of seRows) {
      const teId = seIdToTeId.get(se.id)!;
      const remappedParent =
        se.parent_id != null ? seIdToTeId.get(se.parent_id) ?? null : null;
      // Compute default_sets from session sets (NOT NULL — count of
      // non-skipped rows, fallback to 1 if zero so the constraint holds).
      const sets = setRows.filter(
        (s) => s.exercise_id === se.exercise_id && s.is_skipped === 0
      );
      await db.runAsync(
        `INSERT INTO template_exercise
           (id, template_id, exercise_id, ordering, default_sets,
            default_reps, default_weight_kg, is_evergreen,
            parent_id, rest_seconds, reusable_superset_id, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)`,
        teId,
        args.template_id,
        se.exercise_id,
        se.ordering,
        Math.max(1, sets.length),
        se.is_evergreen,
        remappedParent,
        se.rest_sec,
        se.reusable_superset_id,
        Date.now()
      );
      // Insert template_set rows from session sets (non-skipped).
      let pos = 0;
      const setIdMap = new Map<string, string>();
      for (const s of sets) {
        const tsId = args.uuid();
        setIdMap.set(s.id, tsId);
      }
      for (const s of sets) {
        const tsId = setIdMap.get(s.id)!;
        const remappedParentSet =
          s.parent_set_id != null
            ? setIdMap.get(s.parent_set_id) ?? null
            : null;
        await db.runAsync(
          `INSERT INTO template_set
             (id, template_exercise_id, position, set_kind, reps, weight,
              parent_set_id, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          tsId,
          teId,
          pos,
          s.set_kind,
          s.reps ?? 0,
          s.weight_kg ?? 0,
          remappedParentSet,
          s.notes
        );
        pos += 1;
      }
    }

    // Bump template.updated_at so it lifts in the templates list.
    await db.runAsync(
      `UPDATE template SET updated_at = ? WHERE id = ?`,
      Date.now(),
      args.template_id
    );
  });
}

/**
 * Build a brand-new Template from the current session's structure.
 * Used by:
 *   - 「另存模板」 (Template-based finish dialog option b) — keeps the
 *     existing template untouched and snapshots the session into a
 *     sibling Template
 *   - 「升級成 Template」 (Freestyle finish dialog option a) — turns a
 *     Freestyle session into a reusable Template + links session.template_id
 *     so future history-detail page knows the session is no longer freestyle
 *
 * Returns the new template's id. Caller decides whether to link the
 * session to it (Freestyle path) or not (另存 path).
 *
 * Slice 10c finish-dialog wire-up.
 */
export async function createTemplateFromSession(
  db: Database,
  args: {
    session_id: string;
    name: string;
    uuid: () => string;
  }
): Promise<string> {
  const templateId = args.uuid();
  const seRows = await db.getAllAsync<{
    id: string;
    exercise_id: string;
    ordering: number;
    is_evergreen: 0 | 1;
    parent_id: string | null;
    reusable_superset_id: string | null;
    rest_sec: number | null;
  }>(
    `SELECT id, exercise_id, ordering, is_evergreen,
            parent_id, reusable_superset_id, rest_sec
       FROM session_exercise
      WHERE session_id = ?
      ORDER BY ordering ASC`,
    args.session_id
  );
  const setRows = await db.getAllAsync<{
    id: string;
    exercise_id: string;
    weight_kg: number | null;
    reps: number | null;
    ordering: number;
    is_skipped: number;
    set_kind: 'warmup' | 'working' | 'dropset';
    parent_set_id: string | null;
    notes: string | null;
  }>(
    `SELECT id, exercise_id, weight_kg, reps, ordering, is_skipped,
            set_kind, parent_set_id, notes
       FROM "set"
      WHERE session_id = ?
      ORDER BY ordering ASC`,
    args.session_id
  );
  const now = Date.now();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO template (id, name, created_at, updated_at)
       VALUES (?, ?, ?, ?)`,
      templateId,
      args.name,
      now,
      now
    );
    const seIdToTeId = new Map<string, string>();
    for (const se of seRows) seIdToTeId.set(se.id, args.uuid());
    for (const se of seRows) {
      const teId = seIdToTeId.get(se.id)!;
      const remappedParent =
        se.parent_id != null ? seIdToTeId.get(se.parent_id) ?? null : null;
      const sets = setRows.filter(
        (s) => s.exercise_id === se.exercise_id && s.is_skipped === 0
      );
      await db.runAsync(
        `INSERT INTO template_exercise
           (id, template_id, exercise_id, ordering, default_sets,
            default_reps, default_weight_kg, is_evergreen,
            parent_id, rest_seconds, reusable_superset_id, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)`,
        teId,
        templateId,
        se.exercise_id,
        se.ordering,
        Math.max(1, sets.length),
        se.is_evergreen,
        remappedParent,
        se.rest_sec,
        se.reusable_superset_id,
        now
      );
      const setIdMap = new Map<string, string>();
      for (const s of sets) setIdMap.set(s.id, args.uuid());
      let pos = 0;
      for (const s of sets) {
        const tsId = setIdMap.get(s.id)!;
        const remappedParentSet =
          s.parent_set_id != null
            ? setIdMap.get(s.parent_set_id) ?? null
            : null;
        await db.runAsync(
          `INSERT INTO template_set
             (id, template_exercise_id, position, set_kind, reps, weight,
              parent_set_id, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          tsId,
          teId,
          pos,
          s.set_kind,
          s.reps ?? 0,
          s.weight_kg ?? 0,
          remappedParentSet,
          s.notes
        );
        pos += 1;
      }
    }
  });
  return templateId;
}

/**
 * Link a Freestyle session to a newly-created template (sets
 * session_exercise.template_id on every plan row). Used by the
 * Freestyle finish dialog's 「升級成 Template」 option to flip the
 * session's identity from freestyle → template-based.
 */
export async function linkSessionToTemplate(
  db: Database,
  args: { session_id: string; template_id: string }
): Promise<void> {
  await db.runAsync(
    `UPDATE session_exercise SET template_id = ? WHERE session_id = ?`,
    args.template_id,
    args.session_id
  );
}
