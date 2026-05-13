/**
 * Slice 9.5 per-set template ops — pure logic, no DB, no React.
 *
 * Covers (per ADR-0016 + issue #28 acceptance criteria):
 *   - per-set CRUD: addSet / updateSet / deleteSet / reorderSets
 *   - dropset cluster B3: min size 2, head-attach followers, cascade delete
 *   - cycleSetKind: working → warmup → dropset(head + auto follower) → working
 *   - superset row ops (per-row-index pairing): deleteSupersetRowAt /
 *     cloneSupersetRowAt
 *
 * All ops are referentially transparent: take a TemplateExercise (or array
 * of siblings for the superset path) plus optional uuid/now injectors and
 * return a new structurally-equal value with `position` re-normalised to
 * 0..N so the DB UNIQUE(template_exercise_id, position) constraint never
 * trips. Mutating the inputs after the call has no effect on the output.
 */

import type { TemplateExercise, TemplateSet } from './types';

export interface IdGenerator {
  /** Returns a stable unique id. Tests pass a deterministic stub. */
  uuid: () => string;
}

/** Re-key every `set.position` to its index after a mutation. */
function normalizePositions(sets: TemplateSet[]): TemplateSet[] {
  return sets.map((s, i) => (s.position === i ? s : { ...s, position: i }));
}

/** True for `kind === 'dropset' && parent_set_id === null`. */
function isClusterHead(s: TemplateSet): boolean {
  return s.kind === 'dropset' && s.parent_set_id === null;
}

/** True for `kind === 'dropset' && parent_set_id !== null`. */
export function isClusterFollower(s: TemplateSet): boolean {
  return s.kind === 'dropset' && s.parent_set_id !== null;
}

/** Resolve the cluster head id for any cluster member (head returns itself). */
function clusterHeadIdOf(s: TemplateSet): string {
  return s.parent_set_id ?? s.id;
}

/** All members of the cluster anchored at `head_id` (head + followers). */
function clusterMembers(sets: TemplateSet[], head_id: string): TemplateSet[] {
  return sets.filter((s) => s.id === head_id || s.parent_set_id === head_id);
}

/** Find the trailing cluster head in `sets`, or -1 if none exists. */
function findTrailingClusterHeadIdx(sets: TemplateSet[]): number {
  for (let i = sets.length - 1; i >= 0; i--) {
    if (isClusterHead(sets[i])) return i;
  }
  return -1;
}

/**
 * Clone the trailing cluster (head + followers) and append the clones at
 * the end of `sets`. Used by `addSet` when the last set is a dropset.
 */
function cloneTrailingCluster(
  sets: TemplateSet[],
  idgen: IdGenerator
): TemplateSet[] {
  const headIdx = findTrailingClusterHeadIdx(sets);
  if (headIdx === -1) return sets;
  const cluster = sets.slice(headIdx);
  const newHeadId = idgen.uuid();
  const cloned: TemplateSet[] = cluster.map((s, i) => ({
    id: i === 0 ? newHeadId : idgen.uuid(),
    position: sets.length + i,
    kind: s.kind,
    reps: s.reps,
    weight: s.weight,
    parent_set_id: i === 0 ? null : newHeadId,
    notes: null,
  }));
  return [...sets, ...cloned];
}

// ---------------------------------------------------------------------------
// per-set CRUD
// ---------------------------------------------------------------------------

/**
 * Append a new set at the end of `ex.sets`, cloning the last set's
 * `kind`/`reps`/`weight` (per ADR-0016 amendment §8 "新增 1 組" rules).
 *
 * - If last is `working` / `warmup` → clone that single row.
 * - If last is a dropset (member of a cluster) → clone the entire trailing
 *   cluster with fresh head + follower ids, linkage re-anchored.
 * - Empty `ex.sets` → seed with a single `working` row (8 reps × 20 kg
 *   default, matching prototype seed).
 */
export function addSet(
  ex: TemplateExercise,
  idgen: IdGenerator
): TemplateExercise {
  if (ex.sets.length === 0) {
    return {
      ...ex,
      sets: [
        {
          id: idgen.uuid(),
          position: 0,
          kind: 'working',
          reps: 8,
          weight: 20,
          parent_set_id: null,
          notes: null,
        },
      ],
    };
  }
  const last = ex.sets[ex.sets.length - 1];
  if (last.kind === 'dropset') {
    return { ...ex, sets: cloneTrailingCluster(ex.sets, idgen) };
  }
  const newSet: TemplateSet = {
    id: idgen.uuid(),
    position: ex.sets.length,
    kind: last.kind,
    reps: last.reps,
    weight: last.weight,
    parent_set_id: null,
    notes: null,
  };
  return { ...ex, sets: [...ex.sets, newSet] };
}

/** Patch fields of a single set; structurally-stable (no position changes). */
export function updateSet(
  ex: TemplateExercise,
  set_id: string,
  patch: Partial<Pick<TemplateSet, 'reps' | 'weight' | 'notes'>>
): TemplateExercise {
  return {
    ...ex,
    sets: ex.sets.map((s) => (s.id === set_id ? { ...s, ...patch } : s)),
  };
}

/**
 * Delete a single set. Cluster-aware:
 *   - working / warmup row → straight removal.
 *   - cluster follower → removal allowed only if the cluster still has
 *     ≥ 2 members afterwards (min size 2 per ADR-0016 amendment §8).
 *     Returns the original `ex` unchanged if the constraint would be
 *     violated (UI surfaces the alert).
 *   - cluster head → CASCADE: remove the head AND all its followers.
 *
 * Always re-normalises `position`.
 */
export function deleteSet(
  ex: TemplateExercise,
  set_id: string
): TemplateExercise {
  const target = ex.sets.find((s) => s.id === set_id);
  if (!target) return ex;

  if (target.kind !== 'dropset') {
    return {
      ...ex,
      sets: normalizePositions(ex.sets.filter((s) => s.id !== set_id)),
    };
  }

  if (isClusterFollower(target)) {
    const headId = target.parent_set_id as string;
    const size = clusterMembers(ex.sets, headId).length;
    if (size <= 2) return ex; // min size guard
    return {
      ...ex,
      sets: normalizePositions(ex.sets.filter((s) => s.id !== set_id)),
    };
  }

  // cluster head: cascade
  const headId = target.id;
  return {
    ...ex,
    sets: normalizePositions(
      ex.sets.filter((s) => s.id !== headId && s.parent_set_id !== headId)
    ),
  };
}

/**
 * Move the set with id `set_id` to `to_index`. Cluster members move as a
 * unit (head + followers stay contiguous); if `set_id` is a follower the
 * whole cluster moves anchored on its head.
 *
 * `to_index` is clamped to `[0, sets.length - cluster_size]`. Returns `ex`
 * unchanged if the id is unknown.
 */
export function reorderSets(
  ex: TemplateExercise,
  set_id: string,
  to_index: number
): TemplateExercise {
  const found = ex.sets.find((s) => s.id === set_id);
  if (!found) return ex;
  const headId = found.kind === 'dropset' ? clusterHeadIdOf(found) : found.id;
  const moving = ex.sets.filter(
    (s) => s.id === headId || s.parent_set_id === headId
  );
  const rest = ex.sets.filter(
    (s) => s.id !== headId && s.parent_set_id !== headId
  );
  const maxStart = rest.length;
  const start = Math.max(0, Math.min(to_index, maxStart));
  const next = [...rest.slice(0, start), ...moving, ...rest.slice(start)];
  return { ...ex, sets: normalizePositions(next) };
}

// ---------------------------------------------------------------------------
// cycleSetKind (ADR-0016 2026-05-13 amendment §A)
// ---------------------------------------------------------------------------

/**
 * Tap-label cycle: working (#n) → warmup (熱) → dropset head (Dn) →
 * working. Followers are no-op.
 *
 * Transitions:
 *   - working → warmup: kind flip only.
 *   - warmup → dropset head: kind flip + auto-add 1 follower with the same
 *     reps/weight (cluster min size 2 satisfied immediately).
 *   - dropset head → working: kind flip + CASCADE delete all followers
 *     (parent_set_id back to null on the head).
 *   - follower → no-op (returns the same `ex`).
 */
export function cycleSetKind(
  ex: TemplateExercise,
  set_id: string,
  idgen: IdGenerator
): TemplateExercise {
  const idx = ex.sets.findIndex((s) => s.id === set_id);
  if (idx === -1) return ex;
  const s = ex.sets[idx];

  if (isClusterFollower(s)) return ex;

  if (s.kind === 'working') {
    return {
      ...ex,
      sets: ex.sets.map((x) => (x.id === set_id ? { ...x, kind: 'warmup' } : x)),
    };
  }

  if (s.kind === 'warmup') {
    const newFollower: TemplateSet = {
      id: idgen.uuid(),
      position: idx + 1,
      kind: 'dropset',
      reps: s.reps,
      weight: s.weight,
      parent_set_id: s.id,
      notes: null,
    };
    const flipped = ex.sets.map((x) =>
      x.id === set_id ? { ...x, kind: 'dropset' as const, parent_set_id: null } : x
    );
    const next = [
      ...flipped.slice(0, idx + 1),
      newFollower,
      ...flipped.slice(idx + 1),
    ];
    return { ...ex, sets: normalizePositions(next) };
  }

  // s.kind === 'dropset' && head
  const headId = s.id;
  const stripped = ex.sets
    .filter((x) => x.id === headId || x.parent_set_id !== headId)
    .map((x) =>
      x.id === set_id ? { ...x, kind: 'working' as const, parent_set_id: null } : x
    );
  return { ...ex, sets: normalizePositions(stripped) };
}

// ---------------------------------------------------------------------------
// Superset row ops (ADR-0016 2026-05-12 amendment §7 + 2026-05-13 §D)
// ---------------------------------------------------------------------------

/**
 * Per-row-index pairing: parent col row `i` ↔ child col row `i`.
 *
 * `exercises` is the full template `exercises` array; the op mutates only
 * the parent + its children (`parent_id === parent.id`) and leaves others
 * intact. `child_ids` are the superset children (in display order). The
 * caller resolves them; this op trusts the linkage.
 */

/**
 * Delete the row at `row_index` on the parent AND on each child (整列父+子
 * 同時刪). Indices out of range no-op. Re-normalises `position` on every
 * touched exercise.
 */
export function deleteSupersetRowAt(
  exercises: TemplateExercise[],
  parent_id: string,
  child_ids: string[],
  row_index: number
): TemplateExercise[] {
  const ids = new Set([parent_id, ...child_ids]);
  return exercises.map((ex) => {
    if (!ids.has(ex.id)) return ex;
    if (row_index < 0 || row_index >= ex.sets.length) return ex;
    return {
      ...ex,
      sets: normalizePositions(ex.sets.filter((_, i) => i !== row_index)),
    };
  });
}

/**
 * Clone the row at `row_index` on the parent AND on each child, inserted
 * just after the source row (整列父+子 各 clone 對應 row，整行一輪).
 * `parent_set_id` on the clone is forced to null (clusters can't extend
 * across a superset clone — per amendment §7). Indices out of range no-op.
 */
export function cloneSupersetRowAt(
  exercises: TemplateExercise[],
  parent_id: string,
  child_ids: string[],
  row_index: number,
  idgen: IdGenerator
): TemplateExercise[] {
  const ids = new Set([parent_id, ...child_ids]);
  return exercises.map((ex) => {
    if (!ids.has(ex.id)) return ex;
    if (row_index < 0 || row_index >= ex.sets.length) return ex;
    const src = ex.sets[row_index];
    const cloned: TemplateSet = {
      id: idgen.uuid(),
      position: row_index + 1,
      kind: src.kind,
      reps: src.reps,
      weight: src.weight,
      parent_set_id: null,
      notes: null,
    };
    const next = [
      ...ex.sets.slice(0, row_index + 1),
      cloned,
      ...ex.sets.slice(row_index + 1),
    ];
    return { ...ex, sets: normalizePositions(next) };
  });
}

// ---------------------------------------------------------------------------
// Cluster ops convenience (consumed by gesture handlers in UI phase)
// ---------------------------------------------------------------------------

/**
 * Append a fresh dropset cluster (new head + 1 follower) after the cluster
 * anchored on `head_set_id`. Used by cluster-head right-swipe [新增] in the
 * UI gesture phase (ADR-0016 2026-05-12 amendment §9 cluster head 3 gesture).
 *
 * If `head_set_id` is not a cluster head, returns `ex` unchanged.
 */
export function addClusterAfter(
  ex: TemplateExercise,
  head_set_id: string,
  idgen: IdGenerator
): TemplateExercise {
  const head = ex.sets.find((s) => s.id === head_set_id);
  if (!head || !isClusterHead(head)) return ex;

  // Find the last index belonging to this cluster.
  let endIdx = -1;
  ex.sets.forEach((s, i) => {
    if (s.id === head_set_id || s.parent_set_id === head_set_id) endIdx = i;
  });
  if (endIdx === -1) return ex;

  const newHeadId = idgen.uuid();
  const newHead: TemplateSet = {
    id: newHeadId,
    position: endIdx + 1,
    kind: 'dropset',
    reps: head.reps,
    weight: head.weight,
    parent_set_id: null,
    notes: null,
  };
  const newFollower: TemplateSet = {
    id: idgen.uuid(),
    position: endIdx + 2,
    kind: 'dropset',
    reps: head.reps,
    weight: head.weight,
    parent_set_id: newHeadId,
    notes: null,
  };
  const next = [
    ...ex.sets.slice(0, endIdx + 1),
    newHead,
    newFollower,
    ...ex.sets.slice(endIdx + 1),
  ];
  return { ...ex, sets: normalizePositions(next) };
}
