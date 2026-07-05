/**
 * Slice 13d D7-TS — watchSessionEnd.ts orchestrator tests.
 *
 * 6 cases per Q23 + NEW-Q45 + channel #11 spec:
 *   - happy ack → is_watch_tracked stays true
 *   - ack timeout → flag flipped to false
 *   - bridge errCb → flag flipped to false
 *   - unreachable → flag flipped to false (setter still called)
 *   - unpaired → flag flipped to false (setter still called)
 *   - non-existent sessionId — setter no-op, no throw (smoke)
 *
 * Real DB via better-sqlite3 in-memory; WC bridge mocked per-test via
 * jest.doMock with `jest.resetModules()`.
 *
 * Mirror of `watchSessionStart.test.ts`. The semantic difference:
 *   - Start: ack → flag flips to TRUE. Non-ok → no write (default false).
 *   - End: ack → no write (flag stays at its current value). Non-ok →
 *     flag flipped to FALSE (Q23 reconcile: Watch didn't confirm end,
 *     so 5-tile UI should fall back).
 */

import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  createSession,
  getSession,
  setIsWatchTracked,
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
  jest.doMock('../../modules/expo-wcsession/compat', () => bridge);
}

function loadOrchestrator() {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../src/services/watchSessionEnd') as typeof import('../../src/services/watchSessionEnd');
}

describe('Slice 13d D7-TS — pushEndToWatch orchestrator', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
    jest.dontMock('../../modules/expo-wcsession/compat');
  });

  it('happy path — Watch acks → is_watch_tracked stays true', async () => {
    const bridge = makeBridge({
      sendMessage: jest.fn((_msg, replyCb) => {
        replyCb?.({ ok: true });
      }),
    });
    installBridge(bridge);
    const { pushEndToWatch } = loadOrchestrator();

    await createSession(db, { id: 'sess-1', started_at: 1_000 });
    // Pre-set flag to true (simulating successful pushStartToWatch earlier).
    await setIsWatchTracked(db, { id: 'sess-1', value: true });
    expect((await getSession(db, 'sess-1'))?.is_watch_tracked).toBe(true);

    const result = await pushEndToWatch(db, 'sess-1', { timeoutMs: 500 });

    expect(result.acked).toBe(true);
    expect(result.code).toBeNull();
    expect(bridge.sendMessage).toHaveBeenCalledTimes(1);
    // Flag still true — no false write happened.
    expect((await getSession(db, 'sess-1'))?.is_watch_tracked).toBe(true);
  });

  it('ack timeout — Watch never replies → flag flipped to false', async () => {
    const bridge = makeBridge({
      sendMessage: jest.fn(() => {
        // Never call replyCb / errCb — Watch app not responding.
      }),
    });
    installBridge(bridge);
    const { pushEndToWatch } = loadOrchestrator();

    await createSession(db, { id: 'sess-2', started_at: 2_000 });
    await setIsWatchTracked(db, { id: 'sess-2', value: true });

    const result = await pushEndToWatch(db, 'sess-2', { timeoutMs: 50 });

    expect(result.acked).toBe(false);
    expect(result.code).toBe('TIMEOUT');
    expect((await getSession(db, 'sess-2'))?.is_watch_tracked).toBe(false);
  });

  it('bridge errCb fires → flag flipped to false', async () => {
    const bridge = makeBridge({
      sendMessage: jest.fn((_msg, _replyCb, errCb) => {
        const e = new Error('TurboModule error') as Error & { code?: string };
        errCb?.(e);
      }),
    });
    installBridge(bridge);
    const { pushEndToWatch } = loadOrchestrator();

    await createSession(db, { id: 'sess-3', started_at: 3_000 });
    await setIsWatchTracked(db, { id: 'sess-3', value: true });

    const result = await pushEndToWatch(db, 'sess-3');

    expect(result.acked).toBe(false);
    expect(result.code).toBe('BRIDGE_ERROR');
    expect((await getSession(db, 'sess-3'))?.is_watch_tracked).toBe(false);
  });

  it('unreachable — Watch off → setter STILL called, flag flipped to false', async () => {
    // Even when sendMessage isn't invoked (pre-check shortcut), we must
    // flip the flag false because Watch didn't confirm end.
    const bridge = makeBridge({
      getReachability: jest.fn().mockResolvedValue(false),
      sendMessage: jest.fn(),
    });
    installBridge(bridge);
    const { pushEndToWatch } = loadOrchestrator();

    await createSession(db, { id: 'sess-4', started_at: 4_000 });
    await setIsWatchTracked(db, { id: 'sess-4', value: true });

    const result = await pushEndToWatch(db, 'sess-4');

    expect(result.acked).toBe(false);
    expect(result.code).toBe('NOT_REACHABLE');
    expect(bridge.sendMessage).not.toHaveBeenCalled();
    expect((await getSession(db, 'sess-4'))?.is_watch_tracked).toBe(false);
  });

  it('unpaired — no Watch → flag flipped to false', async () => {
    const bridge = makeBridge({
      getIsPaired: jest.fn().mockResolvedValue(false),
      sendMessage: jest.fn(),
    });
    installBridge(bridge);
    const { pushEndToWatch } = loadOrchestrator();

    await createSession(db, { id: 'sess-5', started_at: 5_000 });
    await setIsWatchTracked(db, { id: 'sess-5', value: true });

    const result = await pushEndToWatch(db, 'sess-5');

    expect(result.acked).toBe(false);
    expect(result.code).toBe('UNPAIRED');
    expect(bridge.sendMessage).not.toHaveBeenCalled();
    expect((await getSession(db, 'sess-5'))?.is_watch_tracked).toBe(false);
  });

  it('non-existent sessionId — ack ok but UPDATE is no-op, no throw', async () => {
    // Setter silently no-ops on missing row (sessionRepository convention).
    // pushEndToWatch should still resolve cleanly with acked:true since
    // the WC channel itself succeeded.
    const bridge = makeBridge({
      sendMessage: jest.fn((_msg, replyCb) => {
        replyCb?.({ ok: true });
      }),
    });
    installBridge(bridge);
    const { pushEndToWatch } = loadOrchestrator();

    const result = await pushEndToWatch(db, 'sess-not-in-db');

    expect(result.acked).toBe(true);
    expect(result.code).toBeNull();
    expect(await getSession(db, 'sess-not-in-db')).toBeNull();
  });
});
