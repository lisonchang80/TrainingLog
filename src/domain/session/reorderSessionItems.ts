/**
 * Session exercise reorder — domain helpers for ReorderExercisesSheet usage.
 *
 * Problem: `app/(tabs)/index.tsx` and `app/session/[id].tsx` both feed the
 * shared `ReorderExercisesSheet` with `sessionExercises.map(p => ({id, name}))`,
 * which flat-maps EVERY session_exercise (including cluster children) into
 * separate draggable rows. A cluster (parent A + child B) shows as 2 rows
 * users can independently move — breaking the A↔B cluster invariant.
 *
 * Fix: collapse cluster parent + child into ONE row labelled "A + B"
 * (mirror cluster card header). Children rows never appear in the sheet
 * (cluster pair is non-splittable, per ADR-0016 amendment).
 *
 * Counterpart for write: `reorderSessionExercises` assigns ordering = 1..N
 * positionally to the id list it receives. So after user confirms a new
 * order of PARENT/SOLO ids, expand each parent id with its child id right
 * after it before the DB write — keeps cluster B sitting next to its
 * cluster A in the final ordering.
 *
 * Mirrors the template editor's `reorderParents` useMemo + the
 * `reorderTemplateExercises` helper, but here the persistence layer is
 * `reorderSessionExercises(db, { session_id, orderedIds })` rather than
 * the template draft rebuild path.
 */

export interface ReorderableSessionExercise {
  id: string;
  exercise_name: string;
  parent_id: string | null;
}

interface SessionReorderRow {
  /** Parent / solo `session_exercise.id`. Cluster children never appear. */
  id: string;
  /** Display name. `"A + B"` for cluster, plain name for solo. */
  name: string;
}

interface SessionReorderRowsResult {
  rows: SessionReorderRow[];
  /** parent `session_exercise.id` → child `session_exercise.id`. */
  childByParent: Map<string, string>;
}

/**
 * Build the reorder-row list + cluster lookup. Order of `rows` mirrors the
 * input array's parent/solo encounter order (callers usually sort by
 * ordering ASC upstream, so the initial sheet rendering matches the user's
 * current visual layout).
 *
 * Defensive: if an exercise's `parent_id` references an id not present in
 * the input, the row is treated as solo (no fabricated cluster). Sheet
 * already filters input to one session, so cross-session leakage is not a
 * concern.
 */
export function buildSessionReorderRows(
  exercises: readonly ReorderableSessionExercise[],
): SessionReorderRowsResult {
  const idSet = new Set(exercises.map((e) => e.id));
  const childIds = new Set<string>();
  const childByParent = new Map<string, string>();
  const childNameByParent = new Map<string, string>();
  for (const e of exercises) {
    if (e.parent_id != null && idSet.has(e.parent_id)) {
      childIds.add(e.id);
      childByParent.set(e.parent_id, e.id);
      childNameByParent.set(e.parent_id, e.exercise_name);
    }
  }
  const rows: SessionReorderRow[] = [];
  for (const p of exercises) {
    if (childIds.has(p.id)) continue;
    const childName = childNameByParent.get(p.id);
    rows.push({
      id: p.id,
      name: childName ? `${p.exercise_name} + ${childName}` : p.exercise_name,
    });
  }
  return { rows, childByParent };
}

/**
 * Expand the reorder sheet's confirmed parent/solo id list back to the full
 * `session_exercise` id list (child id inserted immediately after its parent
 * id). Pass the result to `reorderSessionExercises` which assigns
 * `ordering = 1..N` in the order it receives.
 */
export function expandClusterIds(
  orderedParentIds: readonly string[],
  childByParent: Map<string, string>,
): string[] {
  const out: string[] = [];
  for (const pid of orderedParentIds) {
    out.push(pid);
    const childId = childByParent.get(pid);
    if (childId) out.push(childId);
  }
  return out;
}
