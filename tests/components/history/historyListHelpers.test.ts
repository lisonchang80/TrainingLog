import {
  buildSameDayIdMap,
  dateKeyFromTimestamp,
  groupSessionsByDate,
} from '../../../src/components/history/historyListHelpers';
import type { Session } from '../../../src/domain/session/types';

function mkSession(id: string, isoLocal: string): Session {
  // Parse as local time — caller writes `2026-05-20T08:30:00` and expects
  // it to bucket into `2026-05-20` regardless of host TZ. `new Date(iso)`
  // with no tz suffix is treated as local by every JS runtime.
  return {
    id,
    started_at: new Date(isoLocal).getTime(),
    ended_at: null,
    bodyweight_snapshot_kg: null,
    title: '',
    is_watch_tracked: false,
  };
}

describe('dateKeyFromTimestamp', () => {
  it('formats a local-timezone YYYY-MM-DD with zero-padding', () => {
    const d = new Date(2026, 0, 5, 12, 30); // local 2026-01-05 12:30
    expect(dateKeyFromTimestamp(d.getTime())).toBe('2026-01-05');
  });
});

describe('groupSessionsByDate', () => {
  it('returns empty map for empty input', () => {
    expect(groupSessionsByDate([]).size).toBe(0);
  });

  it('buckets sessions on different dates into separate keys', () => {
    const a = mkSession('a', '2026-05-18T08:00:00');
    const b = mkSession('b', '2026-05-19T09:00:00');
    const c = mkSession('c', '2026-05-20T10:00:00');
    const g = groupSessionsByDate([c, b, a]); // newest-first input
    expect([...g.keys()]).toEqual(['2026-05-20', '2026-05-19', '2026-05-18']);
    expect(g.get('2026-05-20')).toEqual([c]);
    expect(g.get('2026-05-19')).toEqual([b]);
    expect(g.get('2026-05-18')).toEqual([a]);
  });

  it('groups multiple sessions on the same date into one bucket, preserving input order', () => {
    const morning = mkSession('m', '2026-05-20T08:00:00');
    const noon = mkSession('n', '2026-05-20T12:00:00');
    const evening = mkSession('e', '2026-05-20T20:00:00');
    // listSessions delivers newest-first → [evening, noon, morning]
    const g = groupSessionsByDate([evening, noon, morning]);
    expect(g.size).toBe(1);
    expect(g.get('2026-05-20')).toEqual([evening, noon, morning]);
  });
});

describe('buildSameDayIdMap', () => {
  it('returns empty map for empty input', () => {
    expect(buildSameDayIdMap(new Map()).size).toBe(0);
  });

  it('each session maps to its own date bucket', () => {
    const a = mkSession('a', '2026-05-18T08:00:00');
    const b = mkSession('b', '2026-05-19T09:00:00');
    const c = mkSession('c', '2026-05-20T10:00:00');
    const g = groupSessionsByDate([c, b, a]);
    const m = buildSameDayIdMap(g);
    expect(m.get('a')).toEqual(['a']);
    expect(m.get('b')).toEqual(['b']);
    expect(m.get('c')).toEqual(['c']);
  });

  it('multi-session days: every session shares the full sibling list (incl. self)', () => {
    const a = mkSession('a', '2026-05-20T08:00:00');
    const b = mkSession('b', '2026-05-20T12:00:00');
    const c = mkSession('c', '2026-05-20T20:00:00');
    const lone = mkSession('lone', '2026-05-19T08:00:00');
    const g = groupSessionsByDate([c, b, a, lone]);
    const m = buildSameDayIdMap(g);
    expect(m.get('a')).toEqual(['c', 'b', 'a']);
    expect(m.get('b')).toEqual(['c', 'b', 'a']);
    expect(m.get('c')).toEqual(['c', 'b', 'a']);
    expect(m.get('lone')).toEqual(['lone']);
  });
});
