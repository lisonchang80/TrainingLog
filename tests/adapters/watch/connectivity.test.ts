/**
 * Slice 13d D6 — connectivity.ts bridge wrapper tests.
 *
 * Replaces the D3 scaffold (Agent Z 2026-05-27) with real tests now
 * that connectivity.ts lands.
 *
 * Coverage: 6 outbound behaviours from the micro-PRD (happy reply /
 * errCb / timeout / unpaired / unreachable / bridge throw), plus the
 * inbound msgId dedupe + silent-failing state queries.
 *
 * Implementation note: we use real timers (not fake) because the
 * sendMessage flow chains `await isPaired() → await isReachable() →
 * setTimeout(...) → bridge().sendMessage(...)` and faking timers makes
 * microtask interleaving brittle. Tests that need timeout use a small
 * real timeoutMs (~50ms) and wait actual wall time — total suite cost
 * is < 0.5s.
 */

import { makeEnvelope } from '../../../src/adapters/watch/payloadSchema';

function loadModule() {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../../src/adapters/watch/connectivity') as typeof import('../../../src/adapters/watch/connectivity');
}

interface MockBridge {
  getIsPaired: jest.Mock;
  getIsWatchAppInstalled: jest.Mock;
  getReachability: jest.Mock;
  sendMessage: jest.Mock;
  updateApplicationContext: jest.Mock;
  watchEvents: {
    addListener: jest.Mock;
  };
}

function makeBridge(overrides: Partial<MockBridge> = {}): MockBridge {
  return {
    getIsPaired: jest.fn().mockResolvedValue(true),
    getIsWatchAppInstalled: jest.fn().mockResolvedValue(true),
    getReachability: jest.fn().mockResolvedValue(true),
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

describe('Slice 13d D6 — connectivity.ts', () => {
  afterEach(() => {
    jest.dontMock('react-native-watch-connectivity');
  });

  // ─── Outbound sendMessage ──────────────────────────────────────────

  it('happy path — Watch replyHandler fires synchronously → {ok:true, reply}', async () => {
    const bridge = makeBridge({
      sendMessage: jest.fn((_msg, replyCb) => {
        replyCb?.({ ok: true, ackMsgId: 'echo-1' });
      }),
    });
    installBridge(bridge);
    const mod = loadModule();

    const env = makeEnvelope('start-from-iphone', {
      sessionId: 'sess-1',
      snapshot: {},
    });
    const result = await mod.sendMessage(env, { timeoutMs: 2000 });

    expect(result).toEqual({
      ok: true,
      reply: { ok: true, ackMsgId: 'echo-1' },
    });
    expect(bridge.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('errCb fires → {ok:false, code:"BRIDGE_ERROR", error}', async () => {
    const bridge = makeBridge({
      sendMessage: jest.fn((_msg, _replyCb, errCb) => {
        const e = new Error('mock bridge error') as Error & { code?: string };
        e.code = 'WC_7008';
        errCb?.(e);
      }),
    });
    installBridge(bridge);
    const mod = loadModule();

    const env = makeEnvelope('start-from-iphone', {
      sessionId: 'sess-2',
      snapshot: {},
    });
    const result = await mod.sendMessage(env);

    expect(result).toEqual({
      ok: false,
      code: 'BRIDGE_ERROR',
      error: 'mock bridge error',
    });
  });

  it('neither callback fires before timeout → {ok:false, code:"TIMEOUT"}', async () => {
    const bridge = makeBridge({
      sendMessage: jest.fn(() => {
        // Never call replyCb nor errCb — simulate dropped channel.
      }),
    });
    installBridge(bridge);
    const mod = loadModule();

    const env = makeEnvelope('start-from-iphone', {
      sessionId: 'sess-3',
      snapshot: {},
    });
    const result = await mod.sendMessage(env, { timeoutMs: 50 });

    expect(result).toEqual({ ok: false, code: 'TIMEOUT' });
  });

  it('unpaired precheck → {ok:false, code:"UNPAIRED"}, no sendMessage call', async () => {
    const bridge = makeBridge({
      getIsPaired: jest.fn().mockResolvedValue(false),
    });
    installBridge(bridge);
    const mod = loadModule();

    const env = makeEnvelope('start-from-iphone', {
      sessionId: 'sess-4',
      snapshot: {},
    });
    const result = await mod.sendMessage(env);

    expect(result).toEqual({ ok: false, code: 'UNPAIRED' });
    expect(bridge.sendMessage).not.toHaveBeenCalled();
  });

  it('unreachable precheck → {ok:false, code:"NOT_REACHABLE"}, no sendMessage call', async () => {
    const bridge = makeBridge({
      getIsPaired: jest.fn().mockResolvedValue(true),
      getReachability: jest.fn().mockResolvedValue(false),
    });
    installBridge(bridge);
    const mod = loadModule();

    const env = makeEnvelope('start-from-iphone', {
      sessionId: 'sess-5',
      snapshot: {},
    });
    const result = await mod.sendMessage(env);

    expect(result).toEqual({ ok: false, code: 'NOT_REACHABLE' });
    expect(bridge.sendMessage).not.toHaveBeenCalled();
  });

  it('bridge.sendMessage itself throws synchronously → {ok:false, code:"BRIDGE_ERROR"}', async () => {
    const bridge = makeBridge({
      sendMessage: jest.fn(() => {
        throw new Error('TurboModule call failed');
      }),
    });
    installBridge(bridge);
    const mod = loadModule();

    const env = makeEnvelope('start-from-iphone', {
      sessionId: 'sess-6',
      snapshot: {},
    });
    const result = await mod.sendMessage(env);

    expect(result).toEqual({
      ok: false,
      code: 'BRIDGE_ERROR',
      error: 'TurboModule call failed',
    });
  });

  // ─── Inbound msgId dedupe ──────────────────────────────────────────

  it('seenMsgId rings the buffer + dedupes duplicate ids', () => {
    installBridge(makeBridge());
    const mod = loadModule();

    expect(mod.seenMsgId('id-a')).toBe(false);
    expect(mod.seenMsgId('id-a')).toBe(true); // second time = dedupe
    expect(mod.seenMsgId('id-b')).toBe(false);
  });

  // ─── State queries silent-fail ──────────────────────────────────────

  it('isPaired() returns false when bridge throws', async () => {
    const bridge = makeBridge({
      getIsPaired: jest.fn().mockRejectedValue(new Error('bridge down')),
    });
    installBridge(bridge);
    const mod = loadModule();

    await expect(mod.isPaired()).resolves.toBe(false);
  });

  it('isReachable() returns false when bridge throws', async () => {
    const bridge = makeBridge({
      getReachability: jest.fn().mockRejectedValue(new Error('bridge down')),
    });
    installBridge(bridge);
    const mod = loadModule();

    await expect(mod.isReachable()).resolves.toBe(false);
  });

  // ─── updateApplicationContext fire-and-forget ───────────────────────

  it('updateApplicationContext swallows bridge throw', () => {
    const bridge = makeBridge({
      updateApplicationContext: jest.fn(() => {
        throw new Error('bridge crash');
      }),
    });
    installBridge(bridge);
    const mod = loadModule();

    const env = makeEnvelope('hr-tick', {
      sessionId: 'sess-x',
      bpm: 142,
      sampleTs: Date.now(),
    });
    expect(() => mod.updateApplicationContext(env)).not.toThrow();
  });
});
