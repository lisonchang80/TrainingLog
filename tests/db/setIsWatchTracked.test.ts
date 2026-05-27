import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  createSession,
  getSession,
  setIsWatchTracked,
} from '../../src/adapters/sqlite/sessionRepository';

/**
 * Slice 13d D6 — sessionRepository write boundary for v024
 * `is_watch_tracked` column.
 *
 * D1 only shipped the schema (column DEFAULT 0) + read mapping. D6 adds
 * the setter so the WC start ack path can flip the flag. This file pins
 * the round-trip + boundary conditions (missing id no-op, true/false
 * round-trip, idempotency).
 */
describe('Slice 13d D6 — setIsWatchTracked write boundary', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it('flips is_watch_tracked from false → true via UPDATE', async () => {
    await createSession(db, { id: 'sess-1', started_at: 1_000 });
    const before = await getSession(db, 'sess-1');
    expect(before?.is_watch_tracked).toBe(false);

    await setIsWatchTracked(db, { id: 'sess-1', value: true });

    const after = await getSession(db, 'sess-1');
    expect(after?.is_watch_tracked).toBe(true);
  });

  it('reverts is_watch_tracked from true → false', async () => {
    await db.runAsync(
      `INSERT INTO session (id, started_at, is_watch_tracked) VALUES (?, ?, ?)`,
      'sess-2',
      2_000,
      1,
    );
    expect((await getSession(db, 'sess-2'))?.is_watch_tracked).toBe(true);

    await setIsWatchTracked(db, { id: 'sess-2', value: false });

    expect((await getSession(db, 'sess-2'))?.is_watch_tracked).toBe(false);
  });

  it('is idempotent — setting true twice keeps it true', async () => {
    await createSession(db, { id: 'sess-3', started_at: 3_000 });
    await setIsWatchTracked(db, { id: 'sess-3', value: true });
    await setIsWatchTracked(db, { id: 'sess-3', value: true });
    expect((await getSession(db, 'sess-3'))?.is_watch_tracked).toBe(true);
  });

  it('silently no-ops for non-existent session id', async () => {
    // Matches the rest of sessionRepository setters — UPDATE on missing
    // row affects 0 rows but does not throw.
    await expect(
      setIsWatchTracked(db, { id: 'sess-does-not-exist', value: true }),
    ).resolves.toBeUndefined();
  });

  it('persists 0/1 INTEGER at the SQL layer, surfaces boolean at read', async () => {
    await createSession(db, { id: 'sess-4', started_at: 4_000 });
    await setIsWatchTracked(db, { id: 'sess-4', value: true });

    const raw = await db.getFirstAsync<{ is_watch_tracked: number }>(
      `SELECT is_watch_tracked FROM session WHERE id = ?`,
      'sess-4',
    );
    expect(raw?.is_watch_tracked).toBe(1);

    const domain = await getSession(db, 'sess-4');
    expect(typeof domain?.is_watch_tracked).toBe('boolean');
    expect(domain?.is_watch_tracked).toBe(true);
  });
});
