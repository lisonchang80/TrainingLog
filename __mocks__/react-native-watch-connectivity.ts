/**
 * Slice 13d / D0 spike + D6 NEW-Q50 — Jest mock for react-native-watch-connectivity.
 *
 * Why exists:
 *   - The real lib loads via `TurboModuleRegistry.getEnforcing(...)` which
 *     throws synchronously under `testEnvironment: node`. Any code path
 *     that even imports the lib (including the spike harness at
 *     `src/adapters/watch/spike/connectivitySpike.ts`) would crash the
 *     test runner at module-load time.
 *   - This file provides safe no-op defaults so transitive imports survive.
 *     Tests that want real-ish behavior should `jest.mock(...)` inline with
 *     their own implementations (per the pattern documented in the
 *     `tests/adapters/watch/connectivity.test.ts` scaffold, item #1 of
 *     V's coverage gap audit).
 *
 * Lifecycle: this mock should outlive the spike. Even after D3
 * `connectivity.ts` ships and the spike file is deleted, the real
 * `connectivity.ts` will also import this lib — the mock stays useful.
 *
 * NEW-Q50 (2026-05-29 evening): D6 rewrite adds TUI + applicationContext
 * channel as new primary transport. Mock surface extends:
 *   - `transferUserInfo()` queues outbound envelopes (introspectable via
 *     `__getQueuedUserInfo()`)
 *   - `updateApplicationContext()` records latest-only snapshot
 *     (introspectable via `__getAppContext()`)
 *   - `watchEvents.addListener('user-info', cb)` + `'application-context'`
 *     route fire helpers (`__fireUserInfo`, `__fireAppContext`) trigger
 *     subscribed callbacks per the real lib's event names
 *     (see node_modules/react-native-watch-connectivity/src/events/definitions.ts).
 *   - `__resetMockState()` clears all internal state between tests.
 *
 * Real lib API surface deviation note: the `'user-info'` event in the lib
 * delivers `payload: P[]` (an ARRAY — see definitions.ts line 34). Our
 * `__fireUserInfo(envelope)` helper accepts a single envelope and fires
 * `[envelope]` to mirror the real lib contract.
 */

// ---------------------------------------------------------------------
// Section 1 — Legacy v1 mock surface (D3 + D6 v1 sendMessage path)
// ---------------------------------------------------------------------

export const getIsPaired = jest.fn().mockResolvedValue(false);
export const getIsWatchAppInstalled = jest.fn().mockResolvedValue(false);
export const getReachability = jest.fn().mockResolvedValue(false);

export const sendMessage = jest.fn();
export const sendMessageData = jest.fn().mockResolvedValue('');

export const transferCurrentComplicationUserInfo = jest.fn();
export const transferFile = jest.fn().mockResolvedValue('');
export const getFileTransfers = jest.fn().mockResolvedValue({});
export const startFileTransfer = jest.fn().mockResolvedValue('');

export const getApplicationContext = jest.fn().mockResolvedValue(null);

export const getQueuedUserInfo = jest.fn().mockResolvedValue({});
export const clearUserInfoQueue = jest.fn().mockResolvedValue(null);
export const dequeueUserInfo = jest.fn();

// ---------------------------------------------------------------------
// Section 2 — NEW-Q50 v2 mock surface (TUI + applicationContext)
// ---------------------------------------------------------------------

type AnyEnvelope = Record<string, unknown>;
type UserInfoListener = (payload: AnyEnvelope[]) => void;
type AppContextListener = (ctx: AnyEnvelope) => void;

let queuedUserInfo: AnyEnvelope[] = [];
let latestAppContext: AnyEnvelope | null = null;
const userInfoListeners = new Set<UserInfoListener>();
const appContextListeners = new Set<AppContextListener>();

/**
 * Mock for `transferUserInfo(info)`. Real lib fires native
 * `WCSession.transferUserInfo()` which is fire-and-forget queue.
 * We capture the envelope into an internal queue introspectable via
 * `__getQueuedUserInfo()`.
 */
export const transferUserInfo = jest.fn((info: AnyEnvelope) => {
  queuedUserInfo.push(info);
});

/**
 * Mock for `updateApplicationContext(ctx)`. Real lib semantics are
 * "latest-state-only" — subsequent calls overwrite. We mirror by
 * replacing `latestAppContext` (no queue).
 */
export const updateApplicationContext = jest.fn((ctx: AnyEnvelope) => {
  latestAppContext = ctx;
});

// ---------------------------------------------------------------------
// Section 3 — Event subscription (mocks `watchEvents.addListener`)
// ---------------------------------------------------------------------

/**
 * Real lib exposes `watchEvents.addListener(event, cb)` which returns
 * an unsubscribe fn (see node_modules/react-native-watch-connectivity/
 * src/events/index.ts line 144). Our mock routes 'user-info' and
 * 'application-context' to internal listener sets so tests can fire
 * deterministically via `__fireUserInfo` / `__fireAppContext`.
 *
 * Other events (`message`, `reachability`, etc.) are accepted but no
 * fire helper is exposed — they remain no-ops for backward compat with
 * the legacy v1 mock used by `tests/services/watchSession*.test.ts`.
 */
export const watchEvents = {
  addListener: jest.fn(
    (event: string, cb: (...args: unknown[]) => void): (() => void) => {
      if (event === 'user-info') {
        userInfoListeners.add(cb as UserInfoListener);
        return () => userInfoListeners.delete(cb as UserInfoListener);
      }
      if (event === 'application-context') {
        appContextListeners.add(cb as AppContextListener);
        return () => appContextListeners.delete(cb as AppContextListener);
      }
      // Legacy 'message' / other events — no-op unsubscribe.
      return () => {
        // no-op
      };
    },
  ),
  on: jest.fn().mockReturnValue(() => {}),
  once: jest.fn().mockReturnValue(() => {}),
};

// ---------------------------------------------------------------------
// Section 4 — Test introspection helpers (double-underscore convention)
// ---------------------------------------------------------------------

/**
 * Get the queue of envelopes captured by `transferUserInfo()` calls
 * since the last `__resetMockState()`. Returns a fresh copy — mutating
 * the result does not affect the mock state.
 */
export function __getQueuedUserInfo(): AnyEnvelope[] {
  return [...queuedUserInfo];
}

/**
 * Get the latest applicationContext snapshot pushed via
 * `updateApplicationContext()`, or `null` if none pushed since reset.
 */
export function __getAppContext(): AnyEnvelope | null {
  return latestAppContext;
}

/**
 * Fire an inbound 'user-info' event to all subscribed listeners.
 * The real lib delivers `payload: P[]` (array) per
 * `WatchEventCallbacks['user-info']` typedef. We accept a single
 * envelope and wrap to `[envelope]` so the mock matches lib contract.
 */
export function __fireUserInfo(envelope: AnyEnvelope): void {
  const payload = [envelope];
  for (const cb of userInfoListeners) {
    try {
      cb(payload);
    } catch {
      // swallow — handler errors shouldn't break the fire loop
    }
  }
}

/**
 * Fire an inbound 'application-context' event to all subscribed
 * listeners. Real lib delivers a single payload object (not array).
 */
export function __fireAppContext(ctx: AnyEnvelope): void {
  for (const cb of appContextListeners) {
    try {
      cb(ctx);
    } catch {
      // swallow
    }
  }
}

/**
 * Reset all internal mock state — queues, latest context, listener
 * sets. Call between tests to ensure isolation. Does NOT reset
 * `jest.fn()` call history — use `jest.clearAllMocks()` for that.
 */
export function __resetMockState(): void {
  queuedUserInfo = [];
  latestAppContext = null;
  userInfoListeners.clear();
  appContextListeners.clear();
}

// ---------------------------------------------------------------------
// Section 5 — Type re-exports (lib exports as types, undefined at runtime)
// ---------------------------------------------------------------------

export type WatchPayload = Record<string, unknown>;
export type WatchEvent = string;
