/**
 * expo-wcsession — New Architecture-native WCSession bridge (JS surface).
 *
 * Inbound design (issue lisonchang80/TrainingLog#54): the native side stamps
 * every inbound envelope with a process-scoped `(epoch, seq)` and journals it
 * in a ring buffer BEFORE emitting the JS event. Consumers that suspect a
 * dead event lane (the RCTEventEmitter deafness family) can poll
 * `getLatestSeq()` against the seq they last received and pull the gap via
 * `getEventsSince(seq)` — data loss becomes structurally impossible while
 * the process lives. A changed `epoch` means a new process: run a full state
 * resync instead of a gap pull.
 *
 * ## Degradation contract
 * Every function survives the native module being absent (jest node env,
 * pod not installed, non-iOS platform): state reads → `false` / `null` /
 * `[]`, outbound sends → no-op or rejected promise, listeners → no-op
 * unsubscribe. Same pattern as `modules/icloud-backup`.
 *
 * ## Native module load
 * Lazily required so importing this file never throws under
 * `testEnvironment: node`.
 */

/** One journaled inbound envelope. `channel` present in `getEventsSince` reads only. */
export interface WCSessionInboundEvent {
  /** Process-scoped monotonic sequence number (starts at 1). */
  seq: number;
  /** Per-native-process UUID; changes ⇒ the phone process restarted. */
  epoch: string;
  /** The WCSession dictionary as sent by the counterpart. */
  payload: Record<string, unknown>;
  /** Present when the sender awaits a reply — answer via `replyToMessage`. */
  replyId?: string;
  /** Journal channel; only populated by `getEventsSince`. */
  channel?: 'message' | 'user-info' | 'application-context';
}

export interface WCSessionSeqInfo {
  epoch: string;
  seq: number;
  /**
   * audit B🟡-2 (2026-07-05) — oldest journal entry still pullable (`seq + 1`
   * when the ring is empty). `oldestSeq > watermark + 1` means the ring
   * evicted part of a gap: `getEventsSince` can no longer recover it and the
   * reconciler must report `gapUnrecoverable` instead of claiming a heal.
   * Optional — an older native binary omits it (detection then falls back to
   * inspecting the first pulled entry's seq).
   */
  oldestSeq?: number;
}

export type WCSessionChannel = 'message' | 'user-info' | 'application-context';

type EventSubscription = { remove(): void };

type NativeModuleShape = {
  getIsPaired(): Promise<boolean>;
  getIsWatchAppInstalled(): Promise<boolean>;
  getReachability(): Promise<boolean>;
  sendMessage(
    message: Record<string, unknown>,
    wantsReply: boolean,
  ): Promise<Record<string, unknown>>;
  transferUserInfo(info: Record<string, unknown>): void;
  updateApplicationContext(context: Record<string, unknown>): void;
  reply(replyId: string, payload: Record<string, unknown>): void;
  getLatestSeq(): WCSessionSeqInfo;
  getEventsSince(afterSeq: number): WCSessionInboundEvent[];
  drainPending(channel: string): WCSessionInboundEvent[];
  addListener(
    eventName: string,
    listener: (event: never) => void,
  ): EventSubscription;
};

let cached: NativeModuleShape | null | undefined;

function native(): NativeModuleShape | null {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { requireOptionalNativeModule } = require('expo-modules-core');
    cached = (requireOptionalNativeModule('ExpoWCSession') as NativeModuleShape | null) ?? null;
  } catch {
    // expo-modules-core itself is unimportable (jest node env).
    cached = null;
  }
  return cached;
}

const NOOP_UNSUBSCRIBE = (): void => {
  // no-op — native module unavailable
};

// ---------------------------------------------------------------------
// State reads
// ---------------------------------------------------------------------

export async function getIsPaired(): Promise<boolean> {
  const mod = native();
  if (!mod) return false;
  return mod.getIsPaired();
}

export async function getIsWatchAppInstalled(): Promise<boolean> {
  const mod = native();
  if (!mod) return false;
  return mod.getIsWatchAppInstalled();
}

export async function getReachability(): Promise<boolean> {
  const mod = native();
  if (!mod) return false;
  return mod.getReachability();
}

// ---------------------------------------------------------------------
// Outbound
// ---------------------------------------------------------------------

/**
 * Send an interactive message. With `wantsReply` the promise resolves with
 * the counterpart's reply dictionary; without, it resolves `{}` right after
 * hand-off to WCSession. Rejects with the underlying WCError on failure
 * (not reachable, session not activated, payload rejected, …).
 */
export async function sendMessage(
  message: Record<string, unknown>,
  wantsReply: boolean,
): Promise<Record<string, unknown>> {
  const mod = native();
  if (!mod) {
    throw new Error('ExpoWCSession native module unavailable');
  }
  return mod.sendMessage(message, wantsReply);
}

/** Fire-and-forget durable transfer (OS-queued, survives unreachability). */
export function transferUserInfo(info: Record<string, unknown>): void {
  native()?.transferUserInfo(info);
}

/**
 * Checked variant of `transferUserInfo` (#55 ④ cast 誠實 toast) — reports
 * whether the envelope was actually handed to a live native bridge. `false`
 * means NOTHING was queued (native module absent / degraded env): callers
 * that promise the user "queued for later delivery" must not claim it.
 * NOTE: `true` only means hand-off succeeded — WCSession's async transfer
 * can still fail later (`didFinish:error:`), which is deliberately NOT
 * surfaced per-envelope (reading `userInfoTransfer.userInfo` on the error
 * path is the SIGABRT class patched in the old lib).
 */
export function transferUserInfoChecked(info: Record<string, unknown>): boolean {
  const mod = native();
  if (!mod) return false;
  mod.transferUserInfo(info);
  return true;
}

/** Latest-state-only context push (subsequent calls overwrite). */
export function updateApplicationContext(context: Record<string, unknown>): void {
  native()?.updateApplicationContext(context);
}

/**
 * Fulfil the reply the counterpart is awaiting for the inbound event that
 * carried `replyId`. No-op after the native 10s GC — by then the sender has
 * received its own WCSession timeout.
 */
export function replyToMessage(replyId: string, payload: Record<string, unknown>): void {
  native()?.reply(replyId, payload);
}

// ---------------------------------------------------------------------
// Journal reads
// ---------------------------------------------------------------------

/** Latest `(epoch, seq)` the native journal has assigned; null when degraded. */
export function getLatestSeq(): WCSessionSeqInfo | null {
  const mod = native();
  if (!mod) return null;
  return mod.getLatestSeq();
}

/** Pure journal read — everything after `afterSeq`, all channels, with `channel` set. */
export function getEventsSince(afterSeq: number): WCSessionInboundEvent[] {
  const mod = native();
  if (!mod) return [];
  return mod.getEventsSince(afterSeq);
}

/**
 * Exactly-once hand-over of envelopes that never reached a JS listener
 * (cold boot, JS reload). Advances the native per-channel watermark.
 */
export function drainPending(channel: WCSessionChannel): WCSessionInboundEvent[] {
  const mod = native();
  if (!mod) return [];
  return mod.drainPending(channel);
}

// ---------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------

function addInboundListener(
  eventName: 'onMessage' | 'onUserInfo' | 'onApplicationContext',
  listener: (event: WCSessionInboundEvent) => void,
): () => void {
  const mod = native();
  if (!mod) return NOOP_UNSUBSCRIBE;
  const sub = mod.addListener(eventName, listener as never);
  return () => sub.remove();
}

export function addMessageListener(
  listener: (event: WCSessionInboundEvent) => void,
): () => void {
  return addInboundListener('onMessage', listener);
}

export function addUserInfoListener(
  listener: (event: WCSessionInboundEvent) => void,
): () => void {
  return addInboundListener('onUserInfo', listener);
}

export function addApplicationContextListener(
  listener: (event: WCSessionInboundEvent) => void,
): () => void {
  return addInboundListener('onApplicationContext', listener);
}

export function addReachabilityListener(
  listener: (event: { reachable: boolean }) => void,
): () => void {
  const mod = native();
  if (!mod) return NOOP_UNSUBSCRIBE;
  const sub = mod.addListener('onReachabilityChange', listener as never);
  return () => sub.remove();
}
