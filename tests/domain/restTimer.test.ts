import {
  IDLE_TIMER,
  cancelTimer,
  formatRestRemaining,
  startTimer,
  tickTimer,
} from '../../src/domain/session/restTimer';

/**
 * ADR-0019 Q2 R1 v1 — rest timer state machine.
 */

describe('startTimer', () => {
  it('produces a running state with the given rest_sec', () => {
    const out = startTimer(60, 1_000_000);
    expect(out.status).toBe('running');
    expect(out.rest_sec).toBe(60);
    expect(out.remaining_ms).toBe(60_000);
    expect(out.end_at_ms).toBe(1_060_000);
  });

  it('treats rest_sec=0 as 60 (system default)', () => {
    const out = startTimer(0, 0);
    expect(out.rest_sec).toBe(60);
    expect(out.remaining_ms).toBe(60_000);
  });

  it('treats negative rest_sec as 60 (defensive)', () => {
    const out = startTimer(-30, 0);
    expect(out.rest_sec).toBe(60);
    expect(out.remaining_ms).toBe(60_000);
  });
});

describe('tickTimer', () => {
  it('idle state is returned unchanged', () => {
    expect(tickTimer(IDLE_TIMER, 1_000_000)).toBe(IDLE_TIMER);
  });

  it('running with time remaining → updates remaining_ms', () => {
    const start = startTimer(60, 0);
    const out = tickTimer(start, 10_000);
    expect(out.status).toBe('running');
    expect(out.remaining_ms).toBe(50_000);
    expect(out.end_at_ms).toBe(60_000);
  });

  it('running, now >= end_at → transitions to finished', () => {
    const start = startTimer(60, 0);
    const out = tickTimer(start, 60_000);
    expect(out.status).toBe('finished');
    expect(out.remaining_ms).toBe(0);
  });

  it('running, now > end_at → also finished (clamp)', () => {
    const start = startTimer(60, 0);
    const out = tickTimer(start, 60_001);
    expect(out.status).toBe('finished');
    expect(out.remaining_ms).toBe(0);
  });

  it('finished state is returned unchanged', () => {
    const start = startTimer(60, 0);
    const finished = tickTimer(start, 60_000);
    expect(tickTimer(finished, 999_999)).toBe(finished);
  });
});

describe('cancelTimer', () => {
  it('returns IDLE_TIMER from any state', () => {
    expect(cancelTimer()).toEqual(IDLE_TIMER);
    expect(cancelTimer().status).toBe('idle');
  });
});

describe('formatRestRemaining', () => {
  it('60_000 → "01:00"', () => {
    expect(formatRestRemaining(60_000)).toBe('01:00');
  });

  it('1_500 → "00:02" (ceil)', () => {
    expect(formatRestRemaining(1_500)).toBe('00:02');
  });

  it('0 → "00:00"', () => {
    expect(formatRestRemaining(0)).toBe('00:00');
  });

  it('negative clamps to "00:00"', () => {
    expect(formatRestRemaining(-1000)).toBe('00:00');
  });

  it('125_000 → "02:05"', () => {
    expect(formatRestRemaining(125_000)).toBe('02:05');
  });
});

describe('flow', () => {
  it('start → tick → tick → finished, then cancel resets to idle', () => {
    let state = startTimer(2, 0); // 2 second timer
    expect(state.status).toBe('running');
    expect(state.remaining_ms).toBe(2000);

    state = tickTimer(state, 1000);
    expect(state.status).toBe('running');
    expect(state.remaining_ms).toBe(1000);

    state = tickTimer(state, 2000);
    expect(state.status).toBe('finished');
    expect(state.remaining_ms).toBe(0);

    state = cancelTimer();
    expect(state).toEqual(IDLE_TIMER);
  });

  it('start can be called again to reset (Q2.3 (b) M1 re-tap behaviour)', () => {
    let state = startTimer(60, 0);
    state = tickTimer(state, 40_000);
    expect(state.remaining_ms).toBe(20_000);
    // user re-taps ✓ → start fires again, fresh 60s
    state = startTimer(60, 40_000);
    expect(state.remaining_ms).toBe(60_000);
    expect(state.end_at_ms).toBe(100_000);
  });
});

/**
 * ADR-0019 § slice 10d BG2 — AppState wall-clock self-correct.
 *
 * The modal hooks `AppState.addEventListener('change', ...)` and re-ticks
 * with `Date.now()` when the app returns to 'active'. iOS suspends the JS
 * `setInterval` while the app is backgrounded, so on resume the next
 * tickTimer call sees a `now` value that has jumped forward by however
 * long the user was away. These tests verify the state machine produces
 * the correct transitions for those jumps.
 */
describe('BG2 — wall-clock resume', () => {
  it('foreground-resume mid-countdown → still running with correct remaining', () => {
    // User starts a 60s timer at t=0, backgrounds at t=10s,
    // returns to foreground at t=25s (15s elapsed in background).
    const start = startTimer(60, 0);
    const onResume = tickTimer(start, 25_000);
    expect(onResume.status).toBe('running');
    expect(onResume.remaining_ms).toBe(35_000); // 60 - 25 = 35s left
    // end_at_ms is wall-clock anchored — unchanged across the background gap.
    expect(onResume.end_at_ms).toBe(60_000);
  });

  it('foreground-resume after deadline passed → transitions to finished', () => {
    // User starts a 60s timer at t=0, backgrounds at t=30s,
    // returns at t=90s (60s past deadline).
    const start = startTimer(60, 0);
    const onResume = tickTimer(start, 90_000);
    expect(onResume.status).toBe('finished');
    expect(onResume.remaining_ms).toBe(0);
    // end_at_ms preserved so downstream UI can still report it if desired.
    expect(onResume.end_at_ms).toBe(60_000);
  });

  it('foreground-resume exactly at deadline → transitions to finished', () => {
    const start = startTimer(60, 0);
    const onResume = tickTimer(start, 60_000);
    expect(onResume.status).toBe('finished');
    expect(onResume.remaining_ms).toBe(0);
  });

  it('repeated foreground-resume in finished state → idempotent (returns same reference)', () => {
    // Modal effect could fire AppState 'active' multiple times in quick
    // succession (e.g. iOS sends 'inactive' → 'active' transitions during
    // Control Center). Once finished, additional ticks must be no-ops so
    // the haptic effect ref isn't re-fired.
    const start = startTimer(60, 0);
    const first = tickTimer(start, 60_000);
    expect(first.status).toBe('finished');
    const second = tickTimer(first, 90_000);
    expect(second).toBe(first); // reference equality — same object
  });
});
