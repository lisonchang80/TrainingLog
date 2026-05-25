/**
 * SessionStatsPanel pure layout / formatter helpers (Slice 13a C3).
 *
 * Branches the 3 variants ratified in ADR-0019 § Slice 13 Phase A Amendment
 * (2026-05-25):
 *   - '3tile'        — legacy in-session row (duration / volume / 動作數)
 *   - '4tile'        — session detail page 2×2 grid (adds kcal as 4th tile)
 *   - '5tile-watch'  — Watch-tracked variant; 3 + 2 layout adds avg HR + kcal
 *
 * Phase A reality: kcal / avgHr always NULL (HealthKit not yet wired). The
 * formatters return '—' for NULL so the tile widths stay stable. Phase B
 * HealthKit ingest will deliver real numbers, no UI churn needed.
 *
 * The behavior module exists to keep variant + formatter logic testable
 * under `testEnvironment: node` (no RN renderer) — same split pattern as
 * session-title-editor.behavior.ts and hr-zone-chart.behavior.ts.
 */

import { computeHRmax, zoneOf } from '../../src/domain/session/hrZones';
import { ZONE_COLORS } from './hr-zone-chart.behavior';

export type StatsTileVariant = '3tile' | '4tile' | '5tile-watch';

export type StatsTileKey =
  | 'duration'
  | 'volume'
  | 'exerciseCount'
  | 'kcal'
  | 'avgHr';

/**
 * Tile order for each variant. Layout row-major:
 *   - '3tile'       → single row of 3
 *   - '4tile'       → 2 × 2 grid (row1: duration / volume, row2: exerciseCount / kcal)
 *   - '5tile-watch' → 2 rows: row1 of 3 (duration / volume / exerciseCount),
 *                     row2 of 2 (avgHr / kcal)
 *
 * Consumers (the JSX component) split this by variant — the test surface
 * doesn't need to know row breaks, only the ordered tile sequence.
 */
export function tilesForVariant(variant: StatsTileVariant): StatsTileKey[] {
  switch (variant) {
    case '3tile':
      return ['duration', 'volume', 'exerciseCount'];
    case '4tile':
      return ['duration', 'volume', 'exerciseCount', 'kcal'];
    case '5tile-watch':
      return ['duration', 'volume', 'exerciseCount', 'avgHr', 'kcal'];
  }
}

/**
 * Number of tiles in the SECOND row for variants that wrap.
 *   - '3tile'       → 0 (single row)
 *   - '4tile'       → 2 (2×2 layout)
 *   - '5tile-watch' → 2 (3 + 2 layout)
 */
export function bottomRowCount(variant: StatsTileVariant): number {
  switch (variant) {
    case '3tile':
      return 0;
    case '4tile':
      return 2;
    case '5tile-watch':
      return 2;
  }
}

/**
 * Format kcal for the tile. NULL → '—' (waiting on HealthKit). Negative /
 * non-finite are defensive-clamped to '—' so we never paint garbage during
 * a flaky HK ingest in Phase B.
 */
export function formatKcal(kcal: number | null | undefined): string {
  if (kcal == null || !Number.isFinite(kcal) || kcal < 0) return '—';
  return String(Math.round(kcal));
}

/**
 * Format average HR for the tile. NULL → '—'. Always integer BPM (no unit
 * suffix — the label below the big number says BPM already, repeating it
 * doubles tile content for no info gain).
 */
export function formatAvgHr(avgHr: number | null | undefined): string {
  if (avgHr == null || !Number.isFinite(avgHr) || avgHr <= 0) return '—';
  return String(Math.round(avgHr));
}

/**
 * Border color for the HR tile in the 5-tile-watch variant. Returns the
 * Z-zone hex when `avgHr` + `userAge` are both valid; otherwise NULL (caller
 * falls back to the default tile border / theme token).
 */
export function hrTileBorderColor(
  avgHr: number | null | undefined,
  userAge: number | null | undefined,
): string | null {
  if (
    avgHr == null ||
    !Number.isFinite(avgHr) ||
    avgHr <= 0 ||
    userAge == null ||
    !Number.isFinite(userAge) ||
    userAge <= 0
  ) {
    return null;
  }
  const hrmax = computeHRmax(userAge);
  const z = zoneOf(avgHr, hrmax);
  return z === null ? null : ZONE_COLORS[z];
}
