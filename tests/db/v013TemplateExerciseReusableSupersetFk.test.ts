import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { v013_template_exercise_reusable_superset_fk } from '../../src/db/schema/v013_template_exercise_reusable_superset_fk';

/**
 * v013 migration tests — ADD template_exercise.reusable_superset_id FK
 * (ADR-0017 L154 amendment, slice 9.8b grill Q4).
 *
 * 覆蓋:
 *   - ADD COLUMN succeeds; column appears with TEXT type, nullable
 *   - ON DELETE SET NULL: deleting superset clears FK on rows (rows survive)
 *   - 既有 row (rs_id 未設) 升級後欄位為 NULL
 *   - Re-running migrate is idempotent (column already exists → no-op)
 */
describe('v013 template_exercise.reusable_superset_id FK migration', () => {
  let db: BetterSqliteDatabase;

  beforeEach(() => {
    db = new BetterSqliteDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('adds reusable_superset_id column to template_exercise', async () => {
    await migrate(db);
    const cols = await db.getAllAsync<{ name: string; type: string; notnull: number }>(
      `PRAGMA table_info(template_exercise)`
    );
    const rsCol = cols.find((c) => c.name === 'reusable_superset_id');
    expect(rsCol).toBeDefined();
    expect(rsCol!.type).toBe('TEXT');
    // nullable — explode model 解耦, solo rows + manual cluster rows 永遠 NULL
    expect(rsCol!.notnull).toBe(0);
  });

  it('declares ON DELETE SET NULL — superset deletion clears FK, row survives', async () => {
    await migrate(db);

    // Enable FK enforcement (off by default in SQLite per connection).
    await db.execAsync(`PRAGMA foreign_keys = ON;`);

    const benchId = '00000000-0000-4000-8000-000000000001';
    const squatId = '00000000-0000-4000-8000-000000000002';
    const now = Date.now();

    // Seed a reusable superset + 2 link rows
    await db.runAsync(
      `INSERT INTO superset (id, name, color_hex, use_count, created_at, updated_at)
       VALUES ('s1', '胸+深', NULL, 0, ?, ?)`,
      now,
      now
    );
    await db.runAsync(
      `INSERT INTO superset_exercise (superset_id, position, exercise_id) VALUES ('s1', 0, ?)`,
      benchId
    );
    await db.runAsync(
      `INSERT INTO superset_exercise (superset_id, position, exercise_id) VALUES ('s1', 1, ?)`,
      squatId
    );

    // Seed a template with a cluster exploded from s1 (parent + child both stamped rs_id)
    await db.runAsync(
      `INSERT INTO template (id, name, created_at, updated_at) VALUES ('tpl-1', 'Push', ?, ?)`,
      now,
      now
    );
    await db.runAsync(
      `INSERT INTO template_exercise
         (id, template_id, exercise_id, ordering, default_sets, parent_id, reusable_superset_id, updated_at)
       VALUES ('te-parent', 'tpl-1', ?, 0, 3, NULL, 's1', ?)`,
      benchId,
      now
    );
    await db.runAsync(
      `INSERT INTO template_exercise
         (id, template_id, exercise_id, ordering, default_sets, parent_id, reusable_superset_id, updated_at)
       VALUES ('te-child', 'tpl-1', ?, 1, 3, 'te-parent', 's1', ?)`,
      squatId,
      now
    );

    // Delete the reusable superset (Library 端砍掉)
    await db.runAsync(`DELETE FROM superset WHERE id = 's1'`);

    // Rows still exist (cluster 仍存活)
    const rows = await db.getAllAsync<{ id: string; reusable_superset_id: string | null }>(
      `SELECT id, reusable_superset_id FROM template_exercise WHERE template_id = 'tpl-1'`
    );
    expect(rows).toHaveLength(2);
    // FK cleared (ON DELETE SET NULL kicked in)
    for (const r of rows) {
      expect(r.reusable_superset_id).toBeNull();
    }
  });

  it('leaves pre-existing rows with NULL reusable_superset_id after upgrade', async () => {
    // Manual replay: stop at v012, INSERT a row, then run v013 alone and
    // verify the new column is NULL on existing rows.
    const { v001_initial } = await import('../../src/db/schema/v001_initial');
    const { v002_more_exercises } = await import('../../src/db/schema/v002_more_exercises');
    const { v003_templates } = await import('../../src/db/schema/v003_templates');
    const { v004_evergreen_zone } = await import('../../src/db/schema/v004_evergreen_zone');
    const { v005_program } = await import('../../src/db/schema/v005_program');
    const { v006_muscle_layer } = await import('../../src/db/schema/v006_muscle_layer');
    const { v007_body_metric } = await import('../../src/db/schema/v007_body_metric');
    const { v008_achievements } = await import('../../src/db/schema/v008_achievements');
    const { v009_template_set } = await import('../../src/db/schema/v009_template_set');
    const { v010_exercise_library_v2 } = await import(
      '../../src/db/schema/v010_exercise_library_v2'
    );
    const { v011_reusable_superset } = await import(
      '../../src/db/schema/v011_reusable_superset'
    );
    const { v012_drop_template_exercise_notes } = await import(
      '../../src/db/schema/v012_drop_template_exercise_notes'
    );

    await v001_initial(db);
    await v002_more_exercises(db);
    await v003_templates(db);
    await v004_evergreen_zone(db);
    await v005_program(db);
    await v006_muscle_layer(db);
    await v007_body_metric(db);
    await v008_achievements(db);
    await v009_template_set(db);
    await v010_exercise_library_v2(db);
    await v011_reusable_superset(db);
    await v012_drop_template_exercise_notes(db);

    const benchId = '00000000-0000-4000-8000-000000000001';
    const now = Date.now();
    await db.runAsync(
      `INSERT INTO template (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      'tpl-1',
      'Push',
      now,
      now
    );
    await db.runAsync(
      `INSERT INTO template_exercise
         (id, template_id, exercise_id, ordering, default_sets, updated_at)
       VALUES ('te-1', 'tpl-1', ?, 0, 3, ?)`,
      benchId,
      now
    );

    await v013_template_exercise_reusable_superset_fk(db);

    const row = await db.getFirstAsync<{ reusable_superset_id: string | null }>(
      `SELECT reusable_superset_id FROM template_exercise WHERE id = 'te-1'`
    );
    expect(row).not.toBeNull();
    expect(row!.reusable_superset_id).toBeNull();
  });

  it('is idempotent — runs cleanly when the column already exists', async () => {
    await migrate(db);
    await expect(
      v013_template_exercise_reusable_superset_fk(db)
    ).resolves.toBeUndefined();
  });
});
