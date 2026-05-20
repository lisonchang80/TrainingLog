import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { v021_drop_template_exercise_rest_sec } from '../../src/db/schema/v021_drop_template_exercise_rest_sec';

/**
 * v021 migration acceptance tests — DROP orphan `template_exercise.rest_sec`
 * (ADR-0019 § Slice 10b follow-up; overnight C 2026-05-21).
 *
 * Coverage:
 *   - Full migrate chain leaves `template_exercise.rest_sec` GONE
 *   - Canonical `template_exercise.rest_seconds` (v009) is preserved
 *   - Sibling `session_exercise.rest_sec` (v016) is NOT collateral damage
 *   - Existing template_exercise rows survive the DROP (no row loss)
 *   - Re-running v021 on the already-dropped schema is a no-op (idempotent)
 *   - Other template_exercise columns survive the DROP intact
 */
describe('v021 drop orphan template_exercise.rest_sec migration', () => {
  let db: BetterSqliteDatabase;

  beforeEach(() => {
    db = new BetterSqliteDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('drops template_exercise.rest_sec column after full migrate', async () => {
    await migrate(db);
    const cols = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info(template_exercise)`,
    );
    const colNames = cols.map((c) => c.name);
    expect(colNames).not.toContain('rest_sec');
  });

  it('keeps the canonical template_exercise.rest_seconds (v009) column intact', async () => {
    await migrate(db);
    const cols = await db.getAllAsync<{ name: string; type: string; notnull: number }>(
      `PRAGMA table_info(template_exercise)`,
    );
    const col = cols.find((c) => c.name === 'rest_seconds');
    expect(col).toBeDefined();
    expect(col!.type).toBe('INTEGER');
    expect(col!.notnull).toBe(0);
  });

  it('does NOT touch session_exercise.rest_sec (canonical session-side column)', async () => {
    await migrate(db);
    const cols = await db.getAllAsync<{ name: string; type: string; notnull: number }>(
      `PRAGMA table_info(session_exercise)`,
    );
    const col = cols.find((c) => c.name === 'rest_sec');
    expect(col).toBeDefined();
    expect(col!.type).toBe('INTEGER');
    expect(col!.notnull).toBe(0);
  });

  it('preserves the rest of template_exercise columns through the DROP', async () => {
    await migrate(db);
    const cols = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info(template_exercise)`,
    );
    const colNames = new Set(cols.map((c) => c.name));
    // Columns established by v003 / v009 / v013 that should survive the DROP
    for (const expected of [
      'id',
      'template_id',
      'exercise_id',
      'ordering',
      'default_sets',
      'is_evergreen',
      'parent_id',
      'rest_seconds',
      'reusable_superset_id',
      'updated_at',
    ]) {
      expect(colNames.has(expected)).toBe(true);
    }
  });

  it('preserves existing template_exercise rows through the DROP', async () => {
    // Manual replay: stop at v020 (one step before v021), INSERT a row with
    // explicit `rest_sec` AND `rest_seconds` values, then run v021 alone and
    // verify (a) the row survives, (b) `rest_seconds` value is intact, and
    // (c) `rest_sec` column is gone.
    const { v001_initial } = await import('../../src/db/schema/v001_initial');
    const { v002_more_exercises } = await import(
      '../../src/db/schema/v002_more_exercises'
    );
    const { v003_templates } = await import('../../src/db/schema/v003_templates');
    const { v004_evergreen_zone } = await import(
      '../../src/db/schema/v004_evergreen_zone'
    );
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
    const { v013_template_exercise_reusable_superset_fk } = await import(
      '../../src/db/schema/v013_template_exercise_reusable_superset_fk'
    );
    const { v014_session_exercise_cluster } = await import(
      '../../src/db/schema/v014_session_exercise_cluster'
    );
    const { v015_set_kind_and_clusters } = await import(
      '../../src/db/schema/v015_set_kind_and_clusters'
    );
    const { v016_session_runtime_data } = await import(
      '../../src/db/schema/v016_session_runtime_data'
    );
    const { v017_program_none_seed } = await import(
      '../../src/db/schema/v017_program_none_seed'
    );
    const { v018_set_notes } = await import('../../src/db/schema/v018_set_notes');
    const { v019_set_session_exercise_id } = await import(
      '../../src/db/schema/v019_set_session_exercise_id'
    );
    const { v020_template_color_backfill } = await import(
      '../../src/db/schema/v020_template_color_backfill'
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
    await v013_template_exercise_reusable_superset_fk(db);
    await v014_session_exercise_cluster(db);
    await v015_set_kind_and_clusters(db);
    await v016_session_runtime_data(db);
    await v017_program_none_seed(db);
    await v018_set_notes(db);
    await v019_set_session_exercise_id(db);
    await v020_template_color_backfill(db);

    const benchId = '00000000-0000-4000-8000-000000000001';
    const now = Date.now();
    await db.runAsync(
      `INSERT INTO template (id, name, color_hex, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      'tpl-1',
      'Push',
      '#ff0000',
      now,
      now,
    );
    await db.runAsync(
      `INSERT INTO template_exercise
         (id, template_id, exercise_id, ordering, default_sets,
          is_evergreen, rest_sec, rest_seconds, updated_at)
       VALUES (?, ?, ?, 0, 3, 0, ?, ?, ?)`,
      'te-1',
      'tpl-1',
      benchId,
      120, // orphan rest_sec value — about to vanish
      90, // canonical rest_seconds value — must survive
      now,
    );

    await v021_drop_template_exercise_rest_sec(db);

    const row = await db.getFirstAsync<{
      id: string;
      exercise_id: string;
      rest_seconds: number | null;
    }>(
      `SELECT id, exercise_id, rest_seconds FROM template_exercise WHERE id = 'te-1'`,
    );
    expect(row).not.toBeNull();
    expect(row!.exercise_id).toBe(benchId);
    expect(row!.rest_seconds).toBe(90);

    // Confirm the orphan column is gone.
    const cols = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info(template_exercise)`,
    );
    expect(cols.map((c) => c.name)).not.toContain('rest_sec');
  });

  it('is idempotent — runs cleanly when the column is already gone', async () => {
    await migrate(db);
    // Column already dropped by the chain — a second direct invocation
    // should silently no-op (PRAGMA guard short-circuits).
    await expect(
      v021_drop_template_exercise_rest_sec(db),
    ).resolves.toBeUndefined();
    const cols = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info(template_exercise)`,
    );
    expect(cols.map((c) => c.name)).not.toContain('rest_sec');
  });
});
