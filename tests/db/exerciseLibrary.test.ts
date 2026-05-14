import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import {
  createCustomExercise,
  getExerciseMuscleLinks,
  getExerciseSessionCount,
  getExerciseSessionCounts,
  getExerciseWithMuscles,
  listExerciseMuscleLinks,
  listExercises,
  listExercisesWithLinks,
  listMuscleGroups,
  listMuscles,
} from '../../src/adapters/sqlite/exerciseLibraryRepository';
import { migrate } from '../../src/db/migrate';
import {
  EXERCISE_LIBRARY_SEEDS,
  MG_BACK,
  MG_CHEST,
  M_BACK,
  M_BICEP_LONG,
  M_LOWER_CHEST,
  M_TRICEP,
  M_UPPER_CHEST,
} from '../../src/db/seed/v006ExerciseLibrary';

let counter = 0;
const uuid = () => `cust-${counter++}`;

describe('exerciseLibraryRepository', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    counter = 0;
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it('migrate seeds 11 muscle groups + 19 muscles', async () => {
    const mgs = await listMuscleGroups(db);
    const muscles = await listMuscles(db);
    expect(mgs).toHaveLength(11);
    expect(muscles).toHaveLength(19);
  });

  it('migrate seeds the full exercise library', async () => {
    const exercises = await listExercises(db);
    expect(exercises.length).toBe(EXERCISE_LIBRARY_SEEDS.length);
  });

  it('every seeded exercise has muscle_group_id backfilled (incl. v001/v002 rows)', async () => {
    const exercises = await listExercises(db);
    for (const ex of exercises) {
      expect(ex.muscle_group_id).not.toBeNull();
    }
  });

  it('every seeded exercise has at least 1 primary muscle row', async () => {
    const links = await listExerciseMuscleLinks(db);
    const byExercise = new Map<string, number>();
    for (const l of links) {
      if (l.role === 'primary') {
        byExercise.set(l.exercise_id, (byExercise.get(l.exercise_id) ?? 0) + 1);
      }
    }
    const exercises = await listExercises(db);
    for (const ex of exercises) {
      expect(byExercise.get(ex.id) ?? 0).toBeGreaterThanOrEqual(1);
    }
  });

  it('listExercisesWithLinks returns same dataset as separate calls', async () => {
    const { exercises, links } = await listExercisesWithLinks(db);
    expect(exercises.length).toBe(EXERCISE_LIBRARY_SEEDS.length);
    expect(links.length).toBeGreaterThan(0);
  });

  it('getExerciseWithMuscles splits primary vs secondary', async () => {
    // Bench Press is exercise id #1 — primary: lower_chest, tricep, front_delt
    const benchPressId = '00000000-0000-4000-8000-000000000001';
    const got = await getExerciseWithMuscles(db, benchPressId);
    expect(got).not.toBeNull();
    expect(got!.exercise.name).toBe('Bench Press');
    const primaryIds = got!.primary.map((m) => m.id).sort();
    expect(primaryIds).toContain(M_LOWER_CHEST);
    expect(primaryIds).toContain(M_TRICEP);
    const secondaryIds = got!.secondary.map((m) => m.id).sort();
    expect(secondaryIds).toContain(M_UPPER_CHEST);
  });

  it('getExerciseWithMuscles returns null for unknown id', async () => {
    expect(await getExerciseWithMuscles(db, 'non-existent')).toBeNull();
  });

  it('createCustomExercise inserts row + links + flags is_custom=1', async () => {
    const id = await createCustomExercise(
      db,
      {
        name: '我的 Custom 推',
        load_type: 'loaded',
        muscle_group_id: MG_CHEST,
        equipment: '槓鈴',
        primaryMuscleIds: [M_UPPER_CHEST, M_TRICEP],
        secondaryMuscleIds: [M_LOWER_CHEST],
      },
      uuid
    );
    const got = await getExerciseWithMuscles(db, id);
    expect(got).not.toBeNull();
    expect(got!.exercise.name).toBe('我的 Custom 推');
    expect(got!.exercise.is_custom).toBe(1);
    expect(got!.exercise.is_builtin).toBe(0);
    expect(got!.primary.map((m) => m.id).sort()).toEqual([M_TRICEP, M_UPPER_CHEST].sort());
    expect(got!.secondary.map((m) => m.id)).toEqual([M_LOWER_CHEST]);
  });

  it('createCustomExercise allows null muscle_group_id (per ADR-0010 #9)', async () => {
    const id = await createCustomExercise(
      db,
      {
        name: '無 MG 自訂動作',
        load_type: 'bodyweight',
        muscle_group_id: null,
        equipment: '自重',
        primaryMuscleIds: [],
        secondaryMuscleIds: [],
      },
      uuid
    );
    const got = await getExerciseWithMuscles(db, id);
    expect(got!.exercise.muscle_group_id).toBeNull();
    expect(got!.primary).toEqual([]);
    expect(got!.secondary).toEqual([]);
  });

  it('createCustomExercise dedupes overlapping primary/secondary at insert', async () => {
    // Validation in domain layer rejects this, but defence in depth at SQL too.
    const id = await createCustomExercise(
      db,
      {
        name: '有重疊',
        load_type: 'loaded',
        muscle_group_id: MG_BACK,
        equipment: '其他',
        primaryMuscleIds: [M_BACK],
        secondaryMuscleIds: [M_BACK, M_BICEP_LONG],
      },
      uuid
    );
    const links = await getExerciseMuscleLinks(db, id);
    // M_BACK should appear exactly once with role=primary
    const backLinks = links.filter((l) => l.muscle_id === M_BACK);
    expect(backLinks).toHaveLength(1);
    expect(backLinks[0].role).toBe('primary');
    // M_BICEP_LONG remains as secondary
    const bicepLinks = links.filter((l) => l.muscle_id === M_BICEP_LONG);
    expect(bicepLinks).toHaveLength(1);
    expect(bicepLinks[0].role).toBe('secondary');
  });

  it('migrate is idempotent (running twice does not duplicate seeds)', async () => {
    await migrate(db);
    const exercises = await listExercises(db);
    const muscles = await listMuscles(db);
    const mgs = await listMuscleGroups(db);
    expect(exercises.length).toBe(EXERCISE_LIBRARY_SEEDS.length);
    expect(muscles).toHaveLength(19);
    expect(mgs).toHaveLength(11);
  });

  // ---------- ADR-0017 Q7「N 次」derived count ----------

  describe('getExerciseSessionCount / getExerciseSessionCounts (ADR-0017 Q7)', () => {
    const BENCH = '00000000-0000-4000-8000-000000000001';
    const ROW = '00000000-0000-4000-8000-000000000005';

    const insertSession = async (id: string, started_at: number) => {
      await db.runAsync(
        `INSERT INTO session (id, started_at, ended_at) VALUES (?, ?, ?)`,
        id,
        started_at,
        started_at + 1
      );
    };

    const insertSet = async (
      id: string,
      session_id: string,
      exercise_id: string,
      ordering: number,
      is_skipped: number
    ) => {
      await db.runAsync(
        `INSERT INTO "set" (id, session_id, exercise_id, weight_kg, reps, is_skipped, ordering, created_at)
         VALUES (?, ?, ?, 50, 5, ?, ?, ?)`,
        id,
        session_id,
        exercise_id,
        is_skipped,
        ordering,
        Date.now()
      );
    };

    it('returns 0 when exercise has never been done', async () => {
      expect(await getExerciseSessionCount(db, BENCH)).toBe(0);
    });

    it('counts distinct sessions with at least one done set', async () => {
      await insertSession('s1', 1000);
      await insertSession('s2', 2000);
      await insertSet('set-1', 's1', BENCH, 0, 0);
      await insertSet('set-2', 's1', BENCH, 1, 0); // 2 sets, same session → 1 session
      await insertSet('set-3', 's2', BENCH, 0, 0);
      expect(await getExerciseSessionCount(db, BENCH)).toBe(2);
    });

    it('ignores skipped sets — session with ONLY skipped sets does not count', async () => {
      await insertSession('s1', 1000);
      await insertSet('set-1', 's1', BENCH, 0, 1); // skipped
      expect(await getExerciseSessionCount(db, BENCH)).toBe(0);
    });

    it('counts session when at least one set is done and others skipped', async () => {
      await insertSession('s1', 1000);
      await insertSet('set-1', 's1', BENCH, 0, 1); // skipped
      await insertSet('set-2', 's1', BENCH, 1, 0); // done
      expect(await getExerciseSessionCount(db, BENCH)).toBe(1);
    });

    it('getExerciseSessionCounts returns map of all exercises with done sets', async () => {
      await insertSession('s1', 1000);
      await insertSession('s2', 2000);
      await insertSet('set-1', 's1', BENCH, 0, 0);
      await insertSet('set-2', 's1', ROW, 1, 0);
      await insertSet('set-3', 's2', BENCH, 0, 0);
      const counts = await getExerciseSessionCounts(db);
      expect(counts.get(BENCH)).toBe(2);
      expect(counts.get(ROW)).toBe(1);
      // exercises with no done sets are absent from the map (UI hides 0)
      expect(counts.has('00000000-0000-4000-8000-000000000099')).toBe(false);
    });

    it('getExerciseSessionCounts excludes exercises with only skipped sets', async () => {
      await insertSession('s1', 1000);
      await insertSet('set-1', 's1', BENCH, 0, 1);
      const counts = await getExerciseSessionCounts(db);
      expect(counts.has(BENCH)).toBe(false);
    });
  });
});
