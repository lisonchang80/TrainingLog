/**
 * 🟠-B (overnight 2026-07-07) — freestyle-start active-session guard,
 * integration-level against a real in-memory DB.
 *
 * Reproduces the exact `onStartFreestyle` decision sequence (app/(tabs)/index.tsx):
 *   1. re-query getActiveSession(db)
 *   2. decideFreestyleStart({ hasActiveSession })
 *   3. 'create'         → createSession (new live row)
 *      'adopt-existing' → skip create (caller would refresh() to adopt)
 *
 * This is the regression that pins the fix: with a pre-existing live session
 * (e.g. a Watch-led session that landed while the tab was still `idle`), the
 * freestyle start must NOT INSERT a second `ended_at IS NULL` row. Before the
 * fix, `onStartFreestyle` called `createSession` unconditionally → two active
 * sessions → getActiveSession's `LIMIT 1` orphaned the older one.
 *
 * The DB half (createSession / getActiveSession / endSession) is the real
 * adapter; only the RN component's setState wiring is not exercised (it can't
 * run under testEnvironment: node — that's the `decideFreestyleStart` pure
 * predicate's job, covered in startSessionGuard.test.ts).
 */

import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  createSession,
  getActiveSession,
  endSession,
} from '../../src/adapters/sqlite/sessionRepository';
import { decideFreestyleStart } from '../../src/services/startSessionGuard';

/**
 * Mirror of `onStartFreestyle`'s DB-facing decision (index.tsx). Returns which
 * branch ran so the test can assert on it; performs the same `createSession`
 * side-effect on the 'create' branch. The 'adopt-existing' branch is a no-op
 * here (the real handler calls `refresh()`, a React side-effect not modelled).
 */
async function runFreestyleStart(
  db: BetterSqliteDatabase,
  idFactory: () => string,
  now: () => number,
): Promise<'create' | 'adopt-existing'> {
  const existing = await getActiveSession(db);
  const decision = decideFreestyleStart({ hasActiveSession: existing != null });
  if (decision.action === 'adopt-existing') {
    return 'adopt-existing';
  }
  await createSession(db, { id: idFactory(), started_at: now() });
  return 'create';
}

async function countActiveSessions(db: BetterSqliteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM session WHERE ended_at IS NULL`,
  );
  return row?.n ?? 0;
}

describe('🟠-B — freestyle start refuses to create a second live session', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it('no active session → creates exactly one live session', async () => {
    expect(await countActiveSessions(db)).toBe(0);

    const outcome = await runFreestyleStart(
      db,
      () => 'freestyle-1',
      () => 1_700_000_000_000,
    );

    expect(outcome).toBe('create');
    expect(await countActiveSessions(db)).toBe(1);
    const active = await getActiveSession(db);
    expect(active?.id).toBe('freestyle-1');
  });

  it('a Watch-led live session already exists → freestyle start does NOT create a duplicate', async () => {
    // Simulate the Watch-led session that landed while the tab was still idle.
    await createSession(db, { id: 'watch-led-1', started_at: 1_700_000_000_000 });
    expect(await countActiveSessions(db)).toBe(1);

    // The narrow-window tap: onStartFreestyle re-queries and sees the existing
    // session → adopt-existing, NOT a second createSession.
    const outcome = await runFreestyleStart(
      db,
      () => 'freestyle-dup',
      () => 1_700_000_500_000, // later start_at — would win getActiveSession's DESC sort
    );

    expect(outcome).toBe('adopt-existing');
    // The critical assertion: still exactly ONE live session, and it is the
    // original Watch-led one (not orphaned by a newer freestyle row).
    expect(await countActiveSessions(db)).toBe(1);
    const active = await getActiveSession(db);
    expect(active?.id).toBe('watch-led-1');
  });

  it('after the previous session ends → freestyle start creates a fresh one', async () => {
    await createSession(db, { id: 'sess-old', started_at: 1_700_000_000_000 });
    await endSession(db, { id: 'sess-old', ended_at: 1_700_000_100_000 });
    expect(await countActiveSessions(db)).toBe(0);

    const outcome = await runFreestyleStart(
      db,
      () => 'sess-new',
      () => 1_700_000_200_000,
    );

    expect(outcome).toBe('create');
    expect(await countActiveSessions(db)).toBe(1);
    expect((await getActiveSession(db))?.id).toBe('sess-new');
  });
});
