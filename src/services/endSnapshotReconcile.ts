/**
 * Slice 13d WC ship-blocker E2 (grill 2026-05-30, Q1/Q3) — end-session
 * membership reconcile: the "purge snapshot-orphans" step that
 * `replaceLiveMirror`'s doc historically deferred to "D7".
 *
 * Called by `finalizeEndAndRoute` (app/(tabs)/index.tsx) ONCE, INSIDE the
 * `ended_at` idempotent gate (Q4 derived decision): a late dual-fire /
 * `transferUserInfo` redelivery is gated out so it can't re-purge over a
 * post-session history-page edit (Round G). Given the final authoritative
 * `SessionSnapshot` the Watch carried on its `end-session` envelope, it
 * deletes the iPhone rows the Watch removed mid-session (which the
 * non-purging live mirror left behind → E2).
 *
 * Q3 guarded purge — NEVER wipe real data on a malformed / empty snapshot.
 * Failure always falls back to "no purge" (finalize-only), which degrades
 * to the original E2 stale-row severity (recoverable) rather than an
 * unrecoverable wipe:
 *   - snapshot doesn't parse (`parseLiveMirrorSnapshot` → null)
 *       → `bad-payload`, NO purge.
 *   - snapshot.sessionId !== the session being ended
 *       → `session-mismatch`, NO purge (never touch another session).
 *   - snapshot has ZERO exercises but the DB still has >0 for this session
 *       → `suspicious-empty`, NO purge (ending a genuinely empty session
 *         goes through 放棄/discard, not 完成 — an empty snapshot on an
 *         end envelope is almost certainly a serialization glitch).
 *   - otherwise → `reconcileSessionTree(..., { purgeTail: true })`.
 *
 * Never throws — returns a structured result for caller diagnostics
 * (mirrors `onLiveMirror` / `onStartResolve`). The production caller
 * fire-and-forgets it; the result is for tests + a future debug readout.
 */

import type { Database } from '../db/types';
import { reconcileSessionTree } from './replaceLiveMirror';
import { parseLiveMirrorSnapshot } from './watchLiveMirrorReceiver';

export type EndSnapshotReconcileResult =
  | {
      purged: true;
      sessionId: string;
      exerciseCount: number;
      setCount: number;
      purgedExercises: number;
      purgedSets: number;
    }
  | {
      purged: false;
      reason: 'bad-payload' | 'session-mismatch' | 'suspicious-empty' | 'db-error';
      message?: string;
    };

/**
 * Reconcile the iPhone session tree against the Watch's final snapshot,
 * purging snapshot-orphans, with the Q3 guards above. `rawSnapshot` is the
 * untyped `EndSessionPayload.snapshot` straight off the WC envelope.
 */
export async function reconcileEndSnapshot(
  db: Database,
  sessionId: string,
  rawSnapshot: unknown,
): Promise<EndSnapshotReconcileResult> {
  const snapshot = parseLiveMirrorSnapshot(rawSnapshot);
  if (snapshot === null) {
    return { purged: false, reason: 'bad-payload' };
  }
  if (snapshot.sessionId !== sessionId) {
    return { purged: false, reason: 'session-mismatch' };
  }

  try {
    // Q3 suspicious-empty guard: a zero-exercise snapshot against a
    // non-empty DB tree is treated as a glitch, never a real "delete all".
    if (snapshot.exercises.length === 0) {
      const row = await db.getFirstAsync<{ n: number }>(
        `SELECT COUNT(*) AS n FROM session_exercise WHERE session_id = ?`,
        sessionId,
      );
      if ((row?.n ?? 0) > 0) {
        return { purged: false, reason: 'suspicious-empty' };
      }
    }

    const result = await reconcileSessionTree(db, snapshot, { purgeTail: true });
    return {
      purged: true,
      sessionId,
      exerciseCount: result.exerciseCount,
      setCount: result.setCount,
      purgedExercises: result.purgedExercises,
      purgedSets: result.purgedSets,
    };
  } catch (err) {
    return {
      purged: false,
      reason: 'db-error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
