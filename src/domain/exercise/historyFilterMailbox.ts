/**
 * Cross-page filter sync for 動作歷史 ↔ 動作圖表 (ADR-0017 Q14 second amendment).
 *
 * The two pages share the same filter surface: rep-bucket multi-select +
 * Program 週期 + 強度. When user taps 「轉圖表」 / 「看歷史」 the
 * current filter state hops to the other page via this in-process singleton.
 *
 * Pattern matches `pickerBridge` (singleton + submit/peek/clear); differs in
 * that peek does NOT clear (the receiving page may immediately re-edit and
 * the OTHER page should see the updates on next focus).
 *
 * Reset = `clear()` — called by 「取消篩選」 to wipe both pages' shared state.
 */

import {
  DEFAULT_CLUSTER_MODE,
  type ClusterFilterMode,
} from './clusterFilter';
import type { RepBucketChip } from './repBucketFilter';

export interface HistoryFilterState {
  /** Empty set = no bucket filter (= 「全部」 active). */
  buckets: ReadonlySet<RepBucketChip>;
  /** null = no Program selected (advanced filter idle for Program axis). */
  programId: string | null;
  /** Empty set = no sub_tag filter. */
  subTags: ReadonlySet<string>;
  /**
   * 3-段 cluster filter (slice 10c). Default 'all' = legacy behavior.
   * Persists across history ↔ chart hops just like every other filter axis.
   */
  clusterMode: ClusterFilterMode;
}

export const EMPTY_FILTER: HistoryFilterState = {
  buckets: new Set(),
  programId: null,
  subTags: new Set(),
  clusterMode: DEFAULT_CLUSTER_MODE,
};

let current: HistoryFilterState | null = null;

/** Write the filter state into the shared mailbox. */
export function submitFilter(state: HistoryFilterState): void {
  current = state;
}

/** Read the current filter state without clearing. Returns null if never set. */
export function peekFilter(): HistoryFilterState | null {
  return current;
}

/** Wipe the mailbox — used by 「取消篩選」. */
export function clearFilter(): void {
  current = null;
}

/**
 * Convenience: is this filter equivalent to no-filter (default)?
 * Used to know whether to show「篩選中」 indicator on the page.
 */
export function isEmptyFilter(state: HistoryFilterState): boolean {
  return (
    state.buckets.size === 0 &&
    state.programId == null &&
    state.subTags.size === 0 &&
    state.clusterMode === DEFAULT_CLUSTER_MODE
  );
}
