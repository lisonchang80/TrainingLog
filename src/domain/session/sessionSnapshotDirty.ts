/**
 * Pure dirty-check for the session edit-mode snapshot/restore flow
 * (2026-05-20 night). Decides whether the user's current state diverges
 * from the snapshot taken on edit-mode entry — used to gate the
 * "返回 → discard?" confirmation alert (no diff = silent exit).
 *
 * Compares the user-mutable fields the UI exposes:
 *   - session.started_at / ended_at (SessionTimeEditorSheet may have changed them)
 *   - sessionExercises: id-keyed map of (ordering, parent_id, rest_sec) —
 *     these are the only mutable fields edit mode lets users touch
 *     (planned_sets / planned_reps / planned_weight_kg / template_id /
 *      is_evergreen / exercise_id / reusable_superset_id are immutable in
 *      edit mode)
 *   - sets: id-keyed map of all per-set mutable fields
 *
 * Returns true if any field differs, including added or removed rows.
 *
 * Why not JSON.stringify the whole thing: array order isn't normalised by
 * the DB (post-edit the in-memory `sets` array may be sorted differently
 * than the snapshot — `ORDER BY ordering ASC` vs `ORDER BY rowid`). We
 * id-key both sides so order doesn't matter.
 */

export interface DirtyCheckSession {
  started_at: number;
  ended_at: number | null;
}

export interface DirtyCheckSessionExercise {
  id: string;
  ordering: number;
  parent_id: string | null;
  rest_sec: number | null;
}

export interface DirtyCheckSet {
  id: string;
  weight_kg: number | null;
  reps: number | null;
  is_skipped: number;
  ordering: number;
  set_kind: string;
  parent_set_id: string | null;
  is_logged: number;
  notes: string | null;
  session_exercise_id: string | null;
}

export interface DirtyCheckState {
  session: DirtyCheckSession;
  sessionExercises: ReadonlyArray<DirtyCheckSessionExercise>;
  sets: ReadonlyArray<DirtyCheckSet>;
}

function buildById<T extends { id: string | number }>(
  rows: ReadonlyArray<T>
): Map<string, T> {
  const m = new Map<string, T>();
  for (const r of rows) m.set(String(r.id), r);
  return m;
}

function shallowEqExercise(
  a: DirtyCheckSessionExercise,
  b: DirtyCheckSessionExercise
): boolean {
  return (
    a.ordering === b.ordering &&
    (a.parent_id ?? null) === (b.parent_id ?? null) &&
    (a.rest_sec ?? null) === (b.rest_sec ?? null)
  );
}

function shallowEqSet(a: DirtyCheckSet, b: DirtyCheckSet): boolean {
  return (
    (a.weight_kg ?? null) === (b.weight_kg ?? null) &&
    (a.reps ?? null) === (b.reps ?? null) &&
    a.is_skipped === b.is_skipped &&
    a.ordering === b.ordering &&
    a.set_kind === b.set_kind &&
    (a.parent_set_id ?? null) === (b.parent_set_id ?? null) &&
    a.is_logged === b.is_logged &&
    (a.notes ?? null) === (b.notes ?? null) &&
    (a.session_exercise_id ?? null) === (b.session_exercise_id ?? null)
  );
}

export function sessionSnapshotDirty(
  current: DirtyCheckState,
  snapshot: DirtyCheckState
): boolean {
  if (current.session.started_at !== snapshot.session.started_at) return true;
  if ((current.session.ended_at ?? null) !== (snapshot.session.ended_at ?? null))
    return true;

  if (current.sessionExercises.length !== snapshot.sessionExercises.length)
    return true;
  const curSeMap = buildById(current.sessionExercises);
  for (const snap of snapshot.sessionExercises) {
    const cur = curSeMap.get(snap.id);
    if (!cur) return true;
    if (!shallowEqExercise(cur, snap)) return true;
  }

  if (current.sets.length !== snapshot.sets.length) return true;
  const curSetMap = buildById(current.sets);
  for (const snap of snapshot.sets) {
    const cur = curSetMap.get(snap.id);
    if (!cur) return true;
    if (!shallowEqSet(cur, snap)) return true;
  }

  return false;
}
