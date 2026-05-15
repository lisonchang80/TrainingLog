/**
 * Reusable Superset chart transformer (ADR-0017 Q16).
 *
 * Builds 3 metric series × 2 sides (A / B) for the cluster chart page.
 * Each side is computed independently via the per-exercise chart pipeline
 * (`buildChartSeries` from `exerciseChart.ts`) so volume / max_weight / e1rm
 * semantics + chip filter behaviour stay 1:1 with the single-exercise
 * chart (Q14): volume + max_weight 受 filter, e1rm 不受.
 */

import type { RepBucketChip } from '../exercise/repBucketFilter';
import {
  buildChartSeries,
  type ChartInputRow,
  type ChartSeries,
} from '../exercise/exerciseChart';
import type {
  ExerciseHistoryRow,
  ReusableSupersetHistoryRow,
} from '../../adapters/sqlite/exerciseHistoryRepository';

export interface SupersetChartSeries {
  /** Position 0 — drawn in the reusable superset's primary color. */
  a: ChartSeries;
  /** Position 1 — drawn in the contrast color. */
  b: ChartSeries;
}

function toChartInputRow(s: ExerciseHistoryRow): ChartInputRow {
  return {
    id: s.set_id,
    session_id: s.session_id,
    session_started_at: s.session_started_at,
    weight_kg: s.weight_kg,
    reps: s.reps,
    is_skipped: 0,
    load_type: s.load_type,
    bw_snapshot_kg: s.bw_snapshot_kg,
  };
}

export function buildSupersetChartSeries(
  rows: readonly ReusableSupersetHistoryRow[],
  chip: RepBucketChip
): SupersetChartSeries {
  const rowsA: ChartInputRow[] = [];
  const rowsB: ChartInputRow[] = [];
  for (const r of rows) {
    for (const s of r.sides[0].sets) rowsA.push(toChartInputRow(s));
    for (const s of r.sides[1].sets) rowsB.push(toChartInputRow(s));
  }
  return {
    a: buildChartSeries(rowsA, chip),
    b: buildChartSeries(rowsB, chip),
  };
}
