import {
  buildSameDayNavState,
  parseSameDayIds,
  siblingId,
} from '../../../src/domain/session/sameDayNav';

describe('parseSameDayIds (ADR-0015 § Tap 日格行為)', () => {
  it('undefined → []', () => {
    expect(parseSameDayIds(undefined)).toEqual([]);
  });

  it('empty string → []', () => {
    expect(parseSameDayIds('')).toEqual([]);
  });

  it('three ids → array of three', () => {
    expect(parseSameDayIds('abc,def,ghi')).toEqual(['abc', 'def', 'ghi']);
  });

  it('trims whitespace and filters empty segments', () => {
    expect(parseSameDayIds('abc, ,def,')).toEqual(['abc', 'def']);
    expect(parseSameDayIds(' abc , def ')).toEqual(['abc', 'def']);
  });

  it('single id → array of one', () => {
    expect(parseSameDayIds('only-one')).toEqual(['only-one']);
  });
});

describe('buildSameDayNavState', () => {
  it('currentId not in ids → degrades to single-session view', () => {
    const state = buildSameDayNavState({
      currentId: 'orphan',
      ids: ['a', 'b', 'c'],
    });
    expect(state.ids).toEqual(['orphan']);
    expect(state.currentIndex).toBe(0);
    expect(state.total).toBe(1);
  });

  it('empty ids list → degrades to single-session view', () => {
    const state = buildSameDayNavState({ currentId: 'only', ids: [] });
    expect(state.ids).toEqual(['only']);
    expect(state.currentIndex).toBe(0);
    expect(state.total).toBe(1);
  });

  it('currentId in middle → currentIndex=1, total=3', () => {
    const state = buildSameDayNavState({
      currentId: 'b',
      ids: ['a', 'b', 'c'],
    });
    expect(state.ids).toEqual(['a', 'b', 'c']);
    expect(state.currentIndex).toBe(1);
    expect(state.total).toBe(3);
  });

  it('currentId at first → currentIndex=0', () => {
    const state = buildSameDayNavState({
      currentId: 'a',
      ids: ['a', 'b', 'c'],
    });
    expect(state.currentIndex).toBe(0);
    expect(state.total).toBe(3);
  });

  it('currentId at last → currentIndex=total-1', () => {
    const state = buildSameDayNavState({
      currentId: 'c',
      ids: ['a', 'b', 'c'],
    });
    expect(state.currentIndex).toBe(2);
    expect(state.total).toBe(3);
  });
});

describe('siblingId', () => {
  it('at first id: prev → null, next → second id', () => {
    const state = buildSameDayNavState({
      currentId: 'a',
      ids: ['a', 'b', 'c'],
    });
    expect(siblingId(state, 'prev')).toBeNull();
    expect(siblingId(state, 'next')).toBe('b');
  });

  it('at last id: prev → previous id, next → null', () => {
    const state = buildSameDayNavState({
      currentId: 'c',
      ids: ['a', 'b', 'c'],
    });
    expect(siblingId(state, 'prev')).toBe('b');
    expect(siblingId(state, 'next')).toBeNull();
  });

  it('in middle: prev → previous, next → next', () => {
    const state = buildSameDayNavState({
      currentId: 'b',
      ids: ['a', 'b', 'c'],
    });
    expect(siblingId(state, 'prev')).toBe('a');
    expect(siblingId(state, 'next')).toBe('c');
  });

  it('total === 1 → both directions null', () => {
    const state = buildSameDayNavState({ currentId: 'only', ids: ['only'] });
    expect(siblingId(state, 'prev')).toBeNull();
    expect(siblingId(state, 'next')).toBeNull();
  });

  it('degenerate state (currentId not in ids) → both directions null', () => {
    const state = buildSameDayNavState({
      currentId: 'orphan',
      ids: ['a', 'b', 'c'],
    });
    expect(siblingId(state, 'prev')).toBeNull();
    expect(siblingId(state, 'next')).toBeNull();
  });
});
