/**
 * Slice 13d D31 — iPhone start-resolve inbound orchestrator.
 *
 * Per ADR-0019 § Slice 13d NEW-Q50 Q5 escalation tail. Counterpart of
 * D29 `start-from-watch` (Watch creates session offline) + D30
 * `start-reconcile` (iPhone replies created/conflict). When iPhone
 * replied `conflict` and the user picked "中止 iPhone 保留 Watch" in
 * the Watch alert sheet, Watch fires `start-resolve` here so iPhone
 * can hard-delete its now-losing session row.
 *
 * Why a separate orchestrator rather than inline in
 * `app/(tabs)/index.tsx`:
 *   - Matches D6 `watchSessionStart` / D7 `watchSessionEnd` pattern —
 *     each WC channel has its own orchestrator service so the
 *     index.tsx mount block stays a thin router.
 *   - Pure DB write, easily jest-testable with `betterSqlite3Database`
 *     fixture, no React / WC bridge concerns.
 *
 * Contract (Q11 silent-skip):
 *   - Never throws. `discardSession`'s `DELETE WHERE id = ?` is a
 *     no-op when the row is already gone, so redelivery (iOS TUI
 *     retries) is safe.
 *   - No reply envelope — Watch UI dismissed the alert immediately
 *     after `sendStartResolveToiPhone`; no ack contract here.
 *   - We deliberately do NOT touch `localSessionId` (the Watch's
 *     winning session). The Watch's original `start-from-watch`
 *     envelope is still in flight or already landed; the standard
 *     `start-reconcile` pipeline will adopt that row separately.
 *
 * Idempotence:
 *   - `discardSession` cascades through `achievement_unlock` /
 *     `set` / `session_exercise` / `session` / `app_settings`
 *     edit-snapshot in one transaction. Each step is `DELETE WHERE`
 *     so rerunning on an already-deleted session is a sequence of
 *     no-ops, not a constraint violation.
 *
 * Refresh fan-out:
 *   - Caller (the addUserInfoListener in `app/(tabs)/index.tsx`) is
 *     responsible for re-calling `refresh()` after this returns so
 *     the iPhone UI flips out of the now-stale active-session mode.
 *     Same convention as the `onStartFromWatch` wire-in (line 511
 *     of `app/(tabs)/index.tsx`: `refreshRef.current?.()`).
 */

import type { Database } from '../db/types';
import { discardSession } from '../adapters/sqlite/sessionRepository';
import type {
  WCEnvelope,
  StartResolvePayload,
} from '../adapters/watch';
import { badPayload, dbError } from './watchHandlerResult';

/**
 * Aggregate outcome surfaced to the caller. Mostly for tests +
 * potential future diagnostics overlay; production caller in
 * index.tsx just `void`s the promise.
 */
export type StartResolveResult =
  | { ok: true; existingSessionId: string }
  | { ok: false; code: 'bad-payload' | 'db-error'; message: string };

/**
 * Handle an inbound `start-resolve` envelope. Hard-delete the
 * `existingSessionId` (and its cascade) via `discardSession`.
 *
 * Errors are caught + returned as `{ok: false, code, message}` so
 * the caller never has to wrap in try/catch.
 */
export async function onStartResolve(
  db: Database,
  env: WCEnvelope<'start-resolve', StartResolvePayload>
): Promise<StartResolveResult> {
  const { existingSessionId } = env.payload;
  if (!existingSessionId || typeof existingSessionId !== 'string') {
    return badPayload('start-resolve missing or non-string existingSessionId');
  }
  try {
    await discardSession(db, existingSessionId);
    return { ok: true, existingSessionId };
  } catch (err) {
    return dbError(err);
  }
}
