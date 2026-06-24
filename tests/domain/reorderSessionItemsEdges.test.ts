/**
 * Edge-case coverage for `src/domain/session/reorderSessionItems.ts`.
 *
 * The base `tests/domain/reorderSessionItems.test.ts` covers the happy
 * paths (solo rows, single + interleaved clusters, orphan-parent fallback,
 * input order preservation, child-after-parent expansion). These tests lock
 * the degenerate / malformed-input branches that the base suite skips:
 *
 *   1. Empty input → empty rows + empty map (no crash, no fabricated cluster).
 *   2. A child whose `parent_id` references a parent that appears LATER in
 *      the input array. The build is two-pass (collect children first, then
 *      emit rows), so cluster collapse must be order-independent w.r.t.
 *      parent/child position — locking this guards against a refactor that
 *      makes the second pass depend on the first having "already seen" the
 *      parent.
 *   3. A parent with an empty-string `exercise_name` still concatenates its
 *      child name with the " + " separator (documents the `name ? ... : ...`
 *      branch when the parent name is falsy — produces " + child", not just
 *      the child). Empty string is truthy-checked here so the parent slot
 *      renders blank, NOT dropped.
 *   4. `expandClusterIds` trusts the `childByParent` map, not the input order
 *      list — a parent in the ordered list whose child id is in the map still
 *      expands (the sheet only ever emits parent/solo ids, never children).
 *
 * Pure domain helpers — no DB or mocks needed.
 */

import {
  buildSessionReorderRows,
  expandClusterIds,
  type ReorderableSessionExercise,
} from '../../src/domain/session/reorderSessionItems';

describe('buildSessionReorderRows — degenerate input', () => {
  it('empty input → empty rows and empty childByParent map', () => {
    const { rows, childByParent } = buildSessionReorderRows([]);
    expect(rows).toEqual([]);
    expect(childByParent.size).toBe(0);
  });

  it('collapses a cluster even when the child precedes its parent in input', () => {
    // Child 'b' (parent_id 'a') appears BEFORE its parent 'a'. The two-pass
    // build must still detect 'a' as a cluster parent and hide 'b' as a row.
    const input: ReorderableSessionExercise[] = [
      { id: 'b', exercise_name: 'Chest Dip', parent_id: 'a' },
      { id: 'a', exercise_name: 'Bench Press', parent_id: null },
    ];
    const { rows, childByParent } = buildSessionReorderRows(input);
    expect(rows).toEqual([{ id: 'a', name: 'Bench Press + Chest Dip' }]);
    expect(childByParent.get('a')).toBe('b');
    expect(childByParent.size).toBe(1);
  });

  it('parent with empty-string name still renders the " + child" separator', () => {
    // The `childName ? `${name} + ${childName}` : name` branch with a falsy
    // PARENT name: parent slot stays blank but the cluster join is preserved.
    const input: ReorderableSessionExercise[] = [
      { id: 'a', exercise_name: '', parent_id: null },
      { id: 'b', exercise_name: 'Chest Dip', parent_id: 'a' },
    ];
    const { rows } = buildSessionReorderRows(input);
    expect(rows).toEqual([{ id: 'a', name: ' + Chest Dip' }]);
  });

  it('cluster child with empty-string name → "Parent + " (trailing separator)', () => {
    // The child name is empty: `childName` is '' (falsy), so the ternary
    // takes the ELSE branch and the row shows ONLY the parent name — the
    // cluster is detected (child hidden) but no join string is emitted.
    const input: ReorderableSessionExercise[] = [
      { id: 'a', exercise_name: 'Bench Press', parent_id: null },
      { id: 'b', exercise_name: '', parent_id: 'a' },
    ];
    const { rows, childByParent } = buildSessionReorderRows(input);
    // Empty child name is falsy → plain parent name (documented behaviour).
    expect(rows).toEqual([{ id: 'a', name: 'Bench Press' }]);
    // …but the child IS recorded so expand still re-inserts it on write.
    expect(childByParent.get('a')).toBe('b');
  });
});

describe('expandClusterIds — map is the source of truth', () => {
  it('expands a parent whose child is in the map regardless of list position', () => {
    const childByParent = new Map<string, string>([['a', 'b']]);
    // 'a' last in the ordered list — child still inserted right after it.
    const out = expandClusterIds(['x', 'y', 'a'], childByParent);
    expect(out).toEqual(['x', 'y', 'a', 'b']);
  });

  it('ignores map entries whose parent is absent from the ordered list', () => {
    // The sheet only emits the parents it rendered; a stale map entry for a
    // parent that is NOT in the confirmed order must not inject a phantom id.
    const childByParent = new Map<string, string>([
      ['a', 'b'],
      ['ghost', 'ghost-child'],
    ]);
    const out = expandClusterIds(['a'], childByParent);
    expect(out).toEqual(['a', 'b']);
    expect(out).not.toContain('ghost-child');
  });
});
