/**
 * #311-A — pure builder for the Watch's 📊 exercise-history sub-page.
 *
 * The Watch has no SQLite + no unit/locale tables, so the iPhone owns the
 * query AND the display formatting (per Bug Y task #271 + the
 * `set-weight-unit-surfaces` skill: display strings cross the wire ready to
 * render; only raw FK ids — here `exerciseId` — travel un-formatted).
 *
 * This module is the PURE core: it folds the flat `queryExerciseHistory`
 * set rows (already sorted session-DESC) into the last-N per-session records
 * the Swift `ExerciseHistoryView` renders. Kept clock-free + DB-free so it
 * unit-tests under `testEnvironment: node`; the impure half
 * (`src/adapters/watch/watchHistory.ts`) resolves `unit` / `weekdayLabels`
 * and runs the DB read.
 *
 * Record shape mirrors the Swift `ExerciseHistoryRecord` 1:1
 * (id / dateLabel / workingSetCount / setLines).
 *
 * ADR-0019 § Slice 13d D15 (frozen 2026-05-28; 2026-06-09 grill replaced the
 * Phase-A `ExerciseHistoryMock` with this real pull-on-tap path).
 */

import { displayWeight } from '../body/unitConversion';
import type { UnitPreference } from '../body/types';

/** One past session's summary row, mirrors Swift `ExerciseHistoryRecord`. */
export interface WatchHistoryRecord {
  /** Stable row id — `YYYY-MM-DD` (local) of the session start. */
  id: string;
  /** Pre-formatted short date label, e.g. `05-26 (二)` (weekday localised). */
  dateLabel: string;
  /** Working-set count (warmup excluded). */
  workingSetCount: number;
  /** Per-working-set display strings, e.g. `["80kg×8", "80kg×8"]`. */
  setLines: string[];
}

/**
 * Minimal input row — a structural subset of `queryExerciseHistory`'s
 * `ExerciseHistoryRow` (which carries more fields we don't need here). Rows
 * MUST already be sorted session-most-recent-first (queryExerciseHistory
 * `ORDER BY ss.started_at DESC, s.ordering ASC`), which this builder relies
 * on for "last N sessions" + intra-session set order.
 */
export interface WatchHistorySetRow {
  session_id: string;
  /** Epoch ms of the owning session's `started_at`. */
  session_started_at: number;
  reps: number | null;
  /** Stored weight in kg (canonical); null/0 for pure bodyweight. */
  weight_kg: number | null;
  set_kind: string;
}

export interface BuildWatchHistoryOptions {
  unit: UnitPreference;
  /** 7 localised weekday labels, index = `Date.getDay()` (0=Sun..6=Sat). */
  weekdayLabels: readonly string[];
  /** Max distinct sessions to return (default 3 — ADR-0019 D15 Q5=A). */
  limitSessions?: number;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/**
 * Format one working set's display string.
 *   - weighted (kg > 0)  → `<displayWeight><unit>×<reps>`  (kg/lb honoured).
 *   - bodyweight (0/null) → `BW×<reps>`  (added weight absent).
 * `reps` null → `0` (defensive; logged sets normally carry reps).
 */
function formatSetLine(
  weightKg: number | null,
  reps: number | null,
  unit: UnitPreference,
): string {
  const r = reps ?? 0;
  if (weightKg != null && weightKg > 0) {
    return `${displayWeight(weightKg, unit)}${unit}×${r}`;
  }
  return `BW×${r}`;
}

/**
 * Fold flat set rows → at most `limitSessions` per-session records, most
 * recent first. Warmup sets are dropped (count + lines = working only, per
 * D15 spec line 13). A session whose only logged rows are warmups is skipped
 * (no working data to show) — so the N returned are always meaningful.
 */
export function buildWatchHistoryRecords(
  rows: ReadonlyArray<WatchHistorySetRow>,
  opts: BuildWatchHistoryOptions,
): WatchHistoryRecord[] {
  const limit = opts.limitSessions ?? 3;

  // Group by session_id preserving first-seen order. Rows arrive session-DESC
  // (queryExerciseHistory ORDER BY started_at DESC), so first-seen = newest.
  const order: string[] = [];
  const bySession = new Map<string, WatchHistorySetRow[]>();
  for (const row of rows) {
    const bucket = bySession.get(row.session_id);
    if (bucket) {
      bucket.push(row);
    } else {
      bySession.set(row.session_id, [row]);
      order.push(row.session_id);
    }
  }

  const out: WatchHistoryRecord[] = [];
  for (const sessionId of order) {
    if (out.length >= limit) break;
    const bucket = bySession.get(sessionId)!;
    const working = bucket.filter((s) => s.set_kind !== 'warmup');
    if (working.length === 0) continue; // warmup-only session — skip
    const d = new Date(bucket[0].session_started_at);
    const mm = d.getMonth() + 1;
    const dd = d.getDate();
    out.push({
      id: `${d.getFullYear()}-${pad2(mm)}-${pad2(dd)}`,
      dateLabel: `${pad2(mm)}-${pad2(dd)} (${opts.weekdayLabels[d.getDay()] ?? ''})`,
      workingSetCount: working.length,
      setLines: working.map((s) => formatSetLine(s.weight_kg, s.reps, opts.unit)),
    });
  }
  return out;
}
