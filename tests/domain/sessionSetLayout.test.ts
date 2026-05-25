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
});
