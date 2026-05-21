import {
  buildCellMap,
  cellDate,
  distinctSubTagsInProgram,
  findNearestNonRestInRow,
  formatCellDateLabel,
} from '../../src/domain/program/programGridLayout';
import type { ProgramCell } from '../../src/domain/program/types';

describe('cellDate', () => {
  it('returns start_date for (cycle_index=0, day_index=0)', () => {
    expect(cellDate('2026-05-21', 0, 0, 7)).toBe('2026-05-21');
  });

  it('walks day_index within the first cycle', () => {
    expect(cellDate('2026-05-21', 0, 1, 7)).toBe('2026-05-22');
    expect(cellDate('2026-05-21', 0, 6, 7)).toBe('2026-05-27');
  });

  it('walks cycle_index across full cycles', () => {
    // 7-day cycle, second cycle day 0 = start + 7 days
    expect(cellDate('2026-05-21', 1, 0, 7)).toBe('2026-05-28');
    // 3rd cycle day 2 = start + 2*7 + 2 = +16 days
    expect(cellDate('2026-05-21', 2, 2, 7)).toBe('2026-06-06');
  });

  it('handles month rollover correctly', () => {
    // 2026-05-31 + 1 day = 2026-06-01
    expect(cellDate('2026-05-31', 0, 1, 7)).toBe('2026-06-01');
  });

  it('handles year rollover correctly', () => {
    expect(cellDate('2026-12-30', 0, 5, 7)).toBe('2027-01-04');
  });

  it('handles 3-day cycles (ADR-0004 minimum)', () => {
    // start 2026-05-21 (Thu), 3-day cycle
    // C1D0=21, C1D1=22, C1D2=23 / C2D0=24, C2D1=25 ...
    expect(cellDate('2026-05-21', 1, 0, 3)).toBe('2026-05-24');
    // C4D2 = offset 3*3 + 2 = 11 days from start → 2026-06-01
    expect(cellDate('2026-05-21', 3, 2, 3)).toBe('2026-06-01');
  });
});

describe('formatCellDateLabel', () => {
  it('strips leading zeros from month and day', () => {
    expect(formatCellDateLabel('2026-05-21')).toBe('5/21');
    expect(formatCellDateLabel('2026-01-01')).toBe('1/1');
    expect(formatCellDateLabel('2026-12-09')).toBe('12/9');
  });
});

describe('buildCellMap', () => {
  it('keys cells by "cycle_index,day_index"', () => {
    const cells: ProgramCell[] = [
      { id: 'c1', program_id: 'p', cycle_index: 0, day_index: 0, template_id: 't1', sub_tag: null },
      { id: 'c2', program_id: 'p', cycle_index: 1, day_index: 2, template_id: null, sub_tag: null },
    ];
    const map = buildCellMap(cells);
    expect(map.get('0,0')?.id).toBe('c1');
    expect(map.get('1,2')?.id).toBe('c2');
    expect(map.get('99,99')).toBeUndefined();
  });
});

describe('findNearestNonRestInRow', () => {
  // 7-day row example:
  //   day 0: rest, day 1: rest, day 2: T-A, day 3: T-B, day 4: rest, day 5: T-C, day 6: rest
  const cells: ProgramCell[] = [
    { id: 'r0d0', program_id: 'p', cycle_index: 0, day_index: 0, template_id: null, sub_tag: null },
    { id: 'r0d1', program_id: 'p', cycle_index: 0, day_index: 1, template_id: null, sub_tag: null },
    { id: 'r0d2', program_id: 'p', cycle_index: 0, day_index: 2, template_id: 't-a', sub_tag: 'normal' },
    { id: 'r0d3', program_id: 'p', cycle_index: 0, day_index: 3, template_id: 't-b', sub_tag: 'heavy' },
    { id: 'r0d4', program_id: 'p', cycle_index: 0, day_index: 4, template_id: null, sub_tag: null },
    { id: 'r0d5', program_id: 'p', cycle_index: 0, day_index: 5, template_id: 't-c', sub_tag: 'light' },
    { id: 'r0d6', program_id: 'p', cycle_index: 0, day_index: 6, template_id: null, sub_tag: null },
    // Sibling row that should never match (different cycle_index)
    { id: 'r1d0', program_id: 'p', cycle_index: 1, day_index: 0, template_id: 't-x', sub_tag: 'normal' },
  ];

  it('finds the cell at the closest day in the same row (walk outward)', () => {
    // day 4 is rest. Neighbours: day 3 (dist 1, T-B) wins over day 5 (dist 1, T-C)
    // because left is checked first at each distance.
    const result = findNearestNonRestInRow(cells, 0, 4, 7);
    expect(result?.id).toBe('r0d3');
  });

  it('prefers left over right at the same distance', () => {
    // day 1 is rest. Distance 1 to day 0 (rest) — skip. Distance 1 right
    // to day 2 (T-A) → pick that. (Left=day 0 is rest so right wins at dist 1.)
    const result = findNearestNonRestInRow(cells, 0, 1, 7);
    expect(result?.id).toBe('r0d2');
  });

  it('walks past multiple rest neighbours to find the first filled cell', () => {
    // day 6 is rest. day 5 (T-C, dist 1) → pick.
    const result = findNearestNonRestInRow(cells, 0, 6, 7);
    expect(result?.id).toBe('r0d5');
  });

  it('does not return cells from other cycle rows', () => {
    // All-rest row example
    const allRest: ProgramCell[] = [
      { id: 'a', program_id: 'p', cycle_index: 0, day_index: 0, template_id: null, sub_tag: null },
      { id: 'b', program_id: 'p', cycle_index: 0, day_index: 1, template_id: null, sub_tag: null },
      // Filled cell in DIFFERENT row — must not leak across.
      { id: 'c', program_id: 'p', cycle_index: 1, day_index: 0, template_id: 't', sub_tag: 'x' },
    ];
    expect(findNearestNonRestInRow(allRest, 0, 0, 3)).toBeNull();
  });

  it('returns null when row is entirely rest', () => {
    const allRest: ProgramCell[] = [
      { id: 'a', program_id: 'p', cycle_index: 0, day_index: 0, template_id: null, sub_tag: null },
      { id: 'b', program_id: 'p', cycle_index: 0, day_index: 1, template_id: null, sub_tag: null },
      { id: 'c', program_id: 'p', cycle_index: 0, day_index: 2, template_id: null, sub_tag: null },
    ];
    expect(findNearestNonRestInRow(allRest, 0, 1, 3)).toBeNull();
  });

  it('returns null when row has no cells (gap in grid)', () => {
    const noRow: ProgramCell[] = [
      { id: 'a', program_id: 'p', cycle_index: 1, day_index: 0, template_id: 't', sub_tag: 'x' },
    ];
    expect(findNearestNonRestInRow(noRow, 0, 0, 3)).toBeNull();
  });
});

describe('distinctSubTagsInProgram', () => {
  it('returns distinct non-null sub_tags sorted by frequency desc then alpha', () => {
    const cells: ProgramCell[] = [
      { id: '1', program_id: 'p', cycle_index: 0, day_index: 0, template_id: 't', sub_tag: 'heavy' },
      { id: '2', program_id: 'p', cycle_index: 0, day_index: 1, template_id: 't', sub_tag: 'light' },
      { id: '3', program_id: 'p', cycle_index: 0, day_index: 2, template_id: 't', sub_tag: 'heavy' },
      { id: '4', program_id: 'p', cycle_index: 1, day_index: 0, template_id: 't', sub_tag: 'heavy' },
      { id: '5', program_id: 'p', cycle_index: 1, day_index: 1, template_id: 't', sub_tag: 'normal' },
      // Rest cells with null sub_tag — must not appear.
      { id: '6', program_id: 'p', cycle_index: 1, day_index: 2, template_id: null, sub_tag: null },
    ];
    expect(distinctSubTagsInProgram(cells)).toEqual(['heavy', 'light', 'normal']);
  });

  it('returns empty when no cells have sub_tag', () => {
    const cells: ProgramCell[] = [
      { id: '1', program_id: 'p', cycle_index: 0, day_index: 0, template_id: 't', sub_tag: null },
      { id: '2', program_id: 'p', cycle_index: 0, day_index: 1, template_id: null, sub_tag: null },
    ];
    expect(distinctSubTagsInProgram(cells)).toEqual([]);
  });
});
