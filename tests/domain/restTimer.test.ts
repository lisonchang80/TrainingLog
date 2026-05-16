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
