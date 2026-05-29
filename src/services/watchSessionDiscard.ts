/**
 * Slice 13d D31 wave 2 — iPhone discard-session inbound orchestrator.
 *
 * Per ADR-0019 § Slice 13d NEW-Q50 wave-2 abort path. Counterpart of
 * watchSessionEnd (which sets `ended_at` and preserves the row in
 * history): discard-session HARD-DELETES the row entirely, leaving no
 * history trace. User intent: "scrap this session, it never happened".
 *
 * Fired by Watch when the user taps [放棄] in FinishPageView. The
 * envelope carries `{sessionId, side: 'watch'}`; iPhone calls
 * `discardSession` which cascades through achievement_unlock + set +
 * session_exercise + app_settings edit-snapshot in one txn (the same
 * helper that powers the start-resolve handler).
 *
 * Contract (Q11 silent-skip):
 *   - Never throws. `discardSession` is a sequence of `DELETE WHERE`
 *     no-ops on already-gone rows, so iOS TUI redelivery is safe.
 *   - No reply envelope. Watch UI dismisses immediately on tap.
 *
 * Ordering vs concurrent start-from-watch envelope:
 *   - iOS `transferUserInfo` is FIFO per Apple docs. Watch sends
 *     start-from-watch BEFORE discard-session; iPhone processes in
 *     that order. No zombie session row.
 *
 * Refresh fan-out:
 *   - Caller (addUserInfoListener in `app/(tabs)/index.tsx`) is
 *     responsible for re-calling `refresh()` after this returns so
 *     the iPhone UI flips out of the now-stale active-session mode.
 */

import type { Database } from '../db/types';
import { discardSession } from '../adapters/sqlite/sessionRepository';
import type {
  WCEnvelope,
  DiscardSessionPayload,
} from '../adapters/watch';

export type DiscardSessionResult =
  | { ok: true; sessionId: string }
  | { ok: false; code: 'bad-payload' | 'wrong-side' | 'db-error'; message: string };

/**
 * Handle an inbound `discard-session` envelope. Hard-delete the
 * `sessionId` via `discardSession` (cascade).
 *
 * Errors are caught and returned as `{ok: false, code, message}` so
 * the caller never has to wrap in try/catch.
 */
export async function onDiscardSession(
  db: Database,
  env: WCEnvelope<'discard-session', DiscardSessionPayload>
): Promise<DiscardSessionResult> {
  const { sessionId, side } = env.payload;
  if (!sessionId || typeof sessionId !== 'string') {
    return {
      ok: false,
      code: 'bad-payload',
      message: 'discard-session missing or non-string sessionId',
    };
  }
  // Defensive: ignore self-echo. Currently iPhone-initiated discard
  // is not a defined path (no iPhone→Watch discard envelope), but
  // mirror the end-session handler's side guard to future-proof.
  if (side !== 'watch') {
    return {
      ok: false,
      code: 'wrong-side',
      message: `discard-session expected side='watch', got side='${side}'`,
    };
  }
  try {
    await discardSession(db, sessionId);
    return { ok: true, sessionId };
  } catch (err) {
    return {
      ok: false,
      code: 'db-error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
