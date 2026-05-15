import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { v014_session_exercise_cluster } from '../../src/db/schema/v014_session_exercise_cluster';

/**
 * v014 migration tests — ADD session_exercise.parent_id + reusable_superset_id
 * (ADR-0018, β' skip-on-ambiguity backfill).
 *
 * Coverage:
 *   - ADD COLUMN succeeds for both new columns; types + nullability correct
 *   - β' backfill copies rs_id + remaps parent_id for templated cluster sessions
 *   - β' skip-on-ambiguity: template with duplicate exercise_id → all sourced
 *     sessions stay NULL (no mislabeling)
 *   - Pre-v014 freestyle session (template_id NULL) stays NULL — not backfilled
 *   - Solo exercise stays NULL (parent_id IS NULL on template, rs_id NULL)
 *   - Re-running migration is idempotent (column already exists → no-op,
 *     backfill UPDATE re-applies same rows but `WHERE x IS NULL` predicates
 *     guarantee no double-write)
 */
describe('v014 session_exercise.parent_id + reusable_superset_id migration', () => {
  let db: BetterSqliteDatabase;
  const benchId = '00000000-0000-4000-8000-000000000001';
  const squatId = '00000000-0000-4000-8000-000000000002';
  const lateralId = '00000000-0000-4000-8000-000000000003';
  const now = Date.now();

  beforeEach(() => {
    db = new BetterSqliteDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('adds parent_id and reusable_superset_id columns to session_exercise', async () => {
    await migrate(db);
    const cols = await db.getAllAsync<{ name: string; type: string; notnull: number }>(
      `PRAGMA table_info(session_exercise)`
    );
    const parentCol = cols.find((c) => c.name === 'parent_id');
    const rsCol = cols.find((c) => c.name === 'reusable_superset_id');
    expect(parentCol).toBeDefined();
    expect(parentCol!.type).toBe('TEXT');
    expect(parentCol!.notnull).toBe(0);
    expect(rsCol).toBeDefined();
    expect(rsCol!.type).toBe('TEXT');
    expect(rsCol!.notnull).toBe(0);
  });

  it("backfills parent_id + rs_id for templated cluster sessions (β' normal path)", async () => {
    // Migrate up to v013 only — we want to seed session rows in the pre-v014
    // state, then run v014 alone to observe backfill behavior.
    await migrateThroughV013(db);

    // Seed: superset s1 (bench, squat), template tpl-1 with cluster (bench
    // parent + squat child) + solo lateral
    await db.runAsync(
      `INSERT INTO superset (id, name, color_hex, use_count, created_at, updated_at)
       VALUES ('s1', '胸+腿', NULL, 0, ?, ?)`,
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
    await db.runAsync(
      `INSERT INTO template (id, name, created_at, updated_at) VALUES ('tpl-1', 'Push', ?, ?)`,
      now,
      now
    );
    await db.runAsync(
      `INSERT INTO template_exercise
         (id, template_id, exercise_id, ordering, default_sets, parent_id, reusable_superset_id, updated_at)
       VALUES ('te-bench', 'tpl-1', ?, 0, 3, NULL, 's1', ?)`,
      benchId,
      now
    );
    await db.runAsync(
      `INSERT INTO template_exercise
         (id, template_id, exercise_id, ordering, default_sets, parent_id, reusable_superset_id, updated_at)
       VALUES ('te-squat', 'tpl-1', ?, 1, 3, 'te-bench', 's1', ?)`,
      squatId,
      now
    );
    await db.runAsync(
      `INSERT INTO template_exercise
         (id, template_id, exercise_id, ordering, default_sets, parent_id, reusable_superset_id, updated_at)
       VALUES ('te-lat', 'tpl-1', ?, 2, 3, NULL, NULL, ?)`,
      lateralId,
      now
    );

    // Seed a session sourced from tpl-1 with all 3 session_exercise rows (pre-v014)
    await db.runAsync(
      `INSERT INTO session (id, started_at) VALUES ('ses-1', ?)`,
      now
    );
    await db.runAsync(
      `INSERT INTO session_exercise
         (id, session_id, exercise_id, ordering, planned_sets, template_id)
       VALUES ('se-bench', 'ses-1', ?, 1, 3, 'tpl-1')`,
      benchId
    );
    await db.runAsync(
      `INSERT INTO session_exercise
         (id, session_id, exercise_id, ordering, planned_sets, template_id)
       VALUES ('se-squat', 'ses-1', ?, 2, 3, 'tpl-1')`,
      squatId
    );
    await db.runAsync(
      `INSERT INTO session_exercise
         (id, session_id, exercise_id, ordering, planned_sets, template_id)
       VALUES ('se-lat', 'ses-1', ?, 3, 3, 'tpl-1')`,
      lateralId
    );

    // Run v014: ALTER + backfill
    await v014_session_exercise_cluster(db);

    const rows = await db.getAllAsync<{
      id: string;
      parent_id: string | null;
      reusable_superset_id: string | null;
    }>(
      `SELECT id, parent_id, reusable_superset_id FROM session_exercise WHERE session_id = 'ses-1' ORDER BY ordering`
    );
    expect(rows).toEqual([
      { id: 'se-bench', parent_id: null, reusable_superset_id: 's1' },
      // Squat is the child — parent_id remapped from te-bench (template side) to se-bench (session side)
      { id: 'se-squat', parent_id: 'se-bench', reusable_superset_id: 's1' },
      // Lateral is solo — both columns stay NULL
      { id: 'se-lat', parent_id: null, reusable_superset_id: null },
    ]);
  });

  it("skips backfill for ambiguous templates (β' skip — same exercise_id appears ≥2 times)", async () => {
    await migrateThroughV013(db);

    // Ambiguous template: bench appears twice (te-bench-1 as cluster parent + te-bench-2 as solo)
    await db.runAsync(
      `INSERT INTO superset (id, name, color_hex, use_count, created_at, updated_at)
       VALUES ('s1', 'mix', NULL, 0, ?, ?)`,
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
    await db.runAsync(
      `INSERT INTO template (id, name, created_at, updated_at) VALUES ('tpl-amb', 'Mix', ?, ?)`,
      now,
      now
    );
    await db.runAsync(
      `INSERT INTO template_exercise
         (id, template_id, exercise_id, ordering, default_sets, parent_id, reusable_superset_id, updated_at)
       VALUES ('te-b1', 'tpl-amb', ?, 0, 3, NULL, 's1', ?)`,
      benchId,
      now
    );
    await db.runAsync(
      `INSERT INTO template_exercise
         (id, template_id, exercise_id, ordering, default_sets, parent_id, reusable_superset_id, updated_at)
       VALUES ('te-sq', 'tpl-amb', ?, 1, 3, 'te-b1', 's1', ?)`,
      squatId,
      now
    );
    // Second bench — solo (rs_id NULL); makes the template ambiguous
    await db.runAsync(
      `INSERT INTO template_exercise
         (id, template_id, exercise_id, ordering, default_sets, parent_id, reusable_superset_id, updated_at)
       VALUES ('te-b2', 'tpl-amb', ?, 2, 3, NULL, NULL, ?)`,
      benchId,
      now
    );

    await db.runAsync(
      `INSERT INTO session (id, started_at) VALUES ('ses-amb', ?)`,
      now
    );
    await db.runAsync(
      `INSERT INTO session_exercise
         (id, session_id, exercise_id, ordering, planned_sets, template_id)
       VALUES ('se-amb-1', 'ses-amb', ?, 1, 3, 'tpl-amb')`,
      benchId
    );
    await db.runAsync(
      `INSERT INTO session_exercise
         (id, session_id, exercise_id, ordering, planned_sets, template_id)
       VALUES ('se-amb-2', 'ses-amb', ?, 2, 3, 'tpl-amb')`,
      squatId
    );
    await db.runAsync(
      `INSERT INTO session_exercise
         (id, session_id, exercise_id, ordering, planned_sets, template_id)
       VALUES ('se-amb-3', 'ses-amb', ?, 3, 3, 'tpl-amb')`,
      benchId
    );

    await v014_session_exercise_cluster(db);

    // Skip rule: entire template's sessions stay NULL — strictly preferable
    // to mislabeling the second bench as part of the cluster.
    const rows = await db.getAllAsync<{
      id: string;
      parent_id: string | null;
      reusable_superset_id: string | null;
    }>(
      `SELECT id, parent_id, reusable_superset_id FROM session_exercise WHERE session_id = 'ses-amb' ORDER BY ordering`
    );
    for (const r of rows) {
      expect(r.parent_id).toBeNull();
      expect(r.reusable_superset_id).toBeNull();
    }
  });

  it('leaves freestyle session (template_id NULL) untouched', async () => {
    await migrateThroughV013(db);

    await db.runAsync(
      `INSERT INTO session (id, started_at) VALUES ('ses-free', ?)`,
      now
    );
    await db.runAsync(
      `INSERT INTO session_exercise
         (id, session_id, exercise_id, ordering, planned_sets, template_id)
       VALUES ('se-free-1', 'ses-free', ?, 1, 3, NULL)`,
      benchId
    );

    await v014_session_exercise_cluster(db);

    const row = await db.getFirstAsync<{
      parent_id: string | null;
      reusable_superset_id: string | null;
    }>(
      `SELECT parent_id, reusable_superset_id FROM session_exercise WHERE id = 'se-free-1'`
    );
    expect(row!.parent_id).toBeNull();
    expect(row!.reusable_superset_id).toBeNull();
  });

  it('is idempotent — re-running on a migrated DB is a no-op', async () => {
    await migrate(db);
    // Repeat: should not throw, should not duplicate columns
    await expect(v014_session_exercise_cluster(db)).resolves.toBeUndefined();
    const cols = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info(session_exercise)`
    );
    const parentCount = cols.filter((c) => c.name === 'parent_id').length;
    const rsCount = cols.filter((c) => c.name === 'reusable_superset_id').length;
    expect(parentCount).toBe(1);
    expect(rsCount).toBe(1);
  });
});

async function migrateThroughV013(db: BetterSqliteDatabase): Promise<void> {
  const { v001_initial } = await import('../../src/db/schema/v001_initial');
  const { v002_more_exercises } = await import(
    '../../src/db/schema/v002_more_exercises'
  );
  const { v003_templates } = await import('../../src/db/schema/v003_templates');
  const { v004_evergreen_zone } = await import(
    '../../src/db/schema/v004_evergreen_zone'
  );
  const { v005_program } = await import('../../src/db/schema/v005_program');
  const { v006_muscle_layer } = await import(
    '../../src/db/schema/v006_muscle_layer'
  );
  const { v007_body_metric } = await import(
    '../../src/db/schema/v007_body_metric'
  );
  const { v008_achievements } = await import(
    '../../src/db/schema/v008_achievements'
  );
  const { v009_template_set } = await import(
    '../../src/db/schema/v009_template_set'
  );
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
}
