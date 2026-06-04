import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { listExercises } from '../../src/adapters/sqlite/exerciseRepository';
import {
  attachTemplateToProgram,
  commitTemplateDraft,
  createTemplate,
  getTemplateFull,
} from '../../src/adapters/sqlite/templateRepository';
import { createProgram } from '../../src/adapters/sqlite/programRepository';
import { cloneTemplate, remapDraftBody } from '../../src/domain/template/templateDraft';

/**
 * Acceptance tests for the「另存模板」/「另存強度」path used by the 2026-06-04
 * template-editor redesign (#4/#5/#6 + the 2026-06-04 bug fix).
 *
 * The editor's `onSaveAsConfirm` builds a NEW template Y from the CURRENT
 * in-memory editor draft WITHOUT writing back to the template being edited (X).
 * It does so by `remapDraftBody` (fresh ids) → `commitTemplateDraft` against the
 * target's current state. These tests mirror that composition at the repo layer
 * and lock in the two invariants the user reported:
 *   1. Y receives the CURRENT (possibly-unsaved) editor body, including edits.
 *   2. X is NEVER modified by 另存 (the reported「另存也會儲存到原本模板」bug).
 *
 * better-sqlite3 :memory:, foreign_keys=ON → seed real builtin exercise_ids.
 */
describe('另存模板 / 另存強度 from in-memory draft (2026-06-04 redesign + bugfix)', () => {
  let db: BetterSqliteDatabase;
  let benchId: string;
  let squatId: string;

  function makeUuidGen(prefix = 'gen'): () => string {
    let n = 0;
    return () => `${prefix}-${++n}`;
  }

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    const exercises = await listExercises(db);
    benchId = exercises.find((e) => e.name === 'Bench Press')!.id;
    squatId = exercises.find((e) => e.name === 'Back Squat')!.id;
    await createProgram(db, {
      program: {
        id: 'prog-A',
        name: 'Program A',
        main_tag: null,
        cycle_length: 3,
        cycle_count: 1,
        start_date: '2026-01-01',
        is_active: 0,
      },
    });
  });

  afterEach(() => {
    db.close();
  });

  /** Seed the SOURCE template X = "胸日" (prog-A, 10RM): a superset cluster
   *  (Bench parent + Squat child via parent_id) with a dropset chain on Bench
   *  (parent_set_id) so the remap covers both linkage kinds. */
  async function seedX(id = 'tpl-X'): Promise<string> {
    await createTemplate(db, { id, name: '胸日', now: () => 1000 });
    await attachTemplateToProgram(db, {
      template_id: id,
      program_id: 'prog-A',
      sub_tag: '10RM',
      now: () => 1000,
    });
    await db.runAsync(
      `INSERT INTO template_exercise
         (id, template_id, exercise_id, ordering, default_sets, default_reps,
          default_weight_kg, is_evergreen, parent_id, rest_seconds,
          reusable_superset_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'te-bench', id, benchId, 1, 3, 8, 80, 0, null, 90, null, 1000,
    );
    await db.runAsync(
      `INSERT INTO template_exercise
         (id, template_id, exercise_id, ordering, default_sets, default_reps,
          default_weight_kg, is_evergreen, parent_id, rest_seconds,
          reusable_superset_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'te-squat', id, squatId, 2, 1, 5, 100, 1, 'te-bench', 120, null, 1000,
    );
    await db.runAsync(
      `INSERT INTO template_set (id, template_exercise_id, position, set_kind,
         reps, weight, parent_set_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      'ts-b1', 'te-bench', 0, 'working', 8, 80, null, null,
    );
    await db.runAsync(
      `INSERT INTO template_set (id, template_exercise_id, position, set_kind,
         reps, weight, parent_set_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      'ts-b2', 'te-bench', 1, 'dropset', 6, 60, 'ts-b1', null,
    );
    await db.runAsync(
      `INSERT INTO template_set (id, template_exercise_id, position, set_kind,
         reps, weight, parent_set_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      'ts-s1', 'te-squat', 0, 'working', 5, 100, null, null,
    );
    return id;
  }

  /** Replays the editor's `writeBodyTo`: clone the current editor body into a
   *  target template via fresh ids + commitTemplateDraft (target identity kept,
   *  X never touched). */
  async function saveAsInto(
    targetId: string,
    draftExercises: ReturnType<typeof cloneTemplate>['exercises'],
  ): Promise<void> {
    const target = await getTemplateFull(db, targetId);
    if (!target) throw new Error('TARGET_TEMPLATE_NOT_FOUND');
    await commitTemplateDraft(db, {
      committed: target,
      draft: {
        id: targetId,
        name: target.name,
        color_hex: target.color_hex,
        program_id: target.program_id ?? null,
        sub_tag: target.sub_tag ?? null,
        exercises: remapDraftBody(draftExercises, targetId, makeUuidGen('y')),
      },
      now: () => 5000,
    });
  }

  it('remapDraftBody gives fresh ids + remaps parent_id / parent_set_id / template_id', async () => {
    await seedX();
    const x = await getTemplateFull(db, 'tpl-X');
    const remapped = remapDraftBody(x!.exercises, 'tpl-Y', makeUuidGen('r'));

    const [bench, squat] = remapped;
    expect(bench.id).not.toBe('te-bench');
    expect(squat.id).not.toBe('te-squat');
    expect(bench.template_id).toBe('tpl-Y');
    expect(squat.template_id).toBe('tpl-Y');
    // Superset child parent_id → remapped to the NEW bench id.
    expect(squat.parent_id).toBe(bench.id);
    // Dropset follower parent_set_id → remapped to the NEW working-set id.
    const working = bench.sets[0];
    const dropset = bench.sets[1];
    expect(working.id).not.toBe('ts-b1');
    expect(dropset.parent_set_id).toBe(working.id);
  });

  it('另存: Y gets the CURRENT (edited) body; X is NOT modified', async () => {
    await seedX();
    // Simulate an UNSAVED editor edit: bump the bench working set weight.
    const draft = cloneTemplate((await getTemplateFull(db, 'tpl-X'))!);
    draft.exercises[0].sets[0].weight = 999;

    // 另存模板 → new template Y at a distinct triple.
    await createTemplate(db, { id: 'tpl-Y', name: '胸日複製', now: () => 5000 });
    await attachTemplateToProgram(db, {
      template_id: 'tpl-Y',
      program_id: 'prog-A',
      sub_tag: '8RM',
      now: () => 5000,
    });
    await saveAsInto('tpl-Y', draft.exercises);

    // Y carries the edit (999) + the full structure.
    const y = await getTemplateFull(db, 'tpl-Y');
    expect(y!.exercises.map((e) => e.exercise_id)).toEqual([benchId, squatId]);
    expect(y!.exercises[0].sets[0].weight).toBe(999);
    expect(y!.exercises[0].sets.length).toBe(2); // working + dropset preserved

    // ★ X is UNTOUCHED — its working set still 80 (the on-screen edit never
    // reached it), and its row ids are intact.
    const x = await getTemplateFull(db, 'tpl-X');
    expect(x!.exercises[0].sets[0].weight).toBe(80);
    expect(x!.exercises[0].id).toBe('te-bench');
    expect(x!.sub_tag).toBe('10RM');
  });

  it('另存→覆蓋: replaces target Y body with current body, keeps Y identity, X untouched', async () => {
    await seedX();
    // Existing Y = (胸日, prog-A, 8RM) with a different single-squat body.
    await createTemplate(db, { id: 'tpl-Y', name: '胸日', now: () => 2000 });
    await attachTemplateToProgram(db, {
      template_id: 'tpl-Y',
      program_id: 'prog-A',
      sub_tag: '8RM',
      now: () => 2000,
    });
    await db.runAsync(
      `INSERT INTO template_exercise
         (id, template_id, exercise_id, ordering, default_sets, default_reps,
          default_weight_kg, is_evergreen, parent_id, rest_seconds,
          reusable_superset_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'te-y-old', 'tpl-Y', squatId, 1, 1, 5, 60, 0, null, 60, null, 2000,
    );

    const draft = cloneTemplate((await getTemplateFull(db, 'tpl-X'))!);
    await saveAsInto('tpl-Y', draft.exercises); // overwrite Y

    const y = await getTemplateFull(db, 'tpl-Y');
    expect(y!.exercises.map((e) => e.exercise_id)).toEqual([benchId, squatId]);
    expect(y!.exercises.map((e) => e.id)).not.toContain('te-y-old');
    expect(y!.sub_tag).toBe('8RM'); // identity preserved

    // X untouched.
    const x = await getTemplateFull(db, 'tpl-X');
    expect(x!.exercises[0].id).toBe('te-bench');
    expect(x!.sub_tag).toBe('10RM');
  });
});
