/**
 * Coverage fill (overnight 2026-06-03) — v025 display_rank sort TIE-BREAK.
 *
 * `computeWorkingSetOrdinals` and `computeHistorySetLabels` both sort by
 *   (a.display_rank ?? a.ordering) - (b.display_rank ?? b.ordering)
 *     || a.ordering - b.ordering
 * The `|| a.ordering - b.ordering` tail is the deterministic tie-break used
 * when two rows share the SAME effective sort key (equal display_rank, or one
 * row's display_rank equal to another's ordering fallback). Every existing
 * display_rank test uses DISTINCT keys, so that tie-break branch is never
 * exercised — these lock it. The contract: an equal sort key resolves by
 * `ordering` ASC, so numbering / labelling stays stable + deterministic
 * regardless of input array order.
 */

import {
  computeWorkingSetOrdinals,
  type WorkingSetOrdinalInput,
} from '../../src/domain/set/workingSetOrdinal';
import {
  computeHistorySetLabels,
  type HistorySetLabelInput,
} from '../../src/domain/set/historySetLabel';

describe('computeWorkingSetOrdinals — display_rank tie-break on ordering', () => {
  it('equal display_rank → resolves by ordering ASC (stable numbering)', () => {
    // Two working sets with the SAME display_rank (5). The primary comparator
    // returns 0 → falls through to the `ordering` tie-break: 'x' (ordering 4)
    // before 'y' (ordering 5), so x=1, y=2 regardless of array order.
    const sets: WorkingSetOrdinalInput[] = [
      { id: 'y', set_kind: 'working', ordering: 5, display_rank: 5 },
      { id: 'x', set_kind: 'working', ordering: 4, display_rank: 5 },
    ];
    expect(computeWorkingSetOrdinals(sets)).toEqual(
      new Map([
        ['x', 1],
        ['y', 2],
      ]),
    );
  });

  it('a display_rank equal to another row’s ordering fallback ties on ordering', () => {
    // 'r' has display_rank 2; 'p' has NO display_rank so its key is its
    // ordering (2) — equal keys → tie-break on ordering: 'r' (ordering 1)
    // before 'p' (ordering 2). r=1, p=2.
    const sets: WorkingSetOrdinalInput[] = [
      { id: 'p', set_kind: 'working', ordering: 2 }, // key = ordering 2
      { id: 'r', set_kind: 'working', ordering: 1, display_rank: 2 }, // key = 2
    ];
    expect(computeWorkingSetOrdinals(sets)).toEqual(
      new Map([
        ['r', 1],
        ['p', 2],
      ]),
    );
  });
});

describe('computeHistorySetLabels — display_rank tie-break on ordering', () => {
  it('equal display_rank working sets resolve by ordering ASC', () => {
    const sets: HistorySetLabelInput[] = [
      { id: 'b', set_kind: 'working', ordering: 2, display_rank: 7 },
      { id: 'a', set_kind: 'working', ordering: 1, display_rank: 7 },
    ];
    expect(computeHistorySetLabels(sets)).toEqual(
      new Map([
        ['a', '1'],
        ['b', '2'],
      ]),
    );
  });

  it('equal display_rank dropset rows resolve by ordering ASC (D-counter stable)', () => {
    // History counts EVERY dropset row toward the D-counter; with equal
    // display_rank the ordering tie-break fixes the order → d1=D1, d2=D2.
    const sets: HistorySetLabelInput[] = [
      { id: 'd2', set_kind: 'dropset', ordering: 2, display_rank: 3 },
      { id: 'd1', set_kind: 'dropset', ordering: 1, display_rank: 3 },
    ];
    expect(computeHistorySetLabels(sets)).toEqual(
      new Map([
        ['d1', 'D1'],
        ['d2', 'D2'],
      ]),
    );
  });
});
