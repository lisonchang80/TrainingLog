/**
 * Working-set ordinal computation — slice 10c overnight #7 第 1 點.
 *
 * Today screen's solo & cluster cards show a per-row label column whose
 * value depends on the row's `set_kind`:
 *
 *   - working → an ordinal number (1, 2, 3, …) — the n-th WORKING set in
 *     this exercise. Warmup and dropset rows do NOT consume the ordinal.
 *   - warmup  → `熱`  (lit. "warm")
 *   - dropset → `D`   (no per-cluster index — kept as a single-char marker
 *     so cluster rows can show `[D]` symmetric to `[1]` / `[2]` in the
 *     shared `#` button. Solo rows historically render `D{N}` via the
 *     older `computeSetLabels`; this new helper deliberately collapses to
 *     `D` to match the cluster card's affordance.)
 *
 * The split between "ordinal map" and "display label" lets cluster cards
 * pre-compute the A side ordinal map and reuse it for B side fallback
 * when the B side has fewer rows (per the asymmetric-cluster convention
 * in `computeClusterCycles`). Solo cards build the map once per render
 * and look up by set id while rendering each row.
 *
 * Why a Map (not array index): cluster rendering iterates per cycle row
 * (not per ordering position), so positional lookup is brittle. Mapping
 * by set id matches the call site's natural identifier.
 *
 * Why not extend `computeSetLabels` directly: that function returns a
 * positional `string[]` aligned with the input array. Cluster rendering
 * needs per-id lookup AND the simpler `D` (vs `D1` / `D2`) display, so a
 * separate helper avoids breaking the template editor's existing
 * `D{N}` semantics (used by the dropset cluster-head display).
 */

export type WorkingSetOrdinalInput = {
  id: string;
  set_kind: 'warmup' | 'working' | 'dropset';
  ordering: number;
  /** v025 (#1/#2, 2026-06-02) — Watch display rank. When present the working
   *  numbering follows DISPLAY order (so a Watch reorder / mid-insert inside a
   *  superset renumbers 1,2,3… by the visible order, matching the row order
   *  `groupClusterSides` now produces); absent / null falls back to `ordering`. */
  display_rank?: number | null;
};

/**
 * Build a per-id ordinal map: for each set whose `set_kind === 'working'`,
 * assign its 1-based position among the other working sets (after sorting
 * by `display_rank ?? ordering` ASC, so a Watch reorder / mid-insert
 * renumbers by the VISIBLE order). Warmup and dropset sets are NOT included.
 *
 * Idempotent and order-independent w.r.t. the input array: the function
 * sorts internally (by `display_rank ?? ordering`), so passing the same
 * logical sequence in any input order yields the same map.
 *
 * @example
 *   computeWorkingSetOrdinals([
 *     { id: 'a', set_kind: 'warmup',  ordering: 0 },
 *     { id: 'b', set_kind: 'working', ordering: 1 },
 *     { id: 'c', set_kind: 'dropset', ordering: 2 },
 *     { id: 'd', set_kind: 'working', ordering: 3 },
 *   ])
 *   // → Map { 'b' => 1, 'd' => 2 }
 */
export function computeWorkingSetOrdinals(
  sets: ReadonlyArray<WorkingSetOrdinalInput>,
): Map<string, number> {
  const sorted = [...sets].sort(
    (a, b) =>
      (a.display_rank ?? a.ordering) - (b.display_rank ?? b.ordering) ||
      a.ordering - b.ordering,
  );
  const out = new Map<string, number>();
  let n = 0;
  for (const s of sorted) {
    if (s.set_kind === 'working') {
      n += 1;
      out.set(s.id, n);
    }
  }
  return out;
}

/**
 * Display label for a single set row. Combines the ordinal map with the
 * fixed-text mappings for warmup / dropset. Returns `'?'` for working
 * rows missing from the map (defensive — shouldn't happen if the map was
 * built from the same `sets` snapshot but guards against caller drift).
 *
 *   - set_kind === 'working' → ordinalMap.get(set.id)?.toString() ?? '?'
 *   - set_kind === 'warmup'  → '熱'
 *   - set_kind === 'dropset' → 'D'
 */
export function displaySetLabel(
  set: { id: string; set_kind: 'warmup' | 'working' | 'dropset' },
  ordinalMap: ReadonlyMap<string, number>,
): string {
  if (set.set_kind === 'warmup') return '熱';
  if (set.set_kind === 'dropset') return 'D';
  const n = ordinalMap.get(set.id);
  return n === undefined ? '?' : String(n);
}
