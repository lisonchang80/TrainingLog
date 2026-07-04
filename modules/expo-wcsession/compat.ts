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
 *   - Cold-boot pendingEvents parity: right after a channel's first listener
 *     is attached, `drainPending(channel)` replays envelopes that arrived
 *     before any JS observer existed (native per-channel watermark keeps
 *     this exactly-once). This replaces RCTEventEmitter's
 *     `hasObservers`-gated flush that #287 Fix C relied on.
 *
 * Phase 2 (the part the old lib never had): every inbound delivery flows
 * through one choke point — `deliver()` — which tracks the highest `(epoch,
 * seq)` this JS runtime has actually processed. `reconcileNow()` compares
 * that watermark against the native journal (`getLatestSeq`) and pulls the
 * gap via `getEventsSince`, re-injecting missed envelopes through the same
 * routes. Downstream msgId dedupe (connectivity.ts intake ring) makes
 * re-injection idempotent, so a live/pull overlap can never double-dispatch.
 * A changed epoch means the native process restarted — the watermark resets
 * to the journal head and NO pull happens (app-level cold-boot handshake
 * owns that recovery), reported via `epochChanged` for observability.
 */

import {
  addApplicationContextListener,
  addMessageListener,
  addReachabilityListener,
  addUserInfoListener,
  drainPending,
  getEventsSince,
  getIsPaired as wcGetIsPaired,
  getIsWatchAppInstalled as wcGetIsWatchAppInstalled,
  getLatestSeq,
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

// ---------------------------------------------------------------------
// Inbound plumbing — single choke point + seq watermark (Phase 2)
// ---------------------------------------------------------------------

type CompatRoute = (evt: WCSessionInboundEvent) => void;

const routes: Record<WCSessionChannel, Set<CompatRoute>> = {
  message: new Set(),
  'user-info': new Set(),
  'application-context': new Set(),
};

/** One native subscription per channel, mounted on first route. */
const nativeUnsubs: Partial<Record<WCSessionChannel, () => void>> = {};

/** Highest seq this JS runtime has processed (live, drain, or pull). */
let lastDeliveredSeq = 0;
/** Native journal epoch the watermark belongs to; null = no contact yet. */
let knownEpoch: string | null = null;

/** Test hook — when true, live native events are swallowed before deliver()
 *  to simulate the deaf event lane reconcileNow() exists to heal. */
let debugDropLiveEvents = false;

let baselineInitialized = false;

/**
 * Anchor the reconciliation watermark at FIRST subscription time, not at
 * first delivery/reconcile: journal history up to this point is the drain
 * path's exactly-once job, while everything after it must be either
 * live-delivered or pullable. Without this, a runtime that is deaf from
 * birth would have its first envelopes silently baselined away by the
 * first poll tick.
 */
function initBaselineOnce(): void {
  if (baselineInitialized) return;
  const latest = getLatestSeq();
  if (!latest) return; // degraded (no native module) — nothing to anchor
  baselineInitialized = true;
  if (knownEpoch === null) {
    knownEpoch = latest.epoch;
    lastDeliveredSeq = Math.max(lastDeliveredSeq, latest.seq);
  }
}

function deliver(channel: WCSessionChannel, evt: WCSessionInboundEvent): void {
  if (typeof evt.epoch === 'string' && knownEpoch === null) {
    knownEpoch = evt.epoch;
  }
  if (typeof evt.seq === 'number' && evt.seq > lastDeliveredSeq) {
    lastDeliveredSeq = evt.seq;
  }
  for (const route of routes[channel]) {
    try {
      route(evt);
    } catch {
      // swallow — handler errors are the caller's problem, and one bad
      // handler must not break delivery to the others / the seq watermark
    }
  }
}

function ensureNativeSubscription(channel: WCSessionChannel): void {
  if (nativeUnsubs[channel]) return;
  const onLive = (evt: WCSessionInboundEvent): void => {
    if (debugDropLiveEvents) return;
    deliver(channel, evt);
  };
  if (channel === 'message') {
    nativeUnsubs[channel] = addMessageListener(onLive);
  } else if (channel === 'user-info') {
    nativeUnsubs[channel] = addUserInfoListener(onLive);
  } else {
    nativeUnsubs[channel] = addApplicationContextListener(onLive);
  }
}

/**
 * Deferred so the drain never re-enters the caller synchronously while
 * `addListener` is still on the stack (connectivity.ts assigns its
 * unsubscribe handle only after the call returns).
 */
function drainSoon(channel: WCSessionChannel): void {
  setTimeout(() => {
    for (const evt of drainPending(channel)) {
      deliver(channel, evt);
    }
  }, 0);
}

/** Old-lib 'message' handler contract: `(payload, replyHandler | null)`. */
function wrapMessageHandler(handler: (...args: unknown[]) => void): CompatRoute {
  return (evt) => {
    const replyHandler =
      evt.replyId != null
        ? (resp: Record<string, unknown>): void => replyToMessage(evt.replyId as string, resp)
        : null;
    handler(evt.payload, replyHandler);
  };
}

export const watchEvents = {
  addListener(
    event: string,
    handler: (...args: unknown[]) => void,
  ): () => void {
    let channel: WCSessionChannel;
    let route: CompatRoute;
    if (event === 'message') {
      channel = 'message';
      route = wrapMessageHandler(handler);
    } else if (event === 'user-info') {
      // Old lib delivers an ARRAY of payloads per event.
      channel = 'user-info';
      route = (evt) => handler([evt.payload]);
    } else if (event === 'application-context') {
      channel = 'application-context';
      route = (evt) => handler(evt.payload);
    } else if (event === 'reachability') {
      return addReachabilityListener((evt) => handler(evt.reachable));
    } else {
      return () => {
        // unknown event — no-op unsubscribe (old-lib tolerance)
      };
    }
    initBaselineOnce();
    routes[channel].add(route);
    ensureNativeSubscription(channel);
    drainSoon(channel);
    return () => {
      routes[channel].delete(route);
      // The native subscription intentionally stays mounted: with zero
      // routes deliver() still advances the seq watermark, keeping
      // reconciliation accounting truthful across re-subscribes.
    };
  },
};

// ---------------------------------------------------------------------
// Phase 2 — gap reconciliation (issue #54's reason to exist)
// ---------------------------------------------------------------------

export interface WCReconcileResult {
  /** Envelopes pulled from the journal and re-injected this call. */
  pulled: number;
  /** True when the native process restarted since last contact (watermark
   *  reset, nothing pulled — cold-boot handshake owns that recovery). */
  epochChanged: boolean;
}

/**
 * Compare the native journal head against what this JS runtime has actually
 * processed; pull and re-inject anything the event lane dropped. Safe to
 * call at any frequency from any trigger (poll / foreground / pre-critical-
 * op) — downstream msgId dedupe makes overlap idempotent.
 */
export function reconcileNow(): WCReconcileResult {
  const latest = getLatestSeq();
  if (!latest) return { pulled: 0, epochChanged: false };

  if (knownEpoch === null) {
    // First contact in this JS life. History before this point is the
    // drain path's job (exactly-once watermark) — baseline, don't pull.
    knownEpoch = latest.epoch;
    lastDeliveredSeq = Math.max(lastDeliveredSeq, latest.seq);
    return { pulled: 0, epochChanged: false };
  }

  if (latest.epoch !== knownEpoch) {
    knownEpoch = latest.epoch;
    lastDeliveredSeq = latest.seq;
    return { pulled: 0, epochChanged: true };
  }

  if (latest.seq <= lastDeliveredSeq) {
    return { pulled: 0, epochChanged: false };
  }

  let pulled = 0;
  for (const evt of getEventsSince(lastDeliveredSeq)) {
    const channel = evt.channel;
    if (channel && channel in routes) {
      deliver(channel, evt);
      pulled += 1;
    }
  }
  return { pulled, epochChanged: false };
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Cheap standing heartbeat: one native `getLatestSeq()` read per interval,
 * `getEventsSince` only when a gap is detected. Always-on by design —
 * deafness can eat idle-time envelopes (a cast offer, a handshake) too,
 * and the no-gap fast path costs ~nothing.
 */
export function startReconcilePolling(intervalMs = 5000): void {
  if (pollTimer !== null) return;
  pollTimer = setInterval(() => {
    reconcileNow();
  }, intervalMs);
}

export function stopReconcilePolling(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// ---------------------------------------------------------------------
// Test hooks
// ---------------------------------------------------------------------

export function __setDebugDropLiveEventsForTests(drop: boolean): void {
  debugDropLiveEvents = drop;
}

export function __resetCompatStateForTests(): void {
  stopReconcilePolling();
  debugDropLiveEvents = false;
  baselineInitialized = false;
  lastDeliveredSeq = 0;
  knownEpoch = null;
  for (const set of Object.values(routes)) set.clear();
  for (const channel of Object.keys(nativeUnsubs) as WCSessionChannel[]) {
    try {
      nativeUnsubs[channel]?.();
    } catch {
      // ignore — native side already torn down
    }
    delete nativeUnsubs[channel];
  }
}
