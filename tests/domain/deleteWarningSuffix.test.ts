import {
  computeDeleteWarningSuffix,
  type DeleteWarningMessages,
} from '../../src/domain/session/deleteWarningSuffix';

/**
 * Delete-confirmation warning suffix (big-file health #8 dedup, 2026-06-02).
 * Extracted from the 4 identical inline copies (Today + session-detail, each
 * cluster + solo). The i18n message pair is injected; tests use tagged stubs so
 * the branch decision is asserted independently of locale.
 */

const msg: DeleteWarningMessages = {
  withLogged: (total, logged) => `WL(${total},${logged})`,
  unfinished: (total) => `UF(${total})`,
};

const set = (is_logged: number) => ({ is_logged });

describe('computeDeleteWarningSuffix', () => {
  it('empty set list → empty string (no warning)', () => {
    expect(computeDeleteWarningSuffix([], msg)).toBe('');
  });

  it('sets exist but none logged → unfinished(total)', () => {
    expect(computeDeleteWarningSuffix([set(0), set(0), set(0)], msg)).toBe('UF(3)');
  });

  it('at least one logged set → withLogged(total, loggedCount)', () => {
    expect(computeDeleteWarningSuffix([set(1), set(0), set(0)], msg)).toBe('WL(3,1)');
  });

  it('all sets logged → withLogged(total, total)', () => {
    expect(computeDeleteWarningSuffix([set(1), set(1)], msg)).toBe('WL(2,2)');
  });

  it('single unlogged set → unfinished(1)', () => {
    expect(computeDeleteWarningSuffix([set(0)], msg)).toBe('UF(1)');
  });

  it('only is_logged === 1 counts as logged (other truthy-ish values ignored)', () => {
    // is_logged is a 0/1 column; guard the strict === 1 check.
    expect(computeDeleteWarningSuffix([set(2), set(0)], msg)).toBe('UF(2)');
  });

  it('logged-vs-unfinished precedence: one logged among many wins withLogged', () => {
    expect(
      computeDeleteWarningSuffix([set(0), set(0), set(1), set(0)], msg),
    ).toBe('WL(4,1)');
  });
});
