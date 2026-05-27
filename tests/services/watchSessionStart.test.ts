/**
 * Slice 13d D6 — watchSessionStart.ts orchestrator tests.
 *
 * 4 cases per micro-PRD acceptance criteria:
 *   - happy ack → is_watch_tracked flipped to true
 *   - ack timeout → flag stays false
 *   - unreachable → setter not called (silent skip)
 *   - bridge errCb → swallowed, returned {acked:false, code:'BRIDGE_ERROR'}
 *
 * Plus 2 supplementary cases:
 *   - explicit reply.ok === false → ACK_NO_OK (Watch-side rejection)
 *   - setter no-op for non-existent id (smoke for D6 + D7 reconcile)
 *
 * Real DB via better-sqlite3 in-memory; WC bridge mocked per-test via
 * jest.doMock with `jest.resetModules()`.
 */

import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  createSession,
  getSession,
} from '../../src/adapters/sqlite/sessionRepository';

interface MockBridge {
  getIsPaired: jest.Mock;
  getReachability: jest.Mock;
  getIsWatchAppInstalled: jest.Mock;
  sendMessage: jest.Mock;
  updateApplicationContext: jest.Mock;
  watchEvents: { addListener: jest.Mock };
}

function makeBridge(overrides: Partial<MockBridge> = {}): MockBridge {
  return {
    getIsPaired: jest.fn().mockResolvedValue(true),
    getReachability: jest.fn().mockResolvedValue(true),
    getIsWatchAppInstalled: jest.fn().mockResolvedValue(true),
    sendMessage: jest.fn(),
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
  return require('../../src/services/watchSessionStart') as typeof import('../../src/services/watchSessionStart');
}

describe('Slice 13d D6 — pushStartToWatch orchestrator', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
    jest.dontMock('react-native-watch-connectivity');
  });

  it('happy path — Watch acks → is_watch_tracked flipped to true', async () => {
    const bridge = makeBridge({
      sendMessage: jest.fn((_msg, replyCb) => {
        replyCb?.({ ok: true });
      }),
    });
    installBridge(bridge);
    const { pushStartToWatch } = loadOrchestrator();

    await createSession(db, { id: 'sess-1', started_at: 1_000 });
    expect((await getSession(db, 'sess-1'))?.is_watch_tracked).toBe(false);

    const result = await pushStartToWatch(db, 'sess-1', {}, { timeoutMs: 500 });

    expect(result.acked).toBe(true);
    expect(result.code).toBeNull();
    expect(bridge.sendMessage).toHaveBeenCalledTimes(1);
    expect((await getSession(db, 'sess-1'))?.is_watch_tracked).toBe(true);
  });

  it('ack timeout — Watch never replies → flag stays false', async () => {
    const bridge = makeBridge({
      sendMessage: jest.fn(() => {
        // Never call replyCb / errCb — Watch app not responding.
      }),
    });
    installBridge(bridge);
    const { pushStartToWatch } = loadOrchestrator();

    await createSession(db, { id: 'sess-2', started_at: 2_000 });

    const result = await pushStartToWatch(db, 'sess-2', {}, { timeoutMs: 50 });

    expect(result.acked).toBe(false);
    expect(result.code).toBe('TIMEOUT');
    expect((await getSession(db, 'sess-2'))?.is_watch_tracked).toBe(false);
  });

  it('unreachable — Watch off → setter not called, flag stays false', async () => {
    const bridge = makeBridge({
      getReachability: jest.fn().mockResolvedValue(false),
      sendMessage: jest.fn(),
    });
    installBridge(bridge);
    const { pushStartToWatch } = loadOrchestrator();

    await createSession(db, { id: 'sess-3', started_at: 3_000 });

    const result = await pushStartToWatch(db, 'sess-3', {});

    expect(result.acked).toBe(false);
    expect(result.code).toBe('NOT_REACHABLE');
    expect(bridge.sendMessage).not.toHaveBeenCalled();
    expect((await getSession(db, 'sess-3'))?.is_watch_tracked).toBe(false);
  });

  it('unpaired — no Watch → silent skip, flag stays false', async () => {
    const bridge = makeBridge({
      getIsPaired: jest.fn().mockResolvedValue(false),
      sendMessage: jest.fn(),
    });
    installBridge(bridge);
    const { pushStartToWatch } = loadOrchestrator();

    await createSession(db, { id: 'sess-4', started_at: 4_000 });

    const result = await pushStartToWatch(db, 'sess-4', {});

    expect(result.acked).toBe(false);
    expect(result.code).toBe('UNPAIRED');
    expect(bridge.sendMessage).not.toHaveBeenCalled();
    expect((await getSession(db, 'sess-4'))?.is_watch_tracked).toBe(false);
  });

  it('bridge errCb fires → swallowed, returned {acked:false, code:BRIDGE_ERROR}', async () => {
    const bridge = makeBridge({
      sendMessage: jest.fn((_msg, _replyCb, errCb) => {
        const e = new Error('TurboModule error') as Error & { code?: string };
        errCb?.(e);
      }),
    });
    installBridge(bridge);
    const { pushStartToWatch } = loadOrchestrator();

    await createSession(db, { id: 'sess-5', started_at: 5_000 });

    const result = await pushStartToWatch(db, 'sess-5', {});

    expect(result.acked).toBe(false);
    expect(result.code).toBe('BRIDGE_ERROR');
    expect((await getSession(db, 'sess-5'))?.is_watch_tracked).toBe(false);
  });

  it('Watch replies {ok:false} → ACK_NO_OK, flag stays false', async () => {
    // Watch-side explicit rejection — e.g. user denied HK auth on Watch
    // and Watch app sends back {ok:false, reason:'auth_denied'}.
    const bridge = makeBridge({
      sendMessage: jest.fn((_msg, replyCb) => {
        replyCb?.({ ok: false, reason: 'auth_denied' });
      }),
    });
    installBridge(bridge);
    const { pushStartToWatch } = loadOrchestrator();

    await createSession(db, { id: 'sess-6', started_at: 6_000 });

    const result = await pushStartToWatch(db, 'sess-6', {});

    expect(result.acked).toBe(false);
    expect(result.code).toBe('ACK_NO_OK');
    expect((await getSession(db, 'sess-6'))?.is_watch_tracked).toBe(false);
  });

  it('non-existent sessionId — ack ok but UPDATE is no-op, no throw', async () => {
    // The setter silently no-ops on missing row (sessionRepository
    // convention). pushStartToWatch should still resolve cleanly with
    // acked:true since the WC channel itself succeeded.
    const bridge = makeBridge({
      sendMessage: jest.fn((_msg, replyCb) => {
        replyCb?.({ ok: true });
      }),
    });
    installBridge(bridge);
    const { pushStartToWatch } = loadOrchestrator();

    const result = await pushStartToWatch(db, 'sess-not-in-db', {});

    expect(result.acked).toBe(true);
    expect(result.code).toBeNull();
    expect(await getSession(db, 'sess-not-in-db')).toBeNull();
  });
});
