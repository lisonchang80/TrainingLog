/**
 * ThemeContext — ADR-0025 § "Boot order" + "`'system'` 模式 live update"
 *
 * Wraps the entire app at the root layout. Two responsibilities:
 *   1. Hydrate the stored preference on mount via `loadStoredTheme()`.
 *   2. Re-resolve `tokens` whenever either:
 *      a. The user picks a new preference in Settings (`setStored(...)`)
 *      b. The device color scheme changes (live update via `useColorScheme()`)
 *
 * `'system'` mode tracks the OS scheme reactively via RN's `useColorScheme()`
 * hook (re-renders on Control Center toggle). Explicit `'light'` / `'dark'`
 * picks ignore the OS scheme.
 *
 * Usage:
 *   const { tokens, stored, setStored } = useTheme();
 *   <View style={{ backgroundColor: tokens.bg.base }}>
 *     <Text style={{ color: tokens.text.primary }}>…</Text>
 *   </View>
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { themeTokens, type ThemeTokens } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

import {
  loadStoredTheme,
  resolveTheme,
  saveStoredTheme,
  type ResolvedTheme,
  type StoredThemeValue,
} from './theme-persist';

interface ThemeContextValue {
  /** Currently active token set (already mode-resolved). */
  tokens: ThemeTokens;
  /** Resolved concrete mode (for code that needs to branch on light/dark). */
  resolved: ResolvedTheme;
  /** Tri-state stored preference. Settings UI reads this to render radios. */
  stored: StoredThemeValue;
  /**
   * Update the stored preference. Persists to AsyncStorage and re-renders
   * subscribers immediately. No-op if `next` === current `stored`.
   */
  setStored: (next: StoredThemeValue) => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Provider — mount once at the root layout (above `<Stack>`).
 *
 * `stored` starts as `'system'` so that the first render before AsyncStorage
 * hydrates falls back to system scheme (which `useColorScheme()` already
 * gives us). This avoids a flash of unstyled content even before the
 * async load completes.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [stored, setStoredState] = useState<StoredThemeValue>('system');
  const systemScheme = useColorScheme();

  // Hydrate from AsyncStorage on mount. Failure → keep default 'system'.
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const v = await loadStoredTheme();
        if (mounted) setStoredState(v);
      } catch {
        // Defensive — never crash boot on theme load failure.
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const resolved = useMemo(
    () => resolveTheme(stored, systemScheme),
    [stored, systemScheme],
  );

  const tokens = themeTokens[resolved];

  const setStored = useCallback(async (next: StoredThemeValue) => {
    setStoredState((curr) => (curr === next ? curr : next));
    try {
      await saveStoredTheme(next);
    } catch {
      // Defensive — UI already updated, persist failure non-fatal.
    }
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ tokens, resolved, stored, setStored }),
    [tokens, resolved, stored, setStored],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Hook — call from any component below `<ThemeProvider>` to access the
 * current tokens + preference. Throws if used outside the Provider (which
 * would mean a developer mistake — every screen should be inside the
 * root layout's Provider).
 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme() must be called inside <ThemeProvider>');
  }
  return ctx;
}
