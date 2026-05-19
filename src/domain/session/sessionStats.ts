/**
 * Session stats — pure computation for two distinct UI contexts.
 *
 * MERGED from two parallel overnight branches (slice 10c):
 *   - Agent A: detail page 4-tile stats (ADR-0019 Q10) — `computeDetailPageStats`
 *   - Agent C: in-session 3-tile stats panel (ADR-0019 Q6) — `computeSessionStats`
 *
 * Both share the same underlying volume formula (Q15.5 翻盤 ledger):
 *   Σ weight_kg × reps WHERE is_logged=1 AND set_kind != 'warmup'
 *
 * Warmup excluded (PREP only). Dropset is_logged=1 DOES contribute (non-warmup).
 * Asymmetric cluster handled naturally — each side's rows iterate independently.
 *
 * Two format helpers coexist because the two UIs want different cadence:
 *   - `formatDurationHHMM(ms)` → `HH:mm`        (Agent A — detail page, ended session)
 *   - `formatSessionDuration(ms)` → `MM:SS` or `H:MM` (Agent C — in-session live tile)
 * `formatVolumeShort(kg)` → `0`/`426`/`1.2k`/`12.5k` (Agent C — bounded tile width)
 */

import type { SetKind } from '../set/setLabels';

// ── Shared volume input ───────────────────────────────────────────────────────

export interface SessionVolumeInput {
  set_kind: SetKind;
  is_logged: number; // 0/1
  weight_kg: number | null;
  reps: number | null;
}

/** Alias retained for Agent C call-site compatibility. */
export type SessionStatsSetInput = SessionVolumeInput;

/**
 * Σ weight × reps over `is_logged=1 AND set_kind != 'warmup'` rows.
 * Null weight or reps contribute 0 (defensive). Returns 0 for empty input.
 */
export function computeSessionVolume(sets: SessionVolumeInput[]): number {
  let total = 0;
  for (const s of sets) {
    if (s.is_logged !== 1) continue;
    if (s.set_kind === 'warmup') continue;
    const w = s.weight_kg ?? 0;
    const r = s.reps ?? 0;
    total += w * r;
  }
  return total;
}

// ── In-session 3-tile stats panel (Agent C, ADR-0019 Q6) ──────────────────────

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
  const volume_kg = computeSessionVolume(args.sets);
  const duration_ms = Math.max(0, args.now_ms - args.started_at_ms);
  return {
    duration_ms,
    volume_kg,
    exercise_count: args.exercise_count,
  };
}

// ── Detail page 4-tile stats (Agent A, ADR-0019 Q10) ──────────────────────────

export interface DetailPageStatsInput {
  session: {
    started_at: number;
    ended_at: number | null;
    kcal: number | null;
  };
  /** Distinct session_exercise rows — count drives 動作數 tile. */
  exerciseCount: number;
  /** All set rows for the session — drives 容量 tile. */
  sets: SessionVolumeInput[];
  /** Optional clock for in-progress sessions; defaults to Date.now(). */
  now?: () => number;
}

export interface DetailPageStats {
  /** Total session duration in ms (started_at → ended_at, or → now if open). */
  durationMs: number;
  /** Volume — Σ weight×reps over logged non-warmup sets. */
  volume: number;
  /** Distinct session_exercise row count. */
  exerciseCount: number;
  /** HealthKit kcal column (v016); null = no data yet → UI shows '—'. */
  kcal: number | null;
}

export function computeDetailPageStats(input: DetailPageStatsInput): DetailPageStats {
  const endTs = input.session.ended_at ?? (input.now ?? Date.now)();
  const durationMs = Math.max(0, endTs - input.session.started_at);
  return {
    durationMs,
    volume: computeSessionVolume(input.sets),
    exerciseCount: input.exerciseCount,
    kcal: input.session.kcal,
  };
}

// ── Format helpers ────────────────────────────────────────────────────────────

/**
 * Format a millisecond duration as `HH:mm`. Negative or non-finite input
 * returns `00:00`. Hours roll past 24 (e.g. an open in-progress session
 * left for two days would show e.g. `48:13` rather than wrap).
 * Used by detail page (Agent A).
 */
export function formatDurationHHMM(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '00:00';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Format a duration as `H:MM` or `MM:SS` for the in-session stats panel tile.
 *   - < 1h → `MM:SS` (e.g. `42:30`)
 *   - >= 1h → `H:MM` (e.g. `1:23` — minutes always zero-padded)
 * Used by in-session stats panel (Agent C).
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
 * Format volume for the tile. Shortens to k for >= 1000 (e.g. `4.2k`,
 * `12.5k`) so the tile width stays bounded for high-volume sessions.
 * Used by in-session stats panel (Agent C).
 */
export function formatVolumeShort(volume_kg: number): string {
  if (volume_kg <= 0) return '0';
  if (volume_kg >= 1000) return `${(volume_kg / 1000).toFixed(1)}k`;
  return String(Math.round(volume_kg));
}

/**
 * Format training duration (input: seconds) for both the session detail
 * page 4-tile stats and the Today screen in-session stats panel.
 * Overnight #47 第 4 點 — unified format across both screens.
 *
 * Rules (per user spec examples 2026-05-19):
 *   - `H hr` prefix ONLY when >= 1 hour (hours unpadded)
 *   - `M' SS"` always present; minutes unpadded, seconds zero-padded to
 *     two digits
 *
 * Examples:
 *   - 0     → `0' 00"`
 *   - 5     → `0' 05"`
 *   - 65    → `1' 05"`
 *   - 1425  → `23' 45"`
 *   - 3600  → `1 hr 0' 00"`
 *   - 7325  → `2 hr 2' 05"`
 *
 * Negative / non-finite input clamps to 0 (`0' 00"`).
 */
export function formatTrainingDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return `0' 00"`;
  }
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mmss = `${m}' ${String(s).padStart(2, '0')}"`;
  return h > 0 ? `${h} hr ${mmss}` : mmss;
}
