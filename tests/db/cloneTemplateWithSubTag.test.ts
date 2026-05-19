import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { listExercises } from '../../src/adapters/sqlite/exerciseRepository';
import {
  cloneTemplateWithSubTag,
  createTemplate,
} from '../../src/adapters/sqlite/templateRepository';
import { createProgram } from '../../src/adapters/sqlite/programRepository';

/**
 * Round 37 polish — `cloneTemplateWithSubTag` repo func.
 *
 * Spawns a deep clone of an existing template under a new (program, sub_tag)
 * pair so the start-template-sheet「新增強度」inline flow can bind the
 * upcoming session to a fresh row without polluting the source template.
 *
 * Coverage:
 *   1. Deep clone: template_exercise + template_set rows fully copied,
 *      ordering preserved, parent_id remap correct.
 *   2. Source template untouched (row counts unchanged).
 *   3. reusable_superset_id preserved verbatim.
 *   4. Dup triple → throw `DUPLICATE_TEMPLATE_TRIPLE`.
 *   5. Same sub_tag under a different program → OK (different identity).
 */
describe('cloneTemplateWithSubTag (round 37 polish)', () => {
  let db: BetterSqliteDatabase;
  let benchId: string;
  let squatId: string;

  // Deterministic uuid generator — `id-1`, `id-2`, ... so tests can assert
  // specific output ids if needed (but mostly we just verify row counts /
  // column values).
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
    // Two programs for the cross-program identity case.
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
    await createProgram(db, {
      program: {
        id: 'prog-B',
        name: 'Program B',
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
   * Seed a 2-exercise template with 3-set rows + 1 dropset chain so we can
   * verify parent_id / parent_set_id remapping. Returns the source template id.
   */
  async function seedSourceTemplate(): Promise<string> {
    const tplId = 'src-tpl';
    // Seed a reusable_superset row first so the FK on template_exercise.
    // reusable_superset_id holds. (Re-insert silently OK across multiple test
    // invocations within the same test? No — beforeEach gives a fresh db.)
    await db.runAsync(
      `INSERT INTO superset (id, name, color_hex, use_count, created_at, updated_at)
       VALUES (?, ?, NULL, 0, ?, ?)`,
      'rs-pair-1',
      'Push RS',
      1000,
      1000
    );
    await createTemplate(db, { id: tplId, name: 'Push Day', now: () => 1000 });
    await db.runAsync(
      `UPDATE template SET program_id = ?, sub_tag = ?, color_hex = ?
        WHERE id = ?`,
      'prog-A',
      null,
      '#0a7ea4',
      tplId
    );
    // Two template_exercise rows: Bench parent + Squat with parent_id=bench
    // (artificial pairing to test parent_id remap — not necessarily a valid
    // RS pair, but the FK doesn't care).
    await db.runAsync(
      `INSERT INTO template_exercise
         (id, template_id, exercise_id, ordering, default_sets,
          default_reps, default_weight_kg, is_evergreen, parent_id,
          rest_seconds, reusable_superset_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'te-bench',
      tplId,
      benchId,
      1,
      3,
      8,
      80,
      0,
      null,
      90,
      'rs-pair-1',
      1000
    );
    await db.runAsync(
      `INSERT INTO template_exercise
         (id, template_id, exercise_id, ordering, default_sets,
          default_reps, default_weight_kg, is_evergreen, parent_id,
          rest_seconds, reusable_superset_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'te-squat',
      tplId,
      squatId,
      2,
      2,
      5,
      100,
      1,
      'te-bench',
      120,
      'rs-pair-1',
      1000
    );
    // Bench sets: 1 warmup + 2 working + 1 dropset chained to last working.
    await db.runAsync(
      `INSERT INTO template_set
         (id, template_exercise_id, position, set_kind, reps, weight,
          parent_set_id, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      'ts-b1',
      'te-bench',
      0,
      'warmup',
      10,
      40,
      null,
      'warm'
    );
    await db.runAsync(
      `INSERT INTO template_set
         (id, template_exercise_id, position, set_kind, reps, weight,
          parent_set_id, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      'ts-b2',
      'te-bench',
      1,
      'working',
      8,
      80,
      null,
      null
    );
    await db.runAsync(
      `INSERT INTO template_set
         (id, template_exercise_id, position, set_kind, reps, weight,
          parent_set_id, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      'ts-b3',
      'te-bench',
      2,
      'working',
      8,
      80,
      null,
      null
    );
    await db.runAsync(
      `INSERT INTO template_set
         (id, template_exercise_id, position, set_kind, reps, weight,
          parent_set_id, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      'ts-b4',
      'te-bench',
      3,
      'dropset',
      6,
      60,
      'ts-b3',
      'drop'
    );
    // Squat sets: 2 working.
    await db.runAsync(
      `INSERT INTO template_set
         (id, template_exercise_id, position, set_kind, reps, weight,
          parent_set_id, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      'ts-s1',
      'te-squat',
      0,
      'working',
      5,
      100,
      null,
      null
    );
    await db.runAsync(
      `INSERT INTO template_set
         (id, template_exercise_id, position, set_kind, reps, weight,
          parent_set_id, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      'ts-s2',
      'te-squat',
      1,
      'working',
      5,
      100,
      null,
      null
    );
    return tplId;
  }

  it('deep-clones template_exercise + template_set with ordering preserved + parent_id remap', async () => {
    const srcId = await seedSourceTemplate();
    const newId = await cloneTemplateWithSubTag(db, {
      source_template_id: srcId,
      new_program_id: 'prog-A',
      new_sub_tag: 'TEST-1',
      uuid: makeUuidGen('c'),
      now: () => 5000,
    });

    // Header check: new row exists with the right triple + name inherited.
    const newRow = await db.getFirstAsync<{
      id: string;
      name: string;
      program_id: string | null;
      sub_tag: string | null;
      created_at: number;
      updated_at: number;
    }>(`SELECT id, name, program_id, sub_tag, created_at, updated_at
          FROM template WHERE id = ?`, newId);
    expect(newRow).not.toBeNull();
    expect(newRow!.name).toBe('Push Day');
    expect(newRow!.program_id).toBe('prog-A');
    expect(newRow!.sub_tag).toBe('TEST-1');
    expect(newRow!.created_at).toBe(5000);

    // template_exercise count + ordering check.
    const newExRows = await db.getAllAsync<{
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
      newId
    );
    expect(newExRows.length).toBe(2);

    // Bench row (ordering=1, parent=null).
    expect(newExRows[0].exercise_id).toBe(benchId);
    expect(newExRows[0].ordering).toBe(1);
    expect(newExRows[0].default_sets).toBe(3);
    expect(newExRows[0].default_reps).toBe(8);
    expect(newExRows[0].default_weight_kg).toBe(80);
    expect(newExRows[0].is_evergreen).toBe(0);
    expect(newExRows[0].parent_id).toBeNull();
    expect(newExRows[0].rest_seconds).toBe(90);

    // Squat row (ordering=2, parent points to NEW bench id, not 'te-bench').
    expect(newExRows[1].exercise_id).toBe(squatId);
    expect(newExRows[1].ordering).toBe(2);
    expect(newExRows[1].is_evergreen).toBe(1);
    expect(newExRows[1].parent_id).toBe(newExRows[0].id);
    expect(newExRows[1].rest_seconds).toBe(120);

    // template_set count + ordering check.
    const newBenchSets = await db.getAllAsync<{
      id: string;
      position: number;
      set_kind: string;
      reps: number;
      weight: number;
      parent_set_id: string | null;
      notes: string | null;
    }>(
      `SELECT id, position, set_kind, reps, weight, parent_set_id, notes
         FROM template_set WHERE template_exercise_id = ?
         ORDER BY position ASC`,
      newExRows[0].id
    );
    expect(newBenchSets.length).toBe(4);
    expect(newBenchSets.map((s) => s.set_kind)).toEqual([
      'warmup',
      'working',
      'working',
      'dropset',
    ]);
    expect(newBenchSets[0].reps).toBe(10);
    expect(newBenchSets[0].weight).toBe(40);
    expect(newBenchSets[0].notes).toBe('warm');
    // Dropset's parent_set_id points to the NEW ts-b3 (working set at position 2).
    expect(newBenchSets[3].parent_set_id).toBe(newBenchSets[2].id);
    expect(newBenchSets[3].notes).toBe('drop');

    const newSquatSets = await db.getAllAsync<{ id: string; position: number }>(
      `SELECT id, position FROM template_set WHERE template_exercise_id = ?
         ORDER BY position ASC`,
      newExRows[1].id
    );
    expect(newSquatSets.length).toBe(2);
  });

  it('does not touch the source template (row counts + values unchanged)', async () => {
    const srcId = await seedSourceTemplate();

    const beforeEx = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM template_exercise WHERE template_id = ?`,
      srcId
    );
    const beforeSets = await db.getAllAsync<{ id: string }>(
      `SELECT ts.id FROM template_set ts
         JOIN template_exercise te ON te.id = ts.template_exercise_id
        WHERE te.template_id = ?`,
      srcId
    );

    await cloneTemplateWithSubTag(db, {
      source_template_id: srcId,
      new_program_id: 'prog-A',
      new_sub_tag: 'TEST-1',
      uuid: makeUuidGen('c'),
    });

    const afterEx = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM template_exercise WHERE template_id = ?`,
      srcId
    );
    const afterSets = await db.getAllAsync<{ id: string }>(
      `SELECT ts.id FROM template_set ts
         JOIN template_exercise te ON te.id = ts.template_exercise_id
        WHERE te.template_id = ?`,
      srcId
    );

    expect(afterEx.length).toBe(beforeEx.length);
    expect(afterSets.length).toBe(beforeSets.length);

    // Source still has its original ids + sub_tag = null.
    const src = await db.getFirstAsync<{ sub_tag: string | null }>(
      `SELECT sub_tag FROM template WHERE id = ?`,
      srcId
    );
    expect(src!.sub_tag).toBeNull();
  });

  it('preserves reusable_superset_id verbatim', async () => {
    const srcId = await seedSourceTemplate();
    const newId = await cloneTemplateWithSubTag(db, {
      source_template_id: srcId,
      new_program_id: 'prog-A',
      new_sub_tag: 'TEST-1',
      uuid: makeUuidGen('c'),
    });
    const rsRows = await db.getAllAsync<{ reusable_superset_id: string | null }>(
      `SELECT reusable_superset_id FROM template_exercise WHERE template_id = ?`,
      newId
    );
    expect(rsRows.length).toBe(2);
    for (const r of rsRows) {
      expect(r.reusable_superset_id).toBe('rs-pair-1');
    }
  });

  it('throws DUPLICATE_TEMPLATE_TRIPLE when the (name, program, sub_tag) triple already exists', async () => {
    const srcId = await seedSourceTemplate();
    // First clone succeeds.
    await cloneTemplateWithSubTag(db, {
      source_template_id: srcId,
      new_program_id: 'prog-A',
      new_sub_tag: 'TEST-1',
      uuid: makeUuidGen('c1'),
    });
    // Second clone of the same source under the same (program, sub_tag) →
    // triple collision (source name 'Push Day' + prog-A + 'TEST-1').
    await expect(
      cloneTemplateWithSubTag(db, {
        source_template_id: srcId,
        new_program_id: 'prog-A',
        new_sub_tag: 'TEST-1',
        uuid: makeUuidGen('c2'),
      })
    ).rejects.toThrow('DUPLICATE_TEMPLATE_TRIPLE');
  });

  it('allows same sub_tag under a different program (different identity triple)', async () => {
    const srcId = await seedSourceTemplate();
    const idA = await cloneTemplateWithSubTag(db, {
      source_template_id: srcId,
      new_program_id: 'prog-A',
      new_sub_tag: 'TEST-1',
      uuid: makeUuidGen('cA'),
    });
    const idB = await cloneTemplateWithSubTag(db, {
      source_template_id: srcId,
      new_program_id: 'prog-B',
      new_sub_tag: 'TEST-1',
      uuid: makeUuidGen('cB'),
    });
    expect(idA).not.toBe(idB);

    // Both rows exist with the same name + sub_tag but different program.
    const rows = await db.getAllAsync<{
      id: string;
      program_id: string | null;
      sub_tag: string | null;
    }>(
      `SELECT id, program_id, sub_tag FROM template
        WHERE name = 'Push Day' AND sub_tag = 'TEST-1'
        ORDER BY program_id ASC`
    );
    expect(rows.length).toBe(2);
    expect(rows[0].program_id).toBe('prog-A');
    expect(rows[1].program_id).toBe('prog-B');
  });
});
