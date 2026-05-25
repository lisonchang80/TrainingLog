/**
 * Template-editor cluster header stat — overnight #48 第 1 點.
 *
 * Solo row 顯示「{warmup_count}熱+{working_count}組」(template-editor-view.tsx)、
 * 規則 wave 12 (2026-05-20) 統一：每 working row 算 1 組、每條 dropset chain
 * HEAD 算 1 組、follower row 不另計（被 head 吸收）。Cluster row 在 #45 加
 * chip+標題分行後也顯示「X 熱 + X 組」、用 **cycle** 概念算（A.sets[i] 配
 * B.sets[i]、不是 A+B 兩側合計）、避免雙倍計數。
 *
 * Cycle = A 和 B paired 一對 (template-editor-view.tsx renderCell 也用 i 對齊
 * — `maxSets = Math.max(parent.sets.length, ...children.map((c) => c.sets.length))`、
 * 然後 `parent.sets[i]` 配 `child.sets[i]`).
 *
 * Cycle 分類（mutually-exclusive、warmup + working + 略過 = 總 cycle 數）：
 *
 *   - **working cycle**: 至少一側是 working OR dropset HEAD（`parent_set_id`
 *     為 null）。dropset HEAD 算入「組」mirror solo 進度條規則。
 *   - **warmup cycle**: 沒任一側是 working/dropset-head、且至少一側是 warmup。
 *     Asymmetric short-side pure-warmup 也算 warmup cycle。
 *   - **不計**（return null）: 兩側都是 dropset FOLLOWER。這代表該 cycle 是
 *     某個 HEAD cycle 之下的鏈尾 row、邏輯上 rolled into the head — 跟 solo
 *     follower row 不另計同樣語意。caller 在 sum 時跳過。
 *
 * 對照 `src/domain/session/clusterCard.ts::computeClusterCycleProgress` —
 * 那邊是 progress bar denominator、規則一致（HEAD 才算 unit、follower 不算）。
 *
 * Empty cluster (兩側都 0 sets) → { warmupCount: 0, workingCount: 0 }.
 */

/** Structural-only fields needed for cluster cycle classification.
 *  Matches `TemplateSet` shape from `src/domain/template/types.ts` but declared
 *  structurally so test fixtures don't need to construct the full type. */
export interface ClusterStatSetInput {
  kind: 'warmup' | 'working' | 'dropset';
  /** NULL / undefined for chain head / working / warmup; non-null for dropset
   *  chain followers (points back at head row id). Optional for backwards
   *  compatibility with fixtures predating wave 12 — undefined is treated
   *  as null (chain head / non-dropset). */
  parent_set_id?: string | null;
}

/**
 * Is this side a "set unit"? — true iff working OR dropset chain HEAD.
 * Dropset followers (parent_set_id !== null) are NOT units; warmup is NOT a
 * unit; null (asymmetric short-side) is NOT a unit.
 */
function isUnitSide(s: ClusterStatSetInput | null): boolean {
  if (s === null) return false;
  if (s.kind === 'working') return true;
  if (s.kind === 'dropset' && (s.parent_set_id ?? null) === null) return true;
  return false;
}

/**
 * Classify a (a_set, b_set) cycle pair as 'warmup' / 'working' / null.
 * Returns null for both-sides-absent OR both-sides-dropset-follower (rolled
 * into the head's cycle elsewhere).
 *
 * Exposed for unit tests; main entry point is `computeTemplateClusterStat`.
 */
export function classifyClusterCycle(
  a: ClusterStatSetInput | null,
  b: ClusterStatSetInput | null,
): 'warmup' | 'working' | null {
  if (a === null && b === null) return null;
  if (isUnitSide(a) || isUnitSide(b)) return 'working';
  // No unit side. If at least one side is warmup, it's a warmup cycle.
  const aWarmup = a !== null && a.kind === 'warmup';
  const bWarmup = b !== null && b.kind === 'warmup';
  if (aWarmup || bWarmup) return 'warmup';
  // No unit, no warmup, at least one side present → must be both dropset
  // followers (or follower + null). Rolled into the head cycle; skip.
  return null;
}

/**
 * Pair A.sets[i] with B.sets[i] (i = 0..max(aLen,bLen)-1) and tally:
 *
 *   - warmupCount: cycles where no side is working/dropset (pure warmup or
 *                  warmup + null) — mirrors「熱身 cycle」semantics
 *   - workingCount: cycles where at least one side is working or dropset
 *
 * Returns `{ warmupCount: 0, workingCount: 0 }` for empty cluster.
 */
export function computeTemplateClusterStat<S extends ClusterStatSetInput>(
  aSets: readonly S[],
  bSets: readonly S[],
): { warmupCount: number; workingCount: number } {
  const max = Math.max(aSets.length, bSets.length);
  let warmupCount = 0;
  let workingCount = 0;
  for (let i = 0; i < max; i++) {
    const a = i < aSets.length ? aSets[i] : null;
    const b = i < bSets.length ? bSets[i] : null;
    const kind = classifyClusterCycle(a, b);
    if (kind === 'warmup') warmupCount += 1;
    else if (kind === 'working') workingCount += 1;
  }
  return { warmupCount, workingCount };
}
