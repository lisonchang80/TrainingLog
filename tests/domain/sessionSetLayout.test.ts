import {
  computeSessionSetLayout,
  type SessionSetLayoutInput,
} from '../../src/domain/set/sessionSetLayout';

/**
 * Session set layout — slice 10c overnight #61. Mirrors template editor's
 * label + group structure so active session + session detail edit mode
 * render dropset chains as single swipe units with `D{N}` HEAD labels.
 */

function mk(
  id: string,
  set_kind: 'warmup' | 'working' | 'dropset',
  ordering: number,
  parent_set_id: string | null = null,
): SessionSetLayoutInput {
  return { id, set_kind, ordering, parent_set_id };
}

describe('computeSessionSetLayout', () => {
  it('empty input → empty labels + empty groups', () => {
    const out = computeSessionSetLayout([]);
    expect(out.labels.size).toBe(0);
    expect(out.groups).toEqual([]);
  });

  it('single working set → label "1" + one single-row group', () => {
    const sets = [mk('a', 'working', 0)];
    const out = computeSessionSetLayout(sets);
    expect(out.labels.get('a')).toBe('1');
    expect(out.groups).toHaveLength(1);
    expect(out.groups[0].head.id).toBe('a');
    expect(out.groups[0].followers).toEqual([]);
    expect(out.groups[0].headIndex).toBe(0);
    expect(out.groups[0].followerIndices).toEqual([]);
  });

  it('3 working + 1 warmup mixed → 熱/1/2/3, four single groups', () => {
    const sets = [
      mk('w', 'warmup', 0),
      mk('a', 'working', 1),
      mk('b', 'working', 2),
      mk('c', 'working', 3),
    ];
    const out = computeSessionSetLayout(sets);
    expect(out.labels.get('w')).toBe('熱');
    expect(out.labels.get('a')).toBe('1');
    expect(out.labels.get('b')).toBe('2');
    expect(out.labels.get('c')).toBe('3');
    expect(out.groups.map((g) => g.head.id)).toEqual(['w', 'a', 'b', 'c']);
    expect(out.groups.every((g) => g.followers.length === 0)).toBe(true);
  });

  it('1 dropset head + 2 followers → D1 / "" / "", single group with 2 followers', () => {
    const sets = [
      mk('h', 'dropset', 0, null),
      mk('f1', 'dropset', 1, 'h'),
      mk('f2', 'dropset', 2, 'h'),
    ];
    const out = computeSessionSetLayout(sets);
    expect(out.labels.get('h')).toBe('D1');
    expect(out.labels.get('f1')).toBe('');
    expect(out.labels.get('f2')).toBe('');
    expect(out.groups).toHaveLength(1);
    const g = out.groups[0];
    expect(g.head.id).toBe('h');
    expect(g.followers.map((f) => f.id)).toEqual(['f1', 'f2']);
    expect(g.headIndex).toBe(0);
    expect(g.followerIndices).toEqual([1, 2]);
  });

  it('2 dropset chains (D1 and D2) interleaved with working → counter independent per chain', () => {
    // working(1), dropset head 1 (D1) + 1 follower, working(2), dropset head 2 (D2) + 1 follower, working(3)
    const sets = [
      mk('w1', 'working', 0),
      mk('h1', 'dropset', 1, null),
      mk('h1f', 'dropset', 2, 'h1'),
      mk('w2', 'working', 3),
      mk('h2', 'dropset', 4, null),
      mk('h2f', 'dropset', 5, 'h2'),
      mk('w3', 'working', 6),
    ];
    const out = computeSessionSetLayout(sets);
    expect(out.labels.get('w1')).toBe('1');
    expect(out.labels.get('h1')).toBe('D1');
    expect(out.labels.get('h1f')).toBe('');
    expect(out.labels.get('w2')).toBe('2');
    expect(out.labels.get('h2')).toBe('D2');
    expect(out.labels.get('h2f')).toBe('');
    expect(out.labels.get('w3')).toBe('3');
    // 5 groups: w1, h1-chain, w2, h2-chain, w3
    expect(out.groups).toHaveLength(5);
    expect(out.groups[0].head.id).toBe('w1');
    expect(out.groups[1].head.id).toBe('h1');
    expect(out.groups[1].followers.map((f) => f.id)).toEqual(['h1f']);
    expect(out.groups[2].head.id).toBe('w2');
    expect(out.groups[3].head.id).toBe('h2');
    expect(out.groups[3].followers.map((f) => f.id)).toEqual(['h2f']);
    expect(out.groups[4].head.id).toBe('w3');
  });

  it('orphan follower (parent_set_id points at non-existent head) → standalone group, empty label', () => {
    // Defensive case: only the follower exists, the head is gone.
    const sets = [mk('orphan', 'dropset', 0, 'missing-head')];
    const out = computeSessionSetLayout(sets);
    // Label rule: follower (parent_set_id !== null) → '' regardless of whether head exists.
    expect(out.labels.get('orphan')).toBe('');
    // Groups: standalone (we don't silently drop it).
    expect(out.groups).toHaveLength(1);
    expect(out.groups[0].head.id).toBe('orphan');
    expect(out.groups[0].followers).toEqual([]);
  });

  it('sparse / non-1..N ordering → sorted ASC, label/group still correct', () => {
    const sets = [
      mk('c', 'working', 100),
      mk('a', 'warmup', 5),
      mk('b', 'working', 50),
    ];
    const out = computeSessionSetLayout(sets);
    expect(out.labels.get('a')).toBe('熱');
    expect(out.labels.get('b')).toBe('1');
    expect(out.labels.get('c')).toBe('2');
    // groups iterate sorted order
    expect(out.groups.map((g) => g.head.id)).toEqual(['a', 'b', 'c']);
  });

  it('input array passed in any order → stable output (order-independence)', () => {
    const ordered: SessionSetLayoutInput[] = [
      mk('h', 'dropset', 0, null),
      mk('f1', 'dropset', 1, 'h'),
      mk('f2', 'dropset', 2, 'h'),
      mk('w', 'working', 3),
    ];
    const shuffled: SessionSetLayoutInput[] = [
      mk('w', 'working', 3),
      mk('f2', 'dropset', 2, 'h'),
      mk('h', 'dropset', 0, null),
      mk('f1', 'dropset', 1, 'h'),
    ];
    const a = computeSessionSetLayout(ordered);
    const b = computeSessionSetLayout(shuffled);
    expect(Object.fromEntries(a.labels)).toEqual(Object.fromEntries(b.labels));
    expect(a.groups.map((g) => g.head.id)).toEqual(b.groups.map((g) => g.head.id));
    expect(
      a.groups.map((g) => g.followers.map((f) => f.id)),
    ).toEqual(b.groups.map((g) => g.followers.map((f) => f.id)));
  });

  it('head-delete with TWO surviving followers → each renders standalone, none crash, no head reused', () => {
    // Gap #3. The Watch deleted the dropset HEAD but its followers linger in the
    // tree for a tick (parent_set_id still points at the now-absent head). The
    // fold must NOT crash and must NOT promote a follower to a head — each
    // orphaned follower renders as its OWN standalone group (defensive: DB drift
    // / a partial Watch delete that removed the head before the children).
    const out = computeSessionSetLayout([
      mk('a', 'working', 0),
      mk('f1', 'dropset', 1, 'gone-head'),
      mk('f2', 'dropset', 2, 'gone-head'),
    ]);
    // Three standalone groups in sorted order — the two orphans are NOT folded
    // into one group (their head is absent) and neither is silently dropped.
    expect(out.groups.map((g) => g.head.id)).toEqual(['a', 'f1', 'f2']);
    expect(out.groups.every((g) => g.followers.length === 0)).toBe(true);
    // Followers keep the blank label (parent_set_id !== null → '').
    expect(out.labels.get('f1')).toBe('');
    expect(out.labels.get('f2')).toBe('');
    // The working set's counter is unaffected by the orphans.
    expect(out.labels.get('a')).toBe('1');
  });

  it('mixed survivors — one chain loses its head while another intact chain coexists', () => {
    // Gap #3. Interleave an INTACT chain (h2 + g) with an ORPHANED follower set
    // (o1/o2 whose head 'dead' is absent). The intact chain folds; the orphans
    // each stand alone. Cross-chain isolation — a missing head in one chain must
    // not corrupt the grouping of the healthy one.
    const out = computeSessionSetLayout([
      mk('o1', 'dropset', 0, 'dead'), // orphan follower (head absent)
      mk('h2', 'dropset', 1, null), // intact head
      mk('g', 'dropset', 2, 'h2'), // its follower
      mk('o2', 'dropset', 3, 'dead'), // another orphan of the same dead head
    ]);
    // h2 folds g; o1 and o2 each render standalone.
    expect(out.groups.map((g) => g.head.id)).toEqual(['o1', 'h2', 'o2']);
    const intact = out.groups.find((g) => g.head.id === 'h2');
    expect(intact?.followers.map((f) => f.id)).toEqual(['g']);
    // Orphans carry no followers (they are not heads — parent_set_id set).
    expect(out.groups.find((g) => g.head.id === 'o1')?.followers).toEqual([]);
    expect(out.groups.find((g) => g.head.id === 'o2')?.followers).toEqual([]);
    // Only the intact head consumes a D-label; orphans + follower are blank.
    expect(out.labels.get('h2')).toBe('D1');
    expect(out.labels.get('g')).toBe('');
    expect(out.labels.get('o1')).toBe('');
    expect(out.labels.get('o2')).toBe('');
  });

  it('three interleaved dropset chains all fold correctly (D1/D2/D3 + followers under right heads)', () => {
    // Gap #3 — multiple chains, denser than the existing 2-chain case, with
    // followers at non-contiguous ordinals (max+1 emit) to stress fold-by-parent
    // across THREE clusters at once.
    const out = computeSessionSetLayout([
      mk('w1', 'working', 0),
      mk('hA', 'dropset', 1, null),
      mk('hB', 'dropset', 2, null),
      mk('hC', 'dropset', 3, null),
      mk('fA', 'dropset', 4, 'hA'), // follower of the FIRST head, appended last
      mk('fB', 'dropset', 5, 'hB'),
      mk('fC', 'dropset', 6, 'hC'),
    ]);
    // Heads keep their sorted positions; each gathers only its own follower.
    expect(out.groups.map((g) => g.head.id)).toEqual(['w1', 'hA', 'hB', 'hC']);
    expect(out.groups.find((g) => g.head.id === 'hA')?.followers.map((f) => f.id)).toEqual(['fA']);
    expect(out.groups.find((g) => g.head.id === 'hB')?.followers.map((f) => f.id)).toEqual(['fB']);
    expect(out.groups.find((g) => g.head.id === 'hC')?.followers.map((f) => f.id)).toEqual(['fC']);
    // D-labels assigned by head sorted-position order.
    expect(out.labels.get('hA')).toBe('D1');
    expect(out.labels.get('hB')).toBe('D2');
    expect(out.labels.get('hC')).toBe('D3');
    // No follower leaked into a standalone group.
    expect(out.groups.some((g) => ['fA', 'fB', 'fC'].includes(g.head.id))).toBe(false);
  });

  it('non-contiguous follower (ordering past a later working set) still folds under its head', () => {
    // F1 regression (overnight audit + ADR-0019 § 2026-06-01): the WC live
    // mirror emits a Watch-added dropset follower at ordinal max+1, so a
    // MID-LIST head's follower can sit AFTER a later working set in ordering.
    // The fold must group it under its head by parent_set_id — NOT strand it
    // as an orphan (the pre-(iii) ordering-contiguity behaviour).
    const out = computeSessionSetLayout([
      mk('a', 'working', 0),
      mk('b', 'dropset', 1, null), // head, mid-list
      mk('c', 'working', 2), // base set BETWEEN head and its follower
      mk('f', 'dropset', 3, 'b'), // follower at max+1 — NON-contiguous with head
    ]);
    // 3 groups, in head-position (sorted) order: [a], cluster[b+f], [c].
    expect(out.groups.map((g) => g.head.id)).toEqual(['a', 'b', 'c']);
    // The follower folds into the head's group despite the ordering gap.
    expect(out.groups[1].followers.map((f) => f.id)).toEqual(['f']);
    // …and is NOT emitted as a standalone orphan group.
    expect(out.groups.some((g) => g.head.id === 'f')).toBe(false);
    // Labels unchanged (Pass 1 is id-keyed, independent of grouping).
    expect(out.labels.get('a')).toBe('1');
    expect(out.labels.get('b')).toBe('D1');
    expect(out.labels.get('c')).toBe('2');
    expect(out.labels.get('f')).toBe('');
  });
});
