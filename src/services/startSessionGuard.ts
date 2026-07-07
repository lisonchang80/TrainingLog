/**
 * 🟠-B (overnight 2026-07-07) — active-session guard for the FREESTYLE start
 * path (空白訓練 / `onStartFreestyle`).
 *
 * The template start path (`startSessionFromTemplate`, sessionFromTemplate.ts:111-118)
 * already refuses to create a second live session while one is in progress:
 *
 *     if (!args.skip_active_guard) {
 *       const active = await getActiveSession(db);
 *       if (active) throw new Error('… already in progress');
 *     }
 *
 * The Watch-initiated path (`onStartFromWatch`, handshake.ts) has the same guard
 * (its 'conflict' branch on `getActiveSession`). The FREESTYLE path was the only
 * live-start that called `createSession` with NO such check. Under a narrow
 * concurrency window — a Watch-led session lands in the DB (`onStartFromWatch`)
 * while the iPhone's local `sessionState` is still `idle` (its focus `refresh()`
 * hasn't run yet), so the 空白訓練 button is still on screen — a tap would INSERT
 * a SECOND `ended_at IS NULL` row. `getActiveSession` then returns only the
 * newest (`ORDER BY started_at DESC LIMIT 1`), orphaning the older Watch-led
 * session: it keeps all its sets but is no longer reachable from the Training tab.
 *
 * This module is the PURE decision half (mirrors `shouldFireFirstAddPush`'s shape):
 * given whether a live session already exists, decide whether the freestyle start
 * may proceed. The caller (`onStartFreestyle`) does the DB re-query + the adopt
 * (`refresh()`) side-effect. Keeping the predicate pure lets it be unit-tested in
 * node-env without a DB or the RN component.
 */

export interface FreestyleStartGuardInput {
  /**
   * Whether the DB already carries a live (un-ended) session, from a fresh
   * `getActiveSession(db) != null` re-query at the moment of the tap — NOT the
   * possibly-stale React `sessionState`. Re-querying is what closes the window:
   * the Watch-led INSERT has already committed by the time the user taps.
   */
  hasActiveSession: boolean;
}

export type FreestyleStartDecision =
  /** No live session → proceed with `createSession`. */
  | { action: 'create' }
  /**
   * A live session already exists → do NOT create a duplicate. The caller should
   * instead `refresh()` so the UI adopts the existing (e.g. Watch-led) session.
   * This mirrors the template path's refusal, but degrades to "surface the
   * existing session" rather than a thrown error the freestyle UI can't act on.
   */
  | { action: 'adopt-existing' };

/**
 * Decide whether a freestyle (空白訓練) start may proceed. Pure — the caller
 * owns the DB re-query (to populate `hasActiveSession`) and the side effects.
 */
export function decideFreestyleStart(
  input: FreestyleStartGuardInput,
): FreestyleStartDecision {
  return input.hasActiveSession ? { action: 'adopt-existing' } : { action: 'create' };
}
