import {
  buildSessionReorderRows,
  expandClusterIds,
  type ReorderableSessionExercise,
} from '../../src/domain/session/reorderSessionItems';

describe('buildSessionReorderRows', () => {
  it('returns solo exercises 1:1 as plain rows', () => {
    const input: ReorderableSessionExercise[] = [
      { id: 'x', exercise_name: 'Bench Press', parent_id: null },
      { id: 'y', exercise_name: 'Squat', parent_id: null },
    ];
    const { rows, childByParent } = buildSessionReorderRows(input);
    expect(rows).toEqual([
      { id: 'x', name: 'Bench Press' },
      { id: 'y', name: 'Squat' },
    ]);
    expect(childByParent.size).toBe(0);
  });

  it('collapses cluster parent + child into one row "A + B"', () => {
    const input: ReorderableSessionExercise[] = [
      { id: 'a', exercise_name: 'Bench Press', parent_id: null },
      { id: 'b', exercise_name: 'Chest Dip', parent_id: 'a' },
      { id: 'c', exercise_name: 'Assisted Dip', parent_id: null },
    ];
    const { rows, childByParent } = buildSessionReorderRows(input);
    expect(rows).toEqual([
      { id: 'a', name: 'Bench Press + Chest Dip' },
      { id: 'c', name: 'Assisted Dip' },
    ]);
    expect(childByParent.get('a')).toBe('b');
    expect(childByParent.size).toBe(1);
  });

  it('handles multiple clusters interleaved with solos in input order', () => {
    const input: ReorderableSessionExercise[] = [
      { id: 'p1', exercise_name: 'A1', parent_id: null },
      { id: 'c1', exercise_name: 'B1', parent_id: 'p1' },
      { id: 's1', exercise_name: 'Solo1', parent_id: null },
      { id: 'p2', exercise_name: 'A2', parent_id: null },
      { id: 'c2', exercise_name: 'B2', parent_id: 'p2' },
    ];
    const { rows } = buildSessionReorderRows(input);
    expect(rows.map((r) => r.id)).toEqual(['p1', 's1', 'p2']);
    expect(rows.map((r) => r.name)).toEqual([
      'A1 + B1',
      'Solo1',
      'A2 + B2',
    ]);
  });

  it('treats orphan parent_id (referent missing) as solo (defensive)', () => {
    const input: ReorderableSessionExercise[] = [
      { id: 'a', exercise_name: 'Ghost child', parent_id: 'nonexistent' },
      { id: 'b', exercise_name: 'Plain', parent_id: null },
    ];
    const { rows, childByParent } = buildSessionReorderRows(input);
    // 'a' falls back to solo (parent missing); 'b' remains solo.
    expect(rows.map((r) => r.id).sort()).toEqual(['a', 'b']);
    expect(childByParent.size).toBe(0);
  });

  it('preserves input array order (callers sort by ordering upstream)', () => {
    const input: ReorderableSessionExercise[] = [
      { id: 'c', exercise_name: 'Third', parent_id: null },
      { id: 'a', exercise_name: 'First', parent_id: null },
      { id: 'b', exercise_name: 'Second', parent_id: null },
    ];
    const { rows } = buildSessionReorderRows(input);
    expect(rows.map((r) => r.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('expandClusterIds', () => {
  it('inserts each cluster child right after its parent in the output', () => {
    const childByParent = new Map<string, string>([['a', 'b'], ['p2', 'c2']]);
    const out = expandClusterIds(['c', 'a', 'p2'], childByParent);
    expect(out).toEqual(['c', 'a', 'b', 'p2', 'c2']);
  });

  it('leaves solo (no child) ids untouched', () => {
    const out = expandClusterIds(['x', 'y', 'z'], new Map());
    expect(out).toEqual(['x', 'y', 'z']);
  });

  it('handles empty input', () => {
    expect(expandClusterIds([], new Map())).toEqual([]);
  });
});
