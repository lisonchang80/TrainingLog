/**
 * Exercise Chart Data — per-exercise 圖表頁 transformer (ADR-0017 Q14).
 *
 * Library detail page's 「圖表」 sub-tab plots 3 lines per session:
 *   - 容量          = Σ setVolume across sets (受 chip filter)
 *   - 最大重量      = max(weight_kg) across sets (受 chip filter)
 *   - 1RM 預測線    = max(estimateE1RM) across sets (NOT filtered — 跨 rep
 *                     range 比對才有意義)
 *
 * Pure transform: caller does the SQL JOIN of set + session and provides
 * `load_type` per row (looked up on the exercise) + `bw_snapshot_kg` for
 * assisted-class math.
 */

import { effectiveLoad, estimateE1RM } from '../pr/e1rmEngine';
import { setVolume } from '../pr/volumeEngine';
import type { LoadType } from './types';
import type { RepBucketChip } from './repBucketFilter';
import { filterSetsByBucket } from './repBucketFilter';

/**
 * One set row enriched with per-row `load_type` (from exercise) and
 * per-session `bw_snapshot_kg` (from session) — both needed for volume +
 * e1rm math. Caller composes via SQL JOIN.
 */
export interface ChartInputRow {
  id: string;
  session_id: string;
  session_started_at: number;
  weight_kg: number | null;
  reps: number | null;
  is_skipped: number;
  load_type: LoadType;
  bw_snapshot_kg: number | null;
}

/** A plot point on one of the three lines. */
export interface ChartPoint {
  session_id: string;
  started_at: number;
  value: number;
}

/** Output bundle — three independently-keyed series for the chart renderer. */
export interface ChartSeries {
  /** Σ volume (kg-reps) per session, chip-filtered. */
  volume: ChartPoint[];
  /** max effective weight (kg) per session, chip-filtered. */
  max_weight: ChartPoint[];
  /** max estimated 1RM (kg) per session, NOT chip-filtered (Q14). */
  e1rm: ChartPoint[];
}

interface SessionAccumulator {
  session_id: string;
  started_at: number;
  volume_sum: number;
  max_weight: number | null;
  max_e1rm: number | null;
  any_valid_volume: boolean;
  any_valid_weight: boolean;
  any_valid_e1rm: boolean;
}

function freshAcc(id: string, started_at: number): SessionAccumulator {
  return {
    session_id: id,
    started_at,
    volume_sum: 0,
    max_weight: null,
    max_e1rm: null,
    any_valid_volume: false,
    any_valid_weight: false,
    any_valid_e1rm: false,
  };
}

function aggregate(rows: readonly ChartInputRow[]): Map<string, SessionAccumulator> {
  const map = new Map<string, SessionAccumulator>();
  for (const r of rows) {
    if (r.is_skipped === 1) continue;

    let acc = map.get(r.session_id);
    if (!acc) {
      acc = freshAcc(r.session_id, r.session_started_at);
      map.set(r.session_id, acc);
    }

    const vol = setVolume({
      weight_kg: r.weight_kg,
      reps: r.reps,
      load_type: r.load_type,
      bw_snapshot_kg: r.bw_snapshot_kg,
    });
    if (vol != null) {
      acc.volume_sum += vol;
      acc.any_valid_volume = true;
    }

    if (r.weight_kg != null && Number.isFinite(r.weight_kg)) {
      const eff = effectiveLoad(r.weight_kg, r.load_type, r.bw_snapshot_kg);
      if (eff != null && eff > 0) {
        if (acc.max_weight == null || eff > acc.max_weight) acc.max_weight = eff;
        acc.any_valid_weight = true;
      }
    }

    const e1 = estimateE1RM({
      weight_kg: r.weight_kg,
      reps: r.reps,
      load_type: r.load_type,
      bw_snapshot_kg: r.bw_snapshot_kg,
    });
    if (e1 != null) {
      if (acc.max_e1rm == null || e1 > acc.max_e1rm) acc.max_e1rm = e1;
      acc.any_valid_e1rm = true;
    }
  }
  return map;
}

function toSortedPoints(
  map: Map<string, SessionAccumulator>,
  pick: (a: SessionAccumulator) => { value: number; ok: boolean }
): ChartPoint[] {
  const points: ChartPoint[] = [];
  for (const acc of map.values()) {
    const p = pick(acc);
    if (!p.ok) continue;
    points.push({ session_id: acc.session_id, started_at: acc.started_at, value: p.value });
  }
  points.sort((a, b) => a.started_at - b.started_at);
  return points;
}

/**
 * Build all three chart series at once.
 *
 * Chip semantics (ADR-0017 Q14):
 *   - volume / max_weight: aggregated from chip-filtered set rows
 *   - e1rm: aggregated from the FULL unfiltered set list — 1RM 線跨 rep
 *     range 比對才有意義
 *
 * Sessions with no valid metric (e.g. pure-bodyweight session has no
 * meaningful e1rm) are dropped from that series only.
 */
export function buildChartSeries(
  rows: readonly ChartInputRow[],
  chip: RepBucketChip
): ChartSeries {
  const filtered = filterSetsByBucket(rows, chip);
  const filteredAgg = aggregate(filtered);
  const allAgg = aggregate(rows);

  return {
    volume: toSortedPoints(filteredAgg, (a) => ({
      value: a.volume_sum,
      ok: a.any_valid_volume,
    })),
    max_weight: toSortedPoints(filteredAgg, (a) => ({
      value: a.max_weight ?? 0,
      ok: a.any_valid_weight,
    })),
    e1rm: toSortedPoints(allAgg, (a) => ({
      value: a.max_e1rm ?? 0,
      ok: a.any_valid_e1rm,
    })),
  };
}
