/**
 * Watch ↔ iPhone WatchConnectivity (WC) bridge wrapper.
 *
 * Slice 13d D6 (ADR-0019 § Slice 13d Amendment Q5 + Q7 + NEW-Q42 +
 * D-chain table line 1246). D3 shipped `payloadSchema.ts` as the
 * protocol-only slice; D6 lands this file as the actual bridge to
 * `react-native-watch-connectivity@2.0.0` (lib pinned per Q5 spike C
 * 2026-05-27 真機 PASS — see ADR-0019 shipped table D0 partial spike-C).
 *
 * Why lazy-require:
 *   - The lib loads via `TurboModuleRegistry.getEnforcing(...)` which
 *     throws sync under `testEnvironment: node` (no native module).
 *   - Top-level `import` would crash any test file that transitively
 *     pulls this module — even one that mocks it inline only takes
 *     effect after `require` returns.
 *   - Lazy-require pushes the load down to first use. Combined with
 *     the `__mocks__/react-native-watch-connectivity.ts` jest auto-mock,
 *     tests can run end-to-end without the bridge.
 *   - Same pattern as `src/adapters/healthkit/permission.ts` (L41-48).
 *
 * Public surface (used by `watchSessionStart.ts` + `watchSessionEnd.ts`):
 *   - `sendMessage(env, opts)` — async with timeout + reply ack
 *   - `isPaired()` / `isReachable()` — bridge state queries
 *   - `updateApplicationContext(env)` — fire-and-forget snapshot push
 *   - `addMessageListener(kind, handler)` — inbound delegate (D7)
 *   - Internal msgId ring buffer for inbound dedupe (D7+)
 *
 * Q7 channel timeouts (ADR-0019 § Slice 13d Amendment table):
 *   - send timeout = 2s (channel #2 start-from-iphone)
 *   - Per-callsite ack reconcile timeout is separate (e.g. 5s in D7
 *     end-session). This file owns the *send* timeout only.
 */

import type {
  WCMessage,
  WCMessageKind,
  WCPayloadMap,
} from './payloadSchema';

// ---------------------------------------------------------------------
// Section 1 — Lazy-require gate
// ---------------------------------------------------------------------

/**
 * Cached handle to the native lib. Loaded on first call to any exported
 * function. `null` while uninitialised; set once. Re-imports during
 * jest's per-suite module cache reset are safe because `null` + the
 * require below re-runs.
 */
type WCBridge = {
  getIsPaired: () => Promise<boolean>;
  getIsWatchAppInstalled: () => Promise<boolean>;
  getReachability: () => Promise<boolean>;
  sendMessage: (
    msg: Record<string, unknown>,
    replyCb?: (reply: Record<string, unknown>) => void,
    errCb?: (err: Error & { code?: string }) => void,
  ) => void;
  updateApplicationContext: (ctx: Record<string, unknown>) => void;
  watchEvents: {
    addListener: (
      event: string,
      handler: (...args: unknown[]) => void,
    ) => () => void;
  };
};

let cached: WCBridge | null = null;

function bridge(): WCBridge {
  if (cached !== null) return cached;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  cached = require('react-native-watch-connectivity') as WCBridge;
  return cached;
}

/**
 * Test hook — drop the cached bridge handle so a subsequent call to
 * `bridge()` re-runs `require()`. Lets jest tests re-mock the lib
 * between cases without surviving state.
 */
export function __resetBridgeForTests(): void {
  cached = null;
  __clearMsgIdRingForTests();
  __clearListenersForTests();
}

// ---------------------------------------------------------------------
// Section 2 — Inbound msgId dedupe (ring buffer, Q7)
// ---------------------------------------------------------------------

/**
 * FIFO ring of recently-seen inbound msgIds. Slots ≥ 256 per Q7. We
 * use a `Map` for ordered insertion + O(1) `has`; eviction removes the
 * oldest entry once size exceeds the cap.
 *
 * Used by `addMessageListener` (D7) to short-circuit duplicate deliveries
 * from the OS-level WC retry layer.
 */
const MSG_ID_RING_CAP = 256;
const msgIdRing = new Map<string, true>();

/**
 * Returns `true` if this msgId has been seen before — handler should
 * drop. Returns `false` for a fresh msgId and records it for next time.
 */
export function seenMsgId(msgId: string): boolean {
  if (msgIdRing.has(msgId)) return true;
  msgIdRing.set(msgId, true);
  if (msgIdRing.size > MSG_ID_RING_CAP) {
    // Evict oldest insertion. Map iteration order = insertion order.
    const oldest = msgIdRing.keys().next().value;
    if (oldest !== undefined) msgIdRing.delete(oldest);
  }
  return false;
}

function __clearMsgIdRingForTests(): void {
  msgIdRing.clear();
}

// ---------------------------------------------------------------------
// Section 3 — Inbound message dispatch (D7+ uses, D6 ships base)
// ---------------------------------------------------------------------

/**
 * The native `react-native-watch-connectivity` lib delivers each inbound
 * 'message' as `(payload, replyHandler)` where `replyHandler` is a callback
 * the iPhone-side handler can invoke synchronously OR asynchronously to
 * fulfil the Watch's `sendMessage(..., replyCb)` ack contract.
 *
 * D9 wire-in (handshake + start-from-watch) needs that channel — both kinds
 * are "request-reply" envelopes where the Watch awaits a typed payload back.
 * D7 end-session does NOT use it (Watch's end-session sendMessage call uses
 * a separate sendMessage+TUI path with no synchronous ack expectation), so
 * the parameter is `?: optional` to preserve backward-compat for the
 * existing end-session listener.
 *
 * `replyHandler` may be `null` when the inbound message arrived via a code
 * path that doesn't carry one (transferUserInfo backup, applicationContext
 * delivery, etc.) — handlers MUST null-check before calling.
 */
type ReplyHandler = (resp: Record<string, unknown>) => void;

type InboundHandler<K extends WCMessageKind> = (
  env: WCMessage & { kind: K; payload: WCPayloadMap[K] },
  replyHandler?: ReplyHandler,
) => void | Promise<void>;

const listeners = new Map<WCMessageKind, Set<InboundHandler<WCMessageKind>>>();
let bridgeUnsubscribe: (() => void) | null = null;

function ensureBridgeListenerMounted(): void {
  if (bridgeUnsubscribe !== null) return;
  bridgeUnsubscribe = bridge().watchEvents.addListener(
    'message',
    (...args: unknown[]) => {
      const msg = args[0] as Record<string, unknown> | undefined;
      // Lib signature: 'message' callback is (payload, replyHandler|null).
      // We thread args[1] through to handlers as `ReplyHandler | undefined`.
      // Non-function values get normalised to undefined so handlers can
      // null-check uniformly via `if (replyHandler)`.
      const replyHandlerRaw = args[1];
      const replyHandler =
        typeof replyHandlerRaw === 'function'
          ? (replyHandlerRaw as ReplyHandler)
          : undefined;
      if (!msg || typeof msg !== 'object') return;
      const kind = msg.kind as WCMessageKind | undefined;
      const msgId = msg.msgId as string | undefined;
      if (!kind || !msgId) return;
      if (seenMsgId(msgId)) return; // dedupe
      const set = listeners.get(kind);
      if (!set || set.size === 0) return;
      for (const handler of set) {
        // Fire each handler defensively — one throwing must not stop
        // siblings (per Q7 channel rules implicit "best-effort dispatch").
        try {
          void handler(
            msg as unknown as WCMessage & {
              kind: typeof kind;
              payload: WCPayloadMap[typeof kind];
            },
            replyHandler,
          );
        } catch {
          // swallow — handler errors are caller's problem
        }
      }
    },
  );
}

/**
 * Register a per-kind inbound handler. Returns an unsubscribe fn.
 * Idempotent — registering the same handler twice is a no-op the
 * second time (`Set` semantics).
 *
 * D6 wires the base dispatch infrastructure; D7 calls this for the
 * `end-session` kind, D9 for `handshake` + `start-from-watch` (both
 * use the `replyHandler` parameter for ack), D19 for set-* kinds.
 *
 * Handler signature: `(env, replyHandler?) => void | Promise<void>`.
 * `replyHandler` is present when the lib delivered a reply callback
 * (channels #0 + #1 always; channels #11 end-session does not use it).
 */
export function addMessageListener<K extends WCMessageKind>(
  kind: K,
  handler: InboundHandler<K>,
): () => void {
  ensureBridgeListenerMounted();
  let set = listeners.get(kind);
  if (!set) {
    set = new Set();
    listeners.set(kind, set);
  }
  set.add(handler as InboundHandler<WCMessageKind>);
  return () => {
    set?.delete(handler as InboundHandler<WCMessageKind>);
  };
}

function __clearListenersForTests(): void {
  listeners.clear();
  if (bridgeUnsubscribe) {
    try {
      bridgeUnsubscribe();
    } catch {
      // swallow
    }
    bridgeUnsubscribe = null;
  }
}

// ---------------------------------------------------------------------
// Section 4 — Bridge state queries
// ---------------------------------------------------------------------

/**
 * `true` iff iPhone is paired with a Watch (regardless of whether the
 * Watch app is installed or currently reachable). `isPaired() === false`
 * is the early-exit gate in `pushStartToWatch` — no envelope is sent
 * to an un-paired device.
 *
 * Per Q11: silent skip when unpaired (no toast, no Alert).
 */
export async function isPaired(): Promise<boolean> {
  try {
    return await bridge().getIsPaired();
  } catch {
    return false;
  }
}

/**
 * `true` iff a live WC channel exists to the paired Watch *right now*.
 * `false` means the Watch is off-wrist / sleeping / out of Bluetooth
 * range. Lib may still queue messages via `transferUserInfo` /
 * `applicationContext` (not used by D6 send path).
 */
export async function isReachable(): Promise<boolean> {
  try {
    return await bridge().getReachability();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------
// Section 5 — Outbound sendMessage (D6 primary surface)
// ---------------------------------------------------------------------

/**
 * Result code returned by `sendMessage`. Callers branch on `ok` first;
 * `code` is for diagnostics + Settings debug readout (Q11 / D24).
 */
export type SendResult =
  | { ok: true; reply?: Record<string, unknown> }
  | { ok: false; code: 'TIMEOUT' | 'BRIDGE_ERROR' | 'UNPAIRED' | 'NOT_REACHABLE'; error?: string };

export interface SendOptions {
  /** Cap on how long to wait for Watch's replyHandler. Default 2000ms
   *  (Q7 channel #2 start-from-iphone). */
  timeoutMs?: number;
  /** When true (default), pre-check `isPaired()` + `isReachable()` and
   *  return early without invoking the bridge. Skip for handshake-style
   *  envelopes that might race with the Watch app booting up. */
  precheckReachability?: boolean;
}

const DEFAULT_TIMEOUT_MS = 2000;

/**
 * Send a fully-formed envelope to the paired Watch and await its
 * reply or timeout. Lib's `sendMessage` is callback-based with no
 * promise contract; this function wraps the two callbacks in a
 * Promise.race against a setTimeout.
 *
 * Behaviour:
 *   - Unpaired / unreachable (when `precheckReachability` enabled) →
 *     resolves `{ok: false, code: 'UNPAIRED' | 'NOT_REACHABLE'}` without
 *     calling the bridge.
 *   - Watch replyHandler fires before timeout → `{ok: true, reply}`.
 *   - errCb fires → `{ok: false, code: 'BRIDGE_ERROR', error}`.
 *   - Neither callback fires before timeout → `{ok: false, code: 'TIMEOUT'}`.
 *
 * The returned promise NEVER throws — callers should branch on `ok`
 * and route to silent fallback per Q11.
 */
export async function sendMessage(
  env: WCMessage,
  opts: SendOptions = {},
): Promise<SendResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const precheck = opts.precheckReachability ?? true;

  if (precheck) {
    if (!(await isPaired())) {
      return { ok: false, code: 'UNPAIRED' };
    }
    if (!(await isReachable())) {
      return { ok: false, code: 'NOT_REACHABLE' };
    }
  }

  return new Promise<SendResult>((resolve) => {
    let settled = false;
    const settle = (result: SendResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const timer = setTimeout(() => {
      settle({ ok: false, code: 'TIMEOUT' });
    }, timeoutMs);

    try {
      bridge().sendMessage(
        env as unknown as Record<string, unknown>,
        (reply) => {
          clearTimeout(timer);
          settle({ ok: true, reply });
        },
        (err) => {
          clearTimeout(timer);
          settle({
            ok: false,
            code: 'BRIDGE_ERROR',
            error: err?.message ?? String(err),
          });
        },
      );
    } catch (e) {
      clearTimeout(timer);
      settle({
        ok: false,
        code: 'BRIDGE_ERROR',
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });
}

// ---------------------------------------------------------------------
// Section 6 — Outbound applicationContext push (D17/D18 will use)
// ---------------------------------------------------------------------

/**
 * Fire-and-forget snapshot push. Latest-wins semantics: subsequent
 * calls overwrite earlier ones before the OS delivers. Used by
 * throttled HR/kcal tick streams in D18, and settings-sync in D16.
 *
 * No timeout, no ack — the OS guarantees eventual delivery when both
 * sides are paired (queued across reboots / unreachability).
 */
export function updateApplicationContext(env: WCMessage): void {
  try {
    bridge().updateApplicationContext(env as unknown as Record<string, unknown>);
  } catch {
    // swallow — context push is best-effort
  }
}
