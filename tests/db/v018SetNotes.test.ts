import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { v018_set_notes } from '../../src/db/schema/v018_set_notes';

/**
 * v018 migration tests — ADD set.notes (slice 10c Phase 2 commit 7c).
 *
 * Coverage:
 *   - notes column added with TEXT type, nullable
 *   - existing rows pre-v018 default to NULL
 *   - re-running v018 is a no-op (idempotent)
 */
describe('v018 set table notes column migration', () => {
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

  it('adds notes column (TEXT, nullable, default NULL)', async () => {
    await migrate(db);
    const cols = await db.getAllAsync<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }>(`PRAGMA table_info("set")`);

    const notesCol = cols.find((c) => c.name === 'notes');
    expect(notesCol).toBeDefined();
    expect(notesCol!.type).toBe('TEXT');
    expect(notesCol!.notnull).toBe(0);
    expect(notesCol!.dflt_value).toBeNull();
  });

  it('existing rows default to NULL notes', async () => {
    await migrate(db);
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
    const row = await db.getFirstAsync<{ notes: string | null }>(
      `SELECT notes FROM "set" WHERE id = ?`,
      setId,
    );
    expect(row?.notes).toBeNull();
  });

  it('UPDATE notes works after migration', async () => {
    await migrate(db);
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
    await db.runAsync(
      `UPDATE "set" SET notes = ? WHERE id = ?`,
      '感覺 RPE 8',
      setId,
    );
    const row = await db.getFirstAsync<{ notes: string | null }>(
      `SELECT notes FROM "set" WHERE id = ?`,
      setId,
    );
    expect(row?.notes).toBe('感覺 RPE 8');
  });

  it('is idempotent — re-running on already-migrated DB does nothing', async () => {
    await migrate(db);
    // Run v018 again directly — should not error and notes col still there.
    await v018_set_notes(db);
    const cols = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info("set")`,
    );
    const notesCount = cols.filter((c) => c.name === 'notes').length;
    expect(notesCount).toBe(1);
  });
});
