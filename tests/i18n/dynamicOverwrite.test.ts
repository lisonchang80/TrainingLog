/**
 * Tests for the two wave-18g overwrite-related dynamic i18n helpers added
 * 2026-05-22 that the existing `dynamic.test.ts` did not import.
 *
 *   - `tOverwriteBannerTitle(programName)` — Step 1 / Step 6 inline banner
 *   - `tOverwriteBlockedByActiveSession(programName)` — Alert body when
 *     overwriteProgram throws PROGRAM_HAS_ACTIVE_SESSION
 *
 * Lives in a separate file so the wave-18g sweep stays additive (does not
 * race with Agent A/B's i18n append-only protocol on the parent file).
 */

import { setLocale } from '../../src/i18n/strings';
import {
  tOverwriteBannerTitle,
  tOverwriteBlockedByActiveSession,
} from '../../src/i18n/dynamic';

afterEach(() => {
  setLocale('zh');
});

describe('tOverwriteBannerTitle (wave 18g)', () => {
  test('zh — wraps program name in 「 」', () => {
    expect(tOverwriteBannerTitle('Hypertrophy-Q1')).toBe(
      '將覆蓋既有計劃「Hypertrophy-Q1」',
    );
  });

  test('en — wraps program name in straight double quotes', () => {
    setLocale('en');
    expect(tOverwriteBannerTitle('Hypertrophy-Q1')).toBe(
      'Will overwrite existing program "Hypertrophy-Q1"',
    );
  });

  test('passes through CJK name verbatim', () => {
    expect(tOverwriteBannerTitle('增肌週期')).toBe(
      '將覆蓋既有計劃「增肌週期」',
    );
    setLocale('en');
    expect(tOverwriteBannerTitle('增肌週期')).toBe(
      'Will overwrite existing program "增肌週期"',
    );
  });

  test('passes through empty / whitespace-only names without crashing', () => {
    expect(tOverwriteBannerTitle('')).toBe('將覆蓋既有計劃「」');
    setLocale('en');
    expect(tOverwriteBannerTitle('')).toBe(
      'Will overwrite existing program ""',
    );
  });
});

describe('tOverwriteBlockedByActiveSession (wave 18g)', () => {
  test('zh — name wrapped in 「 」 + correct guidance', () => {
    expect(tOverwriteBlockedByActiveSession('Push/Pull/Legs')).toBe(
      '「Push/Pull/Legs」有進行中的 session，請先完成或捨棄。',
    );
  });

  test('en — name wrapped in straight double quotes', () => {
    setLocale('en');
    expect(tOverwriteBlockedByActiveSession('Push/Pull/Legs')).toBe(
      '"Push/Pull/Legs" has an in-progress session. Please finish or discard it first.',
    );
  });

  test('passes through CJK name verbatim', () => {
    expect(tOverwriteBlockedByActiveSession('增肌')).toBe(
      '「增肌」有進行中的 session，請先完成或捨棄。',
    );
  });

  test('handles names containing quote characters (no escaping required)', () => {
    // Defensive: the helper does not escape anything — assert behavior is
    // pass-through so callers know there's no surprise interpolation.
    setLocale('en');
    expect(tOverwriteBlockedByActiveSession('A "B" C')).toContain('A "B" C');
  });
});
