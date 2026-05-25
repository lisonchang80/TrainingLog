/**
 * Tests for `src/theme/theme-persist.ts` — ADR-0025.
 *
 * Mirror of `tests/i18n/locale-persist.test.ts`. Coverage:
 *   - save → load round-trip via AsyncStorage mock.
 *   - `resolveTheme('system')` reads RN `Appearance.getColorScheme()`.
 *   - `resolveTheme('system')` accepts a `systemHint` arg to avoid native call.
 *   - Defensive fallbacks: empty storage / malformed value / throw → 'system'.
 *   - Explicit 'light' / 'dark' picks bypass system entirely.
 */

// ---------------------------------------------------------------------------
// Mocks (must be set up before the SUT is imported).
// ---------------------------------------------------------------------------

const memoryStore: Record<string, string> = {};
let throwOnGet = false;

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string): Promise<string | null> => {
      if (throwOnGet) throw new Error('boom');
      return memoryStore[key] ?? null;
    }),
    setItem: jest.fn(async (key: string, value: string): Promise<void> => {
      memoryStore[key] = value;
    }),
  },
}));

type Scheme = 'light' | 'dark' | null;
let mockedScheme: Scheme = 'light';

jest.mock('react-native', () => ({
  __esModule: true,
  Appearance: {
    getColorScheme: jest.fn((): Scheme => mockedScheme),
  },
}));

import {
  loadStoredTheme,
  saveStoredTheme,
  resolveTheme,
} from '../../src/theme/theme-persist';

beforeEach(() => {
  for (const k of Object.keys(memoryStore)) delete memoryStore[k];
  mockedScheme = 'light';
  throwOnGet = false;
});

describe('theme-persist storage round-trip', () => {
  test('saveStoredTheme("dark") then loadStoredTheme() returns "dark"', async () => {
    await saveStoredTheme('dark');
    expect(await loadStoredTheme()).toBe('dark');
  });

  test('saveStoredTheme("light") then loadStoredTheme() returns "light"', async () => {
    await saveStoredTheme('light');
    expect(await loadStoredTheme()).toBe('light');
  });

  test('saveStoredTheme("system") then loadStoredTheme() returns "system"', async () => {
    await saveStoredTheme('system');
    expect(await loadStoredTheme()).toBe('system');
  });

  test('loadStoredTheme defaults to "system" when storage is empty', async () => {
    expect(await loadStoredTheme()).toBe('system');
  });

  test('loadStoredTheme defaults to "system" when stored value is malformed', async () => {
    memoryStore['app.theme.preference'] = 'rainbow';
    expect(await loadStoredTheme()).toBe('system');
  });

  test('loadStoredTheme defaults to "system" when AsyncStorage throws', async () => {
    throwOnGet = true;
    expect(await loadStoredTheme()).toBe('system');
  });
});

describe('resolveTheme system-detect', () => {
  test('"system" with device scheme "dark" resolves to "dark"', () => {
    mockedScheme = 'dark';
    expect(resolveTheme('system')).toBe('dark');
  });

  test('"system" with device scheme "light" resolves to "light"', () => {
    mockedScheme = 'light';
    expect(resolveTheme('system')).toBe('light');
  });

  test('"system" with device scheme null falls back to "light"', () => {
    mockedScheme = null;
    expect(resolveTheme('system')).toBe('light');
  });

  test('systemHint arg overrides Appearance.getColorScheme()', () => {
    mockedScheme = 'light';
    expect(resolveTheme('system', 'dark')).toBe('dark');
    expect(resolveTheme('system', 'light')).toBe('light');
    expect(resolveTheme('system', null)).toBe('light');
  });

  test('explicit "dark" ignores system scheme', () => {
    mockedScheme = 'light';
    expect(resolveTheme('dark')).toBe('dark');
    expect(resolveTheme('dark', 'light')).toBe('dark');
  });

  test('explicit "light" ignores system scheme', () => {
    mockedScheme = 'dark';
    expect(resolveTheme('light')).toBe('light');
    expect(resolveTheme('light', 'dark')).toBe('light');
  });
});
