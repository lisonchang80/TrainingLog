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
  transferUserInfo: jest.Mock;
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
    transferUserInfo: jest.fn(),
    updateApplicationContext: jest.fn(),
    watchEvents: {
      addListener: jest.fn().mockReturnValue(() => {}),
    },
    ...overrides,
  };
}

function installBridge(bridge: MockBridge): void {
  jest.doMock('../../../modules/expo-wcsession/compat', () => bridge);
}

describe('Slice 13d D6 — connectivity.ts', () => {
  afterEach(() => {
    jest.dontMock('../../../modules/expo-wcsession/compat');
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

  // ═══════════════════════════════════════════════════════════════════
  //  NEW-Q50 v2 — TUI + applicationContext primary surface
  //  (frozen 2026-05-29 evening grill, ADR-0019 § Slice 13d NEW-Q50)
  // ═══════════════════════════════════════════════════════════════════

  // ─── sendUserInfo (TUI outbound) ────────────────────────────────────

  it('sendUserInfo — happy path: bridge.transferUserInfo called with envelope', () => {
    const bridge = makeBridge();
    installBridge(bridge);
    const mod = loadModule();

    const env = makeEnvelope('start-from-iphone', {
      sessionId: 'sess-w1',
      snapshot: {},
    });
    mod.sendUserInfo(env);

    expect(bridge.transferUserInfo).toHaveBeenCalledTimes(1);
    expect(bridge.transferUserInfo).toHaveBeenCalledWith(env);
  });

  it('sendUserInfo — bridge throws → swallowed silently (Q11 best-effort)', () => {
    const bridge = makeBridge({
      transferUserInfo: jest.fn(() => {
        throw new Error('TurboModule call failed');
      }),
    });
    installBridge(bridge);
    const mod = loadModule();

    const env = makeEnvelope('start-from-iphone', {
      sessionId: 'sess-w2',
      snapshot: {},
    });
    expect(() => mod.sendUserInfo(env)).not.toThrow();
    expect(bridge.transferUserInfo).toHaveBeenCalledTimes(1);
  });

  it('sendUserInfo — WC bridge entirely unavailable → swallowed silently', () => {
    // Simulate transferUserInfo undefined (lib not loaded / partial mock).
    jest.doMock('../../../modules/expo-wcsession/compat', () => ({
      getIsPaired: jest.fn().mockResolvedValue(false),
      getIsWatchAppInstalled: jest.fn().mockResolvedValue(false),
      getReachability: jest.fn().mockResolvedValue(false),
      sendMessage: jest.fn(),
      // transferUserInfo intentionally omitted to simulate broken lib
      updateApplicationContext: jest.fn(),
      watchEvents: { addListener: jest.fn().mockReturnValue(() => {}) },
    }));
    const mod = loadModule();

    const env = makeEnvelope('start-from-iphone', {
      sessionId: 'sess-w3',
      snapshot: {},
    });
    expect(() => mod.sendUserInfo(env)).not.toThrow();
  });

  // ─── addUserInfoListener (TUI inbound dispatch) ─────────────────────

  it('addUserInfoListener — subscribes via watchEvents.addListener("user-info") + dispatches matching kind', () => {
    let capturedCallback:
      | ((...args: unknown[]) => void)
      | null = null;
    const bridge = makeBridge({
      watchEvents: {
        addListener: jest.fn(
          (event: string, cb: (...args: unknown[]) => void) => {
            if (event === 'user-info') capturedCallback = cb;
            return () => {};
          },
        ),
      },
    });
    installBridge(bridge);
    const mod = loadModule();

    const handler = jest.fn();
    mod.addUserInfoListener('start-from-iphone', handler);

    expect(bridge.watchEvents.addListener).toHaveBeenCalledWith(
      'user-info',
      expect.any(Function),
    );
    expect(capturedCallback).not.toBeNull();

    // Simulate lib delivery — lib sends ARRAY of payloads per
    // WatchEventCallbacks['user-info']: (payload: P[]) => void.
    const env = makeEnvelope('start-from-iphone', {
      sessionId: 'sess-r1',
      snapshot: {},
    });
    capturedCallback!([env]);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(env);
  });

  it('addUserInfoListener — dispatches only to matching kind, others skipped', () => {
    let capturedCallback:
      | ((...args: unknown[]) => void)
      | null = null;
    const bridge = makeBridge({
      watchEvents: {
        addListener: jest.fn(
          (event: string, cb: (...args: unknown[]) => void) => {
            if (event === 'user-info') capturedCallback = cb;
            return () => {};
          },
        ),
      },
    });
    installBridge(bridge);
    const mod = loadModule();

    const startHandler = jest.fn();
    const endHandler = jest.fn();
    mod.addUserInfoListener('start-from-iphone', startHandler);
    mod.addUserInfoListener('end-session', endHandler);

    const startEnv = makeEnvelope('start-from-iphone', {
      sessionId: 'sess-r2',
      snapshot: {},
    });
    capturedCallback!([startEnv]);

    expect(startHandler).toHaveBeenCalledTimes(1);
    expect(endHandler).not.toHaveBeenCalled();
  });

  it('addUserInfoListener — unsubscribe stops further dispatch', () => {
    let capturedCallback:
      | ((...args: unknown[]) => void)
      | null = null;
    const bridge = makeBridge({
      watchEvents: {
        addListener: jest.fn(
          (event: string, cb: (...args: unknown[]) => void) => {
            if (event === 'user-info') capturedCallback = cb;
            return () => {};
          },
        ),
      },
    });
    installBridge(bridge);
    const mod = loadModule();

    const handler = jest.fn();
    const unsubscribe = mod.addUserInfoListener('start-from-iphone', handler);

    const env = makeEnvelope('start-from-iphone', {
      sessionId: 'sess-r3',
      snapshot: {},
    });
    capturedCallback!([env]);
    expect(handler).toHaveBeenCalledTimes(1);

    unsubscribe();
    // Fresh envelope (new msgId) — re-firing `env` would be dropped by the
    // intake dedupe ring (F4) and pass for the wrong reason. A NEW msgId
    // reaches dispatch and proves the handler set no longer contains us.
    const envAfterUnsub = makeEnvelope('start-from-iphone', {
      sessionId: 'sess-r3b',
      snapshot: {},
    });
    capturedCallback!([envAfterUnsub]);
    expect(handler).toHaveBeenCalledTimes(1); // still 1 — no new fire after unsub
  });

  it('addUserInfoListener — handles batched delivery (multiple envelopes in one fire)', () => {
    let capturedCallback:
      | ((...args: unknown[]) => void)
      | null = null;
    const bridge = makeBridge({
      watchEvents: {
        addListener: jest.fn(
          (event: string, cb: (...args: unknown[]) => void) => {
            if (event === 'user-info') capturedCallback = cb;
            return () => {};
          },
        ),
      },
    });
    installBridge(bridge);
    const mod = loadModule();

    const handler = jest.fn();
    mod.addUserInfoListener('start-from-iphone', handler);

    const env1 = makeEnvelope('start-from-iphone', {
      sessionId: 'sess-r4a',
      snapshot: {},
    });
    const env2 = makeEnvelope('start-from-iphone', {
      sessionId: 'sess-r4b',
      snapshot: {},
    });
    // TUI batched delivery — both envelopes in one event.
    capturedCallback!([env1, env2]);

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenNthCalledWith(1, env1);
    expect(handler).toHaveBeenNthCalledWith(2, env2);
  });

  it('addUserInfoListener — tolerates a malformed native TUI delivery (no throw, no dispatch)', () => {
    // The native 'user-info' callback receives `payload: P[]`. A corrupt
    // delivery (non-array arg, falsy / non-object batch entries, or an entry
    // missing `kind`) must be skipped gracefully — never throw into the native
    // bridge, never dispatch garbage to a handler.
    let capturedCallback: ((...args: unknown[]) => void) | null = null;
    const bridge = makeBridge({
      watchEvents: {
        addListener: jest.fn(
          (event: string, cb: (...args: unknown[]) => void) => {
            if (event === 'user-info') capturedCallback = cb;
            return () => {};
          },
        ),
      },
    });
    installBridge(bridge);
    const mod = loadModule();

    const handler = jest.fn();
    mod.addUserInfoListener('start-from-iphone', handler);

    // 1. Non-array arg → early return.
    expect(() => capturedCallback!('not-an-array')).not.toThrow();
    expect(() => capturedCallback!(undefined)).not.toThrow();
    // 2. Array with falsy / non-object entries → each `continue`d.
    expect(() => capturedCallback!([null, 0, 'str', 42])).not.toThrow();
    // 3. Object entry missing `kind` → `continue`d.
    expect(() => capturedCallback!([{ payload: { sessionId: 'x' } }])).not.toThrow();

    // None of the malformed deliveries reached the handler.
    expect(handler).not.toHaveBeenCalled();

    // Sanity: a well-formed envelope mixed into the batch still dispatches.
    const good = makeEnvelope('start-from-iphone', {
      sessionId: 'sess-good',
      snapshot: {},
    });
    capturedCallback!([null, { nope: 1 }, good]);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(good);
  });

  it('addUserInfoListener — handler throw does not block sibling handlers', () => {
    let capturedCallback:
      | ((...args: unknown[]) => void)
      | null = null;
    const bridge = makeBridge({
      watchEvents: {
        addListener: jest.fn(
          (event: string, cb: (...args: unknown[]) => void) => {
            if (event === 'user-info') capturedCallback = cb;
            return () => {};
          },
        ),
      },
    });
    installBridge(bridge);
    const mod = loadModule();

    const throwingHandler = jest.fn(() => {
      throw new Error('handler crash');
    });
    const surviveHandler = jest.fn();
    mod.addUserInfoListener('start-from-iphone', throwingHandler);
    mod.addUserInfoListener('start-from-iphone', surviveHandler);

    const env = makeEnvelope('start-from-iphone', {
      sessionId: 'sess-r5',
      snapshot: {},
    });
    expect(() => capturedCallback!([env])).not.toThrow();
    expect(throwingHandler).toHaveBeenCalledTimes(1);
    expect(surviveHandler).toHaveBeenCalledTimes(1);
  });

  // ─── updateAppContext (applicationContext outbound) ─────────────────

  it('updateAppContext — happy path: bridge.updateApplicationContext called with snapshot', () => {
    const bridge = makeBridge();
    installBridge(bridge);
    const mod = loadModule();

    const snapshot = {
      session: {
        id: 'sess-ac1',
        title: 'Push day',
        exercises: [{ id: 'ex-1', sets: [] }],
      },
    };
    mod.updateAppContext(snapshot);

    expect(bridge.updateApplicationContext).toHaveBeenCalledTimes(1);
    expect(bridge.updateApplicationContext).toHaveBeenCalledWith(snapshot);
  });

  it('updateAppContext — swallows bridge throw (Q6 best-effort)', () => {
    const bridge = makeBridge({
      updateApplicationContext: jest.fn(() => {
        throw new Error('bridge crash');
      }),
    });
    installBridge(bridge);
    const mod = loadModule();

    const snapshot = { session: { id: 'sess-ac2' } };
    expect(() => mod.updateAppContext(snapshot)).not.toThrow();
  });

  // ─── addAppContextListener (applicationContext inbound) ─────────────

  it('addAppContextListener — subscribes via watchEvents.addListener("application-context") + dispatches', () => {
    let capturedCallback:
      | ((...args: unknown[]) => void)
      | null = null;
    const bridge = makeBridge({
      watchEvents: {
        addListener: jest.fn(
          (event: string, cb: (...args: unknown[]) => void) => {
            if (event === 'application-context') capturedCallback = cb;
            return () => {};
          },
        ),
      },
    });
    installBridge(bridge);
    const mod = loadModule();

    const handler = jest.fn();
    mod.addAppContextListener(handler);

    expect(bridge.watchEvents.addListener).toHaveBeenCalledWith(
      'application-context',
      expect.any(Function),
    );

    const ctx = { session: { id: 'sess-acr1', exercises: [] } };
    capturedCallback!(ctx);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(ctx);
  });

  it('addAppContextListener — unsubscribe stops further dispatch', () => {
    let capturedCallback:
      | ((...args: unknown[]) => void)
      | null = null;
    const bridge = makeBridge({
      watchEvents: {
        addListener: jest.fn(
          (event: string, cb: (...args: unknown[]) => void) => {
            if (event === 'application-context') capturedCallback = cb;
            return () => {};
          },
        ),
      },
    });
    installBridge(bridge);
    const mod = loadModule();

    const handler = jest.fn();
    const unsubscribe = mod.addAppContextListener(handler);

    const ctx = { session: { id: 'sess-acr2' } };
    capturedCallback!(ctx);
    expect(handler).toHaveBeenCalledTimes(1);

    unsubscribe();
    capturedCallback!(ctx);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  // ═══════════════════════════════════════════════════════════════════
  //  Sync fast lane (2026-06-01) — 'live-mirror' inbound routing
  //  The Watch dual-fires the live snapshot; the sendMessage leg arrives as
  //  a {kind:'live-mirror', payload} envelope on the 'message' event and must
  //  route to an addMessageListener('live-mirror', ...) handler (the index.tsx
  //  wiring `addMessageListener('live-mirror', env => onLiveMirror(db, env.payload))`).
  // ═══════════════════════════════════════════════════════════════════

  it("addMessageListener('live-mirror') — inbound message routes to the handler with env.payload = the snapshot", () => {
    let capturedCallback: ((...args: unknown[]) => void) | null = null;
    const bridge = makeBridge({
      watchEvents: {
        addListener: jest.fn(
          (event: string, cb: (...args: unknown[]) => void) => {
            if (event === 'message') capturedCallback = cb;
            return () => {};
          },
        ),
      },
    });
    installBridge(bridge);
    const mod = loadModule();

    const handler = jest.fn();
    mod.addMessageListener('live-mirror', handler);

    expect(bridge.watchEvents.addListener).toHaveBeenCalledWith(
      'message',
      expect.any(Function),
    );
    expect(capturedCallback).not.toBeNull();

    const env = makeEnvelope('live-mirror', {
      sessionId: 'sess-lm1',
      title: 'Push Day',
      startedAt: 1_700_000_000_000,
      exercises: [],
      rev: 100,
    });
    // Lib 'message' signature: (payload, replyHandler|null).
    capturedCallback!(env, null);

    expect(handler).toHaveBeenCalledTimes(1);
    // index.tsx reads env.payload — assert it survives the dispatch intact.
    const [deliveredEnv] = handler.mock.calls[0];
    expect(deliveredEnv.kind).toBe('live-mirror');
    expect(deliveredEnv.payload).toEqual({
      sessionId: 'sess-lm1',
      title: 'Push Day',
      startedAt: 1_700_000_000_000,
      exercises: [],
      rev: 100,
    });
  });

  it("addMessageListener('live-mirror') — a different-kind inbound does not fire the live-mirror handler", () => {
    let capturedCallback: ((...args: unknown[]) => void) | null = null;
    const bridge = makeBridge({
      watchEvents: {
        addListener: jest.fn(
          (event: string, cb: (...args: unknown[]) => void) => {
            if (event === 'message') capturedCallback = cb;
            return () => {};
          },
        ),
      },
    });
    installBridge(bridge);
    const mod = loadModule();

    const liveMirrorHandler = jest.fn();
    mod.addMessageListener('live-mirror', liveMirrorHandler);

    // An hr-tick on the SAME 'message' channel must not reach the live-mirror
    // handler (per-kind dispatch).
    const hrEnv = makeEnvelope('hr-tick', {
      sessionId: 'sess-lm2',
      bpm: 150,
      sampleTs: Date.now(),
    });
    capturedCallback!(hrEnv, null);

    expect(liveMirrorHandler).not.toHaveBeenCalled();
  });

  it("addMessageListener('live-mirror') — duplicate msgId is deduped (dual-fire same emit)", () => {
    let capturedCallback: ((...args: unknown[]) => void) | null = null;
    const bridge = makeBridge({
      watchEvents: {
        addListener: jest.fn(
          (event: string, cb: (...args: unknown[]) => void) => {
            if (event === 'message') capturedCallback = cb;
            return () => {};
          },
        ),
      },
    });
    installBridge(bridge);
    const mod = loadModule();

    const handler = jest.fn();
    mod.addMessageListener('live-mirror', handler);

    const env = makeEnvelope('live-mirror', {
      sessionId: 'sess-lm3',
      title: 'Push Day',
      startedAt: 1,
      exercises: [],
      rev: 1,
    });
    // The same envelope (same msgId) redelivered — the ring-buffer dedupe drops
    // the second. (The rev guard is a SECOND line of defence downstream; this
    // is the transport-level dedup.)
    capturedCallback!(env, null);
    capturedCallback!(env, null);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('addAppContextListener — non-object payload ignored', () => {
    let capturedCallback:
      | ((...args: unknown[]) => void)
      | null = null;
    const bridge = makeBridge({
      watchEvents: {
        addListener: jest.fn(
          (event: string, cb: (...args: unknown[]) => void) => {
            if (event === 'application-context') capturedCallback = cb;
            return () => {};
          },
        ),
      },
    });
    installBridge(bridge);
    const mod = loadModule();

    const handler = jest.fn();
    mod.addAppContextListener(handler);

    capturedCallback!(null);
    capturedCallback!(undefined);
    capturedCallback!('string-not-object');

    expect(handler).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────
// F4 (2026-06-12 audit) — TUI ('user-info') intake msgId dedupe,
// SHARED ring with the 'message' channel.
//
// A dual-fire kind (end-session / discard-session / start-* …) sends the
// SAME envelope (same msgId) via sendMessage + transferUserInfo. In
// foreground BOTH legs arrive; pre-F4 the TUI intake had no dedupe so
// every dual-fire envelope double-dispatched — the systemic root of the
// 2026-06-11 雙跳完成頁 class (fixed downstream in 1bb4d96; the durable
// DB gates there remain REQUIRED — this ring is in-memory only and does
// not survive relaunch, see the restart-replay case below).
// ─────────────────────────────────────────────────────────────────────
describe('connectivity.ts — F4 TUI intake msgId dedupe (shared ring)', () => {
  afterEach(() => {
    jest.dontMock('../../../modules/expo-wcsession/compat');
  });

  /** Bridge mock capturing BOTH 'message' and 'user-info' callbacks so a
   *  test can drive the two inbound channels independently. */
  function makeDualChannelBridge() {
    const captured: Record<string, (...args: unknown[]) => void> = {};
    const bridge = makeBridge({
      watchEvents: {
        addListener: jest.fn(
          (event: string, cb: (...args: unknown[]) => void) => {
            captured[event] = cb;
            return () => {};
          },
        ),
      },
    });
    return {
      bridge,
      fireMessage: (env: unknown, reply?: unknown) => {
        const cb = captured['message'];
        if (!cb) throw new Error('message listener not mounted');
        cb(env, reply);
      },
      fireUserInfo: (batch: unknown) => {
        const cb = captured['user-info'];
        if (!cb) throw new Error('user-info listener not mounted');
        cb(batch);
      },
    };
  }

  function endEnv() {
    return makeEnvelope('end-session', {
      sessionId: 'sess-f4',
      side: 'watch',
    });
  }

  it('dual-fire foreground: sendMessage leg arrives first → the TUI duplicate (same msgId) is dropped', () => {
    const { bridge, fireMessage, fireUserInfo } = makeDualChannelBridge();
    installBridge(bridge);
    const mod = loadModule();

    const msgHandler = jest.fn();
    const tuiHandler = jest.fn();
    mod.addMessageListener('end-session', msgHandler);
    mod.addUserInfoListener('end-session', tuiHandler);

    const env = endEnv();
    fireMessage(env, undefined); // instant foreground leg wins
    fireUserInfo([env]); // durable backstop leg → dedupe drop

    expect(msgHandler).toHaveBeenCalledTimes(1);
    expect(tuiHandler).not.toHaveBeenCalled();
  });

  it('dual-fire reversed: TUI leg arrives first → the sendMessage duplicate is dropped (ring is shared, symmetric)', () => {
    const { bridge, fireMessage, fireUserInfo } = makeDualChannelBridge();
    installBridge(bridge);
    const mod = loadModule();

    const msgHandler = jest.fn();
    const tuiHandler = jest.fn();
    mod.addMessageListener('end-session', msgHandler);
    mod.addUserInfoListener('end-session', tuiHandler);

    const env = endEnv();
    fireUserInfo([env]);
    fireMessage(env, undefined);

    expect(tuiHandler).toHaveBeenCalledTimes(1);
    expect(msgHandler).not.toHaveBeenCalled();
  });

  it('TUI-only delivery (background — sendMessage leg never fired) passes through', () => {
    const { bridge, fireUserInfo } = makeDualChannelBridge();
    installBridge(bridge);
    const mod = loadModule();

    const tuiHandler = jest.fn();
    mod.addUserInfoListener('end-session', tuiHandler);

    const env = endEnv();
    fireUserInfo([env]);

    expect(tuiHandler).toHaveBeenCalledTimes(1);
    expect(tuiHandler).toHaveBeenCalledWith(env);
  });

  it('TUI at-least-once redelivery within one app run (same msgId twice on the SAME channel) is dropped', () => {
    const { bridge, fireUserInfo } = makeDualChannelBridge();
    installBridge(bridge);
    const mod = loadModule();

    const tuiHandler = jest.fn();
    mod.addUserInfoListener('end-session', tuiHandler);

    const env = endEnv();
    fireUserInfo([env]);
    fireUserInfo([env]); // OS redelivery

    expect(tuiHandler).toHaveBeenCalledTimes(1);
  });

  it('post-restart TUI replay passes through (ring is in-memory) — downstream durable gates own that case', () => {
    const { bridge, fireUserInfo } = makeDualChannelBridge();
    installBridge(bridge);
    const mod = loadModule();

    const tuiHandler = jest.fn();
    mod.addUserInfoListener('end-session', tuiHandler);

    const env = endEnv();
    fireUserInfo([env]);
    expect(tuiHandler).toHaveBeenCalledTimes(1);

    // Simulate app relaunch: registries + msgId ring wiped (in-memory),
    // but TUI is an OS-durable queue that CAN redeliver the same envelope.
    mod.__resetBridgeForTests();
    const tuiHandler2 = jest.fn();
    mod.addUserInfoListener('end-session', tuiHandler2);
    fireUserInfo([env]);

    // The intake MUST let it through — dedupe here would be a lie (the
    // first dispatch's effects may not have committed pre-crash). The
    // durable DB gates (ended_at / INSERT OR IGNORE / idempotent DELETE)
    // are the post-restart idempotency layer.
    expect(tuiHandler2).toHaveBeenCalledTimes(1);
  });

  it('an envelope without msgId (legacy/defensive) passes through un-deduped, no crash', () => {
    const { bridge, fireUserInfo } = makeDualChannelBridge();
    installBridge(bridge);
    const mod = loadModule();

    const tuiHandler = jest.fn();
    mod.addUserInfoListener('end-session', tuiHandler);

    const bare = {
      kind: 'end-session',
      payload: { sessionId: 'sess-legacy', side: 'watch' },
    };
    expect(() => fireUserInfo([bare, bare])).not.toThrow();

    // No msgId → nothing to dedupe on → both deliveries dispatch.
    expect(tuiHandler).toHaveBeenCalledTimes(2);
  });

  it('dedupe runs BEFORE the pre-handler buffer: a TUI duplicate is not parked + replayed on later register', () => {
    const { bridge, fireMessage, fireUserInfo } = makeDualChannelBridge();
    installBridge(bridge);
    const mod = loadModule();

    // Production cold-boot shape (#287 Fix C): the bridge channels mount
    // eagerly at app entry; per-kind handlers register later from the
    // home screen. Mount all channels first, then register ONLY the
    // 'message' handler.
    mod.initWatchBridge();
    const msgHandler = jest.fn();
    mod.addMessageListener('end-session', msgHandler);

    const env = endEnv();
    fireMessage(env, undefined); // processed by the message handler
    fireUserInfo([env]); // duplicate, NO user-info handler yet

    // Register the user-info handler AFTER the duplicate landed — the
    // Fix C replay buffer must NOT hand it the deduped envelope.
    const tuiHandler = jest.fn();
    mod.addUserInfoListener('end-session', tuiHandler);

    expect(msgHandler).toHaveBeenCalledTimes(1);
    expect(tuiHandler).not.toHaveBeenCalled();
  });

  it('distinct msgIds on the TUI channel are NOT deduped (resend mints a new msgId by design)', () => {
    const { bridge, fireUserInfo } = makeDualChannelBridge();
    installBridge(bridge);
    const mod = loadModule();

    const tuiHandler = jest.fn();
    mod.addUserInfoListener('end-session', tuiHandler);

    // Two semantically-identical payloads but separate envelopes — e.g.
    // resendStartFromWatch re-keys msgId+ts precisely so the dedupe ring
    // treats it as new. Both must dispatch.
    fireUserInfo([endEnv()]);
    fireUserInfo([endEnv()]);

    expect(tuiHandler).toHaveBeenCalledTimes(2);
  });
});
