import {
  addSet,
  updateSet,
  deleteSet,
  reorderSets,
  cycleSetKind,
  deleteSupersetRowAt,
  cloneSupersetRowAt,
  addClusterAfter,
  isClusterFollower,
} from '../../src/domain/template/templateOps';
import type {
  TemplateExercise,
  TemplateSet,
} from '../../src/domain/template/types';

/**
 * Pure logic for slice 9.5 per-set template ops (ADR-0016).
 * No DB, no React — every test exercises a single transformation.
 */

function deterministicIdGen(seedPrefix = 'id'): { uuid: () => string } {
  let n = 0;
  return { uuid: () => `${seedPrefix}-${++n}` };
}

function makeSet(over: Partial<TemplateSet> & { id: string }): TemplateSet {
  return {
    position: 0,
    kind: 'working',
    reps: 8,
    weight: 80,
    parent_set_id: null,
    notes: null,
    ...over,
  };
}

function makeEx(over: Partial<TemplateExercise> & { id: string }): TemplateExercise {
  return {
    template_id: 'tpl-1',
    exercise_id: 'bench',
    ordering: 0,
    section: 'general',
    parent_id: null,
    notes: null,
    rest_seconds: null,
    reusable_superset_id: null,
    sets: [],
    ...over,
  };
}

describe('templateOps — addSet', () => {
  it('seeds a default working row on empty exercise', () => {
    const ex = makeEx({ id: 'ex-1' });
    const out = addSet(ex, deterministicIdGen());
    expect(out.sets).toHaveLength(1);
    expect(out.sets[0]).toMatchObject({
      position: 0,
      kind: 'working',
      reps: 8,
      weight: 20,
      parent_set_id: null,
    });
  });

  it('clones the last working set verbatim (kind/reps/weight)', () => {
    const ex = makeEx({
      id: 'ex-1',
      sets: [
        makeSet({ id: 's1', position: 0, reps: 8, weight: 80 }),
        makeSet({ id: 's2', position: 1, reps: 6, weight: 90 }),
      ],
    });
    const out = addSet(ex, deterministicIdGen('new'));
    expect(out.sets).toHaveLength(3);
    expect(out.sets[2]).toMatchObject({
      id: 'new-1',
      position: 2,
      kind: 'working',
      reps: 6,
      weight: 90,
      parent_set_id: null,
    });
  });

  it('clones the entire trailing cluster when last is a dropset', () => {
    const ex = makeEx({
      id: 'ex-1',
      sets: [
        makeSet({ id: 'w1', position: 0, kind: 'working' }),
        makeSet({ id: 'h1', position: 1, kind: 'dropset', reps: 8, weight: 80 }),
        makeSet({
          id: 'f1',
          position: 2,
          kind: 'dropset',
          parent_set_id: 'h1',
          reps: 6,
          weight: 70,
        }),
      ],
    });
    const out = addSet(ex, deterministicIdGen('new'));
    expect(out.sets).toHaveLength(5);
    // New cluster head (idx 3) + follower (idx 4)
    expect(out.sets[3]).toMatchObject({
      id: 'new-1',
      kind: 'dropset',
      parent_set_id: null,
      reps: 8,
      weight: 80,
      position: 3,
    });
    expect(out.sets[4]).toMatchObject({
      id: 'new-2',
      kind: 'dropset',
      parent_set_id: 'new-1',
      reps: 6,
      weight: 70,
      position: 4,
    });
  });
});

describe('templateOps — updateSet', () => {
  it('patches reps/weight/notes by id, leaves others intact', () => {
    const ex = makeEx({
      id: 'ex-1',
      sets: [
        makeSet({ id: 's1', position: 0, reps: 8, weight: 80 }),
        makeSet({ id: 's2', position: 1, reps: 6, weight: 90 }),
      ],
    });
    const out = updateSet(ex, 's2', { reps: 5, weight: 95, notes: 'PR attempt' });
    expect(out.sets[0]).toEqual(ex.sets[0]); // untouched ref ok? new array but row stable
    expect(out.sets[1]).toMatchObject({
      id: 's2',
      reps: 5,
      weight: 95,
      notes: 'PR attempt',
    });
  });

  it('is a no-op for an unknown set id', () => {
    const ex = makeEx({
      id: 'ex-1',
      sets: [makeSet({ id: 's1', position: 0 })],
    });
    const out = updateSet(ex, 'ghost', { reps: 999 });
    expect(out.sets[0]).toEqual(ex.sets[0]);
  });
});

describe('templateOps — deleteSet', () => {
  it('removes a working row and renormalises positions', () => {
    const ex = makeEx({
      id: 'ex-1',
      sets: [
        makeSet({ id: 's1', position: 0 }),
        makeSet({ id: 's2', position: 1 }),
        makeSet({ id: 's3', position: 2 }),
      ],
    });
    const out = deleteSet(ex, 's2');
    expect(out.sets.map((s) => s.id)).toEqual(['s1', 's3']);
    expect(out.sets.map((s) => s.position)).toEqual([0, 1]);
  });

  it('cascade-deletes followers when removing a cluster head', () => {
    const ex = makeEx({
      id: 'ex-1',
      sets: [
        makeSet({ id: 'w1', position: 0, kind: 'working' }),
        makeSet({ id: 'h1', position: 1, kind: 'dropset' }),
        makeSet({ id: 'f1', position: 2, kind: 'dropset', parent_set_id: 'h1' }),
        makeSet({ id: 'f2', position: 3, kind: 'dropset', parent_set_id: 'h1' }),
      ],
    });
    const out = deleteSet(ex, 'h1');
    expect(out.sets.map((s) => s.id)).toEqual(['w1']);
    expect(out.sets[0].position).toBe(0);
  });

  it('enforces cluster min size 2: refuse to remove last follower', () => {
    const ex = makeEx({
      id: 'ex-1',
      sets: [
        makeSet({ id: 'h1', position: 0, kind: 'dropset' }),
        makeSet({ id: 'f1', position: 1, kind: 'dropset', parent_set_id: 'h1' }),
      ],
    });
    const out = deleteSet(ex, 'f1');
    expect(out).toEqual(ex); // unchanged
  });

  it('allows follower removal when cluster size > 2', () => {
    const ex = makeEx({
      id: 'ex-1',
      sets: [
        makeSet({ id: 'h1', position: 0, kind: 'dropset' }),
        makeSet({ id: 'f1', position: 1, kind: 'dropset', parent_set_id: 'h1' }),
        makeSet({ id: 'f2', position: 2, kind: 'dropset', parent_set_id: 'h1' }),
      ],
    });
    const out = deleteSet(ex, 'f1');
    expect(out.sets.map((s) => s.id)).toEqual(['h1', 'f2']);
    expect(out.sets.map((s) => s.position)).toEqual([0, 1]);
  });
});

describe('templateOps — reorderSets', () => {
  it('moves a single working set to the new index', () => {
    const ex = makeEx({
      id: 'ex-1',
      sets: [
        makeSet({ id: 's1', position: 0 }),
        makeSet({ id: 's2', position: 1 }),
        makeSet({ id: 's3', position: 2 }),
      ],
    });
    const out = reorderSets(ex, 's1', 2);
    expect(out.sets.map((s) => s.id)).toEqual(['s2', 's3', 's1']);
    expect(out.sets.map((s) => s.position)).toEqual([0, 1, 2]);
  });

  it('moves a cluster as one unit (head + followers stay contiguous)', () => {
    const ex = makeEx({
      id: 'ex-1',
      sets: [
        makeSet({ id: 'w1', position: 0, kind: 'working' }),
        makeSet({ id: 'h1', position: 1, kind: 'dropset' }),
        makeSet({ id: 'f1', position: 2, kind: 'dropset', parent_set_id: 'h1' }),
        makeSet({ id: 'w2', position: 3, kind: 'working' }),
      ],
    });
    const out = reorderSets(ex, 'h1', 0);
    expect(out.sets.map((s) => s.id)).toEqual(['h1', 'f1', 'w1', 'w2']);
  });

  it('moves the whole cluster even when target is a follower', () => {
    const ex = makeEx({
      id: 'ex-1',
      sets: [
        makeSet({ id: 'w1', position: 0, kind: 'working' }),
        makeSet({ id: 'h1', position: 1, kind: 'dropset' }),
        makeSet({ id: 'f1', position: 2, kind: 'dropset', parent_set_id: 'h1' }),
      ],
    });
    const out = reorderSets(ex, 'f1', 0);
    expect(out.sets.map((s) => s.id)).toEqual(['h1', 'f1', 'w1']);
  });
});

describe('templateOps — cycleSetKind', () => {
  it('working → warmup: only kind flips', () => {
    const ex = makeEx({
      id: 'ex-1',
      sets: [makeSet({ id: 's1', position: 0, kind: 'working' })],
    });
    const out = cycleSetKind(ex, 's1', deterministicIdGen());
    expect(out.sets).toHaveLength(1);
    expect(out.sets[0].kind).toBe('warmup');
  });

  it('warmup → dropset head: flips kind and auto-adds one follower', () => {
    const ex = makeEx({
      id: 'ex-1',
      sets: [makeSet({ id: 's1', position: 0, kind: 'warmup', reps: 10, weight: 50 })],
    });
    const out = cycleSetKind(ex, 's1', deterministicIdGen('cyc'));
    expect(out.sets).toHaveLength(2);
    expect(out.sets[0]).toMatchObject({
      id: 's1',
      kind: 'dropset',
      parent_set_id: null,
      position: 0,
    });
    expect(out.sets[1]).toMatchObject({
      id: 'cyc-1',
      kind: 'dropset',
      parent_set_id: 's1',
      reps: 10,
      weight: 50,
      position: 1,
    });
  });

  it('dropset head → working: flips kind and CASCADE deletes all followers', () => {
    const ex = makeEx({
      id: 'ex-1',
      sets: [
        makeSet({ id: 'h1', position: 0, kind: 'dropset' }),
        makeSet({ id: 'f1', position: 1, kind: 'dropset', parent_set_id: 'h1' }),
        makeSet({ id: 'f2', position: 2, kind: 'dropset', parent_set_id: 'h1' }),
      ],
    });
    const out = cycleSetKind(ex, 'h1', deterministicIdGen());
    expect(out.sets.map((s) => s.id)).toEqual(['h1']);
    expect(out.sets[0]).toMatchObject({
      kind: 'working',
      parent_set_id: null,
      position: 0,
    });
  });

  it('follower tap is a no-op', () => {
    const ex = makeEx({
      id: 'ex-1',
      sets: [
        makeSet({ id: 'h1', position: 0, kind: 'dropset' }),
        makeSet({ id: 'f1', position: 1, kind: 'dropset', parent_set_id: 'h1' }),
      ],
    });
    const out = cycleSetKind(ex, 'f1', deterministicIdGen());
    expect(out).toEqual(ex);
  });
});

describe('templateOps — superset row ops', () => {
  it('deleteSupersetRowAt removes the same row index on parent + child', () => {
    const parent = makeEx({
      id: 'p',
      sets: [
        makeSet({ id: 'p1', position: 0 }),
        makeSet({ id: 'p2', position: 1 }),
        makeSet({ id: 'p3', position: 2 }),
      ],
    });
    const child = makeEx({
      id: 'c',
      parent_id: 'p',
      sets: [
        makeSet({ id: 'c1', position: 0 }),
        makeSet({ id: 'c2', position: 1 }),
        makeSet({ id: 'c3', position: 2 }),
      ],
    });
    const other = makeEx({
      id: 'plain',
      sets: [makeSet({ id: 'x1', position: 0 })],
    });
    const out = deleteSupersetRowAt([parent, child, other], 'p', ['c'], 1);
    expect(out[0].sets.map((s) => s.id)).toEqual(['p1', 'p3']);
    expect(out[1].sets.map((s) => s.id)).toEqual(['c1', 'c3']);
    expect(out[2]).toEqual(other);
    expect(out[0].sets.map((s) => s.position)).toEqual([0, 1]);
    expect(out[1].sets.map((s) => s.position)).toEqual([0, 1]);
  });

  it('cloneSupersetRowAt clones the same row index on each side', () => {
    const parent = makeEx({
      id: 'p',
      sets: [
        makeSet({ id: 'p1', position: 0, reps: 10, weight: 50 }),
        makeSet({ id: 'p2', position: 1, reps: 8, weight: 60 }),
      ],
    });
    const child = makeEx({
      id: 'c',
      parent_id: 'p',
      sets: [
        makeSet({ id: 'c1', position: 0, reps: 12, weight: 40 }),
        makeSet({ id: 'c2', position: 1, reps: 10, weight: 45 }),
      ],
    });
    const out = cloneSupersetRowAt(
      [parent, child],
      'p',
      ['c'],
      1,
      deterministicIdGen('ss')
    );
    expect(out[0].sets).toHaveLength(3);
    expect(out[0].sets[2]).toMatchObject({
      id: 'ss-1',
      reps: 8,
      weight: 60,
      kind: 'working',
      parent_set_id: null,
      position: 2,
    });
    expect(out[1].sets[2]).toMatchObject({
      id: 'ss-2',
      reps: 10,
      weight: 45,
      kind: 'working',
      parent_set_id: null,
      position: 2,
    });
  });
});

describe('templateOps — addClusterAfter', () => {
  it('appends a fresh head + follower after the given cluster', () => {
    const ex = makeEx({
      id: 'ex-1',
      sets: [
        makeSet({ id: 'w1', position: 0, kind: 'working' }),
        makeSet({ id: 'h1', position: 1, kind: 'dropset', reps: 8, weight: 80 }),
        makeSet({
          id: 'f1',
          position: 2,
          kind: 'dropset',
          parent_set_id: 'h1',
          reps: 6,
          weight: 70,
        }),
      ],
    });
    const out = addClusterAfter(ex, 'h1', deterministicIdGen('cl'));
    expect(out.sets.map((s) => s.id)).toEqual(['w1', 'h1', 'f1', 'cl-1', 'cl-2']);
    expect(out.sets[3]).toMatchObject({
      kind: 'dropset',
      parent_set_id: null,
      reps: 8,
      weight: 80,
    });
    expect(out.sets[4]).toMatchObject({
      kind: 'dropset',
      parent_set_id: 'cl-1',
    });
  });

  it('is a no-op when head_set_id is not a cluster head', () => {
    const ex = makeEx({
      id: 'ex-1',
      sets: [makeSet({ id: 's1', position: 0, kind: 'working' })],
    });
    const out = addClusterAfter(ex, 's1', deterministicIdGen());
    expect(out).toEqual(ex);
  });
});

describe('templateOps — isClusterFollower', () => {
  it('returns true only for dropset rows with parent_set_id set', () => {
    expect(
      isClusterFollower(makeSet({ id: 'x', kind: 'dropset', parent_set_id: 'h' }))
    ).toBe(true);
    expect(
      isClusterFollower(makeSet({ id: 'x', kind: 'dropset', parent_set_id: null }))
    ).toBe(false);
    expect(isClusterFollower(makeSet({ id: 'x', kind: 'working' }))).toBe(false);
  });
});
