/**
 * `useLocale` — React hook that subscribes a component to locale changes.
 *
 * The i18n layer keeps the active locale as a module-level singleton (see
 * `strings.ts`), so plain `t(...)` / `tExercise(...)` calls read it without
 * any React wiring. The downside is that changing the locale via `setLocale()`
 * mutates the singleton but does NOT, by itself, re-render anything.
 *
 * This hook closes that gap. It reads the locale "version" counter through
 * `useSyncExternalStore`, so any component that calls `useLocale()` re-renders
 * the moment the locale changes. The root layout uses it to re-key the
 * navigator, which remounts the whole screen tree → every screen picks up the
 * new language immediately, no app restart required.
 *
 * Return value is the concrete active locale (`'zh' | 'en'`) for convenience,
 * but most consumers only need the re-render side effect.
 */
import { useSyncExternalStore } from 'react';

import { getLocale, getLocaleVersion, subscribeLocale, type Locale } from './strings';

/**
 * Subscribe to the active locale. Re-renders the calling component whenever
 * `setLocale()` changes the language.
 *
 * @example
 *   // Force the whole tree to remount on language change:
 *   const locale = useLocale();
 *   return <Stack key={locale} />;
 */
export function useLocale(): Locale {
  // The version counter is the change signal; we return getLocale() (the actual
  // locale string) so callers can key on it directly. getServerSnapshot mirrors
  // getSnapshot — there's no SSR in this RN app, but the hook contract wants it.
  useSyncExternalStore(subscribeLocale, getLocaleVersion, getLocaleVersion);
  return getLocale();
}
