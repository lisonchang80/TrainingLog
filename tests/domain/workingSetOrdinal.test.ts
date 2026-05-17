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
