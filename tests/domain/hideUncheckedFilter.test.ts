import {
  resolveEffectiveLogged,
  filterUncheckedSolo,
  filterUncheckedClusterPair,
  type HideUncheckedSet,
} from '../../src/domain/set/hideUncheckedFilter';

/**
 * Hide-unchecked filters — extracted from app/session/[id].tsx (#8 big-file
 * health, 2026-06-02). Behaviour pinned so the extraction is provably 0-change.
 * Core invariant: dropset chains travel as one unit — a follower's visibility
 * follows its HEAD's is_logged, never its own.
 */

const mk = (
  id: string,
  is_logged: number,
  set_kind: HideUncheckedSet['set_kind'] = 'working',
  parent_set_id: string | null = null
): HideUncheckedSet => ({ id, is_logged, set_kind, parent_set_id });

const byId = (sets: HideUncheckedSet[]) =>
  new Map(sets.map((s) => [s.id, s] as const));

describe('resolveEffectiveLogged', () => {
  it('returns own is_logged for a working set', () => {
    const s = mk('a', 1);
    expect(resolveEffectiveLogged(s, byId([s]))).toBe(1);
    const s0 = mk('a', 0);
    expect(resolveEffectiveLogged(s0, byId([s0]))).toBe(0);
  });

  it('returns the HEAD is_logged for a dropset follower', () => {
    const head = mk('h', 1, 'dropset', null);
    const follower = mk('f', 0, 'dropset', 'h'); // own=0 but head logged
    expect(resolveEffectiveLogged(follower, byId([head, follower]))).toBe(1);
  });

  it('returns own is_logged for a dropset head (parent_set_id null)', () => {
    const head = mk('h', 0, 'dropset', null);
    expect(resolveEffectiveLogged(head, byId([head]))).toBe(0);
  });

  it('falls back to own is_logged when the head is missing from the map', () => {
    const orphan = mk('f', 1, 'dropset', 'gone');
    expect(resolveEffectiveLogged(orphan, byId([orphan]))).toBe(1);
  });
});

describe('filterUncheckedSolo', () => {
  it('returns [] for empty input (no card to hide)', () => {
    expect(filterUncheckedSolo([])).toEqual([]);
  });

  it('returns null when every set is unchecked', () => {
    expect(filterUncheckedSolo([mk('a', 0), mk('b', 0)])).toBeNull();
  });

  it('keeps only effective-logged sets', () => {
    const sets = [mk('a', 1), mk('b', 0), mk('c', 1)];
    expect(filterUncheckedSolo(sets)!.map((s) => s.id)).toEqual(['a', 'c']);
  });

  it('keeps a whole dropset chain visible when the head is logged', () => {
    // head logged, followers own=0 → all stay (chain integrity)
    const sets = [
      mk('h', 1, 'dropset', null),
      mk('f1', 0, 'dropset', 'h'),
      mk('f2', 0, 'dropset', 'h'),
    ];
    expect(filterUncheckedSolo(sets)!.map((s) => s.id)).toEqual(['h', 'f1', 'f2']);
  });

  it('hides a whole dropset chain when the head is unlogged → null if alone', () => {
    const sets = [
      mk('h', 0, 'dropset', null),
      mk('f1', 1, 'dropset', 'h'), // own=1 but head unlogged → hidden
    ];
    expect(filterUncheckedSolo(sets)).toBeNull();
  });
});

describe('filterUncheckedClusterPair', () => {
  it('keeps a cycle when EITHER side is logged', () => {
    const res = filterUncheckedClusterPair(
      [mk('a1', 1), mk('a2', 0)],
      [mk('b1', 0), mk('b2', 0)]
    )!;
    // cycle 0: a logged → kept; cycle 1: both unlogged → dropped
    expect(res.setsA.map((s) => s.id)).toEqual(['a1']);
    expect(res.setsB.map((s) => s.id)).toEqual(['b1']);
  });

  it('drops a cycle only when BOTH sides are unchecked', () => {
    const res = filterUncheckedClusterPair(
      [mk('a1', 0)],
      [mk('b1', 1)]
    )!;
    expect(res.setsA.map((s) => s.id)).toEqual(['a1']); // b logged keeps the pair
    expect(res.setsB.map((s) => s.id)).toEqual(['b1']);
  });

  it('returns null when every paired cycle is fully unchecked', () => {
    expect(
      filterUncheckedClusterPair([mk('a1', 0)], [mk('b1', 0)])
    ).toBeNull();
  });

  it('inherits dropset-head logged state on either side', () => {
    // A side cycle 0 is a dropset follower whose head (a-head) is logged elsewhere
    const aHead = mk('aH', 1, 'dropset', null);
    const aFollower = mk('aF', 0, 'dropset', 'aH');
    const res = filterUncheckedClusterPair(
      [aHead, aFollower],
      [mk('b1', 0), mk('b2', 0)]
    )!;
    // cycle 0: A head logged → kept; cycle 1: A follower inherits head=1 → kept
    expect(res.setsA.map((s) => s.id)).toEqual(['aH', 'aF']);
    expect(res.setsB.map((s) => s.id)).toEqual(['b1', 'b2']);
  });

  it('drops unchecked tail sets when sides are unequal length', () => {
    const res = filterUncheckedClusterPair(
      [mk('a1', 1), mk('a2', 0)], // a2 is an unchecked tail (no B partner)
      [mk('b1', 0)]
    )!;
    expect(res.setsA.map((s) => s.id)).toEqual(['a1']); // a2 tail dropped
    expect(res.setsB.map((s) => s.id)).toEqual(['b1']); // b1 kept (paired with logged a1)
  });
});
