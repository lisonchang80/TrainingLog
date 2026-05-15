/**
 * Exercise History — per-exercise history page transformer (ADR-0017 Q14;
 * ADR-0009 amended chip filter).
 *
 * Library detail page's 「歷史」 sub-tab shows every completed set of a single
 * exercise, grouped by session and ordered by session date DESC. The chip
 * row filters by rep bucket.
 *
 * Pure transform: caller does the SQL JOIN of `set` + `session`; this module
 * accepts the flat result and yields the grouped, filtered, sorted view.
 */

import type { RepBucketChip } from './repBucketFilter';
import { filterSetsByBucket } from './repBucketFilter';

/**
 * One set row joined with its session's start time. Caller is responsible for
 * the SQL JOIN (`set` INNER JOIN `session` ON set.session_id = session.id).
 */
export interface HistorySetRow {
  id: string;
  session_id: string;
  /** `session.started_at` — unix epoch ms. */
  session_started_at: number;
  weight_kg: number | null;
  reps: number | null;
  is_skipped: number;
  ordering: number;
}

/** One session's contribution to the history view. */
export interface SessionGroup {
  session_id: string;
  started_at: number;
  sets: HistorySetRow[];
}

export interface GroupByOptions {
  /**
   * When true (default), drop sets with `is_skipped = 1`. The history view
   * represents completed work; skipped sets are session-detail concern.
   */
  excludeSkipped?: boolean;
}

/**
 * Group flat history rows by session.
 *
 * Steps:
 *   1. Drop `is_skipped = 1` (unless `excludeSkipped: false`).
 *   2. Apply rep bucket chip filter.
 *   3. Group by `session_id`, ordering sets within each group by `ordering` ASC.
 *   4. Sort groups by `started_at` DESC.
 *   5. Drop groups whose sets became empty after filtering.
 */
export function groupHistoryBySession(
  rows: readonly HistorySetRow[],
  chip: RepBucketChip,
  options: GroupByOptions = {}
): SessionGroup[] {
  const excludeSkipped = options.excludeSkipped ?? true;

  const survivors = filterSetsByBucket(
    excludeSkipped ? rows.filter((r) => r.is_skipped !== 1) : [...rows],
    chip
  );

  const map = new Map<string, SessionGroup>();
  for (const r of survivors) {
    let g = map.get(r.session_id);
    if (!g) {
      g = { session_id: r.session_id, started_at: r.session_started_at, sets: [] };
      map.set(r.session_id, g);
    }
    g.sets.push(r);
  }

  for (const g of map.values()) {
    g.sets.sort((a, b) => a.ordering - b.ordering);
  }

  return [...map.values()].sort((a, b) => b.started_at - a.started_at);
}

/**
 * Count of completed sets across all (post-filter) groups — used by the page
 * header chip "{N} 組" badge.
 */
export function countCompletedSets(groups: readonly SessionGroup[]): number {
  let n = 0;
  for (const g of groups) n += g.sets.length;
  return n;
}
