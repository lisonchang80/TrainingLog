import {
  localMsToIsoDate,
  utcMsToIsoDate,
} from '../../src/domain/program/programManager';

/**
 * Regression guard for the UTC-"today" bug: `Date.now()` fed through the UTC
 * variant shifts the local calendar day by ±1 near midnight for users east/west
 * of UTC. `localMsToIsoDate` must read LOCAL calendar fields so it round-trips
 * with locally-constructed dates and with `formatLocalDateToIso` (the program
 * `start_date` writer).
 *
 * The first three cases are timezone-independent: `new Date(y, m, d, …)` builds
 * from LOCAL fields and `localMsToIsoDate` reads LOCAL fields, so the calendar
 * day round-trips identically in ANY runner timezone (CI=UTC, author=UTC+8).
 */
describe('localMsToIsoDate (local-calendar "today")', () => {
  it('round-trips a midday local timestamp to its local calendar day', () => {
    expect(localMsToIsoDate(new Date(2026, 5, 3, 12, 0).getTime())).toBe(
      '2026-06-03',
    );
  });

  it('does NOT roll the day for a late-evening or early-morning local time', () => {
    // 23:30 local stays on the same local day...
    expect(localMsToIsoDate(new Date(2026, 5, 3, 23, 30).getTime())).toBe(
      '2026-06-03',
    );
    // ...and 00:05 local stays on its own day (the bug's trigger window).
    expect(localMsToIsoDate(new Date(2026, 0, 1, 0, 5).getTime())).toBe(
      '2026-01-01',
    );
  });

  it('zero-pads single-digit month and day', () => {
    expect(localMsToIsoDate(new Date(2026, 0, 9, 9, 0).getTime())).toBe(
      '2026-01-09',
    );
  });

  it('diverges from utcMsToIsoDate exactly when the runner is offset from UTC (documents the bug)', () => {
    const utcMidnight = Date.UTC(2026, 5, 3); // 2026-06-03T00:00:00Z
    const offsetMin = new Date(utcMidnight).getTimezoneOffset();
    if (offsetMin === 0) {
      // UTC runner: the two agree, which is exactly why the bug is invisible in UTC-only CI.
      expect(localMsToIsoDate(utcMidnight)).toBe(utcMsToIsoDate(utcMidnight));
    } else if (offsetMin > 0) {
      // West of UTC (e.g. the Americas): local clock is still the previous day.
      expect(utcMsToIsoDate(utcMidnight)).toBe('2026-06-03');
      expect(localMsToIsoDate(utcMidnight)).toBe('2026-06-02');
    } else {
      // East of UTC (e.g. Asia/Taipei, the author's zone): local is already the same day.
      expect(localMsToIsoDate(utcMidnight)).toBe('2026-06-03');
    }
  });
});
