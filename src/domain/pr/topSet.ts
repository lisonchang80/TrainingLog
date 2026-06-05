/**
 * Module — Top set (本次最佳組) picker.
 *
 * Grill 2026-06-05 Q1. Extracted from the inline computation in
 * `app/exercise-history/[id].tsx` so the candidate-filter rule is unit-tested
 * (the inline form was only ever exercised by manual smoke).
 *
 * "頂組" = the single heaviest *effective-load* set of a session, shown as a
 * per-session highlight on the exercise-history detail card. The candidate
 * set MUST mirror the app-wide「真訓練組」rule (ADR-0012 line 174, the same
 * filter `totalVolume` uses):
 *   - exclude warmup (`set_kind === 'warmup'`) — never a "best set"
 *   - exclude dropset followers (`parent_set_id != null`) — a follower is a
 *     lighter drop continuation, not an independent effort; a dropset HEAD
 *     (kind='dropset', parent null) stays eligible.
 *
 * Before this fix the picker ranked ALL sets, so a warmup 100×3 could out-rank
 * a working 80×8, and a dropset follower could surface as the "top set".
 */

import { effectiveLoad } from './e1rmEngine';
import type { LoadType } from '../exercise/types';

export interface TopSetCandidate {
  weight_kg: number | null;
  set_kind: string;
  parent_set_id: string | null;
  bw_snapshot_kg: number | null;
}

export interface TopSetPick<T> {
  set: T;
  /** Effective load in kg (always finite — null-eff candidates are filtered). */
  eff: number;
}

/**
 * Return the heaviest eligible set (by effective load), or `undefined` when no
 * candidate qualifies (e.g. a warmup-only or pure-bodyweight session). Generic
 * over the row type so callers keep their full set shape on `.set`.
 */
export function pickTopSet<T extends TopSetCandidate>(
  sets: readonly T[],
  loadType: LoadType,
): TopSetPick<T> | undefined {
  return sets
    .map((s) => ({
      set: s,
      eff:
        s.weight_kg == null
          ? null
          : effectiveLoad(s.weight_kg, loadType, s.bw_snapshot_kg),
    }))
    .filter(
      (x): x is TopSetPick<T> =>
        x.eff != null &&
        x.set.set_kind !== 'warmup' &&
        x.set.parent_set_id == null,
    )
    .sort((a, b) => b.eff - a.eff)[0];
}
