/**
 * Slice 13c — `monthGrid` edge helpers coverage.
 *
 * `tests/domain/buildMonthGrid.test.ts` already covers `buildMonthGrid`
 * (the 6-row, 42-cell layout). The sibling helpers `todayISO` and
 * `defaultCanGoNext` had no coverage — both are tiny but ship to UI
 * (CalendarGrid `canGoNext` predicate + the `today` flag), so we lock
 * their year/month-boundary logic here.
 *
 * Branches covered:
 *   todayISO
 *     1. format matches YYYY-MM-DD with zero-padded month/day
 *   defaultCanGoNext
 *     2. year strictly before current  → true
 *     3. year strictly after current   → false
 *     4. same year, month before now   → true
 *     5. same year, month equals now   → false (no future data yet)
 *     6. same year, month after now    → false
 */

import {
  todayISO,
  defaultCanGoNext,
  formatISO,
} from '../../src/domain/calendar/monthGrid';

describe('Slice 13c — monthGrid edge helpers', () => {
  describe('todayISO', () => {
    it('returns local date in YYYY-MM-DD format with zero-padded fields', () => {
      const iso = todayISO();
      expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      // Cross-check against the Date object the function reads from — we
      // can't pin "today" without faking timers, but we can assert that
      // the returned string is the same `formatISO` of "now" so the math
      // doesn't drift (e.g. accidentally using getUTCDate()).
      const now = new Date();
      expect(iso).toBe(
        formatISO(now.getFullYear(), now.getMonth() + 1, now.getDate())
      );
    });
  });

  describe('defaultCanGoNext', () => {
    // Pin "now" so the year/month comparison is deterministic regardless
    // of which calendar month the test runs in.
    let nowSpy: jest.SpyInstance;
    const FIXED_YEAR = 2026;
    const FIXED_MONTH_ZERO_INDEXED = 4; // May (5 when 1-indexed)

    beforeEach(() => {
      // Date(2026, 4, 15) = May 15 2026 local. Both getFullYear and
      // getMonth are derived from the constructor, so we override Date
      // wholesale rather than fight with timer fakes.
      const fixed = new Date(FIXED_YEAR, FIXED_MONTH_ZERO_INDEXED, 15);
      const RealDate = Date;
      nowSpy = jest.spyOn(global, 'Date').mockImplementation(((...args: unknown[]) => {
        if (args.length === 0) return fixed;
        return new (RealDate as unknown as { new (...a: unknown[]): Date })(
          ...(args as ConstructorParameters<typeof Date>)
        );
      }) as unknown as () => Date);
    });

    afterEach(() => {
      nowSpy.mockRestore();
    });

    it('returns true when year is strictly before current', () => {
      expect(defaultCanGoNext(2025, 12)).toBe(true);
      expect(defaultCanGoNext(2024, 1)).toBe(true);
    });

    it('returns false when year is strictly after current', () => {
      expect(defaultCanGoNext(2027, 1)).toBe(false);
      expect(defaultCanGoNext(2030, 6)).toBe(false);
    });

    it('returns true for an earlier month in the current year', () => {
      // Current = May 2026 (month index 5 when 1-indexed).
      expect(defaultCanGoNext(2026, 4)).toBe(true);
      expect(defaultCanGoNext(2026, 1)).toBe(true);
    });

    it('returns false when month equals the current month', () => {
      // Cannot go forward into the present month — view is already there.
      expect(defaultCanGoNext(2026, 5)).toBe(false);
    });

    it('returns false for a later month in the current year', () => {
      expect(defaultCanGoNext(2026, 6)).toBe(false);
      expect(defaultCanGoNext(2026, 12)).toBe(false);
    });
  });
});
