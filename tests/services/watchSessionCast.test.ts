/**
 * cast-session — watchSessionCast.ts (pushCastToWatch) orchestrator tests
 * (2026-06-27).
 *
 * Covers the 投影 Watch contract:
 *   - happy ack → is_watch_tracked flipped true + BOTH channels fire
 *   - dual-fire: sendUserInfo (TUI backstop) AND sendMessage every cast
 *   - wire payload carries the REAL session snapshot (the fix — old path sent
 *     an empty `{}`), kind === 'cast-session'
 *   - NO_SNAPSHOT: missing session row → no envelope sent at all, queued:false
 *   - unreachable / timeout / {ok:false} / empty-reply → backstop still queued,
 *     flag NOT flipped
 *
 * Real DB via better-sqlite3 in-memory; WC bridge mocked per-test via
 * jest.doMock with jest.resetModules() (same harness as watchSessionStart).
 */

import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  appendSessionExercise,
  createSession,
  getSession,
} from '../../src/adapters/sqlite/sessionRepository';
import { insertSessionSet } from '../../src/adapters/sqlite/setRepository';

// Bench Press — seeded by v001_initial (builtin), so `migrate(db)` already
// creates the row; no explicit INSERT needed (and inserting would PK-clash).
const BENCH = '00000000-0000-4000-8000-000000000001';

interface MockBridge {
  getIsPaired: jest.Mock;
  getReachability: jest.Mock;
  getIsWatchAppInstalled: jest.Mock;
  sendMessage: jest.Mock;
  transferUserInfo: jest.Mock;
  updateApplicationContext: jest.Mock;
  watchEvents: { addListener: jest.Mock };
}

function makeBridge(overrides: Partial<MockBridge> = {}): MockBridge {
  return {
    getIsPaired: jest.fn().mockResolvedValue(true),
    getReachability: jest.fn().mockResolvedValue(true),
    getIsWatchAppInstalled: jest.fn().mockResolvedValue(true),
    sendMessage: jest.fn(),
    transferUserInfo: jest.fn(),
    updateApplicationContext: jest.fn(),
    watchEvents: {
      addListener: jest.fn().mockReturnValue(() => {}),
    },
    ...overrides,
  };
}

function installBridge(bridge: MockBridge): void {
  jest.doMock('react-native-watch-connectivity', () => bridge);
}

function loadOrchestrator() {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../src/services/watchSessionCast') as typeof import('../../src/services/watchSessionCast');
}

/** Seed a session with one exercise + one set so fetchSessionSnapshot returns a
 *  non-empty tree (proves the wire payload carries real data, not `{}`). */
async function seedSessionWithExercise(
  db: BetterSqliteDatabase,
  sessionId: string,
): Promise<void> {
  await createSession(db, { id: sessionId, started_at: 1_700_000_000_000, title: 'Push Day' });
  await appendSessionExercise(db, {
    id: 'se-cast-1',
    session_id: sessionId,
    exercise_id: BENCH,
  });
  await insertSessionSet(db, {
    id: 'set-cast-1',
    session_id: sessionId,
    exercise_id: BENCH,
    weight_kg: 80,
    reps: 8,
    is_skipped: 0,
    ordering: 1,
    created_at: 1_700_000_000_001,
    set_kind: 'working',
    parent_set_id: null,
    session_exercise_id: 'se-cast-1',
  });
}

describe('cast-session — pushCastToWatch orchestrator', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
    jest.dontMock('react-native-watch-connectivity');
  });

  it('happy path — reachable + {ok:true} → flag flipped + BOTH channels fire', async () => {
    const bridge = makeBridge({
      sendMessage: jest.fn((_msg, replyCb) => {
        replyCb?.({ ok: true });
      }),
    });
    installBridge(bridge);
    const { pushCastToWatch } = loadOrchestrator();

    await seedSessionWithExercise(db, 'sess-cast-1');
    expect((await getSession(db, 'sess-cast-1'))?.is_watch_tracked).toBe(false);

    const result = await pushCastToWatch(db, 'sess-cast-1', { timeoutMs: 500 });

    expect(result.acked).toBe(true);
    expect(result.queued).toBe(true);
    expect(result.code).toBeNull();
    // Dual-fire: TUI backstop + instant channel both fired exactly once.
    expect(bridge.transferUserInfo).toHaveBeenCalledTimes(1);
    expect(bridge.sendMessage).toHaveBeenCalledTimes(1);
    expect((await getSession(db, 'sess-cast-1'))?.is_watch_tracked).toBe(true);
  });

  it('wire payload — carries the REAL session snapshot (kind cast-session, not empty {})', async () => {
    // The fix: the old 投影 Watch sent `pushStartToWatch(db, id, {})` — an empty
    // snapshot — so even a Watch consumer would have had nothing to open. Lock
    // that the cast envelope carries the full start-from-watch wire tree.
    let sentEnvelope: { kind?: string; payload?: { sessionId?: string; snapshot?: Record<string, unknown> } } | undefined;
    const bridge = makeBridge({
      sendMessage: jest.fn((msg, replyCb) => {
        sentEnvelope = msg;
        replyCb?.({ ok: true });
      }),
    });
    installBridge(bridge);
    const { pushCastToWatch } = loadOrchestrator();

    await seedSessionWithExercise(db, 'sess-cast-wire');
    await pushCastToWatch(db, 'sess-cast-wire', { timeoutMs: 500 });

    expect(sentEnvelope?.kind).toBe('cast-session');
    expect(sentEnvelope?.payload?.sessionId).toBe('sess-cast-wire');
    const snap = sentEnvelope?.payload?.snapshot as
      | { sessionId?: string; exercises?: Array<{ exerciseName?: string; sets?: unknown[] }> }
      | undefined;
    expect(snap?.sessionId).toBe('sess-cast-wire');
    expect(snap?.exercises).toHaveLength(1);
    // Localised at the wire boundary (zh default) + carries the seeded set.
    expect(snap?.exercises?.[0].exerciseName).toBe('槓鈴臥推');
    expect(snap?.exercises?.[0].sets).toHaveLength(1);
    // Same envelope (one msgId) is dual-fired so the Watch dedupes.
    expect(bridge.transferUserInfo).toHaveBeenCalledTimes(1);
  });

  it('NO_SNAPSHOT — missing session row → no envelope sent, queued:false', async () => {
    const bridge = makeBridge({ sendMessage: jest.fn() });
    installBridge(bridge);
    const { pushCastToWatch } = loadOrchestrator();

    const result = await pushCastToWatch(db, 'sess-not-in-db');

    expect(result.acked).toBe(false);
    expect(result.queued).toBe(false);
    expect(result.code).toBe('NO_SNAPSHOT');
    expect(result.raw).toBeNull();
    // Nothing built → nothing fired on either channel.
    expect(bridge.transferUserInfo).not.toHaveBeenCalled();
    expect(bridge.sendMessage).not.toHaveBeenCalled();
  });

  it('unreachable — Watch off → backstop still queued, flag stays false', async () => {
    const bridge = makeBridge({
      getReachability: jest.fn().mockResolvedValue(false),
      sendMessage: jest.fn(),
    });
    installBridge(bridge);
    const { pushCastToWatch } = loadOrchestrator();

    await seedSessionWithExercise(db, 'sess-cast-unreach');

    const result = await pushCastToWatch(db, 'sess-cast-unreach');

    expect(result.acked).toBe(false);
    expect(result.queued).toBe(true);
    expect(result.code).toBe('NOT_REACHABLE');
    // TUI backstop fires regardless of reachability — that's the whole point
    // of 「已送出，手錶開啟後帶入」.
    expect(bridge.transferUserInfo).toHaveBeenCalledTimes(1);
    expect((await getSession(db, 'sess-cast-unreach'))?.is_watch_tracked).toBe(false);
  });

  it('ack timeout — Watch never replies → queued, code TIMEOUT, flag false', async () => {
    const bridge = makeBridge({
      sendMessage: jest.fn(() => {
        // never call replyCb / errCb
      }),
    });
    installBridge(bridge);
    const { pushCastToWatch } = loadOrchestrator();

    await seedSessionWithExercise(db, 'sess-cast-timeout');

    const result = await pushCastToWatch(db, 'sess-cast-timeout', { timeoutMs: 50 });

    expect(result.acked).toBe(false);
    expect(result.queued).toBe(true);
    expect(result.code).toBe('TIMEOUT');
    expect(bridge.transferUserInfo).toHaveBeenCalledTimes(1);
    expect((await getSession(db, 'sess-cast-timeout'))?.is_watch_tracked).toBe(false);
  });

  it('Watch replies {ok:false} → ACK_NO_OK, queued, flag NOT flipped', async () => {
    const bridge = makeBridge({
      sendMessage: jest.fn((_msg, replyCb) => {
        replyCb?.({ ok: false, reason: 'busy_other_session' });
      }),
    });
    installBridge(bridge);
    const { pushCastToWatch } = loadOrchestrator();

    await seedSessionWithExercise(db, 'sess-cast-nook');

    const result = await pushCastToWatch(db, 'sess-cast-nook');

    expect(result.acked).toBe(false);
    expect(result.queued).toBe(true);
    expect(result.code).toBe('ACK_NO_OK');
    expect((await getSession(db, 'sess-cast-nook'))?.is_watch_tracked).toBe(false);
  });

  it('empty reply {} (no {ok:true}) → ACK_NO_OK, flag NOT flipped', async () => {
    // Mirror the watchSessionStart E3 guard: a delivered-but-empty reply must
    // NOT be treated as adoption.
    const bridge = makeBridge({
      sendMessage: jest.fn((_msg, replyCb) => {
        replyCb?.({});
      }),
    });
    installBridge(bridge);
    const { pushCastToWatch } = loadOrchestrator();

    await seedSessionWithExercise(db, 'sess-cast-empty');

    const result = await pushCastToWatch(db, 'sess-cast-empty');

    expect(result.acked).toBe(false);
    expect(result.code).toBe('ACK_NO_OK');
    expect((await getSession(db, 'sess-cast-empty'))?.is_watch_tracked).toBe(false);
  });

  it('bridge errCb fires → swallowed, queued, code BRIDGE_ERROR', async () => {
    const bridge = makeBridge({
      sendMessage: jest.fn((_msg, _replyCb, errCb) => {
        errCb?.(new Error('TurboModule error'));
      }),
    });
    installBridge(bridge);
    const { pushCastToWatch } = loadOrchestrator();

    await seedSessionWithExercise(db, 'sess-cast-err');

    const result = await pushCastToWatch(db, 'sess-cast-err');

    expect(result.acked).toBe(false);
    expect(result.queued).toBe(true);
    expect(result.code).toBe('BRIDGE_ERROR');
    expect(bridge.transferUserInfo).toHaveBeenCalledTimes(1);
    expect((await getSession(db, 'sess-cast-err'))?.is_watch_tracked).toBe(false);
  });
});
