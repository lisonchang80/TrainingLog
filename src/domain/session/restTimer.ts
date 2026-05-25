/**
 * Rest timer state machine (ADR-0019 Q2 R1 v1, slice 10c — Agent C).
 *
 * Pure reducer functions over a tiny state shape — the component owns
 * the `setInterval` + haptic firing, this module owns the truth about
 * "is the timer running, and how much time is left given the wall clock?".
 *
 * State transitions:
 *
 *   idle ──startTimer(rest_sec, now)──▶ running
 *   running ──tickTimer(state, now)──▶ running  (if now < end_at)
 *   running ──tickTimer(state, now)──▶ finished (if now >= end_at)
 *   any     ──cancelTimer()─────────▶ idle
 *
 * Why end_at_ms (wall clock) instead of remaining_ms (countdown)?
 *   - Robust to JS event-loop jitter (we don't decrement; we re-derive
 *     remaining from `end_at - now` each tick).
 *   - Trivial to migrate to background-aware timers later (just compare
 *     against system clock on resume; no need to fix up state).
 *
 * Per ADR-0019 Q2.3 (b) M1: re-tapping ✓ on the same set resets the
 * timer. Per (d) Y2: re-tapping ✓ to UN-log a set cancels the timer.
 * The caller (TodayScreen tap-✓ handler) decides which transition to
 * fire; this module just exposes both startTimer (which is also "reset
 * to fresh") and cancelTimer.
 */

type RestTimerStatus = 'idle' | 'running' | 'finished';

export interface RestTimerState {
  status: RestTimerStatus;
  /** ms remaining until 0; 0 when status='finished' or 'idle'. */
  remaining_ms: number;
  /** Absolute wall-clock ms when the timer will hit 0. 0 when idle. */
  end_at_ms: number;
  /** rest_sec the timer was started with — useful for the modal label. */
  rest_sec: number;
}

export const IDLE_TIMER: RestTimerState = {
  status: 'idle',
  remaining_ms: 0,
  end_at_ms: 0,
  rest_sec: 0,
};

/**
 * Start (or reset) the timer. `rest_sec` of 0 or negative is treated as
 * 60 (the system default per ADR-0019 Q2.1 — "預設秒數來源 = 60s hardcoded").
 * Caller passes `now` so tests can deterministically advance time.
 */
export function startTimer(rest_sec: number, now: number): RestTimerState {
  const effective = rest_sec > 0 ? rest_sec : 60;
  const ms = effective * 1000;
  return {
    status: 'running',
    remaining_ms: ms,
    end_at_ms: now + ms,
    rest_sec: effective,
  };
}

/**
 * Re-derive `remaining_ms` and possibly transition to 'finished'.
 *
 * Called on each setInterval tick by the modal. Returns the same shape
 * regardless of transition (so the React state update is uniform).
 *
 * When already 'idle' or 'finished' the input is returned verbatim —
 * no mutation, no transition. Caller can compare reference equality to
 * skip a re-render.
 */
export function tickTimer(
  state: RestTimerState,
  now: number,
): RestTimerState {
  if (state.status !== 'running') return state;
  const remaining = state.end_at_ms - now;
  if (remaining <= 0) {
    return {
      status: 'finished',
      remaining_ms: 0,
      end_at_ms: state.end_at_ms,
      rest_sec: state.rest_sec,
    };
  }
  return {
    status: 'running',
    remaining_ms: remaining,
    end_at_ms: state.end_at_ms,
    rest_sec: state.rest_sec,
  };
}

/** Reset to idle. Used by ✓-cancel (Y2) and the modal's skip button. */
export function cancelTimer(): RestTimerState {
  return IDLE_TIMER;
}

/**
 * Format remaining ms as `MM:SS` for the modal countdown.
 * Always 2-digit MM (zero-padded). Negative clamps to 00:00.
 */
export function formatRestRemaining(remaining_ms: number): string {
  const totalSec = Math.max(0, Math.ceil(remaining_ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
