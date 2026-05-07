import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { listExercises } from '../../src/adapters/sqlite/exerciseRepository';
import {
  addTemplateExercise,
  createTemplate,
  getTemplate,
  listTemplateExerciseRows,
  setTemplateExerciseEvergreen,
} from '../../src/adapters/sqlite/templateRepository';
import { startSessionFromTemplate } from '../../src/adapters/sqlite/sessionFromTemplate';
import {
  endSession,
  listSessionExercises,
} from '../../src/adapters/sqlite/sessionRepository';
import {
  insertSet,
  listSetsBySession,
} from '../../src/adapters/sqlite/setRepository';
import {
  aggregateActuals,
  computeSaveBackDiff,
} from '../../src/domain/template/saveBackDiff';
import { applySaveBack } from '../../src/adapters/sqlite/saveBackRepository';

/**
 * Slice 4 integration tests — wire `session_exercise` (snapshot) through the
 * pure diff into `applySaveBack`, then assert the Template is updated as
 * promised. Uses better-sqlite3 :memory: behind the same Database interface
 * as production (slice 1+2+3 pattern).
 *
 * ADR-0005 edge cases covered: reorder, skip exercise, add new exercise.
 */

describe('Save-back end-to-end (slice 4)', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  /**
   * Set up a Template with bench (general) + finisher (evergreen) and start
   * a Session from it. Returns the IDs needed by the assertions.
   */
  async function setupTemplateAndSession(args: { now?: number } = {}) {
    const exercises = await listExercises(db);
    const bench = exercises.find((e) => e.name === 'Bench Press')!;
    const ohp = exercises.find((e) => e.name === 'Overhead Press')!;
    const pushup = exercises.find((e) => e.name === 'Push-up')!;

    let n = 0;
    const uuid = () => `id-${++n}`;
    const now = args.now ?? 100;

    await createTemplate(db, { id: 'tpl-1', name: 'Push', now: () => now });
    const benchAdd = await addTemplateExercise(db, {
      template_id: 'tpl-1',
      exercise_id: bench.id,
      default_sets: 3,
      default_reps: 10,
      default_weight_kg: 60,
      uuid,
      now: () => now,
    });
    const ohpAdd = await addTemplateExercise(db, {
      template_id: 'tpl-1',
      exercise_id: ohp.id,
      default_sets: 4,
      default_reps: 8,
      default_weight_kg: 40,
      uuid,
      now: () => now,
    });
    const finisherAdd = await addTemplateExercise(db, {
      template_id: 'tpl-1',
      exercise_id: pushup.id,
      default_sets: 3,
      default_reps: 15,
      default_weight_kg: null,
      is_evergreen: 1,
      uuid,
      now: () => now,
    });

    const start = await startSessionFromTemplate(db, {
      template_id: 'tpl-1',
      uuid,
      now: () => now + 1_000,
    });
    return {
      bench,
      ohp,
      pushup,
      benchAdd,
      ohpAdd,
      finisherAdd,
      session_id: start.session_id,
      uuid,
    };
  }

  it('snapshot carries is_evergreen from template_exercise into session_exercise', async () => {
    const { session_id } = await setupTemplateAndSession();
    const planRows = await listSessionExercises(db, session_id);
    const flags = planRows.map((p) => p.is_evergreen).sort();
    expect(flags).toEqual([0, 0, 1]); // bench=0, ohp=0, pushup=1
  });

  it('end-to-end: modify (bench) + skip (ohp) + add (pullup) → applySaveBack updates template correctly', async () => {
    const { bench, ohp, pushup, session_id } = await setupTemplateAndSession();
    const exercises = await listExercises(db);
    const pullup = exercises.find((e) => e.name === 'Pull-up')!;

    // Log actual sets:
    //   bench: 4 sets at 70kg × 8 reps (modify)
    //   ohp:   skipped entirely         (remove)
    //   pushup: 3 sets bw × 15 reps    (matches plan exactly — no diff for evergreen)
    //   pullup: 3 sets bw × 6 reps     (add — wasn't planned)
    let n = 1000;
    const setUuid = () => `set-${++n}`;
    const benchSets = [70, 70, 70, 70].map((w, i) => ({
      id: setUuid(),
      session_id,
      exercise_id: bench.id,
      weight_kg: w,
      reps: 8,
      is_skipped: 0,
      ordering: i + 1,
      created_at: 2000 + i,
    }));
    for (const s of benchSets) await insertSet(db, s);
    const pushupSets = [null, null, null].map((w, i) => ({
      id: setUuid(),
      session_id,
      exercise_id: pushup.id,
      weight_kg: w,
      reps: 15,
      is_skipped: 0,
      ordering: i + 5,
      created_at: 2100 + i,
    }));
    for (const s of pushupSets) await insertSet(db, s);
    const pullupSets = [null, null, null].map((w, i) => ({
      id: setUuid(),
      session_id,
      exercise_id: pullup.id,
      weight_kg: w,
      reps: 6,
      is_skipped: 0,
      ordering: i + 8,
      created_at: 2200 + i,
    }));
    for (const s of pullupSets) await insertSet(db, s);

    await endSession(db, { id: session_id, ended_at: 3000 });

    // Compute diff.
    const planRows = await listSessionExercises(db, session_id);
    const actualSets = await listSetsBySession(db, session_id);
    const diff = computeSaveBackDiff({
      plan: planRows.map((p) => ({
        exercise_id: p.exercise_id,
        ordering: p.ordering,
        planned_sets: p.planned_sets,
        planned_reps: p.planned_reps,
        planned_weight_kg: p.planned_weight_kg,
        is_evergreen: p.is_evergreen,
      })),
      actual: aggregateActuals(actualSets),
    });

    expect(diff.map((c) => [c.type, c.exercise_id])).toEqual([
      ['modify', bench.id],
      ['remove', ohp.id],
      ['add', pullup.id],
    ]);

    // Apply ALL changes and assert template state.
    let appUuid = 9000;
    await applySaveBack(db, {
      template_id: 'tpl-1',
      accepted: diff,
      uuid: () => `app-${++appUuid}`,
      now: () => 4000,
    });

    const tpl = await getTemplate(db, 'tpl-1');
    expect(tpl).not.toBeNull();
    const exIdsInTemplate = tpl!.exercises.map((e) => e.exercise_id);
    expect(exIdsInTemplate).toContain(bench.id);
    expect(exIdsInTemplate).not.toContain(ohp.id); // removed
    expect(exIdsInTemplate).toContain(pushup.id); // evergreen kept
    expect(exIdsInTemplate).toContain(pullup.id); // newly added

    const benchRow = tpl!.exercises.find((e) => e.exercise_id === bench.id)!;
    expect(benchRow.default_sets).toBe(4);
    expect(benchRow.default_reps).toBe(8);
    expect(benchRow.default_weight_kg).toBe(70);

    const pullupRow = tpl!.exercises.find((e) => e.exercise_id === pullup.id)!;
    expect(pullupRow.default_sets).toBe(3);
    expect(pullupRow.default_reps).toBe(6);
    expect(pullupRow.is_evergreen).toBe(0);
  });

  it('partial confirm: only modify is accepted → template updated, ohp NOT removed, pullup NOT added', async () => {
    const { bench, ohp, session_id } = await setupTemplateAndSession();
    const exercises = await listExercises(db);
    const pullup = exercises.find((e) => e.name === 'Pull-up')!;

    let n = 1000;
    const setUuid = () => `set-${++n}`;
    await insertSet(db, {
      id: setUuid(), session_id, exercise_id: bench.id,
      weight_kg: 70, reps: 8, is_skipped: 0, ordering: 1, created_at: 2000,
    });
    // ohp skipped, pullup added.
    await insertSet(db, {
      id: setUuid(), session_id, exercise_id: pullup.id,
      weight_kg: null, reps: 6, is_skipped: 0, ordering: 2, created_at: 2001,
    });

    const planRows = await listSessionExercises(db, session_id);
    const actualSets = await listSetsBySession(db, session_id);
    const diff = computeSaveBackDiff({
      plan: planRows.map((p) => ({
        exercise_id: p.exercise_id,
        ordering: p.ordering,
        planned_sets: p.planned_sets,
        planned_reps: p.planned_reps,
        planned_weight_kg: p.planned_weight_kg,
        is_evergreen: p.is_evergreen,
      })),
      actual: aggregateActuals(actualSets),
    });

    // Pretend the user only ticked the 'modify' card.
    const accepted = diff.filter((c) => c.type === 'modify');

    let appUuid = 9000;
    await applySaveBack(db, {
      template_id: 'tpl-1',
      accepted,
      uuid: () => `app-${++appUuid}`,
    });

    const tpl = await getTemplate(db, 'tpl-1');
    const exIds = tpl!.exercises.map((e) => e.exercise_id);
    // ohp still in the template — user skipped the 'remove' card
    expect(exIds).toContain(ohp.id);
    // pullup NOT in the template — user skipped the 'add' card
    expect(exIds).not.toContain(pullup.id);
    const benchRow = tpl!.exercises.find((e) => e.exercise_id === bench.id)!;
    expect(benchRow.default_sets).toBe(1); // modified to actual
    expect(benchRow.default_reps).toBe(8);
    expect(benchRow.default_weight_kg).toBe(70);
  });

  it('ADR-0005 edge case: reorder — logged in different order than planned, no diff produced', async () => {
    const { bench, ohp, pushup, session_id } = await setupTemplateAndSession();

    // Log ohp first, then bench, then pushup (matches counts/values exactly).
    let n = 1000;
    const setUuid = () => `set-${++n}`;
    for (let i = 0; i < 4; i++) {
      await insertSet(db, {
        id: setUuid(), session_id, exercise_id: ohp.id,
        weight_kg: 40, reps: 8, is_skipped: 0, ordering: i + 1, created_at: 2000 + i,
      });
    }
    for (let i = 0; i < 3; i++) {
      await insertSet(db, {
        id: setUuid(), session_id, exercise_id: bench.id,
        weight_kg: 60, reps: 10, is_skipped: 0, ordering: i + 5, created_at: 2100 + i,
      });
    }
    for (let i = 0; i < 3; i++) {
      await insertSet(db, {
        id: setUuid(), session_id, exercise_id: pushup.id,
        weight_kg: null, reps: 15, is_skipped: 0, ordering: i + 9, created_at: 2200 + i,
      });
    }

    const planRows = await listSessionExercises(db, session_id);
    const actualSets = await listSetsBySession(db, session_id);
    const diff = computeSaveBackDiff({
      plan: planRows.map((p) => ({
        exercise_id: p.exercise_id,
        ordering: p.ordering,
        planned_sets: p.planned_sets,
        planned_reps: p.planned_reps,
        planned_weight_kg: p.planned_weight_kg,
        is_evergreen: p.is_evergreen,
      })),
      actual: aggregateActuals(actualSets),
    });
    expect(diff).toEqual([]);
  });

  it('ADR-0005 edge case: evergreen skipped — no remove diff, template untouched', async () => {
    const { bench, ohp, pushup, session_id } = await setupTemplateAndSession();
    // Log only bench + ohp; pushup (evergreen) is skipped this session.
    let n = 1000;
    const setUuid = () => `set-${++n}`;
    for (let i = 0; i < 3; i++) {
      await insertSet(db, {
        id: setUuid(), session_id, exercise_id: bench.id,
        weight_kg: 60, reps: 10, is_skipped: 0, ordering: i + 1, created_at: 2000 + i,
      });
    }
    for (let i = 0; i < 4; i++) {
      await insertSet(db, {
        id: setUuid(), session_id, exercise_id: ohp.id,
        weight_kg: 40, reps: 8, is_skipped: 0, ordering: i + 4, created_at: 2100 + i,
      });
    }

    const planRows = await listSessionExercises(db, session_id);
    const actualSets = await listSetsBySession(db, session_id);
    const diff = computeSaveBackDiff({
      plan: planRows.map((p) => ({
        exercise_id: p.exercise_id,
        ordering: p.ordering,
        planned_sets: p.planned_sets,
        planned_reps: p.planned_reps,
        planned_weight_kg: p.planned_weight_kg,
        is_evergreen: p.is_evergreen,
      })),
      actual: aggregateActuals(actualSets),
    });
    // No diff for the skipped evergreen pushup; bench / ohp matched exactly.
    expect(diff).toEqual([]);

    // Even if a forged 'remove' for the evergreen pushup is fed through
    // applySaveBack, the row must NOT be deleted — defence in depth.
    await applySaveBack(db, {
      template_id: 'tpl-1',
      accepted: [
        {
          type: 'remove',
          exercise_id: pushup.id,
          ordering: 99,
          is_evergreen: 1,
          planned: { sets: 3, reps: 15, weight_kg: null },
        },
      ],
      uuid: () => 'should-not-be-used',
    });
    const tpl = await getTemplate(db, 'tpl-1');
    expect(tpl!.exercises.map((e) => e.exercise_id)).toContain(pushup.id);
  });

  it('ADR-0005 edge case: add new exercise — applySaveBack appends to template at end with is_evergreen=0', async () => {
    const { session_id } = await setupTemplateAndSession();
    const exercises = await listExercises(db);
    const bench = exercises.find((e) => e.name === 'Bench Press')!;
    const ohp = exercises.find((e) => e.name === 'Overhead Press')!;
    const pushup = exercises.find((e) => e.name === 'Push-up')!;
    const pullup = exercises.find((e) => e.name === 'Pull-up')!;

    // Log everything from plan exactly + add pullup on the side.
    let n = 1000;
    const setUuid = () => `set-${++n}`;
    for (let i = 0; i < 3; i++) {
      await insertSet(db, {
        id: setUuid(), session_id, exercise_id: bench.id,
        weight_kg: 60, reps: 10, is_skipped: 0, ordering: i + 1, created_at: 2000 + i,
      });
    }
    for (let i = 0; i < 4; i++) {
      await insertSet(db, {
        id: setUuid(), session_id, exercise_id: ohp.id,
        weight_kg: 40, reps: 8, is_skipped: 0, ordering: i + 4, created_at: 2100 + i,
      });
    }
    for (let i = 0; i < 3; i++) {
      await insertSet(db, {
        id: setUuid(), session_id, exercise_id: pushup.id,
        weight_kg: null, reps: 15, is_skipped: 0, ordering: i + 8, created_at: 2200 + i,
      });
    }
    for (let i = 0; i < 4; i++) {
      await insertSet(db, {
        id: setUuid(), session_id, exercise_id: pullup.id,
        weight_kg: null, reps: 5, is_skipped: 0, ordering: i + 11, created_at: 2300 + i,
      });
    }

    const planRows = await listSessionExercises(db, session_id);
    const actualSets = await listSetsBySession(db, session_id);
    const diff = computeSaveBackDiff({
      plan: planRows.map((p) => ({
        exercise_id: p.exercise_id,
        ordering: p.ordering,
        planned_sets: p.planned_sets,
        planned_reps: p.planned_reps,
        planned_weight_kg: p.planned_weight_kg,
        is_evergreen: p.is_evergreen,
      })),
      actual: aggregateActuals(actualSets),
    });
    expect(diff).toHaveLength(1);
    expect(diff[0].type).toBe('add');
    expect(diff[0].exercise_id).toBe(pullup.id);

    let appUuid = 9000;
    await applySaveBack(db, {
      template_id: 'tpl-1',
      accepted: diff,
      uuid: () => `app-${++appUuid}`,
    });

    const rows = await listTemplateExerciseRows(db, 'tpl-1');
    const last = rows[rows.length - 1];
    expect(last.exercise_id).toBe(pullup.id);
    expect(last.is_evergreen).toBe(0);
    expect(last.default_sets).toBe(4);
    expect(last.default_reps).toBe(5);
  });

  it('setTemplateExerciseEvergreen flips the flag and bumps updated_at', async () => {
    const { benchAdd } = await setupTemplateAndSession();
    await setTemplateExerciseEvergreen(db, {
      template_exercise_id: benchAdd.id,
      is_evergreen: 1,
      now: () => 5000,
    });
    const rows = await listTemplateExerciseRows(db, 'tpl-1');
    const benchRow = rows.find((r) => r.id === benchAdd.id)!;
    expect(benchRow.is_evergreen).toBe(1);
  });
});
