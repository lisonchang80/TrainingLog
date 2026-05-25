/**
 * Heart rate zone bucketing — Phase A scaffold.
 *
 * Backbone for ADR-0019 Slice 13 Phase A "HR chart placeholder + 5-tile shell"
 * deliverable (ratified 2026-05-25, see ADR-0019 § Slice 13 Phase A Amendment).
 * Real HR sample inputs land in Phase B once HealthKit + Watch are unlocked
 * (requires Expo Dev Build + react-native-health). Phase A code paths call
 * these with empty / null inputs and render scaffolded UI.
 *
 * Zone scheme (5-band, %HRmax — simplified Karvonen):
 *   Z1 [50, 60)% — recovery / very light
 *   Z2 [60, 70)% — light aerobic
 *   Z3 [70, 80)% — moderate
 *   Z4 [80, 90)% — hard
 *   Z5 [90, ∞)% — max effort (no upper cap; sprint spikes stay Z5)
 *
 * HRmax estimator: classic Fox formula `220 - age` (NOT Tanaka or HUNT —
 * keep simple for MVP; can swap later by changing this single function).
 *
 * Bucketing semantics: for samples [s0..sn], each consecutive pair contributes
 * `(s_{i+1}.ts - s_i.ts)` seconds attributed to `zoneOf(s_{i+1}.bpm)`. Out-of-
 * zone samples (bpm < 50% HRmax) silently skip their delta. Single-sample
 * input → all zones with 0 seconds.
 */

export type HRSample = { ts: number; bpm: number };

export type ZoneSummary = {
  zone: 1 | 2 | 3 | 4 | 5;
  seconds: number;
  pct: number;
};

/**
 * Classic Fox formula: HRmax = 220 - age. Floored at 100 to avoid silly
 * boundary cases. NaN / non-positive age falls back to 220 (defensive).
 */
export function computeHRmax(age: number): number {
  if (!Number.isFinite(age) || age <= 0) return 220;
  return Math.max(100, 220 - Math.floor(age));
}

/**
 * Map a BPM reading to its zone band (1-5) given an HRmax. Returns null when
 * bpm is below Z1 lower bound (< 50% HRmax) — those samples don't count.
 */
export function zoneOf(
  bpm: number,
  hrmax: number,
): 1 | 2 | 3 | 4 | 5 | null {
  if (!Number.isFinite(bpm) || !Number.isFinite(hrmax) || hrmax <= 0) {
    return null;
  }
  const pct = bpm / hrmax;
  if (pct < 0.5) return null;
  if (pct < 0.6) return 1;
  if (pct < 0.7) return 2;
  if (pct < 0.8) return 3;
  if (pct < 0.9) return 4;
  return 5;
}

/**
 * Group consecutive samples by zone, returning per-zone time totals + pct.
 * Always returns 5 entries (zones 1-5), zero-filled where no time accrues —
 * keeps downstream chart / legend rendering branchless.
 */
export function bucketSamples(
  samples: HRSample[],
  hrmax: number,
): ZoneSummary[] {
  const seconds: Record<1 | 2 | 3 | 4 | 5, number> = {
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
  };
  for (let i = 1; i < samples.length; i++) {
    const dt = (samples[i].ts - samples[i - 1].ts) / 1000;
    if (dt <= 0) continue;
    const z = zoneOf(samples[i].bpm, hrmax);
    if (z === null) continue;
    seconds[z] += dt;
  }
  const total = seconds[1] + seconds[2] + seconds[3] + seconds[4] + seconds[5];
  return ([1, 2, 3, 4, 5] as const).map((zone) => ({
    zone,
    seconds: seconds[zone],
    pct: total > 0 ? seconds[zone] / total : 0,
  }));
}
