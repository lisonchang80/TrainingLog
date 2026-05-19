/**
 * Slice 10c overnight #46 第 1 點 — template deletability gate.
 *
 * 「通用」變體（program_id IS NULL OR sub_tag IS NULL）是 3-tier prefill
 * resolver 的 base fallback（ADR-0019 Q9.2 / slice 10c #35 prefill tree
 * Tier B「P + 通用 + E」與 Tier C「P + 任一 + E」的兜底層），不可刪除 —
 * 刪了會讓「新增強度」走 lookup-or-spawn 時找不到 source 可以 clone。
 *
 * Editor ⋯ ActionSheet 的「刪除模板」按鈕用此 helper 決定是否 disable
 * (passed to `disabledButtonIndices`). 點到 disabled 項 = native noop.
 *
 * 不影響「另存模板」（留尾、未來決定）— 該選項繼續可點。
 */
export function isTemplateDeletable(template: {
  program_id: string | null;
  sub_tag: string | null;
}): boolean {
  return template.program_id !== null && template.sub_tag !== null;
}

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
// cycleSetKindAcrossExercises (ADR-0019 Q7, slice 10c Phase 2 commit 3)
// ---------------------------------------------------------------------------

/**
 * Cluster-aware wrapper around `cycleSetKind`. Use this from any caller
 * that operates on the full `exercises[]` array — it routes to the right
 * branch automatically:
 *
 *   - Solo exercise (`reusable_superset_id === null`):
 *     delegates to `cycleSetKind(ex, set_id, idgen)`. Same transitions
 *     as before (working → warmup → dropset(head + follower) → working,
 *     follower → no-op).
 *
 *   - Reusable cluster (`reusable_superset_id !== null`):
 *     restricts cycle to warmup ↔ working only (dropset would break the
 *     "一列 = 一組" sets-length parallel invariant — slice 9.8b grill Q5
 *     sub-(iii)) and **mirrors** the change to all cluster siblings at
 *     the same `idx` position so a cycle on row 2 of side A also flips
 *     row 2 of side B simultaneously. Defensive: any non-warmup state
 *     (including a stray dropset) cycles to warmup; subsequent taps then
 *     resume the warmup ↔ working ping-pong normally.
 *
 * Returns a fresh `exercises[]`. If the target ex/set isn't found the
 * input array is returned unchanged.
 *
 * Previously this dispatch lived as a closure inside
 * `components/template-editor/template-editor-view.tsx`; promoted to
 * pure ops in slice 10c Phase 2 so the session set logger (Phase 2+)
 * can share the same logic via this single entry point.
 */
export function cycleSetKindAcrossExercises(
  exercises: TemplateExercise[],
  ex_id: string,
  set_id: string,
  idgen: IdGenerator,
): TemplateExercise[] {
  const targetEx = exercises.find((e) => e.id === ex_id);
  if (!targetEx) return exercises;

  // Reusable cluster — mirror across siblings, warmup ↔ working only.
  if (targetEx.reusable_superset_id !== null) {
    const idx = targetEx.sets.findIndex((s) => s.id === set_id);
    if (idx === -1) return exercises;
    const currentKind = targetEx.sets[idx].kind;
    // warmup ↔ working only. Defensive: any non-warmup state (including a
    // stray dropset that shouldn't exist in a reusable cluster) cycles to
    // warmup so the next tap resumes the normal ping-pong.
    const newKind: TemplateSet['kind'] =
      currentKind === 'warmup' ? 'working' : 'warmup';
    const clusterHead = targetEx.parent_id ?? targetEx.id;
    return exercises.map((ex) => {
      const inCluster = ex.id === clusterHead || ex.parent_id === clusterHead;
      if (!inCluster) return ex;
      if (idx >= ex.sets.length) return ex;
      return {
        ...ex,
        sets: ex.sets.map((s, i) =>
          i === idx ? { ...s, kind: newKind } : s,
        ),
      };
    });
  }

  // Solo — delegate to per-exercise cycleSetKind.
  return exercises.map((ex) =>
    ex.id === ex_id ? cycleSetKind(ex, set_id, idgen) : ex,
  );
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

/**
 * Slice 10c overnight #45 第 3 點 — parent-level reorder (pure).
 *
 * The template editor 排序動作 modal returns `orderedParentIds` (1 row per
 * parent_id === null exercise). This helper rebuilds the flat exercises
 * array so:
 *   - parents appear in the new order
 *   - each parent's children (parent_id === parent.id) stay adjacent to
 *     their parent in their original child order — A+B cluster pair is
 *     never split
 *   - `ordering` is reassigned 0..N contiguous matching the array order
 *     (mirrors getTemplateFull's positional re-key on read; commitTemplateDraft
 *     writes these values back via UPDATE template_exercise.ordering)
 *
 * Safety: any parent_id not present in `orderedParentIds` is appended at
 * the end (with its children) so a sheet bug can never silently drop
 * exercises.
 */
export function reorderTemplateExercises(
  exercises: TemplateExercise[],
  orderedParentIds: readonly string[],
): TemplateExercise[] {
  const parentById = new Map<string, TemplateExercise>();
  const childrenByParent = new Map<string, TemplateExercise[]>();
  for (const ex of exercises) {
    if (ex.parent_id == null) {
      parentById.set(ex.id, ex);
      if (!childrenByParent.has(ex.id)) childrenByParent.set(ex.id, []);
    }
  }
  for (const ex of exercises) {
    if (ex.parent_id != null) {
      const arr = childrenByParent.get(ex.parent_id) ?? [];
      arr.push(ex);
      childrenByParent.set(ex.parent_id, arr);
    }
  }
  const out: TemplateExercise[] = [];
  let ord = 0;
  const seen = new Set<string>();
  for (const pid of orderedParentIds) {
    const p = parentById.get(pid);
    if (!p || seen.has(pid)) continue;
    seen.add(pid);
    out.push({ ...p, ordering: ord++ });
    const kids = childrenByParent.get(pid) ?? [];
    for (const k of kids) {
      out.push({ ...k, ordering: ord++ });
    }
  }
  // Safety: append any missing parents at the end so we never silently
  // drop exercises (sheet bug guard).
  for (const [pid, p] of parentById) {
    if (seen.has(pid)) continue;
    out.push({ ...p, ordering: ord++ });
    const kids = childrenByParent.get(pid) ?? [];
    for (const k of kids) {
      out.push({ ...k, ordering: ord++ });
    }
  }
  return out;
}

/**
 * Slice 10c overnight #49 — inline long-press drag reorder for SETS within a
 * solo exercise card. Mirror session pattern (`app/(tabs)/index.tsx:2428`
 * `NestableDraggableFlatList`) but the unit of movement is a **group**:
 *
 *   - solo working / warmup set  → 1 group (id = set.id)
 *   - dropset cluster (head + N followers) → 1 group (id = head.id);
 *     followers never split from their head — the whole chain moves as one
 *     contiguous block (per ADR-0016 dropset cluster invariant §B3).
 *
 * `orderedGroupIds` is the new order of group ids the user dropped. Caller
 * (template-editor-view.tsx) extracts them from a `NestableDraggableFlatList`
 * `onDragEnd` payload where each list item represents one group; the helper
 * here re-flattens the sets array by walking `orderedGroupIds` in order and
 * appending each group's members (head first, followers in original order).
 *
 * Safety / fault tolerance (mirror `reorderTemplateExercises`):
 *   - any group id not present in `ex.sets` is silently skipped
 *   - any **existing** head id missing from `orderedGroupIds` is appended at
 *     the end (with its followers) so a list bug can never silently drop
 *     sets
 *   - `position` is re-normalised 0..N contiguous so the DB
 *     UNIQUE(template_exercise_id, position) constraint never trips on commit
 *
 * Returns a new `TemplateExercise` (referentially distinct); `ex.sets` is
 * never mutated.
 */
export function reorderTemplateSetsByGroups(
  ex: TemplateExercise,
  orderedGroupIds: readonly string[],
): TemplateExercise {
  // Build groups by walking `ex.sets`. A group head is either a solo
  // (working/warmup) row OR a cluster head (dropset && parent_set_id===null).
  // Followers (dropset && parent_set_id!==null) attach to their head.
  const groups: TemplateSet[][] = [];
  const headIdToGroupIdx = new Map<string, number>();
  for (const s of ex.sets) {
    if (isClusterFollower(s)) {
      const headId = s.parent_set_id as string;
      const gIdx = headIdToGroupIdx.get(headId);
      if (gIdx !== undefined) {
        groups[gIdx].push(s);
      } else {
        // Orphan follower (head missing) — treat as standalone so we never
        // silently drop sets. Should be unreachable for well-formed input.
        const newIdx = groups.length;
        groups.push([s]);
        headIdToGroupIdx.set(s.id, newIdx);
      }
    } else {
      const newIdx = groups.length;
      groups.push([s]);
      headIdToGroupIdx.set(s.id, newIdx);
    }
  }

  const seen = new Set<number>();
  const outSets: TemplateSet[] = [];
  for (const gid of orderedGroupIds) {
    const gIdx = headIdToGroupIdx.get(gid);
    if (gIdx === undefined || seen.has(gIdx)) continue;
    seen.add(gIdx);
    for (const m of groups[gIdx]) outSets.push(m);
  }
  // Safety: append any missing groups at the end (sheet bug guard).
  for (let i = 0; i < groups.length; i++) {
    if (seen.has(i)) continue;
    for (const m of groups[i]) outSets.push(m);
  }

  return { ...ex, sets: normalizePositions(outSets) };
}

/**
 * Slice 10c overnight #49 — inline long-press drag reorder for CYCLES of a
 * reusable-superset cluster (A + B paired). Mirror session pattern
 * (`components/session/cluster-card.tsx:291` `NestableDraggableFlatList` on
 * `cycles`).
 *
 * Cluster invariant: A.sets[i] is paired with B.sets[i] (cycle i). Drag
 * moves the **whole cycle** as one unit — A side and B side reorder in
 * lockstep. The caller hands us the new cycle order as
 * `orderedCycleKeys[i] = a_set.id ?? b_set.id` (same key extractor as
 * cluster-card.tsx and session's `onConfirmReorderCycles`).
 *
 * Asymmetric handling (per ADR-0019 Q8 (d) AS1):
 *   - A side has more cycles than B (or vice-versa) → the short side simply
 *     has fewer entries; cycle keys for the long-side-only cycles use that
 *     side's set id. Missing-side slots stay missing (we don't fabricate).
 *
 * Returns a fresh `{ exA, exB }` (both referentially distinct). Each side's
 * `sets` are re-ordered to match the new cycle order and `position`
 * normalised 0..N. Unknown cycle keys are skipped; any **existing** cycle
 * keys missing from `orderedCycleKeys` are appended at the end (matched by
 * the original order) so a drag-controller bug never silently drops sets.
 */
export function reorderTemplateClusterCycles(
  exA: TemplateExercise,
  exB: TemplateExercise,
  orderedCycleKeys: readonly string[],
): { exA: TemplateExercise; exB: TemplateExercise } {
  // Compute the original cycle list — same shape as
  // src/domain/session/clusterCard.ts::computeClusterCycles but inlined
  // (template's `TemplateSet` has no `is_logged` — we don't need it here,
  // just the pairing).
  const aLen = exA.sets.length;
  const bLen = exB.sets.length;
  const total = Math.max(aLen, bLen);

  interface Cycle {
    key: string;
    a: TemplateSet | null;
    b: TemplateSet | null;
  }
  const cycles: Cycle[] = [];
  for (let i = 0; i < total; i++) {
    const a = i < aLen ? exA.sets[i] : null;
    const b = i < bLen ? exB.sets[i] : null;
    // Empty pair shouldn't exist (would mean total > both lengths); guard
    // with a synthetic key so the list never crashes on it.
    const key = a?.id ?? b?.id ?? `__missing_${i}__`;
    cycles.push({ key, a, b });
  }

  const byKey = new Map<string, Cycle>(cycles.map((c) => [c.key, c]));
  const seen = new Set<string>();
  const ordered: Cycle[] = [];
  for (const k of orderedCycleKeys) {
    const c = byKey.get(k);
    if (!c || seen.has(k)) continue;
    seen.add(k);
    ordered.push(c);
  }
  // Safety: append any missing cycles at the end so we never silently drop
  // sets (sheet bug guard).
  for (const c of cycles) {
    if (seen.has(c.key)) continue;
    ordered.push(c);
  }

  const newA: TemplateSet[] = [];
  const newB: TemplateSet[] = [];
  for (const c of ordered) {
    if (c.a) newA.push(c.a);
    if (c.b) newB.push(c.b);
  }

  return {
    exA: { ...exA, sets: normalizePositions(newA) },
    exB: { ...exB, sets: normalizePositions(newB) },
  };
}
