/**
 * Slice 13d D9 — NEW-Q49 iPhone freestyle first-add push gate.
 *
 * Per ADR-0019 § Slice 13d Amendment NEW-Q49 (line 1191): iPhone-initiated
 * freestyle session 不立即 push 到 Watch. The push fires on +首動作 instead,
 * so the Watch's in-session UI is meaningful (snapshot has ≥1 exercise).
 *
 * Why this lives in `src/services/` next to `watchSessionStart.ts`:
 *   - It is purely a decision predicate, not a WC call — testable in node
 *     env without mocking the WC bridge.
 *   - Co-locating with `pushStartToWatch` keeps the start-side WC orchestration
 *     in one folder for future readers.
 *
 * Predicate semantics:
 *   - `is_watch_tracked === false` — idempotent gate. Once Watch acks the
 *     push, the SQLite flag flips to true and subsequent +動作 will not
 *     re-trigger. If the push fails (Watch unreachable / unpaired / timeout)
 *     the flag stays false → the next +動作 will retry, which is the right
 *     behavior (degrades gracefully if Watch comes online mid-session).
 *   - `currentExerciseCount === 0` — distinguishes freestyle session (0 rows
 *     at +首動作 time) from template-based session (snapshot wrote ≥1 row
 *     during `startSessionFromTemplate` at session start, so count > 0 by the
 *     time any +動作 path runs). Template-based sessions already trigger
 *     `pushStartToWatch` from `onStartPlanned` / `onSheetStart` at session
 *     start; their flag will be either true (acked) or still false (in flight
 *     or failed) — in the not-acked case this predicate would otherwise fire
 *     a duplicate push, which the count gate prevents.
 *
 * Note: this is read-from-before-append. Caller must call this BEFORE
 * `appendSessionExercise`, then trigger push AFTER the append succeeds, so
 * the Watch snapshot fetch (via D9 handshake) sees the new exercise row.
 */
export function shouldFireFirstAddPush(args: {
  is_watch_tracked: boolean;
  currentExerciseCount: number;
}): boolean {
  return args.is_watch_tracked === false && args.currentExerciseCount === 0;
}
