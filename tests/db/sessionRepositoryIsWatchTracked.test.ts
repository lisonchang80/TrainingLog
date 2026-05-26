import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  createSession,
  endSession,
  getActiveSession,
  getSession,
  listSessions,
} from '../../src/adapters/sqlite/sessionRepository';

/**
 * Slice 13d D5 — sessionRepository reader round-trip for the v024
 * `is_watch_tracked` column (ADR-0019 § Q19).
 *
 * The Today tab's 5-tile vs 3-tile `SessionStatsPanel` predicate
 * (`app/(tabs)/index.tsx`) reads `sessionState.is_watch_tracked`, which is
 * sourced from `getActiveSession()` via `fromRow()` in `sessionManager`.
 * The repository layer maps the SQLite `INTEGER 0/1` raw column to the
 * domain `Session.is_watch_tracked: boolean` at the read boundary
 * (`mapSessionRow`); this test file pins that mapping and the round-trip
 * across the three read entry points (`getSession`, `getActiveSession`,
 * `listSessions`).
 *
 * D5 narrow scope — write paths that flip is_watch_tracked=true land in
 * later D-chain commits (D6 Watch-initiated start, D7 paired-share
 * handshake ack); here we inject the flag via raw SQL to exercise the read
 * boundary in isolation.
 */
describe('Slice 13d D5 — sessionRepository surfaces is_watch_tracked as boolean', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it('createSession defaults is_watch_tracked to false via getSession', async () => {
    await createSession(db, { id: 'sess-iphone', started_at: 1_000 });
    const row = await getSession(db, 'sess-iphone');
    expect(row).not.toBeNull();
    expect(row?.is_watch_tracked).toBe(false);
    // sanity — domain-level boolean, not 0/1
    expect(typeof row?.is_watch_tracked).toBe('boolean');
  });

  it('getSession maps INTEGER 1 → boolean true', async () => {
    await db.runAsync(
      `INSERT INTO session (id, started_at, is_watch_tracked) VALUES (?, ?, ?)`,
      'sess-watch',
      2_000,
      1,
    );
    const row = await getSession(db, 'sess-watch');
    expect(row?.is_watch_tracked).toBe(true);
  });

  it('getActiveSession surfaces is_watch_tracked for the in-progress row', async () => {
    // Insert one ended + one in-progress session; getActiveSession should
    // return the in-progress one with its is_watch_tracked flag intact.
    await db.runAsync(
      `INSERT INTO session (id, started_at, ended_at, is_watch_tracked) VALUES (?, ?, ?, ?)`,
      'sess-ended',
      1_000,
      2_000,
      0,
    );
    await db.runAsync(
      `INSERT INTO session (id, started_at, is_watch_tracked) VALUES (?, ?, ?)`,
      'sess-active-watch',
      3_000,
      1,
    );
    const active = await getActiveSession(db);
    expect(active?.id).toBe('sess-active-watch');
    expect(active?.is_watch_tracked).toBe(true);
  });

  it('getActiveSession returns is_watch_tracked=false for iPhone-led active session', async () => {
    await createSession(db, { id: 'sess-active-phone', started_at: 4_000 });
    const active = await getActiveSession(db);
    expect(active?.id).toBe('sess-active-phone');
    expect(active?.is_watch_tracked).toBe(false);
  });

  it('listSessions maps is_watch_tracked per row in newest-first order', async () => {
    await db.runAsync(
      `INSERT INTO session (id, started_at, ended_at, is_watch_tracked) VALUES (?, ?, ?, ?)`,
      'sess-a',
      1_000,
      2_000,
      0,
    );
    await db.runAsync(
      `INSERT INTO session (id, started_at, ended_at, is_watch_tracked) VALUES (?, ?, ?, ?)`,
      'sess-b',
      3_000,
      4_000,
      1,
    );
    const rows = await listSessions(db);
    expect(rows.map((r) => r.id)).toEqual(['sess-b', 'sess-a']);
    expect(rows[0].is_watch_tracked).toBe(true);
    expect(rows[1].is_watch_tracked).toBe(false);
  });

  it('survives a complete iPhone-led session lifecycle as is_watch_tracked=false', async () => {
    // End-to-end: createSession → endSession → re-read; the flag stays
    // false because no write path flipped it (D6/D7 not landed yet).
    await createSession(db, { id: 'sess-lifecycle', started_at: 5_000 });
    await endSession(db, { id: 'sess-lifecycle', ended_at: 6_000 });
    const row = await getSession(db, 'sess-lifecycle');
    expect(row?.is_watch_tracked).toBe(false);
    expect(row?.ended_at).toBe(6_000);
  });
});
