import {
  bucketBoundaries,
  bucketIndexOf,
  capacityHistogramByMg,
  durationHistogram,
} from '../../src/domain/stats/statsEngine';
import type { StatsSetRecord } from '../../src/domain/stats/types';

const buildRecord = (
  override: Partial<StatsSetRecord> & {
    session_id: string;
    set_id: string;
  }
): StatsSetRecord => ({
  session_started_at: 0,
  session_ended_at: 60_000,
  exercise_id: 'ex-1',
  mg_id: 'mg-chest',
  m_ids: [],
  volume: 100,
  is_logged: true,
  ...override,
});

describe('bucketBoundaries', () => {
  it('returns 6 entries oldest first for year scale', () => {
    const now = new Date(2026, 4, 8); // 2026-05-08 local
    const out = bucketBoundaries('year', now);
    expect(out).toHaveLength(6);
    expect(out[0].offset).toBe(-5);
    expect(out[5].offset).toBe(0);
    expect(out[0].label).toBe('2021');
    expect(out[5].label).toBe('2026');
    // Offset 0 covers 2026-01-01 → 2027-01-01
    expect(out[5].start_ms).toBe(new Date(2026, 0, 1).getTime());
    expect(out[5].end_ms).toBe(new Date(2027, 0, 1).getTime());
  });

  it('returns 6 monthly buckets including current month', () => {
    const now = new Date(2026, 4, 8); // May 2026
    const out = bucketBoundaries('month', now);
    expect(out.map((b) => b.label)).toEqual(['12月', '1月', '2月', '3月', '4月', '5月']);
    // Last bucket = May 2026
    expect(out[5].start_ms).toBe(new Date(2026, 4, 1).getTime());
    expect(out[5].end_ms).toBe(new Date(2026, 5, 1).getTime());
  });

  it('handles month wrap-around correctly (Feb → Jan / Dec)', () => {
    const now = new Date(2026, 1, 15); // Feb 2026
    const out = bucketBoundaries('month', now);
    // -5 from Feb 2026 = Sep 2025
    expect(out[0].label).toBe('9月');
    expect(out[5].label).toBe('2月');
  });

  it('returns 6 weekly buckets ending in current week', () => {
    // 2026-05-08 is a Friday. Current week = Mon May 4 → Mon May 11.
    const now = new Date(2026, 4, 8);
    const out = bucketBoundaries('week', now);
    expect(out).toHaveLength(6);
    expect(out[5].start_ms).toBe(new Date(2026, 4, 4).getTime());
    expect(out[5].end_ms).toBe(new Date(2026, 4, 11).getTime());
    // -5 weeks back from current Mon = March 30
    expect(out[0].start_ms).toBe(new Date(2026, 2, 30).getTime());
  });

  it('week boundary: Sunday counts as part of the week ending that Sunday', () => {
    // 2026-05-10 is Sunday. The week (Mon-Sun) is May 4 → May 10 (inclusive).
    const now = new Date(2026, 4, 10);
    const out = bucketBoundaries('week', now);
    // Current week starts Mon May 4
    expect(out[5].start_ms).toBe(new Date(2026, 4, 4).getTime());
  });

  it('defaults `now` to the real clock when omitted (line 99 default branch)', () => {
    // Don't assert on wall-clock-dependent values — just the invariant shape:
    // 6 monotonically-increasing buckets, offsets -5..0, current period last.
    const out = bucketBoundaries('month');
    expect(out).toHaveLength(6);
    expect(out.map((b) => b.offset)).toEqual([-5, -4, -3, -2, -1, 0]);
    for (let i = 1; i < out.length; i++) {
      expect(out[i].start_ms).toBeGreaterThan(out[i - 1].start_ms);
      expect(out[i].end_ms).toBe(out[i + 1]?.start_ms ?? out[i].end_ms);
    }
    // The newest bucket must contain "right now".
    const nowMs = Date.now();
    expect(out[5].start_ms).toBeLessThanOrEqual(nowMs);
    expect(out[5].end_ms).toBeGreaterThan(nowMs);
  });
});

describe('bucketIndexOf', () => {
  const now = new Date(2026, 4, 8);
  const boundaries = bucketBoundaries('month', now);

  it('returns offset 0 for current period', () => {
    const ts = new Date(2026, 4, 5).getTime();
    expect(bucketIndexOf(ts, boundaries)).toBe(0);
  });

  it('returns offset -1 for previous period', () => {
    const ts = new Date(2026, 3, 15).getTime();
    expect(bucketIndexOf(ts, boundaries)).toBe(-1);
  });

  it('returns null for ts outside range', () => {
    const ts = new Date(2024, 0, 1).getTime(); // way too old
    expect(bucketIndexOf(ts, boundaries)).toBeNull();
  });

  it('returns null for future ts beyond current period', () => {
    const ts = new Date(2027, 0, 1).getTime();
    expect(bucketIndexOf(ts, boundaries)).toBeNull();
  });
});

describe('durationHistogram', () => {
  const now = new Date(2026, 4, 8);

  it('aggregates session durations into buckets', () => {
    const records: StatsSetRecord[] = [
      buildRecord({
        session_id: 's1',
        set_id: 'a',
        session_started_at: new Date(2026, 4, 5).getTime(),
        session_ended_at: new Date(2026, 4, 5).getTime() + 60 * 60 * 1000, // 1h
      }),
      // Same session — duration should not double count
      buildRecord({
        session_id: 's1',
        set_id: 'b',
        session_started_at: new Date(2026, 4, 5).getTime(),
        session_ended_at: new Date(2026, 4, 5).getTime() + 60 * 60 * 1000,
      }),
      // Different session, prior month
      buildRecord({
        session_id: 's2',
        set_id: 'c',
        session_started_at: new Date(2026, 3, 20).getTime(),
        session_ended_at: new Date(2026, 3, 20).getTime() + 30 * 60 * 1000, // 30 min
      }),
    ];
    const out = durationHistogram(records, 'month', now);
    expect(out).toHaveLength(6);
    const current = out.find((b) => b.offset === 0)!;
    expect(current.total_ms).toBe(60 * 60 * 1000);
    expect(current.session_count).toBe(1);
    const prev = out.find((b) => b.offset === -1)!;
    expect(prev.total_ms).toBe(30 * 60 * 1000);
    expect(prev.session_count).toBe(1);
  });

  it('skips in-progress sessions and out-of-range', () => {
    const records: StatsSetRecord[] = [
      buildRecord({
        session_id: 's1',
        set_id: 'a',
        session_started_at: new Date(2026, 4, 5).getTime(),
        session_ended_at: null,
      }),
      buildRecord({
        session_id: 's2',
        set_id: 'b',
        session_started_at: new Date(2010, 0, 1).getTime(),
        session_ended_at: new Date(2010, 0, 1).getTime() + 60 * 60 * 1000,
      }),
    ];
    const out = durationHistogram(records, 'month', now);
    expect(out.every((b) => b.session_count === 0)).toBe(true);
  });
});

describe('capacityHistogramByMg', () => {
  const now = new Date(2026, 4, 8);

  it('aggregates volume per MG per bucket', () => {
    const records: StatsSetRecord[] = [
      buildRecord({
        session_id: 's1',
        set_id: 'a',
        session_started_at: new Date(2026, 4, 5).getTime(),
        mg_id: 'mg-chest',
        volume: 500,
      }),
      buildRecord({
        session_id: 's1',
        set_id: 'b',
        session_started_at: new Date(2026, 4, 5).getTime(),
        mg_id: 'mg-chest',
        volume: 300,
      }),
      buildRecord({
        session_id: 's2',
        set_id: 'c',
        session_started_at: new Date(2026, 3, 20).getTime(),
        mg_id: 'mg-leg',
        volume: 1000,
      }),
    ];
    const out = capacityHistogramByMg(records, 'month', now);
    const chest = out.get('mg-chest')!;
    expect(chest).toHaveLength(6);
    expect(chest.find((b) => b.offset === 0)!.capacity).toBe(800);
    expect(chest.find((b) => b.offset === -1)!.capacity).toBe(0);
    const leg = out.get('mg-leg')!;
    expect(leg.find((b) => b.offset === -1)!.capacity).toBe(1000);
  });

  it('skips records with no MG, no volume, or out of range', () => {
    const records: StatsSetRecord[] = [
      buildRecord({
        session_id: 's1',
        set_id: 'a',
        mg_id: null,
        session_started_at: new Date(2026, 4, 5).getTime(),
      }),
      buildRecord({
        session_id: 's2',
        set_id: 'b',
        volume: null,
        session_started_at: new Date(2026, 4, 5).getTime(),
      }),
      buildRecord({
        session_id: 's3',
        set_id: 'c',
        session_started_at: new Date(2010, 0, 1).getTime(),
      }),
    ];
    const out = capacityHistogramByMg(records, 'month', now);
    expect(out.size).toBe(0);
  });
});
