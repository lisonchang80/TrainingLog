import {
  groupFallbackHighlight,
  resolveExerciseHighlight,
} from '../../src/domain/exercise/exerciseLibrary';
import type { ExerciseMuscleLink } from '../../src/domain/exercise/types';

/**
 * Detail-page body-diagram highlight resolution (2026-06-24 device fix):
 * curated v028 exercises carry only `muscle_group_id` with no fine
 * `exercise_muscle` links → the diagram must fall back to lighting the whole
 * group instead of rendering blank.
 */
const MUSCLES = [
  { id: 'm-upper-chest', mg_id: 'mg-chest' },
  { id: 'm-lower-chest', mg_id: 'mg-chest' },
  { id: 'm-quad', mg_id: 'mg-leg' },
  { id: 'm-hamstring', mg_id: 'mg-leg' },
];

describe('groupFallbackHighlight', () => {
  it('lights every muscle in the group as primary', () => {
    const h = groupFallbackHighlight('mg-chest', MUSCLES);
    expect([...h.entries()].sort()).toEqual([
      ['m-lower-chest', 'primary'],
      ['m-upper-chest', 'primary'],
    ]);
  });

  it('returns empty for a null/undefined group', () => {
    expect(groupFallbackHighlight(null, MUSCLES).size).toBe(0);
    expect(groupFallbackHighlight(undefined, MUSCLES).size).toBe(0);
  });

  it('ignores muscles in other groups', () => {
    const h = groupFallbackHighlight('mg-leg', MUSCLES);
    expect([...h.keys()].sort()).toEqual(['m-hamstring', 'm-quad']);
  });
});

describe('resolveExerciseHighlight', () => {
  const links: ExerciseMuscleLink[] = [
    { exercise_id: 'e1', muscle_id: 'm-lower-chest', role: 'primary' },
    { exercise_id: 'e1', muscle_id: 'm-upper-chest', role: 'secondary' },
  ];

  it('prefers precise per-muscle links when present (ignores group fallback)', () => {
    const h = resolveExerciseHighlight(links, 'mg-chest', MUSCLES);
    expect(h.get('m-lower-chest')).toBe('primary');
    expect(h.get('m-upper-chest')).toBe('secondary'); // role preserved, NOT overwritten by fallback
    expect(h.size).toBe(2);
  });

  it('falls back to the whole group when there are no links', () => {
    const h = resolveExerciseHighlight([], 'mg-leg', MUSCLES);
    expect([...h.keys()].sort()).toEqual(['m-hamstring', 'm-quad']);
    expect([...h.values()]).toEqual(['primary', 'primary']);
  });

  it('returns empty when there are neither links nor a known group', () => {
    expect(resolveExerciseHighlight([], null, MUSCLES).size).toBe(0);
  });
});
