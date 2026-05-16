import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { v015_set_kind_and_clusters } from '../../src/db/schema/v015_set_kind_and_clusters';

/**
 * v015 migration tests — ADD set.set_kind / parent_set_id / is_logged
 * (slice 10a foundation per ADR-0019 留尾 Q2 拍板).
 *
 * Coverage:
 *   - All three columns added with correct types/nullability/defaults
 *   - set_kind CHECK enforces enum (warmup/working/dropset)
 *   - Existing rows pre-v015 default cleanly (set_kind='working',
 *     parent_set_id=NULL, is_logged=0) — no data migration needed because
 *     is_warmup never existed on the runtime set table
 *   - Re-running v015 on already-migrated DB is a no-op (idempotent)
 */
describe('v015 set table cluster + lifecycle columns migration', () => {
  let db: BetterSqliteDatabase;
  const benchId = '00000000-0000-4000-8000-000000000001';
  const sessionId = 'sess-1';
  const setId = 'set-1';
  const now = Date.now();

  beforeEach(() => {
    db = new BetterSqliteDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('adds set_kind, parent_set_id, is_logged columns to set table', async () => {
    await migrate(db);
    const cols = await db.getAllAsync<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }>(`PRAGMA table_info("set")`);

    const kindCol = cols.find((c) => c.name === 'set_kind');
    expect(kindCol).toBeDefined();
    expect(kindCol!.type).toBe('TEXT');
    expect(kindCol!.notnull).toBe(1);
    expect(kindCol!.dflt_value).toBe("'working'");

    const parentCol = cols.find((c) => c.name === 'parent_set_id');
    expect(parentCol).toBeDefined();
    expect(parentCol!.type).toBe('TEXT');
    expect(parentCol!.notnull).toBe(0);

    const loggedCol = cols.find((c) => c.name === 'is_logged');
    expect(loggedCol).toBeDefined();
    expect(loggedCol!.type).toBe('INTEGER');
    expect(loggedCol!.notnull).toBe(1);
    expect(loggedCol!.dflt_value).toBe('0');
  });

  it('enforces set_kind CHECK enum (warmup/working/dropset)', async () => {
    await migrate(db);

    // Seed required FK targets (session + exercise) so the INSERT below only
    // exercises the set_kind CHECK, not other constraints.
    await db.runAsync(
      `INSERT INTO session (id, started_at) VALUES (?, ?)`,
      sessionId,
      now,
    );

    await expect(
      db.runAsync(
        `INSERT INTO "set" (id, session_id, exercise_id, ordering, created_at, set_kind)
         VALUES (?, ?, ?, 0, ?, 'invalid')`,
        setId,
        sessionId,
        benchId,
        now,
      ),
    ).rejects.toThrow();
  });

  it('defaults existing pre-v015 set rows to working / NULL / 0', async () => {
    // Migrate up to v014 only, then seed a set row, then run v015 alone.
    // This simulates the upgrade path for an existing user DB.
    await migrateThroughV014(db);

    await db.runAsync(
      `INSERT INTO session (id, started_at) VALUES (?, ?)`,
      sessionId,
      now,
    );
    await db.runAsync(
      `INSERT INTO "set" (id, session_id, exercise_id, ordering, created_at)
       VALUES (?, ?, ?, 0, ?)`,
      setId,
      sessionId,
      benchId,
      now,
    );

    await db.withTransactionAsync(async () => {
      await v015_set_kind_and_clusters(db);
      await db.execAsync(`PRAGMA user_version = 15`);
    });

    const row = await db.getFirstAsync<{
      set_kind: string;
      parent_set_id: string | null;
      is_logged: number;
    }>(`SELECT set_kind, parent_set_id, is_logged FROM "set" WHERE id = ?`, setId);

    expect(row).toBeDefined();
    expect(row!.set_kind).toBe('working');
    expect(row!.parent_set_id).toBeNull();
    expect(row!.is_logged).toBe(0);
  });

  it('is idempotent — re-running v015 on migrated DB is a no-op', async () => {
    await migrate(db);
    // Run v015 again directly (PRAGMA table_info should detect existing
    // columns and skip ADD)
    await expect(v015_set_kind_and_clusters(db)).resolves.not.toThrow();

    const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info("set")`);
    const names = cols.map((c) => c.name);
    expect(names.filter((n) => n === 'set_kind')).toHaveLength(1);
    expect(names.filter((n) => n === 'parent_set_id')).toHaveLength(1);
    expect(names.filter((n) => n === 'is_logged')).toHaveLength(1);
  });
});

/**
 * Helper: migrate the in-memory DB through v014 only (skipping v015+) so a
 * test can observe the v015 ALTER on existing pre-v015 data. Mirrors the
 * pattern used in v014SessionExerciseCluster.test.ts.
 */
async function migrateThroughV014(db: BetterSqliteDatabase): Promise<void> {
  const { v001_initial } = await import('../../src/db/schema/v001_initial');
  const { v002_more_exercises } = await import('../../src/db/schema/v002_more_exercises');
  const { v003_templates } = await import('../../src/db/schema/v003_templates');
  const { v004_evergreen_zone } = await import('../../src/db/schema/v004_evergreen_zone');
  const { v005_program } = await import('../../src/db/schema/v005_program');
  const { v006_muscle_layer } = await import('../../src/db/schema/v006_muscle_layer');
  const { v007_body_metric } = await import('../../src/db/schema/v007_body_metric');
  const { v008_achievements } = await import('../../src/db/schema/v008_achievements');
  const { v009_template_set } = await import('../../src/db/schema/v009_template_set');
  const { v010_exercise_library_v2 } = await import('../../src/db/schema/v010_exercise_library_v2');
  const { v011_reusable_superset } = await import('../../src/db/schema/v011_reusable_superset');
  const { v012_drop_template_exercise_notes } = await import(
    '../../src/db/schema/v012_drop_template_exercise_notes'
  );
  const { v013_template_exercise_reusable_superset_fk } = await import(
    '../../src/db/schema/v013_template_exercise_reusable_superset_fk'
  );
  const { v014_session_exercise_cluster } = await import(
    '../../src/db/schema/v014_session_exercise_cluster'
  );

  const fns = [
    v001_initial,
    v002_more_exercises,
    v003_templates,
    v004_evergreen_zone,
    v005_program,
    v006_muscle_layer,
    v007_body_metric,
    v008_achievements,
    v009_template_set,
    v010_exercise_library_v2,
    v011_reusable_superset,
    v012_drop_template_exercise_notes,
    v013_template_exercise_reusable_superset_fk,
    v014_session_exercise_cluster,
  ];
  for (let i = 0; i < fns.length; i++) {
    await db.withTransactionAsync(async () => {
      await fns[i](db);
      await db.execAsync(`PRAGMA user_version = ${i + 1}`);
    });
  }
}
