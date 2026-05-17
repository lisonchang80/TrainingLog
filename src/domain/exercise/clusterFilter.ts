/**
 * Cluster Filter — 動作歷史 / 圖表頁 3-段 cluster filter
 *  (slice 10c — supersedes the standalone superset history/chart pages).
 *
 * Replaces the previously-separate `/superset-history/[id]` + `/superset-chart/[id]`
 * routes by folding cluster identity into the exercise history surface. A row
 * is "in a cluster" if its source `session_exercise` is either a cluster A
 * (parent of another `session_exercise` in the same session) or a cluster B
 * (`parent_id != null`).
 *
 * The 3 modes match the spec L26 segmented control:
 *   - `'exclude_cluster'` — solo rows only (default for solo card history)
 *   - `'all'` — every row (preserves legacy behavior; the only mode pre-slice-10c)
 *   - `'cluster_only'` — rows where the session_exercise belongs to a cluster
 *     (A or B side; the page header tells the user which side)
 *
 * `is_in_cluster` is a query-layer JOIN-derived flag that must be set by the
 * caller — see `exerciseHistoryRepository.queryExerciseHistory` for the
 * authoritative SQL.
 */

/** 3-段 cluster filter mode for exercise history / chart pages. */
export type ClusterFilterMode = 'exclude_cluster' | 'all' | 'cluster_only';

/** Default mode when neither URL param nor mailbox holds a preference. */
export const DEFAULT_CLUSTER_MODE: ClusterFilterMode = 'all';

/** All 3 modes in display order (left → right on the segmented control). */
export const CLUSTER_FILTER_MODES: readonly ClusterFilterMode[] = [
  'exclude_cluster',
  'all',
  'cluster_only',
] as const;

/** Chinese display label for each mode (matches spec L29). */
export function clusterFilterLabel(mode: ClusterFilterMode): string {
  switch (mode) {
    case 'exclude_cluster':
      return '不含超級組';
    case 'all':
      return '包含超級組';
    case 'cluster_only':
      return '只含超級組';
  }
}

/**
 * Filter a list of set rows by cluster mode.
 *
 * `is_in_cluster` is set at the query layer (see
 * `exerciseHistoryRepository.queryExerciseHistory`) based on:
 *   - cluster A: this `session_exercise` is the parent of another row
 *     in the same session (id IN (SELECT parent_id FROM session_exercise))
 *   - cluster B: this `session_exercise.parent_id IS NOT NULL`
 *   - solo: neither
 *
 * Note: returns a *new* array (never mutates input) so the caller can call
 * this inside a `useMemo` without confusing React's reference equality.
 */
export function filterSetsByClusterMode<T extends { is_in_cluster: boolean }>(
  rows: readonly T[],
  mode: ClusterFilterMode
): T[] {
  switch (mode) {
    case 'all':
      return [...rows];
    case 'exclude_cluster':
      return rows.filter((r) => !r.is_in_cluster);
    case 'cluster_only':
      return rows.filter((r) => r.is_in_cluster);
  }
}

/**
 * Parse a URL search param value into a `ClusterFilterMode`.
 * Returns `DEFAULT_CLUSTER_MODE` for unknown / null values.
 */
export function parseClusterMode(
  raw: string | string[] | null | undefined
): ClusterFilterMode {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === 'exclude_cluster' || v === 'all' || v === 'cluster_only') {
    return v;
  }
  return DEFAULT_CLUSTER_MODE;
}
