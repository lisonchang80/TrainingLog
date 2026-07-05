/**
 * Watch ↔ iPhone WatchConnectivity (WC) bridge wrapper.
 *
 * Slice 13d D6 (ADR-0019 § Slice 13d Amendment Q5 + Q7 + NEW-Q42 +
 * NEW-Q50 — frozen 2026-05-29 evening). D3 shipped `payloadSchema.ts`
 * as the protocol-only slice; D6 landed this file as the actual bridge
 * to `react-native-watch-connectivity@2.0.0`.
 *
 * Issue #54 (2026-07-04 拍板): the native bridge is now our own local Expo
 * Module `modules/expo-wcsession` — the old lib's RCTEventEmitter lane
 * proved lossy under New Architecture (#287 deafness family; both fast and
 * durable copies die when the JS runtime goes deaf). The compat shim
 * (`modules/expo-wcsession/compat.ts`) reproduces the old lib's exact
 * surface, so everything below this comment is behaviorally unchanged.
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
 *   - Top-level `import` would crash any test file that transitively
 *     pulls this module — even one that mocks it inline only takes
 *     effect after `require` returns.
 *   - Lazy-require pushes the load down to first use. The compat shim
 *     itself degrades gracefully under `testEnvironment: node` (returns
 *     false/no-op when the native module is absent), and WC-focused
 *     tests re-mock the shim path via `jest.doMock` for real-ish behavior.
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
 *   - `seenMsgId(id)` + msgId ring buffer for inbound dedupe — NOT legacy:
 *     since 2026-06-12 (audit F4) the ring is SHARED by the v2 'user-info'
 *     intake too, so a dual-fire envelope (same msgId on both channels)
 *     dispatches exactly once
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
  // #55 ④ — checked TUI hand-off (expo-wcsession compat only). Optional so
  // legacy-shaped jest doMock factories stay valid; call sites runtime-guard.
  transferUserInfoChecked?: (info: Record<string, unknown>) => boolean;
  // NEW-Q50 Q6 — applicationContext is throttled live-mirror channel
  // (latest-state-only replace semantics).
  updateApplicationContext: (ctx: Record<string, unknown>) => void;
  watchEvents: {
    addListener: (
      event: string,
      handler: (...args: unknown[]) => void,
    ) => () => void;
  };
  // Issue #54 Phase 2 — seq-gap reconciliation (expo-wcsession compat only).
  // Optional so legacy-shaped jest doMock factories stay valid; all call
  // sites runtime-guard before invoking. `gapUnrecoverable` (audit B🟡-2) is
  // optional in the BRIDGE shape for the same mock-compat reason — the
  // app-facing `reconcileWatchInbound` normalises it to a hard boolean.
  reconcileNow?: () => {
    pulled: number;
    epochChanged: boolean;
    gapUnrecoverable?: boolean;
  };
  startReconcilePolling?: (intervalMs?: number) => void;
  stopReconcilePolling?: () => void;
  // audit B🟡-2 — compat fires this on anomalies the standing poll would
  // otherwise swallow (ring256 overflow → unrecoverable gap). Optional for
  // legacy-shaped mocks; wired in `startReconcileTriggers`.
  setReconcileAnomalyListener?: (
    cb:
      | ((r: { pulled: number; epochChanged: boolean; gapUnrecoverable: boolean }) => void)
      | null,
  ) => void;
};

let cached: WCBridge | null = null;

function bridge(): WCBridge {
  if (cached !== null) return cached;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  cached = require('../../../modules/expo-wcsession/compat') as WCBridge;
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
  __resetReconcileTriggersForTests();
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
 * SHARED across both inbound channels (2026-06-12, audit F4):
 *   - 'message' intake (`ensureBridgeListenerMounted`, D7) — dedupes
 *     OS-level WC retry duplicates.
 *   - 'user-info' / TUI intake (`ensureUserInfoBridgeListenerMounted`)
 *     — dedupes (a) TUI at-least-once redelivery and, because the ring
 *     is shared, (b) the SECOND leg of a dual-fire envelope (Swift
 *     sends the SAME envelope/msgId via sendMessage + transferUserInfo;
 *     in foreground both arrive → the late channel is dropped at
 *     intake). This was the systemic root of the 2026-06-11 "Watch 完成
 *     → iPhone 雙跳完成頁" class of bugs (fixed downstream in 1bb4d96).
 *
 * ⚠️ In-memory only — does NOT survive an app restart, and TUI is an
 * OS-durable queue that CAN redeliver after relaunch. The downstream
 * durable gates (ended_at gate / INSERT OR IGNORE / idempotent
 * DELETE-WHERE / in-flight set / fromWatchInbound origin mark) remain
 * REQUIRED. This ring is the first line, never the only line.
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
 * The native bridge (expo-wcsession compat surface) delivers each inbound
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

// ---------------------------------------------------------------------
// Pre-handler replay buffer (#287 Fix C — Release standalone fix)
// ---------------------------------------------------------------------
//
// Why: Fix C eager-mounts the native 'message' subscription at APP ENTRY
// (see `initWatchBridge`) so the singleton RCTEventEmitter has
// `hasObservers=YES` — and flushes its native `pendingEvents` — before the
// Watch's first envelope arrives. In Release standalone the package's
// inbound WCSession callbacks were being buffered (gated on `hasObservers`)
// and never delivered to JS because the lazy home-screen `useEffect`
// registered the listener too late (root cause: report 01, H1/H2).
//
// But eager-mounting the *bridge* alone isn't enough: the per-kind
// HANDLERS (onHandshakeRequest / onStartFromWatch / onLiveMirror …) still
// register later, from `(tabs)/index.tsx`, because they need the DB. So an
// envelope that the native side now correctly delivers to JS at cold-boot
// could still arrive in the window AFTER the bridge is mounted but BEFORE
// the handler for its kind exists — and be dropped on the floor.
//
// This buffer closes that window: when the dispatch loop finds no handler
// for an inbound kind, the envelope is parked here (bounded, FIFO). When a
// handler later registers for that kind via `addMessageListener`, the
// buffered envelopes are replayed into it. This is the "tolerant of a
// not-yet-ready DB" behaviour the fix needs — the native subscription is
// eager, the handler dispatch stays gated on readiness, and nothing is lost
// in between. Dedupe (`seenMsgId`) runs at intake, so replay can't
// re-deliver something already handled.
const PRE_HANDLER_BUFFER_CAP = 64;

type BufferedMessage = {
  kind: WCMessageKind;
  msg: Record<string, unknown>;
  replyHandler?: ReplyHandler;
};
const pendingMessageEnvelopes: BufferedMessage[] = [];

function bufferPreHandlerMessage(b: BufferedMessage): void {
  pendingMessageEnvelopes.push(b);
  // Evict oldest if over cap — a Watch firing into a never-mounted handler
  // shouldn't grow unbounded. Cap is generous vs. the handful of envelopes
  // a cold-boot race can produce.
  while (pendingMessageEnvelopes.length > PRE_HANDLER_BUFFER_CAP) {
    pendingMessageEnvelopes.shift();
  }
}

/** Drain + dispatch any buffered 'message' envelopes whose kind now has a
 *  registered handler. Called when a handler is added. */
function replayBufferedMessagesFor(kind: WCMessageKind): void {
  if (pendingMessageEnvelopes.length === 0) return;
  const set = listeners.get(kind);
  if (!set || set.size === 0) return;
  // Pull out matching buffered envelopes in FIFO order, leave the rest.
  const remaining: BufferedMessage[] = [];
  const toReplay: BufferedMessage[] = [];
  for (const b of pendingMessageEnvelopes) {
    if (b.kind === kind) toReplay.push(b);
    else remaining.push(b);
  }
  pendingMessageEnvelopes.length = 0;
  pendingMessageEnvelopes.push(...remaining);
  for (const b of toReplay) {
    dispatchMessageToHandlers(b.kind, b.msg, b.replyHandler);
  }
}

/** Fire all registered handlers for a 'message' kind. Shared by live
 *  dispatch + buffered replay. */
function dispatchMessageToHandlers(
  kind: WCMessageKind,
  msg: Record<string, unknown>,
  replyHandler?: ReplyHandler,
): void {
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
}

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
      if (seenMsgId(msgId)) return; // dedupe (intake — replay won't re-fire)
      const set = listeners.get(kind);
      if (!set || set.size === 0) {
        // No handler yet (cold-boot race — bridge mounted eagerly, handler
        // registers later from the home screen once the DB is ready). Park
        // the envelope; `addMessageListener` will replay it on register.
        bufferPreHandlerMessage({ kind, msg, replyHandler });
        return;
      }
      dispatchMessageToHandlers(kind, msg, replyHandler);
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
  // #287 Fix C — drain any envelopes of this kind that the eagerly-mounted
  // bridge delivered before this handler existed (cold-boot race).
  replayBufferedMessagesFor(kind);
  return () => {
    set?.delete(handler as InboundHandler<WCMessageKind>);
  };
}

function __clearListenersForTests(): void {
  listeners.clear();
  pendingMessageEnvelopes.length = 0;
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
 * `true` iff the TrainingLog Watch app is installed on the paired Watch.
 * `false` also covers "cannot determine" (bridge unavailable / threw) —
 * callers use this as a hard "durable delivery is impossible" signal
 * (#55 ④: a TUI queued toward a Watch with no app never delivers, so the
 * cast toast must not claim「已送出」).
 */
export async function isWatchAppInstalled(): Promise<boolean> {
  try {
    return await bridge().getIsWatchAppInstalled();
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

/**
 * #55 ④ — checked variant of `sendUserInfo` for callers that surface a
 * "queued for later delivery" promise to the user (e.g. the cast toast
 * 「已送出，手錶開啟後同步」). Returns `false` when the envelope was NOT
 * handed to a live bridge (native module absent, or the bridge threw) —
 * i.e. nothing is queued and the promise would be a lie.
 *
 * `true` = hand-off succeeded. The OS-level transfer can still fail later
 * (`didFinish:error:`, e.g. sim 7006) — that async outcome is deliberately
 * not attributed per-envelope (reading `userInfoTransfer.userInfo` on the
 * error path is the SIGABRT class the old lib needed patching for), so
 * `true` means "queued", not "delivered".
 *
 * Legacy-shaped bridges (jest doMock factories without
 * `transferUserInfoChecked`) fall back to the unchecked call and report
 * `true` on non-throw — same trust level those tests already assume.
 */
export function sendUserInfoChecked(env: WCMessage): boolean {
  try {
    const b = bridge();
    if (typeof b.transferUserInfoChecked === 'function') {
      return b.transferUserInfoChecked(toWireRecord(env));
    }
    b.transferUserInfo(toWireRecord(env));
    return true;
  } catch {
    return false;
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

// #287 Fix C — same pre-handler replay buffer as the 'message' channel.
// start-from-watch / start-resolve / discard-session ride TUI (`user-info`)
// and their handlers register lazily from the home screen; a TUI envelope
// the eagerly-mounted bridge surfaces before the handler exists is parked
// here and replayed on register. TUI is OS-queued (durable) so this is a
// belt-and-braces guard for the cold-boot window, mirroring the message path.
const pendingUserInfoEnvelopes: { kind: WCMessageKind; msg: Record<string, unknown> }[] =
  [];

function bufferPreHandlerUserInfo(b: {
  kind: WCMessageKind;
  msg: Record<string, unknown>;
}): void {
  pendingUserInfoEnvelopes.push(b);
  while (pendingUserInfoEnvelopes.length > PRE_HANDLER_BUFFER_CAP) {
    pendingUserInfoEnvelopes.shift();
  }
}

function dispatchUserInfoToHandlers(
  kind: WCMessageKind,
  msg: Record<string, unknown>,
): void {
  const set = userInfoListeners.get(kind);
  if (!set || set.size === 0) return;
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

function replayBufferedUserInfoFor(kind: WCMessageKind): void {
  if (pendingUserInfoEnvelopes.length === 0) return;
  const set = userInfoListeners.get(kind);
  if (!set || set.size === 0) return;
  const remaining: { kind: WCMessageKind; msg: Record<string, unknown> }[] = [];
  const toReplay: { kind: WCMessageKind; msg: Record<string, unknown> }[] = [];
  for (const b of pendingUserInfoEnvelopes) {
    if (b.kind === kind) toReplay.push(b);
    else remaining.push(b);
  }
  pendingUserInfoEnvelopes.length = 0;
  pendingUserInfoEnvelopes.push(...remaining);
  for (const b of toReplay) dispatchUserInfoToHandlers(b.kind, b.msg);
}

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
        // Intake-level msgId dedupe, SHARED ring with the 'message'
        // channel (2026-06-12, audit F4). A dual-fire envelope (same
        // msgId via sendMessage + TUI) used to double-dispatch when
        // both legs arrived in foreground — the systemic root of the
        // duplicate-delivery bug class (e.g. 雙跳完成頁, fixed downstream
        // in 1bb4d96). Whichever channel arrives first wins; the
        // duplicate is dropped HERE, before buffering, so it can't be
        // parked + replayed either. Envelopes without a msgId (legacy /
        // defensive) pass through un-deduped rather than crash or drop.
        // NOTE: ring is in-memory — post-restart TUI redelivery passes
        // (ring empty) by design; durable DB gates downstream still own
        // that case and MUST stay.
        const msgId = msg.msgId;
        if (typeof msgId === 'string' && msgId && seenMsgId(msgId)) {
          continue;
        }
        const set = userInfoListeners.get(kind);
        if (!set || set.size === 0) {
          // No handler yet (cold-boot race) — park + replay on register.
          bufferPreHandlerUserInfo({ kind, msg });
          continue;
        }
        dispatchUserInfoToHandlers(kind, msg);
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
  // #287 Fix C — replay any TUI envelopes of this kind that landed before
  // this handler registered (cold-boot race).
  replayBufferedUserInfoFor(kind);
  return () => {
    set?.delete(handler as UserInfoHandler<WCMessageKind>);
  };
}

function __clearUserInfoListenersForTests(): void {
  userInfoListeners.clear();
  pendingUserInfoEnvelopes.length = 0;
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

// ═════════════════════════════════════════════════════════════════════
//  Section 11 — Eager bridge mount (#287 Fix C — Release standalone fix)
// ═════════════════════════════════════════════════════════════════════

/**
 * Mount ALL THREE native WC event subscriptions ('message', 'user-info',
 * 'application-context') at APP ENTRY — before the home screen mounts and
 * before the per-kind handlers (which need the DB) register.
 *
 * Why this is the fix for #287:
 *   The npm package's iOS module is a singleton `RCTEventEmitter`
 *   TurboModule that gates every inbound emit behind `hasObservers`, and
 *   `hasObservers` only flips `YES` when JS calls `addListener` (→ native
 *   `startObserving`, which ALSO flushes the module's `pendingEvents`
 *   buffer). Under New Arch + Release standalone, the app's previous design
 *   registered those listeners LAZILY — on the first `addXListener` call
 *   inside the home-screen `(tabs)/index.tsx` `useEffect`. On a Release cold
 *   boot, the Watch's first envelope (handshake / start-from-watch / first
 *   live-mirror) can arrive BEFORE React mounts that screen, so it lands
 *   while `hasObservers=NO`, gets buffered in the native `pendingEvents`,
 *   and is never flushed → the iPhone never sees the Watch's WC events.
 *   Debug+Metro masks it because hot-reload runs extra `startObserving`
 *   cycles that flip `hasObservers=YES` in time.
 *
 *   Calling this at app entry makes the JS `addListener` (hence native
 *   `startObserving` + `pendingEvents` flush) run as early as possible,
 *   so `hasObservers=YES` before the first envelope arrives.
 *
 * Split design (bridge-eager / handler-gated):
 *   This mounts only the NATIVE bridge subscription — the part that fixes
 *   `hasObservers`. It does NOT register the message HANDLERS
 *   (onHandshakeRequest / onStartFromWatch / onLiveMirror …): those need a
 *   ready DB and still register from the home screen via
 *   `addMessageListener` / `addUserInfoListener` / `addAppContextListener`.
 *   Envelopes that the now-mounted bridge delivers in the window before a
 *   handler exists are parked in the per-channel pre-handler replay buffers
 *   (see `pendingMessageEnvelopes` / `pendingUserInfoEnvelopes`) and
 *   replayed when the handler registers. So nothing is lost and no DB
 *   dependency is pulled into app entry.
 *
 * Safe to call before the DB is ready and safe to call from outside the
 * DatabaseProvider gate. It does NOT touch the DB, never throws (the bridge
 * load is wrapped), and is idempotent: each `ensure*Mounted` early-returns
 * if its subscription already exists, so a later `addXListener` from the
 * home screen does NOT double-subscribe. Re-invoking `initWatchBridge` is
 * also a no-op.
 *
 * Returns `true` if the bridge mounted (or was already mounted), `false` if
 * the native lib was unavailable (e.g. running where the TurboModule can't
 * load) — in which case the app simply proceeds without WC, as before.
 */
export function initWatchBridge(): boolean {
  try {
    ensureBridgeListenerMounted();
    ensureUserInfoBridgeListenerMounted();
    ensureAppContextBridgeListenerMounted();
    startReconcileTriggers();
    return true;
  } catch {
    // Bridge/native lib unavailable — proceed without WC. This matches the
    // pre-fix behaviour where the lazy mount would have thrown/no-op'd too.
    return false;
  }
}

// ---------------------------------------------------------------------
// Section 12 — Seq-gap reconciliation triggers (issue #54 Phase 2)
// ---------------------------------------------------------------------

/**
 * Manually reconcile the native inbound journal against what JS has
 * processed — pulls and re-injects anything the event lane dropped
 * (the #287 deafness family's data-loss fix). Safe at any frequency:
 * the msgId intake ring dedupes re-injection. No-op under legacy-shaped
 * test mocks and when the native module is absent.
 */
export function reconcileWatchInbound(): {
  pulled: number;
  epochChanged: boolean;
  /** audit B🟡-2 — true when the native ring evicted part of the missed
   *  range (overflow): the pull could NOT recover everything and `pulled`
   *  must not be read as "healed". */
  gapUnrecoverable: boolean;
} {
  try {
    const b = bridge();
    if (typeof b.reconcileNow !== 'function') {
      return { pulled: 0, epochChanged: false, gapUnrecoverable: false };
    }
    const r = b.reconcileNow();
    return {
      pulled: r.pulled,
      epochChanged: r.epochChanged,
      gapUnrecoverable: r.gapUnrecoverable === true,
    };
  } catch {
    return { pulled: 0, epochChanged: false, gapUnrecoverable: false };
  }
}

/**
 * audit B🟡-2 — app-layer surface for inbound-journal anomalies that the
 * standing 5s poll would otherwise swallow (its result never leaves the
 * compat module). Today the only anomaly kind is `gapUnrecoverable`: the
 * native ring256 overflowed while JS was deaf, so one or more inbound
 * envelopes are permanently gone — the app should run its full state
 * resync (mirror state self-heals on the next ~1Hz live-mirror tick; the
 * loss-sensitive kinds are one-shot TUIs like end-session, whose
 * user-visible recovery remains the Watch-side ⏳ stuck indicator + retry).
 * Handlers registered here receive every anomaly result exactly as compat
 * reported it. Returns an unsubscribe.
 */
export function addWatchInboundAnomalyListener(
  cb: (r: { pulled: number; epochChanged: boolean; gapUnrecoverable: boolean }) => void,
): () => void {
  inboundAnomalyListeners.add(cb);
  return () => inboundAnomalyListeners.delete(cb);
}

const inboundAnomalyListeners = new Set<
  (r: { pulled: number; epochChanged: boolean; gapUnrecoverable: boolean }) => void
>();

let reconcileTriggersStarted = false;

/**
 * Standing triggers (拍板 2026-07-04): a 5s always-on poll (one cheap
 * native read per tick; pull only on gap) + an AppState foreground
 * reconcile. Started once from `initWatchBridge`. `react-native` is
 * lazy-required so this file stays importable under jest's node env.
 */
function startReconcileTriggers(): void {
  if (reconcileTriggersStarted) return;
  const b = bridge();
  if (typeof b.startReconcilePolling !== 'function') return; // legacy mock
  reconcileTriggersStarted = true;
  b.startReconcilePolling(5000);
  // audit B🟡-2 — surface poll-detected anomalies (unrecoverable gap after a
  // ring overflow) to the app layer; the poll's own result is discarded
  // inside compat, so this hook is the only way the signal escapes.
  if (typeof b.setReconcileAnomalyListener === 'function') {
    b.setReconcileAnomalyListener((r) => {
      if (r.gapUnrecoverable) {
        // Always-on observability even before any app handler registers.
        console.warn(
          '[watch] inbound journal overflow — envelope(s) evicted before JS processed them; ' +
            'mirror state self-heals via live-mirror, but a one-shot TUI in the hole is lost',
        );
      }
      for (const cb of inboundAnomalyListeners) {
        try {
          cb(r);
        } catch {
          // app handler errors must not break the poll
        }
      }
    });
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AppState } = require('react-native') as {
      AppState?: { addEventListener: (t: string, cb: (s: string) => void) => unknown };
    };
    AppState?.addEventListener('change', (state) => {
      if (state === 'active') reconcileWatchInbound();
    });
  } catch {
    // react-native unavailable (node env) — poll alone still covers gaps.
  }
}

/** Test hook — reset the trigger latch so a re-init can be asserted. */
export function __resetReconcileTriggersForTests(): void {
  reconcileTriggersStarted = false;
  inboundAnomalyListeners.clear();
}

/**
 * Test introspection — `true` iff the eager 'message' bridge subscription
 * is currently mounted. Lets a jest test assert app-entry mount happened
 * independent of any per-kind handler registration.
 */
export function __isBridgeMountedForTests(): boolean {
  return bridgeUnsubscribe !== null;
}
