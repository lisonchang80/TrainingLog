/**
 * compat — drop-in replacement for the `react-native-watch-connectivity`
 * surface TrainingLog consumes (the `WCBridge` type in
 * `src/adapters/watch/connectivity.ts`).
 *
 * All of the old library's quirks live HERE and only here, so the clean
 * `index.ts` API stays presentable while `connectivity.ts` needs zero
 * behavioral changes (Phase 1 of issue #54):
 *
 *   - `sendMessage(msg, replyCb?, errCb?)` — callback style; presence of
 *     `replyCb` maps to the native replyHandler variant, exactly like the
 *     old lib.
 *   - `'message'` events fire `(payload, replyHandler | null)` where
 *     `replyHandler` is a closure over the journaled `replyId`.
 *   - `'user-info'` events deliver `payload: P[]` — an ARRAY (old lib
 *     contract, see its events/definitions.ts) — even though the native
 *     event carries a single envelope.
 *   - Cold-boot pendingEvents parity: right after a channel's listener is
 *     attached, `drainPending(channel)` replays envelopes that arrived
 *     before any JS observer existed (native per-channel watermark keeps
 *     this exactly-once). This replaces RCTEventEmitter's
 *     `hasObservers`-gated flush that #287 Fix C relied on.
 */

import {
  addApplicationContextListener,
  addMessageListener,
  addReachabilityListener,
  addUserInfoListener,
  drainPending,
  getIsPaired as wcGetIsPaired,
  getIsWatchAppInstalled as wcGetIsWatchAppInstalled,
  getReachability as wcGetReachability,
  replyToMessage,
  sendMessage as wcSendMessage,
  transferUserInfo as wcTransferUserInfo,
  updateApplicationContext as wcUpdateApplicationContext,
  type WCSessionChannel,
  type WCSessionInboundEvent,
} from './index';

export const getIsPaired = (): Promise<boolean> => wcGetIsPaired();
export const getIsWatchAppInstalled = (): Promise<boolean> => wcGetIsWatchAppInstalled();
export const getReachability = (): Promise<boolean> => wcGetReachability();

export function sendMessage(
  message: Record<string, unknown>,
  replyCb?: (reply: Record<string, unknown>) => void,
  errCb?: (err: Error & { code?: string }) => void,
): void {
  wcSendMessage(message, replyCb != null)
    .then((reply) => {
      if (replyCb) replyCb(reply);
    })
    .catch((err: unknown) => {
      if (!errCb) return;
      errCb(err instanceof Error ? err : new Error(String(err)));
    });
}

export function transferUserInfo(info: Record<string, unknown>): void {
  wcTransferUserInfo(info);
}

export function updateApplicationContext(ctx: Record<string, unknown>): void {
  wcUpdateApplicationContext(ctx);
}

/** Old-lib 'message' handler contract: `(payload, replyHandler | null)`. */
function routeMessage(
  evt: WCSessionInboundEvent,
  handler: (...args: unknown[]) => void,
): void {
  const replyHandler =
    evt.replyId != null
      ? (resp: Record<string, unknown>): void => replyToMessage(evt.replyId as string, resp)
      : null;
  handler(evt.payload, replyHandler);
}

/**
 * Deferred so the drain never re-enters the caller synchronously while
 * `addListener` is still on the stack (connectivity.ts assigns its
 * unsubscribe handle only after the call returns).
 */
function drainSoon(
  channel: WCSessionChannel,
  route: (evt: WCSessionInboundEvent) => void,
): void {
  setTimeout(() => {
    for (const evt of drainPending(channel)) {
      try {
        route(evt);
      } catch {
        // swallow — handler errors shouldn't break the drain loop
      }
    }
  }, 0);
}

export const watchEvents = {
  addListener(
    event: string,
    handler: (...args: unknown[]) => void,
  ): () => void {
    if (event === 'message') {
      const unsubscribe = addMessageListener((evt) => routeMessage(evt, handler));
      drainSoon('message', (evt) => routeMessage(evt, handler));
      return unsubscribe;
    }
    if (event === 'user-info') {
      // Old lib delivers an ARRAY of payloads per event.
      const unsubscribe = addUserInfoListener((evt) => handler([evt.payload]));
      drainSoon('user-info', (evt) => handler([evt.payload]));
      return unsubscribe;
    }
    if (event === 'application-context') {
      const unsubscribe = addApplicationContextListener((evt) => handler(evt.payload));
      drainSoon('application-context', (evt) => handler(evt.payload));
      return unsubscribe;
    }
    if (event === 'reachability') {
      return addReachabilityListener((evt) => handler(evt.reachable));
    }
    return () => {
      // unknown event — no-op unsubscribe (old-lib tolerance)
    };
  },
};
