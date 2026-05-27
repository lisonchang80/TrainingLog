/**
 * Slice 13d / D0 spike — Jest mock for react-native-watch-connectivity.
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
 */

export const getIsPaired = jest.fn().mockResolvedValue(false);
export const getIsWatchAppInstalled = jest.fn().mockResolvedValue(false);
export const getReachability = jest.fn().mockResolvedValue(false);

export const sendMessage = jest.fn();
export const sendMessageData = jest.fn().mockResolvedValue('');

export const transferUserInfo = jest.fn();
export const transferCurrentComplicationUserInfo = jest.fn();
export const transferFile = jest.fn().mockResolvedValue('');
export const getFileTransfers = jest.fn().mockResolvedValue({});
export const startFileTransfer = jest.fn().mockResolvedValue('');

export const updateApplicationContext = jest.fn();
export const getApplicationContext = jest.fn().mockResolvedValue(null);

export const getQueuedUserInfo = jest.fn().mockResolvedValue({});
export const clearUserInfoQueue = jest.fn().mockResolvedValue(null);
export const dequeueUserInfo = jest.fn();

export const watchEvents = {
  addListener: jest.fn().mockReturnValue(() => {
    // unsubscribe no-op
  }),
  on: jest.fn().mockReturnValue(() => {}),
  once: jest.fn().mockReturnValue(() => {}),
};

// Type-only re-exports — the real lib exports these as types, so consumers
// importing them get `undefined` at runtime. Mirror that here.
export type WatchPayload = Record<string, unknown>;
export type WatchEvent = string;
