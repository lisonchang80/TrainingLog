import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { v023_session_title } from '../../src/db/schema/v023_session_title';

/**
 * v023 migration acceptance tests — `session.title` column (ADR-0014 + Card 11).
 *
 * Coverage:
 *   - Forward-on-fresh-DB: clean DB → run all migrations → title column exists
 *     with NOT NULL DEFAULT ''
 *   - Backfill: template-based session gets title = template.name (resolved
 *     via session_exercise.template_id since `session` itself has no
 *     `template_id` column — linkage lives one level down)
 *   - Backfill: freestyle session (no session_exercise carrying template_id)
 *     stays at default ''
 *   - Idempotency: re-running v023 against an already-migrated schema is a
 *     safe no-op (PRAGMA table_info check skips the ALTER TABLE)
 */
describe('v023 session.title column migration', () => {
  let db: BetterSqliteDatabase;

  beforeEach(() => {
    db = new BetterSqliteDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('creates session.title column with NOT NULL DEFAULT empty string', async () => {
    await migrate(db);
    const cols = await db.getAllAsync<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }>(`PRAGMA table_info(session)`);
    const titleCol = cols.find((c) => c.name === 'title');
    expect(titleCol).toBeDefined();
    expect(titleCol?.type).toBe('TEXT');
    expect(titleCol?.notnull).toBe(1);
    // DEFAULT '' shows up literally as "''" in sqlite_master / table_info.
    expect(titleCol?.dflt_value).toBe("''");
  });

  it('backfills title from the linked template name for template-based sessions', async () => {
    await migrate(db);
    // Seed a template + a session + a session_exercise that links them.
    await db.runAsync(
      `INSERT INTO template (id, name, created_at, updated_at)
       VALUES (?, ?, ?, ?)`,
      'tpl-push-1',
      'Push Day',
      1_000,
      1_000,
    );
    await db.runAsync(
      `INSERT INTO session (id, started_at, ended_at, title)
       VALUES (?, ?, ?, '')`,
      'sess-1',
      2_000,
      3_000,
    );
    await db.runAsync(
      `INSERT INTO exercise (id, name, load_type, is_builtin, is_archived)
       VALUES (?, ?, 'loaded', 0, 0)`,
      'ex-1',
      'Bench Press',
    );
    await db.runAsync(
      `INSERT INTO session_exercise
         (id, session_id, exercise_id, ordering, planned_sets, planned_reps,
          planned_weight_kg, template_id)
       VALUES (?, ?, ?, 1, 3, 8, 60, ?)`,
      'se-1',
      'sess-1',
      'ex-1',
      'tpl-push-1',
    );

    // Reset title and re-run v023 to exercise the backfill in isolation
    // (migrate already ran it, but with no template/se rows seeded then).
    await db.runAsync(`UPDATE session SET title = '' WHERE id = ?`, 'sess-1');
    await v023_session_title(db);

    const row = await db.getFirstAsync<{ title: string }>(
      `SELECT title FROM session WHERE id = ?`,
      'sess-1',
    );
    expect(row?.title).toBe('Push Day');
  });

  it('leaves freestyle sessions with empty title (no session_exercise carries template_id)', async () => {
    await migrate(db);
    await db.runAsync(
      `INSERT INTO session (id, started_at, ended_at, title)
       VALUES (?, ?, ?, '')`,
      'sess-free',
      4_000,
      5_000,
    );
    await db.runAsync(
      `INSERT INTO exercise (id, name, load_type, is_builtin, is_archived)
       VALUES (?, ?, 'bodyweight', 0, 0)`,
      'ex-free',
      'Air Squat',
    );
    // Freestyle session: session_exercise rows exist but template_id is NULL.
    await db.runAsync(
      `INSERT INTO session_exercise
         (id, session_id, exercise_id, ordering, planned_sets, planned_reps,
          planned_weight_kg, template_id)
       VALUES (?, ?, ?, 1, 3, 10, 0, NULL)`,
      'se-free',
      'sess-free',
      'ex-free',
    );

    await db.runAsync(
      `UPDATE session SET title = '' WHERE id = ?`,
      'sess-free',
    );
    await v023_session_title(db);

    const row = await db.getFirstAsync<{ title: string }>(
      `SELECT title FROM session WHERE id = ?`,
      'sess-free',
    );
    expect(row?.title).toBe('');
  });

  it('is idempotent — re-running v023 against a migrated schema is a safe no-op', async () => {
    await migrate(db);
    await expect(v023_session_title(db)).resolves.toBeUndefined();
    await expect(v023_session_title(db)).resolves.toBeUndefined();
    // Column should still be present + still TEXT NOT NULL.
    const cols = await db.getAllAsync<{
      name: string;
      notnull: number;
    }>(`PRAGMA table_info(session)`);
    const titleCol = cols.find((c) => c.name === 'title');
    expect(titleCol).toBeDefined();
    expect(titleCol?.notnull).toBe(1);
  });

  it('runs automatically as part of the full migration runner (user_version >= 23)', async () => {
    await migrate(db);
    const row = await db.getFirstAsync<{ user_version: number }>(
      'PRAGMA user_version',
    );
    expect(row?.user_version).toBeGreaterThanOrEqual(23);
  });

  it('fresh-DB session insert defaults title to empty string', async () => {
    await migrate(db);
    await db.runAsync(
      `INSERT INTO session (id, started_at) VALUES (?, ?)`,
      'sess-default',
      6_000,
    );
    const row = await db.getFirstAsync<{ title: string }>(
      `SELECT title FROM session WHERE id = ?`,
      'sess-default',
    );
    expect(row?.title).toBe('');
  });
});
