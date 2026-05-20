import { validateSessionTimes } from '../../../src/domain/session/sessionTimeEditor';

describe('validateSessionTimes (overnight #60)', () => {
  it('returns valid + floored duration when end > start', () => {
    const start = Date.UTC(2026, 4, 20, 19, 30, 0);
    const end = Date.UTC(2026, 4, 20, 20, 45, 0); // +1h 15m
    const result = validateSessionTimes(start, end);
    expect(result).toEqual({
      valid: true,
      duration_sec: 75 * 60,
    });
  });

  it('returns invalid NON_POSITIVE when end < start', () => {
    const start = Date.UTC(2026, 4, 20, 20, 0, 0);
    const end = Date.UTC(2026, 4, 20, 19, 0, 0); // 1h earlier
    expect(validateSessionTimes(start, end)).toEqual({
      valid: false,
      reason: 'NON_POSITIVE',
    });
  });

  it('returns invalid NON_POSITIVE when end === start (zero duration)', () => {
    const ts = Date.UTC(2026, 4, 20, 19, 30, 0);
    expect(validateSessionTimes(ts, ts)).toEqual({
      valid: false,
      reason: 'NON_POSITIVE',
    });
  });

  it('truncates sub-second fractional milliseconds via floor', () => {
    const start = 1_000_000;
    const end = 1_001_999; // 1.999 seconds later
    expect(validateSessionTimes(start, end)).toEqual({
      valid: true,
      duration_sec: 1,
    });
  });

  it('handles far-future dates without overflow', () => {
    // Year 2099 — well within JS safe integer range for ms epoch
    const start = Date.UTC(2099, 0, 1, 0, 0, 0);
    const end = Date.UTC(2099, 0, 1, 2, 30, 0); // +2h 30m
    expect(validateSessionTimes(start, end)).toEqual({
      valid: true,
      duration_sec: 2 * 3600 + 30 * 60,
    });
  });
});
