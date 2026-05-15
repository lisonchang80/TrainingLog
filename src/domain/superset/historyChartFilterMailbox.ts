/**
 * Reusable Superset history ↔ chart filter sync (ADR-0017 Q16).
 *
 * Mirrors `src/domain/exercise/historyFilterMailbox.ts` pattern but for the
 * cluster pages, and with a smaller filter surface (chip only — clusters
 * don't carry Program / sub_tag affinity the way single Exercises do).
 *
 * Singleton: filter hops between /superset-history/[id] and
 * /superset-chart/[id] within one navigation flow.
 */

import type { RepBucketChip } from '../exercise/repBucketFilter';

export interface SupersetFilterState {
  /** Empty set = no chip filter (= 「全部」 active). Multi-select per Q14. */
  buckets: ReadonlySet<RepBucketChip>;
}

export const EMPTY_SUPERSET_FILTER: SupersetFilterState = {
  buckets: new Set(),
};

let current: SupersetFilterState | null = null;

export function submitSupersetFilter(state: SupersetFilterState): void {
  current = state;
}

export function peekSupersetFilter(): SupersetFilterState | null {
  return current;
}

export function clearSupersetFilter(): void {
  current = null;
}

export function isEmptySupersetFilter(state: SupersetFilterState): boolean {
  return state.buckets.size === 0;
}
