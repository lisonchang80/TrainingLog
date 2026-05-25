/**
 * Edge-case coverage for `src/i18n/locale-persist.ts` (slice 10c #B / Phase 5).
 *
 * The "happy paths" are covered in `tests/i18n/locale-persist.test.ts`. This
 * file adds the defensive branches that boot relies on so a corrupted
 * AsyncStorage entry, a thrown read, or a missing device locale can never
 * crash app startup:
 *
 *   1. `loadStoredLocale` returns 'auto' when AsyncStorage.getItem throws.
 *      (Boot-time guarantee — if storage is corrupted or unavailable, we
 *      must NOT propagate the rejection up to `app/_layout.tsx`.)
 *   2. `loadStoredLocale` returns 'auto' when the stored value is malformed
 *      (e.g. a stray 'fr' or 'klingon' written by a buggy build). The
 *      branch is `if (v === 'zh' || v === 'en' || v === 'auto') return v;
 *      return 'auto';` — easy to regress when extending the union.
 *   3. `resolveLocale('auto')` falls back to 'en' when `getLocales()` returns
 *      an empty array (rare but possible on simulator without language
 *      configured). Triggers the `?? 'en'` fallback at line 65.
 *   4. `resolveLocale('auto')` falls back to 'en' when `languageCode` is
 *      explicitly null (also at line 65; expo-localization types both
 *      "missing" and "null").
 *
 * Regressions any of these would catch:
 *   - Adding a new locale (e.g. 'ja') without updating loadStoredLocale's
 *     allowlist → users on ja device crash to 'auto' silently. Test #2
 *     enforces the strict allowlist convention.
 *   - Removing the try/catch around getItem → boot crashes if AsyncStorage
 *     fails to initialize. Test #1 enforces silent recovery.
 */

// ---------------------------------------------------------------------------
// Mocks (must be set up before the SUT is imported).
// ---------------------------------------------------------------------------

let mockGetItemImpl: (key: string) => Promise<string | null> = async () => null;
let mockSetItemImpl: (k: string, v: string) => Promise<void> = async () => {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn((key: string) => mockGetItemImpl(key)),
    setItem: jest.fn((k: string, v: string) => mockSetItemImpl(k, v)),
  },
}));

type FakeLocale = { languageCode: string | null };
let mockedLocales: FakeLocale[] = [];

jest.mock('expo-localization', () => ({
  __esModule: true,
  getLocales: jest.fn(() => mockedLocales),
}));

import { loadStoredLocale, resolveLocale } from '../../src/i18n/locale-persist';

beforeEach(() => {
  mockGetItemImpl = async () => null;
  mockSetItemImpl = async () => {};
  mockedLocales = [];
});

describe('loadStoredLocale defensive branches', () => {
  test('returns "auto" when AsyncStorage.getItem throws (boot-safe)', async () => {
    mockGetItemImpl = async () => {
      throw new Error('SQLite locked / storage unavailable');
    };
    const got = await loadStoredLocale();
    expect(got).toBe('auto');
  });

  test('returns "auto" when stored value is a malformed locale code (e.g. "fr")', async () => {
    mockGetItemImpl = async () => 'fr';
    const got = await loadStoredLocale();
    expect(got).toBe('auto');
  });

  test('returns "auto" when stored value is an empty string', async () => {
    mockGetItemImpl = async () => '';
    const got = await loadStoredLocale();
    expect(got).toBe('auto');
  });
});

describe('resolveLocale("auto") defensive branches', () => {
  test('falls back to "en" when getLocales() returns an empty array', () => {
    mockedLocales = [];
    expect(resolveLocale('auto')).toBe('en');
  });

  test('falls back to "en" when first locale has languageCode === null', () => {
    mockedLocales = [{ languageCode: null }];
    expect(resolveLocale('auto')).toBe('en');
  });

  test('honors mixed-case zh prefix (e.g. "Zh-Hant") via toLowerCase guard', () => {
    // Defensive — older OS versions or third-party libs might emit
    // 'Zh-Hant' or 'ZH'. The implementation lowercases before the
    // startsWith check so these still resolve to 'zh'.
    mockedLocales = [{ languageCode: 'Zh-Hant' }];
    expect(resolveLocale('auto')).toBe('zh');
    mockedLocales = [{ languageCode: 'ZH' }];
    expect(resolveLocale('auto')).toBe('zh');
  });
});
