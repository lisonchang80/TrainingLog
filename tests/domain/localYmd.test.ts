import { formatLocalYmd, formatLocalYmdFromMs } from '../../src/domain/date/localYmd';

/**
 * Canonical local-timezone YYYY-MM-DD formatter (big-file health #8 dedup,
 * 2026-06-02). Several screens + helpers delegated their inline copies here.
 * Constructed with `new Date(y, m-1, d, ...)` (LOCAL constructor) so the
 * expectations are timezone-independent — the local getters read back the same
 * local components regardless of the machine's TZ.
 */

describe('formatLocalYmd', () => {
  it('zero-pads month and day', () => {
    // 2026-01-05 local
    expect(formatLocalYmd(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('two-digit month/day pass through without extra padding', () => {
    // 2026-12-31 local
    expect(formatLocalYmd(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('uses LOCAL components, not UTC (late-evening stays on its calendar day)', () => {
    // 23:30 local on 2026-03-09 — a UTC-based formatter could roll to 03-10.
    const d = new Date(2026, 2, 9, 23, 30, 0);
    expect(formatLocalYmd(d)).toBe('2026-03-09');
  });

  it('time-of-day does not affect the date string', () => {
    expect(formatLocalYmd(new Date(2026, 5, 2, 0, 0, 0))).toBe('2026-06-02');
    expect(formatLocalYmd(new Date(2026, 5, 2, 12, 34, 56))).toBe('2026-06-02');
    expect(formatLocalYmd(new Date(2026, 5, 2, 23, 59, 59))).toBe('2026-06-02');
  });
});

describe('formatLocalYmdFromMs', () => {
  it('matches formatLocalYmd(new Date(ms)) for the same instant', () => {
    const d = new Date(2026, 0, 5, 8, 15, 0);
    expect(formatLocalYmdFromMs(d.getTime())).toBe(formatLocalYmd(d));
    expect(formatLocalYmdFromMs(d.getTime())).toBe('2026-01-05');
  });

  it('formats a millisecond timestamp as a local YYYY-MM-DD', () => {
    const ms = new Date(2025, 8, 30, 6, 0, 0).getTime();
    expect(formatLocalYmdFromMs(ms)).toBe('2025-09-30');
  });
});
