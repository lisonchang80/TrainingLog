import { localizeDefaultSupersetName } from '../../src/domain/superset/supersetManager';

describe('supersetManager — localizeDefaultSupersetName', () => {
  // Canonical (English) member names as stored on the Exercise rows.
  const A_CANON = 'Bench Press';
  const B_CANON = 'Decline Bench Press';
  // Localized (zh) member names as produced by tExercise().
  const A_ZH = '槓鈴臥推';
  const B_ZH = '下斜臥推';

  it('localizes an auto-default stored name to the localized member names', () => {
    const stored = `${A_CANON} + ${B_CANON}`;
    expect(
      localizeDefaultSupersetName(stored, A_CANON, B_CANON, A_ZH, B_ZH)
    ).toBe(`${A_ZH} + ${B_ZH}`);
  });

  it('returns a user-customized name unchanged', () => {
    const stored = '推日超級組';
    expect(
      localizeDefaultSupersetName(stored, A_CANON, B_CANON, A_ZH, B_ZH)
    ).toBe('推日超級組');
  });

  it('leaves the default untouched when members are already canonical (en locale)', () => {
    const stored = `${A_CANON} + ${B_CANON}`;
    // en locale: localized args equal the canonical names → no-op passthrough.
    expect(
      localizeDefaultSupersetName(stored, A_CANON, B_CANON, A_CANON, B_CANON)
    ).toBe(stored);
  });

  it('does NOT localize a name that only partially matches the default shape', () => {
    // Same members but an extra suffix = user edit; must not be rewritten.
    const stored = `${A_CANON} + ${B_CANON} (熱身)`;
    expect(
      localizeDefaultSupersetName(stored, A_CANON, B_CANON, A_ZH, B_ZH)
    ).toBe(stored);
  });

  it('treats a name that happens to equal one member as customized', () => {
    // Single-name enum edge: storedName === one exercise, not "A + B".
    const stored = A_CANON;
    expect(
      localizeDefaultSupersetName(stored, A_CANON, B_CANON, A_ZH, B_ZH)
    ).toBe(A_CANON);
  });

  it('handles empty string as a non-default (customized) name', () => {
    expect(
      localizeDefaultSupersetName('', A_CANON, B_CANON, A_ZH, B_ZH)
    ).toBe('');
  });
});
