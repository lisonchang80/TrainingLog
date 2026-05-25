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
  CapacityBucket,
  DurationBucket,
  PercentileBucket,
  PeriodBucketBoundary,
  PeriodScale,
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
 * Per-Muscle (M-layer) count of distinct Sessions where at least one logged set
 * hit that muscle as a PRIMARY mover. Mirrors `mgFrequencyOverPeriod` but
 * iterates `r.m_ids[]` (m:n) instead of the single `r.mg_id`.
 *
 * Multiple sets within the same Session targeting the same muscle → still +1
 * only. Sets with an empty `m_ids` array (custom exercises lacking muscle
 * mapping) are ignored.
 *
 * Added overnight 5/23 to drive the M-level body heatmap (ADR-0010 muscle
 * layer + ADR-0009 §人體部位圖).
 */
export function mFrequencyOverPeriod(
  records: readonly StatsSetRecord[]
): Map<string, number> {
  // m_id → Set<session_id>
  const acc = new Map<string, Set<string>>();
  for (const r of records) {
    if (!r.is_logged) continue;
    for (const mId of r.m_ids) {
      let s = acc.get(mId);
      if (!s) {
        s = new Set();
        acc.set(mId, s);
      }
      s.add(r.session_id);
    }
  }
  const out = new Map<string, number>();
  for (const [m, sessions] of acc) out.set(m, sessions.size);
  return out;
}

// ---- 6-period histogram helpers (slice 9 smoke #5/#6) -----------------------
//
// User wants per-period charts on the X-axis labelled -5..0 (5 periods ago →
// current). The period scale (year/month/week) is selected at the top of the
// Stats sub-tab. These helpers compute the 6 boundaries + bucket records into
// them. All pure logic — caller (UI / repo) loads a wide range of records and
// hands them in.

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Returns the 6 period boundaries oldest first.
 * offset -5 → 5 periods ago; offset 0 → current period containing `now`.
 */
export function bucketBoundaries(
  scale: PeriodScale,
  now: Date = new Date()
): PeriodBucketBoundary[] {
  const out: PeriodBucketBoundary[] = [];
  for (let offset = -5; offset <= 0; offset++) {
    if (scale === 'year') {
      const y = now.getFullYear() + offset;
      out.push({
        offset,
        label: String(y),
        start_ms: new Date(y, 0, 1).getTime(),
        end_ms: new Date(y + 1, 0, 1).getTime(),
      });
    } else if (scale === 'month') {
      const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      out.push({
        offset,
        label: `${d.getMonth() + 1}月`,
        start_ms: d.getTime(),
        end_ms: next.getTime(),
      });
    } else {
      // week: Monday 00:00 to next Monday 00:00 (ISO-style)
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      const dow = d.getDay(); // 0=Sun..6=Sat
      const diffToMon = dow === 0 ? -6 : 1 - dow;
      d.setDate(d.getDate() + diffToMon + offset * 7);
      const start = d.getTime();
      const end = start + 7 * DAY_MS;
      out.push({
        offset,
        label: `${d.getMonth() + 1}/${d.getDate()}`,
        start_ms: start,
        end_ms: end,
      });
    }
  }
  return out;
}

/**
 * Returns the bucket offset (-5..0) containing `ts`, or null when out of
 * range. O(1) — uses pre-computed boundaries.
 */
export function bucketIndexOf(
  ts: number,
  boundaries: readonly PeriodBucketBoundary[]
): number | null {
  for (const b of boundaries) {
    if (ts >= b.start_ms && ts < b.end_ms) return b.offset;
  }
  return null;
}

/**
 * Per-bucket duration aggregation (total session ms + count).
 * One session contributes to one bucket only — the bucket containing its
 * `started_at`. In-progress sessions (ended_at == null) are excluded.
 */
export function durationHistogram(
  records: readonly StatsSetRecord[],
  scale: PeriodScale,
  now: Date = new Date()
): DurationBucket[] {
  const boundaries = bucketBoundaries(scale, now);
  const seen = new Map<string, { offset: number; duration: number }>();
  for (const r of records) {
    if (seen.has(r.session_id)) continue;
    if (r.session_ended_at == null) continue;
    const dur = r.session_ended_at - r.session_started_at;
    if (dur <= 0) continue;
    const offset = bucketIndexOf(r.session_started_at, boundaries);
    if (offset == null) continue;
    seen.set(r.session_id, { offset, duration: dur });
  }
  // Aggregate per bucket
  const totals = new Map<number, { total_ms: number; session_count: number }>();
  for (const v of seen.values()) {
    const cur = totals.get(v.offset) ?? { total_ms: 0, session_count: 0 };
    cur.total_ms += v.duration;
    cur.session_count += 1;
    totals.set(v.offset, cur);
  }
  return boundaries.map((b) => {
    const t = totals.get(b.offset);
    return {
      offset: b.offset,
      label: b.label,
      total_ms: t?.total_ms ?? 0,
      session_count: t?.session_count ?? 0,
    };
  });
}

/**
 * Per-MG, per-bucket capacity (volume) aggregation. Returns a map keyed by
 * mg_id with each value an array of 6 CapacityBucket entries (oldest first).
 * Records without `mg_id`, with null `volume`, or outside the 6-period range
 * are skipped.
 */
export function capacityHistogramByMg(
  records: readonly StatsSetRecord[],
  scale: PeriodScale,
  now: Date = new Date()
): Map<string, CapacityBucket[]> {
  const boundaries = bucketBoundaries(scale, now);
  // mg_id → offset → capacity
  const acc = new Map<string, Map<number, number>>();
  for (const r of records) {
    if (!r.is_logged) continue;
    if (r.mg_id == null || r.volume == null) continue;
    const offset = bucketIndexOf(r.session_started_at, boundaries);
    if (offset == null) continue;
    let perMg = acc.get(r.mg_id);
    if (!perMg) {
      perMg = new Map();
      acc.set(r.mg_id, perMg);
    }
    perMg.set(offset, (perMg.get(offset) ?? 0) + r.volume);
  }
  const out = new Map<string, CapacityBucket[]>();
  for (const [mg, perMg] of acc) {
    out.set(
      mg,
      boundaries.map((b) => ({
        offset: b.offset,
        label: b.label,
        capacity: perMg.get(b.offset) ?? 0,
      }))
    );
  }
  return out;
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
