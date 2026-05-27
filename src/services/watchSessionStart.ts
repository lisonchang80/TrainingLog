/**
 * Slice 13d D6 — iPhone start-session WC push orchestrator.
 *
 * Per ADR-0019 § Slice 13d Amendment Q4 + Q11 + NEW-Q42 + WC channel #2
 * (`start-from-iphone`). When the iPhone is the initiator of a session
 * (existing [開始訓練] / StartTemplateSheet flows in
 * `app/(tabs)/index.tsx`), push a `start-from-iphone` envelope to the
 * paired Watch so it can hydrate its in-memory mirror + auto-jump from
 * picker → in-session view.
 *
 * This module is the boundary between:
 *   - SQLite session lifecycle (already finalised at call time —
 *     `startSessionFromTemplate` has committed the session row before
 *     this function runs)
 *   - WatchConnectivity bridge (lazy-require lives in
 *     `src/adapters/watch/connectivity.ts`)
 *   - is_watch_tracked flag (Q19 / v024 column — flipped to true ONLY
 *     after Watch acks the envelope within 2s; on timeout / unreachable
 *     stays false so 5-tile UI degrades gracefully to 3-tile per Q23)
 *
 * Contract (Q11 silent-skip):
 *   - Never throws. Catches all errors at the bridge boundary and
 *     returns a structured `{ok, code}` result for caller diagnostics.
 *   - Watch unpaired / app uninstalled / bridge crash → silent no-op,
 *     leaves session row as iPhone-led (is_watch_tracked = false).
 *   - Ack within 2s → flip is_watch_tracked = true.
 *   - Ack timeout (no reply within 2s) → leave is_watch_tracked = false.
 *   - Bridge throws or errCb fires → leave is_watch_tracked = false.
 *
 * D6 scope: send + ack reconcile only. D7 owns the end-session
 * bidirectional protocol + the 5-sec reconcile timeout for handing
 * `is_watch_tracked` back to false on stale tracking state.
 */

import type { Database } from '../db/types';
import { setIsWatchTracked } from '../adapters/sqlite/sessionRepository';
import {
  makeEnvelope,
  sendMessage,
  type SendResult,
  type StartFromIphonePayload,
  type WCMessage,
} from '../adapters/watch';

/**
 * Aggregate outcome surfaced to the caller. Used by Settings debug
 * readout (Q11 / D24) and by smoke tests; production call sites in
 * `app/(tabs)/index.tsx` ignore the value (fire-and-forget) since the
 * SQLite flag is the only thing that actually drives UI.
 */
export interface PushStartResult {
  /** True iff the Watch acked AND the SQLite flag was flipped. */
  acked: boolean;
  /** Diagnostic code mirroring `SendResult.code` plus an extra
   *  `'NO_WC'` for the unpaired / unreachable precheck shortcut and
   *  an `'ACK_NO_OK'` for replies that came back but indicated
   *  Watch-side rejection. `null` when acked. */
  code: 'UNPAIRED' | 'NOT_REACHABLE' | 'TIMEOUT' | 'BRIDGE_ERROR' | 'ACK_NO_OK' | null;
  /** Echo of the underlying SendResult for downstream diagnostics. */
  raw: SendResult;
  /** Epoch ms when the orchestrator started — used by D24 last-sync readout. */
  startedAt: number;
}

export interface PushStartOptions {
  /** Cap on how long to wait for Watch's reply. Default 2000ms
   *  (Q7 channel #2 start-from-iphone). */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 2000;

/**
 * Push a `start-from-iphone` envelope and reconcile the
 * `is_watch_tracked` flag based on the ack.
 *
 * Caller passes a JSON-primitive-clean `snapshot` of the session tree
 * (exercises + sets + bw_snapshot etc) — the Watch picker uses this
 * to hydrate its in-memory mirror before showing the in-session UI.
 * Concrete snapshot shape is defined by D9 `handshake.ts` /
 * `SessionSnapshot` but D6 treats it as opaque JSON.
 */
export async function pushStartToWatch(
  db: Database,
  sessionId: string,
  snapshot: StartFromIphonePayload['snapshot'],
  opts: PushStartOptions = {},
): Promise<PushStartResult> {
  const startedAt = Date.now();
  const env: WCMessage = makeEnvelope('start-from-iphone', {
    sessionId,
    snapshot,
  });

  const result = await sendMessage(env, {
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });

  if (result.ok) {
    // Watch may echo `{ok: false, reason: ...}` even when the channel
    // delivers — Q11 routes that to a stay-false reconcile rather than
    // a flag flip. Treat `reply.ok === false` (explicit) as ACK_NO_OK.
    if (result.reply && result.reply.ok === false) {
      return {
        acked: false,
        code: 'ACK_NO_OK',
        raw: result,
        startedAt,
      };
    }
    // Default: any reply (or no reply payload) = Watch acknowledged.
    try {
      await setIsWatchTracked(db, { id: sessionId, value: true });
    } catch {
      // Setter is silent no-op on missing id; any other error is rare
      // (sqlite locked etc) — swallow to keep Q11 silent contract.
    }
    return { acked: true, code: null, raw: result, startedAt };
  }

  // Non-ok send result — code is one of UNPAIRED / NOT_REACHABLE /
  // TIMEOUT / BRIDGE_ERROR. Leave is_watch_tracked false (which is
  // the default-after-createSession state, so no write needed).
  return {
    acked: false,
    code: result.code,
    raw: result,
    startedAt,
  };
}
