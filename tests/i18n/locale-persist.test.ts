/**
 * Tests for `src/i18n/locale-persist.ts`.
 *
 * Coverage:
 *   - save → load round-trip via AsyncStorage mock.
 *   - `resolveLocale('auto')` maps zh-* device locale → 'zh'.
 *   - `resolveLocale('auto')` maps non-zh device locale (e.g. 'fr') → 'en'.
 *
 * We mock both `@react-native-async-storage/async-storage` and
 * `expo-localization` so the test environment (node, no native bindings)
 * stays self-contained. Each test can override the mock per-case.
 */

// ---------------------------------------------------------------------------
// Mocks (must be set up before the SUT is imported).
// ---------------------------------------------------------------------------

const memoryStore: Record<string, string> = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string): Promise<string | null> => {
      return memoryStore[key] ?? null;
    }),
    setItem: jest.fn(async (key: string, value: string): Promise<void> => {
      memoryStore[key] = value;
    }),
  },
}));

type FakeLocale = { languageCode: string | null };
let mockedLocales: FakeLocale[] = [{ languageCode: 'en' }];

jest.mock('expo-localization', () => ({
  __esModule: true,
  getLocales: jest.fn(() => mockedLocales),
}));

import {
  loadStoredLocale,
  saveStoredLocale,
  resolveLocale,
} from '../../src/i18n/locale-persist';

beforeEach(() => {
  for (const k of Object.keys(memoryStore)) delete memoryStore[k];
  mockedLocales = [{ languageCode: 'en' }];
});

describe('locale-persist storage round-trip', () => {
  test('saveStoredLocale("zh") then loadStoredLocale() returns "zh"', async () => {
    await saveStoredLocale('zh');
    const got = await loadStoredLocale();
    expect(got).toBe('zh');
  });

  test('loadStoredLocale defaults to "auto" when storage is empty', async () => {
    const got = await loadStoredLocale();
    expect(got).toBe('auto');
  });
});

describe('resolveLocale auto-detect', () => {
  test('"auto" with device languageCode "zh" resolves to "zh"', () => {
    mockedLocales = [{ languageCode: 'zh' }];
    expect(resolveLocale('auto')).toBe('zh');
  });

  test('"auto" with device languageCode "zh-Hant" prefix resolves to "zh"', () => {
    mockedLocales = [{ languageCode: 'zh-Hant' }];
    expect(resolveLocale('auto')).toBe('zh');
  });

  test('"auto" with device languageCode "fr" resolves to "en"', () => {
    mockedLocales = [{ languageCode: 'fr' }];
    expect(resolveLocale('auto')).toBe('en');
  });

  test('explicit "en" overrides device locale', () => {
    mockedLocales = [{ languageCode: 'zh' }];
    expect(resolveLocale('en')).toBe('en');
  });

  test('explicit "zh" overrides device locale', () => {
    mockedLocales = [{ languageCode: 'fr' }];
    expect(resolveLocale('zh')).toBe('zh');
  });
});
