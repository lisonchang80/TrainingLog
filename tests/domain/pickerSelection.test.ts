import {
  EMPTY_SELECTION,
  addSelection,
  isSelected,
  removeSelection,
  selectionRank,
  toggleSelection,
} from '../../src/domain/exercise/pickerSelection';

describe('pickerSelection — addSelection', () => {
  it('appends to empty', () => {
    expect(addSelection(EMPTY_SELECTION, 'e1')).toEqual(['e1']);
  });

  it('preserves insertion order', () => {
    const s = addSelection(addSelection(addSelection(EMPTY_SELECTION, 'a'), 'b'), 'c');
    expect(s).toEqual(['a', 'b', 'c']);
  });

  it('no-op on duplicate (already present)', () => {
    const s = addSelection(['a', 'b'], 'a');
    expect(s).toEqual(['a', 'b']);
  });

  it('returns a new array — does not mutate input', () => {
    const input = ['a'];
    const out = addSelection(input, 'b');
    expect(input).toEqual(['a']);
    expect(out).not.toBe(input);
  });
});

describe('pickerSelection — removeSelection', () => {
  it('removes a present id', () => {
    expect(removeSelection(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });

  it('no-op on absent id', () => {
    expect(removeSelection(['a', 'b'], 'z')).toEqual(['a', 'b']);
  });

  it('removes first matching when there are duplicates (defensive)', () => {
    // The data path prevents duplicates via addSelection, but defend anyway
    expect(removeSelection(['a', 'b', 'a'], 'a')).toEqual(['b', 'a']);
  });

  it('returns a new array — does not mutate input', () => {
    const input = ['a', 'b'];
    const out = removeSelection(input, 'a');
    expect(input).toEqual(['a', 'b']);
    expect(out).not.toBe(input);
  });
});

describe('pickerSelection — toggleSelection', () => {
  it('adds when absent', () => {
    expect(toggleSelection(['a'], 'b')).toEqual(['a', 'b']);
  });

  it('removes when present', () => {
    expect(toggleSelection(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('re-toggling restores prior state for a single id', () => {
    let s = toggleSelection(EMPTY_SELECTION, 'a');
    s = toggleSelection(s, 'a');
    expect(s).toEqual([]);
  });

  it('re-add lands at the END (not the original slot) — selection order is insertion order', () => {
    let s: readonly string[] = ['a', 'b', 'c'];
    s = toggleSelection(s, 'a'); // remove a → ['b','c']
    s = toggleSelection(s, 'a'); // add a back → ['b','c','a']
    expect(s).toEqual(['b', 'c', 'a']);
  });
});

describe('pickerSelection — isSelected / selectionRank', () => {
  it('isSelected reflects membership', () => {
    expect(isSelected(['a', 'b'], 'a')).toBe(true);
    expect(isSelected(['a', 'b'], 'z')).toBe(false);
    expect(isSelected(EMPTY_SELECTION, 'a')).toBe(false);
  });

  it('selectionRank returns 0-based position or -1', () => {
    expect(selectionRank(['a', 'b', 'c'], 'a')).toBe(0);
    expect(selectionRank(['a', 'b', 'c'], 'b')).toBe(1);
    expect(selectionRank(['a', 'b', 'c'], 'c')).toBe(2);
    expect(selectionRank(['a', 'b'], 'z')).toBe(-1);
  });
});
