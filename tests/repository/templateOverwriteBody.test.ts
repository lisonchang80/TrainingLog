import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { listExercises } from '../../src/adapters/sqlite/exerciseRepository';
import {
  createTemplate,
  overwriteTemplateBody,
} from '../../src/adapters/sqlite/templateRepository';
import { createProgram } from '../../src/adapters/sqlite/programRepository';

/**
 * Acceptance tests for `overwriteTemplateBody` — the shared overwrite-on-
 * triple-collision primitive (ADR-0003 amendment, 2026-06-03). Replaces a
 * TARGET template's body with a deep copy of a SOURCE template's body while
 * preserving the target's identity (id / name / program_id / sub_tag).
 *
 * Architecture: better-sqlite3 :memory:, same as other adapter tests. The
 * jest DB has foreign_keys=ON, so we seed real builtin exercise_ids for FK
 * validity.
 *
 * Coverage:
 *   1. Target body fully replaced by source's; nested structure preserved
 *      (superset cluster parent_id remap; dropset parent_set_id remap;
 *      reusable_superset_id carried verbatim).
 *   2. Target id / name / program_id / sub_tag / color_hex UNCHANGED.
 *   3. Source row + its body UNCHANGED.
 *   4. Empty source → target ends up with an empty body.
 *   5. Missing source / target → throws.
 */
describe('overwriteTemplateBody (ADR-0003 amendment 2026-06-03)', () => {
  let db: BetterSqliteDatabase;
  let benchId: string;
  let squatId: string;
  let dlId: string;

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
    // 'Deadlift' was archived by v028 — any third distinct active exercise works.
    dlId = exercises.find((e) => e.name === 'Rack Pull')!.id;
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

  /**
   * Seed the SOURCE template — a 2-exercise superset cluster (Bench parent +
   * Squat child via parent_id) so we can verify parent_id remap, plus a
   * dropset chain on Bench so we can verify parent_set_id remap. Both rows
   * carry a reusable_superset_id to verify verbatim carry. Returns its id.
   */
  async function seedSourceTemplate(id = 'src-tpl'): Promise<string> {
    await db.runAsync(
      `INSERT INTO superset (id, name, color_hex, use_count, created_at, updated_at)
       VALUES (?, ?, NULL, 0, ?, ?)`,
      'rs-pair-1',
      'Push RS',
      1000,
      1000,
    );
    await createTemplate(db, { id, name: 'Source Day', now: () => 1000 });
    await db.runAsync(
      `UPDATE template SET program_id = ?, sub_tag = ?, color_hex = ? WHERE id = ?`,
      'prog-A',
      'SRC-INT',
      '#111111',
      id,
    );
    // Bench parent (ordering 1).
    await db.runAsync(
      `INSERT INTO template_exercise
         (id, template_id, exercise_id, ordering, default_sets, default_reps,
          default_weight_kg, is_evergreen, parent_id, rest_seconds,
          reusable_superset_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'te-bench',
      id,
      benchId,
      1,
      3,
      8,
      80,
      0,
      null,
      90,
      'rs-pair-1',
      1000,
    );
    // Squat child (ordering 2), parent_id → te-bench (superset cluster).
    await db.runAsync(
      `INSERT INTO template_exercise
         (id, template_id, exercise_id, ordering, default_sets, default_reps,
          default_weight_kg, is_evergreen, parent_id, rest_seconds,
          reusable_superset_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'te-squat',
      id,
      squatId,
      2,
      2,
      5,
      100,
      1,
      'te-bench',
      120,
      'rs-pair-1',
      1000,
    );
    // Bench sets: warmup + 2 working + dropset chained to last working.
    await db.runAsync(
      `INSERT INTO template_set (id, template_exercise_id, position, set_kind,
         reps, weight, parent_set_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      'ts-b1', 'te-bench', 0, 'warmup', 10, 40, null, 'warm',
    );
    await db.runAsync(
      `INSERT INTO template_set (id, template_exercise_id, position, set_kind,
         reps, weight, parent_set_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      'ts-b2', 'te-bench', 1, 'working', 8, 80, null, null,
    );
    await db.runAsync(
      `INSERT INTO template_set (id, template_exercise_id, position, set_kind,
         reps, weight, parent_set_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      'ts-b3', 'te-bench', 2, 'working', 8, 80, null, null,
    );
    await db.runAsync(
      `INSERT INTO template_set (id, template_exercise_id, position, set_kind,
         reps, weight, parent_set_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      'ts-b4', 'te-bench', 3, 'dropset', 6, 60, 'ts-b3', 'drop',
    );
    // Squat sets: 2 working.
    await db.runAsync(
      `INSERT INTO template_set (id, template_exercise_id, position, set_kind,
         reps, weight, parent_set_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      'ts-s1', 'te-squat', 0, 'working', 5, 100, null, null,
    );
    await db.runAsync(
      `INSERT INTO template_set (id, template_exercise_id, position, set_kind,
         reps, weight, parent_set_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      'ts-s2', 'te-squat', 1, 'working', 5, 100, null, null,
    );
    return id;
  }

  /**
   * Seed the TARGET template — a single-exercise Deadlift template with a
   * distinct identity so we can prove identity is preserved + old body wiped.
   */
  async function seedTargetTemplate(id = 'tgt-tpl'): Promise<string> {
    await createTemplate(db, { id, name: 'Target Day', now: () => 2000 });
    await db.runAsync(
      `UPDATE template SET program_id = ?, sub_tag = ?, color_hex = ? WHERE id = ?`,
      'prog-A',
      'TGT-INT',
      '#999999',
      id,
    );
    await db.runAsync(
      `INSERT INTO template_exercise
         (id, template_id, exercise_id, ordering, default_sets, default_reps,
          default_weight_kg, is_evergreen, parent_id, rest_seconds,
          reusable_superset_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'te-dl',
      id,
      dlId,
      1,
      5,
      5,
      120,
      0,
      null,
      180,
      null,
      2000,
    );
    await db.runAsync(
      `INSERT INTO template_set (id, template_exercise_id, position, set_kind,
         reps, weight, parent_set_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      'ts-dl1', 'te-dl', 0, 'working', 5, 120, null, 'old set',
    );
    return id;
  }

  it('replaces the target body with the source body, preserving nested structure', async () => {
    const srcId = await seedSourceTemplate();
    const tgtId = await seedTargetTemplate();

    await overwriteTemplateBody(db, {
      source_template_id: srcId,
      target_template_id: tgtId,
      uuid: makeUuidGen('o'),
      now: () => 5000,
    });

    // Target exercises now mirror the source (2 exercises, ordering preserved).
    const tgtEx = await db.getAllAsync<{
      id: string;
      exercise_id: string;
      ordering: number;
      default_sets: number;
      default_reps: number | null;
      default_weight_kg: number | null;
      is_evergreen: 0 | 1;
      parent_id: string | null;
      rest_seconds: number | null;
      reusable_superset_id: string | null;
    }>(
      `SELECT id, exercise_id, ordering, default_sets, default_reps,
              default_weight_kg, is_evergreen, parent_id, rest_seconds,
              reusable_superset_id
         FROM template_exercise WHERE template_id = ? ORDER BY ordering ASC`,
      tgtId,
    );
    expect(tgtEx.length).toBe(2);

    // Bench parent.
    expect(tgtEx[0].exercise_id).toBe(benchId);
    expect(tgtEx[0].ordering).toBe(1);
    expect(tgtEx[0].default_sets).toBe(3);
    expect(tgtEx[0].default_reps).toBe(8);
    expect(tgtEx[0].default_weight_kg).toBe(80);
    expect(tgtEx[0].parent_id).toBeNull();
    expect(tgtEx[0].rest_seconds).toBe(90);
    // New id — NOT the source's te-bench (source untouched, copies get fresh ids).
    expect(tgtEx[0].id).not.toBe('te-bench');

    // Squat child — parent_id remapped to the NEW bench id (superset cluster).
    expect(tgtEx[1].exercise_id).toBe(squatId);
    expect(tgtEx[1].ordering).toBe(2);
    expect(tgtEx[1].is_evergreen).toBe(1);
    expect(tgtEx[1].parent_id).toBe(tgtEx[0].id);
    expect(tgtEx[1].id).not.toBe('te-squat');

    // reusable_superset_id carried verbatim on both rows.
    expect(tgtEx[0].reusable_superset_id).toBe('rs-pair-1');
    expect(tgtEx[1].reusable_superset_id).toBe('rs-pair-1');

    // Bench sets: dropset parent_set_id remapped to the NEW working set.
    const benchSets = await db.getAllAsync<{
      id: string;
      position: number;
      set_kind: string;
      reps: number;
      weight: number;
      parent_set_id: string | null;
      notes: string | null;
    }>(
      `SELECT id, position, set_kind, reps, weight, parent_set_id, notes
         FROM template_set WHERE template_exercise_id = ? ORDER BY position ASC`,
      tgtEx[0].id,
    );
    expect(benchSets.length).toBe(4);
    expect(benchSets.map((s) => s.set_kind)).toEqual([
      'warmup',
      'working',
      'working',
      'dropset',
    ]);
    expect(benchSets[0].notes).toBe('warm');
    // Dropset (position 3) points at the working set at position 2 — by NEW id.
    expect(benchSets[3].parent_set_id).toBe(benchSets[2].id);
    expect(benchSets[3].id).not.toBe('ts-b4');

    const squatSets = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM template_set WHERE template_exercise_id = ?`,
      tgtEx[1].id,
    );
    expect(squatSets.length).toBe(2);

    // Old target body (Deadlift te-dl + ts-dl1) is gone.
    const stale = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM template_exercise WHERE id = 'te-dl'`,
    );
    expect(stale).toBeNull();
  });

  it('preserves the target identity (id / name / program_id / sub_tag / color_hex)', async () => {
    const srcId = await seedSourceTemplate();
    const tgtId = await seedTargetTemplate();

    await overwriteTemplateBody(db, {
      source_template_id: srcId,
      target_template_id: tgtId,
      uuid: makeUuidGen('o'),
      now: () => 5000,
    });

    const tgt = await db.getFirstAsync<{
      id: string;
      name: string;
      program_id: string | null;
      sub_tag: string | null;
      color_hex: string | null;
      updated_at: number;
    }>(
      `SELECT id, name, program_id, sub_tag, color_hex, updated_at
         FROM template WHERE id = ?`,
      tgtId,
    );
    expect(tgt).not.toBeNull();
    expect(tgt!.id).toBe(tgtId);
    expect(tgt!.name).toBe('Target Day'); // NOT 'Source Day'
    expect(tgt!.program_id).toBe('prog-A');
    expect(tgt!.sub_tag).toBe('TGT-INT'); // NOT 'SRC-INT'
    expect(tgt!.color_hex).toBe('#999999'); // NOT '#111111'
    expect(tgt!.updated_at).toBe(5000); // bumped
  });

  it('leaves the source row + its body untouched', async () => {
    const srcId = await seedSourceTemplate();
    const tgtId = await seedTargetTemplate();

    await overwriteTemplateBody(db, {
      source_template_id: srcId,
      target_template_id: tgtId,
      uuid: makeUuidGen('o'),
    });

    const src = await db.getFirstAsync<{
      name: string;
      sub_tag: string | null;
      color_hex: string | null;
    }>(`SELECT name, sub_tag, color_hex FROM template WHERE id = ?`, srcId);
    expect(src!.name).toBe('Source Day');
    expect(src!.sub_tag).toBe('SRC-INT');
    expect(src!.color_hex).toBe('#111111');

    // Source body rows keep their ORIGINAL ids (proves copies got fresh ids).
    const srcEx = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM template_exercise WHERE template_id = ? ORDER BY id`,
      srcId,
    );
    expect(srcEx.map((r) => r.id).sort()).toEqual(['te-bench', 'te-squat']);

    const srcSets = await db.getAllAsync<{ id: string }>(
      `SELECT ts.id FROM template_set ts
         JOIN template_exercise te ON te.id = ts.template_exercise_id
        WHERE te.template_id = ? ORDER BY ts.id`,
      srcId,
    );
    expect(srcSets.length).toBe(6);
  });

  it('replaces the target with an empty body when the source is empty', async () => {
    // Source with NO exercises.
    await createTemplate(db, { id: 'empty-src', name: 'Empty', now: () => 1000 });
    const tgtId = await seedTargetTemplate();

    await overwriteTemplateBody(db, {
      source_template_id: 'empty-src',
      target_template_id: tgtId,
      uuid: makeUuidGen('o'),
      now: () => 5000,
    });

    const tgtEx = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM template_exercise WHERE template_id = ?`,
      tgtId,
    );
    expect(tgtEx.length).toBe(0);
    const tgtSets = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM template_set WHERE template_exercise_id = 'te-dl'`,
    );
    expect(tgtSets.length).toBe(0);

    // Identity + updated_at still intact.
    const tgt = await db.getFirstAsync<{ name: string; updated_at: number }>(
      `SELECT name, updated_at FROM template WHERE id = ?`,
      tgtId,
    );
    expect(tgt!.name).toBe('Target Day');
    expect(tgt!.updated_at).toBe(5000);
  });

  it('throws SOURCE_TEMPLATE_NOT_FOUND when the source is missing', async () => {
    const tgtId = await seedTargetTemplate();
    await expect(
      overwriteTemplateBody(db, {
        source_template_id: 'does-not-exist',
        target_template_id: tgtId,
        uuid: makeUuidGen('o'),
      }),
    ).rejects.toThrow('SOURCE_TEMPLATE_NOT_FOUND');

    // Target body untouched on the failed call.
    const tgtEx = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM template_exercise WHERE template_id = ?`,
      tgtId,
    );
    expect(tgtEx.length).toBe(1);
  });

  it('throws TARGET_TEMPLATE_NOT_FOUND when the target is missing', async () => {
    const srcId = await seedSourceTemplate();
    await expect(
      overwriteTemplateBody(db, {
        source_template_id: srcId,
        target_template_id: 'does-not-exist',
        uuid: makeUuidGen('o'),
      }),
    ).rejects.toThrow('TARGET_TEMPLATE_NOT_FOUND');
  });
});
