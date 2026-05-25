/**
 * Pure layout / scaling helpers for HRZoneChart (Slice 13a C2).
 *
 * The component (`hr-zone-chart.tsx`) is a thin JSX wrapper around these
 * functions. All math + decision logic lives here so it can be tested with
 * the project's `testEnvironment: node` jest config (no RN renderer).
 *
 * Phase A reality: `samples` will always be null/empty (HealthKit not yet
 * wired). Y/X scale + zone band positions still compute deterministically
 * so the placeholder canvas renders identically with or without data.
 *
 * See ADR-0019 § Slice 13 Phase A Amendment.
 */

import { zoneOf, type HRSample, type ZoneSummary } from '../../src/domain/session/hrZones';

export interface ChartDims {
  width: number;
  height: number;
  padTop: number;
  padBottom: number;
  padLeft: number;
  padRight: number;
}

/** Fixed-range BPM axis. Wide enough to fit Z1 (50%) through Z5 spike for
 *  typical adult HRmax (170-200). Phase B can tighten dynamically per session. */
export const Y_BPM_MIN = 60;
export const Y_BPM_MAX = 200;

export interface ZoneBand {
  zone: 1 | 2 | 3 | 4 | 5;
  /** Inclusive lower BPM bound at the given HRmax. */
  bpmFrom: number;
  /** Exclusive upper BPM bound (Z5 has no upper — chart caps at Y_BPM_MAX). */
  bpmTo: number;
  /** SVG Y coord of the band's TOP edge. */
  yTop: number;
  /** SVG Y coord of the band's BOTTOM edge (yTop < yBottom in SVG space). */
  yBottom: number;
  /** Stable color string (translucent 20-30% opacity recommended at use site). */
  color: string;
}

/**
 * Per-zone palette — fixed, intentionally non-token (data-channel colors,
 * not theme chrome). Mirrors common Polar / Garmin convention:
 *   Z1 cool grey-blue · Z2 green · Z3 yellow · Z4 orange · Z5 red.
 */
export const ZONE_COLORS: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: '#B0BEC5',
  2: '#66BB6A',
  3: '#FFEB3B',
  4: '#FF9800',
  5: '#F44336',
};

/** Map BPM → SVG Y coordinate within the chart canvas. Lower BPM ⇒ higher Y. */
export function bpmToY(bpm: number, dims: ChartDims): number {
  const chartH = dims.height - dims.padTop - dims.padBottom;
  const clamped = Math.max(Y_BPM_MIN, Math.min(Y_BPM_MAX, bpm));
  const norm = (clamped - Y_BPM_MIN) / (Y_BPM_MAX - Y_BPM_MIN);
  return dims.padTop + (1 - norm) * chartH;
}

/** Map session-elapsed seconds → SVG X coordinate. Negative / overshoot clamp. */
export function tsToX(elapsedSec: number, durationSec: number, dims: ChartDims): number {
  const chartW = dims.width - dims.padLeft - dims.padRight;
  const span = Math.max(1, durationSec);
  const clamped = Math.max(0, Math.min(span, elapsedSec));
  return dims.padLeft + (clamped / span) * chartW;
}

/**
 * Build the 5-band Z1-Z5 layout for the given HRmax. Each band's BPM bounds
 * are derived from %HRmax (50/60/70/80/90/100); Y coords are computed from
 * `bpmToY`. Z5's upper bound is the chart top (Y_BPM_MAX). Bands intentionally
 * clip to chart range — extreme HRmax (e.g. 250) won't escape the canvas.
 */
export function zoneBands(hrmax: number, dims: ChartDims): ZoneBand[] {
  const breaks: Array<{ pct: number; zone: 1 | 2 | 3 | 4 | 5 }> = [
    { pct: 0.5, zone: 1 },
    { pct: 0.6, zone: 2 },
    { pct: 0.7, zone: 3 },
    { pct: 0.8, zone: 4 },
    { pct: 0.9, zone: 5 },
  ];
  return breaks.map((b, i) => {
    const bpmFrom = hrmax * b.pct;
    const bpmTo = i < breaks.length - 1 ? hrmax * breaks[i + 1].pct : Y_BPM_MAX;
    return {
      zone: b.zone,
      bpmFrom,
      bpmTo,
      yBottom: bpmToY(bpmFrom, dims),
      yTop: bpmToY(bpmTo, dims),
      color: ZONE_COLORS[b.zone],
    };
  });
}

/**
 * Build an SVG path `d` attribute from sample series. First sample seeds a
 * moveTo; subsequent samples are lineTo. Returns '' for null / empty / single
 * sample (single point gets a circle elsewhere, no path needed).
 */
export function buildSamplePath(
  samples: HRSample[] | null,
  sessionStartTs: number,
  durationSec: number,
  dims: ChartDims,
): string {
  if (!samples || samples.length < 2) return '';
  const cmds: string[] = [];
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const x = tsToX((s.ts - sessionStartTs) / 1000, durationSec, dims);
    const y = bpmToY(s.bpm, dims);
    cmds.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return cmds.join(' ');
}

/** Show the centered empty hint when no HR samples are available. */
export function shouldShowEmptyHint(samples: HRSample[] | null | undefined): boolean {
  return !samples || samples.length === 0;
}

/** Y-axis tick BPM values at sensible round numbers within [Y_BPM_MIN, Y_BPM_MAX]. */
export function yAxisTicks(): number[] {
  return [60, 100, 140, 180];
}

/** Format a time-axis label (mm:ss). Used for X-axis tick labels at 0 / mid / end. */
export function formatElapsedShort(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0'00\"";
  const total = Math.floor(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}'${String(s).padStart(2, '0')}"`;
}

/** Re-export so the component module has a single import surface. */
export type { HRSample, ZoneSummary };
export { zoneOf };
