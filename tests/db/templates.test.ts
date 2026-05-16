import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { listExercises } from '../../src/adapters/sqlite/exerciseRepository';
import {
  addTemplateExercise,
  createTemplate,
  deleteTemplate,
  getTemplate,
  listTemplates,
  listTemplateExerciseRows,
  removeTemplateExercise,
  updateTemplateName,
} from '../../src/adapters/sqlite/templateRepository';
import { startSessionFromTemplate } from '../../src/adapters/sqlite/sessionFromTemplate';
import {
  endSession,
  getSession,
  listSessionExercisesWithName,
} from '../../src/adapters/sqlite/sessionRepository';

/**
 * Acceptance tests for slice 3 (Template + snapshot isolation).
 *
 * Same architecture as slice 1/2: better-sqlite3 :memory: behind the
 * `Database` interface so these run as pure node jest cases.
 */
describe('Template + snapshot isolation (slice 3)', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it('migration v003 creates the three template tables (Exercise Library seeded by v001/v002/v006)', async () => {
    const exercises = await listExercises(db);
    expect(exercises).toHaveLength(66);
    // Tables exist if these queries don't throw.
    expect(await listTemplates(db)).toEqual([]);
  });

  it('CRUD round-trip for a Template + ordered exercises', async () => {
    const exercises = await listExercises(db);
    const bench = exercises.find((e) => e.name === 'Bench Press')!;
    const ohp = exercises.find((e) => e.name === 'Overhead Press')!;
    const pushup = exercises.find((e) => e.name === 'Push-up')!;

    let n = 0;
    const uuid = () => `id-${++n}`;
    const now = () => 100;

    await createTemplate(db, { id: 'tpl-A', name: 'Push day', now });
    await addTemplateExercise(db, {
      template_id: 'tpl-A',
      exercise_id: bench.id,
      default_sets: 3,
      default_reps: 10,
      default_weight_kg: 60,
      uuid,
      now,
    });
    await addTemplateExercise(db, {
      template_id: 'tpl-A',
      exercise_id: ohp.id,
      default_sets: 4,
      default_reps: 8,
      default_weight_kg: 40,
      uuid,
      now,
    });
    await addTemplateExercise(db, {
      template_id: 'tpl-A',
      exercise_id: pushup.id,
      default_sets: 3,
      default_reps: 15,
      default_weight_kg: null,
      uuid,
      now,
    });

    const tpl = await getTemplate(db, 'tpl-A');
    expect(tpl).not.toBeNull();
    expect(tpl!.name).toBe('Push day');
    expect(tpl!.exercises).toHaveLength(3);
    expect(tpl!.exercises.map((e) => e.ordering)).toEqual([1, 2, 3]);
    expect(tpl!.exercises[0]).toMatchObject({
      exercise_id: bench.id,
      ordering: 1,
      default_sets: 3,
      default_reps: 10,
      default_weight_kg: 60,
      is_evergreen: 0,
      parent_id: null,
      reusable_superset_id: null,
    });

    // List view shows the count.
    const list = await listTemplates(db);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'tpl-A', name: 'Push day', exerciseCount: 3 });

    // Rename.
    await updateTemplateName(db, { id: 'tpl-A', name: 'Push A', now: () => 200 });
    expect((await getTemplate(db, 'tpl-A'))!.name).toBe('Push A');

    // Remove the middle exercise — remaining rows keep their original orderings (gaps allowed).
    const rows = await listTemplateExerciseRows(db, 'tpl-A');
    const ohpRow = rows.find((r) => r.exercise_id === ohp.id)!;
    await removeTemplateExercise(db, { template_exercise_id: ohpRow.id });
    const after = await getTemplate(db, 'tpl-A');
    expect(after!.exercises.map((e) => e.exercise_id)).toEqual([bench.id, pushup.id]);

    // Delete cascades.
    await deleteTemplate(db, 'tpl-A');
    expect(await getTemplate(db, 'tpl-A')).toBeNull();
    expect(await listTemplateExerciseRows(db, 'tpl-A')).toEqual([]);
  });

  it('startSessionFromTemplate snapshots the Template into session_exercise rows', async () => {
    const exercises = await listExercises(db);
    const bench = exercises.find((e) => e.name === 'Bench Press')!;
    const squat = exercises.find((e) => e.name === 'Back Squat')!;

    let n = 0;
    const uuid = () => `id-${++n}`;

    await createTemplate(db, { id: 'tpl-1', name: 'Strength', now: () => 100 });
    await addTemplateExercise(db, {
      template_id: 'tpl-1',
      exercise_id: bench.id,
      default_sets: 5,
      default_reps: 5,
      default_weight_kg: 80,
      uuid,
      now: () => 100,
    });
    await addTemplateExercise(db, {
      template_id: 'tpl-1',
      exercise_id: squat.id,
      default_sets: 3,
      default_reps: 5,
      default_weight_kg: 100,
      uuid,
      now: () => 100,
    });

    const { session_id, planned_count } = await startSessionFromTemplate(db, {
      template_id: 'tpl-1',
      uuid,
      now: () => 1_000,
    });

    expect(planned_count).toBe(2);
    const session = await getSession(db, session_id);
    expect(session?.started_at).toBe(1_000);
    expect(session?.ended_at).toBeNull();

    const planned = await listSessionExercisesWithName(db, session_id);
    expect(planned).toHaveLength(2);
    expect(planned.map((p) => p.exercise_name)).toEqual([bench.name, squat.name]);
    expect(planned.map((p) => p.ordering)).toEqual([1, 2]);
    expect(planned[0]).toMatchObject({
      planned_sets: 5,
      planned_reps: 5,
      planned_weight_kg: 80,
      template_id: 'tpl-1',
    });
  });

  it('Template edits AFTER session start do NOT affect that session (snapshot isolation)', async () => {
    const exercises = await listExercises(db);
    const bench = exercises.find((e) => e.name === 'Bench Press')!;
    const squat = exercises.find((e) => e.name === 'Back Squat')!;
    const ohp = exercises.find((e) => e.name === 'Overhead Press')!;

    let n = 0;
    const uuid = () => `id-${++n}`;

    await createTemplate(db, { id: 'tpl-1', name: 'A', now: () => 100 });
    await addTemplateExercise(db, {
      template_id: 'tpl-1',
      exercise_id: bench.id,
      default_sets: 3,
      default_reps: 10,
      default_weight_kg: 60,
      uuid,
      now: () => 100,
    });
    await addTemplateExercise(db, {
      template_id: 'tpl-1',
      exercise_id: squat.id,
      default_sets: 3,
      default_reps: 5,
      default_weight_kg: 100,
      uuid,
      now: () => 100,
    });

    // Snapshot session #1 with the current Template state.
    const { session_id: s1 } = await startSessionFromTemplate(db, {
      template_id: 'tpl-1',
      uuid,
      now: () => 1_000,
    });

    // End it so we can also assert "ended sessions are unaffected".
    await endSession(db, { id: s1, ended_at: 2_000 });

    // Now mutate the Template heavily.
    await updateTemplateName(db, { id: 'tpl-1', name: 'Mutated', now: () => 3_000 });
    const rows = await listTemplateExerciseRows(db, 'tpl-1');
    const benchRow = rows.find((r) => r.exercise_id === bench.id)!;
    await removeTemplateExercise(db, { template_exercise_id: benchRow.id });
    await addTemplateExercise(db, {
      template_id: 'tpl-1',
      exercise_id: ohp.id,
      default_sets: 99,
      default_reps: 99,
      default_weight_kg: 999,
      uuid,
      now: () => 3_000,
    });

    // Original snapshot must be untouched.
    const snapshot = await listSessionExercisesWithName(db, s1);
    expect(snapshot.map((p) => p.exercise_name)).toEqual([bench.name, squat.name]);
    expect(snapshot[0].planned_sets).toBe(3);
    expect(snapshot[0].planned_reps).toBe(10);
    expect(snapshot[0].planned_weight_kg).toBe(60);
  });

  it('startSessionFromTemplate refuses while a session is already in progress', async () => {
    const exercises = await listExercises(db);
    const bench = exercises.find((e) => e.name === 'Bench Press')!;
    let n = 0;
    const uuid = () => `id-${++n}`;

    await createTemplate(db, { id: 'tpl-1', name: 'A', now: () => 100 });
    await addTemplateExercise(db, {
      template_id: 'tpl-1',
      exercise_id: bench.id,
      default_sets: 3,
      default_reps: 10,
      default_weight_kg: 60,
      uuid,
      now: () => 100,
    });

    await startSessionFromTemplate(db, {
      template_id: 'tpl-1',
      uuid,
      now: () => 1_000,
    });

    await expect(
      startSessionFromTemplate(db, {
        template_id: 'tpl-1',
        uuid,
        now: () => 2_000,
      })
    ).rejects.toThrow(/already in progress/);
  });

  it('startSessionFromTemplate throws when template_id does not exist', async () => {
    let n = 0;
    const uuid = () => `id-${++n}`;
    await expect(
      startSessionFromTemplate(db, {
        template_id: 'nope',
        uuid,
        now: () => 1_000,
      })
    ).rejects.toThrow(/Template not found/);
  });

  it('Template with zero exercises produces an empty plan but still creates a Session', async () => {
    let n = 0;
    const uuid = () => `id-${++n}`;
    await createTemplate(db, { id: 'empty', name: 'Stub', now: () => 100 });

    const { session_id, planned_count } = await startSessionFromTemplate(db, {
      template_id: 'empty',
      uuid,
      now: () => 1_000,
    });
    expect(planned_count).toBe(0);
    expect(await listSessionExercisesWithName(db, session_id)).toEqual([]);
    expect((await getSession(db, session_id))?.started_at).toBe(1_000);
  });

  // Slice 10b — schema bridge integration test. Verifies the full pipeline:
  // template_exercise.rest_seconds (legacy column) → templateRepository read
  // → snapshotForSession copy → session_exercise.rest_sec (new column).
  it('startSessionFromTemplate carries rest_sec from template (legacy rest_seconds column)', async () => {
    const exercises = await listExercises(db);
    const bench = exercises.find((e) => e.name === 'Bench Press')!;
    const squat = exercises.find((e) => e.name === 'Back Squat')!;

    let n = 0;
    const uuid = () => `id-${++n}`;

    await createTemplate(db, { id: 'tpl-rest', name: 'Rest test', now: () => 100 });
    const { id: benchTeId } = await addTemplateExercise(db, {
      template_id: 'tpl-rest',
      exercise_id: bench.id,
      default_sets: 3,
      default_reps: 5,
      default_weight_kg: 80,
      uuid,
      now: () => 100,
    });
    const { id: squatTeId } = await addTemplateExercise(db, {
      template_id: 'tpl-rest',
      exercise_id: squat.id,
      default_sets: 3,
      default_reps: 5,
      default_weight_kg: 100,
      uuid,
      now: () => 100,
    });

    // Set rest_seconds (legacy column) on the template rows directly. In
    // production this happens via the template editor's saveTemplateDraft
    // path; we shortcut here so the test focuses on the read/snapshot/
    // persist pipeline.
    await db.runAsync(
      `UPDATE template_exercise SET rest_seconds = ? WHERE id = ?`,
      90,
      benchTeId,
    );
    await db.runAsync(
      `UPDATE template_exercise SET rest_seconds = ? WHERE id = ?`,
      null,
      squatTeId,
    );

    const { session_id } = await startSessionFromTemplate(db, {
      template_id: 'tpl-rest',
      uuid,
      now: () => 1_000,
    });

    const planned = await db.getAllAsync<{
      exercise_id: string;
      rest_sec: number | null;
    }>(
      `SELECT exercise_id, rest_sec FROM session_exercise
        WHERE session_id = ? ORDER BY ordering ASC`,
      session_id,
    );
    expect(planned).toHaveLength(2);
    // bench had rest_seconds=90 → session_exercise.rest_sec=90
    expect(planned[0]?.exercise_id).toBe(bench.id);
    expect(planned[0]?.rest_sec).toBe(90);
    // squat had rest_seconds=NULL → session_exercise.rest_sec=NULL (no coalesce)
    expect(planned[1]?.exercise_id).toBe(squat.id);
    expect(planned[1]?.rest_sec).toBeNull();
  });
});
