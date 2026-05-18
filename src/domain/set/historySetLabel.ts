/**
 * Per-session set label computation for the Exercise History page.
 *
 * Slice 10c overnight #22. The expanded session card on the history
 * page renders one row per logged set, and the leading column shows a
 * type label instead of the raw `#{ordering}` number it previously did:
 *
 *   - warmup  → `熱`
 *   - working → `{N}` where N is the 1-based position among working
 *               sets in this session (warmup / dropset do NOT consume
 *               the counter)
 *   - dropset → `D{M}` where M is the 1-based position among dropset
 *               rows in this session (independent counter from working)
 *
 * The two existing helpers in this directory are deliberately not
 * reused:
 *
 *   - `workingSetOrdinal.displaySetLabel` (Today screen) collapses
 *     dropset to a single-char `D` because the cluster card is space-
 *     constrained. The history card has more room and the user wants
 *     to see `D1` / `D2` distinctly.
 *
 *   - `setLabels.computeSetLabels` is a positional `string[]` aligned
 *     to the input array. The history card iterates per-set and would
 *     have to track array indices in parallel. A Map keyed by `set.id`
 *     matches the call site's natural lookup pattern.
 *
 * Why a Map (not an array): the caller renders `session.sets.map(set =>
 * <Row label={labelMap.get(set.set_id)} />)`. Lookup by id stays
 * correct even if the parent component slices / filters the array
 * after label computation.
 */

import type { SetKind } from './setLabels';

export interface HistorySetLabelInput {
  id: string;
  set_kind: SetKind;
  ordering: number;
}

/**
 * Build a per-id label map for one session's sets. Order-independent:
 * the function sorts by `ordering` internally before assigning counters.
 *
 * @example
 *   computeHistorySetLabels([
 *     { id: 'a', set_kind: 'warmup',  ordering: 1 },
 *     { id: 'b', set_kind: 'working', ordering: 2 },
 *     { id: 'c', set_kind: 'working', ordering: 3 },
 *     { id: 'd', set_kind: 'dropset', ordering: 4 },
 *     { id: 'e', set_kind: 'working', ordering: 5 },
 *     { id: 'f', set_kind: 'dropset', ordering: 6 },
 *   ])
 *   // → Map {
 *   //     'a' => '熱', 'b' => '1', 'c' => '2',
 *   //     'd' => 'D1', 'e' => '3', 'f' => 'D2',
 *   //   }
 */
export function computeHistorySetLabels(
  sets: ReadonlyArray<HistorySetLabelInput>,
): Map<string, string> {
  const sorted = [...sets].sort((a, b) => a.ordering - b.ordering);
  const out = new Map<string, string>();
  let workingN = 0;
  let dropsetN = 0;
  for (const s of sorted) {
    if (s.set_kind === 'warmup') {
      out.set(s.id, '熱');
    } else if (s.set_kind === 'working') {
      workingN += 1;
      out.set(s.id, String(workingN));
    } else if (s.set_kind === 'dropset') {
      dropsetN += 1;
      out.set(s.id, `D${dropsetN}`);
    }
  }
  return out;
}
