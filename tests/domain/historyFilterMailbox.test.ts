import {
  EMPTY_FILTER,
  clearFilter,
  isEmptyFilter,
  peekFilter,
  submitFilter,
  type HistoryFilterState,
} from '../../src/domain/exercise/historyFilterMailbox';

describe('historyFilterMailbox', () => {
  beforeEach(() => {
    clearFilter();
  });

  it('peek returns null when never set', () => {
    expect(peekFilter()).toBeNull();
  });

  it('submit + peek round-trips the state', () => {
    const state: HistoryFilterState = {
      buckets: new Set(['max_strength', 'strength']),
      programId: 'p1',
      subTags: new Set(['推一', '推二']),
    };
    submitFilter(state);
    const got = peekFilter();
    expect(got).not.toBeNull();
    expect(got!.buckets.has('max_strength')).toBe(true);
    expect(got!.programId).toBe('p1');
    expect(got!.subTags.size).toBe(2);
  });

  it('peek does NOT clear (multiple reads allowed)', () => {
    submitFilter({
      buckets: new Set(['strength']),
      programId: null,
      subTags: new Set(),
    });
    peekFilter();
    expect(peekFilter()).not.toBeNull();
  });

  it('clear wipes the mailbox', () => {
    submitFilter(EMPTY_FILTER);
    clearFilter();
    expect(peekFilter()).toBeNull();
  });

  it('isEmptyFilter true when no buckets / no program / no subtags', () => {
    expect(isEmptyFilter(EMPTY_FILTER)).toBe(true);
    expect(
      isEmptyFilter({
        buckets: new Set(),
        programId: null,
        subTags: new Set(),
      })
    ).toBe(true);
  });

  it('isEmptyFilter false when any field non-empty', () => {
    expect(
      isEmptyFilter({
        buckets: new Set(['strength']),
        programId: null,
        subTags: new Set(),
      })
    ).toBe(false);
    expect(
      isEmptyFilter({
        buckets: new Set(),
        programId: 'p1',
        subTags: new Set(),
      })
    ).toBe(false);
    expect(
      isEmptyFilter({
        buckets: new Set(),
        programId: null,
        subTags: new Set(['推一']),
      })
    ).toBe(false);
  });
});
