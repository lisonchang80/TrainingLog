/**
 * Issue #55 ② (2026-07-05) — 「單通道註冊 × 雙通道發送」park-to-death 回歸鎖.
 *
 * The Watch Swift senders DUAL-FIRE several kinds (same envelope / same msgId
 * over sendMessage + transferUserInfo). Post-F4 (2026-06-12) the msgId dedupe
 * ring is SHARED across both iPhone intakes, and the 'message' intake claims
 * the msgId BEFORE the handler-existence check (parking handler-less envelopes
 * in the #287 Fix C pre-handler buffer). Consequence: a dual-fired kind whose
 * handler is registered on the user-info channel ONLY is silently lost
 * whenever the sendMessage leg wins intake (the common foreground case) —
 *
 *   1. message leg arrives → msgId claimed in the shared ring → no 'message'
 *      handler for the kind → parked in the pre-handler buffer (forever,
 *      since no message-channel handler will ever register for it),
 *   2. TUI leg arrives → same msgId → ring dup → dropped at intake,
 *   3. the user-info handler NEVER fires. (#55 ② — 錶「放棄」手機不停.)
 *
 * Two lock layers here:
 *   A. Mechanism — prove the trap exists in connectivity.ts semantics (so a
 *      future intake refactor that removes the trap can consciously retire
 *      the symmetry rule).
 *   B. Wire symmetry — parse `app/(tabs)/index.tsx` and assert every
 *      dual-fired Watch→iPhone kind is registered on BOTH channels.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

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

/** Bridge mock capturing BOTH 'message' and 'user-info' callbacks so a test
 *  can drive the two inbound channels independently (same pattern as the F4
 *  suite in connectivity.test.ts). */
function makeDualChannelBridge() {
  const captured: Record<string, (...args: unknown[]) => void> = {};
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
          return () => {};
        },
      ),
    },
  };
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

function installBridge(bridge: MockBridge): void {
  jest.doMock('../../../modules/expo-wcsession/compat', () => bridge);
}

describe('#55 ② — dual-fire kind park-to-death mechanism', () => {
  afterEach(() => {
    jest.dontMock('../../../modules/expo-wcsession/compat');
  });

  function discardEnv() {
    return makeEnvelope('discard-session', {
      sessionId: 'sess-55-2',
      side: 'watch',
    });
  }

  it('user-info-ONLY registration + message leg wins intake → handler NEVER fires (the trap)', () => {
    const { bridge, fireMessage, fireUserInfo } = makeDualChannelBridge();
    installBridge(bridge);
    const mod = loadModule();

    const tuiHandler = jest.fn();
    // Deliberately NO addMessageListener — the pre-#55② registration shape.
    mod.addUserInfoListener('discard-session', tuiHandler);
    // Mount the message intake the way the app does (eager bridge mount) so
    // the message leg is actually consumed by the shared-ring intake.
    mod.initWatchBridge();

    const env = discardEnv();
    fireMessage(env, undefined); // instant leg wins → claims ring, parked
    fireUserInfo([env]); // durable leg → ring dup → dropped

    // The kind's only handler never runs — this is the silent-loss failure
    // mode that makes dual-channel registration MANDATORY for dual-fired
    // kinds. If an intake refactor makes this assertion fail (handler now
    // fires), the symmetry rule below can be consciously retired.
    expect(tuiHandler).not.toHaveBeenCalled();
  });

  it('both channels registered → exactly-once dispatch (message leg wins)', () => {
    const { bridge, fireMessage, fireUserInfo } = makeDualChannelBridge();
    installBridge(bridge);
    const mod = loadModule();

    const msgHandler = jest.fn();
    const tuiHandler = jest.fn();
    mod.addMessageListener('discard-session', msgHandler);
    mod.addUserInfoListener('discard-session', tuiHandler);

    const env = discardEnv();
    fireMessage(env, undefined);
    fireUserInfo([env]);

    expect(msgHandler).toHaveBeenCalledTimes(1);
    expect(tuiHandler).not.toHaveBeenCalled();
  });

  it('both channels registered → exactly-once dispatch (TUI leg wins, symmetric)', () => {
    const { bridge, fireMessage, fireUserInfo } = makeDualChannelBridge();
    installBridge(bridge);
    const mod = loadModule();

    const msgHandler = jest.fn();
    const tuiHandler = jest.fn();
    mod.addMessageListener('start-resolve', msgHandler);
    mod.addUserInfoListener('start-resolve', tuiHandler);

    const env = makeEnvelope('start-resolve', {
      localSessionId: 'w-local',
      existingSessionId: 'i-existing',
    });
    fireUserInfo([env]);
    fireMessage(env, undefined);

    expect(tuiHandler).toHaveBeenCalledTimes(1);
    expect(msgHandler).not.toHaveBeenCalled();
  });
});

describe('#55 ② — index.tsx wire registration symmetry (source lock)', () => {
  /**
   * Every Watch→iPhone kind whose Swift sender dual-fires over sendMessage +
   * transferUserInfo (same msgId). Source of truth: the senders in
   * `ios/TrainingLog Watch Watch App/WatchConnectivityCoordinator.swift` —
   *   - sendEndEnvelope            → end-session      (TUI + msg)
   *   - sendStartFromWatchTUI /
   *     resendStartFromWatch       → start-from-watch (TUI + msg)
   *   - sendStartResolveToiPhone   → start-resolve    (TUI + msg)
   *   - sendDiscardToiPhone        → discard-session  (TUI + msg)
   *   - sendLock                   → lock-*           (TUI + msg)
   * NOT here (single-channel by design):
   *   - handshake / history-request / notes-request — sendMessage+replyHandler
   *     request-reply only (no TUI leg).
   *   - hr-tick / kcal-tick — sendMessage-when-reachable only (live-kind rule:
   *     a durable queue replaying stale ticks is worse than dropping).
   *   - live-mirror — sendMessage + applicationContext (NOT TUI); its two
   *     channels are message + app-context, asserted separately below.
   */
  const DUAL_FIRED_WATCH_KINDS = [
    'end-session',
    'start-from-watch',
    'start-resolve',
    'discard-session',
    'lock-request',
    'lock-grant',
    'lock-ack',
    'lock-takeover',
    'lock-sync',
  ] as const;

  const source = readFileSync(
    join(__dirname, '../../../app/(tabs)/index.tsx'),
    'utf8',
  );

  function registeredKinds(fnName: string): Set<string> {
    const kinds = new Set<string>();
    const re = new RegExp(`${fnName}\\(\\s*'([^']+)'`, 'g');
    for (const m of source.matchAll(re)) kinds.add(m[1]);
    return kinds;
  }

  const messageKinds = registeredKinds('addMessageListener');
  const userInfoKinds = registeredKinds('addUserInfoListener');

  it.each(DUAL_FIRED_WATCH_KINDS)(
    "dual-fired kind '%s' is registered on BOTH message + user-info channels",
    (kind) => {
      expect(messageKinds.has(kind)).toBe(true);
      expect(userInfoKinds.has(kind)).toBe(true);
    },
  );

  it("live-mirror rides message + application-context (its dual pair)", () => {
    // The Watch dual-fires live-mirror over sendMessage + appContext (never
    // TUI); the iPhone must consume both. addAppContextListener is untyped
    // (raw snapshot dict) so presence of the call is the assertable signal.
    expect(messageKinds.has('live-mirror')).toBe(true);
    expect(source).toMatch(/addAppContextListener\(/);
  });

  it('sanity — the regexes actually found registrations (guards against a rename silently voiding this suite)', () => {
    expect(messageKinds.size).toBeGreaterThanOrEqual(10);
    expect(userInfoKinds.size).toBeGreaterThanOrEqual(8);
  });
});
