import {
  resolveAutoClassify,
  type AutoClassifyInput,
} from '../../../src/domain/template/resolveAutoClassify';

// A valid, attachable global sticky pointing at a live program + intensity.
const base: AutoClassifyInput = {
  storedProgramId: 'prog-pull',
  storedSubTag: 'T1',
  isNoneProgram: false,
  programExists: true,
  tripleCollision: false,
};

describe('resolveAutoClassify', () => {
  it('attaches the stored (program, sub_tag) when all conditions hold', () => {
    expect(resolveAutoClassify(base)).toEqual({
      program_id: 'prog-pull',
      sub_tag: 'T1',
    });
  });

  it('attaches with a null sub_tag (program but no intensity)', () => {
    expect(resolveAutoClassify({ ...base, storedSubTag: null })).toEqual({
      program_id: 'prog-pull',
      sub_tag: null,
    });
  });

  it('returns null when no global sticky is recorded yet (first run)', () => {
    expect(
      resolveAutoClassify({ ...base, storedProgramId: null }),
    ).toBeNull();
  });

  it('returns null when the stored program is the reserved 通用/「無」 sentinel', () => {
    expect(resolveAutoClassify({ ...base, isNoneProgram: true })).toBeNull();
  });

  it('returns null when the stored program was since deleted (not in list)', () => {
    expect(resolveAutoClassify({ ...base, programExists: false })).toBeNull();
  });

  it('returns null on a triple collision (honours dup-triple boundary 拍板)', () => {
    expect(resolveAutoClassify({ ...base, tripleCollision: true })).toBeNull();
  });

  it('a null program wins over every other flag (no spurious attach)', () => {
    // Even if every other input looks attachable, a null program → 通用.
    expect(
      resolveAutoClassify({
        storedProgramId: null,
        storedSubTag: 'T1',
        isNoneProgram: false,
        programExists: true,
        tripleCollision: false,
      }),
    ).toBeNull();
  });
});
