import {
  computeWorkingSetOrdinals,
  displaySetLabel,
  type WorkingSetOrdinalInput,
} from '../../src/domain/set/workingSetOrdinal';

/**
 * Working-set ordinal — slice 10c overnight #7 第 1 點. Pure helper that
 * powers the `#` button display in solo + cluster cards (working rows
 * show 1, 2, 3, … among the working-only subset; warmup → 熱, dropset → D).
 */

function mk(
  id: string,
  set_kind: 'warmup' | 'working' | 'dropset',
  ordering: number,
): WorkingSetOrdinalInput {
  return { id, set_kind, ordering };
}

describe('computeWorkingSetOrdinals', () => {
  it('returns an empty map for an empty input', () => {
    expect(computeWorkingSetOrdinals([]).size).toBe(0);
  });

  it('three working sets → 1, 2, 3 (1-indexed)', () => {
    const sets = [mk('a', 'working', 0), mk('b', 'working', 1), mk('c', 'working', 2)];
    const map = computeWorkingSetOrdinals(sets);
    expect(map.get('a')).toBe(1);
    expect(map.get('b')).toBe(2);
    expect(map.get('c')).toBe(3);
    expect(map.size).toBe(3);
  });

  it('warmup + two working → warmup absent, working get 1, 2', () => {
    const sets = [mk('w', 'warmup', 0), mk('a', 'working', 1), mk('b', 'working', 2)];
    const map = computeWorkingSetOrdinals(sets);
    expect(map.has('w')).toBe(false);
    expect(map.get('a')).toBe(1);
    expect(map.get('b')).toBe(2);
    expect(map.size).toBe(2);
  });

  it('working + dropset + working → 1, dropset absent, 2 (dropset does not consume ordinal)', () => {
    const sets = [mk('a', 'working', 0), mk('d', 'dropset', 1), mk('b', 'working', 2)];
    const map = computeWorkingSetOrdinals(sets);
    expect(map.get('a')).toBe(1);
    expect(map.has('d')).toBe(false);
    expect(map.get('b')).toBe(2);
    expect(map.size).toBe(2);
  });

  it('respects ordering ASC regardless of input array order', () => {
    // Same logical sequence as the previous test but shuffled in the input.
    const sets = [mk('b', 'working', 2), mk('a', 'working', 0), mk('d', 'dropset', 1)];
    const map = computeWorkingSetOrdinals(sets);
    expect(map.get('a')).toBe(1);
    expect(map.get('b')).toBe(2);
    expect(map.has('d')).toBe(false);
  });
});

describe('displaySetLabel', () => {
  it('returns the working ordinal as a string', () => {
    const map = new Map([['a', 1], ['b', 2]]);
    expect(displaySetLabel({ id: 'a', set_kind: 'working' }, map)).toBe('1');
    expect(displaySetLabel({ id: 'b', set_kind: 'working' }, map)).toBe('2');
  });

  it('returns 熱 for warmup regardless of map content', () => {
    expect(displaySetLabel({ id: 'x', set_kind: 'warmup' }, new Map())).toBe('熱');
  });

  it('returns D for dropset regardless of map content', () => {
    expect(displaySetLabel({ id: 'x', set_kind: 'dropset' }, new Map())).toBe('D');
  });

  it('returns ? for a working row missing from the map (defensive)', () => {
    expect(displaySetLabel({ id: 'missing', set_kind: 'working' }, new Map())).toBe('?');
  });

  // Slice 10c overnight #7 第 3 點 — legacy dropset 顯示驗證.
  // Cluster siblings shouldn't ever land in `set_kind === 'dropset'` via the
  // current UI (the shared `#` button skips D — see point 2). But legacy
  // rows from before the cluster cycle restriction COULD exist, and the
  // display must keep rendering them as `D` so users can recognise + cycle
  // them back to working. This test pins that contract.
  it('legacy dropset row in a cluster still displays D (no D-deletion in display layer)', () => {
    // Simulate a cluster A side that has [working, dropset (legacy), working].
    // The ordinal map skips the dropset (warmup/dropset don't consume the
    // working ordinal), so the working rows are 1 and 2 respectively, and
    // the dropset row renders as `D` regardless.
    const sets: WorkingSetOrdinalInput[] = [
      mk('a-work-1', 'working', 0),
      mk('a-legacy-d', 'dropset', 1),
      mk('a-work-2', 'working', 2),
    ];
    const map = computeWorkingSetOrdinals(sets);
    expect(displaySetLabel({ id: 'a-work-1', set_kind: 'working' }, map)).toBe('1');
    expect(displaySetLabel({ id: 'a-legacy-d', set_kind: 'dropset' }, map)).toBe('D');
    expect(displaySetLabel({ id: 'a-work-2', set_kind: 'working' }, map)).toBe('2');
  });
});

// v025 display_rank renumbering (#1/#2 superset, 2026-06-02). After a Watch
// reorder / mid-insert the cluster card sorts ROWS by display_rank; the
// working-set NUMBER must renumber by the same visible order (else labels
// read 3,2,4,1 — the「插完換完亂跳」bug).
describe('computeWorkingSetOrdinals — display_rank renumbering', () => {
  it('numbers working sets by display_rank order, not creation ordering', () => {
    // Created s1,s2,s3 (ordering 1,2,3) but displayed s3,s1,s2 (display_rank
    // 0,1,2). Numbers must follow display order: s3=1, s1=2, s2=3.
    const sets: WorkingSetOrdinalInput[] = [
      { ...mk('s1', 'working', 1), display_rank: 1 },
      { ...mk('s2', 'working', 2), display_rank: 2 },
      { ...mk('s3', 'working', 3), display_rank: 0 },
    ];
    const map = computeWorkingSetOrdinals(sets);
    expect(map.get('s3')).toBe(1);
    expect(map.get('s1')).toBe(2);
    expect(map.get('s2')).toBe(3);
  });

  it('warmup keeps 熱 + does not consume a number even when reordered low', () => {
    // Warmup pushed to the bottom via display_rank; working sets still 1,2.
    const sets: WorkingSetOrdinalInput[] = [
      { ...mk('w', 'warmup', 1), display_rank: 9 },
      { ...mk('a', 'working', 2), display_rank: 1 },
      { ...mk('b', 'working', 3), display_rank: 2 },
    ];
    const map = computeWorkingSetOrdinals(sets);
    expect(map.get('a')).toBe(1);
    expect(map.get('b')).toBe(2);
    expect(displaySetLabel({ id: 'w', set_kind: 'warmup' }, map)).toBe('熱');
  });

  it('absent display_rank falls back to ordering (legacy unchanged)', () => {
    const sets: WorkingSetOrdinalInput[] = [mk('b', 'working', 2), mk('a', 'working', 1)];
    const map = computeWorkingSetOrdinals(sets);
    expect(map.get('a')).toBe(1);
    expect(map.get('b')).toBe(2);
  });
});
