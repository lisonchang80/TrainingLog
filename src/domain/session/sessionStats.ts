/**
 * Session-level stats for the history detail page header tiles
 * (ADR-0019 Q10, slice 10c session detail page).
 *
 * The 4-tile row on the session detail page shows:
 *   訓練時間 — duration from started_at → ended_at, format `HH:mm`
 *   容量    — Σ weight × reps over is_logged=1 AND set_kind != 'warmup'
 *   動作數  — count of distinct session_exercise rows
 *   大卡    — HealthKit kcal column (v016); null → '—'
 *
 * Mirrors the per-exercise progress helper (`exerciseProgress.ts`):
 *   pure functions over input arrays, no DB, no React; the UI calls these
 *   with already-loaded rows so the same logic round-trips through tests.
 *
 * Warmup exclusion uses the v015 `set.set_kind` column (warmup / working /
 * dropset). Sets with kind='warmup' are PREP, not real volume, per
 * ADR-0019 Q4 / Q15.5 翻盤 ledger entry on 容量 公式.
 *
 * is_logged filter: only completed sets (tap-✓ flipped is_logged to 1)
 * contribute to 容量 — matches ADR-0019 Q15.5「Σ working/non-warmup
 * (is_logged=1)」.
 *
 * Asymmetric cluster handling: a cluster row pair (A side / B side) lives
 * as two separate `set` rows linked via `session_exercise.parent_id`; the
 * volume helper treats them identically (each side contributes its own
 * weight×reps). Asymmetric = unequal number of completed cycles on each
 * side, which is handled naturally by per-row iteration.
 */

import type { SetKind } from '../set/setLabels';

export interface SessionVolumeInput {
  set_kind: SetKind;
  is_logged: number; // 0/1
  weight_kg: number | null;
  reps: number | null;
}

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

/**
 * Format a millisecond duration as `HH:mm`. Negative or non-finite input
 * returns `00:00`. Hours roll past 24 (e.g. an open in-progress session
 * left for two days would show e.g. `48:13` rather than wrap).
 */
export function formatDurationHHMM(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '00:00';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export interface SessionStatsInput {
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

export interface SessionStats {
  /** Total session duration in ms (started_at → ended_at, or → now if open). */
  durationMs: number;
  /** Volume — Σ weight×reps over logged non-warmup sets. */
  volume: number;
  /** Distinct session_exercise row count. */
  exerciseCount: number;
  /** HealthKit kcal column (v016); null = no data yet → UI shows '—'. */
  kcal: number | null;
}

export function computeSessionStats(input: SessionStatsInput): SessionStats {
  const endTs = input.session.ended_at ?? (input.now ?? Date.now)();
  const durationMs = Math.max(0, endTs - input.session.started_at);
  return {
    durationMs,
    volume: computeSessionVolume(input.sets),
    exerciseCount: input.exerciseCount,
    kcal: input.session.kcal,
  };
}
