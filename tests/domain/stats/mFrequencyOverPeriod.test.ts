/**
 * Unit tests for `mFrequencyOverPeriod` — M (細) layer per-muscle session
 * frequency aggregator. Mirrors `mgFrequencyOverPeriod` tests but for the
 * m:n primary-muscle list on each StatsSetRecord.
 *
 * Added overnight 5/23 alongside the M-level body heatmap upgrade.
 */
import { mFrequencyOverPeriod } from '../../../src/domain/stats/statsEngine';
import type { StatsSetRecord } from '../../../src/domain/stats/types';

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
  m_ids: ['m-lower-chest'],
  volume: 100,
  is_logged: true,
  ...override,
});

describe('mFrequencyOverPeriod', () => {
  it('returns empty map for empty input', () => {
    expect(mFrequencyOverPeriod([]).size).toBe(0);
  });

  it('counts distinct sessions per muscle (multi-set in same session = +1)', () => {
    const records: StatsSetRecord[] = [
      // Session 1: 2 chest sets (same exercise), 1 leg set
      buildRecord({
        session_id: 's1',
        set_id: 'a',
        m_ids: ['m-lower-chest', 'm-tricep'],
      }),
      buildRecord({
        session_id: 's1',
        set_id: 'b',
        m_ids: ['m-lower-chest', 'm-tricep'],
      }),
      buildRecord({
        session_id: 's1',
        set_id: 'c',
        exercise_id: 'ex-leg',
        m_ids: ['m-quad'],
      }),
      // Session 2: 1 chest set
      buildRecord({
        session_id: 's2',
        set_id: 'd',
        m_ids: ['m-lower-chest', 'm-tricep'],
      }),
    ];
    const out = mFrequencyOverPeriod(records);
    expect(out.get('m-lower-chest')).toBe(2);
    expect(out.get('m-tricep')).toBe(2);
    expect(out.get('m-quad')).toBe(1);
  });

  it('counts multi-muscle exercises (e.g. Bench Press → 3 primaries)', () => {
    const records: StatsSetRecord[] = [
      buildRecord({
        session_id: 's1',
        set_id: 'a',
        m_ids: ['m-lower-chest', 'm-tricep', 'm-front-delt'],
      }),
    ];
    const out = mFrequencyOverPeriod(records);
    expect(out.get('m-lower-chest')).toBe(1);
    expect(out.get('m-tricep')).toBe(1);
    expect(out.get('m-front-delt')).toBe(1);
  });

  it('skips is_logged=false records', () => {
    const records: StatsSetRecord[] = [
      buildRecord({
        session_id: 's1',
        set_id: 'a',
        m_ids: ['m-lower-chest'],
        is_logged: false,
      }),
      buildRecord({
        session_id: 's1',
        set_id: 'b',
        m_ids: ['m-tricep'],
        is_logged: true,
      }),
    ];
    const out = mFrequencyOverPeriod(records);
    expect(out.has('m-lower-chest')).toBe(false);
    expect(out.get('m-tricep')).toBe(1);
  });

  it('ignores records with empty m_ids[] (custom exercises lacking mapping)', () => {
    const records: StatsSetRecord[] = [
      buildRecord({ session_id: 's1', set_id: 'a', m_ids: [] }),
      buildRecord({ session_id: 's1', set_id: 'b', m_ids: ['m-quad'] }),
    ];
    const out = mFrequencyOverPeriod(records);
    expect(out.size).toBe(1);
    expect(out.get('m-quad')).toBe(1);
  });

  it('only role=primary muscles flow through (secondaries are excluded upstream by repo SQL)', () => {
    // This test documents the contract: mFrequencyOverPeriod itself does
    // not know about role — it trusts the caller to have already filtered
    // to primaries. The statsRepository SELECT enforces role='primary'.
    const records: StatsSetRecord[] = [
      buildRecord({
        session_id: 's1',
        set_id: 'a',
        m_ids: ['m-lower-chest'], // would-be-secondary 'm-abs' deliberately absent
      }),
    ];
    const out = mFrequencyOverPeriod(records);
    expect(out.get('m-lower-chest')).toBe(1);
    expect(out.has('m-abs')).toBe(false);
  });

  it('aggregates same muscle across many sessions (distinct count via Set)', () => {
    const records: StatsSetRecord[] = [];
    // 5 sessions all targeting m-quad
    for (let i = 1; i <= 5; i++) {
      records.push(
        buildRecord({
          session_id: `s${i}`,
          set_id: `a${i}`,
          m_ids: ['m-quad'],
        })
      );
      // Plus a duplicate set in same session — should NOT double-count
      records.push(
        buildRecord({
          session_id: `s${i}`,
          set_id: `b${i}`,
          m_ids: ['m-quad'],
        })
      );
    }
    expect(mFrequencyOverPeriod(records).get('m-quad')).toBe(5);
  });
});
