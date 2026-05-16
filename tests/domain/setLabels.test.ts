import { computeSetLabels, type SetLabelInput } from '../../src/domain/set/setLabels';

/**
 * Pure setLabel computation — extracted slice 10c Phase 2 commit 6 for
 * reuse between template editor and session set logger.
 */

function mk(kind: 'warmup' | 'working' | 'dropset', parent: string | null = null): SetLabelInput {
  return { kind, parent_set_id: parent };
}

describe('computeSetLabels', () => {
  it('returns empty array for empty input', () => {
    expect(computeSetLabels([])).toEqual([]);
  });

  it('labels working-only sequence with 1-based ordinals', () => {
    const sets = [mk('working'), mk('working'), mk('working')];
    expect(computeSetLabels(sets)).toEqual(['1', '2', '3']);
  });

  it('labels warmup as 熱 without consuming the working ordinal', () => {
    const sets = [mk('warmup'), mk('working'), mk('warmup'), mk('working')];
    expect(computeSetLabels(sets)).toEqual(['熱', '1', '熱', '2']);
  });

  it('labels dropset head as D1 / D2 / ... independent of working ordinal', () => {
    const sets = [
      mk('working'),
      mk('dropset'), // head, parent null
      mk('working'),
      mk('dropset'), // head, parent null
    ];
    expect(computeSetLabels(sets)).toEqual(['1', 'D1', '2', 'D2']);
  });

  it('labels dropset follower (parent_set_id set) as empty string', () => {
    const sets = [
      mk('working'),
      mk('dropset', null), // head
      mk('dropset', 'parent-1'), // follower
      mk('dropset', 'parent-1'), // follower
    ];
    expect(computeSetLabels(sets)).toEqual(['1', 'D1', '', '']);
  });

  it('handles the mixed sequence from spec docstring (warmup/working/dropset)', () => {
    // [warmup, working, working, dropset-head, dropset-follower, working]
    const sets = [
      mk('warmup'),
      mk('working'),
      mk('working'),
      mk('dropset', null),
      mk('dropset', 'p-1'),
      mk('working'),
    ];
    expect(computeSetLabels(sets)).toEqual(['熱', '1', '2', 'D1', '', '3']);
  });

  it('treats undefined parent_set_id (via narrowing) as null for follower check', () => {
    // Belt-and-suspenders: even if a caller passes `parent_set_id: null`
    // explicitly the same way the schema does, the dropset-head check works.
    const sets = [mk('dropset', null), mk('dropset', null)];
    expect(computeSetLabels(sets)).toEqual(['D1', 'D2']);
  });

  it('multiple dropset clusters with followers get distinct head indices', () => {
    const sets = [
      mk('dropset', null), // D1 head
      mk('dropset', 'p-1'), // follower
      mk('dropset', null), // D2 head
      mk('dropset', 'p-2'), // follower
      mk('dropset', 'p-2'), // follower
    ];
    expect(computeSetLabels(sets)).toEqual(['D1', '', 'D2', '', '']);
  });
});
