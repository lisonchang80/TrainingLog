/**
 * Watch ↔ iPhone WatchConnectivity (WC) bridge wrapper.
 *
 * Slice 13d D6 (ADR-0019 § Slice 13d Amendment Q5 + Q7 + NEW-Q42 +
 * NEW-Q50 — frozen 2026-05-29 evening). D3 shipped `payloadSchema.ts`
 * as the protocol-only slice; D6 lands this file as the actual bridge
 * to `react-native-watch-connectivity@2.0.0` (lib pinned per Q5 spike C
 * 2026-05-27 真機 PASS — see ADR-0019 shipped table D0 partial spike-C).
 *
 * NEW-Q50 (2026-05-29 evening grill) — transport翻盤 to TUI + applicationContext:
 *   - Q4 拍板: TUI is sole outbound channel; sendMessage path slated for
 *     砍除 once Wave 2 swaps consumers (`watchSessionStart.ts` +
 *     `watchSessionEnd.ts`). D6 lands the new helpers ALONGSIDE the
 *     legacy sendMessage path so Wave 1 can ship without breaking
 *     downstream tsc; Wave 2 wire-in will remove the legacy block.
 *   - Q6 拍板: ApplicationContext throttled + replace semantics for
 *     in-session live mirror (D24 HR/kcal share this channel).
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
 * Public surface (v2 NEW-Q50 primary — D9 wire-in will adopt):
 *   - `sendUserInfo(env)` — fire-and-forget TUI outbound (Q4 sole channel)
 *   - `addUserInfoListener(kind, handler)` — typed inbound TUI dispatch
 *   - `updateAppContext(snapshot)` — fire-and-forget applicationContext
 *     replace (Q6 throttled mirror channel)
 *   - `addAppContextListener(handler)` — inbound applicationContext delivery
 *   - `isPaired()` / `isReachable()` — bridge state queries
 *
 * Legacy v1 surface (kept for Wave 2 wire-in — slated 砍除 per Q8 hard break):
 *   - `sendMessage(env, opts)` — async with timeout + reply ack
 *   - `addMessageListener(kind, handler)` — inbound delegate via 'message' event
 *   - `updateApplicationContext(env)` — legacy alias (envelope-shaped) for
 *     `updateAppContext` — kept until Wave 2 swap completes
 *   - `seenMsgId(id)` + msgId ring buffer for inbound dedupe
 *
 * Q7 channel timeouts (ADR-0019 § Slice 13d Amendment table — legacy v1 only):
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
  // NEW-Q50 Q4 — TUI is primary outbound channel (fire-and-forget queue).
  transferUserInfo: (info: Record<string, unknown>) => void;
  // NEW-Q50 Q6 — applicationContext is throttled live-mirror channel
  // (latest-state-only replace semantics).
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
  __clearUserInfoListenersForTests();
  __clearAppContextListenersForTests();
}

/**
 * Coerce a typed envelope (or any plain JSON-shaped object) to the
 * `Record<string, unknown>` the native WC bridge methods expect. The
 * bridge API is loosely typed; this centralises the otherwise-repeated
 * `as unknown as Record<string, unknown>` cast at the single trust
 * boundary so the call sites read intent, not ceremony. Behaviour is
 * identical to the inline cast — no runtime transformation.
 */
export function toWireRecord(value: object): Record<string, unknown> {
  return value as unknown as Record<string, unknown>;
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
        toWireRecord(env),
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
    bridge().updateApplicationContext(toWireRecord(env));
  } catch {
    // swallow — context push is best-effort
  }
}

// ═════════════════════════════════════════════════════════════════════
//  NEW-Q50 v2 transport — TUI + applicationContext primary surface
//  (frozen 2026-05-29 evening grill, ADR-0019 § Slice 13d NEW-Q50)
// ═════════════════════════════════════════════════════════════════════

// ---------------------------------------------------------------------
// Section 7 — Outbound TUI (NEW-Q50 Q4 sole outbound channel)
// ---------------------------------------------------------------------

/**
 * Fire-and-forget TUI (transferUserInfo) push. Wraps Apple's
 * `WCSession.transferUserInfo()` — OS queues envelope and delivers
 * when the counterparty wakes, with at-least-once semantics.
 *
 * No timeout, no ack — caller MUST NOT await this in a sync-reply
 * pattern. Reverse-direction TUI (counterparty → us) provides
 * reconcile reply per NEW-Q50 Q4 reverse TUI design.
 *
 * Per Q11 (best-effort): if WC bridge throws (lib unavailable, OS-
 * level error), we swallow silently — TUI is "fire and forget"
 * even on failure. Pairs with `isPaired()` precheck at callsite if
 * the caller wants an explicit "skip when unpaired" branch.
 *
 * NEW-Q50 Q11 silent-skip — if `isPaired()` is false, the OS-level
 * transferUserInfo call is still safe (becomes no-op); we don't
 * pre-check here because the bridge already handles unpaired state
 * gracefully and a precheck adds an extra `await` round-trip per
 * call. Callers wanting the explicit guard can `if (!await isPaired())
 * return;` before invoking.
 */
export function sendUserInfo(env: WCMessage): void {
  try {
    bridge().transferUserInfo(toWireRecord(env));
  } catch {
    // swallow — TUI is best-effort fire-and-forget
  }
}

// ---------------------------------------------------------------------
// Section 8 — Inbound TUI dispatch (NEW-Q50 Q4 reverse TUI receiver)
// ---------------------------------------------------------------------

/**
 * Per-kind inbound TUI handler. Mirrors the legacy `InboundHandler`
 * shape but WITHOUT a `replyHandler` parameter — TUI is one-way
 * fire-and-forget. The counterparty replies via a separate reverse
 * TUI envelope (per NEW-Q50 Q4 reverse channel design).
 */
type UserInfoHandler<K extends WCMessageKind> = (
  env: WCMessage & { kind: K; payload: WCPayloadMap[K] },
) => void | Promise<void>;

const userInfoListeners = new Map<
  WCMessageKind,
  Set<UserInfoHandler<WCMessageKind>>
>();
let userInfoBridgeUnsubscribe: (() => void) | null = null;

function ensureUserInfoBridgeListenerMounted(): void {
  if (userInfoBridgeUnsubscribe !== null) return;
  userInfoBridgeUnsubscribe = bridge().watchEvents.addListener(
    'user-info',
    (...args: unknown[]) => {
      // Real lib signature: 'user-info' callback receives a single
      // arg `payload: P[]` (an ARRAY of envelopes — see
      // node_modules/react-native-watch-connectivity/src/events/
      // definitions.ts line 34). Each TUI delivery may bundle
      // multiple queued envelopes; we iterate and dispatch per kind.
      const batch = args[0];
      if (!Array.isArray(batch)) return;
      for (const raw of batch) {
        if (!raw || typeof raw !== 'object') continue;
        const msg = raw as Record<string, unknown>;
        const kind = msg.kind as WCMessageKind | undefined;
        if (!kind) continue;
        const set = userInfoListeners.get(kind);
        if (!set || set.size === 0) continue;
        for (const handler of set) {
          // Best-effort dispatch — one handler throwing must not
          // stop siblings or sibling-kind dispatch in this batch.
          try {
            void handler(
              msg as unknown as WCMessage & {
                kind: typeof kind;
                payload: WCPayloadMap[typeof kind];
              },
            );
          } catch {
            // swallow
          }
        }
      }
    },
  );
}

/**
 * Subscribe to inbound TUI envelopes of a specific `kind`. Returns
 * an unsubscribe fn. Idempotent — registering the same handler twice
 * is a no-op the second time (`Set` semantics).
 *
 * NEW-Q50 wire-in (D9 Wave 2) will call this for `start-from-watch`
 * + `set-*` + `end-session` kinds. iPhone side also uses for reverse
 * TUI from Watch (conflict resolution, end reconcile).
 *
 * No `replyHandler` parameter — TUI is one-way. Reply path is via a
 * separate reverse TUI envelope (counterparty `sendUserInfo`).
 */
export function addUserInfoListener<K extends WCMessageKind>(
  kind: K,
  handler: UserInfoHandler<K>,
): () => void {
  ensureUserInfoBridgeListenerMounted();
  let set = userInfoListeners.get(kind);
  if (!set) {
    set = new Set();
    userInfoListeners.set(kind, set);
  }
  set.add(handler as UserInfoHandler<WCMessageKind>);
  return () => {
    set?.delete(handler as UserInfoHandler<WCMessageKind>);
  };
}

function __clearUserInfoListenersForTests(): void {
  userInfoListeners.clear();
  if (userInfoBridgeUnsubscribe) {
    try {
      userInfoBridgeUnsubscribe();
    } catch {
      // swallow
    }
    userInfoBridgeUnsubscribe = null;
  }
}

// ---------------------------------------------------------------------
// Section 9 — Outbound applicationContext (NEW-Q50 Q6 live mirror)
// ---------------------------------------------------------------------

/**
 * Fire-and-forget applicationContext snapshot push with "latest-only"
 * replace semantics. Subsequent calls overwrite earlier ones before
 * the OS delivers — no queue, no duplicate delivery.
 *
 * NEW-Q50 Q6 — replaces the D19 6-kind reducer. Watch SessionController
 * builds full SessionSnapshot and pushes here every ~15s (debounce +
 * dirty flag); iPhone `addAppContextListener` receives latest and does
 * `INSERT OR REPLACE` on session row.
 *
 * `snapshot` is `object` (not `WCMessage`) because applicationContext is
 * not envelope-shaped — it's a raw snapshot dict. Callers provide their
 * own shape contract (Wave 2 will type as `SessionSnapshot`).
 */
export function updateAppContext(snapshot: object): void {
  try {
    bridge().updateApplicationContext(snapshot as Record<string, unknown>);
  } catch {
    // swallow — applicationContext is best-effort
  }
}

// ---------------------------------------------------------------------
// Section 10 — Inbound applicationContext (NEW-Q50 Q6 mirror receiver)
// ---------------------------------------------------------------------

type AppContextHandler = (ctx: object) => void | Promise<void>;

const appContextListeners = new Set<AppContextHandler>();
let appContextBridgeUnsubscribe: (() => void) | null = null;

function ensureAppContextBridgeListenerMounted(): void {
  if (appContextBridgeUnsubscribe !== null) return;
  appContextBridgeUnsubscribe = bridge().watchEvents.addListener(
    'application-context',
    (...args: unknown[]) => {
      // Real lib signature: 'application-context' callback receives a
      // single arg `payload: P` (NOT array — see
      // node_modules/react-native-watch-connectivity/src/events/
      // definitions.ts line 23). Just route through.
      const ctx = args[0];
      if (!ctx || typeof ctx !== 'object') return;
      for (const handler of appContextListeners) {
        try {
          void handler(ctx as object);
        } catch {
          // swallow
        }
      }
    },
  );
}

/**
 * Subscribe to inbound applicationContext deliveries. Returns an
 * unsubscribe fn. Idempotent — registering the same handler twice
 * is a no-op the second time.
 *
 * NEW-Q50 wire-in (Wave 2): iPhone side receives Watch's live-mirror
 * snapshot here and routes to `replaceLiveMirror(ctx)` which writes
 * the session row via `INSERT OR REPLACE` (per Q6 + Q2 idempotency).
 */
export function addAppContextListener(
  handler: AppContextHandler,
): () => void {
  ensureAppContextBridgeListenerMounted();
  appContextListeners.add(handler);
  return () => {
    appContextListeners.delete(handler);
  };
}

function __clearAppContextListenersForTests(): void {
  appContextListeners.clear();
  if (appContextBridgeUnsubscribe) {
    try {
      appContextBridgeUnsubscribe();
    } catch {
      // swallow
    }
    appContextBridgeUnsubscribe = null;
  }
}
