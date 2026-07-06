/**
 * Slice 13d D7-TS — iPhone end-session WC push orchestrator.
 *
 * Per ADR-0019 § Slice 13d Amendment Q23 + NEW-Q45 + WC channel #11
 * (`end-session`). When the iPhone is the initiator of session end
 * (user tapped 結束訓練 in `finalizeEndAndRoute` on iPhone, the typical
 * path), push an `end-session` envelope to the paired Watch so it can:
 *   - Tear down its in-memory mirror
 *   - Trigger SessionController.end() → discardWorkout (per Q28 Branch C
 *     trigger-only sampling, the iPhone 13c writer remains the sole
 *     HKWorkout writer; Watch.end never persists workout entries)
 *
 * Counterpart of D6 `watchSessionStart.ts` — start path flips flag to
 * true on Watch ack; this end path flips flag to false on Watch ack
 * timeout. Q23 spec: "finalize 後 5 sec timeout reconcile（Watch ack
 * 失敗 → flag flip false）".
 *
 * This module is the boundary between:
 *   - SQLite session lifecycle (already finalised at call time —
 *     `finalizeEndAndRoute` has run `endSession` etc before this fires)
 *   - WatchConnectivity bridge (lazy-require lives in
 *     `src/adapters/watch/connectivity.ts`)
 *   - is_watch_tracked flag (v024 column — flipped to false ONLY on
 *     a non-ok send result; on ack stays true so the 5-tile stats panel
 *     in the detail page keeps showing Watch-tracked semantics)
 *
 * Contract (Q11 silent-skip):
 *   - Never throws. Catches all errors at the bridge boundary and
 *     returns a structured `{ok, code}` result for caller diagnostics.
 *   - Ack within 5s → flag stays true (no write — already true).
 *   - Ack timeout (5s elapsed, no reply) → flip is_watch_tracked = false.
 *   - WC unpaired / unreachable / bridge crash → flip flag to false
 *     (consistent semantics: any non-ok = Watch didn't confirm = flag false).
 *   - Setter is silent no-op on missing id (sessionRepository convention).
 *
 * D7-TS scope: iPhone-side send + reconcile only. The Watch-side
 * SessionController gets its `WCSession.sendMessage` call + delegate
 * mount in the D7-Swift commit; D7-TS jest-verifies the iPhone half
 * in isolation.
 *
 * Why 5s (not D6's 2s):
 *   - Channel #11 (`end-session`) is a bidirectional with TUI fallback;
 *     Watch may be sleeping when end is initiated and needs to wake.
 *   - D6's `start-from-iphone` runs while Watch is actively engaged
 *     with the picker UI — 2s is fine. End-session may catch Watch
 *     post-set-row, screen dimming, or auto-locked.
 *   - Q23 explicitly says 5 sec timeout reconcile.
 */

import type { Database } from '../db/types';
import { setIsWatchTracked } from '../adapters/sqlite/sessionRepository';
import {
  makeEnvelope,
  sendMessage,
  sendUserInfo,
  type SendResult,
  type WCMessage,
} from '../adapters/watch';

/**
 * Aggregate outcome surfaced to the caller. Mirror of `PushStartResult`
 * (D6) for symmetry. Caller in `finalizeEndAndRoute` ignores the value
 * (fire-and-forget); future Settings debug readout (D24-wire) may use
 * it for last-sync diagnostics.
 */
interface PushEndResult {
  /** True iff the Watch acked the end-session envelope within 5s. */
  acked: boolean;
  /** Diagnostic code mirroring `SendResult.code`. `null` when acked. */
  code: 'UNPAIRED' | 'NOT_REACHABLE' | 'TIMEOUT' | 'BRIDGE_ERROR' | null;
  /** Echo of the underlying SendResult for downstream diagnostics. */
  raw: SendResult;
  /** Epoch ms when the orchestrator started — for D24 last-sync readout. */
  startedAt: number;
}

interface PushEndOptions {
  /** Cap on how long to wait for Watch's reply. Default 5000ms
   *  (Q23 channel #11 + reconcile window). */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Push an `end-session` envelope and reconcile the `is_watch_tracked`
 * flag based on the ack outcome.
 *
 * Called by `finalizeEndAndRoute` AFTER all SQLite + achievement + HK
 * side effects have run on iPhone. Fire-and-forget at the call site
 * (the function never throws + return value is informational only).
 *
 * Per NEW-Q45 explicit spec:
 *   - iPhone-led: iPhone finalize → WC → Watch.end() + discardWorkout.
 *   - WC unreachable: iPhone still completes its own flow (this fn
 *     resolves with non-ok result, caller doesn't care, flag flipped).
 */
export async function pushEndToWatch(
  db: Database,
  sessionId: string,
  opts: PushEndOptions = {},
): Promise<PushEndResult> {
  const startedAt = Date.now();
  const env: WCMessage = makeEnvelope('end-session', {
    sessionId,
    side: 'iphone',
  });

  // #6 device-smoke follow-up (2026-07-06) — DUAL-FIRE the end envelope.
  // Fire the DURABLE `transferUserInfo` leg first: the OS queues it and
  // delivers on the Watch's next wake (at-least-once), so an iPhone-led end
  // still reaches a backgrounded / asleep Watch. The interactive `sendMessage`
  // leg below stays for the instant ack + `is_watch_tracked` reconcile when
  // the Watch IS reachable. Both legs carry the SAME msgId (same `env`), so
  // the Watch's shared inbound msgId ring dispatches the end exactly once
  // (foreground: both arrive, late leg deduped; background: only the durable
  // leg lands on wake). This mirrors the cast-session / lock-* dual-fire that
  // already survive a backgrounded Watch. Root cause it closes: end-session was
  // `sendMessage`-only, and `sendMessage` reachability-prechecks → returns
  // NOT_REACHABLE in ~0ms for an asleep Watch and NEVER queues anything durable
  // → "iPhone 結束訓練 → 背景手錶前景後沒同步結束" (#6 downstream symptom ①).
  // Per NEW-Q50 Q4 this also advances end-session onto its intended TUI channel.
  sendUserInfo(env);

  const result = await sendMessage(env, {
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });

  if (result.ok) {
    // Watch acked — flag stays true (already set by D6 push-start, no
    // write needed). Done.
    return { acked: true, code: null, raw: result, startedAt };
  }

  // Non-ok: Watch didn't confirm within 5s (or never reached). Flip
  // flag to false per Q23 reconcile so the 5-tile predicate falls
  // back to 4-tile in the detail page (UI degradation).
  try {
    await setIsWatchTracked(db, { id: sessionId, value: false });
  } catch {
    // Setter is silent no-op on missing id; any other error is rare
    // (sqlite locked etc) — swallow to keep Q11 silent contract.
  }

  return {
    acked: false,
    code: result.code,
    raw: result,
    startedAt,
  };
}
