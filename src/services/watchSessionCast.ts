/**
 * cast-session — iPhone → Watch "投影 Watch" push orchestrator (2026-06-27).
 *
 * The user is mid-session on the iPhone and taps 投影 Watch in the in-session
 * ⋯ menu to push the running session onto the wrist. This is distinct from:
 *   - D6 `start-from-iphone` (never wired — `pushStartToWatch` sends an empty
 *     `{}` snapshot AND the Watch has no consumer for that kind, which is why
 *     the first 投影 Watch attempt "跳已送出 但手錶無反應": the envelope left the
 *     phone but the Watch had nowhere to receive it).
 *   - D29 `live-mirror` (only PROJECTS onto an ALREADY-open Watch session — it
 *     cannot OPEN a session on an idle/picker Watch).
 *
 * `cast-session` carries the FULL session-tree snapshot and tells an idle /
 * picker Watch to NAVIGATE INTO the session (the Watch reuses its
 * start-from-watch → `SetLoggerView(snapshot:)` swap). Wire shape is the
 * `snapshotToWire` start-from-watch shape (via `buildStartFromIphone`), NOT the
 * live-mirror omit-null projection — the Watch's `SessionSnapshot.swift`
 * Codable decodes the explicit-null shape.
 *
 * Transport — DUAL-FIRE (grill 2026-06-27, G1 = reachable-now + TUI backstop):
 *   - `sendUserInfo` (TUI / `transferUserInfo`) — fire-and-forget queued
 *     backstop. OS-durable: delivered when the Watch app next wakes, so the
 *     「已送出，手錶開啟後帶入」toast is literally true even when the Watch is
 *     asleep / unreachable right now (iOS cannot force-launch the Watch app).
 *   - `sendMessage` — the instant channel when the Watch is reachable. An
 *     explicit `{ok:true}` ack means the Watch adopted + navigated into the
 *     session NOW (→ `acked:true`, drives the success toast).
 * Both fire the SAME envelope (one `msgId`) so the Watch dedupes the duplicate
 * delivery via `seenMsgId` (same pattern as the D29 live-mirror dual-fire and
 * the connectivity ring-buffer dedup comment).
 *
 * Contract (Q11 silent-skip — mirrors `pushStartToWatch` / `pushEndToWatch`):
 *   - Never throws. Catches at the bridge boundary; returns a structured result.
 *   - Session row missing / snapshot unbuildable → `{acked:false, queued:false,
 *     code:'NO_SNAPSHOT'}`. (Should not happen for a genuine in-progress
 *     session; caller may toast a generic error.)
 *   - Reachable + `{ok:true}` ack within timeout → `{acked:true, queued:true}`.
 *   - Reachable but no positive `{ok:true}` ack → `{acked:false, queued:true,
 *     code:'ACK_NO_OK'}` (TUI backstop still queued).
 *   - Unreachable / unpaired / timeout / bridge error → `{acked:false,
 *     queued:true, code:<SendResult.code>}` (TUI backstop still queued — the
 *     cast will land when the Watch app next opens).
 *   - is_watch_tracked: flipped true whenever the cast is QUEUED (snapshot built
 *     + dual-fired), regardless of reachability — the durable cast WILL be
 *     adopted on the Watch's next wake, so the iPhone→Watch live-mirror gate
 *     (`index.tsx` refresh push, gated on the DB column) must open NOW. The ONLY
 *     exception is an explicit `{ok:false}` reply (Watch busy with another
 *     session). Decouples `acked` (synchronous adoption) from tracking (intent +
 *     durable queue). [2026-06-27 ⑤⑥ fix: queued/cold-launch cast opened the
 *     session on the wrist but never received subsequent iPhone edits.]
 */

import type { Database } from '../db/types';
import { setIsWatchTracked } from '../adapters/sqlite/sessionRepository';
import {
  buildStartFromIphone,
  fetchSessionSnapshot,
  makeEnvelope,
  sendMessage,
  sendUserInfo,
  type SendResult,
  type WCMessage,
} from '../adapters/watch';

/**
 * Aggregate outcome surfaced to the caller. The in-session ⋯ menu uses
 * `acked` vs `queued` to pick the toast:
 *   - acked            → 「已投影至手錶」(success)
 *   - !acked && queued → 「已送出，手錶開啟後帶入」(info)
 *   - !queued          → generic error (NO_SNAPSHOT — shouldn't happen).
 */
export interface PushCastResult {
  /** True iff the Watch was reachable AND replied `{ok:true}` within the
   *  timeout (it adopted + navigated into the session NOW). Flips
   *  `is_watch_tracked` true. */
  acked: boolean;
  /** True iff a TUI backstop envelope was enqueued. False ONLY when the
   *  snapshot couldn't be built (no session row). When `acked` is false but
   *  `queued` is true the cast is durably queued for the next Watch wake. */
  queued: boolean;
  /** Diagnostic code. `'NO_SNAPSHOT'` = session / snapshot unbuildable;
   *  `'ACK_NO_OK'` = reachable but Watch didn't positively adopt; the rest
   *  mirror `SendResult.code`. `null` when acked. */
  code:
    | 'NO_SNAPSHOT'
    | 'UNPAIRED'
    | 'NOT_REACHABLE'
    | 'TIMEOUT'
    | 'BRIDGE_ERROR'
    | 'ACK_NO_OK'
    | null;
  /** Echo of the instant-channel send result; `null` when no snapshot. */
  raw: SendResult | null;
  /** Epoch ms when the orchestrator started — for D24 last-sync readout. */
  startedAt: number;
}

interface PushCastOptions {
  /** Cap on how long to wait for the Watch's instant-channel reply.
   *  Default 2000ms — 投影 Watch is a foreground action the user is watching,
   *  so resolve the toast quickly; the TUI backstop covers the async case. */
  timeoutMs?: number;
  /**
   * ADR-0028 — the initial edit-token epoch seed (E0). The iPhone is the cast
   * initiator and holds the token; the Watch adopts this epoch and goes LOCKED
   * on receipt. Supplied by the iPhone edit-lock hook (cast-initiated bumps the
   * generation). Omitted only by pre-0028 callers (Watch falls back to locked
   * at epoch 0).
   */
  epoch?: number;
}

const DEFAULT_TIMEOUT_MS = 2000;

/**
 * Build the active session snapshot and cast it to the paired Watch over the
 * dual-fire transport. See module header for the full contract.
 */
export async function pushCastToWatch(
  db: Database,
  sessionId: string,
  opts: PushCastOptions = {},
): Promise<PushCastResult> {
  const startedAt = Date.now();

  // 1. Build the full session-tree snapshot in the start-from-watch wire shape
  //    (explicit-null `snapshotToWire`, what the Watch SetLoggerView decodes).
  //    This is the dormant `start-from-iphone` snapshot path finally woken up —
  //    the empty `{}` that `pushStartToWatch` sent is exactly why 投影 Watch did
  //    nothing on the wrist before.
  const snapshot = await fetchSessionSnapshot(db, sessionId);
  if (!snapshot) {
    return { acked: false, queued: false, code: 'NO_SNAPSHOT', raw: null, startedAt };
  }
  const payload = buildStartFromIphone(snapshot);
  // ADR-0028 — seed the Watch's edit-token epoch so it goes LOCKED at the
  // iPhone's current generation (発起方初握). Omitted by pre-0028 callers.
  if (opts.epoch != null) {
    (payload as typeof payload & { epoch?: number }).epoch = opts.epoch;
  }
  const env: WCMessage = makeEnvelope('cast-session', payload);

  // 2. TUI backstop FIRST — durable queued delivery so the cast survives an
  //    unreachable / asleep Watch (delivered on next wake). Same envelope /
  //    msgId as the instant channel → the Watch dedupes via `seenMsgId`.
  sendUserInfo(env);

  // 3. Instant channel — sendMessage when reachable. A positive `{ok:true}` ack
  //    means the Watch navigated into the session NOW (→ `acked`).
  const result = await sendMessage(env, {
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });

  const adopted = result.ok && result.reply?.ok === true;
  // An explicit `{ok:false}` is the Watch saying "busy with another session" —
  // the ONE case we honour as "not tracking this one" (the ④ conflict path).
  const explicitlyRejected = result.ok && result.reply?.ok === false;

  // 4. Flip is_watch_tracked unless the Watch explicitly rejected. The cast is
  //    durably QUEUED (TUI backstop), so an unreachable / asleep / cold-
  //    launching Watch WILL adopt it on its next wake — we must open the
  //    iPhone→Watch live-mirror gate NOW (the `app/(tabs)/index.tsx` refresh →
  //    `scheduleLiveMirrorPush` is gated on the DB `is_watch_tracked`). Without
  //    this, the queued / cold-launch path opens the session on the wrist but
  //    never receives subsequent iPhone edits — the Watch's reverse-apply
  //    receiver IS wired on mount, but the iPhone never pushes (the 2026-06-27
  //    ⑤⑥ device bug). This mirrors the prior reachable-ack semantics, which
  //    already flipped optimistically on RECEIPT (the Swift cast handler replies
  //    `{ok:true}` the moment it receives, before any conflict resolution), so
  //    it's consistent — just extended to the durable transports. Decouples
  //    `acked` (synchronous adoption, for the toast) from tracking (user intent
  //    + durable queue). Idempotent; silent no-op on a missing id (Q11).
  if (!explicitlyRejected) {
    try {
      await setIsWatchTracked(db, { id: sessionId, value: true });
    } catch {
      // Swallow rare sqlite errors to keep the Q11 silent contract.
    }
  }

  if (adopted) {
    return { acked: true, queued: true, code: null, raw: result, startedAt };
  }
  if (result.ok) {
    // Reachable + replied, but no positive `{ok:true}` adoption — backstop
    // still queued (tracked flipped above unless explicitly rejected).
    return { acked: false, queued: true, code: 'ACK_NO_OK', raw: result, startedAt };
  }
  // Unreachable / unpaired / timeout / bridge error — TUI backstop queued, so
  // the cast lands on next Watch wake; tracked flipped above so the live-mirror
  // gate is already open when it does.
  return { acked: false, queued: true, code: result.code, raw: result, startedAt };
}
