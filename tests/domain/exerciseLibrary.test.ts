import {
  filterExercises,
  inferLoadType,
  muscleHighlightMap,
  validateCustomExerciseDraft,
} from '../../src/domain/exercise/exerciseLibrary';
import type {
  Exercise,
  ExerciseMuscleLink,
} from '../../src/domain/exercise/types';
import {
  EXERCISE_LIBRARY_SEEDS,
  MUSCLE_GROUP_SEEDS,
  MUSCLE_SEEDS,
  M_BACK,
  M_BICEP_LONG,
  M_BICEP_SHORT,
  M_LOWER_CHEST,
  M_QUAD,
  M_TRICEP,
  M_UPPER_CHEST,
  MG_BACK,
  MG_CHEST,
  MG_LEG,
} from '../../src/db/seed/v006ExerciseLibrary';

const buildExercise = (over: Partial<Exercise> = {}): Exercise => ({
  id: over.id ?? 'ex-test',
  name: 'Test',
  load_type: 'loaded',
  is_builtin: 1,
  is_archived: 0,
  muscle_group_id: MG_CHEST,
  is_custom: 0,
  equipment: '其他',
  notes: null,
  media_path: null,
  cues_text: null,
  ...over,
});

describe('exerciseLibrary — filterExercises', () => {
  const exercises: Exercise[] = [
    buildExercise({ id: 'e1', name: 'Bench Press', muscle_group_id: MG_CHEST, load_type: 'loaded' }),
    buildExercise({ id: 'e2', name: 'Push-up', muscle_group_id: MG_CHEST, load_type: 'bodyweight' }),
    buildExercise({ id: 'e3', name: 'Pull-up', muscle_group_id: MG_BACK, load_type: 'bodyweight' }),
    buildExercise({ id: 'e4', name: 'Back Squat', muscle_group_id: MG_LEG, load_type: 'loaded' }),
    buildExercise({ id: 'e5', name: 'Old Move', muscle_group_id: MG_LEG, load_type: 'loaded', is_archived: 1 }),
    buildExercise({ id: 'e6', name: 'Assisted Pull-up', muscle_group_id: MG_BACK, load_type: 'assisted' }),
  ];

  const links: ExerciseMuscleLink[] = [
    { exercise_id: 'e1', muscle_id: M_LOWER_CHEST, role: 'primary' },
    { exercise_id: 'e1', muscle_id: M_TRICEP, role: 'primary' },
    { exercise_id: 'e2', muscle_id: M_LOWER_CHEST, role: 'primary' },
    { exercise_id: 'e3', muscle_id: M_BACK, role: 'primary' },
    { exercise_id: 'e3', muscle_id: M_BICEP_LONG, role: 'primary' },
    { exercise_id: 'e4', muscle_id: M_QUAD, role: 'primary' },
    { exercise_id: 'e6', muscle_id: M_BACK, role: 'primary' },
  ];

  it('returns all non-archived exercises with empty filter', () => {
    const got = filterExercises(exercises, links, {});
    expect(got.map((e) => e.id).sort()).toEqual(['e1', 'e2', 'e3', 'e4', 'e6']);
  });

  it('filters by muscle group', () => {
    const got = filterExercises(exercises, links, { muscleGroupId: MG_CHEST });
    expect(got.map((e) => e.id).sort()).toEqual(['e1', 'e2']);
  });

  it('filters by load_type=bodyweight', () => {
    const got = filterExercises(exercises, links, { loadType: 'bodyweight' });
    expect(got.map((e) => e.id).sort()).toEqual(['e2', 'e3']);
  });

  it('filters by load_type=assisted', () => {
    const got = filterExercises(exercises, links, { loadType: 'assisted' });
    expect(got.map((e) => e.id)).toEqual(['e6']);
  });

  it('filters by equipment (ADR-0017 Q6)', () => {
    const withEquipment: Exercise[] = [
      buildExercise({ id: 'e10', name: 'Barbell Row', equipment: '槓鈴' }),
      buildExercise({ id: 'e11', name: 'Dumbbell Row', equipment: '啞鈴' }),
      buildExercise({ id: 'e12', name: 'Cable Row', equipment: '滑輪' }),
    ];
    const got = filterExercises(withEquipment, [], { equipment: '槓鈴' });
    expect(got.map((e) => e.id)).toEqual(['e10']);
  });

  it('filters by muscle (any role)', () => {
    const got = filterExercises(exercises, links, { muscleId: M_BACK });
    expect(got.map((e) => e.id).sort()).toEqual(['e3', 'e6']);
  });

  it('combines MG + load_type filters', () => {
    const got = filterExercises(exercises, links, { muscleGroupId: MG_BACK, loadType: 'assisted' });
    expect(got.map((e) => e.id)).toEqual(['e6']);
  });

  it('case-insensitive name search', () => {
    const got = filterExercises(exercises, links, { search: 'PRESS' });
    expect(got.map((e) => e.id)).toEqual(['e1']);
  });

  it('search matches the LOCALIZED display name, not just the canonical name', () => {
    // Repro: canonical name is English ("Bench Press") but the card renders
    // 中文 via tExercise → a Chinese search must still find it.
    const localize = (name: string) =>
      name === 'Bench Press' ? '槓鈴臥推' : name;
    const got = filterExercises(exercises, links, { search: '槓', localize });
    expect(got.map((e) => e.id)).toEqual(['e1']);
  });

  it('without localize, a Chinese search misses an English-named row (baseline)', () => {
    const got = filterExercises(exercises, links, { search: '槓' });
    expect(got).toEqual([]);
  });

  it('localize search still matches the canonical name too', () => {
    // A row already stored in 中文 stays findable; localize only ADDS a match.
    const localize = (name: string) => name; // identity
    const got = filterExercises(exercises, links, { search: 'bench', localize });
    expect(got.map((e) => e.id)).toEqual(['e1']);
  });

  it('excludes archived by default', () => {
    expect(filterExercises(exercises, links, {}).map((e) => e.id)).not.toContain('e5');
  });

  it('opt-in to include archived', () => {
    const got = filterExercises(exercises, links, { excludeArchived: false });
    expect(got.map((e) => e.id).sort()).toEqual(['e1', 'e2', 'e3', 'e4', 'e5', 'e6']);
  });
});

describe('exerciseLibrary — validateCustomExerciseDraft', () => {
  const baseDraft = {
    name: '我的自訂動作',
    muscle_group_id: MG_CHEST,
    equipment: '槓鈴' as const,
    primaryMuscleIds: [M_UPPER_CHEST],
    secondaryMuscleIds: [M_TRICEP],
  };

  it('passes a clean draft', () => {
    expect(validateCustomExerciseDraft(baseDraft)).toEqual([]);
  });

  it('rejects empty name', () => {
    const errs = validateCustomExerciseDraft({ ...baseDraft, name: '   ' });
    expect(errs.some((e) => e.field === 'name')).toBe(true);
  });

  it('rejects name > 60 chars', () => {
    const errs = validateCustomExerciseDraft({ ...baseDraft, name: 'a'.repeat(61) });
    expect(errs.some((e) => e.field === 'name')).toBe(true);
  });

  it('rejects null/empty muscle_group_id (Slice 9.7 ADR-0017 Q11 amendment — 大分類必填)', () => {
    const errsEmpty = validateCustomExerciseDraft({
      ...baseDraft,
      muscle_group_id: '',
    });
    expect(errsEmpty.some((e) => e.field === 'muscle_group_id')).toBe(true);

    const errsNull = validateCustomExerciseDraft({
      ...baseDraft,
      // @ts-expect-error — null forbidden by type, but validator must still catch it
      muscle_group_id: null,
    });
    expect(errsNull.some((e) => e.field === 'muscle_group_id')).toBe(true);
  });

  it('rejects muscle in both primary AND secondary', () => {
    const errs = validateCustomExerciseDraft({
      ...baseDraft,
      primaryMuscleIds: [M_UPPER_CHEST],
      secondaryMuscleIds: [M_UPPER_CHEST],
    });
    expect(errs.some((e) => e.field === 'general')).toBe(true);
  });

  it('allows empty primary/secondary lists (per ADR-0010 #9)', () => {
    expect(
      validateCustomExerciseDraft({
        ...baseDraft,
        primaryMuscleIds: [],
        secondaryMuscleIds: [],
      })
    ).toEqual([]);
  });

  it('rejects invalid equipment (ADR-0017 Q6)', () => {
    const errs = validateCustomExerciseDraft({
      ...baseDraft,
      // @ts-expect-error — deliberately bogus to exercise the validator
      equipment: '不存在的器械',
    });
    expect(errs.some((e) => e.field === 'equipment')).toBe(true);
  });

  it('accepts every Equipment enum value', () => {
    const allEq = ['槓鈴', '啞鈴', '史密斯機', '滑輪', '固定機械', '自重', '壺鈴', '其他'] as const;
    for (const eq of allEq) {
      expect(validateCustomExerciseDraft({ ...baseDraft, equipment: eq })).toEqual([]);
    }
  });

  describe('existingNames option (no-dup rule)', () => {
    it('rejects exact-match name', () => {
      const errs = validateCustomExerciseDraft(
        { ...baseDraft, name: 'Bench Press' },
        { existingNames: ['Bench Press', 'Pull-up'] }
      );
      expect(errs.some((e) => e.field === 'name' && e.message.includes('同名'))).toBe(true);
    });

    it('rejects case-insensitive match', () => {
      const errs = validateCustomExerciseDraft(
        { ...baseDraft, name: 'BENCH PRESS' },
        { existingNames: ['bench press'] }
      );
      expect(errs.some((e) => e.field === 'name')).toBe(true);
    });

    it('rejects after trim — leading/trailing space ignored on both sides', () => {
      const errs = validateCustomExerciseDraft(
        { ...baseDraft, name: '  Squat  ' },
        { existingNames: ['Squat'] }
      );
      expect(errs.some((e) => e.field === 'name')).toBe(true);
    });

    it('accepts a unique name', () => {
      expect(
        validateCustomExerciseDraft(
          { ...baseDraft, name: '我的新動作' },
          { existingNames: ['Bench Press', 'Pull-up'] }
        )
      ).toEqual([]);
    });

    it('accepts Set as existingNames', () => {
      const errs = validateCustomExerciseDraft(
        { ...baseDraft, name: 'Bench Press' },
        { existingNames: new Set(['Bench Press']) }
      );
      expect(errs.some((e) => e.field === 'name')).toBe(true);
    });

    it('does nothing when existingNames not provided (backwards-compat)', () => {
      expect(validateCustomExerciseDraft({ ...baseDraft, name: 'Anything' })).toEqual([]);
    });

    it('does not report dup error when name is already empty (avoid noise)', () => {
      const errs = validateCustomExerciseDraft(
        { ...baseDraft, name: '   ' },
        { existingNames: ['something'] }
      );
      // Empty-name error fires; duplicate check is skipped (else-if chain)
      const nameErrs = errs.filter((e) => e.field === 'name');
      expect(nameErrs).toHaveLength(1);
      expect(nameErrs[0].message).toBe('請輸入動作名稱');
    });
  });
});

describe('exerciseLibrary — inferLoadType (Slice 9.7 ADR-0017 Q11 amendment)', () => {
  it("'自重' equipment → 'bodyweight' load_type", () => {
    expect(inferLoadType('自重')).toBe('bodyweight');
  });

  it("every other equipment → 'loaded' load_type", () => {
    const loadedEquipments = ['槓鈴', '啞鈴', '史密斯機', '滑輪', '固定機械', '壺鈴', '其他'] as const;
    for (const eq of loadedEquipments) {
      expect(inferLoadType(eq)).toBe('loaded');
    }
  });
});

describe('exerciseLibrary — muscleHighlightMap', () => {
  it('emits role per muscle for body-diagram fill', () => {
    const links: ExerciseMuscleLink[] = [
      { exercise_id: 'e1', muscle_id: 'a', role: 'primary' },
      { exercise_id: 'e1', muscle_id: 'b', role: 'secondary' },
    ];
    const m = muscleHighlightMap(links);
    expect(m.get('a')).toBe('primary');
    expect(m.get('b')).toBe('secondary');
    expect(m.get('c')).toBeUndefined();
  });

  it('keeps primary when same muscle appears as both (defence in depth)', () => {
    const m = muscleHighlightMap([
      { exercise_id: 'e', muscle_id: 'a', role: 'secondary' },
      { exercise_id: 'e', muscle_id: 'a', role: 'primary' },
    ]);
    expect(m.get('a')).toBe('primary');
  });

  it('does NOT downgrade primary→secondary when primary is seen first (line 200 continue)', () => {
    // Reversed order from the test above: primary lands first, so the later
    // duplicate secondary must hit the `existing === 'primary'` early-continue
    // rather than overwriting. Guards against a malformed custom-exercise link
    // list silently dimming a primary mover on the body diagram.
    const m = muscleHighlightMap([
      { exercise_id: 'e', muscle_id: 'a', role: 'primary' },
      { exercise_id: 'e', muscle_id: 'a', role: 'secondary' },
    ]);
    expect(m.get('a')).toBe('primary');
  });
});

// ---------- ADR-0010 acceptance criteria checks against the seed dataset ----------

describe('v006 seed — ADR-0010 acceptance', () => {
  it('seeds 11 muscle_group', () => {
    expect(MUSCLE_GROUP_SEEDS).toHaveLength(11);
  });

  it('seeds 19 anatomical muscles', () => {
    expect(MUSCLE_SEEDS).toHaveLength(19);
  });

  it('every muscle belongs to one of the 11 muscle groups', () => {
    const mgIds = new Set(MUSCLE_GROUP_SEEDS.map((m) => m.id));
    for (const m of MUSCLE_SEEDS) {
      expect(mgIds.has(m.mg_id)).toBe(true);
    }
  });

  it('every muscle group has at least one muscle', () => {
    const usedMg = new Set(MUSCLE_SEEDS.map((m) => m.mg_id));
    for (const mg of MUSCLE_GROUP_SEEDS) {
      expect(usedMg.has(mg.id)).toBe(true);
    }
  });

  it('seeds 60-80 built-in exercises', () => {
    expect(EXERCISE_LIBRARY_SEEDS.length).toBeGreaterThanOrEqual(60);
    expect(EXERCISE_LIBRARY_SEEDS.length).toBeLessThanOrEqual(80);
  });

  it('every exercise has at least 1 primary muscle', () => {
    for (const ex of EXERCISE_LIBRARY_SEEDS) {
      expect(ex.primary.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('every exercise primary + secondary muscle ids reference real muscles', () => {
    const muscleIds = new Set(MUSCLE_SEEDS.map((m) => m.id));
    for (const ex of EXERCISE_LIBRARY_SEEDS) {
      for (const mid of [...ex.primary, ...ex.secondary]) {
        expect(muscleIds.has(mid)).toBe(true);
      }
    }
  });

  it('no exercise has a muscle in both primary and secondary', () => {
    for (const ex of EXERCISE_LIBRARY_SEEDS) {
      const ps = new Set(ex.primary);
      const overlap = ex.secondary.filter((m) => ps.has(m));
      expect(overlap).toEqual([]);
    }
  });

  it('every exercise references a real muscle_group_id', () => {
    const mgIds = new Set(MUSCLE_GROUP_SEEDS.map((mg) => mg.id));
    for (const ex of EXERCISE_LIBRARY_SEEDS) {
      expect(mgIds.has(ex.muscle_group_id)).toBe(true);
    }
  });

  it('seed covers all 3 load_types', () => {
    const types = new Set(EXERCISE_LIBRARY_SEEDS.map((e) => e.load_type));
    expect(types.has('loaded')).toBe(true);
    expect(types.has('bodyweight')).toBe(true);
    expect(types.has('assisted')).toBe(true);
  });

  it('exercise ids are unique', () => {
    const ids = EXERCISE_LIBRARY_SEEDS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps existing v001/v002 IDs (1-7) for migration backfill compatibility', () => {
    const ids = new Set(EXERCISE_LIBRARY_SEEDS.map((e) => e.id));
    for (let n = 1; n <= 7; n++) {
      const expected = `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
      expect(ids.has(expected)).toBe(true);
    }
  });
});
