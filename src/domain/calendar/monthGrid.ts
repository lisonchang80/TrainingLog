/**
 * Pure month-grid builder for CalendarGrid (ADR-0015 § Q9.4).
 *
 * Extracted out of `src/components/history/CalendarGrid.tsx` so jest can
 * unit-test the layout math without dragging in React Native runtime.
 * Sunday-first, 6-row 42-cell grid, prev/next-month fill, today flag.
 * Mirrors `Prototype/CalendarMonthView.tsx::buildMonthGrid`.
 */

export type CalendarDayCell = {
  /** ISO YYYY-MM-DD (local time). */
  date: string;
  dayNum: number;
  inMonth: boolean;
  isToday: boolean;
};

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

export function formatISO(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

export function todayISO(): string {
  const d = new Date();
  return formatISO(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function daysInMonth(y: number, m: number): number {
  // m: 1-12. Day 0 of next month = last day of given month.
  return new Date(y, m, 0).getDate();
}

export function buildMonthGrid(
  y: number,
  m: number,
  today: string
): CalendarDayCell[] {
  const firstWeekday = new Date(y, m - 1, 1).getDay(); // Sunday = 0
  const totalDays = daysInMonth(y, m);

  const prevMonthY = m === 1 ? y - 1 : y;
  const prevMonthM = m === 1 ? 12 : m - 1;
  const prevMonthDays = daysInMonth(prevMonthY, prevMonthM);

  const nextMonthY = m === 12 ? y + 1 : y;
  const nextMonthM = m === 12 ? 1 : m + 1;

  const cells: CalendarDayCell[] = [];

  // Leading trailing days from previous month so the grid starts on Sunday.
  for (let i = firstWeekday - 1; i >= 0; i--) {
    const d = prevMonthDays - i;
    const date = formatISO(prevMonthY, prevMonthM, d);
    cells.push({ date, dayNum: d, inMonth: false, isToday: date === today });
  }

  // The actual month.
  for (let d = 1; d <= totalDays; d++) {
    const date = formatISO(y, m, d);
    cells.push({ date, dayNum: d, inMonth: true, isToday: date === today });
  }

  // Trailing days from next month, padded out to a 6-row grid (42 cells)
  // so the layout doesn't reflow when switching months.
  let nextDay = 1;
  while (cells.length < 42) {
    const date = formatISO(nextMonthY, nextMonthM, nextDay);
    cells.push({
      date,
      dayNum: nextDay,
      inMonth: false,
      isToday: date === today,
    });
    nextDay++;
  }

  return cells;
}

/**
 * Default "can the user navigate forward?" predicate — returns false once
 * the current view is at the present month (we don't have data in the
 * future yet).
 */
export function defaultCanGoNext(year: number, month: number): boolean {
  const now = new Date();
  const curY = now.getFullYear();
  const curM = now.getMonth() + 1;
  if (year < curY) return true;
  if (year > curY) return false;
  return month < curM;
}
