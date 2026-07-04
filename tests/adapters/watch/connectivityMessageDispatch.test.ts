/**
 * Slice 13d — connectivity.ts legacy v1 inbound 'message' dispatch tests.
 *
 * ADDITIVE coverage for the legacy `addMessageListener` /
 * `ensureBridgeListenerMounted` path (connectivity.ts Section 3, lines
 * ~176-256) which the existing `connectivity.test.ts` does not exercise —
 * it only covered the v2 TUI ('user-info') + applicationContext channels.
 *
 * The legacy 'message' channel is the request-reply transport that D9
 * handshake + start-from-watch use (envelope + a `replyHandler` ack). Until
 * Wave 2 砍除 lands it remains live, so its dispatch contract is pinned here:
 *   - mounts ONE 'message' bridge listener on first addMessageListener
 *   - threads args[1] reply handler through, normalising non-function → undefined
 *   - dedupes by msgId via the ring buffer (seenMsgId)
 *   - drops envelopes missing `kind` or `msgId`, and non-object payloads
 *   - fans out to every handler registered for a kind; one throwing handler
 *     does not stop siblings
 *   - unsubscribe removes a single handler without tearing the channel down
 *   - `__resetBridgeForTests` clears the ring + all listener registries
 *
 * Mock + load helpers mirror connectivity.test.ts exactly (jest.doMock the
 * lib, jest.resetModules per case via loadModule).
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
 * Build a mock bridge whose `watchEvents.addListener` captures the 'message'
 * callback so a test can drive the inbound channel by invoking it directly.
 * Returns the bridge plus a `fire(...args)` helper and the captured
 * unsubscribe spy.
 */
function makeMessageBridge() {
  let captured: ((...args: unknown[]) => void) | undefined;
  const unsubscribe = jest.fn();
  const bridge: MockBridge = {
    getIsPaired: jest.fn().mockResolvedValue(true),
    getIsWatchAppInstalled: jest.fn().mockResolvedValue(true),
    getReachability: jest.fn().mockResolvedValue(true),
    sendMessage: jest.fn(),
    transferUserInfo: jest.fn(),
    updateApplicationContext: jest.fn(),
    watchEvents: {
      addListener: jest.fn((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'message') captured = cb;
        return unsubscribe;
      }),
    },
  };
  return {
    bridge,
    unsubscribe,
    fire: (...args: unknown[]) => {
      if (!captured) throw new Error('message listener not mounted');
      captured(...args);
    },
    isMounted: () => captured !== undefined,
  };
}

function installBridge(bridge: MockBridge): void {
  jest.doMock('../../../modules/expo-wcsession/compat', () => bridge);
}

describe('connectivity.ts — legacy v1 inbound "message" dispatch', () => {
  afterEach(() => {
    jest.dontMock('../../../modules/expo-wcsession/compat');
  });

  it('mounts exactly one "message" bridge listener even across multiple addMessageListener calls', () => {
    const { bridge } = makeMessageBridge();
    installBridge(bridge);
    const mod = loadModule();

    mod.addMessageListener('handshake', () => {});
    mod.addMessageListener('start-from-watch', () => {});
    mod.addMessageListener('handshake', () => {});

    const messageMounts = bridge.watchEvents.addListener.mock.calls.filter(
      (c) => c[0] === 'message',
    );
    expect(messageMounts).toHaveLength(1);
  });

  it('dispatches a matching-kind envelope to its handler', () => {
    const { bridge, fire } = makeMessageBridge();
    installBridge(bridge);
    const mod = loadModule();

    const handler = jest.fn();
    mod.addMessageListener('handshake', handler);

    const env = makeEnvelope('handshake', { protocolVersion: 1 } as never);
    fire(env, undefined);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toMatchObject({ kind: 'handshake', msgId: env.msgId });
  });

  it('threads a function args[1] through as the replyHandler', () => {
    const { bridge, fire } = makeMessageBridge();
    installBridge(bridge);
    const mod = loadModule();

    const handler = jest.fn();
    mod.addMessageListener('handshake', handler);

    const reply = jest.fn();
    fire(makeEnvelope('handshake', { protocolVersion: 1 } as never), reply);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][1]).toBe(reply);
  });

  it('normalises a non-function args[1] to undefined', () => {
    const { bridge, fire } = makeMessageBridge();
    installBridge(bridge);
    const mod = loadModule();

    const handler = jest.fn();
    mod.addMessageListener('handshake', handler);

    fire(makeEnvelope('handshake', { protocolVersion: 1 } as never), { not: 'a fn' });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][1]).toBeUndefined();
  });

  it('dedupes a repeated msgId — second delivery is dropped', () => {
    const { bridge, fire } = makeMessageBridge();
    installBridge(bridge);
    const mod = loadModule();

    const handler = jest.fn();
    mod.addMessageListener('handshake', handler);

    const env = makeEnvelope('handshake', { protocolVersion: 1 } as never);
    fire(env, undefined);
    fire(env, undefined); // same msgId → dedupe

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('drops envelopes missing kind or msgId, and non-object payloads', () => {
    const { bridge, fire } = makeMessageBridge();
    installBridge(bridge);
    const mod = loadModule();

    const handler = jest.fn();
    mod.addMessageListener('handshake', handler);

    fire(undefined, undefined); // no msg
    fire('not-an-object', undefined); // non-object
    fire({ msgId: 'm1' }, undefined); // missing kind
    fire({ kind: 'handshake' }, undefined); // missing msgId

    expect(handler).not.toHaveBeenCalled();
  });

  it('ignores an envelope whose kind has no registered handler set', () => {
    const { bridge, fire } = makeMessageBridge();
    installBridge(bridge);
    const mod = loadModule();

    const handler = jest.fn();
    mod.addMessageListener('handshake', handler);

    // start-from-watch has no handler registered → silently ignored.
    fire(makeEnvelope('start-from-watch', { sessionId: 's1' } as never), undefined);

    expect(handler).not.toHaveBeenCalled();
  });

  it('fans out to every handler of a kind; one throwing handler does not stop siblings', () => {
    const { bridge, fire } = makeMessageBridge();
    installBridge(bridge);
    const mod = loadModule();

    const order: string[] = [];
    const throwing = jest.fn(() => {
      order.push('throwing');
      throw new Error('boom');
    });
    const surviving = jest.fn(() => {
      order.push('surviving');
    });
    mod.addMessageListener('handshake', throwing);
    mod.addMessageListener('handshake', surviving);

    fire(makeEnvelope('handshake', { protocolVersion: 1 } as never), undefined);

    expect(throwing).toHaveBeenCalledTimes(1);
    expect(surviving).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['throwing', 'surviving']);
  });

  it('unsubscribe removes only that handler; the bridge listener stays mounted', () => {
    const { bridge, fire, unsubscribe } = makeMessageBridge();
    installBridge(bridge);
    const mod = loadModule();

    const a = jest.fn();
    const b = jest.fn();
    const unsubA = mod.addMessageListener('handshake', a);
    mod.addMessageListener('handshake', b);

    unsubA();
    fire(makeEnvelope('handshake', { protocolVersion: 1 } as never), undefined);

    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
    // Removing one handler must NOT tear down the shared 'message' channel.
    expect(unsubscribe).not.toHaveBeenCalled();
  });

  it('__resetBridgeForTests clears the msgId ring so a previously-seen id dispatches again', () => {
    const { bridge, fire } = makeMessageBridge();
    installBridge(bridge);
    const mod = loadModule();

    const handler = jest.fn();
    mod.addMessageListener('handshake', handler);

    const env = makeEnvelope('handshake', { protocolVersion: 1 } as never);
    fire(env, undefined);
    expect(handler).toHaveBeenCalledTimes(1);

    // Reset wipes the ring + listener registries. Re-register, fire the SAME
    // msgId again → it is no longer deduped (ring cleared).
    mod.__resetBridgeForTests();
    const handler2 = jest.fn();
    mod.addMessageListener('handshake', handler2);
    fire(env, undefined);

    expect(handler2).toHaveBeenCalledTimes(1);
  });
});

describe('connectivity.ts — seenMsgId ring buffer eviction', () => {
  afterEach(() => {
    jest.dontMock('../../../modules/expo-wcsession/compat');
  });

  it('evicts the oldest id once the 256-slot cap is exceeded', () => {
    const mod = loadModule();

    // Fill the ring exactly to cap (256 entries, ids 0..255). Each is a fresh
    // miss → inserted; size never exceeds the cap so no eviction yet.
    for (let i = 0; i < 256; i++) {
      expect(mod.seenMsgId(`id-${i}`)).toBe(false);
    }
    // Everything 0..255 is still present (cap not yet exceeded). Use read-only
    // hit checks — seenMsgId never re-orders an existing key on a hit, so these
    // probes do not disturb insertion order.
    expect(mod.seenMsgId('id-0')).toBe(true);
    expect(mod.seenMsgId('id-255')).toBe(true);

    // Push one brand-new id → size becomes 257 > 256 → eviction fires and
    // removes the OLDEST insertion (id-0). Returns false because id-256 itself
    // is fresh.
    expect(mod.seenMsgId('id-256')).toBe(false);
    // A still-present mid-ring id (id-100) is a hit — only the single oldest
    // entry was evicted, not the whole ring. (Probing id-100 here is a hit and
    // does not reinsert, so it triggers no further eviction.)
    expect(mod.seenMsgId('id-100')).toBe(true);
  });
});
