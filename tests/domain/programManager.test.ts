import {
  cellForDate,
  cycleDayToDate,
  dateToCycleDay,
  expandWizardDraft,
  isoDateToUtcMs,
  resolveProgramLabel,
  todayCell,
  utcMsToIsoDate,
  validateProgram,
} from '../../src/domain/program/programManager';
import type { ProgramCore } from '../../src/domain/program/types';

const PROGRAM: ProgramCore = {
  id: 'p1',
  name: '增肌-Q1',
  main_tag: '增肌',
  cycle_length: 7,
  cycle_count: 4,
  start_date: '2026-05-01',
  is_active: 1,
};

describe('programManager — calendar arithmetic', () => {
  it('isoDateToUtcMs / utcMsToIsoDate are inverse', () => {
    expect(utcMsToIsoDate(isoDateToUtcMs('2026-05-01'))).toBe('2026-05-01');
    expect(utcMsToIsoDate(isoDateToUtcMs('2026-12-31'))).toBe('2026-12-31');
  });

  it('throws on bad ISO date input', () => {
    expect(() => isoDateToUtcMs('not-a-date')).toThrow();
    expect(() => isoDateToUtcMs('2026/05/01')).toThrow();
  });

  it('Day 0 maps to (0, 0)', () => {
    expect(
      dateToCycleDay({
        start_date: '2026-05-01',
        cycle_length: 7,
        cycle_count: 4,
        date: '2026-05-01',
      })
    ).toEqual({ cycle_index: 0, day_index: 0 });
  });

  it('returns null for dates before start', () => {
    expect(
      dateToCycleDay({
        start_date: '2026-05-01',
        cycle_length: 7,
        cycle_count: 4,
        date: '2026-04-30',
      })
    ).toBeNull();
  });

  it('crosses cycle boundary correctly', () => {
    // Day 7 = first day of cycle 2 (cycle_index=1, day_index=0).
    expect(
      dateToCycleDay({
        start_date: '2026-05-01',
        cycle_length: 7,
        cycle_count: 4,
        date: '2026-05-08',
      })
    ).toEqual({ cycle_index: 1, day_index: 0 });
    // Day 13 = last day of cycle 2 (cycle_index=1, day_index=6).
    expect(
      dateToCycleDay({
        start_date: '2026-05-01',
        cycle_length: 7,
        cycle_count: 4,
        date: '2026-05-14',
      })
    ).toEqual({ cycle_index: 1, day_index: 6 });
  });

  it('returns null after final cycle ends', () => {
    // 4 × 7 = 28 days; day 28 is past the program (cycle_index=4 ≥ count=4).
    expect(
      dateToCycleDay({
        start_date: '2026-05-01',
        cycle_length: 7,
        cycle_count: 4,
        date: '2026-05-29',
      })
    ).toBeNull();
  });

  it('cycleDayToDate is the inverse of dateToCycleDay', () => {
    const original = '2026-05-15';
    const cd = dateToCycleDay({
      start_date: PROGRAM.start_date,
      cycle_length: PROGRAM.cycle_length,
      cycle_count: PROGRAM.cycle_count,
      date: original,
    });
    expect(cd).not.toBeNull();
    if (!cd) return;
    expect(
      cycleDayToDate({
        start_date: PROGRAM.start_date,
        cycle_length: PROGRAM.cycle_length,
        cycle_index: cd.cycle_index,
        day_index: cd.day_index,
      })
    ).toBe(original);
  });

  it('handles 5-day cycle', () => {
    // 5-day bro split. Day 5 = (1,0), day 6 = (1,1).
    expect(
      dateToCycleDay({
        start_date: '2026-05-01',
        cycle_length: 5,
        cycle_count: 4,
        date: '2026-05-06',
      })
    ).toEqual({ cycle_index: 1, day_index: 0 });
  });
});

describe('programManager — validateProgram', () => {
  it('accepts a valid program', () => {
    expect(validateProgram(PROGRAM)).toBeNull();
  });
  it('rejects empty name', () => {
    expect(validateProgram({ ...PROGRAM, name: '' })).toMatch(/name/);
    expect(validateProgram({ ...PROGRAM, name: '   ' })).toMatch(/name/);
  });
  it('rejects cycle_length out of [3,14]', () => {
    expect(validateProgram({ ...PROGRAM, cycle_length: 2 })).toMatch(/cycle_length/);
    expect(validateProgram({ ...PROGRAM, cycle_length: 15 })).toMatch(/cycle_length/);
    expect(validateProgram({ ...PROGRAM, cycle_length: 7.5 })).toMatch(/cycle_length/);
  });
  it('rejects cycle_count < 1', () => {
    expect(validateProgram({ ...PROGRAM, cycle_count: 0 })).toMatch(/cycle_count/);
    expect(validateProgram({ ...PROGRAM, cycle_count: -1 })).toMatch(/cycle_count/);
  });
  it('rejects malformed start_date', () => {
    expect(validateProgram({ ...PROGRAM, start_date: '2026-5-1' })).toMatch(/start_date/);
    expect(validateProgram({ ...PROGRAM, start_date: 'today' })).toMatch(/start_date/);
  });
});

describe('programManager — expandWizardDraft', () => {
  it('emits exactly cycle_count × cycle_length cells', () => {
    let n = 0;
    const cells = expandWizardDraft({
      program: PROGRAM,
      dayPlans: [
        { day_index: 0, template_id: 't1', sub_tag: '10RM' },
        { day_index: 2, template_id: 't2', sub_tag: '8RM' },
      ],
      uuid: () => `u${n++}`,
    });
    expect(cells).toHaveLength(PROGRAM.cycle_count * PROGRAM.cycle_length);
  });

  it('fans the same dayPlans across every cycle', () => {
    let n = 0;
    const cells = expandWizardDraft({
      program: { ...PROGRAM, cycle_count: 3 },
      dayPlans: [{ day_index: 1, template_id: 't1', sub_tag: '10RM' }],
      uuid: () => `u${n++}`,
    });
    const day1Cells = cells.filter((c) => c.day_index === 1);
    expect(day1Cells).toHaveLength(3);
    expect(day1Cells.every((c) => c.template_id === 't1')).toBe(true);
    expect(day1Cells.every((c) => c.sub_tag === '10RM')).toBe(true);
  });

  it('overrides take priority over dayPlan defaults', () => {
    let n = 0;
    const cells = expandWizardDraft({
      program: PROGRAM,
      dayPlans: [{ day_index: 0, template_id: 't1', sub_tag: '10RM' }],
      overrides: [{ cycle_index: 1, day_index: 0, sub_tag: '8RM' }],
      uuid: () => `u${n++}`,
    });
    expect(
      cells.find((c) => c.cycle_index === 0 && c.day_index === 0)?.sub_tag
    ).toBe('10RM');
    expect(
      cells.find((c) => c.cycle_index === 1 && c.day_index === 0)?.sub_tag
    ).toBe('8RM');
  });

  it('emits null sub_tag for rest cells', () => {
    let n = 0;
    const cells = expandWizardDraft({
      program: PROGRAM,
      dayPlans: [{ day_index: 0, template_id: 't1', sub_tag: '10RM' }],
      uuid: () => `u${n++}`,
    });
    // Day 1 has no plan → rest cell, should have null template_id and null sub_tag.
    const rest = cells.find((c) => c.cycle_index === 0 && c.day_index === 1);
    expect(rest?.template_id).toBeNull();
    expect(rest?.sub_tag).toBeNull();
  });
});

describe('programManager — cellForDate / todayCell', () => {
  it('finds the cell matching a date', () => {
    let n = 0;
    const cells = expandWizardDraft({
      program: PROGRAM,
      dayPlans: [{ day_index: 0, template_id: 't1', sub_tag: '10RM' }],
      uuid: () => `u${n++}`,
    });
    const cell = cellForDate({
      program: PROGRAM,
      cells,
      date: '2026-05-08', // cycle 2, day 0
    });
    expect(cell).not.toBeNull();
    expect(cell?.cycle_index).toBe(1);
    expect(cell?.day_index).toBe(0);
    expect(cell?.template_id).toBe('t1');
  });

  it('todayCell returns null for null active program', () => {
    expect(todayCell({ active: null, today: '2026-05-08' })).toBeNull();
  });
});

// Slice 10b — RESERVED_NONE_PROGRAM_ID seed label resolution
// (ADR-0019 § (N1) + slice 10a v017 seed).
describe('programManager — resolveProgramLabel', () => {
  it('returns the program name when a real program is given', () => {
    expect(resolveProgramLabel({ name: '增肌-Q1' })).toBe('增肌-Q1');
  });

  it('returns the sentinel name 「無」 when the seed program is given', () => {
    // Sentinel row's name is also '無' per slice 10a Q1+Q1b 拍板 — the helper
    // simply forwards the name; no special-case branch needed.
    expect(resolveProgramLabel({ name: '無' })).toBe('無');
  });

  it('falls back to 「無」 for null/undefined (legacy data with no row joined)', () => {
    expect(resolveProgramLabel(null)).toBe('無');
    expect(resolveProgramLabel(undefined)).toBe('無');
  });
});
