import {
  countCompletedSets,
  groupHistoryBySession,
  type HistorySetRow,
} from '../../src/domain/exercise/exerciseHistory';

const row = (over: Partial<HistorySetRow>): HistorySetRow => ({
  id: 'r',
  session_id: 's1',
  session_started_at: 1000,
  weight_kg: 60,
  reps: 8,
  is_skipped: 0,
  ordering: 1,
  ...over,
});

describe('exerciseHistory — groupHistoryBySession', () => {
  it('returns empty when input empty', () => {
    expect(groupHistoryBySession([], 'all')).toEqual([]);
  });

  it('groups by session_id and orders sets by ordering ASC', () => {
    const rows = [
      row({ id: 'a', session_id: 's1', ordering: 2 }),
      row({ id: 'b', session_id: 's1', ordering: 1 }),
      row({ id: 'c', session_id: 's2', session_started_at: 2000, ordering: 1 }),
    ];
    const got = groupHistoryBySession(rows, 'all');
    // Newer session first (started_at DESC)
    expect(got.map((g) => g.session_id)).toEqual(['s2', 's1']);
    // Within session, ordering ASC
    expect(got[1].sets.map((s) => s.id)).toEqual(['b', 'a']);
  });

  it('sorts groups by started_at DESC', () => {
    const rows = [
      row({ id: 'a', session_id: 's1', session_started_at: 1000 }),
      row({ id: 'b', session_id: 's2', session_started_at: 3000 }),
      row({ id: 'c', session_id: 's3', session_started_at: 2000 }),
    ];
    const got = groupHistoryBySession(rows, 'all');
    expect(got.map((g) => g.session_id)).toEqual(['s2', 's3', 's1']);
  });

  it('drops skipped sets by default', () => {
    const rows = [
      row({ id: 'a', is_skipped: 0 }),
      row({ id: 'b', is_skipped: 1 }),
    ];
    const got = groupHistoryBySession(rows, 'all');
    expect(got[0].sets.map((s) => s.id)).toEqual(['a']);
  });

  it('opt-in: keeps skipped sets when excludeSkipped=false', () => {
    const rows = [
      row({ id: 'a', is_skipped: 0 }),
      row({ id: 'b', is_skipped: 1, ordering: 2 }),
    ];
    const got = groupHistoryBySession(rows, 'all', { excludeSkipped: false });
    expect(got[0].sets.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('applies rep bucket chip filter', () => {
    const rows = [
      row({ id: 'a', reps: 2 }), // max_strength
      row({ id: 'b', reps: 5 }), // strength
      row({ id: 'c', reps: 8 }), // hypertrophy
      row({ id: 'd', reps: 12 }), // muscle_endurance
      row({ id: 'e', reps: 20 }), // endurance
    ];
    expect(groupHistoryBySession(rows, 'strength')[0].sets.map((s) => s.id)).toEqual(['b']);
    expect(groupHistoryBySession(rows, 'hypertrophy')[0].sets.map((s) => s.id)).toEqual(['c']);
    expect(groupHistoryBySession(rows, 'endurance')[0].sets.map((s) => s.id)).toEqual(['e']);
  });

  it('drops sessions whose sets all filter out', () => {
    const rows = [
      row({ id: 'a', session_id: 's1', reps: 2 }),
      row({ id: 'b', session_id: 's2', session_started_at: 2000, reps: 12 }),
    ];
    const got = groupHistoryBySession(rows, 'max_strength');
    expect(got.map((g) => g.session_id)).toEqual(['s1']);
  });

  it('combines skipped exclusion + bucket filter', () => {
    const rows = [
      row({ id: 'a', reps: 2, is_skipped: 0 }),
      row({ id: 'b', reps: 2, is_skipped: 1 }),
      row({ id: 'c', reps: 8, is_skipped: 0 }),
    ];
    const got = groupHistoryBySession(rows, 'max_strength');
    expect(got[0].sets.map((s) => s.id)).toEqual(['a']);
  });
});

describe('exerciseHistory — countCompletedSets', () => {
  it('sums set counts across groups', () => {
    const rows = [
      row({ id: 'a', session_id: 's1' }),
      row({ id: 'b', session_id: 's1', ordering: 2 }),
      row({ id: 'c', session_id: 's2', session_started_at: 2000 }),
    ];
    const groups = groupHistoryBySession(rows, 'all');
    expect(countCompletedSets(groups)).toBe(3);
  });

  it('returns 0 for empty groups', () => {
    expect(countCompletedSets([])).toBe(0);
  });
});
