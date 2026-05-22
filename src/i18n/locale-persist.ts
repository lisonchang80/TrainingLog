/**
 * Locale persistence + auto-detect resolver — Phase 5 of the i18n migration.
 *
 * Three responsibilities:
 *   1. Load/save the user's stored locale preference from AsyncStorage.
 *   2. Resolve the stored value into a concrete `'zh' | 'en'` via:
 *      - explicit user pick (`'zh'` / `'en'`) → use as-is
 *      - `'auto'` → read `expo-localization` device locale, map `zh*` → 'zh',
 *        everything else → 'en'.
 *   3. Surface a `'zh' | 'en' | 'auto'` tri-state to the Settings UI so it
 *      can render the toggle with the right radio selected.
 *
 * Module is intentionally side-effect-free at import time. App boot calls
 * `loadStoredLocale` → `resolveLocale` → `setLocale(...)` once, after which
 * `t()` returns the user's chosen language.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Localization from 'expo-localization';

/** Tri-state stored value: explicit user pick or `'auto'` for device-follow. */
export type StoredLocaleValue = 'zh' | 'en' | 'auto';

/** Concrete locale used by `setLocale()`. `'auto'` is never one of these. */
export type ResolvedLocale = 'zh' | 'en';

const STORAGE_KEY = 'app.locale.preference';

/**
 * Read the stored preference. Returns `'auto'` if nothing is stored, the value
 * is malformed, or AsyncStorage throws (defensive — never crash boot on a
 * locale read failure).
 */
export async function loadStoredLocale(): Promise<StoredLocaleValue> {
  try {
    const v = await AsyncStorage.getItem(STORAGE_KEY);
    if (v === 'zh' || v === 'en' || v === 'auto') return v;
    return 'auto';
  } catch {
    return 'auto';
  }
}

/**
 * Persist the user's pick. Caller is expected to follow up with
 * `setLocale(resolveLocale(value))` so the UI re-renders immediately —
 * AsyncStorage write is fire-and-forget from the user's perspective.
 */
export async function saveStoredLocale(value: StoredLocaleValue): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, value);
}

/**
 * Map the tri-state stored value to a concrete locale.
 *
 * - `'zh'` / `'en'` — return directly.
 * - `'auto'` — read `expo-localization` device locale. Any `zh*` languageCode
 *   (`zh`, `zh-TW`, `zh-Hant`, …) maps to `'zh'`; anything else falls back
 *   to `'en'`. The current product locales are zh-Hant + en, so this is a
 *   strict binary partition.
 */
export function resolveLocale(stored: StoredLocaleValue): ResolvedLocale {
  if (stored === 'zh') return 'zh';
  if (stored === 'en') return 'en';
  const locales = Localization.getLocales();
  const code = locales[0]?.languageCode ?? 'en';
  return code.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}
