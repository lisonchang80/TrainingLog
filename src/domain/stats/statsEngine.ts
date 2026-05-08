/**
 * Module #10 — Stats Engine.
 *
 * Pure logic. No DB, no React. Inputs come from repository queries pre-filtered
 * by period; outputs are aggregations the UI renders directly.
 *
 * Public functions:
 *   mgFrequencyOverPeriod  → Map<mg_id, distinct-session count>
 *   mgCapacityOverPeriod   → Map<mg_id, summed volume>
 *   durationStatsOverPeriod → { total / avg / longest / session_count }
 *   percentileBucketize    → 5-quintile bucket index per non-zero value
 *
 * ADR-0009 § 統計頁設計.
 */

import type {
  DurationStats,
  PercentileBucket,
  StatsSetRecord,
} from './types';

/**
 * Per-MG count of distinct Sessions where at least one logged set hit that MG.
 * Multiple sets within the same Session targeting the same MG → still +1 only.
 *
 * Sets without `mg_id` (custom exercises with no MG mapping) are ignored.
 */
export function mgFrequencyOverPeriod(
  records: readonly StatsSetRecord[]
): Map<string, number> {
  // mg_id → Set<session_id>
  const acc = new Map<string, Set<string>>();
  for (const r of records) {
    if (!r.is_logged || r.mg_id == null) continue;
    let s = acc.get(r.mg_id);
    if (!s) {
      s = new Set();
      acc.set(r.mg_id, s);
    }
    s.add(r.session_id);
  }
  const out = new Map<string, number>();
  for (const [mg, sessions] of acc) out.set(mg, sessions.size);
  return out;
}

/**
 * Per-MG sum of volume across logged sets. Sets with `volume == null`
 * (e.g. assisted with no bw_snapshot) are skipped.
 */
export function mgCapacityOverPeriod(
  records: readonly StatsSetRecord[]
): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of records) {
    if (!r.is_logged || r.mg_id == null || r.volume == null) continue;
    out.set(r.mg_id, (out.get(r.mg_id) ?? 0) + r.volume);
  }
  return out;
}

/**
 * Duration stats over the period.
 *
 * Source priority per ADR-0009: iPhone session.ended_at − started_at is
 * primary. HKWorkout.duration fallback isn't wired in v1 (Watch lands later).
 *
 * Sessions with ended_at == null (still in-progress) are excluded.
 * Sessions with non-positive duration (clock skew / mis-recorded) are excluded.
 */
export function durationStatsOverPeriod(
  records: readonly StatsSetRecord[]
): DurationStats {
  // Build session_id → duration map (one duration per session).
  const seen = new Map<string, number>();
  for (const r of records) {
    if (seen.has(r.session_id)) continue;
    if (r.session_ended_at == null) continue;
    const dur = r.session_ended_at - r.session_started_at;
    if (dur <= 0) continue;
    seen.set(r.session_id, dur);
  }
  const durations = Array.from(seen.values());
  if (durations.length === 0) {
    return { total_ms: 0, avg_ms: 0, longest_ms: 0, session_count: 0 };
  }
  const total = durations.reduce((s, d) => s + d, 0);
  const longest = Math.max(...durations);
  return {
    total_ms: total,
    avg_ms: Math.round(total / durations.length),
    longest_ms: longest,
    session_count: durations.length,
  };
}

/**
 * Map non-zero positive values into 5 quintile buckets (0..4).
 *
 * Algorithm: rank-based 5-tiles. Value at rank r out of N (1-indexed) maps to
 * Math.min(4, Math.floor((r-1) * 5 / N)). Ties resolved by stable sort.
 *
 * Returned array has the same length / order as `values`. Use `0` slot for
 * values that should be drawn as cool blue, `4` for warm red.
 *
 * If `values` is empty, returns []. Zeros / negatives are preserved as 0
 * bucket — caller should split "zero (grey)" from "value present (coloured)"
 * BEFORE bucketizing for the heatmap (ADR-0009 says 0 = 灰 distinct from
 * Q1 = 冷藍).
 */
export function percentileBucketize(
  values: readonly number[]
): PercentileBucket[] {
  const n = values.length;
  if (n === 0) return [];
  // Sort indices by value asc; stable.
  const indices = values.map((_, i) => i);
  indices.sort((a, b) => {
    const dv = values[a] - values[b];
    if (dv !== 0) return dv;
    return a - b;
  });
  const result = new Array<PercentileBucket>(n);
  indices.forEach((origIdx, rank) => {
    // r = 1-indexed rank
    const r = rank + 1;
    const bucket = Math.min(4, Math.floor((r - 1) * 5 / n)) as PercentileBucket;
    result[origIdx] = bucket;
  });
  return result;
}
