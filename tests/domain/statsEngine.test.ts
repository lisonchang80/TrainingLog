import {
  capacityHistogramByMg,
  durationHistogram,
  mgFrequencyOverPeriod,
  percentileBucketize,
} from '../../src/domain/stats/statsEngine';
import type { StatsSetRecord } from '../../src/domain/stats/types';

const buildRecord = (
  override: Partial<StatsSetRecord> & {
    session_id: string;
    set_id: string;
  }
): StatsSetRecord => ({
  session_started_at: 1_000_000,
  session_ended_at: 1_001_000,
  exercise_id: 'ex-1',
  mg_id: 'mg-chest',
  m_ids: [],
  volume: 100,
  is_logged: true,
  ...override,
});

describe('mgFrequencyOverPeriod', () => {
  it('counts distinct sessions per MG', () => {
    const records: StatsSetRecord[] = [
      // Session 1: 2 chest sets, 1 back set
      buildRecord({ session_id: 's1', set_id: 'a', mg_id: 'mg-chest' }),
      buildRecord({ session_id: 's1', set_id: 'b', mg_id: 'mg-chest' }),
      buildRecord({ session_id: 's1', set_id: 'c', mg_id: 'mg-back' }),
      // Session 2: 1 chest set
      buildRecord({ session_id: 's2', set_id: 'd', mg_id: 'mg-chest' }),
    ];
    const out = mgFrequencyOverPeriod(records);
    expect(out.get('mg-chest')).toBe(2);
    expect(out.get('mg-back')).toBe(1);
  });

  it('skips skipped sets', () => {
    const records: StatsSetRecord[] = [
      buildRecord({ session_id: 's1', set_id: 'a', mg_id: 'mg-chest', is_logged: false }),
      buildRecord({ session_id: 's1', set_id: 'b', mg_id: 'mg-back' }),
    ];
    const out = mgFrequencyOverPeriod(records);
    expect(out.has('mg-chest')).toBe(false);
    expect(out.get('mg-back')).toBe(1);
  });

  it('skips records without mg_id', () => {
    const records: StatsSetRecord[] = [
      buildRecord({ session_id: 's1', set_id: 'a', mg_id: null }),
    ];
    expect(mgFrequencyOverPeriod(records).size).toBe(0);
  });
});

describe('percentileBucketize', () => {
  it('returns [] for empty input', () => {
    expect(percentileBucketize([])).toEqual([]);
  });

  it('5 distinct values → 0,1,2,3,4 in ascending order', () => {
    const out = percentileBucketize([10, 20, 30, 40, 50]);
    expect(out).toEqual([0, 1, 2, 3, 4]);
  });

  it('11 MG distribution maps to 5 quintiles', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    const out = percentileBucketize(values);
    expect(out.length).toBe(11);
    // Bottom 20% → bucket 0; top 20% → bucket 4. With n=11:
    //   r=1..2 → 0, r=3..4 → 1, r=5..6 → 2, r=7..9 → 3, r=10..11 → 4
    expect(out[0]).toBe(0); // smallest
    expect(out[10]).toBe(4); // largest
  });

  it('preserves original index order in output', () => {
    const out = percentileBucketize([50, 10, 30]);
    // Sorted ranks (1-idx): 10→1, 30→2, 50→3.
    // bucket(r) = min(4, floor((r-1)*5/n)) with n=3:
    //   r=1 → 0, r=2 → 1 (floor(5/3)), r=3 → 3 (floor(10/3))
    // original [50, 10, 30] → [3, 0, 1].
    expect(out).toEqual([3, 0, 1]);
  });

  it('all-equal values get rank by index (stable sort)', () => {
    const out = percentileBucketize([100, 100, 100, 100]);
    // Stable sort → ranks 1,2,3,4 in original order. n=4:
    //   r=1 → floor(0/4)=0, r=2 → floor(5/4)=1, r=3 → floor(10/4)=2,
    //   r=4 → floor(15/4)=3. Caps at 4.
    expect(out).toEqual([0, 1, 2, 3]);
  });
});

describe('histogram functions on empty / single inputs', () => {
  const now = new Date(2026, 4, 8);

  it('durationHistogram returns 6 zero buckets for empty records', () => {
    const out = durationHistogram([], 'month', now);
    expect(out).toHaveLength(6);
    expect(out.every((b) => b.total_ms === 0 && b.session_count === 0)).toBe(true);
  });

  it('capacityHistogramByMg returns empty map for empty records', () => {
    const out = capacityHistogramByMg([], 'month', now);
    expect(out.size).toBe(0);
  });

  it('capacityHistogramByMg skips is_logged=false records', () => {
    const records: StatsSetRecord[] = [
      {
        session_id: 's1',
        set_id: 'a',
        session_started_at: new Date(2026, 4, 5).getTime(),
        session_ended_at: new Date(2026, 4, 5).getTime() + 60_000,
        exercise_id: 'ex-1',
        mg_id: 'mg-chest',
        m_ids: [],
        volume: 500,
        is_logged: false,
      },
    ];
    const out = capacityHistogramByMg(records, 'month', now);
    expect(out.size).toBe(0);
  });
});
