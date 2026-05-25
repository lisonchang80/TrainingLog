import {
  pageIndexToSide,
  parseSide,
  sideToPageIndex,
  switcherArrowDisabled,
} from '../../src/domain/exercise/clusterSwitcher';

describe('clusterSwitcher.parseSide', () => {
  it('returns B only for literal "B"', () => {
    expect(parseSide('B')).toBe('B');
  });
  it('returns A for "A"', () => {
    expect(parseSide('A')).toBe('A');
  });
  it('falls back to A for undefined/null/garbage', () => {
    expect(parseSide(undefined)).toBe('A');
    expect(parseSide(null)).toBe('A');
    expect(parseSide('')).toBe('A');
    expect(parseSide('b')).toBe('A'); // case-sensitive
    expect(parseSide('xyz')).toBe('A');
  });
});

describe('clusterSwitcher.side ↔ pageIndex round-trip', () => {
  it('A maps to index 0, B to index 1', () => {
    expect(sideToPageIndex('A')).toBe(0);
    expect(sideToPageIndex('B')).toBe(1);
  });
  it('index 0 → A, index 1 → B, anything ≥1 → B', () => {
    expect(pageIndexToSide(0)).toBe('A');
    expect(pageIndexToSide(1)).toBe('B');
    expect(pageIndexToSide(2)).toBe('B'); // shouldn't happen but defensive
  });
  it('round-trips both sides', () => {
    expect(pageIndexToSide(sideToPageIndex('A'))).toBe('A');
    expect(pageIndexToSide(sideToPageIndex('B'))).toBe('B');
  });
});

describe('clusterSwitcher.switcherArrowDisabled', () => {
  it('on A side: left arrow ‹ disabled, right › enabled', () => {
    expect(switcherArrowDisabled('A', 'left')).toBe(true);
    expect(switcherArrowDisabled('A', 'right')).toBe(false);
  });
  it('on B side: right arrow › disabled, left ‹ enabled', () => {
    expect(switcherArrowDisabled('B', 'left')).toBe(false);
    expect(switcherArrowDisabled('B', 'right')).toBe(true);
  });
});
