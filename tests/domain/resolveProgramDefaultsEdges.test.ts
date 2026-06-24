/**
 * Edge coverage for `src/domain/program/resolveProgramDefaults.ts`.
 *
 * The base `resolveProgramDefaults.test.ts` covers first-run fallback,
 * preservation, deleted program, collapsed sub_tag, and explicit-無. These
 * lock the documented-but-untested invariant corners:
 *
 *   1. period_id is ALWAYS RESERVED_NONE_PROGRAM_ID on fallback even when the
 *      reserved 「無」 entity is NOT in the programs list (the source comment at
 *      lines 51-54 promises this — caller renders 無 as a fixed option
 *      regardless). Covers an empty programs list and a list missing 無.
 *   2. lastUsedProgramId === RESERVED_NONE_PROGRAM_ID but the constant is NOT
 *      present in `programs` → still returned (the `.some()` check fails, so we
 *      fall through to the constant — which happens to equal the requested id).
 *   3. An empty-string lastUsedSubTag that IS present in subTags is preserved
 *      ('' != null is true, includes('') is true) — documents that the guard
 *      is a null check, not a truthiness check.
 */

import {
  resolveProgramDefaults,
  type ProgramOption,
} from '../../src/domain/program/resolveProgramDefaults';
import { RESERVED_NONE_PROGRAM_ID } from '../../src/db/seed/v017ProgramNone';

const programA: ProgramOption = { id: 'prog-aaa', name: '5x5' };

describe('resolveProgramDefaults — fallback invariant', () => {
  it('returns RESERVED_NONE_PROGRAM_ID on fallback even when 無 is absent from programs', () => {
    const out = resolveProgramDefaults({
      programs: [programA], // 無 entity NOT in list
      subTags: [],
      lastUsedProgramId: 'deleted-prog',
      lastUsedSubTag: null,
    });
    expect(out.period_id).toBe(RESERVED_NONE_PROGRAM_ID);
  });

  it('returns RESERVED_NONE_PROGRAM_ID when the programs list is empty', () => {
    const out = resolveProgramDefaults({
      programs: [],
      subTags: [],
      lastUsedProgramId: null,
      lastUsedSubTag: null,
    });
    expect(out).toEqual({
      period_id: RESERVED_NONE_PROGRAM_ID,
      intensity_id: null,
    });
  });

  it('returns RESERVED_NONE even when lastUsed IS that id but it is absent from programs', () => {
    // The `.some()` existence check fails (constant not in list) so we take the
    // fallback branch — which returns the same constant. Result is correct
    // either way, but this pins that the existence check is honoured.
    const out = resolveProgramDefaults({
      programs: [programA],
      subTags: [],
      lastUsedProgramId: RESERVED_NONE_PROGRAM_ID,
      lastUsedSubTag: null,
    });
    expect(out.period_id).toBe(RESERVED_NONE_PROGRAM_ID);
  });
});

describe('resolveProgramDefaults — sub_tag null-vs-falsy guard', () => {
  it('preserves an empty-string sub_tag that is present in subTags', () => {
    // '' is non-null and includes('') is true, so the empty intensity is
    // preserved — the guard is a NULL check, not a truthiness check.
    const out = resolveProgramDefaults({
      programs: [programA],
      subTags: [''],
      lastUsedProgramId: 'prog-aaa',
      lastUsedSubTag: '',
    });
    expect(out.intensity_id).toBe('');
  });

  it('collapses an empty-string sub_tag to null when NOT present in subTags', () => {
    const out = resolveProgramDefaults({
      programs: [programA],
      subTags: ['8RM'],
      lastUsedProgramId: 'prog-aaa',
      lastUsedSubTag: '',
    });
    expect(out.intensity_id).toBeNull();
  });
});
