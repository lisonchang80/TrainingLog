import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  createSession,
  getSession,
  updateSessionTitle,
} from '../../src/adapters/sqlite/sessionRepository';

/**
 * updateSessionTitle — Card 11 / ADR-0014 in-session header tap-to-edit
 * adapter coverage.
 */
describe('updateSessionTitle', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it('round-trips a non-empty title via getSession', async () => {
    await createSession(db, {
      id: 'sess-1',
      started_at: 1_000,
      bodyweight_snapshot_kg: null,
    });
    await updateSessionTitle(db, 'sess-1', 'Push Day A');
    const row = await getSession(db, 'sess-1');
    expect(row?.title).toBe('Push Day A');
  });

  it('allows empty string (clears back to freestyle placeholder)', async () => {
    await createSession(db, {
      id: 'sess-2',
      started_at: 2_000,
      bodyweight_snapshot_kg: null,
      title: 'Some Title',
    });
    await updateSessionTitle(db, 'sess-2', '');
    const row = await getSession(db, 'sess-2');
    expect(row?.title).toBe('');
  });

  it('is a safe no-op for a non-existent session id (no throw)', async () => {
    // Defensive — the UI guards via getSessionId before calling, but a stale
    // snapshot calling updateSessionTitle on a discarded session shouldn't
    // crash the screen.
    await expect(
      updateSessionTitle(db, 'sess-missing', 'whatever'),
    ).resolves.toBeUndefined();
    const row = await getSession(db, 'sess-missing');
    expect(row).toBeNull();
  });

  it('overwrites an existing title without throwing or duplicating', async () => {
    await createSession(db, {
      id: 'sess-3',
      started_at: 3_000,
      bodyweight_snapshot_kg: null,
      title: 'First',
    });
    await updateSessionTitle(db, 'sess-3', 'Second');
    const row = await getSession(db, 'sess-3');
    expect(row?.title).toBe('Second');
  });
});
