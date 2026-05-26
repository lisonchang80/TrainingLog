import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { v024_session_is_watch_tracked } from '../../src/db/schema/v024_session_is_watch_tracked';

/**
 * v024 migration acceptance tests — `session.is_watch_tracked` column
 * (ADR-0019 slice 13d D1 / Q24).
 *
 * Per Agent G test-gap audit § G:
 *   - PRAGMA table_info shape (column exists, INTEGER, NOT NULL, DEFAULT 0)
 *   - Existing rows (inserted via fresh-DB migrate path) default to 0
 *   - Idempotency: re-running v024 against an already-migrated schema is a
 *     safe no-op
 *   - Fresh INSERT without explicit is_watch_tracked defaults to 0
 *   - Round-trip writing 1 reads back 1
 *   - Round-trip writing 0 reads back 0
 *   - PRAGMA user_version >= 24 after full migrate
 *   - INTEGER NOT NULL contract — explicit NULL is rejected by SQLite
 */
describe('v024 session.is_watch_tracked column migration', () => {
  let db: BetterSqliteDatabase;

  beforeEach(() => {
    db = new BetterSqliteDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('creates session.is_watch_tracked column as INTEGER NOT NULL DEFAULT 0', async () => {
    await migrate(db);
    const cols = await db.getAllAsync<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }>(`PRAGMA table_info(session)`);
    const col = cols.find((c) => c.name === 'is_watch_tracked');
    expect(col).toBeDefined();
    expect(col?.type).toBe('INTEGER');
    expect(col?.notnull).toBe(1);
    expect(col?.dflt_value).toBe('0');
  });

  it('defaults existing session rows to is_watch_tracked = 0 after migrate', async () => {
    await migrate(db);
    await db.runAsync(
      `INSERT INTO session (id, started_at) VALUES (?, ?)`,
      'sess-existing',
      1_000,
    );
    const row = await db.getFirstAsync<{ is_watch_tracked: number }>(
      `SELECT is_watch_tracked FROM session WHERE id = ?`,
      'sess-existing',
    );
    expect(row?.is_watch_tracked).toBe(0);
  });

  it('is idempotent — re-running v024 against a migrated schema is a safe no-op', async () => {
    await migrate(db);
    await expect(v024_session_is_watch_tracked(db)).resolves.toBeUndefined();
    await expect(v024_session_is_watch_tracked(db)).resolves.toBeUndefined();
    const cols = await db.getAllAsync<{
      name: string;
      notnull: number;
      dflt_value: string | null;
    }>(`PRAGMA table_info(session)`);
    const col = cols.find((c) => c.name === 'is_watch_tracked');
    expect(col).toBeDefined();
    expect(col?.notnull).toBe(1);
    expect(col?.dflt_value).toBe('0');
  });

  it('fresh-DB session insert without is_watch_tracked defaults to 0', async () => {
    await migrate(db);
    await db.runAsync(
      `INSERT INTO session (id, started_at) VALUES (?, ?)`,
      'sess-default',
      2_000,
    );
    const row = await db.getFirstAsync<{ is_watch_tracked: number }>(
      `SELECT is_watch_tracked FROM session WHERE id = ?`,
      'sess-default',
    );
    expect(row?.is_watch_tracked).toBe(0);
  });

  it('round-trips is_watch_tracked = 1 (Watch-tracked session)', async () => {
    await migrate(db);
    await db.runAsync(
      `INSERT INTO session (id, started_at, is_watch_tracked) VALUES (?, ?, ?)`,
      'sess-watch',
      3_000,
      1,
    );
    const row = await db.getFirstAsync<{ is_watch_tracked: number }>(
      `SELECT is_watch_tracked FROM session WHERE id = ?`,
      'sess-watch',
    );
    expect(row?.is_watch_tracked).toBe(1);
  });

  it('round-trips is_watch_tracked = 0 (iPhone-only session)', async () => {
    await migrate(db);
    await db.runAsync(
      `INSERT INTO session (id, started_at, is_watch_tracked) VALUES (?, ?, ?)`,
      'sess-phone',
      4_000,
      0,
    );
    const row = await db.getFirstAsync<{ is_watch_tracked: number }>(
      `SELECT is_watch_tracked FROM session WHERE id = ?`,
      'sess-phone',
    );
    expect(row?.is_watch_tracked).toBe(0);
  });

  it('runs automatically as part of the full migration runner (user_version >= 24)', async () => {
    await migrate(db);
    const row = await db.getFirstAsync<{ user_version: number }>(
      'PRAGMA user_version',
    );
    expect(row?.user_version).toBeGreaterThanOrEqual(24);
  });

  it('rejects explicit NULL writes (INTEGER NOT NULL contract)', async () => {
    await migrate(db);
    await expect(
      db.runAsync(
        `INSERT INTO session (id, started_at, is_watch_tracked) VALUES (?, ?, ?)`,
        'sess-null',
        5_000,
        null,
      ),
    ).rejects.toThrow();
  });
});
