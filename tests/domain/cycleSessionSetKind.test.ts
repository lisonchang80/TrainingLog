import {
  cycleSessionSetKind,
  cycleSessionSetKindClusterAware,
  type CycleSessionSetInput,
} from '../../src/domain/set/cycleSessionSetKind';

/**
 * Tap-label cycle on session sets (ADR-0019 Q7, slice 10c Phase 2
 * commit 7a). Pure DB-op emitter — tests verify the op list shape.
 */

function mk(
  id: string,
  set_kind: 'warmup' | 'working' | 'dropset',
  parent_set_id: string | null = null,
  reps: number | null = 8,
  weight_kg: number | null = 50,
): CycleSessionSetInput {
  return { id, set_kind, parent_set_id, reps, weight_kg };
}

describe('cycleSessionSetKind', () => {
  it('returns [] when the target id is not in the array', () => {
    expect(cycleSessionSetKind([mk('a', 'working')], 'missing', 'new-1')).toEqual(
      [],
    );
  });

  it('returns [] when tapping a dropset follower (parent_set_id != null)', () => {
    const sets = [mk('head', 'dropset', null), mk('fol', 'dropset', 'head')];
    expect(cycleSessionSetKind(sets, 'fol', 'new-1')).toEqual([]);
  });

  it('working → warmup: emits one update with set_kind=warmup', () => {
    const sets = [mk('a', 'working')];
    expect(cycleSessionSetKind(sets, 'a', 'new-1')).toEqual([
      { type: 'update', set_id: 'a', patch: { set_kind: 'warmup' } },
    ]);
  });

  it('warmup → dropset head: emits update + insertFollower', () => {
    const sets = [mk('a', 'warmup', null, 10, 60)];
    expect(cycleSessionSetKind(sets, 'a', 'new-1')).toEqual([
      {
        type: 'update',
        set_id: 'a',
        patch: { set_kind: 'dropset', parent_set_id: null },
      },
      {
        type: 'insertFollower',
        new_set_id: 'new-1',
        parent_set_id: 'a',
        reps: 10,
        weight_kg: 60,
      },
    ]);
  });

  it('warmup → dropset head: follower inherits null reps/weight from head', () => {
    const sets = [mk('a', 'warmup', null, null, null)];
    const ops = cycleSessionSetKind(sets, 'a', 'new-1');
    expect(ops[1]).toEqual({
      type: 'insertFollower',
      new_set_id: 'new-1',
      parent_set_id: 'a',
      reps: null,
      weight_kg: null,
    });
  });

  it('dropset head → working (no followers): emits update only', () => {
    const sets = [mk('a', 'dropset', null)];
    expect(cycleSessionSetKind(sets, 'a', 'new-1')).toEqual([
      {
        type: 'update',
        set_id: 'a',
        patch: { set_kind: 'working', parent_set_id: null },
      },
    ]);
  });

  it('dropset head → working (1 follower): emits update + 1 delete', () => {
    const sets = [mk('a', 'dropset', null), mk('f1', 'dropset', 'a')];
    expect(cycleSessionSetKind(sets, 'a', 'new-1')).toEqual([
      {
        type: 'update',
        set_id: 'a',
        patch: { set_kind: 'working', parent_set_id: null },
      },
      { type: 'delete', set_id: 'f1' },
    ]);
  });

  it('dropset head → working (multiple followers): emits update + N deletes', () => {
    const sets = [
      mk('a', 'dropset', null),
      mk('f1', 'dropset', 'a'),
      mk('f2', 'dropset', 'a'),
      mk('f3', 'dropset', 'a'),
    ];
    const ops = cycleSessionSetKind(sets, 'a', 'new-1');
    expect(ops).toHaveLength(4);
    expect(ops[0]).toEqual({
      type: 'update',
      set_id: 'a',
      patch: { set_kind: 'working', parent_set_id: null },
    });
    expect(ops.slice(1).map((o) => (o as { set_id: string }).set_id)).toEqual([
      'f1',
      'f2',
      'f3',
    ]);
  });

  it('cascade delete on head does NOT delete unrelated followers in other clusters', () => {
    // Two clusters, 'a' head + 'f1' follower; 'b' head + 'f2' follower.
    // Cycling 'a' → working should only delete 'f1', leaving 'f2' alone.
    const sets = [
      mk('a', 'dropset', null),
      mk('f1', 'dropset', 'a'),
      mk('b', 'dropset', null),
      mk('f2', 'dropset', 'b'),
    ];
    const ops = cycleSessionSetKind(sets, 'a', 'new-1');
    expect(ops).toEqual([
      {
        type: 'update',
        set_id: 'a',
        patch: { set_kind: 'working', parent_set_id: null },
      },
      { type: 'delete', set_id: 'f1' },
    ]);
  });

  it('full cycle round-trip: working → warmup → dropset → working', () => {
    // Verify the three transitions emit the expected shape sequentially
    // (no semantic about applying them; the caller does that).
    let sets: CycleSessionSetInput[] = [mk('a', 'working')];
    // 1) working → warmup
    let ops = cycleSessionSetKind(sets, 'a', 'ignored');
    expect(ops).toEqual([
      { type: 'update', set_id: 'a', patch: { set_kind: 'warmup' } },
    ]);
    // Simulate applying it
    sets = sets.map((s) => (s.id === 'a' ? { ...s, set_kind: 'warmup' } : s));

    // 2) warmup → dropset (insert follower)
    ops = cycleSessionSetKind(sets, 'a', 'new-1');
    expect(ops[0]).toMatchObject({ type: 'update' });
    expect(ops[1]).toMatchObject({ type: 'insertFollower' });
    // Simulate applying it
    sets = sets.map((s) =>
      s.id === 'a' ? { ...s, set_kind: 'dropset', parent_set_id: null } : s,
    );
    sets.push({
      id: 'new-1',
      set_kind: 'dropset',
      parent_set_id: 'a',
      reps: 8,
      weight_kg: 50,
    });

    // 3) dropset head → working (delete the follower)
    ops = cycleSessionSetKind(sets, 'a', 'ignored');
    expect(ops).toEqual([
      {
        type: 'update',
        set_id: 'a',
        patch: { set_kind: 'working', parent_set_id: null },
      },
      { type: 'delete', set_id: 'new-1' },
    ]);
  });
});

/**
 * Cluster-aware variant — ADR-0019 line 709 (slice 10c Phase 7).
 * When `is_in_cluster = true`, the cycle is restricted to warmup ↔ working
 * (dropset branch DISABLED on cluster siblings). When false, behaviour
 * is identical to the legacy `cycleSessionSetKind`.
 */
describe('cycleSessionSetKindClusterAware', () => {
  it('is_in_cluster=false: solo branch identical to cycleSessionSetKind (warmup → dropset)', () => {
    const sets = [mk('a', 'warmup', null, 10, 60)];
    const solo = cycleSessionSetKind(sets, 'a', 'new-1');
    const aware = cycleSessionSetKindClusterAware(sets, 'a', 'new-1', false);
    expect(aware).toEqual(solo);
    // explicit sanity — dropset head + follower emitted
    expect(aware).toEqual([
      {
        type: 'update',
        set_id: 'a',
        patch: { set_kind: 'dropset', parent_set_id: null },
      },
      {
        type: 'insertFollower',
        new_set_id: 'new-1',
        parent_set_id: 'a',
        reps: 10,
        weight_kg: 60,
      },
    ]);
  });

  it('is_in_cluster=true: working → warmup (no dropset jump)', () => {
    const sets = [mk('a', 'working')];
    expect(cycleSessionSetKindClusterAware(sets, 'a', 'new-1', true)).toEqual([
      { type: 'update', set_id: 'a', patch: { set_kind: 'warmup' } },
    ]);
  });

  it('is_in_cluster=true: warmup → working (skips dropset branch entirely)', () => {
    const sets = [mk('a', 'warmup', null, 10, 60)];
    // Note: NO insertFollower op — dropset is disabled on cluster siblings.
    expect(cycleSessionSetKindClusterAware(sets, 'a', 'new-1', true)).toEqual([
      { type: 'update', set_id: 'a', patch: { set_kind: 'working' } },
    ]);
  });

  it('is_in_cluster=true: defensive fallback when set is somehow dropset', () => {
    // Shouldn't occur via UI (cluster siblings never enter dropset), but
    // protect against legacy data: tap should collapse back to working
    // and strip any dangling follower rows.
    const sets = [mk('a', 'dropset', null), mk('f1', 'dropset', 'a')];
    expect(cycleSessionSetKindClusterAware(sets, 'a', 'new-1', true)).toEqual([
      {
        type: 'update',
        set_id: 'a',
        patch: { set_kind: 'working', parent_set_id: null },
      },
      { type: 'delete', set_id: 'f1' },
    ]);
  });

  it('is_in_cluster=true: full round-trip working → warmup → working (no dropset state ever)', () => {
    let sets: CycleSessionSetInput[] = [mk('a', 'working')];
    let ops = cycleSessionSetKindClusterAware(sets, 'a', 'new-1', true);
    expect(ops).toEqual([
      { type: 'update', set_id: 'a', patch: { set_kind: 'warmup' } },
    ]);
    sets = sets.map((s) => (s.id === 'a' ? { ...s, set_kind: 'warmup' } : s));
    ops = cycleSessionSetKindClusterAware(sets, 'a', 'new-1', true);
    expect(ops).toEqual([
      { type: 'update', set_id: 'a', patch: { set_kind: 'working' } },
    ]);
  });

  it('is_in_cluster=true: returns [] when target id is missing', () => {
    expect(
      cycleSessionSetKindClusterAware([mk('a', 'working')], 'missing', 'new-1', true),
    ).toEqual([]);
  });

  // Slice 10c overnight #7 第 2 點 — explicit contract: solo vs cluster
  // diverge at the warmup transition. Solo emits an insertFollower op
  // (→ dropset state), cluster emits a plain update (→ working state).
  // This test pins the difference so future refactors keep the cluster
  // shared `#` button skipping dropset entirely (per ADR-0019 Q2 § (C)).
  it('cluster vs solo divergence: warmup tap emits dropset for solo, working for cluster', () => {
    const sets = [mk('a', 'warmup', null, 10, 60)];
    const solo = cycleSessionSetKindClusterAware(sets, 'a', 'new-1', false);
    const cluster = cycleSessionSetKindClusterAware(sets, 'a', 'new-1', true);
    // Solo: 2 ops (update kind + insertFollower).
    expect(solo).toHaveLength(2);
    expect(solo[0]).toMatchObject({
      type: 'update',
      patch: { set_kind: 'dropset' },
    });
    expect(solo[1]).toMatchObject({ type: 'insertFollower' });
    // Cluster: 1 op (update kind), NO follower insert.
    expect(cluster).toHaveLength(1);
    expect(cluster[0]).toEqual({
      type: 'update',
      set_id: 'a',
      patch: { set_kind: 'working' },
    });
  });

  it('is_in_cluster=true: existing dropset (legacy data) cycles back to working — never re-enters dropset', () => {
    // Sanity: a cluster row that somehow holds set_kind='dropset' (e.g.
    // legacy row from before the cluster cycle restriction) gets nudged
    // back to working on the next tap. The follow-up tap then resumes
    // the W ↔ Wm ping-pong without ever revisiting dropset.
    let sets: CycleSessionSetInput[] = [mk('a', 'dropset', null)];
    let ops = cycleSessionSetKindClusterAware(sets, 'a', 'new-1', true);
    expect(ops[0]).toEqual({
      type: 'update',
      set_id: 'a',
      patch: { set_kind: 'working', parent_set_id: null },
    });
    sets = [mk('a', 'working')];
    ops = cycleSessionSetKindClusterAware(sets, 'a', 'new-1', true);
    expect(ops).toEqual([
      { type: 'update', set_id: 'a', patch: { set_kind: 'warmup' } },
    ]);
    sets = [mk('a', 'warmup')];
    ops = cycleSessionSetKindClusterAware(sets, 'a', 'new-1', true);
    expect(ops).toEqual([
      { type: 'update', set_id: 'a', patch: { set_kind: 'working' } },
    ]);
  });
});
