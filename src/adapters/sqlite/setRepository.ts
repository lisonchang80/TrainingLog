import type { Database } from '../../db/types';
import type { SetRow, RecordSetInput } from '../../domain/set/types';
import type { SetKind } from '../../domain/set/setLabels';
import { validateRecordSet } from '../../domain/set/validateRecordSet';
import { createSession, endSession } from './sessionRepository';

/** Insert one set row directly. Caller supplies all fields including IDs/timestamps. */
export async function insertSet(db: Database, set: SetRow): Promise<void> {
  await db.runAsync(
    `INSERT INTO "set" (id, session_id, exercise_id, weight_kg, reps,
                        is_skipped, ordering, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    set.id,
    set.session_id,
    set.exercise_id,
    set.weight_kg,
    set.reps,
    set.is_skipped,
    set.ordering,
    set.created_at
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
 */
export async function insertSessionSet(
  db: Database,
  set: SetRow & {
    set_kind: SetKind;
    parent_set_id: string | null;
  }
): Promise<void> {
  await db.runAsync(
    `INSERT INTO "set" (id, session_id, exercise_id, weight_kg, reps,
                        is_skipped, ordering, created_at,
                        set_kind, parent_set_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    set.id,
    set.session_id,
    set.exercise_id,
    set.weight_kg,
    set.reps,
    set.is_skipped,
    set.ordering,
    set.created_at,
    set.set_kind,
    set.parent_set_id
  );
}

/**
 * Hard-delete one set row by id. Slice 10c Phase 2 commit 7a uses this
 * to cascade-strip dropset followers when the head cycles back to
 * working (per `cycleSessionSetKind` op type 'delete').
 *
 * No referential checks: the `set` table is a leaf — nothing in the schema
 * references `set.id` (PR replay / achievements run on copies / derived
 * state). Caller should ensure session is still in_progress.
 */
export async function deleteSet(db: Database, set_id: string): Promise<void> {
  await db.runAsync(`DELETE FROM "set" WHERE id = ?`, set_id);
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
    if (args.a_set_id) {
      await db.runAsync(`DELETE FROM "set" WHERE id = ?`, args.a_set_id);
    }
    if (args.b_set_id) {
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
    a_source: { id: string; exercise_id: string } | null;
    b_source: { id: string; exercise_id: string } | null;
    session_id: string;
    new_a_set_id: string;
    new_b_set_id: string;
    now?: () => number;
  }
): Promise<void> {
  const now = (args.now ?? (() => Date.now()))();
  await db.withTransactionAsync(async () => {
    const maxFor = async (exercise_id: string) => {
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
                              set_kind, parent_set_id, is_logged)
           VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, NULL, 0)`,
          args.new_a_set_id,
          args.session_id,
          args.a_source.exercise_id,
          source.weight_kg,
          source.reps,
          await maxFor(args.a_source.exercise_id),
          now,
          source.set_kind
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
                              set_kind, parent_set_id, is_logged)
           VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, NULL, 0)`,
          args.new_b_set_id,
          args.session_id,
          args.b_source.exercise_id,
          source.weight_kg,
          source.reps,
          await maxFor(args.b_source.exercise_id),
          now,
          source.set_kind
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
    a: { exercise_id: string; new_set_id: string; weight_kg: number; reps: number };
    b: { exercise_id: string; new_set_id: string; weight_kg: number; reps: number };
    set_kind?: SetKind;
    now?: () => number;
  }
): Promise<void> {
  const now = (args.now ?? (() => Date.now()))();
  const set_kind: SetKind = args.set_kind ?? 'working';

  await db.withTransactionAsync(async () => {
    const maxFor = async (exercise_id: string) => {
      const row = await db.getFirstAsync<{ max_ord: number | null }>(
        `SELECT MAX(ordering) AS max_ord FROM "set"
          WHERE session_id = ? AND exercise_id = ?`,
        args.session_id,
        exercise_id
      );
      return (row?.max_ord ?? 0) + 1;
    };
    const aOrder = await maxFor(args.a.exercise_id);
    const bOrder = await maxFor(args.b.exercise_id);

    await db.runAsync(
      `INSERT INTO "set" (id, session_id, exercise_id, weight_kg, reps,
                          is_skipped, ordering, created_at,
                          set_kind, parent_set_id, is_logged)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, NULL, 0)`,
      args.a.new_set_id,
      args.session_id,
      args.a.exercise_id,
      args.a.weight_kg,
      args.a.reps,
      aOrder,
      now,
      set_kind
    );
    await db.runAsync(
      `INSERT INTO "set" (id, session_id, exercise_id, weight_kg, reps,
                          is_skipped, ordering, created_at,
                          set_kind, parent_set_id, is_logged)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, NULL, 0)`,
      args.b.new_set_id,
      args.session_id,
      args.b.exercise_id,
      args.b.weight_kg,
      args.b.reps,
      bOrder,
      now,
      set_kind
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
  });

  return { set_id, ordering, created_at: ts };
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
