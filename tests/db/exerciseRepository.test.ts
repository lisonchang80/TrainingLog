/**
 * Exercise CRUD edge coverage.
 *
 * Two adapters cover the 動作 surface:
 *   - exerciseRepository       → listExercises (is_archived filter) + getExerciseName
 *   - exerciseLibraryRepository → createCustomExercise / updateCustomExercise /
 *     archiveCustomExercise / getExerciseWithMuscles (the built-in name/edit lock,
 *     load_type CHECK enum, archive filter)
 *
 * Both were reached only INDIRECTLY before this file (templateConvertFromSession,
 * exerciseName). These tests pin the edges:
 *   - built-in name (and all fields) immutable via is_custom=1 guard
 *   - custom rename works
 *   - load_type CHECK-enum rejection (v001 CHECK survives the v010 ADD COLUMN)
 *   - is_archived excluded from listExercises but still resolvable by id
 *
 * NOTE on task-brief drift: the brief mentioned a `short_name` column. There is
 * NO `short_name` column anywhere in src/ or the schema migrations (≤ v024), so
 * that case is not testable here. The `equipment` CHECK enum DOES exist — v010
 * adds `equipment TEXT NOT NULL DEFAULT '其他' CHECK (equipment IN (8 values))`,
 * and SQLite enforces an ADD COLUMN CHECK on every subsequent INSERT, so this
 * file covers it. Tests assert what the code/schema actually do.
 *
 * Overnight 2026-05-30 — agent C (DB/domain edge tests).
 */

import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  listExercises as listExercisesLegacy,
  getExerciseName,
} from '../../src/adapters/sqlite/exerciseRepository';
import {
  createCustomExercise,
  updateCustomExercise,
  archiveCustomExercise,
  getExerciseWithMuscles,
  listExercises,
} from '../../src/adapters/sqlite/exerciseLibraryRepository';
import { MG_CHEST, MG_BACK } from '../../src/db/seed/v006ExerciseLibrary';

const BENCH_PRESS_ID = '00000000-0000-4000-8000-000000000001';

describe('exercise CRUD edges (exerciseRepository + exerciseLibraryRepository)', () => {
  let db: BetterSqliteDatabase;
  let counter = 0;
  const uuid = () => `cust-${counter++}`;

  beforeEach(async () => {
    counter = 0;
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  // --- built-in immutability (is_custom = 1 guard) ----------------------

  it('built-in exercise name (and all fields) are locked — updateCustomExercise is a no-op', async () => {
    const before = await getExerciseWithMuscles(db, BENCH_PRESS_ID);
    expect(before!.exercise.name).toBe('Bench Press');
    expect(before!.exercise.is_builtin).toBe(1);

    await updateCustomExercise(db, BENCH_PRESS_ID, {
      name: 'Renamed Bench',
      muscle_group_id: MG_BACK,
      equipment: '自重',
      primaryMuscleIds: [],
      secondaryMuscleIds: [],
    });

    const after = await getExerciseWithMuscles(db, BENCH_PRESS_ID);
    // The UPDATE has `WHERE id = ? AND is_custom = 1`, so the built-in row's
    // own columns are untouched (name stays locked).
    expect(after!.exercise.name).toBe('Bench Press');
    expect(after!.exercise.is_builtin).toBe(1);
  });

  it('archiveCustomExercise refuses to archive a built-in (is_custom=1 guard)', async () => {
    await archiveCustomExercise(db, BENCH_PRESS_ID);
    const got = await getExerciseWithMuscles(db, BENCH_PRESS_ID);
    expect(got!.exercise.is_archived).toBe(0);
  });

  // --- custom rename ----------------------------------------------------

  it('custom exercise CAN be renamed via updateCustomExercise', async () => {
    const id = await createCustomExercise(
      db,
      {
        name: 'My Curl',
        muscle_group_id: MG_CHEST,
        equipment: '啞鈴',
        primaryMuscleIds: [],
        secondaryMuscleIds: [],
      },
      uuid
    );

    await updateCustomExercise(db, id, {
      name: 'My Hammer Curl',
      muscle_group_id: MG_CHEST,
      equipment: '啞鈴',
      primaryMuscleIds: [],
      secondaryMuscleIds: [],
    });

    const got = await getExerciseWithMuscles(db, id);
    expect(got!.exercise.name).toBe('My Hammer Curl');
    expect(got!.exercise.is_builtin).toBe(0);
    expect(got!.exercise.is_custom).toBe(1);
  });

  it('createCustomExercise trims the name before insert', async () => {
    const id = await createCustomExercise(
      db,
      {
        name: '  Spaced Lift  ',
        muscle_group_id: MG_CHEST,
        equipment: '其他',
        primaryMuscleIds: [],
        secondaryMuscleIds: [],
      },
      uuid
    );
    const got = await getExerciseWithMuscles(db, id);
    expect(got!.exercise.name).toBe('Spaced Lift');
  });

  // --- equipment → load_type inference ---------------------------------

  it('equipment 自重 infers load_type bodyweight; everything else infers loaded', async () => {
    const bw = await createCustomExercise(
      db,
      {
        name: 'BW Lift',
        muscle_group_id: MG_CHEST,
        equipment: '自重',
        primaryMuscleIds: [],
        secondaryMuscleIds: [],
      },
      uuid
    );
    const loaded = await createCustomExercise(
      db,
      {
        name: 'Barbell Lift',
        muscle_group_id: MG_CHEST,
        equipment: '槓鈴',
        primaryMuscleIds: [],
        secondaryMuscleIds: [],
      },
      uuid
    );
    expect((await getExerciseWithMuscles(db, bw))!.exercise.load_type).toBe('bodyweight');
    expect((await getExerciseWithMuscles(db, loaded))!.exercise.load_type).toBe('loaded');
  });

  it('switching a custom exercise to 自重 re-derives load_type to bodyweight', async () => {
    const id = await createCustomExercise(
      db,
      {
        name: 'Switcher',
        muscle_group_id: MG_CHEST,
        equipment: '槓鈴', // → loaded
        primaryMuscleIds: [],
        secondaryMuscleIds: [],
      },
      uuid
    );
    expect((await getExerciseWithMuscles(db, id))!.exercise.load_type).toBe('loaded');

    await updateCustomExercise(db, id, {
      name: 'Switcher',
      muscle_group_id: MG_CHEST,
      equipment: '自重', // → bodyweight
      primaryMuscleIds: [],
      secondaryMuscleIds: [],
    });
    expect((await getExerciseWithMuscles(db, id))!.exercise.load_type).toBe('bodyweight');
  });

  // --- load_type CHECK enum --------------------------------------------

  it('rejects an out-of-vocab load_type at the v001 CHECK boundary', async () => {
    // The v001 CHECK(load_type IN ('loaded','bodyweight','assisted')) survives
    // the v010 ADD COLUMN (no table rebuild). A raw INSERT with a bad value
    // must be rejected by SQLite.
    await expect(
      db.runAsync(
        `INSERT INTO exercise (id, name, load_type, is_builtin, is_archived,
                               muscle_group_id, is_custom, equipment)
         VALUES (?, ?, 'sledgehammer', 0, 0, NULL, 1, '其他')`,
        'bad-lt',
        'Bad Load Type'
      )
    ).rejects.toThrow(/CHECK constraint/i);
  });

  it('accepts every load_type inside the CHECK vocabulary', async () => {
    for (const lt of ['loaded', 'bodyweight', 'assisted'] as const) {
      await db.runAsync(
        `INSERT INTO exercise (id, name, load_type, is_builtin, is_archived,
                               muscle_group_id, is_custom, equipment)
         VALUES (?, ?, ?, 0, 0, NULL, 1, '其他')`,
        `lt-${lt}`,
        `Ex ${lt}`,
        lt
      );
    }
    const ids = (await listExercises(db)).map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining(['lt-loaded', 'lt-bodyweight', 'lt-assisted']));
  });

  // The v010 ADD COLUMN equipment carries a CHECK(equipment IN (8 values)).
  // SQLite enforces a column-CHECK added via ALTER TABLE ADD COLUMN on every
  // new INSERT, so an out-of-vocab equipment string IS rejected at the SQL
  // boundary (confirmed: 'rope' → CHECK constraint failed).
  it('rejects an out-of-vocab equipment at the v010 CHECK boundary', async () => {
    await expect(
      db.runAsync(
        `INSERT INTO exercise (id, name, load_type, is_builtin, is_archived,
                               muscle_group_id, is_custom, equipment)
         VALUES (?, ?, 'loaded', 0, 0, NULL, 1, 'rope')`,
        'bad-eq',
        'Bad Equipment'
      )
    ).rejects.toThrow(/CHECK constraint/i);
  });

  it('accepts an in-vocab equipment value at the SQL boundary', async () => {
    await db.runAsync(
      `INSERT INTO exercise (id, name, load_type, is_builtin, is_archived,
                             muscle_group_id, is_custom, equipment)
       VALUES (?, ?, 'loaded', 0, 0, NULL, 1, '壺鈴')`,
      'ok-eq',
      'OK Equipment'
    );
    const got = await getExerciseWithMuscles(db, 'ok-eq');
    expect(got!.exercise.equipment).toBe('壺鈴');
  });

  // --- is_archived filter ----------------------------------------------

  it('listExercises excludes archived rows but getExerciseWithMuscles still resolves them', async () => {
    const id = await createCustomExercise(
      db,
      {
        name: 'Soon Archived',
        muscle_group_id: MG_CHEST,
        equipment: '槓鈴',
        primaryMuscleIds: [],
        secondaryMuscleIds: [],
      },
      uuid
    );
    expect((await listExercises(db)).some((e) => e.id === id)).toBe(true);

    await archiveCustomExercise(db, id);

    expect((await listExercises(db)).some((e) => e.id === id)).toBe(false);
    // still resolvable by id (history needs an archived partner)
    const got = await getExerciseWithMuscles(db, id);
    expect(got!.exercise.name).toBe('Soon Archived');
    expect(got!.exercise.is_archived).toBe(1);
  });

  it('legacy listExercises (exerciseRepository) also honours the is_archived filter', async () => {
    const id = await createCustomExercise(
      db,
      {
        name: 'Legacy Archived',
        muscle_group_id: MG_CHEST,
        equipment: '其他',
        primaryMuscleIds: [],
        secondaryMuscleIds: [],
      },
      uuid
    );
    await archiveCustomExercise(db, id);
    const ids = (await listExercisesLegacy(db)).map((e) => e.id);
    expect(ids).not.toContain(id);
  });

  it('listExercises returns rows ordered by name ASC', async () => {
    await createCustomExercise(
      db,
      { name: 'zzz Last', muscle_group_id: MG_CHEST, equipment: '其他', primaryMuscleIds: [], secondaryMuscleIds: [] },
      uuid
    );
    await createCustomExercise(
      db,
      { name: 'aaa First', muscle_group_id: MG_CHEST, equipment: '其他', primaryMuscleIds: [], secondaryMuscleIds: [] },
      uuid
    );
    const names = (await listExercises(db)).map((e) => e.name);
    const sorted = [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(names).toEqual(sorted);
  });

  // --- getExerciseName lookup ------------------------------------------

  it('getExerciseName resolves a built-in by id and null for a missing id', async () => {
    expect(await getExerciseName(db, BENCH_PRESS_ID)).toBe('Bench Press');
    expect(await getExerciseName(db, 'no-such-id')).toBeNull();
  });

  it('getExerciseName resolves an ARCHIVED exercise (no archive filter on the lookup)', async () => {
    const id = await createCustomExercise(
      db,
      { name: 'Archived Partner', muscle_group_id: MG_CHEST, equipment: '其他', primaryMuscleIds: [], secondaryMuscleIds: [] },
      uuid
    );
    await archiveCustomExercise(db, id);
    // getExerciseName deliberately has NO is_archived filter (cluster switcher
    // needs a since-archived partner to still resolve).
    expect(await getExerciseName(db, id)).toBe('Archived Partner');
  });
});
