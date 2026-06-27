/**
 * `filterExercises` edge coverage — the library-browse filter pure logic
 * (src/domain/exercise/exerciseLibrary.ts).
 *
 * The shipped `tests/domain/exerciseLibrary.test.ts` covers the happy paths
 * (MG / load_type / equipment / search / archived). These pin the contract
 * corners it leaves open, each a real browse-screen behaviour:
 *
 *   - the muscleId filter matches ANY role (the docblock's promise) — every
 *     shipped fixture link is `primary`, so the SECONDARY-match path is
 *     untested.
 *   - whitespace-only search is a no-op (source `.trim()`s first).
 *   - a search that matches nothing returns [].
 *   - muscleId × archived interplay (an archived exercise that activates the
 *     muscle surfaces only when excludeArchived is off).
 *   - stacking every filter at once.
 */

import { filterExercises } from '../../src/domain/exercise/exerciseLibrary';
import type { Exercise, ExerciseMuscleLink } from '../../src/domain/exercise/types';

function ex(o: Partial<Exercise> & { id: string; name: string }): Exercise {
  return {
    load_type: 'loaded',
    is_builtin: 1,
    is_archived: 0,
    muscle_group_id: 'mg-chest',
    is_custom: 0,
    equipment: '其他',
    notes: null,
    media_path: null,
    cues_text: null,
    ...o,
  };
}

describe('filterExercises — muscleId matches ANY role (primary + secondary)', () => {
  // e-sec activates m-tricep ONLY as a secondary mover. The "any role"
  // contract means a m-tricep filter must still return it.
  const exercises: Exercise[] = [
    ex({ id: 'e-pri', name: 'Pressdown', muscle_group_id: 'mg-tricep' }),
    ex({ id: 'e-sec', name: 'Bench Press', muscle_group_id: 'mg-chest' }),
    ex({ id: 'e-none', name: 'Leg Curl', muscle_group_id: 'mg-leg' }),
  ];
  const links: ExerciseMuscleLink[] = [
    { exercise_id: 'e-pri', muscle_id: 'm-tricep', role: 'primary' },
    { exercise_id: 'e-sec', muscle_id: 'm-lower-chest', role: 'primary' },
    { exercise_id: 'e-sec', muscle_id: 'm-tricep', role: 'secondary' }, // secondary activation
    { exercise_id: 'e-none', muscle_id: 'm-hamstring', role: 'primary' },
  ];

  it('returns an exercise whose ONLY m-tricep link is secondary', () => {
    const got = filterExercises(exercises, links, { muscleId: 'm-tricep' });
    // Both the primary-mover and the secondary-activator pass; the leg move does not.
    expect(got.map((e) => e.id).sort()).toEqual(['e-pri', 'e-sec']);
  });

  it('returns [] for a muscle no exercise activates in any role', () => {
    expect(filterExercises(exercises, links, { muscleId: 'm-calf' })).toEqual([]);
  });
});

describe('filterExercises — search normalisation', () => {
  const exercises: Exercise[] = [
    ex({ id: 'e1', name: 'Bench Press' }),
    ex({ id: 'e2', name: 'Push-up' }),
  ];

  it('whitespace-only search is a no-op (trimmed away) → returns all', () => {
    // Source does `search?.trim()...`; '   ' trims to '' which is falsy, so
    // the search clause is skipped rather than matching nothing.
    expect(filterExercises(exercises, [], { search: '   ' }).map((e) => e.id).sort()).toEqual([
      'e1',
      'e2',
    ]);
  });

  it('a search matching no name returns []', () => {
    expect(filterExercises(exercises, [], { search: 'zzz-nope' })).toEqual([]);
  });

  it('search trims surrounding whitespace before substring matching', () => {
    // '  bench ' → 'bench' matches "Bench Press".
    expect(filterExercises(exercises, [], { search: '  bench ' }).map((e) => e.id)).toEqual(['e1']);
  });

  it('null search is treated as no filter', () => {
    expect(filterExercises(exercises, [], { search: null }).map((e) => e.id).sort()).toEqual([
      'e1',
      'e2',
    ]);
  });
});

describe('filterExercises — muscleId × archived interplay', () => {
  const exercises: Exercise[] = [
    ex({ id: 'e-active', name: 'Active Move', muscle_group_id: 'mg-leg' }),
    ex({ id: 'e-arch', name: 'Archived Move', muscle_group_id: 'mg-leg', is_archived: 1 }),
  ];
  const links: ExerciseMuscleLink[] = [
    { exercise_id: 'e-active', muscle_id: 'm-quad', role: 'primary' },
    { exercise_id: 'e-arch', muscle_id: 'm-quad', role: 'primary' },
  ];

  it('an archived exercise activating the muscle is hidden by default', () => {
    const got = filterExercises(exercises, links, { muscleId: 'm-quad' });
    expect(got.map((e) => e.id)).toEqual(['e-active']);
  });

  it('the archived activator surfaces only when excludeArchived is off', () => {
    const got = filterExercises(exercises, links, {
      muscleId: 'm-quad',
      excludeArchived: false,
    });
    expect(got.map((e) => e.id).sort()).toEqual(['e-active', 'e-arch']);
  });
});

describe('filterExercises — all filters stacked', () => {
  it('MG + muscleId + loadType + equipment + search all narrow to one row', () => {
    const exercises: Exercise[] = [
      ex({ id: 'hit', name: 'Incline Barbell Press', muscle_group_id: 'mg-chest', load_type: 'loaded', equipment: '槓鈴' }),
      ex({ id: 'wrong-mg', name: 'Incline Barbell Press', muscle_group_id: 'mg-back', load_type: 'loaded', equipment: '槓鈴' }),
      ex({ id: 'wrong-eq', name: 'Incline Barbell Press', muscle_group_id: 'mg-chest', load_type: 'loaded', equipment: '啞鈴' }),
      ex({ id: 'wrong-name', name: 'Flat Bench', muscle_group_id: 'mg-chest', load_type: 'loaded', equipment: '槓鈴' }),
      ex({ id: 'wrong-load', name: 'Incline Barbell Press', muscle_group_id: 'mg-chest', load_type: 'bodyweight', equipment: '槓鈴' }),
    ];
    const links: ExerciseMuscleLink[] = [
      { exercise_id: 'hit', muscle_id: 'm-upper-chest', role: 'primary' },
      { exercise_id: 'wrong-mg', muscle_id: 'm-upper-chest', role: 'primary' },
      { exercise_id: 'wrong-eq', muscle_id: 'm-upper-chest', role: 'primary' },
      { exercise_id: 'wrong-name', muscle_id: 'm-upper-chest', role: 'primary' },
      { exercise_id: 'wrong-load', muscle_id: 'm-upper-chest', role: 'primary' },
      // a row that matches everything EXCEPT the muscleId:
    ];
    const got = filterExercises(exercises, links, {
      muscleGroupId: 'mg-chest',
      muscleId: 'm-upper-chest',
      loadType: 'loaded',
      equipment: '槓鈴',
      search: 'incline',
    });
    expect(got.map((e) => e.id)).toEqual(['hit']);
  });
});
