import {
  computeHistorySetLabels,
  type HistorySetLabelInput,
} from '../../src/domain/set/historySetLabel';

describe('computeHistorySetLabels (slice 10c #22)', () => {
  it('returns an empty map for an empty input', () => {
    expect(computeHistorySetLabels([])).toEqual(new Map());
  });

  it('labels every warmup row as "熱"', () => {
    const sets: HistorySetLabelInput[] = [
      { id: 'a', set_kind: 'warmup', ordering: 1 },
      { id: 'b', set_kind: 'warmup', ordering: 2 },
      { id: 'c', set_kind: 'warmup', ordering: 3 },
    ];
    expect(computeHistorySetLabels(sets)).toEqual(
      new Map([
        ['a', '熱'],
        ['b', '熱'],
        ['c', '熱'],
      ])
    );
  });

  it('labels pure-working rows with 1-based ordinals', () => {
    const sets: HistorySetLabelInput[] = [
      { id: 'a', set_kind: 'working', ordering: 1 },
      { id: 'b', set_kind: 'working', ordering: 2 },
      { id: 'c', set_kind: 'working', ordering: 3 },
      { id: 'd', set_kind: 'working', ordering: 4 },
    ];
    expect(computeHistorySetLabels(sets)).toEqual(
      new Map([
        ['a', '1'],
        ['b', '2'],
        ['c', '3'],
        ['d', '4'],
      ])
    );
  });

  it('labels pure-dropset rows with 1-based D-prefixed ordinals', () => {
    const sets: HistorySetLabelInput[] = [
      { id: 'a', set_kind: 'dropset', ordering: 1 },
      { id: 'b', set_kind: 'dropset', ordering: 2 },
      { id: 'c', set_kind: 'dropset', ordering: 3 },
    ];
    expect(computeHistorySetLabels(sets)).toEqual(
      new Map([
        ['a', 'D1'],
        ['b', 'D2'],
        ['c', 'D3'],
      ])
    );
  });

  it('working / dropset counters are independent; warmup consumes neither', () => {
    // Sequence: warmup, warmup, working, working, dropset, working, dropset
    // Expected:    熱      熱      1        2        D1      3        D2
    const sets: HistorySetLabelInput[] = [
      { id: 'wu1', set_kind: 'warmup', ordering: 1 },
      { id: 'wu2', set_kind: 'warmup', ordering: 2 },
      { id: 'w1', set_kind: 'working', ordering: 3 },
      { id: 'w2', set_kind: 'working', ordering: 4 },
      { id: 'd1', set_kind: 'dropset', ordering: 5 },
      { id: 'w3', set_kind: 'working', ordering: 6 },
      { id: 'd2', set_kind: 'dropset', ordering: 7 },
    ];
    expect(computeHistorySetLabels(sets)).toEqual(
      new Map([
        ['wu1', '熱'],
        ['wu2', '熱'],
        ['w1', '1'],
        ['w2', '2'],
        ['d1', 'D1'],
        ['w3', '3'],
        ['d2', 'D2'],
      ])
    );
  });

  it('is order-independent — shuffled input yields the same map', () => {
    const ordered: HistorySetLabelInput[] = [
      { id: 'wu', set_kind: 'warmup', ordering: 1 },
      { id: 'w1', set_kind: 'working', ordering: 2 },
      { id: 'd1', set_kind: 'dropset', ordering: 3 },
      { id: 'w2', set_kind: 'working', ordering: 4 },
      { id: 'd2', set_kind: 'dropset', ordering: 5 },
    ];
    const shuffled: HistorySetLabelInput[] = [
      { id: 'd2', set_kind: 'dropset', ordering: 5 },
      { id: 'wu', set_kind: 'warmup', ordering: 1 },
      { id: 'w2', set_kind: 'working', ordering: 4 },
      { id: 'd1', set_kind: 'dropset', ordering: 3 },
      { id: 'w1', set_kind: 'working', ordering: 2 },
    ];
    expect(computeHistorySetLabels(shuffled)).toEqual(
      computeHistorySetLabels(ordered)
    );
  });
});
