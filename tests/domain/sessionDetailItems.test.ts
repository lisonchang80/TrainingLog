import {
  buildClusters,
  buildOrderedItems,
  type ClusterRow,
  type OrderedItem,
} from '../../src/domain/set/sessionDetailItems';
import type { SessionExerciseRowWithName } from '../../src/adapters/sqlite/sessionRepository';
import type { SessionSetWithExercise } from '../../src/adapters/sqlite/setRepository';

/**
 * Read-mode cluster grouping + ordered-item builders (extracted from
 * app/session/[id].tsx 2026-06-02, big-file health #8). The builders read only
 * a subset of each row type — exercise: id / parent_id / exercise_id; set:
 * session_exercise_id / exercise_id / ordering / display_rank — so fixtures
 * carry just those fields and cast to the full repo row shapes.
 */

function makeEx(
  id: string,
  opts: { parent_id?: string | null; exercise_id?: string } = {},
): SessionExerciseRowWithName {
  return {
    id,
    parent_id: opts.parent_id ?? null,
    exercise_id: opts.exercise_id ?? `lib-${id}`,
  } as unknown as SessionExerciseRowWithName;
}

function makeSet(
  id: string,
  opts: {
    session_exercise_id?: string | null;
    exercise_id?: string;
    ordering: number;
    display_rank?: number | null;
  },
): SessionSetWithExercise {
  return {
    id,
    session_exercise_id: opts.session_exercise_id ?? null,
    exercise_id: opts.exercise_id ?? 'lib-x',
    ordering: opts.ordering,
    display_rank: opts.display_rank ?? null,
  } as unknown as SessionSetWithExercise;
}

const ids = (sets: SessionSetWithExercise[]) => sets.map((s) => s.id);

describe('buildClusters', () => {
  it('empty input → no clusters', () => {
    expect(buildClusters([], [])).toEqual([]);
  });

  it('all-solo exercises (no parent_id) → no clusters', () => {
    const exs = [makeEx('a'), makeEx('b')];
    const sets = [
      makeSet('s1', { session_exercise_id: 'a', ordering: 0 }),
      makeSet('s2', { session_exercise_id: 'b', ordering: 1 }),
    ];
    expect(buildClusters(exs, sets)).toEqual([]);
  });

  it('one parent+child pair → one cluster with A/B sets split by owning card', () => {
    const parent = makeEx('p');
    const child = makeEx('c', { parent_id: 'p' });
    const sets = [
      makeSet('a1', { session_exercise_id: 'p', ordering: 0 }),
      makeSet('b1', { session_exercise_id: 'c', ordering: 1 }),
      makeSet('a2', { session_exercise_id: 'p', ordering: 2 }),
      makeSet('b2', { session_exercise_id: 'c', ordering: 3 }),
    ];
    const clusters = buildClusters([parent, child], sets);
    expect(clusters).toHaveLength(1);
    const row = clusters[0];
    expect(row.parent.id).toBe('p');
    expect(row.child.id).toBe('c');
    expect(ids(row.setsA)).toEqual(['a1', 'a2']);
    expect(ids(row.setsB)).toEqual(['b1', 'b2']);
  });

  it('parent with no matching child row → skipped (no cluster)', () => {
    // parent_id points at "p" but the parent card is absent from the list.
    const orphanChild = makeEx('c', { parent_id: 'ghost' });
    expect(buildClusters([orphanChild], [])).toEqual([]);
  });

  it('A-side sets ordered by display_rank ?? ordering (Watch reorder), ordering tie-break', () => {
    const parent = makeEx('p');
    const child = makeEx('c', { parent_id: 'p' });
    // A-side created in ordering 0,1,2 but Watch reordered via display_rank so
    // the displayed sequence is a3 (rank 0.5) between a1 (null→0) and a2 (null→2).
    const sets = [
      makeSet('a1', { session_exercise_id: 'p', ordering: 0 }),
      makeSet('a2', { session_exercise_id: 'p', ordering: 2 }),
      makeSet('a3', { session_exercise_id: 'p', ordering: 1, display_rank: 0.5 }),
      makeSet('b1', { session_exercise_id: 'c', ordering: 3 }),
    ];
    const [row] = buildClusters([parent, child], sets);
    // a1(0) → a3(0.5) → a2(2)
    expect(ids(row.setsA)).toEqual(['a1', 'a3', 'a2']);
    expect(ids(row.setsB)).toEqual(['b1']);
  });

  it('legacy null session_exercise_id rows matched by exercise_id', () => {
    const parent = makeEx('p', { exercise_id: 'bench' });
    const child = makeEx('c', { parent_id: 'p', exercise_id: 'row' });
    const sets = [
      // legacy rows: session_exercise_id NULL → fall back to exercise_id match
      makeSet('a1', { session_exercise_id: null, exercise_id: 'bench', ordering: 0 }),
      makeSet('b1', { session_exercise_id: null, exercise_id: 'row', ordering: 1 }),
    ];
    const [row] = buildClusters([parent, child], sets);
    expect(ids(row.setsA)).toEqual(['a1']);
    expect(ids(row.setsB)).toEqual(['b1']);
  });
});

describe('buildOrderedItems', () => {
  it('empty input → empty list', () => {
    expect(buildOrderedItems([], [], [])).toEqual([]);
  });

  it('all solo → one solo item per exercise, in iteration order, sets sorted', () => {
    const exs = [makeEx('a'), makeEx('b')];
    const sets = [
      makeSet('a2', { session_exercise_id: 'a', ordering: 1 }),
      makeSet('a1', { session_exercise_id: 'a', ordering: 0 }),
      makeSet('b1', { session_exercise_id: 'b', ordering: 2 }),
    ];
    const items = buildOrderedItems(exs, buildClusters(exs, sets), sets);
    expect(items.map((i) => i.kind)).toEqual(['solo', 'solo']);
    const a = items[0] as Extract<OrderedItem, { kind: 'solo' }>;
    expect(a.exercise.id).toBe('a');
    expect(ids(a.sets)).toEqual(['a1', 'a2']); // sorted by ordering
    const b = items[1] as Extract<OrderedItem, { kind: 'solo' }>;
    expect(ids(b.sets)).toEqual(['b1']);
  });

  it('cluster child is absorbed (not emitted as a separate solo)', () => {
    const parent = makeEx('p');
    const child = makeEx('c', { parent_id: 'p' });
    const sets = [
      makeSet('a1', { session_exercise_id: 'p', ordering: 0 }),
      makeSet('b1', { session_exercise_id: 'c', ordering: 1 }),
    ];
    const exs = [parent, child];
    const clusters = buildClusters(exs, sets);
    const items = buildOrderedItems(exs, clusters, sets);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('cluster');
    const ci = items[0] as Extract<OrderedItem, { kind: 'cluster' }>;
    expect(ci.cluster.parent.id).toBe('p');
    expect(ci.cluster.child.id).toBe('c');
  });

  it('mixed solo + cluster preserves session_exercise iteration order (cluster at parent slot)', () => {
    const solo1 = makeEx('s1');
    const parent = makeEx('p');
    const child = makeEx('c', { parent_id: 'p' });
    const solo2 = makeEx('s2');
    const exs = [solo1, parent, child, solo2];
    const sets = [
      makeSet('x1', { session_exercise_id: 's1', ordering: 0 }),
      makeSet('a1', { session_exercise_id: 'p', ordering: 1 }),
      makeSet('b1', { session_exercise_id: 'c', ordering: 2 }),
      makeSet('y1', { session_exercise_id: 's2', ordering: 3 }),
    ];
    const clusters = buildClusters(exs, sets);
    const items = buildOrderedItems(exs, clusters, sets);
    expect(items.map((i) => i.kind)).toEqual(['solo', 'cluster', 'solo']);
    expect((items[0] as Extract<OrderedItem, { kind: 'solo' }>).exercise.id).toBe('s1');
    expect((items[1] as Extract<OrderedItem, { kind: 'cluster' }>).cluster.parent.id).toBe('p');
    expect((items[2] as Extract<OrderedItem, { kind: 'solo' }>).exercise.id).toBe('s2');
  });

  it('solo sets ordered by display_rank ?? ordering (Watch mid-insert)', () => {
    const ex = makeEx('a');
    const sets = [
      makeSet('s1', { session_exercise_id: 'a', ordering: 0 }),
      makeSet('s2', { session_exercise_id: 'a', ordering: 1 }),
      // mid-inserted between s1 and s2 via fractional display_rank
      makeSet('s3', { session_exercise_id: 'a', ordering: 2, display_rank: 0.5 }),
    ];
    const items = buildOrderedItems([ex], buildClusters([ex], sets), sets);
    const solo = items[0] as Extract<OrderedItem, { kind: 'solo' }>;
    expect(ids(solo.sets)).toEqual(['s1', 's3', 's2']);
  });
});

// Type-level: ClusterRow / OrderedItem are exported (compile-time guard).
const _clusterRowGuard: ClusterRow | null = null;
void _clusterRowGuard;
