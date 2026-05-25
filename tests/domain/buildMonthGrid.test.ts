import { buildMonthGrid } from '../../src/domain/calendar/monthGrid';

/**
 * Pure-fn tests for the month-grid builder used by CalendarGrid (ADR-0015
 * § Q9.4). We can't easily unit-test the gesture / picker UX here, but the
 * grid layout math is the load-bearing piece for "did the calendar render
 * the right cells"; one bug here ripples through every cell.
 *
 * Mirrors `Prototype/CalendarMonthView.tsx::buildMonthGrid` shape (Sunday-
 * first, 6-row 42-cell grid, prev/next-month fill, today flag).
 */
describe('buildMonthGrid', () => {
  it('produces exactly 42 cells (6 rows × 7 cols) for a typical month', () => {
    const cells = buildMonthGrid(2026, 5, '2026-05-20');
    expect(cells).toHaveLength(42);
  });

  it('begins on Sunday and ends on Saturday', () => {
    const cells = buildMonthGrid(2026, 5, '2026-05-01');
    // 2026-05-01 is a Friday → leading 5 days from April.
    expect(cells[0].inMonth).toBe(false);
    expect(cells[5].inMonth).toBe(true);
    expect(cells[5].dayNum).toBe(1);
  });

  it('marks today via isToday flag', () => {
    const cells = buildMonthGrid(2026, 5, '2026-05-20');
    const today = cells.find((c) => c.date === '2026-05-20');
    expect(today?.isToday).toBe(true);
    // Every other cell is not today.
    expect(cells.filter((c) => c.isToday)).toHaveLength(1);
  });

  it('flags trailing days outside the current month as inMonth=false', () => {
    const cells = buildMonthGrid(2026, 5, '2026-05-20');
    // 2026-05 has 31 days; everything beyond the 31st is next month.
    const last = cells[cells.length - 1];
    expect(last.inMonth).toBe(false);
  });

  it('handles month boundary (January) correctly — December previous year fills lead', () => {
    const cells = buildMonthGrid(2026, 1, '2026-01-15');
    // 2026-01-01 is a Thursday → leading 4 days from December 2025.
    expect(cells[0].date.startsWith('2025-12-')).toBe(true);
    expect(cells[4].date).toBe('2026-01-01');
  });

  it('handles month boundary (December) correctly — January next year fills trail', () => {
    const cells = buildMonthGrid(2026, 12, '2026-12-15');
    const trailing = cells.filter((c) => !c.inMonth && c.date.startsWith('2027-01-'));
    expect(trailing.length).toBeGreaterThan(0);
  });

  it('all cells in-month belong to the requested month', () => {
    const cells = buildMonthGrid(2026, 5, '2026-05-20');
    const inMonth = cells.filter((c) => c.inMonth);
    expect(inMonth.length).toBe(31); // 2026-05 has 31 days
    for (const c of inMonth) {
      expect(c.date.startsWith('2026-05-')).toBe(true);
    }
  });
});
