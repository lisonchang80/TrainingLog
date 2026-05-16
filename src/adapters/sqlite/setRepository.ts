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
            s.set_kind, s.parent_set_id, s.is_logged,
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
  if (cols.length === 0) return; // nothing to update
  vals.push(set_id);
  await db.runAsync(
    `UPDATE "set" SET ${cols.join(', ')} WHERE id = ?`,
    ...vals
  );
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
