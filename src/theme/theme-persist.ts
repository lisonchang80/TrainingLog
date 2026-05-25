/**
 * Theme preference persistence + resolver — ADR-0025 § "Preference 持久化"
 *
 * Mirrors the i18n locale-persist pattern (ADR-0023). Three responsibilities:
 *   1. Load/save the user's stored theme preference from AsyncStorage.
 *   2. Resolve the stored value into a concrete `'light' | 'dark'` via:
 *      - explicit user pick (`'light'` / `'dark'`) → use as-is
 *      - `'system'` → read RN `Appearance.getColorScheme()`; null fallback
 *        to `'light'` (matches RN's own default behavior on first render).
 *   3. Surface a `'system' | 'light' | 'dark'` tri-state to the Settings UI
 *      so it can render the radio with the right option selected.
 *
 * Module is intentionally side-effect-free at import time. App boot calls
 * `loadStoredTheme` → `resolveTheme` → `setTheme(...)` (the latter happens
 * via ThemeContext) once at boot, after which the Provider re-resolves
 * automatically whenever the system appearance changes (handled by RN's
 * `useColorScheme()` hook).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Appearance, type ColorSchemeName } from 'react-native';

/** Tri-state stored value: explicit user pick or `'system'` for device-follow. */
export type StoredThemeValue = 'system' | 'light' | 'dark';

/** Concrete theme used by the token resolver. `'system'` is never one of these. */
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'app.theme.preference';

/**
 * Read the stored preference. Returns `'system'` if nothing is stored, the
 * value is malformed, or AsyncStorage throws (defensive — never crash boot
 * on a theme read failure).
 */
export async function loadStoredTheme(): Promise<StoredThemeValue> {
  try {
    const v = await AsyncStorage.getItem(STORAGE_KEY);
    if (v === 'system' || v === 'light' || v === 'dark') return v;
    return 'system';
  } catch {
    return 'system';
  }
}

/**
 * Persist the user's pick. Caller (Settings UI) is expected to follow up
 * with a Context state update so the UI re-renders immediately —
 * AsyncStorage write is fire-and-forget from the user's perspective.
 */
export async function saveStoredTheme(value: StoredThemeValue): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, value);
}

/**
 * Map the tri-state stored value to a concrete theme.
 *
 * - `'light'` / `'dark'` — return directly.
 * - `'system'` — read RN `Appearance.getColorScheme()`. `null` (uncommon —
 *   occurs on first render before native module hydrates) falls back to
 *   `'light'`. Caller in ThemeContext uses the `useColorScheme()` hook
 *   instead, which re-renders on system change; this helper exists for
 *   non-React contexts (tests, future boot-order calls).
 *
 * Second argument lets the ThemeContext pass in the live `useColorScheme()`
 * value so we don't double-read native module state in the React path.
 */
export function resolveTheme(
  stored: StoredThemeValue,
  systemHint?: ColorSchemeName,
): ResolvedTheme {
  if (stored === 'light') return 'light';
  if (stored === 'dark') return 'dark';
  // 'system' branch
  const scheme = systemHint !== undefined ? systemHint : Appearance.getColorScheme();
  return scheme === 'dark' ? 'dark' : 'light';
}
