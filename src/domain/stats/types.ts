/**
 * Module #10 — Stats Engine — shared types.
 *
 * The engine is pure logic: callers (UI / repository) load filtered rows
 * from SQLite for the chosen period, hand them in, and the engine returns
 * aggregations. The engine does NOT know about period boundaries or DB.
 */

/** One per-set record fed into the engine. Pre-joined with mg + volume. */
export interface StatsSetRecord {
  session_id: string;
  session_started_at: number;
  session_ended_at: number | null;
  set_id: string;
  exercise_id: string;
  /** Primary muscle group of the exercise. Null if exercise has no MG mapping. */
  mg_id: string | null;
  /**
   * Primary M-layer muscle IDs for the exercise (m:n via exercise_muscle table
   * with role='primary'). Multiple because most exercises hit several muscles
   * (e.g. Bench Press → m-lower-chest + m-tricep + m-front-delt).
   *
   * Empty array when the exercise has no primary muscle mapping (custom
   * exercises that the user hasn't tagged yet).
   *
   * Added overnight 5/23 to drive the M-level body heatmap.
   */
  m_ids: string[];
  /** Per-set volume (kg-reps). Null when undefined per ADR-0007. */
  volume: number | null;
  /** True iff the set counts as "done" — `is_skipped = 0` AND valid weight/reps. */
  is_logged: boolean;
}

/** Result of percentile bucketing — one bucket index per input value. */
export type PercentileBucket = 0 | 1 | 2 | 3 | 4;

// ---- 6-period histogram helpers (slice 9 smoke feedback #5/#6) ----

/** Period granularity for the -5..0 histogram X-axis. */
export type PeriodScale = 'year' | 'month' | 'week';

/** One of 6 period boundaries, oldest first (offset -5 → 0 = current). */
export interface PeriodBucketBoundary {
  /** Integer in [-5, 0]. 0 = current period; -5 = 5 periods ago. */
  offset: number;
  /** Human-friendly label (e.g. "2026", "5月", "5/8"). */
  label: string;
  start_ms: number;
  end_ms: number;
}

/** Per-bucket duration aggregation. */
export interface DurationBucket {
  offset: number;
  label: string;
  total_ms: number;
  session_count: number;
}

/** Per-bucket capacity (volume) aggregation for a single MG. */
export interface CapacityBucket {
  offset: number;
  label: string;
  capacity: number;
}
