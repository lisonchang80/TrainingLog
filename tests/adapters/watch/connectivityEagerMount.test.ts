/**
 * #287 Fix C — eager WC bridge mount at app entry (Release standalone fix).
 *
 * Pins the contract that `initWatchBridge()` mounts the native
 * WatchConnectivity subscriptions ('message', 'user-info',
 * 'application-context') at APP ENTRY — independent of, and before, any
 * per-kind handler registration that the home screen does once the DB is
 * ready.
 *
 * Background (root cause report 01): the npm package's iOS module is a
 * singleton RCTEventEmitter TurboModule that buffers inbound WCSession
 * events behind `hasObservers`, which only flips YES when JS calls
 * `addListener` (→ native `startObserving`, which also flushes the buffer).
 * Mounting the subscription eagerly makes that happen before the Watch's
 * first envelope arrives on a Release cold boot.
 *
 * The split design (bridge-eager / handler-gated) means envelopes that the
 * eagerly-mounted bridge delivers BEFORE a handler exists must not be lost:
 * they're parked in a pre-handler replay buffer and replayed when the
 * handler later registers. These tests pin both halves.
 *
 * Mock + load helpers mirror connectivity.test.ts (jest.doMock the lib,
 * jest.resetModules per case via loadModule).
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
  transferUserInfo: jest.Mock;
  updateApplicationContext: jest.Mock;
  watchEvents: { addListener: jest.Mock };
}

/**
 * Build a mock bridge capturing the callback for each event so a test can
 * drive the inbound channel directly. Exposes `fire<channel>(...)` helpers.
 */
function makeCapturingBridge() {
  const captured: Record<string, ((...args: unknown[]) => void) | undefined> = {};
  const unsubscribe = jest.fn();
  const bridge: MockBridge = {
    getIsPaired: jest.fn().mockResolvedValue(true),
    getIsWatchAppInstalled: jest.fn().mockResolvedValue(true),
    getReachability: jest.fn().mockResolvedValue(true),
    sendMessage: jest.fn(),
    transferUserInfo: jest.fn(),
    updateApplicationContext: jest.fn(),
    watchEvents: {
      addListener: jest.fn(
        (event: string, cb: (...args: unknown[]) => void) => {
          captured[event] = cb;
          return unsubscribe;
        },
      ),
    },
  };
  return {
    bridge,
    fireMessage: (...args: unknown[]) => captured['message']?.(...args),
    fireUserInfo: (batch: unknown) => captured['user-info']?.(batch),
    fireAppContext: (ctx: unknown) => captured['application-context']?.(ctx),
  };
}

function installBridge(bridge: MockBridge): void {
  jest.doMock('../../../modules/expo-wcsession/compat', () => bridge);
}

describe('#287 Fix C — initWatchBridge() eager mount at app entry', () => {
  afterEach(() => {
    jest.dontMock('../../../modules/expo-wcsession/compat');
  });

  it('mounts all three native subscriptions BEFORE any handler is registered', () => {
    const { bridge } = makeCapturingBridge();
    installBridge(bridge);
    const mod = loadModule();

    // Simulate app entry (app/_layout.tsx effect) — no handlers yet.
    expect(mod.__isBridgeMountedForTests()).toBe(false);
    const ok = mod.initWatchBridge();
    expect(ok).toBe(true);
    expect(mod.__isBridgeMountedForTests()).toBe(true);

    const events = bridge.watchEvents.addListener.mock.calls.map((c) => c[0]);
    expect(events).toEqual(
      expect.arrayContaining(['message', 'user-info', 'application-context']),
    );
  });

  it('is idempotent — does not double-subscribe when the home screen later calls addMessageListener', () => {
    const { bridge } = makeCapturingBridge();
    installBridge(bridge);
    const mod = loadModule();

    mod.initWatchBridge();
    // Home screen mounts later and registers per-kind handlers.
    mod.addMessageListener('handshake', () => {});
    mod.addUserInfoListener('start-from-watch', () => {});
    mod.addAppContextListener(() => {});

    const countFor = (ev: string) =>
      bridge.watchEvents.addListener.mock.calls.filter((c) => c[0] === ev)
        .length;
    expect(countFor('message')).toBe(1);
    expect(countFor('user-info')).toBe(1);
    expect(countFor('application-context')).toBe(1);
  });

  it('returns false (no throw) when the native lib is unavailable', () => {
    jest.doMock('../../../modules/expo-wcsession/compat', () => {
      throw new Error('TurboModuleRegistry.getEnforcing failed');
    });
    const mod = loadModule();

    expect(() => mod.initWatchBridge()).not.toThrow();
    expect(mod.initWatchBridge()).toBe(false);
    expect(mod.__isBridgeMountedForTests()).toBe(false);
  });

  // ─── audit B🟡-2 — inbound-journal anomaly surface ───────────────────

  it('wires the compat anomaly listener and fans gapUnrecoverable out to app handlers', () => {
    const { bridge } = makeCapturingBridge();
    let compatListener:
      | ((r: { pulled: number; epochChanged: boolean; gapUnrecoverable: boolean }) => void)
      | null = null;
    const wired = Object.assign(bridge, {
      startReconcilePolling: jest.fn(),
      setReconcileAnomalyListener: jest.fn((cb) => {
        compatListener = cb;
      }),
    });
    installBridge(wired);
    const mod = loadModule();

    mod.initWatchBridge();
    expect(wired.setReconcileAnomalyListener).toHaveBeenCalledTimes(1);
    expect(compatListener).not.toBeNull();

    const received: unknown[] = [];
    const unsubscribe = mod.addWatchInboundAnomalyListener((r) => received.push(r));

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const anomaly = { pulled: 3, epochChanged: false, gapUnrecoverable: true };
    compatListener!(anomaly);
    expect(received).toEqual([anomaly]);
    expect(warnSpy).toHaveBeenCalled(); // observability even with no handler
    warnSpy.mockRestore();

    // Unsubscribed handlers stop receiving.
    unsubscribe();
    compatListener!(anomaly);
    expect(received).toHaveLength(1);
  });

  it('reconcileWatchInbound normalises a legacy bridge result (no gapUnrecoverable key) to false', () => {
    const { bridge } = makeCapturingBridge();
    const wired = Object.assign(bridge, {
      reconcileNow: jest.fn(() => ({ pulled: 2, epochChanged: false })),
    });
    installBridge(wired);
    const mod = loadModule();

    expect(mod.reconcileWatchInbound()).toEqual({
      pulled: 2,
      epochChanged: false,
      gapUnrecoverable: false,
    });
  });

  // ─── Pre-handler replay buffer (the cold-boot race window) ──────────

  it("replays a 'message' envelope that arrived before its handler registered", () => {
    const { bridge, fireMessage } = makeCapturingBridge();
    installBridge(bridge);
    const mod = loadModule();

    // App entry — bridge mounted, but NO handler for 'handshake' yet.
    mod.initWatchBridge();
    const env = makeEnvelope('handshake', { protocolVersion: 1 } as never);
    fireMessage(env, undefined); // arrives during cold-boot race → buffered

    // Home screen mounts later and registers the handler.
    const handler = jest.fn();
    mod.addMessageListener('handshake', handler);

    // The buffered envelope is replayed into the freshly-registered handler.
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toMatchObject({
      kind: 'handshake',
      msgId: env.msgId,
    });
  });

  it("replays a 'user-info' (TUI) envelope buffered before its handler registered", () => {
    const { bridge, fireUserInfo } = makeCapturingBridge();
    installBridge(bridge);
    const mod = loadModule();

    mod.initWatchBridge();
    const env = makeEnvelope('start-from-watch', { sessionId: 's1' } as never);
    fireUserInfo([env]); // TUI delivers an ARRAY; arrives before handler

    const handler = jest.fn();
    mod.addUserInfoListener('start-from-watch', handler);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toMatchObject({
      kind: 'start-from-watch',
      msgId: env.msgId,
    });
  });

  it('does not replay a buffered envelope into a handler of a DIFFERENT kind', () => {
    const { bridge, fireMessage } = makeCapturingBridge();
    installBridge(bridge);
    const mod = loadModule();

    mod.initWatchBridge();
    fireMessage(makeEnvelope('handshake', { protocolVersion: 1 } as never), undefined);

    // Register a handler for a DIFFERENT kind — the buffered handshake must
    // not leak into it.
    const startHandler = jest.fn();
    mod.addMessageListener('start-from-watch', startHandler);

    expect(startHandler).not.toHaveBeenCalled();
  });

  it('replays each buffered envelope exactly once (no double-delivery via dedupe + drain)', () => {
    const { bridge, fireMessage } = makeCapturingBridge();
    installBridge(bridge);
    const mod = loadModule();

    mod.initWatchBridge();
    const env = makeEnvelope('handshake', { protocolVersion: 1 } as never);
    // Same envelope twice during the race — intake dedupe (seenMsgId) drops
    // the second, so only one is buffered.
    fireMessage(env, undefined);
    fireMessage(env, undefined);

    const handler = jest.fn();
    mod.addMessageListener('handshake', handler);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('once a handler is registered, subsequent envelopes dispatch live (not buffered)', () => {
    const { bridge, fireMessage } = makeCapturingBridge();
    installBridge(bridge);
    const mod = loadModule();

    mod.initWatchBridge();
    const handler = jest.fn();
    mod.addMessageListener('handshake', handler);

    // Buffer is empty; a fresh envelope after registration goes straight
    // through.
    fireMessage(makeEnvelope('handshake', { protocolVersion: 1 } as never), undefined);
    fireMessage(makeEnvelope('handshake', { protocolVersion: 1 } as never), undefined);

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('does not pull in the DB — initWatchBridge is callable at app entry with no DB context', () => {
    // The whole point: this runs in app/_layout.tsx's effect, which fires
    // before <DatabaseProvider> has opened the DB. The mock bridge has no DB
    // surface; a successful mount with zero DB access proves the decoupling.
    const { bridge } = makeCapturingBridge();
    installBridge(bridge);
    const mod = loadModule();

    expect(() => mod.initWatchBridge()).not.toThrow();
    // No DB-shaped calls exist on the bridge; mounting only touched
    // watchEvents.addListener.
    expect(bridge.watchEvents.addListener).toHaveBeenCalled();
  });
});
