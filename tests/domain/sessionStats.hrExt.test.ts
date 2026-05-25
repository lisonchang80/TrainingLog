/**
 * Slice 13a C1 — sessionStats HR extension (Phase A NULL behavior).
 *
 * Covers DetailPageStats avgHr / maxHr / zones outputs. Phase A call sites
 * omit hrSamples + userAge → all three NULL. Phase B HealthKit ingest will
 * supply both → real computation kicks in (also tested here).
 *
 * See ADR-0019 § Slice 13 Phase A Amendment (ratified 2026-05-25).
 */

import { computeDetailPageStats } from '../../src/domain/session/sessionStats';
import type { HRSample } from '../../src/domain/session/hrZones';

const baseInput = {
  session: {
    started_at: 1_700_000_000_000,
    ended_at: 1_700_000_060_000, // 60 sec session for clean math
    kcal: null as number | null,
  },
  exerciseCount: 3,
  sets: [],
};

describe('computeDetailPageStats — HR extension (Slice 13a)', () => {
  it('returns NULL for avgHr / maxHr / zones when no hrSamples passed (Phase A default)', () => {
    const out = computeDetailPageStats(baseInput);
    expect(out.avgHr).toBeNull();
    expect(out.maxHr).toBeNull();
    expect(out.zones).toBeNull();
  });

  it('returns NULL when hrSamples is empty array', () => {
    const out = computeDetailPageStats({
      ...baseInput,
      hrSamples: [],
      userAge: 30,
    });
    expect(out.avgHr).toBeNull();
    expect(out.maxHr).toBeNull();
    expect(out.zones).toBeNull();
  });

  it('returns NULL when userAge is missing even with valid samples', () => {
    const samples: HRSample[] = [
      { ts: 0, bpm: 140 },
      { ts: 30_000, bpm: 160 },
    ];
    const out = computeDetailPageStats({ ...baseInput, hrSamples: samples });
    expect(out.avgHr).toBeNull();
    expect(out.maxHr).toBeNull();
    expect(out.zones).toBeNull();
  });

  it('computes avgHr / maxHr / zones when both samples + age are provided (Phase B preview)', () => {
    // Age 30 → HRmax 190. 140 BPM = 73.7% → Z3; 160 BPM = 84.2% → Z4.
    const samples: HRSample[] = [
      { ts: 0, bpm: 140 },
      { ts: 30_000, bpm: 160 }, // 30s attributed to Z4
      { ts: 60_000, bpm: 150 }, // 30s attributed to Z3
    ];
    const out = computeDetailPageStats({
      ...baseInput,
      hrSamples: samples,
      userAge: 30,
    });
    expect(out.avgHr).toBe(150); // (140+160+150)/3 = 150
    expect(out.maxHr).toBe(160);
    expect(out.zones).not.toBeNull();
    expect(out.zones).toHaveLength(5);
    const z3 = out.zones!.find((z) => z.zone === 3)!;
    const z4 = out.zones!.find((z) => z.zone === 4)!;
    expect(z3.seconds).toBe(30);
    expect(z4.seconds).toBe(30);
  });
});
