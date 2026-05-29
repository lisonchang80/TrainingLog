/**
 * Slice 13d D31 — watchSessionResolve.ts orchestrator tests.
 *
 * Per ADR-0019 § Slice 13d NEW-Q50 Q5 escalation tail. The
 * orchestrator is a thin wrapper around `discardSession` so the
 * focus here is:
 *   - Happy path — existing session row + sets + session_exercise all
 *     gone after onStartResolve returns ok.
 *   - Idempotence — running twice on the same envelope is safe (second
 *     call is a sequence of DELETE WHERE no-ops, no throw).
 *   - Non-existent session — never-existed sessionId returns ok (the
 *     row is "gone" by virtue of never existing).
 *   - Bad payload guard — empty / missing existingSessionId rejected
 *     with bad-payload code, db untouched.
 *
 * No WC bridge mocking — orchestrator is pure DB. Real SQLite in-memory
 * via better-sqlite3 fixture.
 */

import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  createSession,
  getSession,
} from '../../src/adapters/sqlite/sessionRepository';
import { onStartResolve } from '../../src/services/watchSessionResolve';
import { makeEnvelope } from '../../src/adapters/watch';

describe('Slice 13d D31 — onStartResolve orchestrator', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it('happy path — existing session row hard-deleted', async () => {
    // Seed an iPhone session row. Cascade behavior (sets +
    // session_exercise + achievement_unlock + edit-snapshot) is
    // discardSession's own contract, covered in sessionRepository
    // tests; here we just verify onStartResolve invokes it.
    await createSession(db, { id: 'sess-iphone-losing', started_at: 1_000 });
    expect(await getSession(db, 'sess-iphone-losing')).not.toBeNull();

    const env = makeEnvelope('start-resolve', {
      localSessionId: 'W-deadbeef-0001',
      existingSessionId: 'sess-iphone-losing',
    });
    const result = await onStartResolve(db, env);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.existingSessionId).toBe('sess-iphone-losing');
    }
    expect(await getSession(db, 'sess-iphone-losing')).toBeNull();
    // localSessionId untouched — Watch is source of truth for that row;
    // it may not even exist on iPhone yet (start-from-watch envelope
    // can still be in flight). Confirm we didn't accidentally create
    // or query it.
    expect(await getSession(db, 'W-deadbeef-0001')).toBeNull();
  });

  it('idempotent — second call on same envelope is a safe no-op', async () => {
    await createSession(db, { id: 'sess-idem', started_at: 2_000 });
    const env = makeEnvelope('start-resolve', {
      localSessionId: 'W-feedbeef',
      existingSessionId: 'sess-idem',
    });

    const first = await onStartResolve(db, env);
    expect(first.ok).toBe(true);
    expect(await getSession(db, 'sess-idem')).toBeNull();

    const second = await onStartResolve(db, env);
    expect(second.ok).toBe(true);
    // No throw on rerun — Watch's TUI may redeliver.
  });

  it('non-existent session — returns ok (sequence of DELETE WHERE no-ops)', async () => {
    const env = makeEnvelope('start-resolve', {
      localSessionId: 'W-nothing',
      existingSessionId: 'sess-never-existed',
    });
    const result = await onStartResolve(db, env);
    expect(result.ok).toBe(true);
  });

  it('bad-payload guard — empty existingSessionId rejected, db untouched', async () => {
    await createSession(db, { id: 'sess-guard-canary', started_at: 3_000 });

    const env = makeEnvelope('start-resolve', {
      localSessionId: 'W-empty',
      existingSessionId: '',
    });
    const result = await onStartResolve(db, env);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('bad-payload');
    }
    // Canary session still present — we did not run any DELETE.
    expect(await getSession(db, 'sess-guard-canary')).not.toBeNull();
  });
});
