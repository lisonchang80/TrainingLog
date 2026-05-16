import {
  resolveProgramDefaults,
  type ProgramOption,
} from '../../src/domain/program/resolveProgramDefaults';
import { RESERVED_NONE_PROGRAM_ID } from '../../src/db/seed/v017ProgramNone';

const noneProgram: ProgramOption = { id: RESERVED_NONE_PROGRAM_ID, name: '無' };
const programA: ProgramOption = { id: 'prog-aaa', name: '5x5 強度週' };
const programB: ProgramOption = { id: 'prog-bbb', name: '8x3 肌肥大週' };

describe('resolveProgramDefaults (ADR-0019 §Q9.1a + Q9.2 FB1)', () => {
  it('falls back to 「無」 + null sub_tag when no last-use is recorded (FB1)', () => {
    const out = resolveProgramDefaults({
      programs: [noneProgram, programA],
      subTags: ['10-12RM', '8RM'],
      lastUsedProgramId: null,
      lastUsedSubTag: null,
    });
    expect(out).toEqual({
      period_id: RESERVED_NONE_PROGRAM_ID,
      intensity_id: null,
    });
  });

  it('preserves last-used (program_id, sub_tag) when both still exist', () => {
    const out = resolveProgramDefaults({
      programs: [noneProgram, programA, programB],
      subTags: ['10-12RM', '8RM'],
      lastUsedProgramId: 'prog-aaa',
      lastUsedSubTag: '10-12RM',
    });
    expect(out).toEqual({
      period_id: 'prog-aaa',
      intensity_id: '10-12RM',
    });
  });

  it('falls back to 「無」 when the last-used program_id was deleted', () => {
    const out = resolveProgramDefaults({
      programs: [noneProgram, programB], // programA gone
      subTags: ['10-12RM'],
      lastUsedProgramId: 'prog-aaa',
      lastUsedSubTag: '10-12RM',
    });
    expect(out.period_id).toBe(RESERVED_NONE_PROGRAM_ID);
    // Sub_tag still survives independently — it's a separate dimension.
    expect(out.intensity_id).toBe('10-12RM');
  });

  it('collapses intensity to null when the last-used sub_tag is no longer in the list', () => {
    const out = resolveProgramDefaults({
      programs: [noneProgram, programA],
      subTags: ['8RM'], // '10-12RM' removed
      lastUsedProgramId: 'prog-aaa',
      lastUsedSubTag: '10-12RM',
    });
    expect(out).toEqual({
      period_id: 'prog-aaa',
      intensity_id: null,
    });
  });

  it('handles empty subTags list — intensity_id is null regardless of last-used', () => {
    const out = resolveProgramDefaults({
      programs: [noneProgram, programA],
      subTags: [],
      lastUsedProgramId: 'prog-aaa',
      lastUsedSubTag: 'anything',
    });
    expect(out.intensity_id).toBeNull();
  });

  it('keeps 無 selected when last-used program_id explicitly is RESERVED_NONE_PROGRAM_ID', () => {
    const out = resolveProgramDefaults({
      programs: [noneProgram, programA],
      subTags: ['8RM'],
      lastUsedProgramId: RESERVED_NONE_PROGRAM_ID,
      lastUsedSubTag: null,
    });
    expect(out.period_id).toBe(RESERVED_NONE_PROGRAM_ID);
    expect(out.intensity_id).toBeNull();
  });
});
