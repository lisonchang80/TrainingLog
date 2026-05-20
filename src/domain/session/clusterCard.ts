/**
 * Cluster card pure logic — ADR-0019 Q8 / Q16 / Q15.5 (slice 10c Phase 7).
 *
 * Three pure functions consumed by `components/session/cluster-card.tsx`:
 *
 *   1. `groupClusterSides` — partition a flat `session_exercise` + flat
 *      `set` list into N `ClusterGroup` values (one per cluster) plus the
 *      remaining solos. Cluster identity is `parent_id` linkage on the
 *      session-side schema (ADR-0018 v014). The A side is the row whose
 *      `parent_id === null` (cluster parent); B side is the follower
 *      `parent_id === A.id`. Two-side only for slice 10c (N-side reserved
 *      for future).
 *
 *   2. `computeClusterCycles` — align A.set[i] with B.set[i] by per-side
 *      `ordering ASC`. When sides have different set counts (asymmetric —
 *      possible via Template editor per ADR-0019 Q8 (d) AS1), the short
 *      side gets `null` cycle slots so the UI can render the "—" gray
 *      placeholder (per ADR-0018 I4 + ADR-0019 Q8 (d)).
 *
 *   3. `computeClusterVolume` — aggregated `Σ working/non-warmup
 *      is_logged=1 / Σ all non-warmup` across BOTH A+B sides (Q15.5 ledger
 *      row, applied to cluster per Phase 7 precheck). Warmup excluded from
 *      both numerator and denominator. Returns `{ numerator, denominator }`
 *      so the UI can format `850/1200` or `0.0/0.0` as needed.
 *
 * Type inputs are intentionally minimal — the consumer can pass any
 * shape that structurally matches (e.g. `SessionExerciseRowWithName`,
 * `SessionSetWithExercise`, or the trimmed test fixtures). No coupling
 * to the SQLite layer.
 */

/** Structural-only fields needed for cluster grouping + cycle layout. */
export interface ClusterExerciseInput {
  id: string;
  /** Underlying Exercise entity id — used to partition sets per side
   *  (the runtime `set` table foreign-keys to `exercise_id`, not to
   *  `session_exercise.id`, per v001 schema). */
  exercise_id: string;
  ordering: number;
  /** NULL = solo or cluster parent. NOT NULL = cluster follower; points to parent's id. */
  parent_id: string | null;
}

/** Structural-only fields needed for cycle alignment + volume aggregation. */
export interface ClusterSetInput {
  id: string;
  /** Owning Exercise id — sets are linked to exercises via this column
   *  (v001 schema). Used as legacy fallback when `session_exercise_id`
   *  is null (pre-v019 untagged rows). */
  exercise_id: string;
  /** v019 (slice 10c #17) — owning session_exercise.id. Preferred key
   *  for within-card filtering so a coincidentally-same-exercise solo
   *  card doesn't mirror its rows into an RS A/B side (or vice versa).
   *  NULL for legacy rows the backfill couldn't match; production rows
   *  minted after #17 will always have this populated. Must be explicit
   *  nullable (not optional) to keep type narrowing honest. */
  session_exercise_id: string | null;
  ordering: number;
  set_kind: 'warmup' | 'working' | 'dropset';
  is_logged: number; // 0/1
  weight_kg: number | null;
  reps: number | null;
  /** NULL for working / warmup / dropset chain head; points at head id for
   *  dropset followers. Used by `computeClusterCycleProgress` (wave 12 dropset
   *  納入 fix) to count "1 dropset chain = 1 cycle" instead of counting every
   *  follower row as a separate cycle. */
  parent_set_id: string | null;
}

export interface ClusterSide<E extends ClusterExerciseInput, S extends ClusterSetInput> {
  exercise: E;
  /** Sets belonging to this side, sorted by `ordering ASC`. */
  sets: S[];
}

export interface ClusterGroup<E extends ClusterExerciseInput, S extends ClusterSetInput> {
  /** Lower `ordering` side (cluster parent — `parent_id === null`). */
  a: ClusterSide<E, S>;
  /** Higher `ordering` side(s). For slice 10c we collapse to a single B side
   *  (the first follower). Future N-side reserved. */
  b: ClusterSide<E, S>;
}

export interface ClusterCycle<S extends ClusterSetInput> {
  /** 1-indexed cycle number for UI display ("第 1 輪 / 第 2 輪…"). */
  cycle_idx: number;
  /** A.set[i] or null when this side has fewer cycles than the other side. */
  a_set: S | null;
  /** B.set[i] or null when this side has fewer cycles than the other side. */
  b_set: S | null;
  /** Convenience: true iff both sides exist AND both `is_logged === 1`.
   *  Asymmetric short-side slots with one side missing return false. */
  both_logged: boolean;
}

/**
 * Partition a flat list of session_exercise rows + flat set list into
 * ClusterGroups. Solos (parent_id === null with no followers) are NOT
 * returned — caller handles those via the existing solo card path.
 *
 * Two-side restriction: if a parent has 2+ followers, only the first
 * follower (by `ordering ASC`) becomes the B side. Extra followers are
 * silently dropped from the group (caller can detect via length check on
 * pre-group exercise list if needed; not expected for v1 since the
 * write path (RS picker) always explodes exactly 2 rows).
 */
export function groupClusterSides<
  E extends ClusterExerciseInput,
  S extends ClusterSetInput,
>(exercises: E[], sets: S[]): ClusterGroup<E, S>[] {
  // Index parent → followers (sorted by ordering ASC)
  const followers = new Map<string, E[]>();
  for (const ex of exercises) {
    if (ex.parent_id === null) continue;
    const list = followers.get(ex.parent_id) ?? [];
    list.push(ex);
    followers.set(ex.parent_id, list);
  }
  for (const [k, list] of followers) {
    list.sort((x, y) => x.ordering - y.ordering);
    followers.set(k, list);
  }

  const groups: ClusterGroup<E, S>[] = [];
  for (const ex of exercises) {
    if (ex.parent_id !== null) continue;
    const fols = followers.get(ex.id);
    if (!fols || fols.length === 0) continue; // solo — skip
    const bExercise = fols[0]; // 2-side only
    // v019 isolation (#17): partition by session_exercise.id so that a
    // coincidentally-same-exercise solo card doesn't bleed its sets into
    // this cluster's A/B side. Legacy untagged rows (session_exercise_id
    // null) fall back to exercise_id match — see sortedSetsFor.
    const aSets = sortedSetsFor(sets, ex.exercise_id, ex.id);
    const bSets = sortedSetsFor(sets, bExercise.exercise_id, bExercise.id);
    groups.push({
      a: { exercise: ex, sets: aSets },
      b: { exercise: bExercise, sets: bSets },
    });
  }
  // Preserve outer ordering (parent's ordering — slice 10c orders cluster
  // blocks by the A side's position in the flat list).
  groups.sort((g1, g2) => g1.a.exercise.ordering - g2.a.exercise.ordering);
  return groups;
}

/**
 * v019 isolation filter — mirrors the solo path in `app/(tabs)/index.tsx`
 * (line ~1969) so cluster + solo cards apply identical scoping rules.
 *
 *   - Prefer `session_exercise_id` (per-card identity, populated for all
 *     rows minted after slice 10c #17).
 *   - Fallback to `exercise_id` only when `session_exercise_id` is null
 *     (legacy untagged rows the v019 backfill couldn't match).
 */
function sortedSetsFor<S extends ClusterSetInput>(
  sets: S[],
  exercise_id: string,
  session_exercise_id: string,
): S[] {
  return sets
    .filter(
      (s) =>
        s.session_exercise_id === session_exercise_id ||
        (s.session_exercise_id == null && s.exercise_id === exercise_id),
    )
    .slice()
    .sort((x, y) => x.ordering - y.ordering);
}

/**
 * Align per-side sets into cycle rows. Cycle i pairs A.set[i] with
 * B.set[i] (both 0-indexed internally; `cycle_idx` is 1-indexed for UI).
 *
 * Asymmetric handling (ADR-0019 Q8 (d) AS1):
 *   - A has 4, B has 3 → cycle 4's `b_set` is null (UI shows "—").
 *   - A has 2, B has 5 → cycles 3-5's `a_set` is null.
 *   - Both empty → returns [].
 *
 * `both_logged` requires BOTH sides present AND both `is_logged === 1`.
 * Short-side null slots can never be "logged" — they don't exist.
 */
export function computeClusterCycles<
  E extends ClusterExerciseInput,
  S extends ClusterSetInput,
>(group: ClusterGroup<E, S>): ClusterCycle<S>[] {
  const aLen = group.a.sets.length;
  const bLen = group.b.sets.length;
  const total = Math.max(aLen, bLen);
  const out: ClusterCycle<S>[] = [];
  for (let i = 0; i < total; i++) {
    const a_set = i < aLen ? group.a.sets[i] : null;
    const b_set = i < bLen ? group.b.sets[i] : null;
    const both_logged =
      a_set !== null &&
      b_set !== null &&
      a_set.is_logged === 1 &&
      b_set.is_logged === 1;
    out.push({ cycle_idx: i + 1, a_set, b_set, both_logged });
  }
  return out;
}

/**
 * Slice 10c overnight #46 第 3 點 — cluster progress bar count (mirror solo).
 *
 * Wave 12 update (2026-05-20) — dropset 納入計算 mirror solo
 * `computeExerciseProgress`. A cycle counts toward total when at least one
 * side is a "set unit" (working OR dropset chain HEAD). Dropset followers
 * (parent_set_id != null) don't count — they're part of the head's unit.
 *
 *   - 兩側 warmup → 不算（排除 — 用戶 #46 抱怨「熱身組虛胖 denominator」）
 *   - 兩側 working → 算 (well-formed cluster 主體)
 *   - 一側 warmup 一側 working → 算 (任一側做真 working 就算工作 cycle)
 *   - 一側 working 一側 null (asymmetric AS1) → 算
 *   - 至少一側 dropset HEAD (parent_set_id IS NULL) → 算 (NEW wave 12)
 *   - 兩側都 dropset FOLLOWER → 不算 (rolled into the head cycle)
 *
 * `done` 算「cycle 中兩側 effective is_logged=1」— dropset 的 effective
 * is_logged 由 chain head 提供 (UI tap-✓ 只動 head)。Asymmetric short-side
 * 那側不存在所以不算。
 *
 * Returns 0/0 for an empty cluster.
 */
export function computeClusterCycleProgress<S extends ClusterSetInput>(
  cycles: ClusterCycle<S>[],
): { done: number; total: number } {
  // "Set unit" side detector — mirrors solo `computeExerciseProgress`. A side
  // qualifies as a unit when it's a working row OR a dropset chain HEAD
  // (parent_set_id IS NULL). Followers don't count (they're rolled into the
  // head's cycle).
  const isUnitSide = (s: S | null): boolean => {
    if (s === null) return false;
    if (s.set_kind === 'working') return true;
    if (s.set_kind === 'dropset' && s.parent_set_id == null) return true;
    return false;
  };

  let done = 0;
  let total = 0;
  for (const c of cycles) {
    if (!isUnitSide(c.a_set) && !isUnitSide(c.b_set)) continue;
    total += 1;
    // `both_logged` from `computeClusterCycles` already returns false on
    // asymmetric AS1 cycles (the missing side can't be "logged"), so this
    // preserves the original AS1 spec: a cycle with one side null never
    // counts as done. For dropset HEAD cycles, the head's own is_logged
    // reflects the user's tap-✓ correctly (the UI toggles head only).
    if (c.both_logged) done += 1;
  }
  return { done, total };
}

/**
 * Aggregated 容量 for a cluster header (ADR-0019 Q15.5 ledger + Q16 pull-
 * forward). Formula identical to `computeSessionVolume`:
 *
 *   numerator   = Σ weight × reps  where is_logged=1 AND set_kind!='warmup'
 *   denominator = Σ weight × reps  where                set_kind!='warmup'
 *
 * Iterated over BOTH A+B sides combined (Phase 7 precheck rule). Dropset
 * is_logged=1 contributes (non-warmup). Null weight/reps contribute 0
 * (defensive — same convention as session-wide volume).
 *
 * Returns 0/0 for an empty cluster (both sides empty) and N/0 is structurally
 * impossible (numerator <= denominator by definition).
 */
export function computeClusterVolume<
  E extends ClusterExerciseInput,
  S extends ClusterSetInput,
>(group: ClusterGroup<E, S>): { numerator: number; denominator: number } {
  let num = 0;
  let den = 0;
  for (const side of [group.a, group.b]) {
    for (const s of side.sets) {
      if (s.set_kind === 'warmup') continue;
      const w = s.weight_kg ?? 0;
      const r = s.reps ?? 0;
      const vol = w * r;
      den += vol;
      if (s.is_logged === 1) num += vol;
    }
  }
  return { numerator: num, denominator: den };
}
