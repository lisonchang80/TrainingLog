import {
  addSet,
  updateSet,
  deleteSet,
  reorderSets,
  reorderTemplateExercises,
  cycleSetKind,
  cycleSetKindAcrossExercises,
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

describe('templateOps — cycleSetKindAcrossExercises', () => {
  // Slice 10c Phase 2 commit 3: cluster-aware wrapper. Solo dispatch
  // routes to per-exercise cycleSetKind; reusable cluster mirrors
  // warmup ↔ working across all sibling members at the same set index.

  it('solo: working → warmup via wrapper (delegates to per-ex cycleSetKind)', () => {
    const exercises = [
      makeEx({
        id: 'solo',
        sets: [makeSet({ id: 's1', position: 0, kind: 'working' })],
      }),
    ];
    const out = cycleSetKindAcrossExercises(
      exercises,
      'solo',
      's1',
      deterministicIdGen(),
    );
    expect(out[0].sets[0].kind).toBe('warmup');
  });

  it('solo: warmup → dropset(head + follower) via wrapper', () => {
    const exercises = [
      makeEx({
        id: 'solo',
        sets: [makeSet({ id: 's1', position: 0, kind: 'warmup', reps: 6, weight: 40 })],
      }),
    ];
    const out = cycleSetKindAcrossExercises(
      exercises,
      'solo',
      's1',
      deterministicIdGen('cyc'),
    );
    expect(out[0].sets).toHaveLength(2);
    expect(out[0].sets[0]).toMatchObject({ id: 's1', kind: 'dropset', parent_set_id: null });
    expect(out[0].sets[1]).toMatchObject({
      id: 'cyc-1',
      kind: 'dropset',
      parent_set_id: 's1',
      reps: 6,
      weight: 40,
    });
  });

  it('cluster: warmup → working mirrors to sibling at same idx', () => {
    // Two-side reusable cluster (parent + child, both stamped rs_id='rs-1').
    const exercises = [
      makeEx({
        id: 'parent',
        reusable_superset_id: 'rs-1',
        sets: [
          makeSet({ id: 'pA0', position: 0, kind: 'warmup' }),
          makeSet({ id: 'pA1', position: 1, kind: 'working' }),
        ],
      }),
      makeEx({
        id: 'child',
        parent_id: 'parent',
        reusable_superset_id: 'rs-1',
        sets: [
          makeSet({ id: 'cB0', position: 0, kind: 'warmup' }),
          makeSet({ id: 'cB1', position: 1, kind: 'working' }),
        ],
      }),
    ];
    // Tap row 0 (warmup) on parent — should flip both pA0 and cB0 to working.
    const out = cycleSetKindAcrossExercises(
      exercises,
      'parent',
      'pA0',
      deterministicIdGen(),
    );
    expect(out[0].sets[0].kind).toBe('working'); // parent row 0
    expect(out[1].sets[0].kind).toBe('working'); // child row 0 mirrored
    expect(out[0].sets[1].kind).toBe('working'); // row 1 untouched (was working)
    expect(out[1].sets[1].kind).toBe('working'); // row 1 untouched
  });

  it('cluster: working → warmup mirrors to sibling at same idx', () => {
    const exercises = [
      makeEx({
        id: 'parent',
        reusable_superset_id: 'rs-1',
        sets: [makeSet({ id: 'pA0', position: 0, kind: 'working' })],
      }),
      makeEx({
        id: 'child',
        parent_id: 'parent',
        reusable_superset_id: 'rs-1',
        sets: [makeSet({ id: 'cB0', position: 0, kind: 'working' })],
      }),
    ];
    const out = cycleSetKindAcrossExercises(
      exercises,
      'child',
      'cB0',
      deterministicIdGen(),
    );
    // Tap on child row should mirror to parent too.
    expect(out[0].sets[0].kind).toBe('warmup');
    expect(out[1].sets[0].kind).toBe('warmup');
  });

  it('cluster: defensive — non-warmup state cycles to warmup (dropset stray)', () => {
    // Shouldn't happen in practice (cluster restricts warmup ↔ working),
    // but if a stray dropset slips through, cycle routes it to warmup so
    // the next tap resumes the normal warmup ↔ working ping-pong.
    const exercises = [
      makeEx({
        id: 'parent',
        reusable_superset_id: 'rs-1',
        sets: [makeSet({ id: 'pA0', position: 0, kind: 'dropset' })],
      }),
      makeEx({
        id: 'child',
        parent_id: 'parent',
        reusable_superset_id: 'rs-1',
        sets: [makeSet({ id: 'cB0', position: 0, kind: 'dropset' })],
      }),
    ];
    const out = cycleSetKindAcrossExercises(
      exercises,
      'parent',
      'pA0',
      deterministicIdGen(),
    );
    expect(out[0].sets[0].kind).toBe('warmup');
    expect(out[1].sets[0].kind).toBe('warmup');
  });

  it('cluster: leaves non-cluster exercises untouched', () => {
    const exercises = [
      makeEx({
        id: 'parent',
        reusable_superset_id: 'rs-1',
        sets: [makeSet({ id: 'pA0', position: 0, kind: 'warmup' })],
      }),
      makeEx({
        id: 'child',
        parent_id: 'parent',
        reusable_superset_id: 'rs-1',
        sets: [makeSet({ id: 'cB0', position: 0, kind: 'warmup' })],
      }),
      makeEx({
        id: 'unrelated',
        sets: [makeSet({ id: 'u0', position: 0, kind: 'warmup' })],
      }),
    ];
    const out = cycleSetKindAcrossExercises(
      exercises,
      'parent',
      'pA0',
      deterministicIdGen(),
    );
    expect(out[2].sets[0].kind).toBe('warmup'); // unrelated unchanged
    expect(out[2]).toBe(exercises[2]); // referential equality preserved
  });

  it('returns input unchanged (referential equality) when ex_id not found', () => {
    const exercises = [
      makeEx({ id: 'a', sets: [makeSet({ id: 's1', position: 0, kind: 'working' })] }),
    ];
    const out = cycleSetKindAcrossExercises(
      exercises,
      'nonexistent',
      's1',
      deterministicIdGen(),
    );
    expect(out).toBe(exercises);
  });

  it('cluster: returns input unchanged when set_id not found in target ex', () => {
    const exercises = [
      makeEx({
        id: 'parent',
        reusable_superset_id: 'rs-1',
        sets: [makeSet({ id: 'pA0', position: 0, kind: 'warmup' })],
      }),
    ];
    const out = cycleSetKindAcrossExercises(
      exercises,
      'parent',
      'nonexistent-set',
      deterministicIdGen(),
    );
    expect(out).toBe(exercises);
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

// overnight #45 第 3 點 — parent-level reorder helper (used by the editor's
// 排序動作 modal onConfirm path). Pure-domain tests: solo↔solo swap, cluster
// keep paired, safety guard for missing parents.
describe('templateOps — reorderTemplateExercises', () => {
  it('simple swap: solo↔solo reorders parents + reassigns ordering 0..N', () => {
    const ex1 = makeEx({ id: 'p1', ordering: 0 });
    const ex2 = makeEx({ id: 'p2', ordering: 1 });
    const ex3 = makeEx({ id: 'p3', ordering: 2 });
    const out = reorderTemplateExercises([ex1, ex2, ex3], ['p3', 'p1', 'p2']);
    expect(out.map((e) => e.id)).toEqual(['p3', 'p1', 'p2']);
    expect(out.map((e) => e.ordering)).toEqual([0, 1, 2]);
  });

  it('cluster keeps A+B paired: parent at new position, child stays adjacent', () => {
    // Layout: [solo S1, cluster (parent P + child C), solo S2]
    const s1 = makeEx({ id: 's1', ordering: 0 });
    const p = makeEx({
      id: 'p',
      ordering: 1,
      reusable_superset_id: 'rs-1',
    });
    const c = makeEx({
      id: 'c',
      ordering: 2,
      parent_id: 'p',
      reusable_superset_id: 'rs-1',
    });
    const s2 = makeEx({ id: 's2', ordering: 3 });
    // User reorders parents: [cluster, S2, S1] → child must follow cluster
    // parent (not split).
    const out = reorderTemplateExercises([s1, p, c, s2], ['p', 's2', 's1']);
    expect(out.map((e) => e.id)).toEqual(['p', 'c', 's2', 's1']);
    expect(out.map((e) => e.ordering)).toEqual([0, 1, 2, 3]);
    // Verify parent_id linkage preserved + reusable_superset_id intact (cluster
    // pair invariant).
    expect(out[0].reusable_superset_id).toBe('rs-1');
    expect(out[1].parent_id).toBe('p');
    expect(out[1].reusable_superset_id).toBe('rs-1');
  });

  it('safety: missing parent ids appended at end (no silent drops)', () => {
    // orderedParentIds omits 'p2' — must still appear in output (appended).
    const p1 = makeEx({ id: 'p1', ordering: 0 });
    const p2 = makeEx({ id: 'p2', ordering: 1 });
    const p3 = makeEx({ id: 'p3', ordering: 2 });
    const out = reorderTemplateExercises([p1, p2, p3], ['p3', 'p1']);
    // p2 appended at end; full set of parent ids preserved.
    expect(out.map((e) => e.id).sort()).toEqual(['p1', 'p2', 'p3']);
    // Specified ones come first in given order, missing appended.
    expect(out.map((e) => e.id)).toEqual(['p3', 'p1', 'p2']);
    expect(out.map((e) => e.ordering)).toEqual([0, 1, 2]);
  });
});
