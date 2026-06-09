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
 * (`src/adapters/watch/watchHistory.ts`) resolves `unit` / `weekdayLabels` /
 * `topSetLabel` / `bucketLabelFor` and runs the DB read.
 *
 * Record shape mirrors the Swift `ExerciseHistoryRecord` 1:1
 * (id / dateLabel / topSetLine / workingSetCount / setLines).
 *
 * 2026-06-09 layout 對齊手機 (grill ① = 頂組行＋逐組編號): the card now mirrors
 * the iPhone exercise-history card — full `yyyy-MM-dd (週次)` date header, a
 * `頂組：<w>×<r>（<bucket>）` highlight line (the heaviest effective-load
 * working set + its rep-bucket label — same `pickTopSet` rule the iPhone uses,
 * minus the dropset-follower exclusion which is a no-op because a follower's
 * load is always ≤ its head), and per-working-set lines the Swift view numbers
 * 1/2/3. Warmup still excluded (D15 spec Q5=A).
 *
 * ADR-0019 § Slice 13d D15 (frozen 2026-05-28; 2026-06-09 grill replaced the
 * Phase-A `ExerciseHistoryMock` with this real pull-on-tap path + 手機-aligned
 * layout).
 */

import { displayWeight } from '../body/unitConversion';
import type { UnitPreference } from '../body/types';
import { effectiveLoad } from '../pr/e1rmEngine';
import type { LoadType } from '../exercise/types';

/** One past session's summary row, mirrors Swift `ExerciseHistoryRecord`. */
export interface WatchHistoryRecord {
  /** Stable row id — `YYYY-MM-DD` (local) of the session start. */
  id: string;
  /** Pre-formatted date header, e.g. `2026-05-26 (二)` (weekday localised). */
  dateLabel: string;
  /**
   * Pre-formatted top-set highlight, e.g. `頂組：80kg×8（增肌）` — the heaviest
   * effective-load working set + its rep-bucket label. EMPTY STRING when the
   * session has no eligible weighted working set (e.g. pure-bodyweight with no
   * logged load — the Swift view hides the line on ''). NOT null: this rides
   * the WC reply via `toWireRecord` (a no-op cast), and a JS `null` would
   * bridge to `NSNull`, which WCSession rejects (`payloadUnsupportedTypes`),
   * breaking the whole reply. '' is plist-safe.
   */
  topSetLine: string;
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
  /** Per-exercise load type (joined from exercise row) — for the top-set effective-load rank. */
  load_type: LoadType;
  /** Session bodyweight snapshot (kg) — for assisted/bodyweight effective load. null when unset. */
  bw_snapshot_kg: number | null;
}

export interface BuildWatchHistoryOptions {
  unit: UnitPreference;
  /** 7 localised weekday labels, index = `Date.getDay()` (0=Sun..6=Sat). */
  weekdayLabels: readonly string[];
  /** Localised top-set prefix, e.g. `頂組：` (`t('status','topSetLabel')`). */
  topSetLabel: string;
  /**
   * Maps a set's reps to a localised rep-bucket label (e.g. 8 → `增肌`), or ''
   * for null/invalid reps. Injected so the pure builder stays i18n-free
   * (mirrors the iPhone's `tPrBucketLabel(bucketLabel(classifyBucket(reps)))`).
   */
  bucketLabelFor: (reps: number | null) => string;
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
 * Build the `頂組：…` line for one session's rows. Top set = the heaviest
 * effective-load NON-warmup set (mirrors `src/domain/pr/topSet.ts::pickTopSet`;
 * the iPhone also drops dropset FOLLOWERS, but that's a no-op for a MAX since a
 * follower's load is always ≤ its head, so we don't need `parent_set_id` on the
 * wire). A null-weight set is not a candidate (matches pickTopSet's
 * `weight_kg == null ? null`). Returns '' (not null — wire-safe, see
 * WatchHistoryRecord.topSetLine) when no eligible set exists.
 */
function buildTopSetLine(
  sessionRows: ReadonlyArray<WatchHistorySetRow>,
  opts: BuildWatchHistoryOptions,
): string {
  let best: { row: WatchHistorySetRow; eff: number } | null = null;
  for (const s of sessionRows) {
    if (s.set_kind === 'warmup') continue;
    // Only WEIGHTED / assisted sets (a positive load entry) are 頂組
    // candidates. Pure bodyweight (weight_kg 0/null) has no meaningful
    // "heaviest set" — the iPhone's pickTopSet would pick an arbitrary eff=0
    // row, so we suppress the line instead (per-set rows still show every BW
    // set). `assisted` carries the assist amount (> 0) → still a candidate.
    if (s.weight_kg == null || s.weight_kg <= 0) continue;
    const eff = effectiveLoad(s.weight_kg, s.load_type, s.bw_snapshot_kg);
    if (eff == null) continue;
    if (best == null || eff > best.eff) best = { row: s, eff };
  }
  if (best == null) return '';
  const top = best.row;
  const body = formatSetLine(top.weight_kg, top.reps, opts.unit);
  const bucket = opts.bucketLabelFor(top.reps);
  const suffix = bucket ? `（${bucket}）` : '';
  return `${opts.topSetLabel}${body}${suffix}`;
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
    const id = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    out.push({
      id,
      dateLabel: `${id} (${opts.weekdayLabels[d.getDay()] ?? ''})`,
      // Top set is picked across ALL non-warmup rows of the session (incl.
      // dropset rows), not just `working` — see buildTopSetLine.
      topSetLine: buildTopSetLine(bucket, opts),
      workingSetCount: working.length,
      setLines: working.map((s) => formatSetLine(s.weight_kg, s.reps, opts.unit)),
    });
  }
  return out;
}
