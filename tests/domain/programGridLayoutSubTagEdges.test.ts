/**
 * Edge coverage for the non-date helpers in
 * `src/domain/program/programGridLayout.ts`.
 *
 * The base `programGridLayout.test.ts` covers `cellDate`, the happy-path
 * `distinctSubTagsInProgram` ordering, and `findNearestNonRestInRow`.
 * `programGridLayoutEdges.test.ts` adds leap-year + degenerate rows. These
 * lock three branches still uncovered:
 *
 *   1. `distinctSubTagsInProgram` EXCLUDES empty-string sub_tags. The guard
 *      is `c.sub_tag != null && c.sub_tag.length > 0` — an `''` tag (filled
 *      cell, intensity field blanked) must be dropped, not surfaced as an
 *      empty chip in the "已用過的強度" list.
 *   2. The alpha tie-break when two sub_tags share the SAME frequency:
 *      `localeCompare` orders them lexicographically (the base test's
 *      heavy(3)/light(1)/normal(1) case is dominated by frequency; here we
 *      give two tags equal counts so the secondary sort is the deciding key).
 *   3. `buildCellMap` last-write-wins on a duplicate `(cycle_index,day_index)`
 *      key — a defensive property worth pinning so a future refactor that
 *      switches to first-wins is caught.
 */

import {
  buildCellMap,
  distinctSubTagsInProgram,
  formatCellDateLabel,
} from '../../src/domain/program/programGridLayout';
import type { ProgramCell } from '../../src/domain/program/types';

function cell(over: Partial<ProgramCell> & { id: string }): ProgramCell {
  return {
    program_id: 'p',
    cycle_index: 0,
    day_index: 0,
    template_id: 't',
    sub_tag: null,
    ...over,
  };
}

describe('distinctSubTagsInProgram — sub_tag filtering', () => {
  it('excludes empty-string sub_tags (only non-empty are surfaced)', () => {
    const cells: ProgramCell[] = [
      cell({ id: '1', sub_tag: 'heavy' }),
      cell({ id: '2', sub_tag: '' }), // blanked intensity → excluded
      cell({ id: '3', sub_tag: 'light' }),
      cell({ id: '4', sub_tag: '' }), // excluded
    ];
    expect(distinctSubTagsInProgram(cells)).toEqual(['heavy', 'light']);
  });

  it('breaks frequency ties alphabetically', () => {
    // 'bravo' and 'alpha' both appear twice; 'zulu' once. Frequency desc puts
    // the two-count tags first, then alpha orders bravo after alpha.
    const cells: ProgramCell[] = [
      cell({ id: '1', sub_tag: 'bravo' }),
      cell({ id: '2', sub_tag: 'alpha' }),
      cell({ id: '3', sub_tag: 'bravo' }),
      cell({ id: '4', sub_tag: 'alpha' }),
      cell({ id: '5', sub_tag: 'zulu' }),
    ];
    expect(distinctSubTagsInProgram(cells)).toEqual(['alpha', 'bravo', 'zulu']);
  });

  it('returns [] for empty cell list', () => {
    expect(distinctSubTagsInProgram([])).toEqual([]);
  });
});

describe('buildCellMap — duplicate keys', () => {
  it('last cell wins on a duplicate (cycle_index,day_index) key', () => {
    const cells: ProgramCell[] = [
      cell({ id: 'first', cycle_index: 1, day_index: 2, template_id: 't-a' }),
      cell({ id: 'second', cycle_index: 1, day_index: 2, template_id: 't-b' }),
    ];
    const map = buildCellMap(cells);
    expect(map.size).toBe(1);
    expect(map.get('1,2')?.id).toBe('second');
  });
});

describe('formatCellDateLabel — boundary digits', () => {
  it('formats a December 31 date as 12/31 (no padding leak)', () => {
    expect(formatCellDateLabel('2026-12-31')).toBe('12/31');
  });
});
