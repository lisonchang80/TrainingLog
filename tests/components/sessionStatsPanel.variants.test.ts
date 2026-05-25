/**
 * Slice 13a C3 — SessionStatsPanel variant + formatter tests.
 *
 * Component is JSX-wrapped under RN — we can't render it in
 * `testEnvironment: node`. The variant decisions + NULL fallback +
 * HR-zone border color logic live in
 * `components/session/session-stats-panel.behavior.ts` and are tested here.
 *
 * Mirrors session-title-editor.behavior.ts split pattern (F2/F4) and
 * hr-zone-chart.behavior.ts (C2).
 *
 * See ADR-0019 § Slice 13 Phase A Amendment (Q6 / Q10).
 */

import {
  bottomRowCount,
  formatAvgHr,
  formatKcal,
  hrTileBorderColor,
  tilesForVariant,
} from '../../components/session/session-stats-panel.behavior';
import { ZONE_COLORS } from '../../components/session/hr-zone-chart.behavior';

describe('tilesForVariant', () => {
  it('3tile → [duration, volume, exerciseCount] (legacy in-session)', () => {
    expect(tilesForVariant('3tile')).toEqual([
      'duration',
      'volume',
      'exerciseCount',
    ]);
  });

  it('4tile → adds kcal as 4th tile (session detail page)', () => {
    expect(tilesForVariant('4tile')).toEqual([
      'duration',
      'volume',
      'exerciseCount',
      'kcal',
    ]);
  });

  it('5tile-watch → 3 + 2 layout with avgHr + kcal in row 2', () => {
    expect(tilesForVariant('5tile-watch')).toEqual([
      'duration',
      'volume',
      'exerciseCount',
      'avgHr',
      'kcal',
    ]);
  });
});

describe('bottomRowCount', () => {
  it('returns 0 for single-row 3tile, 2 for 4tile / 5tile-watch', () => {
    expect(bottomRowCount('3tile')).toBe(0);
    expect(bottomRowCount('4tile')).toBe(2);
    expect(bottomRowCount('5tile-watch')).toBe(2);
  });
});

describe('formatKcal', () => {
  it('NULL / undefined / negative / NaN → "—" placeholder', () => {
    expect(formatKcal(null)).toBe('—');
    expect(formatKcal(undefined)).toBe('—');
    expect(formatKcal(-5)).toBe('—');
    expect(formatKcal(NaN)).toBe('—');
  });

  it('rounds positive values to integer string', () => {
    expect(formatKcal(0)).toBe('0');
    expect(formatKcal(250)).toBe('250');
    expect(formatKcal(333.7)).toBe('334');
  });
});

describe('formatAvgHr', () => {
  it('NULL / 0 / negative / NaN → "—" placeholder', () => {
    expect(formatAvgHr(null)).toBe('—');
    expect(formatAvgHr(0)).toBe('—'); // 0 BPM is nonsense — treat as missing
    expect(formatAvgHr(-1)).toBe('—');
    expect(formatAvgHr(NaN)).toBe('—');
  });

  it('rounds positive BPM to integer string (no unit suffix)', () => {
    expect(formatAvgHr(145)).toBe('145');
    expect(formatAvgHr(160.4)).toBe('160');
    expect(formatAvgHr(160.6)).toBe('161');
  });
});

describe('hrTileBorderColor', () => {
  it('returns NULL when avgHr or userAge is missing / non-finite', () => {
    expect(hrTileBorderColor(null, 30)).toBeNull();
    expect(hrTileBorderColor(150, null)).toBeNull();
    expect(hrTileBorderColor(0, 30)).toBeNull();
    expect(hrTileBorderColor(150, 0)).toBeNull();
    expect(hrTileBorderColor(NaN, 30)).toBeNull();
  });

  it('returns NULL when avgHr falls below Z1 (no zone)', () => {
    // Age 30 → HRmax 190. 80 BPM = 42% → below Z1.
    expect(hrTileBorderColor(80, 30)).toBeNull();
  });

  it('returns the correct Z-zone color for valid avgHr / age pair', () => {
    // Age 30 → HRmax 190.
    //   140 BPM = 73.7% → Z3 (yellow)
    expect(hrTileBorderColor(140, 30)).toBe(ZONE_COLORS[3]);
    //   160 BPM = 84.2% → Z4 (orange)
    expect(hrTileBorderColor(160, 30)).toBe(ZONE_COLORS[4]);
    //   180 BPM = 94.7% → Z5 (red)
    expect(hrTileBorderColor(180, 30)).toBe(ZONE_COLORS[5]);
  });
});
