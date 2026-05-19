import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  addTemplateExercise,
  createTemplate,
  listTemplateGroupsByName,
} from '../../src/adapters/sqlite/templateRepository';
import { createProgram } from '../../src/adapters/sqlite/programRepository';
import { listExercises } from '../../src/adapters/sqlite/exerciseRepository';

/**
 * Round 41 polish — `listTemplateGroupsByName` repo func.
 *
 * Templates tab list view dedupes by `name`, keeping the most-recent-edited
 * sibling as the representative (Q1 = B). ADR-0003 三元組 identity保留現況；
 * dedupe is purely a UI-layer concern. Other callers (today / program / wizard)
 * still use `listTemplates` to see every variant.
 */
describe('listTemplateGroupsByName (round 41 polish)', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
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
   * Helper — seed a template with a specific (name, program_id, sub_tag) +
   * a deterministic `updated_at` so each test can assert which sibling won
   * the dedupe race.
   */
  async function seedTemplate(args: {
    id: string;
    name: string;
    program_id: string | null;
    sub_tag: string | null;
    updated_at: number;
  }) {
    await createTemplate(db, { id: args.id, name: args.name });
    await db.runAsync(
      `UPDATE template SET program_id = ?, sub_tag = ?, updated_at = ? WHERE id = ?`,
      args.program_id,
      args.sub_tag,
      args.updated_at,
      args.id
    );
  }

  it('returns [] when no templates exist', async () => {
    const rows = await listTemplateGroupsByName(db);
    expect(rows).toEqual([]);
  });

  it('returns every row when all template names are distinct', async () => {
    await seedTemplate({
      id: 'tpl-1',
      name: 'Push',
      program_id: 'prog-A',
      sub_tag: null,
      updated_at: 1000,
    });
    await seedTemplate({
      id: 'tpl-2',
      name: 'Pull',
      program_id: 'prog-A',
      sub_tag: null,
      updated_at: 2000,
    });
    await seedTemplate({
      id: 'tpl-3',
      name: 'Legs',
      program_id: 'prog-B',
      sub_tag: '5x5',
      updated_at: 3000,
    });
    const rows = await listTemplateGroupsByName(db);
    // Sorted by updated_at DESC.
    expect(rows.map((r) => r.id)).toEqual(['tpl-3', 'tpl-2', 'tpl-1']);
  });

  it('dedupes same-name siblings keeping the most-recent-edited as representative', async () => {
    await seedTemplate({
      id: 'tpl-old',
      name: 'Smoke',
      program_id: 'prog-A',
      sub_tag: 'TEST-1',
      updated_at: 1000,
    });
    await seedTemplate({
      id: 'tpl-mid',
      name: 'Smoke',
      program_id: 'prog-A',
      sub_tag: 'TEST-2',
      updated_at: 2000,
    });
    await seedTemplate({
      id: 'tpl-newest',
      name: 'Smoke',
      program_id: 'prog-B',
      sub_tag: 'TEST-1',
      updated_at: 3000,
    });
    const rows = await listTemplateGroupsByName(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('tpl-newest');
    expect(rows[0].name).toBe('Smoke');
  });

  it('mixes distinct names + same-name group → one row per name', async () => {
    // Two distinct-name templates.
    await seedTemplate({
      id: 'tpl-push',
      name: 'Push',
      program_id: 'prog-A',
      sub_tag: null,
      updated_at: 500,
    });
    await seedTemplate({
      id: 'tpl-pull',
      name: 'Pull',
      program_id: 'prog-A',
      sub_tag: null,
      updated_at: 700,
    });
    // Three siblings under name "Smoke".
    await seedTemplate({
      id: 'tpl-s1',
      name: 'Smoke',
      program_id: 'prog-A',
      sub_tag: null,
      updated_at: 1000,
    });
    await seedTemplate({
      id: 'tpl-s2',
      name: 'Smoke',
      program_id: 'prog-A',
      sub_tag: 'A',
      updated_at: 1500,
    });
    await seedTemplate({
      id: 'tpl-s3',
      name: 'Smoke',
      program_id: 'prog-B',
      sub_tag: 'B',
      updated_at: 2500,
    });
    const rows = await listTemplateGroupsByName(db);
    expect(rows).toHaveLength(3);
    // Sorted by updated_at DESC: Smoke (rep=tpl-s3, 2500) → Pull (700) → Push (500).
    expect(rows.map((r) => r.id)).toEqual(['tpl-s3', 'tpl-pull', 'tpl-push']);
  });

  it('exerciseCount reflects only the representative row\'s exercises (not aggregated across siblings)', async () => {
    await seedTemplate({
      id: 'tpl-old',
      name: 'Smoke',
      program_id: 'prog-A',
      sub_tag: 'TEST-1',
      updated_at: 1000,
    });
    await seedTemplate({
      id: 'tpl-newest',
      name: 'Smoke',
      program_id: 'prog-A',
      sub_tag: 'TEST-2',
      updated_at: 2000,
    });

    // Pull a couple of seeded exercises from the library.
    const exercises = await listExercises(db);
    const ex1 = exercises[0];
    const ex2 = exercises[1];

    // Old sibling has 1 exercise; newest (representative) has 2.
    let counter = 0;
    const uuid = () => `te-${++counter}`;

    await addTemplateExercise(db, {
      template_id: 'tpl-old',
      exercise_id: ex1.id,
      default_sets: 3,
      default_reps: 5,
      default_weight_kg: null,
      uuid,
    });
    await addTemplateExercise(db, {
      template_id: 'tpl-newest',
      exercise_id: ex1.id,
      default_sets: 3,
      default_reps: 5,
      default_weight_kg: null,
      uuid,
    });
    await addTemplateExercise(db, {
      template_id: 'tpl-newest',
      exercise_id: ex2.id,
      default_sets: 4,
      default_reps: 8,
      default_weight_kg: null,
      uuid,
    });

    // addTemplateExercise bumps updated_at — re-pin so the assertion stays
    // deterministic against the representative we set up.
    await db.runAsync(
      `UPDATE template SET updated_at = ? WHERE id = ?`,
      1000,
      'tpl-old'
    );
    await db.runAsync(
      `UPDATE template SET updated_at = ? WHERE id = ?`,
      2000,
      'tpl-newest'
    );

    const rows = await listTemplateGroupsByName(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('tpl-newest');
    expect(rows[0].exerciseCount).toBe(2);
  });
});
