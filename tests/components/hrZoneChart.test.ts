/**
 * Slice 13a C2 — HRZoneChart layout / scaling helpers.
 *
 * The component (`components/session/hr-zone-chart.tsx`) is a thin JSX
 * wrapper; all math + state decisions live in `hr-zone-chart.behavior.ts`
 * so we can test them under the project's `testEnvironment: node` jest
 * config (no RN renderer). Mirrors the F2/F4 SessionTitleEditor behavior
 * split pattern.
 *
 * Covers: empty-state predicate, Y/X axis scaling, zone band layout at
 * Z1-Z5 boundaries, sample path SVG-d emission, elapsed-time formatter.
 *
 * See ADR-0019 § Slice 13 Phase A Amendment.
 */

import {
  bpmToY,
  buildSamplePath,
  formatElapsedShort,
  shouldShowEmptyHint,
  tsToX,
  Y_BPM_MAX,
  Y_BPM_MIN,
  yAxisTicks,
  ZONE_COLORS,
  zoneBands,
  type ChartDims,
  type HRSample,
} from '../../components/session/hr-zone-chart.behavior';

const DIMS: ChartDims = {
  width: 320,
  height: 220,
  padTop: 16,
  padBottom: 36,
  padLeft: 40,
  padRight: 16,
};

const CHART_H = DIMS.height - DIMS.padTop - DIMS.padBottom; // 168
const CHART_W = DIMS.width - DIMS.padLeft - DIMS.padRight; // 264

describe('shouldShowEmptyHint', () => {
  it('returns true for null / undefined / empty array (Phase A defaults)', () => {
    expect(shouldShowEmptyHint(null)).toBe(true);
    expect(shouldShowEmptyHint(undefined)).toBe(true);
    expect(shouldShowEmptyHint([])).toBe(true);
  });

  it('returns false once any sample is present (Phase B path)', () => {
    expect(shouldShowEmptyHint([{ ts: 0, bpm: 120 }])).toBe(false);
  });
});

describe('bpmToY', () => {
  it('maps Y_BPM_MIN to the bottom of the chart area', () => {
    expect(bpmToY(Y_BPM_MIN, DIMS)).toBeCloseTo(DIMS.padTop + CHART_H, 5);
  });

  it('maps Y_BPM_MAX to the top of the chart area', () => {
    expect(bpmToY(Y_BPM_MAX, DIMS)).toBeCloseTo(DIMS.padTop, 5);
  });

  it('clamps below / above range to the canvas edges', () => {
    expect(bpmToY(40, DIMS)).toBeCloseTo(DIMS.padTop + CHART_H, 5);
    expect(bpmToY(260, DIMS)).toBeCloseTo(DIMS.padTop, 5);
  });

  it('interpolates linearly mid-range', () => {
    // 130 = (130-60)/(200-60) = 50% from bottom → y = padTop + 0.5*chartH
    expect(bpmToY(130, DIMS)).toBeCloseTo(DIMS.padTop + 0.5 * CHART_H, 5);
  });
});

describe('tsToX', () => {
  it('maps 0 elapsed sec to padLeft', () => {
    expect(tsToX(0, 600, DIMS)).toBeCloseTo(DIMS.padLeft, 5);
  });

  it('maps durationSec to right edge', () => {
    expect(tsToX(600, 600, DIMS)).toBeCloseTo(DIMS.padLeft + CHART_W, 5);
  });

  it('clamps negative / overshoot inputs', () => {
    expect(tsToX(-10, 600, DIMS)).toBeCloseTo(DIMS.padLeft, 5);
    expect(tsToX(9999, 600, DIMS)).toBeCloseTo(DIMS.padLeft + CHART_W, 5);
  });
});

describe('zoneBands', () => {
  it('returns 5 bands Z1-Z5 in order at hrmax=200', () => {
    const bands = zoneBands(200, DIMS);
    expect(bands).toHaveLength(5);
    expect(bands.map((b) => b.zone)).toEqual([1, 2, 3, 4, 5]);
  });

  it('computes correct BPM bounds for each zone at hrmax=200', () => {
    const bands = zoneBands(200, DIMS);
    // Z1: 50-60% → 100-120, Z2: 60-70% → 120-140, etc.
    expect(bands[0].bpmFrom).toBe(100);
    expect(bands[0].bpmTo).toBe(120);
    expect(bands[1].bpmFrom).toBe(120);
    expect(bands[1].bpmTo).toBe(140);
    expect(bands[3].bpmFrom).toBe(160);
    expect(bands[3].bpmTo).toBe(180);
    // Z5 top is clamped to Y_BPM_MAX
    expect(bands[4].bpmFrom).toBe(180);
    expect(bands[4].bpmTo).toBe(Y_BPM_MAX);
  });

  it('aligns band Y coords with bpmToY for the band bounds', () => {
    const bands = zoneBands(200, DIMS);
    for (const band of bands) {
      expect(band.yBottom).toBeCloseTo(bpmToY(band.bpmFrom, DIMS), 5);
      expect(band.yTop).toBeCloseTo(bpmToY(band.bpmTo, DIMS), 5);
      // Top is above bottom in SVG (smaller y = higher on screen).
      expect(band.yTop).toBeLessThanOrEqual(band.yBottom);
    }
  });

  it('assigns the canonical Polar/Garmin-style color palette per zone', () => {
    const bands = zoneBands(200, DIMS);
    expect(bands[0].color).toBe(ZONE_COLORS[1]);
    expect(bands[4].color).toBe(ZONE_COLORS[5]);
  });
});

describe('buildSamplePath', () => {
  it('returns empty string for null / empty / single-sample input', () => {
    expect(buildSamplePath(null, 0, 600, DIMS)).toBe('');
    expect(buildSamplePath([], 0, 600, DIMS)).toBe('');
    expect(buildSamplePath([{ ts: 1000, bpm: 140 }], 0, 600, DIMS)).toBe('');
  });

  it('emits a single M followed by L commands for >=2 samples', () => {
    const samples: HRSample[] = [
      { ts: 0, bpm: 100 },
      { ts: 60_000, bpm: 140 },
      { ts: 120_000, bpm: 160 },
    ];
    const d = buildSamplePath(samples, 0, 120, DIMS);
    const cmds = d.split(' ');
    // Three points: M x y L x y L x y → 9 tokens
    expect(cmds[0]).toBe('M');
    expect(cmds[3]).toBe('L');
    expect(cmds[6]).toBe('L');
    expect(cmds).toHaveLength(9);
  });
});

describe('formatElapsedShort', () => {
  it('formats common minute / second pairs', () => {
    expect(formatElapsedShort(0)).toBe("0'00\"");
    expect(formatElapsedShort(5)).toBe("0'05\"");
    expect(formatElapsedShort(65)).toBe("1'05\"");
    expect(formatElapsedShort(125)).toBe("2'05\"");
  });

  it('clamps negative / non-finite to 0\'00"', () => {
    expect(formatElapsedShort(-10)).toBe("0'00\"");
    expect(formatElapsedShort(NaN)).toBe("0'00\"");
  });
});

describe('yAxisTicks', () => {
  it('returns ascending BPM ticks within the chart Y range', () => {
    const ticks = yAxisTicks();
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    const sorted = [...ticks].sort((a, b) => a - b);
    expect(ticks).toEqual(sorted);
    for (const tick of ticks) {
      expect(tick).toBeGreaterThanOrEqual(Y_BPM_MIN);
      expect(tick).toBeLessThanOrEqual(Y_BPM_MAX);
    }
  });
});
