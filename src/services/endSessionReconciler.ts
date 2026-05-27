/**
 * Slice 13d / D7 partial — iPhone-side end-session reconciliation
 * state machine.
 *
 * ADR-0019 § Q23 + NEW-Q45. When iPhone initiates session end (or
 * receives a watch-led end), it sends a WC `end-session` envelope and
 * arms a 5-second window for the Watch ack. If the ack arrives the
 * normal flow continues; if 5 seconds elapse with no ack the iPhone
 * "reconciles" — flips `session.is_watch_tracked = false` so the
 * 5-tile stats panel predicate falls back to 4-tile and the user
 * isn't left looking at a Watch column that will never receive data.
 *
 * Pure reducer + Clock-injected action pattern (no `setTimeout`). The
 * runtime caller is responsible for two things:
 *   1. Calling `reduce(state, { kind: 'tick', now: Date.now() })` from
 *      an `AppState` listener or a `setInterval` so the timeout can
 *      fire even if no other event happens.
 *   2. Reacting to a `next.phase === 'reconciled'` transition by
 *      writing `is_watch_tracked = 0` on the session row.
 *
 * The reducer never touches SQLite or `setTimeout`; tests run cold
 * under `testEnvironment: node` without any fake timers.
 *
 * This is **D7 partial** — the full D7 commit additionally wires the
 * `connectivity.ts` `sendMessage`/`onMessage` handlers (gated on the
 * D0 spike outcome). The reducer is ready-to-wire once the bridge
 * lands.
 */

/** The wait window in epoch ms. ADR-0019 § Q23 dictates 5 seconds. */
export const RECONCILE_TIMEOUT_MS = 5_000;

export type ReconcilerPhase = 'idle' | 'waiting' | 'acked' | 'reconciled';

export interface EndSessionReconcilerState {
  phase: ReconcilerPhase;
  /** Session whose end is being reconciled. `null` outside `waiting`+. */
  sessionId: string | null;
  /** Epoch ms — when iPhone sent the end-session envelope. */
  sentAt: number;
  /** Epoch ms — when Watch ack arrived (or `null` if not yet / never). */
  ackedAt: number | null;
  /** Epoch ms — when the reducer fired the reconciliation. */
  reconciledAt: number | null;
}

export function initialReconcilerState(): EndSessionReconcilerState {
  return {
    phase: 'idle',
    sessionId: null,
    sentAt: 0,
    ackedAt: null,
    reconciledAt: null,
  };
}

export interface SendEndAction {
  kind: 'sendEnd';
  sessionId: string;
  /** Epoch ms — when the envelope was sent. */
  ts: number;
}

export interface AckAction {
  kind: 'ack';
  sessionId: string;
  /** Epoch ms — when the ack arrived. */
  ts: number;
}

export interface TickAction {
  kind: 'tick';
  /** Epoch ms — caller's current clock reading. */
  now: number;
}

export interface ResetAction {
  kind: 'reset';
}

export type ReconcilerAction =
  | SendEndAction
  | AckAction
  | TickAction
  | ResetAction;

/**
 * Pure reducer. Returns the prior state instance (referential equality)
 * when an action is a no-op so React `useReducer` callers skip-render.
 */
export function reduce(
  state: EndSessionReconcilerState,
  action: ReconcilerAction,
): EndSessionReconcilerState {
  switch (action.kind) {
    case 'sendEnd':
      // Any phase → restart waiting. A second `sendEnd` (e.g. user
      // retried after a stuck Watch) resets the timer for the new
      // attempt.
      return {
        phase: 'waiting',
        sessionId: action.sessionId,
        sentAt: action.ts,
        ackedAt: null,
        reconciledAt: null,
      };

    case 'ack':
      // Only honor an ack matching the current waiting session. A
      // stale ack from a prior session (or after we already
      // reconciled) is ignored.
      if (state.phase !== 'waiting') return state;
      if (state.sessionId !== action.sessionId) return state;
      return {
        ...state,
        phase: 'acked',
        ackedAt: action.ts,
      };

    case 'tick':
      // Only `waiting` participates in timeout. Other phases ignore
      // tick.
      if (state.phase !== 'waiting') return state;
      if (action.now - state.sentAt <= RECONCILE_TIMEOUT_MS) return state;
      return {
        ...state,
        phase: 'reconciled',
        reconciledAt: action.now,
      };

    case 'reset':
      // Idempotent — `reset` on already-idle returns the same state
      // reference so callers can fire-and-forget.
      if (state.phase === 'idle') return state;
      return initialReconcilerState();

    default: {
      // Exhaustiveness — compiler enforces all action kinds covered.
      const _exhaustive: never = action;
      void _exhaustive;
      return state;
    }
  }
}

/**
 * Convenience predicate for callers wiring `useEffect` against
 * reducer state transitions. Returns `true` iff `next` just entered
 * `reconciled` — that's the cue to write `is_watch_tracked = 0`.
 */
export function didJustReconcile(
  prev: EndSessionReconcilerState,
  next: EndSessionReconcilerState,
): boolean {
  return prev.phase !== 'reconciled' && next.phase === 'reconciled';
}
