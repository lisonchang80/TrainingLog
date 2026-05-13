import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { v012_drop_template_exercise_notes } from '../../src/db/schema/v012_drop_template_exercise_notes';

/**
 * v012 migration acceptance tests — phased DROP COLUMN finale (slice 9.6,
 * ADR-0017 amendment to ADR-0013).
 *
 * 覆蓋:
 *   - DROPs `template_exercise.notes` column
 *   - v010 ADD COLUMN + backfill 不被回滾（migration 順序保留）
 *   - exercise.notes 從 v010 backfill 還在原處
 *   - Re-running migrate is idempotent (column already gone → no-op)
 *   - existing template_exercise rows survive the DROP (no row loss)
 */
describe('v012 drop template_exercise.notes migration', () => {
  let db: BetterSqliteDatabase;

  beforeEach(() => {
    db = new BetterSqliteDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('drops template_exercise.notes column', async () => {
    await migrate(db);
    const cols = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info(template_exercise)`
    );
    const colNames = cols.map((c) => c.name);
    expect(colNames).not.toContain('notes');
  });

  it('keeps the rest of the template_exercise columns intact', async () => {
    await migrate(db);
    const cols = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info(template_exercise)`
    );
    const colNames = new Set(cols.map((c) => c.name));
    // Columns established by v003 / v009 that should survive the DROP
    for (const expected of [
      'id',
      'template_id',
      'exercise_id',
      'ordering',
      'default_sets',
      'is_evergreen',
      'parent_id',
      'rest_seconds',
      'updated_at',
    ]) {
      expect(colNames.has(expected)).toBe(true);
    }
  });

  it('leaves exercise.notes (the new global column) intact', async () => {
    await migrate(db);
    const cols = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info(exercise)`
    );
    expect(cols.map((c) => c.name)).toContain('notes');
  });

  it('preserves existing template_exercise rows through the DROP', async () => {
    // Manual replay: stop at v011, INSERT a row, then run v012 alone and
    // verify the row survives the DROP COLUMN.
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
         (id, template_id, exercise_id, ordering, default_sets, notes, updated_at)
       VALUES ('te-1', 'tpl-1', ?, 0, 3, 'soon-dropped', ?)`,
      benchId,
      now
    );

    await v012_drop_template_exercise_notes(db);

    const row = await db.getFirstAsync<{ id: string; exercise_id: string }>(
      `SELECT id, exercise_id FROM template_exercise WHERE id = 'te-1'`
    );
    expect(row).not.toBeNull();
    expect(row!.exercise_id).toBe(benchId);
  });

  it('is idempotent — runs cleanly when the column is already gone', async () => {
    await migrate(db);
    // Second run on the already-DROPped schema should NOT throw
    await expect(v012_drop_template_exercise_notes(db)).resolves.toBeUndefined();
  });
});
