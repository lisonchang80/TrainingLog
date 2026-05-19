/**
 * Template-editor cluster header stat — overnight #48 第 1 點.
 *
 * Solo row 顯示「{warmup_count}熱+{working_count}組」(template-editor-view.tsx
 * line 1834)、單純 `sets.filter` count。Cluster row 在 #45 加 chip+標題分行
 * 後沒 stat、用戶 #48 spec 確認 cluster 也要顯示「X 熱 + X 組」、但用 **cycle**
 * 概念算（不是 A+B 兩側合計、不然會雙倍）。
 *
 * Cycle = A 和 B paired 一對 (template-editor-view.tsx renderCell 也用 i 對齊
 * — `maxSets = Math.max(parent.sets.length, ...children.map((c) => c.sets.length))`、
 * 然後 `parent.sets[i]` 配 `child.sets[i]`).
 *
 * Cycle 分類（mutually-exclusive、warmup + working 加總 = 總 cycle 數）：
 *
 *   - **warmup cycle**: 至少一側是 warmup、且**沒有任一側是 working / dropset**
 *     （即 cycle 本質純熱身、可能其中一側 asymmetric short → null）
 *   - **working cycle**: 至少一側是 working OR dropset（非 warmup）
 *     （與 solo 規則一致 — solo `workings = sets.filter(s => s.kind !== 'warmup').length`、
 *     dropset 算入「組」）
 *
 * 對照 `src/domain/session/clusterCard.ts::computeClusterCycleProgress` —
 * 那邊是 progress bar denominator、刻意排除 dropset cycle（用戶 #46 抱怨
 * 「熱身組虛胖 denominator」）。本檔的 stat 不同 use case：顯示「總 X 熱 + X 組」
 * 對照 solo 卡的 summary，dropset 該算「組」內、不該丟掉。
 *
 * Empty cluster (兩側都 0 sets) → { warmupCount: 0, workingCount: 0 }.
 */

/** Structural-only fields needed for cluster cycle classification.
 *  Matches `TemplateSet.kind` shape from `src/domain/template/types.ts` but
 *  declared structurally here so test fixtures don't need to construct the
 *  full type. */
export interface ClusterStatSetInput {
  kind: 'warmup' | 'working' | 'dropset';
}

/**
 * Classify a (a_set, b_set) cycle pair as 'warmup' or 'working'.
 * Returns null when both sides are absent (defensive — caller never feeds
 * an all-null cycle in practice since we iterate `i < maxSets`).
 *
 * Exposed for unit tests; main entry point is `computeTemplateClusterStat`.
 */
export function classifyClusterCycle(
  a: ClusterStatSetInput | null,
  b: ClusterStatSetInput | null,
): 'warmup' | 'working' | null {
  if (a === null && b === null) return null;
  const aWorkingOrDropset =
    a !== null && (a.kind === 'working' || a.kind === 'dropset');
  const bWorkingOrDropset =
    b !== null && (b.kind === 'working' || b.kind === 'dropset');
  if (aWorkingOrDropset || bWorkingOrDropset) return 'working';
  // No side is working/dropset; at least one side exists (handled above) and
  // must be warmup (the only remaining kind option). Asymmetric short-side
  // pure-warmup cycles still count as warmup.
  return 'warmup';
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
