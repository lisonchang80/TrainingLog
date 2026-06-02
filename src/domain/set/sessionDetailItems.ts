import type { SessionExerciseRowWithName } from '../../adapters/sqlite/sessionRepository';
import type { SessionSetWithExercise } from '../../adapters/sqlite/setRepository';
import { sortSetsByDisplayRank } from './sessionSetLayout';

/**
 * Read-mode cluster grouping + ordered-item builders for the session detail page
 * (extracted from app/session/[id].tsx 2026-06-02, big-file health #8). Pure:
 * given the flat session_exercise + set rows, produce the cluster blocks and the
 * unified ordered render list (solo rows + cluster blocks, no duplicated cluster
 * followers).
 *
 * Cluster grouping per ADR-0018 v014 — READ MODE rendering. Row order respects
 * the Watch display rank (#1/#2, 2026-06-02): a Watch reorder / mid-insert moves
 * `display_rank`, so rows order by `display_rank ?? ordering` (ordering tie-break)
 * — mirrors `computeSessionSetLayout` / `sortedSetsFor` so the LABELS (which sort
 * by display_rank) line up with the rows.
 */

export interface ClusterRow {
  parent: SessionExerciseRowWithName;
  child: SessionExerciseRowWithName;
  /** Sets belonging to the parent (A side), ordered by ordering ASC. */
  setsA: SessionSetWithExercise[];
  /** Sets belonging to the child (B side), ordered by ordering ASC. */
  setsB: SessionSetWithExercise[];
}

export type OrderedItem =
  | { kind: 'solo'; exercise: SessionExerciseRowWithName; sets: SessionSetWithExercise[] }
  | { kind: 'cluster'; cluster: ClusterRow };

export function buildClusters(
  sessionExercises: SessionExerciseRowWithName[],
  sets: SessionSetWithExercise[]
): ClusterRow[] {
  const parentIds = new Set<string>();
  for (const e of sessionExercises) {
    if (e.parent_id !== null) parentIds.add(e.parent_id);
  }
  const out: ClusterRow[] = [];
  for (const parent of sessionExercises) {
    if (!parentIds.has(parent.id)) continue;
    const child = sessionExercises.find((e) => e.parent_id === parent.id);
    if (!child) continue;
    // Row order respects the Watch display rank (#1/#2, 2026-06-02): a Watch
    // reorder / mid-insert moves `display_rank`, so the read-mode cluster card
    // must order rows by `display_rank ?? ordering` (ordering tie-break) —
    // mirrors `computeSessionSetLayout` / `sortedSetsFor`. Without this the
    // row order falls back to creation `ordering` while the LABELS (computed
    // by `computeSessionSetLayout`, which sorts by display_rank) follow the
    // display order → the cycle column reads 2,1,3.
    const setsA = sortSetsByDisplayRank(
      sets.filter((s) =>
        s.session_exercise_id === parent.id ||
        (s.session_exercise_id == null && s.exercise_id === parent.exercise_id),
      ),
    );
    const setsB = sortSetsByDisplayRank(
      sets.filter((s) =>
        s.session_exercise_id === child.id ||
        (s.session_exercise_id == null && s.exercise_id === child.exercise_id),
      ),
    );
    out.push({ parent, child, setsA, setsB });
  }
  return out;
}

export function buildOrderedItems(
  sessionExercises: SessionExerciseRowWithName[],
  clusters: ClusterRow[],
  sets: SessionSetWithExercise[]
): OrderedItem[] {
  const clusterChildIds = new Set<string>();
  const clusterByParentId = new Map<string, ClusterRow>();
  for (const c of clusters) {
    clusterChildIds.add(c.child.id);
    clusterByParentId.set(c.parent.id, c);
  }
  const out: OrderedItem[] = [];
  for (const ex of sessionExercises) {
    if (clusterChildIds.has(ex.id)) continue;
    const cluster = clusterByParentId.get(ex.id);
    if (cluster) {
      out.push({ kind: 'cluster', cluster });
      continue;
    }
    // Read-mode solo row order respects Watch display rank (#1/#2,
    // 2026-06-02), same as the cluster path above: sort by
    // `display_rank ?? ordering` so a Watch reorder / mid-insert reflects on
    // the session-detail card and the labels (which already follow
    // display_rank) line up with the rows.
    const exSets = sortSetsByDisplayRank(
      sets.filter((s) =>
        s.session_exercise_id === ex.id ||
        (s.session_exercise_id == null && s.exercise_id === ex.exercise_id),
      ),
    );
    out.push({ kind: 'solo', exercise: ex, sets: exSets });
  }
  return out;
}
