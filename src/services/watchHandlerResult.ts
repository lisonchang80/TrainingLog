/**
 * Slice 13d — shared result/guard helpers for the inbound WC handler
 * orchestrators that follow the Q11 never-throws structured-result
 * pattern (`watchSessionDiscard`, `watchSessionResolve`).
 *
 * Both handlers are thin wrappers around a destructive `discardSession`
 * cascade and share the same boilerplate:
 *   - a `bad-payload` guard on a single string id field,
 *   - a try/catch that turns any thrown DB error into a structured
 *     `{ok:false, code:'db-error', message}` result,
 *   - never throwing (iOS TUI redelivery / fire-and-forget callers must
 *     not have to wrap in try/catch).
 *
 * These factories produce the *failure* variants (which are identical in
 * shape across handlers). Each handler still constructs its own typed
 * success variant (`{ok:true, sessionId}` vs `{ok:true, existingSessionId}`)
 * so the public result types — and thus the public API — stay byte-for-byte
 * what callers already destructure. The factories are intentionally
 * minimal: no try/catch *wrapper* that hides control flow, just shape
 * constructors + one small `dbError` mapper, so the handler bodies remain
 * readable top-to-bottom.
 */

/** Failure variant shared by the inbound discard-style handlers. */
export interface HandlerFailure<C extends string = 'bad-payload' | 'db-error'> {
  ok: false;
  code: C;
  message: string;
}

/**
 * `bad-payload` failure for a missing/empty/non-string id field. `message`
 * is caller-supplied so each handler keeps its own diagnostic wording.
 */
export function badPayload(message: string): HandlerFailure<'bad-payload'> {
  return { ok: false, code: 'bad-payload', message };
}

/**
 * `wrong-side` failure for the defensive self-echo guard (discard-session
 * only — resolve has no side field). Kept here for symmetry so all the
 * inbound-handler failure shapes live in one place.
 */
export function wrongSide(message: string): HandlerFailure<'wrong-side'> {
  return { ok: false, code: 'wrong-side', message };
}

/**
 * Map a thrown value from a DB cascade into the structured `db-error`
 * failure. Mirrors the inline `err instanceof Error ? err.message :
 * String(err)` that both handlers used to duplicate.
 */
export function dbError(err: unknown): HandlerFailure<'db-error'> {
  return {
    ok: false,
    code: 'db-error',
    message: err instanceof Error ? err.message : String(err),
  };
}
