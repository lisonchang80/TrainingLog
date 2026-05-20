import type { Database } from '../../db/types';
import type { SetRow, RecordSetInput } from '../../domain/set/types';
import type { SetKind } from '../../domain/set/setLabels';
import { validateRecordSet } from '../../domain/set/validateRecordSet';
import { createSession, endSession } from './sessionRepository';

/**
 * Insert one set row directly. Caller supplies all fields including
 * IDs/timestamps.
 *
 * `session_exercise_id` (v019) is optional on the type — production
 * callers should provide it via the higher-level helpers (recordSetInSession
 * etc) so within-session card isolation works. When NULL, the row joins to
 * its session_exercise via the legacy (session_id, exercise_id) heuristic
 * which is fine for single-card-per-exercise fixtures.
 */
export async function insertSet(
  db: Database,
  set: SetRow & { session_exercise_id?: string | null }
): Promise<void> {
  await db.runAsync(
    `INSERT INTO "set" (id, session_id, exercise_id, weight_kg, reps,
                        is_skipped, ordering, created_at, session_exercise_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    set.id,
    set.session_id,
    set.exercise_id,
    set.weight_kg,
    set.reps,
    set.is_skipped,
    set.ordering,
    set.created_at,
    set.session_exercise_id ?? null
  );
}

/**
 * Insert one set row including v015 lifecycle columns (set_kind /
 * parent_set_id). Slice 10c Phase 2 commit 7a uses this for tap-label
 * cycle's dropset-follower add: the new row needs set_kind='dropset' +
 * parent_set_id pointing at the head. Plain `insertSet` relies on DB
 * defaults (set_kind='working', parent_set_id=NULL) which works for the
 * normal "+ 新增 1 組" path but not for follower inserts.
 *
 * is_logged always defaults to 0 — newly inserted rows are not yet
 * completed. is_skipped is taken from caller (typical: 0).
 *
 * `session_exercise_id` (v019, slice 10c #17 isolation fix): production
 * callers MUST pass this — it's the only way to disambiguate two
 * session_exercise cards that share the same `exercise_id` (e.g. RS A
 * side Cable Crossover + solo Cable Crossover in the same session). Left
 * optional in the type to keep legacy fixture tests (where the bug doesn't
 * apply because there's only one card per exercise) compiling without
 * mass edits — they store NULL and rely on `(session_id, exercise_id)`
 * uniqueness within the fixture.
 */
export async function insertSessionSet(
  db: Database,
  set: SetRow & {
    set_kind: SetKind;
    parent_set_id: string | null;
    session_exercise_id?: string | null;
  }
): Promise<void> {
  await db.runAsync(
    `INSERT INTO "set" (id, session_id, exercise_id, weight_kg, reps,
                        is_skipped, ordering, created_at,
                        set_kind, parent_set_id, session_exercise_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    set.id,
    set.session_id,
    set.exercise_id,
    set.weight_kg,
    set.reps,
    set.is_skipped,
    set.ordering,
    set.created_at,
    set.set_kind,
    set.parent_set_id,
    set.session_exercise_id ?? null
  );
}

/**
 * Delete a set row. Cascades into the dropset chain when the target row is a
 * dropset HEAD: all rows with `parent_set_id = set_id` are deleted in the
 * same transaction so no follower is left orphaned (parent_set_id pointing
 * to a nonexistent head) — symptom user saw 2026-05-20 after swipe-deleting
 * a dropset head: 2 empty-label rows remained on the card with no D1 head.
 *
 * For non-dropset rows OR dropset followers, the cascade DELETE is a no-op
 * (only dropset heads accumulate followers), so the function is safe to
 * call from every existing delete path.
 *
 * Achievement back-ref handling (2026-05-20 night fix): `achievement_unlock.set_id`
 * has an FK to `set.id` (v008 schema, no ON DELETE clause), so deleting a logged
 * set that earned a PR achievement trips `FOREIGN KEY constraint failed`. We NULL
 * the back-ref BEFORE the DELETE — the achievement record stays unlocked, only the
 * pointer to the originating set is severed. Same treatment for any cascade
 * follower's unlock row, scoped by subquery.
 */
export async function deleteSet(db: Database, set_id: string): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE achievement_unlock SET set_id = NULL
        WHERE set_id = ?
           OR set_id IN (SELECT id FROM "set" WHERE parent_set_id = ?)`,
      set_id,
      set_id
    );
    await db.runAsync(
      `DELETE FROM "set" WHERE parent_set_id = ?`,
      set_id
    );
    await db.runAsync(`DELETE FROM "set" WHERE id = ?`, set_id);
  });
}

export async function listAllSets(db: Database): Promise<SetRow[]> {
  return db.getAllAsync<SetRow>(
    `SELECT id, session_id, exercise_id, weight_kg, reps,
            is_skipped, ordering, created_at
       FROM "set"
      ORDER BY created_at DESC`
  );
}

export interface SetWithExercise extends SetRow {
  exercise_name: string;
}

/**
 * Session-side set row including v015 lifecycle columns (set_kind /
 * parent_set_id / is_logged). Slice 10c Phase 2 commit 6 surfaces these to
 * the TS layer so the session set logger UI can render label / dropset
 * cascade / completion ✓ state without re-querying. Joined with the
 * exercise name for display convenience (same pattern as SetWithExercise).
 *
 * Older call sites that don't care about lifecycle (achievements,
 * exercise-history queries) continue to use `SetWithExercise` and the
 * underlying `SetRow` — extending those types would force an avalanche of
 * downstream changes, so this is intentionally a separate shape.
 */
export interface SessionSetWithExercise extends SetWithExercise {
  set_kind: SetKind;
  parent_set_id: string | null;
  is_logged: number; // 0/1
  notes: string | null;
  /**
   * v019 (slice 10c #17) — owning session_exercise.id. NULL for legacy
   * rows the backfill couldn't match; production rows minted after #17
   * will always have this populated. Within-session filters on the Today
   * tab + session detail page key off this field instead of `exercise_id`
   * to keep two cards that share the same exercise (e.g. RS A side
   * Cable Crossover + solo Cable Crossover) independently editable.
   */
  session_exercise_id: string | null;
}

export async function listAllSetsWithExercise(
  db: Database
): Promise<SetWithExercise[]> {
  return db.getAllAsync<SetWithExercise>(
    `SELECT s.id, s.session_id, s.exercise_id, s.weight_kg, s.reps,
            s.is_skipped, s.ordering, s.created_at,
            e.name AS exercise_name
       FROM "set" s
       JOIN exercise e ON e.id = s.exercise_id
      ORDER BY s.created_at DESC`
  );
}

/**
 * All sets in a single session, ordered by ordering ascending (the order the
 * user recorded them). Used by the Session detail / summary screen and by
 * the Today screen to show "what you've already done in this session".
 */
export async function listSetsBySession(
  db: Database,
  session_id: string
): Promise<SessionSetWithExercise[]> {
  return db.getAllAsync<SessionSetWithExercise>(
    `SELECT s.id, s.session_id, s.exercise_id, s.weight_kg, s.reps,
            s.is_skipped, s.ordering, s.created_at,
            s.set_kind, s.parent_set_id, s.is_logged, s.notes,
            s.session_exercise_id,
            e.name AS exercise_name
       FROM "set" s
       JOIN exercise e ON e.id = s.exercise_id
      WHERE s.session_id = ?
      ORDER BY s.ordering ASC`,
    session_id
  );
}

/**
 * Patch fields on an existing set row. Slice 10c Phase 2 commit 6 adds
 * this so the session card's inline `<SetRowContent>` can persist
 * weight/reps edits as the user types (debounce is at the UI layer; the
 * repo just runs the UPDATE). Future commits use the same method for
 * `set_kind` (tap-label cycle) and `is_logged` (tap-✓ complete).
 *
 * Only the keys present on `patch` are written — undefined keys are
 * skipped so callers can partial-update without re-reading the row first.
 */
export async function updateSetFields(
  db: Database,
  set_id: string,
  patch: {
    weight_kg?: number;
    reps?: number;
    set_kind?: SetKind;
    parent_set_id?: string | null;
    is_logged?: number;
    notes?: string | null;
  }
): Promise<void> {
  const cols: string[] = [];
  const vals: (string | number | null)[] = [];
  if (patch.weight_kg !== undefined) {
    cols.push('weight_kg = ?');
    vals.push(patch.weight_kg);
  }
  if (patch.reps !== undefined) {
    cols.push('reps = ?');
    vals.push(patch.reps);
  }
  if (patch.set_kind !== undefined) {
    cols.push('set_kind = ?');
    vals.push(patch.set_kind);
  }
  if (patch.parent_set_id !== undefined) {
    cols.push('parent_set_id = ?');
    vals.push(patch.parent_set_id);
  }
  if (patch.is_logged !== undefined) {
    cols.push('is_logged = ?');
    vals.push(patch.is_logged);
  }
  if (patch.notes !== undefined) {
    cols.push('notes = ?');
    vals.push(patch.notes);
  }
  if (cols.length === 0) return; // nothing to update
  vals.push(set_id);
  await db.runAsync(
    `UPDATE "set" SET ${cols.join(', ')} WHERE id = ?`,
    ...vals
  );
}

/**
 * Atomic "one cycle ✓" mark for a cluster row pair (ADR-0019 Q16, slice
 * 10c Phase 7). Sets `is_logged = 1` on BOTH sides of a cluster cycle in
 * a single transaction — if either UPDATE throws, neither side is
 * committed (better-sqlite3 BEGIN/COMMIT/ROLLBACK per
 * `withTransactionAsync`).
 *
 * Either-side null short-cycle (asymmetric A=4 B=3 cycle 4 → b_set=null)
 * is the caller's responsibility — they shouldn't invoke this with a
 * null id (the UI surfaces "—" placeholder per Q8 (d) AS1 and disables
 * tap-✓ for those slots). This function is intentionally strict on the
 * id-pair contract so a bug in the caller surfaces as a SQL "row not
 * found" rather than a silent partial write.
 *
 * No cascade to the underlying `parent_set_id` dropset-follower chain —
 * cluster sibling mirror per ADR-0019 line 709 is warmup ↔ working only
 * (see `cycleSessionSetKindClusterAware`), and is_logged is independent
 * of set_kind cycling anyway.
 */
export async function markClusterCycleLogged(
  db: Database,
  args: { a_set_id: string; b_set_id: string }
): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE "set" SET is_logged = 1 WHERE id = ?`,
      args.a_set_id
    );
    await db.runAsync(
      `UPDATE "set" SET is_logged = 1 WHERE id = ?`,
      args.b_set_id
    );
  });
}

/**
 * Inverse of `markClusterCycleLogged` — atomic "uncheck cycle ✓" for a
 * cluster row pair. Per ADR-0019 Q2.3 (d) Y2 (un-logging cancels the
 * "set complete" side-effects), the UI calls this when tapping ✓ on a
 * cycle row that's already both-logged.
 */
export async function markClusterCycleUnlogged(
  db: Database,
  args: { a_set_id: string; b_set_id: string }
): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE "set" SET is_logged = 0 WHERE id = ?`,
      args.a_set_id
    );
    await db.runAsync(
      `UPDATE "set" SET is_logged = 0 WHERE id = ?`,
      args.b_set_id
    );
  });
}

/**
 * Atomic "delete one cycle row" for a cluster pair (ADR-0019 Q8 left-swipe
 * cycle row → 刪 — mirrors template editor's `deleteSupersetRowAt`).
 *
 * Single transaction → either both sides delete or neither. Asymmetric short
 * side (b_set_id=null) is handled — only the A side gets deleted, which lets
 * the user prune extra A-side cycles down to match B-side. Defensive against
 * either id being unknown (DELETE WHERE id = unknown is a no-op in SQLite).
 */
export async function deleteClusterCycle(
  db: Database,
  args: { a_set_id: string | null; b_set_id: string | null }
): Promise<void> {
  await db.withTransactionAsync(async () => {
    // 同 deleteSet：清 achievement_unlock 的 back-ref 避免 FK 違反。
    if (args.a_set_id) {
      await db.runAsync(
        `UPDATE achievement_unlock SET set_id = NULL WHERE set_id = ?`,
        args.a_set_id,
      );
      await db.runAsync(`DELETE FROM "set" WHERE id = ?`, args.a_set_id);
    }
    if (args.b_set_id) {
      await db.runAsync(
        `UPDATE achievement_unlock SET set_id = NULL WHERE set_id = ?`,
        args.b_set_id,
      );
      await db.runAsync(`DELETE FROM "set" WHERE id = ?`, args.b_set_id);
    }
  });
}

/**
 * Atomic "clone one cycle row" — inserts a new A+B set pair right after the
 * existing pair, copying weight_kg / reps / set_kind from the source. Used
 * by cluster cycle row right-swipe 加 (mirrors template's `cloneSupersetRowAt`).
 *
 * Ordering: simple MAX+1 within session (cluster cycles don't share an
 * ordering namespace across A/B sides — each exercise_id has its own MAX).
 * is_logged is reset to 0 on the new copies (a clone is "to-do, not done").
 *
 * Asymmetric handling: if either side is null (no source on that side), the
 * clone for that side is skipped. The caller decides whether asymmetric
 * clone is allowed for the UI affordance.
 */
export async function cloneClusterCycle(
  db: Database,
  args: {
    a_source: { id: string; exercise_id: string; session_exercise_id?: string | null } | null;
    b_source: { id: string; exercise_id: string; session_exercise_id?: string | null } | null;
    session_id: string;
    new_a_set_id: string;
    new_b_set_id: string;
    now?: () => number;
  }
): Promise<void> {
  const now = (args.now ?? (() => Date.now()))();
  await db.withTransactionAsync(async () => {
    // v019 isolation fix (slice 10c #17): scope MAX(ordering) to the
    // session_exercise_id when caller provides it — without this, a cluster
    // card and a solo card sharing the same exercise_id collide on the
    // bare `(session_id, exercise_id)` MAX and one side's new row jumps
    // to the wrong ordering bucket. Falls back to the legacy
    // (session_id, exercise_id) MAX for callers that don't supply the id
    // (test fixtures pre-#17).
    const maxFor = async (
      exercise_id: string,
      session_exercise_id?: string | null
    ) => {
      if (session_exercise_id) {
        const row = await db.getFirstAsync<{ max_ord: number | null }>(
          `SELECT MAX(ordering) AS max_ord FROM "set"
            WHERE session_exercise_id = ?`,
          session_exercise_id
        );
        return (row?.max_ord ?? 0) + 1;
      }
      const row = await db.getFirstAsync<{ max_ord: number | null }>(
        `SELECT MAX(ordering) AS max_ord FROM "set"
          WHERE session_id = ? AND exercise_id = ?`,
        args.session_id,
        exercise_id
      );
      return (row?.max_ord ?? 0) + 1;
    };

    if (args.a_source) {
      const source = await db.getFirstAsync<{
        weight_kg: number | null;
        reps: number | null;
        set_kind: SetKind;
      }>(
        `SELECT weight_kg, reps, set_kind FROM "set" WHERE id = ?`,
        args.a_source.id
      );
      if (source) {
        await db.runAsync(
          `INSERT INTO "set" (id, session_id, exercise_id, weight_kg, reps,
                              is_skipped, ordering, created_at,
                              set_kind, parent_set_id, is_logged,
                              session_exercise_id)
           VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, NULL, 0, ?)`,
          args.new_a_set_id,
          args.session_id,
          args.a_source.exercise_id,
          source.weight_kg,
          source.reps,
          await maxFor(args.a_source.exercise_id, args.a_source.session_exercise_id),
          now,
          source.set_kind,
          args.a_source.session_exercise_id ?? null
        );
      }
    }
    if (args.b_source) {
      const source = await db.getFirstAsync<{
        weight_kg: number | null;
        reps: number | null;
        set_kind: SetKind;
      }>(
        `SELECT weight_kg, reps, set_kind FROM "set" WHERE id = ?`,
        args.b_source.id
      );
      if (source) {
        await db.runAsync(
          `INSERT INTO "set" (id, session_id, exercise_id, weight_kg, reps,
                              is_skipped, ordering, created_at,
                              set_kind, parent_set_id, is_logged,
                              session_exercise_id)
           VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, NULL, 0, ?)`,
          args.new_b_set_id,
          args.session_id,
          args.b_source.exercise_id,
          source.weight_kg,
          source.reps,
          await maxFor(args.b_source.exercise_id, args.b_source.session_exercise_id),
          now,
          source.set_kind,
          args.b_source.session_exercise_id ?? null
        );
      }
    }
  });
}

/**
 * Atomic "add 1 cycle at end" — inserts a new A+B set pair at the end of the
 * cluster (mirrors template editor's `addSetToSuperset`). Each side defaults
 * to the LAST set's weight_kg / reps for that exercise within this session
 * (動作記憶 within-session), or caller-supplied starter defaults.
 *
 * Caller responsible for: pre-computing default weight/reps (e.g. via the
 * historical 動作記憶 lookup), generating fresh UUIDs, providing exercise ids.
 */
export async function addClusterCycleAtEnd(
  db: Database,
  args: {
    session_id: string;
    a: {
      exercise_id: string;
      new_set_id: string;
      weight_kg: number;
      reps: number;
      session_exercise_id?: string | null;
    };
    b: {
      exercise_id: string;
      new_set_id: string;
      weight_kg: number;
      reps: number;
      session_exercise_id?: string | null;
    };
    set_kind?: SetKind;
    now?: () => number;
  }
): Promise<void> {
  const now = (args.now ?? (() => Date.now()))();
  const set_kind: SetKind = args.set_kind ?? 'working';

  await db.withTransactionAsync(async () => {
    // v019 isolation fix: scope MAX(ordering) to session_exercise_id when
    // provided. See cloneClusterCycle for the rationale.
    const maxFor = async (
      exercise_id: string,
      session_exercise_id?: string | null
    ) => {
      if (session_exercise_id) {
        const row = await db.getFirstAsync<{ max_ord: number | null }>(
          `SELECT MAX(ordering) AS max_ord FROM "set"
            WHERE session_exercise_id = ?`,
          session_exercise_id
        );
        return (row?.max_ord ?? 0) + 1;
      }
      const row = await db.getFirstAsync<{ max_ord: number | null }>(
        `SELECT MAX(ordering) AS max_ord FROM "set"
          WHERE session_id = ? AND exercise_id = ?`,
        args.session_id,
        exercise_id
      );
      return (row?.max_ord ?? 0) + 1;
    };
    const aOrder = await maxFor(args.a.exercise_id, args.a.session_exercise_id);
    const bOrder = await maxFor(args.b.exercise_id, args.b.session_exercise_id);

    await db.runAsync(
      `INSERT INTO "set" (id, session_id, exercise_id, weight_kg, reps,
                          is_skipped, ordering, created_at,
                          set_kind, parent_set_id, is_logged,
                          session_exercise_id)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, NULL, 0, ?)`,
      args.a.new_set_id,
      args.session_id,
      args.a.exercise_id,
      args.a.weight_kg,
      args.a.reps,
      aOrder,
      now,
      set_kind,
      args.a.session_exercise_id ?? null
    );
    await db.runAsync(
      `INSERT INTO "set" (id, session_id, exercise_id, weight_kg, reps,
                          is_skipped, ordering, created_at,
                          set_kind, parent_set_id, is_logged,
                          session_exercise_id)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, NULL, 0, ?)`,
      args.b.new_set_id,
      args.session_id,
      args.b.exercise_id,
      args.b.weight_kg,
      args.b.reps,
      bOrder,
      now,
      set_kind,
      args.b.session_exercise_id ?? null
    );
  });
}

/**
 * Insert one set into an OPEN session. Caller must ensure the session exists
 * and is still in_progress (per the Session Manager state machine).
 *
 * Ordering is computed as (current max ordering in session) + 1, scoped per
 * session so each session counts from 1. UUID is REQUIRED (no default) — see
 * the same Hermes-no-global-crypto note on `recordSetAsAutoSession`.
 */
export async function recordSetInSession(
  db: Database,
  args: {
    session_id: string;
    input: RecordSetInput;
    uuid: () => string;
    now?: () => number;
    /**
     * v019 isolation fix (slice 10c #17). Production callers pass the
     * owning `session_exercise.id` so the new set rows links unambiguously
     * to one card even when another card in the same session targets the
     * same exercise_id. Left optional to preserve legacy test fixtures.
     */
    session_exercise_id?: string | null;
  }
): Promise<{ set_id: string; ordering: number; created_at: number }> {
  const err = validateRecordSet(args.input);
  if (err) throw new Error(err);

  const set_id = args.uuid();
  const now = args.now ?? Date.now;
  const ts = now();

  const row = await db.getFirstAsync<{ max_ordering: number | null }>(
    `SELECT MAX(ordering) AS max_ordering FROM "set" WHERE session_id = ?`,
    args.session_id
  );
  const ordering = (row?.max_ordering ?? 0) + 1;

  await insertSet(db, {
    id: set_id,
    session_id: args.session_id,
    exercise_id: args.input.exercise_id,
    weight_kg: args.input.weight_kg,
    reps: args.input.reps,
    is_skipped: 0,
    ordering,
    created_at: ts,
    session_exercise_id: args.session_exercise_id ?? null,
  });

  return { set_id, ordering, created_at: ts };
}

/**
 * Pre-fill a freshly added session_exercise's set rows from the user's
 * LAST session for that exercise (slice 10c Phase 2 — [+ 動作] picker UX
 * polish per user "如果有以前的記錄，會載入最後一次的紀錄").
 *
 * Behaviour:
 *   - Looks up the most recent session that contains any non-skipped set
 *     for `exercise_id`, EXCLUDING the current session
 *   - Copies that session's set list verbatim (weight / reps / set_kind /
 *     ordering within exercise) into the current session, appended to
 *     current session's MAX(ordering)
 *   - All copied rows have `is_logged = 0` (user must tick to confirm)
 *   - Returns count of inserted rows (0 if no history exists → caller can
 *     fall back to template defaults / leave empty)
 *
 * Returns 0 silently when no prior session exists — not an error case.
 */
export async function prefillSessionExerciseFromLastSession(
  db: Database,
  args: {
    session_id: string;
    exercise_id: string;
    uuid: () => string;
    now?: () => number;
    /**
     * v019 isolation fix: the owning session_exercise.id. Tagged onto each
     * cloned set row so the new card is independently filterable even when
     * another card in the same session shares the same exercise_id (the
     * RS A + solo same-exercise bug scenario).
     */
    session_exercise_id?: string | null;
  }
): Promise<number> {
  // Find most recent session_id (excl current) that has any LOGGED set for
  // this exercise. is_logged=1 is the single source of truth for "this set
  // actually happened" (ADR-0019); filtering ensures an in-progress prior
  // session's still-unchecked planned values don't bleed into the new
  // session (sibling fix to commit 1f255f5 in exerciseHistoryRepository).
  const lastSession = await db.getFirstAsync<{ session_id: string }>(
    `SELECT s.session_id
       FROM "set" s
       JOIN session ss ON ss.id = s.session_id
      WHERE s.exercise_id = ?
        AND s.is_skipped = 0
        AND s.is_logged = 1
        AND s.session_id != ?
      ORDER BY s.created_at DESC, s.id DESC
      LIMIT 1`,
    args.exercise_id,
    args.session_id
  );
  if (!lastSession) return 0;

  // Pull that session's full LOGGED set list for this exercise, sorted ASC by
  // ordering (preserves warmup-before-working flow). is_logged=1 filter is
  // load-bearing for the same reason as the lookup above: a partially-logged
  // prior session must only contribute the sets the user actually ticked.
  const sourceSets = await db.getAllAsync<{
    weight_kg: number | null;
    reps: number | null;
    set_kind: SetKind;
  }>(
    `SELECT weight_kg, reps, set_kind
       FROM "set"
      WHERE session_id = ? AND exercise_id = ?
        AND is_skipped = 0
        AND is_logged = 1
      ORDER BY ordering ASC`,
    lastSession.session_id,
    args.exercise_id
  );
  if (sourceSets.length === 0) return 0;

  // Current session MAX ordering — new rows append after.
  const maxRow = await db.getFirstAsync<{ max_ordering: number | null }>(
    `SELECT MAX(ordering) AS max_ordering FROM "set" WHERE session_id = ?`,
    args.session_id
  );
  const baseOrdering = maxRow?.max_ordering ?? 0;

  const now = args.now ?? Date.now;
  const ts = now();
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < sourceSets.length; i++) {
      const src = sourceSets[i];
      await insertSessionSet(db, {
        id: args.uuid(),
        session_id: args.session_id,
        exercise_id: args.exercise_id,
        weight_kg: src.weight_kg ?? 0,
        reps: src.reps ?? 0,
        is_skipped: 0,
        ordering: baseOrdering + i + 1,
        created_at: ts,
        set_kind: src.set_kind,
        parent_set_id: null, // Don't carry over cluster pairing on prefill.
        session_exercise_id: args.session_exercise_id ?? null,
      });
    }
  });

  return sourceSets.length;
}

/**
 * RS prefill counterpart of `prefillSessionExerciseFromLastSession` — when
 * the user picks a Reusable Superset template into the active session, copy
 * the set structure of that template's LAST ended session into the freshly-
 * minted A + B cards (slice 10c overnight #25).
 *
 * Why scoped to `reusable_superset_id` (NOT individual exercise history):
 * RS cards are deliberately isolated from solo exercise memory (per earlier
 * decision「超級組應視為新的動作，不該開起來已經有個別運動的記憶」).
 * Pulling from the SAME RS template is a different axis — it's the same
 * environment, so the user expects last-time's structure to carry over.
 * Solo exercise history with the same exercise_id stays out of scope.
 *
 * Implementation: locate the most recent ended session that has any logged
 * set inside ANY session_exercise carrying this `reusable_superset_id`,
 * then delegate to `replayClusterCardSetsFromHistoricalSession` which
 * already handles wipe + dropset-chain remap + transaction wrap + per-side
 * empty-source DELETE semantics.
 *
 * Returns 0 (silently) when no history exists — caller renders the empty
 * card state ("還沒有組") unchanged.
 */
export async function prefillReusableSupersetFromLastSession(
  db: Database,
  args: {
    current_session_id: string;
    reusable_superset_id: string;
    new_a_session_exercise_id: string;
    new_b_session_exercise_id: string;
    uuid: () => string;
    now?: () => number;
  }
): Promise<number> {
  // Find the most recent ended session containing this RS template that has
  // at least one logged set across either side. The EXISTS clause guards
  // against an ended-but-empty session leaking through (RS planned but no
  // sets ever ticked).
  const lastSession = await db.getFirstAsync<{ session_id: string }>(
    `SELECT s.id AS session_id
       FROM session s
       JOIN session_exercise se ON se.session_id = s.id
      WHERE se.reusable_superset_id = ?
        AND s.ended_at IS NOT NULL
        AND s.id != ?
        AND EXISTS (
          SELECT 1 FROM "set" st
           WHERE st.session_exercise_id = se.id
             AND st.is_logged = 1
             AND st.is_skipped = 0
        )
      ORDER BY s.ended_at DESC
      LIMIT 1`,
    args.reusable_superset_id,
    args.current_session_id
  );
  if (!lastSession) return 0;

  // Resolve A side / B side session_exercise rows in the source session.
  // A side is the parent (parent_id IS NULL); B side is the follower
  // (parent_id = A.id). Ordering ASC puts A first by construction (see
  // appendReusableSupersetToSession), but parent_id is the authoritative
  // discriminator.
  const seRows = await db.getAllAsync<{
    id: string;
    parent_id: string | null;
    exercise_id: string;
  }>(
    `SELECT id, parent_id, exercise_id
       FROM session_exercise
      WHERE session_id = ?
        AND reusable_superset_id = ?
      ORDER BY ordering ASC`,
    lastSession.session_id,
    args.reusable_superset_id
  );
  const sideA = seRows.find((r) => r.parent_id === null);
  const sideB = seRows.find((r) => r.parent_id !== null);
  if (!sideA || !sideB) return 0; // Defensive: malformed RS pair in history.

  const result = await replayClusterCardSetsFromHistoricalSession(db, {
    current_session_id: args.current_session_id,
    current_se_id_a: args.new_a_session_exercise_id,
    current_se_id_b: args.new_b_session_exercise_id,
    source_session_id: lastSession.session_id,
    // #27 isolation — thread the source A/B session_exercise ids so the
    // helper's source SELECT can scope by card, not just (session, exercise).
    source_session_exercise_id_a: sideA.id,
    source_session_exercise_id_b: sideB.id,
    source_exercise_id_a: sideA.exercise_id,
    source_exercise_id_b: sideB.exercise_id,
    uuid: args.uuid,
    now: args.now,
  });

  return result.inserted_a + result.inserted_b;
}

/**
 * Insert a new set immediately AFTER the given source set, preserving the
 * source's exercise / weight / reps / set_kind (slice 10c Phase 2 — fix
 * right-swipe `+1` action so the new row appears directly under the swiped
 * row instead of jumping to the bottom of the session list).
 *
 * Implementation: shift all `set` rows in this session with
 * `ordering >= source.ordering + 1` by +1, then INSERT at the freed slot.
 * Whole operation in a transaction so partial shifts can't leave gaps.
 *
 * `set.ordering` is global per session (not per exercise), so the shift
 * also bumps OTHER exercises' sets that happen to live after source —
 * but their relative order to each other is preserved, so users don't
 * see anything weird in their respective cards.
 *
 * Inherits `parent_set_id` = NULL by default (right-swipe +1 always
 * creates a sibling, not a dropset follower). Caller can wrap a follow-up
 * `updateSetFields` if they need to convert it later.
 */
export async function insertSessionSetAfter(
  db: Database,
  args: {
    session_id: string;
    source_set_id: string;
    uuid: () => string;
    now?: () => number;
  }
): Promise<{ set_id: string; ordering: number; created_at: number }> {
  const src = await db.getFirstAsync<{
    exercise_id: string;
    ordering: number;
    weight_kg: number | null;
    reps: number | null;
    set_kind: SetKind;
    session_exercise_id: string | null;
  }>(
    `SELECT exercise_id, ordering, weight_kg, reps, set_kind, session_exercise_id
       FROM "set" WHERE id = ? AND session_id = ?`,
    args.source_set_id,
    args.session_id
  );
  if (!src) {
    throw new Error(
      `insertSessionSetAfter: source set "${args.source_set_id}" not found in session "${args.session_id}"`
    );
  }

  const new_set_id = args.uuid();
  const now = args.now ?? Date.now;
  const ts = now();
  const new_ordering = src.ordering + 1;

  await db.withTransactionAsync(async () => {
    // Shift everything from new_ordering onwards down by 1 to free the slot.
    await db.runAsync(
      `UPDATE "set" SET ordering = ordering + 1
        WHERE session_id = ? AND ordering >= ?`,
      args.session_id,
      new_ordering
    );
    // Insert at the freed slot, mirroring source's exercise / kind / values.
    // v019 isolation fix: inherit source's session_exercise_id so the new
    // sibling lands on the SAME card (cluster A side stays on A, never
    // leaks to a coincidentally-same-exercise solo card).
    await insertSessionSet(db, {
      id: new_set_id,
      session_id: args.session_id,
      exercise_id: src.exercise_id,
      weight_kg: src.weight_kg ?? 0,
      reps: src.reps ?? 0,
      is_skipped: 0,
      ordering: new_ordering,
      created_at: ts,
      set_kind: src.set_kind,
      parent_set_id: null,
      session_exercise_id: src.session_exercise_id,
    });
  });

  return { set_id: new_set_id, ordering: new_ordering, created_at: ts };
}

/**
 * Append one new follower row to an existing dropset chain (slice 10c
 * overnight #61 — wire the `+` button on the cluster-last follower in the
 * active session / session detail edit mode, mirroring template editor's
 * `addDropsetRow` at template-editor-view.tsx lines 443-474).
 *
 * `after_set_id` may be the chain HEAD or any existing follower. Either
 * way the new row gets `parent_set_id = headId` (the chain head), so the
 * chain stays flat (no follower-of-follower). The new row's
 * `set_kind = 'dropset'`, weight / reps mirror the source row, and
 * `session_exercise_id` (v019) is inherited from the source so cluster
 * isolation invariants stay intact (RS A side never leaks to a coincidentally-
 * same-exercise solo card).
 *
 * Ordering: shift all `set` rows with `ordering >= source.ordering + 1` by
 * +1 to free the slot directly after `after_set_id`, then INSERT at that
 * slot. Mirrors `insertSessionSetAfter` (same transaction-wrapped shift
 * pattern, lines 823-847) so the new row appears IMMEDIATELY below the
 * tapped one, not at the end of the chain.
 *
 * Throws if `after_set_id` is not in the session OR is not a dropset row.
 */
export async function addSessionDropsetRow(
  db: Database,
  args: {
    session_id: string;
    after_set_id: string;
    uuid: () => string;
    now?: () => number;
  }
): Promise<{ set_id: string; ordering: number; created_at: number }> {
  const src = await db.getFirstAsync<{
    id: string;
    exercise_id: string;
    ordering: number;
    weight_kg: number | null;
    reps: number | null;
    set_kind: SetKind;
    parent_set_id: string | null;
    session_exercise_id: string | null;
  }>(
    `SELECT id, exercise_id, ordering, weight_kg, reps, set_kind,
            parent_set_id, session_exercise_id
       FROM "set" WHERE id = ? AND session_id = ?`,
    args.after_set_id,
    args.session_id
  );
  if (!src) {
    throw new Error(
      `addSessionDropsetRow: source set "${args.after_set_id}" not found in session "${args.session_id}"`
    );
  }
  if (src.set_kind !== 'dropset') {
    throw new Error(
      `addSessionDropsetRow: source set "${args.after_set_id}" is not a dropset row (set_kind="${src.set_kind}")`
    );
  }

  const headId = src.parent_set_id ?? src.id;
  const new_set_id = args.uuid();
  const now = args.now ?? Date.now;
  const ts = now();
  const new_ordering = src.ordering + 1;

  await db.withTransactionAsync(async () => {
    // Shift everything from new_ordering onwards down by 1 to free the slot.
    await db.runAsync(
      `UPDATE "set" SET ordering = ordering + 1
        WHERE session_id = ? AND ordering >= ?`,
      args.session_id,
      new_ordering
    );
    // Insert new follower in the freed slot, attached to chain head.
    await insertSessionSet(db, {
      id: new_set_id,
      session_id: args.session_id,
      exercise_id: src.exercise_id,
      weight_kg: src.weight_kg ?? 0,
      reps: src.reps ?? 0,
      is_skipped: 0,
      ordering: new_ordering,
      created_at: ts,
      set_kind: 'dropset',
      parent_set_id: headId,
      session_exercise_id: src.session_exercise_id,
    });
  });

  return { set_id: new_set_id, ordering: new_ordering, created_at: ts };
}

/**
 * Remove one follower row from a dropset chain (slice 10c overnight #61 —
 * wire the `−` button on dropset followers in active session / session
 * detail edit mode, mirroring template editor's `removeDropsetRow` at
 * template-editor-view.tsx lines 476-504).
 *
 * Refuses to delete if the chain (head + followers) would shrink below 2
 * rows — a dropset chain must always have at least head + 1 follower to
 * be a meaningful chain. To delete the entire chain, caller should swipe-
 * delete the HEAD instead (or use `deleteSet` on the head from this
 * function's POV but `deleteSet` doesn't cascade — separate concern).
 *
 * Throws `DROPSET_CHAIN_TOO_SHORT` when the guard fires (callers
 * Alert.alert the user). Also throws if `set_id` is not a dropset FOLLOWER
 * — passing in the head is a programming error (use `deleteSet` for the
 * head).
 *
 * No ordering compaction here — `deleteSet` leaves the gap in the global
 * `set.ordering` space and that's fine (subsequent sets stay in their
 * existing ASC order; only `<` / `>` matter, not contiguous integers).
 * Same convention as `deleteSet` at lines 93-95.
 */
/**
 * Append a NEW dropset cluster after `after_set_id`, cloning the source
 * chain's structure (same number of rows). Used by 「新增 1 組」 + 右滑 +1
 * when the exercise's last set is already a dropset — user intent is
 * 「複製 D1 結構」: if D1 had head + 3 followers (4 rows), the new D2 also
 * gets head + 3 followers. Inline +/- buttons in the chain still extend
 * the same chain via `addSessionDropsetRow`.
 *
 * Chain detection: resolve the source row's chain head (its
 * `parent_set_id` if follower, else itself), then count
 * `id = headId OR parent_set_id = headId`. New cluster gets the same count
 * of rows: 1 head + (count - 1) followers. All rows inherit weight/reps
 * row-by-row from the source chain in order (head→follower1→follower2…),
 * so a varied-weight drop schedule replicates verbatim.
 *
 * All rows transactioned with ordering shift; session_exercise_id inherited
 * from source for v019 isolation.
 */
export async function addSessionDropsetCluster(
  db: Database,
  args: {
    session_id: string;
    after_set_id: string;
    uuid: () => string;
    now?: () => number;
  }
): Promise<{ head_id: string; follower_ids: string[] }> {
  const src = await db.getFirstAsync<{
    id: string;
    exercise_id: string;
    ordering: number;
    weight_kg: number | null;
    reps: number | null;
    set_kind: SetKind;
    parent_set_id: string | null;
    session_exercise_id: string | null;
  }>(
    `SELECT id, exercise_id, ordering, weight_kg, reps, set_kind,
            parent_set_id, session_exercise_id
       FROM "set" WHERE id = ? AND session_id = ?`,
    args.after_set_id,
    args.session_id
  );
  if (!src) {
    throw new Error(
      `addSessionDropsetCluster: source set "${args.after_set_id}" not found in session "${args.session_id}"`
    );
  }

  // Resolve source chain HEAD id and fetch all chain rows ordered ASC so we
  // can clone weight/reps row-by-row (preserves any per-row drop schedule).
  const sourceHeadId = src.parent_set_id ?? src.id;
  const chainRows = await db.getAllAsync<{
    id: string;
    ordering: number;
    weight_kg: number | null;
    reps: number | null;
  }>(
    `SELECT id, ordering, weight_kg, reps
       FROM "set"
      WHERE session_id = ?
        AND (id = ? OR parent_set_id = ?)
      ORDER BY ordering ASC`,
    args.session_id,
    sourceHeadId,
    sourceHeadId
  );
  if (chainRows.length === 0) {
    throw new Error(
      `addSessionDropsetCluster: source chain head "${sourceHeadId}" had no rows`
    );
  }

  // Find last row of source chain — new cluster lands AFTER this row.
  const lastInChain = chainRows[chainRows.length - 1];
  const head_id = args.uuid();
  const follower_ids = chainRows.slice(1).map(() => args.uuid());
  const totalNewRows = chainRows.length; // 1 head + N followers, same count as source
  const now = args.now ?? Date.now;
  const ts = now();
  const head_ordering = lastInChain.ordering + 1;

  await db.withTransactionAsync(async () => {
    // Free `totalNewRows` ordering slots directly after the source chain.
    await db.runAsync(
      `UPDATE "set" SET ordering = ordering + ?
        WHERE session_id = ? AND ordering >= ?`,
      totalNewRows,
      args.session_id,
      head_ordering
    );
    // Insert new HEAD (cloned from source head's weight/reps).
    await insertSessionSet(db, {
      id: head_id,
      session_id: args.session_id,
      exercise_id: src.exercise_id,
      weight_kg: chainRows[0].weight_kg ?? 0,
      reps: chainRows[0].reps ?? 0,
      is_skipped: 0,
      ordering: head_ordering,
      created_at: ts,
      set_kind: 'dropset',
      parent_set_id: null,
      session_exercise_id: src.session_exercise_id,
    });
    // Insert followers (cloned from source followers, in order).
    for (let i = 0; i < follower_ids.length; i++) {
      const srcRow = chainRows[i + 1];
      await insertSessionSet(db, {
        id: follower_ids[i],
        session_id: args.session_id,
        exercise_id: src.exercise_id,
        weight_kg: srcRow.weight_kg ?? 0,
        reps: srcRow.reps ?? 0,
        is_skipped: 0,
        ordering: head_ordering + 1 + i,
        created_at: ts,
        set_kind: 'dropset',
        parent_set_id: head_id,
        session_exercise_id: src.session_exercise_id,
      });
    }
  });

  return { head_id, follower_ids };
}

export async function removeSessionDropsetRow(
  db: Database,
  args: { session_id: string; set_id: string }
): Promise<void> {
  const row = await db.getFirstAsync<{
    id: string;
    set_kind: SetKind;
    parent_set_id: string | null;
  }>(
    `SELECT id, set_kind, parent_set_id
       FROM "set" WHERE id = ? AND session_id = ?`,
    args.set_id,
    args.session_id
  );
  if (!row) {
    throw new Error(
      `removeSessionDropsetRow: set "${args.set_id}" not found in session "${args.session_id}"`
    );
  }
  if (row.set_kind !== 'dropset') {
    throw new Error(
      `removeSessionDropsetRow: set "${args.set_id}" is not a dropset row`
    );
  }
  if ((row.parent_set_id ?? null) === null) {
    // Head — caller should use deleteSet (full chain delete) instead.
    throw new Error(
      `removeSessionDropsetRow: set "${args.set_id}" is a dropset HEAD; use deleteSet to remove the chain`
    );
  }

  const headId = row.parent_set_id as string;
  // Chain size = head row (id = headId) + all followers (parent_set_id = headId).
  const chainCount = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM "set"
      WHERE session_id = ?
        AND (id = ? OR parent_set_id = ?)`,
    args.session_id,
    headId,
    headId
  );
  const chainSize = chainCount?.n ?? 0;
  if (chainSize <= 2) {
    throw new Error('DROPSET_CHAIN_TOO_SHORT');
  }

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE achievement_unlock SET set_id = NULL WHERE set_id = ?`,
      args.set_id,
    );
    await db.runAsync(`DELETE FROM "set" WHERE id = ?`, args.set_id);
  });
}

/**
 * Reorder sets WITHIN a single (session, exercise) without disturbing other
 * exercises' set orderings (slice 10c Phase 2 commit 9 留尾 — set-row long-press
 * reorder modal, mirrored from `reorderSessionExercises` in sessionRepository).
 *
 * `set.ordering` is globally per-session (not per-exercise), so naive
 * 1..N renumbering would clobber other exercises' sets. The slot-preserving
 * approach: query current orderings of the target exercise's sets ASC,
 * then assign each existing slot to the new id sequence by index.
 *
 * Example: session has 5 sets total — exA's sets at orderings [3, 5, 8],
 * exB's at [1, 2, 4, 6, 7]. Reorder exA from [a3, a5, a8] to [a8, a3, a5]
 * → a8 takes ordering 3, a3 takes 5, a5 takes 8. exB stays untouched.
 *
 * No constraint on `ordering` (no unique), so intermediate duplicates
 * during the loop are fine. Transaction-wrapped for atomicity.
 *
 * If `orderedIds` doesn't match the queried set count for that exercise,
 * we throw — caller should ensure the modal pass-through preserves the
 * exact set list (no add / remove between long-press and confirm).
 */
export async function reorderSessionSetsForExercise(
  db: Database,
  args: {
    session_id: string;
    exercise_id: string;
    orderedIds: string[];
    /**
     * v019 isolation (slice 10c #17). When provided, the slot fetch scopes
     * by session_exercise_id so reorder stays inside one card even when
     * another card in the same session targets the same exercise_id. Left
     * optional so legacy tests / fixtures (one-card-per-exercise) still
     * compile and behave as before.
     */
    session_exercise_id?: string | null;
  }
): Promise<void> {
  // Fetch current set slots in ascending ordering. When session_exercise_id
  // is provided we scope to that exact card; otherwise we fall back to the
  // legacy (session, exercise) heuristic for backward compatibility.
  const slots = args.session_exercise_id
    ? await db.getAllAsync<{ id: string; ordering: number }>(
        `SELECT id, ordering FROM "set"
          WHERE session_exercise_id = ?
          ORDER BY ordering ASC`,
        args.session_exercise_id
      )
    : await db.getAllAsync<{ id: string; ordering: number }>(
        `SELECT id, ordering FROM "set"
          WHERE session_id = ? AND exercise_id = ?
          ORDER BY ordering ASC`,
        args.session_id,
        args.exercise_id
      );
  if (slots.length !== args.orderedIds.length) {
    throw new Error(
      `reorderSessionSetsForExercise: id-count mismatch — ` +
        `db has ${slots.length} sets, caller supplied ${args.orderedIds.length}`
    );
  }
  // Verify all orderedIds belong to this exercise.
  const validIds = new Set(slots.map((s) => s.id));
  for (const id of args.orderedIds) {
    if (!validIds.has(id)) {
      throw new Error(
        `reorderSessionSetsForExercise: id "${id}" not in this exercise's sets`
      );
    }
  }

  await db.withTransactionAsync(async () => {
    for (let i = 0; i < args.orderedIds.length; i++) {
      const target_id = args.orderedIds[i];
      const slot_ordering = slots[i].ordering;
      await db.runAsync(
        `UPDATE "set" SET ordering = ? WHERE id = ?`,
        slot_ordering,
        target_id
      );
    }
  });
}

/**
 * Replay (overwrite) one session_exercise card's sets from a historical
 * session's logged sets for the same exercise (slice 10c overnight #21
 *「再次訓練」button).
 *
 * Behaviour:
 *   - DELETE all existing `set` rows scoped by `session_exercise_id =
 *     current_se_id` (v019 isolation — sibling cards untouched even if they
 *     share `exercise_id`).
 *   - SELECT source sets from `session_id = source_session_id AND
 *     exercise_id = source_exercise_id` where `is_skipped = 0`. We DO NOT
 *     filter by `is_logged = 1` here — the spec says "依該歷史 session 的
 *     sets 全部 INSERT"; the page that surfaces the「再次訓練」button
 *     already lists only is_logged=1 sets so the visible card count equals
 *     what we copy. But because aggregator queries always join on
 *     is_logged=1, this defensive copy avoids the edge case where a stale
 *     in-progress set in the source session would silently sneak in.
 *     Therefore we DO filter is_logged=1 to align with the page view.
 *   - INSERT one new `set` per source row, with:
 *       * fresh UUID (from caller's `uuid()` injection)
 *       * `session_id = current_session_id`
 *       * `session_exercise_id = current_se_id`
 *       * `weight_kg / reps / set_kind` copied verbatim
 *       * `parent_set_id` REMAPPED via a Map<source.id, new.id> so dropset
 *         followers chain to their NEW head (head sets always have
 *         parent_set_id=null so they're inserted before their followers in
 *         source ordering order; the natural ORDER BY ordering ASC handles
 *         the dependency since followers' ordering > head's ordering by
 *         construction)
 *       * `is_logged = 0` (replay = not done yet, user must re-tick)
 *       * `is_skipped = 0`
 *       * `ordering = base + 1..N` where base = current session's MAX
 *         ordering (mirrors the prefill helper's ordering scheme so the
 *         replayed sets land at the END of the session's global ordering
 *         slot, not mixed in with other cards)
 *       * `notes` NOT copied (NULL) — spec: source set notes belong to the
 *         original session's context, not the replay
 *
 * Wraps in a single transaction — any failure rolls back both the DELETE
 * and any partial INSERTs, leaving the current card in its pre-call state.
 *
 * Idempotent against same-card replay (source == current): the DELETE
 * happens first, then SELECT returns 0 rows (because we just deleted
 * them), so the card ends up empty. This is acceptable per spec Case 5 —
 * "雖然多此一舉但不破壞資料"; user can re-tap to recover. NOTE: we capture
 * source rows BEFORE the DELETE to avoid this footgun.
 */
export async function replayCardSetsFromHistoricalSession(
  db: Database,
  args: {
    current_session_id: string;
    current_se_id: string;
    source_session_id: string;
    /**
     * v019+ source-side card isolation key. SHOULD be passed by all
     * production callers. Without this, a source session containing TWO
     * cards for the same exercise_id (e.g. solo Bench + RS A-side Bench in
     * one session) would have both cards' sets scooped up — the bug #25
     * prefill exposed on 2026-05-18 (4 sets pulled when only 1 should have
     * been). Optional for migration compatibility — callers in the same
     * commit set being migrated may omit; once all callers pass it the
     * field should become required.
     */
    source_session_exercise_id?: string;
    /**
     * Legacy fallback. Retained so pre-v019 source rows (which have
     * `set.session_exercise_id IS NULL`) still match by `(session_id,
     * exercise_id)`. Slice 10c-and-later sets always carry
     * session_exercise_id so the primary clause wins; this fallback is
     * dormant for fresh DBs.
     */
    source_exercise_id: string;
    uuid: () => string;
    now?: () => number;
  }
): Promise<{ inserted: number }> {
  const now = (args.now ?? (() => Date.now()))();

  // Capture source first so the same-card edge case (source_se == current
  // card) doesn't lose rows when DELETE wipes the card's sets.
  //
  // Source isolation (#27): scope by `session_exercise_id = ?` so two cards
  // sharing the same exercise_id in the source session don't bleed into
  // each other. Pre-v019 untagged rows fall through the second branch
  // (mirrors #17 / #23 / #24 isolation pattern used elsewhere).
  //
  // When the optional `source_session_exercise_id` isn't passed (legacy
  // caller still being migrated in commit 2), we degrade to the OLD
  // (session_id, exercise_id) match — historically broken behaviour, but
  // preserved transiently so the type is non-breaking. Removed once all
  // callers pass the new field.
  const useIsolation = args.source_session_exercise_id != null;
  const sourceSets = useIsolation
    ? await db.getAllAsync<{
        id: string;
        weight_kg: number | null;
        reps: number | null;
        set_kind: SetKind;
        parent_set_id: string | null;
        ordering: number;
      }>(
        `SELECT id, weight_kg, reps, set_kind, parent_set_id, ordering
           FROM "set"
          WHERE session_id = ?
            AND (session_exercise_id = ?
                 OR (session_exercise_id IS NULL
                     AND exercise_id = ?))
            AND is_skipped = 0
            AND is_logged = 1
          ORDER BY ordering ASC`,
        args.source_session_id,
        args.source_session_exercise_id!,
        args.source_exercise_id,
      )
    : await db.getAllAsync<{
        id: string;
        weight_kg: number | null;
        reps: number | null;
        set_kind: SetKind;
        parent_set_id: string | null;
        ordering: number;
      }>(
        `SELECT id, weight_kg, reps, set_kind, parent_set_id, ordering
           FROM "set"
          WHERE session_id = ?
            AND exercise_id = ?
            AND is_skipped = 0
            AND is_logged = 1
          ORDER BY ordering ASC`,
        args.source_session_id,
        args.source_exercise_id,
      );

  await db.withTransactionAsync(async () => {
    // Wipe current card's sets — scope by session_exercise_id (#17
    // isolation). Mirrors deleteSessionExerciseAndSets' set-DELETE clause
    // but keeps the parent session_exercise row alive (we're replacing
    // sets, not deleting the card).
    // 清 achievement_unlock back-ref 防 FK 違反 (同 deleteSet 註解)。
    await db.runAsync(
      `UPDATE achievement_unlock SET set_id = NULL
        WHERE set_id IN (
          SELECT id FROM "set" WHERE session_exercise_id = ?
        )`,
      args.current_se_id
    );
    await db.runAsync(
      `DELETE FROM "set" WHERE session_exercise_id = ?`,
      args.current_se_id
    );

    if (sourceSets.length === 0) {
      // Nothing to copy — card ends up empty. Per spec Case 4 cluster-side
      // 「source 該側 0 sets → target 該側被 delete 空」this is intentional.
      return;
    }

    // Build current session's ordering base: MAX(ordering) BEFORE we
    // insert anything new. Replayed sets append after existing sets
    // belonging to OTHER cards in the same session (global per-session
    // ordering convention).
    const maxRow = await db.getFirstAsync<{ max_ordering: number | null }>(
      `SELECT MAX(ordering) AS max_ordering FROM "set" WHERE session_id = ?`,
      args.current_session_id
    );
    const baseOrdering = maxRow?.max_ordering ?? 0;

    // Remap parent_set_id: source set id → new set id. Source rows arrive
    // in ordering ASC, and dropset followers always have ordering >
    // their head's ordering (head is inserted first by `+ 新增 1 組`,
    // follower by cycle-to-dropset which uses `insertSessionSetAfter`
    // with source = head). So a forward sweep populates the map by the
    // time any follower references its head.
    const idMap = new Map<string, string>();

    for (let i = 0; i < sourceSets.length; i++) {
      const src = sourceSets[i];
      const new_id = args.uuid();
      idMap.set(src.id, new_id);
      const remapped_parent =
        src.parent_set_id != null
          ? idMap.get(src.parent_set_id) ?? null
          : null;
      await insertSessionSet(db, {
        id: new_id,
        session_id: args.current_session_id,
        exercise_id: args.source_exercise_id,
        weight_kg: src.weight_kg ?? 0,
        reps: src.reps ?? 0,
        is_skipped: 0,
        ordering: baseOrdering + i + 1,
        created_at: now,
        set_kind: src.set_kind,
        parent_set_id: remapped_parent,
        session_exercise_id: args.current_se_id,
      });
    }
  });

  return { inserted: sourceSets.length };
}

/**
 * Cluster-pair version of `replayCardSetsFromHistoricalSession` — wipes
 * both A and B cards' sets and copies the source session's sets for both
 * exercises into the new pair (slice 10c overnight #21).
 *
 * Single transaction wraps both sides — partial failure on B rolls back
 * the wipe + INSERT on A too, so the cluster pair never ends up half-
 * replaced.
 *
 * Asymmetric source handling: if `source_session_id` had only A-side sets
 * for that exercise (user skipped B that day), B side ends up empty
 * (DELETEd, no INSERT) — per spec Q4 (c) "整組一起覆蓋" with "source 該側
 * 0 sets → target 該側被 delete 空".
 *
 * Same ordering scheme as solo: each side independently appends after the
 * session's pre-call MAX(ordering), with the A side claiming slots first.
 * This mirrors the existing `addClusterCycleAtEnd` per-side ordering
 * (each side independent), not the cluster cycle alignment — replay does
 * not enforce A.set[i] / B.set[i] cycle alignment because the source
 * session may have asymmetric set counts.
 */
export async function replayClusterCardSetsFromHistoricalSession(
  db: Database,
  args: {
    current_session_id: string;
    current_se_id_a: string;
    current_se_id_b: string;
    source_session_id: string;
    /**
     * v019+ source-side A-card isolation key (#27). SHOULD be passed by all
     * production callers. See solo helper's doc — without this, a source
     * session containing solo + RS-A cards for the same exercise would
     * conflate both into the A side. Optional only for migration
     * compatibility (legacy callsites switched over in commit 2).
     */
    source_session_exercise_id_a?: string;
    /** v019+ source-side B-card isolation key (#27). */
    source_session_exercise_id_b?: string;
    /** Legacy fallback for pre-v019 source rows (session_exercise_id NULL). */
    source_exercise_id_a: string;
    /** Legacy fallback for pre-v019 source rows (session_exercise_id NULL). */
    source_exercise_id_b: string;
    uuid: () => string;
    now?: () => number;
  }
): Promise<{ inserted_a: number; inserted_b: number }> {
  const now = (args.now ?? (() => Date.now()))();

  // Capture both sides' source rows BEFORE any DELETE (same edge case
  // protection as solo path).
  //
  // Source isolation (#27): scope by `session_exercise_id` first; fall back
  // to `exercise_id` only for pre-v019 untagged rows OR when the optional
  // SE param hasn't been wired through yet by a legacy caller.
  const fetchSource = async (
    exercise_id: string,
    source_session_exercise_id: string | undefined,
  ) =>
    source_session_exercise_id != null
      ? db.getAllAsync<{
          id: string;
          weight_kg: number | null;
          reps: number | null;
          set_kind: SetKind;
          parent_set_id: string | null;
          ordering: number;
        }>(
          `SELECT id, weight_kg, reps, set_kind, parent_set_id, ordering
             FROM "set"
            WHERE session_id = ?
              AND (session_exercise_id = ?
                   OR (session_exercise_id IS NULL
                       AND exercise_id = ?))
              AND is_skipped = 0
              AND is_logged = 1
            ORDER BY ordering ASC`,
          args.source_session_id,
          source_session_exercise_id,
          exercise_id,
        )
      : db.getAllAsync<{
          id: string;
          weight_kg: number | null;
          reps: number | null;
          set_kind: SetKind;
          parent_set_id: string | null;
          ordering: number;
        }>(
          `SELECT id, weight_kg, reps, set_kind, parent_set_id, ordering
             FROM "set"
            WHERE session_id = ?
              AND exercise_id = ?
              AND is_skipped = 0
              AND is_logged = 1
            ORDER BY ordering ASC`,
          args.source_session_id,
          exercise_id,
        );
  const sourceA = await fetchSource(
    args.source_exercise_id_a,
    args.source_session_exercise_id_a,
  );
  const sourceB = await fetchSource(
    args.source_exercise_id_b,
    args.source_session_exercise_id_b,
  );

  await db.withTransactionAsync(async () => {
    // Wipe both sides first so the ordering base reflects only OTHER
    // cards' sets in the session (the deleted current-cluster sets
    // shouldn't claim any new slot).
    // 同 deleteSet 註解：清 achievement_unlock back-ref 防 FK 違反。
    await db.runAsync(
      `UPDATE achievement_unlock SET set_id = NULL
        WHERE set_id IN (
          SELECT id FROM "set"
           WHERE session_exercise_id IN (?, ?)
        )`,
      args.current_se_id_a,
      args.current_se_id_b
    );
    await db.runAsync(
      `DELETE FROM "set" WHERE session_exercise_id = ?`,
      args.current_se_id_a
    );
    await db.runAsync(
      `DELETE FROM "set" WHERE session_exercise_id = ?`,
      args.current_se_id_b
    );

    const insertSide = async (
      sourceSets: typeof sourceA,
      exercise_id: string,
      session_exercise_id: string
    ) => {
      if (sourceSets.length === 0) return;
      // Recompute base before each side so the second side's ordering
      // doesn't overlap with the first side's freshly-inserted slots.
      const maxRow = await db.getFirstAsync<{ max_ordering: number | null }>(
        `SELECT MAX(ordering) AS max_ordering FROM "set" WHERE session_id = ?`,
        args.current_session_id
      );
      const baseOrdering = maxRow?.max_ordering ?? 0;
      const idMap = new Map<string, string>();
      for (let i = 0; i < sourceSets.length; i++) {
        const src = sourceSets[i];
        const new_id = args.uuid();
        idMap.set(src.id, new_id);
        const remapped_parent =
          src.parent_set_id != null
            ? idMap.get(src.parent_set_id) ?? null
            : null;
        await insertSessionSet(db, {
          id: new_id,
          session_id: args.current_session_id,
          exercise_id,
          weight_kg: src.weight_kg ?? 0,
          reps: src.reps ?? 0,
          is_skipped: 0,
          ordering: baseOrdering + i + 1,
          created_at: now,
          set_kind: src.set_kind,
          parent_set_id: remapped_parent,
          session_exercise_id,
        });
      }
    };

    await insertSide(
      sourceA,
      args.source_exercise_id_a,
      args.current_se_id_a
    );
    await insertSide(
      sourceB,
      args.source_exercise_id_b,
      args.current_se_id_b
    );
  });

  return { inserted_a: sourceA.length, inserted_b: sourceB.length };
}

/**
 * High-level entry point used by the Today tab.
 *
 * Per the #2 design decision: each Save auto-creates a Session, inserts the Set,
 * then immediately ends the Session. #3 will introduce the proper Session
 * lifecycle (open → many sets → end).
 *
 * Wrapped in a transaction so a partial write can't leave an open Session
 * with no Set behind.
 *
 * `uuid` is REQUIRED (no default): Hermes lacks a global `crypto.randomUUID`,
 * so the caller must inject — production passes `randomUUID` from
 * `expo-crypto`; tests pass a deterministic stub.
 */
export async function recordSetAsAutoSession(
  db: Database,
  input: RecordSetInput,
  uuid: () => string,
  now: () => number = Date.now
): Promise<{ session_id: string; set_id: string }> {
  const err = validateRecordSet(input);
  if (err) throw new Error(err);

  const ts = now();
  const session_id = uuid();
  const set_id = uuid();

  await db.withTransactionAsync(async () => {
    await createSession(db, { id: session_id, started_at: ts });
    await insertSet(db, {
      id: set_id,
      session_id,
      exercise_id: input.exercise_id,
      weight_kg: input.weight_kg,
      reps: input.reps,
      is_skipped: 0,
      ordering: 1,
      created_at: ts,
    });
    await endSession(db, { id: session_id, ended_at: ts });
  });

  return { session_id, set_id };
}
