/**
 * Slice 13a C1 — HR zone bucketing (Phase A scaffold).
 *
 * Covers `computeHRmax` / `zoneOf` / `bucketSamples` from
 * src/domain/session/hrZones.ts. Phase A call sites pass empty / null inputs
 * but the math is wired for Phase B HealthKit ingest, so all branches are
 * tested up-front.
 *
 * See ADR-0019 § Slice 13 Phase A Amendment (ratified 2026-05-25).
 */

import {
  bucketSamples,
  computeHRmax,
  zoneOf,
  type HRSample,
} from '../../src/domain/session/hrZones';

describe('computeHRmax', () => {
  it('returns 220 - age for typical adult age', () => {
    expect(computeHRmax(30)).toBe(190);
    expect(computeHRmax(50)).toBe(170);
    expect(computeHRmax(25)).toBe(195);
  });

  it('floors floats by truncating fractional age', () => {
    expect(computeHRmax(30.7)).toBe(190);
  });

  it('defends against non-positive / NaN age by returning 220', () => {
    expect(computeHRmax(0)).toBe(220);
    expect(computeHRmax(-5)).toBe(220);
    expect(computeHRmax(NaN)).toBe(220);
    expect(computeHRmax(Infinity)).toBe(220);
  });

  it('floors hrmax at 100 for absurd ages', () => {
    expect(computeHRmax(300)).toBe(100);
    expect(computeHRmax(150)).toBe(100); // 220 - 150 = 70 → floored
  });
});

describe('zoneOf', () => {
  // Using hrmax = 200 → clean breakpoints at 100/120/140/160/180.
  const HRMAX = 200;

  it('returns null below Z1 lower bound (< 50% HRmax)', () => {
    expect(zoneOf(80, HRMAX)).toBeNull(); // 40% — too low
    expect(zoneOf(99, HRMAX)).toBeNull(); // just under
  });

  it('maps bpm to Z1-Z5 at each boundary', () => {
    expect(zoneOf(100, HRMAX)).toBe(1); // 50% — Z1 inclusive
    expect(zoneOf(119, HRMAX)).toBe(1); // 59.5% — still Z1
    expect(zoneOf(120, HRMAX)).toBe(2); // 60% — Z2 inclusive
    expect(zoneOf(140, HRMAX)).toBe(3); // 70%
    expect(zoneOf(160, HRMAX)).toBe(4); // 80%
    expect(zoneOf(180, HRMAX)).toBe(5); // 90%
  });

  it('caps Z5 with no upper bound (sprint spikes stay Z5)', () => {
    expect(zoneOf(220, HRMAX)).toBe(5); // 110% — still Z5
    expect(zoneOf(300, HRMAX)).toBe(5); // unrealistic but defensive
  });

  it('defends against NaN / non-finite inputs by returning null', () => {
    expect(zoneOf(NaN, HRMAX)).toBeNull();
    expect(zoneOf(150, NaN)).toBeNull();
    expect(zoneOf(150, 0)).toBeNull();
    expect(zoneOf(150, -100)).toBeNull();
  });
});

describe('bucketSamples', () => {
  const HRMAX = 200;

  it('returns 5 zero-filled entries for empty input', () => {
    const out = bucketSamples([], HRMAX);
    expect(out).toHaveLength(5);
    expect(out.map((z) => z.zone)).toEqual([1, 2, 3, 4, 5]);
    expect(out.every((z) => z.seconds === 0 && z.pct === 0)).toBe(true);
  });

  it('returns all-zero for a single sample (no delta to attribute)', () => {
    const out = bucketSamples([{ ts: 1000, bpm: 150 }], HRMAX);
    expect(out.every((z) => z.seconds === 0)).toBe(true);
  });

  it('attributes delta seconds to the SECOND sample of each pair', () => {
    // 10 sec from ts=0→10000 at 150 BPM (Z3); next 10 sec at 165 BPM (Z4).
    const samples: HRSample[] = [
      { ts: 0, bpm: 90 }, // below Z1, won't seed anything
      { ts: 10_000, bpm: 150 }, // Z3 attribution 10 sec
      { ts: 20_000, bpm: 165 }, // Z4 attribution 10 sec
    ];
    const out = bucketSamples(samples, HRMAX);
    const z3 = out.find((z) => z.zone === 3)!;
    const z4 = out.find((z) => z.zone === 4)!;
    expect(z3.seconds).toBe(10);
    expect(z4.seconds).toBe(10);
    expect(z3.pct).toBeCloseTo(0.5, 5);
    expect(z4.pct).toBeCloseTo(0.5, 5);
  });

  it('skips deltas where the second sample is below Z1', () => {
    // 10 sec at 80 BPM (40%, below Z1) → skipped.
    const samples: HRSample[] = [
      { ts: 0, bpm: 150 },
      { ts: 10_000, bpm: 80 },
      { ts: 20_000, bpm: 150 }, // Z3 attribution 10 sec
    ];
    const out = bucketSamples(samples, HRMAX);
    const total = out.reduce((acc, z) => acc + z.seconds, 0);
    expect(total).toBe(10);
    expect(out.find((z) => z.zone === 3)!.seconds).toBe(10);
  });

  it('skips non-positive time deltas (out-of-order samples defensive)', () => {
    const samples: HRSample[] = [
      { ts: 10_000, bpm: 150 },
      { ts: 5_000, bpm: 150 }, // out-of-order → dt < 0, skipped
      { ts: 15_000, bpm: 150 }, // 10 sec forward from prev → Z3 attribution
    ];
    const out = bucketSamples(samples, HRMAX);
    expect(out.find((z) => z.zone === 3)!.seconds).toBe(10);
  });

  it('sums pct to 1.0 (or 0) across non-empty bucketed input', () => {
    const samples: HRSample[] = [
      { ts: 0, bpm: 100 },
      { ts: 60_000, bpm: 100 }, // Z1: 60 sec
      { ts: 120_000, bpm: 140 }, // Z3: 60 sec
      { ts: 180_000, bpm: 165 }, // Z4: 60 sec
    ];
    const out = bucketSamples(samples, HRMAX);
    const totalPct = out.reduce((acc, z) => acc + z.pct, 0);
    expect(totalPct).toBeCloseTo(1.0, 5);
    expect(out.find((z) => z.zone === 1)!.seconds).toBe(60);
    expect(out.find((z) => z.zone === 3)!.seconds).toBe(60);
    expect(out.find((z) => z.zone === 4)!.seconds).toBe(60);
  });
});
