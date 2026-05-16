/**
 * In-session stats panel computation (ADR-0019 Q6, slice 10c — Agent C).
 *
 * Three tiles render between SessionHeader and the exercise list:
 *
 *   - 訓練時間 — duration since session.started_at (live, formatted HH:mm)
 *   - 容量    — Σ weight_kg × reps for is_logged=1, non-warmup sets
 *   - 動作數  — count of session_exercise rows
 *
 * The "Watch-tracked = 5-tile" variant (HR + kcal) is deferred to slice 13
 * Watch integration per ADR-0019 Q6 (b). This pure function returns the
 * 3-tile values only.
 *
 * Volume formula matches ADR-0019 翻盤 ledger row "Q15.5 容量公式":
 *   Σ working/non-warmup (is_logged=1)
 * i.e. dropsets contribute to volume (they are non-warmup and may be
 * logged), warmups do not. Cluster member sets count independently —
 * the cluster ✓ semantic in slice 10c Phase 7 logs the underlying member
 * set rows, so they show up here exactly like solo sets.
 *
 * Pure / synchronous. The React component owns the 1-second tick that
 * drives `now_ms` and re-renders the duration tile; this function is
 * the rendering snapshot for any given (sets, exercises, started_at,
 * now_ms) tuple.
 */

export interface SessionStatsSetInput {
  set_kind: 'warmup' | 'working' | 'dropset';
  is_logged: number; // 0/1
  reps: number | null;
  weight_kg: number | null;
}

export interface SessionStats {
  /** Wall-clock duration since session.started_at (ms). */
  duration_ms: number;
  /** Σ weight × reps for is_logged=1, non-warmup sets (kg). */
  volume_kg: number;
  /** Count of session_exercise rows (incl. cluster members, ad-hoc). */
  exercise_count: number;
}

export function computeSessionStats(args: {
  sets: SessionStatsSetInput[];
  exercise_count: number;
  started_at_ms: number;
  now_ms: number;
}): SessionStats {
  let volume_kg = 0;
  for (const s of args.sets) {
    if (s.is_logged !== 1) continue;
    if (s.set_kind === 'warmup') continue;
    const w = s.weight_kg ?? 0;
    const r = s.reps ?? 0;
    volume_kg += w * r;
  }
  const duration_ms = Math.max(0, args.now_ms - args.started_at_ms);
  return {
    duration_ms,
    volume_kg,
    exercise_count: args.exercise_count,
  };
}

/**
 * Format a duration as `H:MM` or `MM:SS` for the stats panel tile.
 *   - < 1h → `MM:SS` (e.g. `42:30`)
 *   - >= 1h → `H:MM` (e.g. `1:23` — minutes always zero-padded)
 *
 * Caller decides cadence; the panel ticks every 1s but only the seconds
 * field changes within a minute so re-renders are cheap.
 */
export function formatSessionDuration(duration_ms: number): string {
  const totalSec = Math.max(0, Math.floor(duration_ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}`;
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/**
 * Format volume for the tile. Shortens to k for ≥1000 (e.g. `4.2k`,
 * `12.5k`) so the tile width stays bounded for high-volume sessions.
 */
export function formatVolumeShort(volume_kg: number): string {
  if (volume_kg <= 0) return '0';
  if (volume_kg >= 1000) return `${(volume_kg / 1000).toFixed(1)}k`;
  return String(Math.round(volume_kg));
}
