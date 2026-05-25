/**
 * Edge-case coverage for `src/domain/program/programGridLayout.ts`
 * (slice 10c wave 15, Programs tab grid date math).
 *
 * The base `tests/domain/programGridLayout.test.ts` covers month + year
 * rollover but skips two corner cases that have bitten date code before:
 *
 *   1. Leap-year Feb 29 — Date.UTC(year, 1, 29) is real for 2024, 2028 …
 *      and synthetic for non-leap years (rolls over to Mar 1). `cellDate`
 *      uses explicit UTC math so Feb 28 + 1 in 2024 must land on Feb 29.
 *      A regression here would silently mis-label every cycle row that
 *      crosses leap-day for 4-year-old programs.
 *
 *   2. `findNearestNonRestInRow` with the user's cell being the ONLY
 *      filled cell in the row. The implementation starts its outward walk
 *      at `dist = 1`, so the source cell itself is intentionally NOT
 *      returned. This locks that behaviour (caller expects null so the
 *      template picker can open with no preset rather than re-suggesting
 *      the cell the user just tapped).
 *
 * Pure domain helpers — no DB or mocks needed.
 */

import {
  cellDate,
  findNearestNonRestInRow,
} from '../../src/domain/program/programGridLayout';
import type { ProgramCell } from '../../src/domain/program/types';

describe('cellDate — leap-year handling', () => {
  it('2024-02-28 + 1 day lands on Feb 29 (leap year)', () => {
    // 2024 is divisible by 4, not by 100 — leap year. Feb 28 + 1 = Feb 29.
    expect(cellDate('2024-02-28', 0, 1, 7)).toBe('2024-02-29');
  });

  it('2024-02-29 + 1 day lands on Mar 1', () => {
    expect(cellDate('2024-02-29', 0, 1, 7)).toBe('2024-03-01');
  });

  it('2025-02-28 + 1 day lands on Mar 1 (non-leap year)', () => {
    // 2025 is not divisible by 4 — Feb has 28 days, so + 1 = Mar 1.
    expect(cellDate('2025-02-28', 0, 1, 7)).toBe('2025-03-01');
  });

  it('crosses leap day across a 7-day cycle starting Feb 25, 2024', () => {
    // 25, 26, 27, 28, 29, Mar 1, Mar 2 — d=4 is Feb 29, d=5 is Mar 1.
    expect(cellDate('2024-02-25', 0, 4, 7)).toBe('2024-02-29');
    expect(cellDate('2024-02-25', 0, 5, 7)).toBe('2024-03-01');
  });

  it('skips Feb 29 in non-leap years across a 7-day cycle starting Feb 25, 2025', () => {
    // 25, 26, 27, 28, Mar 1, Mar 2, Mar 3 — d=4 is Mar 1.
    expect(cellDate('2025-02-25', 0, 4, 7)).toBe('2025-03-01');
  });
});

describe('findNearestNonRestInRow — degenerate rows', () => {
  it('the only filled cell in the row IS the source cell → returns null', () => {
    // User taps day 2 (filled). The outward walk starts at dist=1 and
    // never inspects day 2 itself, so the result must be null. This is
    // load-bearing for the UX: caller falls back to opening a plain
    // template picker rather than re-suggesting the tapped cell.
    const cells: ProgramCell[] = [
      { id: 'd0', program_id: 'p', cycle_index: 0, day_index: 0, template_id: null, sub_tag: null },
      { id: 'd1', program_id: 'p', cycle_index: 0, day_index: 1, template_id: null, sub_tag: null },
      { id: 'd2', program_id: 'p', cycle_index: 0, day_index: 2, template_id: 't-a', sub_tag: 'normal' },
      { id: 'd3', program_id: 'p', cycle_index: 0, day_index: 3, template_id: null, sub_tag: null },
      { id: 'd4', program_id: 'p', cycle_index: 0, day_index: 4, template_id: null, sub_tag: null },
    ];
    expect(findNearestNonRestInRow(cells, 0, 2, 5)).toBeNull();
  });

  it('cells with template_id set but null sub_tag still count as non-rest', () => {
    // A common state: user attaches a template but doesn't pick an intensity.
    // The cell is filled (not "休息") so the nearest-search must include it.
    const cells: ProgramCell[] = [
      { id: 'd0', program_id: 'p', cycle_index: 0, day_index: 0, template_id: null, sub_tag: null },
      { id: 'd1', program_id: 'p', cycle_index: 0, day_index: 1, template_id: 't-a', sub_tag: null },
      { id: 'd2', program_id: 'p', cycle_index: 0, day_index: 2, template_id: null, sub_tag: null },
    ];
    expect(findNearestNonRestInRow(cells, 0, 0, 3)?.id).toBe('d1');
    expect(findNearestNonRestInRow(cells, 0, 2, 3)?.id).toBe('d1');
  });

  it('cycle_length=3 (ADR-0004 minimum) — walk distance capped correctly', () => {
    // ADR-0004 mandates cycle_length ∈ [3, 14]. With length 3 the outward
    // walk only ever inspects dist=1 and dist=2 — verify it doesn't loop
    // past the boundary.
    const cells: ProgramCell[] = [
      { id: 'd0', program_id: 'p', cycle_index: 0, day_index: 0, template_id: 't-a', sub_tag: null },
      { id: 'd1', program_id: 'p', cycle_index: 0, day_index: 1, template_id: null, sub_tag: null },
      { id: 'd2', program_id: 'p', cycle_index: 0, day_index: 2, template_id: null, sub_tag: null },
    ];
    expect(findNearestNonRestInRow(cells, 0, 2, 3)?.id).toBe('d0');
    // Reverse — d0 is filled, search from d0 itself: must be null (no other
    // filled cells in row, and source is excluded).
    expect(findNearestNonRestInRow(cells, 0, 0, 3)).toBeNull();
  });
});
