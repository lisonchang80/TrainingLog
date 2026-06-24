/**
 * Layout edge cases for `buildMonthGrid` (src/domain/calendar/monthGrid.ts).
 *
 * `tests/domain/buildMonthGrid.test.ts` covers a typical month + Jan/Dec
 * year boundaries. These lock the calendar-math corners it skips, each of
 * which would ripple through every rendered cell:
 *
 *   1. Month that starts on SUNDAY → zero leading prev-month cells (the
 *      `for (i = firstWeekday - 1; i >= 0; i--)` loop must run zero times,
 *      so cells[0] is in-month day 1).
 *   2. February in a LEAP year → 29 in-month days (daysInMonth via
 *      `new Date(y, 2, 0)`); the non-leap sibling has 28.
 *   3. A 30-day month (`new Date(y, m, 0)` for April).
 *   4. `isToday` matching a LEADING prev-month cell, and a TRAILING
 *      next-month cell — the flag is `date === today`, so an out-of-month
 *      cell whose date equals `today` must be flagged even though
 *      `inMonth === false`. Exactly one cell is ever flagged.
 *   5. Every grid is exactly 42 cells regardless of month length / start
 *      weekday (no reflow), including a 31-day month that starts on Friday
 *      (which needs all 6 rows) and a short Feb that needs fewer.
 */

import { buildMonthGrid } from '../../src/domain/calendar/monthGrid';

describe('buildMonthGrid — layout edges', () => {
  it('a month starting on Sunday has zero leading prev-month cells', () => {
    // 2026-03-01 is a Sunday → firstWeekday 0 → no leading days.
    const cells = buildMonthGrid(2026, 3, '2026-03-15');
    expect(cells[0].inMonth).toBe(true);
    expect(cells[0].dayNum).toBe(1);
    expect(cells[0].date).toBe('2026-03-01');
  });

  it('February in a leap year has 29 in-month days', () => {
    // 2024 is a leap year (÷4, not ÷100).
    const cells = buildMonthGrid(2024, 2, '2024-02-10');
    const inMonth = cells.filter((c) => c.inMonth);
    expect(inMonth).toHaveLength(29);
    expect(inMonth[inMonth.length - 1].date).toBe('2024-02-29');
  });

  it('February in a non-leap year has 28 in-month days', () => {
    const cells = buildMonthGrid(2025, 2, '2025-02-10');
    const inMonth = cells.filter((c) => c.inMonth);
    expect(inMonth).toHaveLength(28);
    expect(inMonth[inMonth.length - 1].date).toBe('2025-02-28');
  });

  it('a 30-day month yields 30 in-month days', () => {
    const cells = buildMonthGrid(2026, 4, '2026-04-15'); // April
    expect(cells.filter((c) => c.inMonth)).toHaveLength(30);
  });

  it('flags isToday on a LEADING prev-month cell (inMonth=false)', () => {
    // 2026-01-01 is a Thursday → leading days from Dec 2025.
    // The last leading cell is 2025-12-31; mark it as "today".
    const cells = buildMonthGrid(2026, 1, '2025-12-31');
    const flagged = cells.filter((c) => c.isToday);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].inMonth).toBe(false);
    expect(flagged[0].date).toBe('2025-12-31');
  });

  it('flags isToday on a TRAILING next-month cell (inMonth=false)', () => {
    // 2026-05 has 31 days; the grid trails into June. June 1st is a trailing
    // out-of-month cell — passing it as "today" must flag it.
    const cells = buildMonthGrid(2026, 5, '2026-06-01');
    const flagged = cells.filter((c) => c.isToday);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].inMonth).toBe(false);
    expect(flagged[0].date).toBe('2026-06-01');
  });

  it('always produces exactly 42 cells across varied months', () => {
    // Short Feb, long Jan-with-Friday-start, Sunday-start March.
    expect(buildMonthGrid(2025, 2, '2025-02-01')).toHaveLength(42);
    expect(buildMonthGrid(2026, 1, '2026-01-01')).toHaveLength(42);
    expect(buildMonthGrid(2026, 3, '2026-03-01')).toHaveLength(42);
  });

  it('flags no cell when "today" is in a different month entirely', () => {
    const cells = buildMonthGrid(2026, 5, '2027-11-11');
    expect(cells.filter((c) => c.isToday)).toHaveLength(0);
  });
});
