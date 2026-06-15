/**
 * AppModeContext — ADR-0026 「計劃模式 / 極簡模式」app-wide presentation mode.
 *
 * Two responsibilities (mirrors ThemeContext, but SQLite-backed):
 *   1. Hydrate the stored mode on mount via `getAppMode(db)`.
 *   2. Re-render every consumer when the user flips the mode in Settings
 *      (`setMode(...)`), so program-concept surfaces (Programs tab, today's
 *      planned section, pickers) appear / disappear live without a relaunch.
 *
 * WHY inside DatabaseProvider (not at the root like ThemeProvider): the mode
 * lives in `app_settings` (SQLite), so the Provider needs `useDatabase()` —
 * which only resolves below DatabaseProvider. Unlike theme/locale there is NO
 * boot-order constraint: the mode only gates UI that renders well after the DB
 * is open (tabs + screens), and the safe default 'plan' (= today's full app)
 * covers the brief pre-hydration window.
 *
 * Usage:
 *   const { isMinimal } = useAppMode();
 *   if (isMinimal) return null;            // hide a program-concept surface
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

import { useDatabase } from '@/components/database-provider';
import {
  getAppMode,
  setAppMode,
  type AppMode,
} from '@/src/adapters/sqlite/settingsRepository';

interface AppModeContextValue {
  /** Stored mode. Settings reads this to render the radio selection. */
  mode: AppMode;
  /** Convenience flag — `mode === 'minimal'`. */
  isMinimal: boolean;
  /**
   * Persist a new mode + re-render subscribers immediately (optimistic).
   * No-op if `next` === current `mode`.
   */
  setMode: (next: AppMode) => Promise<void>;
}

const AppModeContext = createContext<AppModeContextValue | null>(null);

/**
 * Provider — mount once INSIDE <DatabaseProvider> (db must be open).
 *
 * `mode` starts as 'plan' so the first render before SQLite hydrates shows the
 * full app (the safe, no-surprise default). Once `getAppMode` resolves, the
 * tree re-renders with the user's real pick.
 */
export function AppModeProvider({ children }: { children: ReactNode }) {
  const db = useDatabase();
  const [mode, setModeState] = useState<AppMode>('plan');

  // Hydrate from SQLite on mount. Failure → keep default 'plan' (never trap
  // the user in a half-rendered app over a settings read error).
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const stored = await getAppMode(db);
        if (mounted) setModeState(stored);
      } catch {
        // Defensive — default 'plan' already in place.
      }
    })();
    return () => {
      mounted = false;
    };
  }, [db]);

  const setMode = useCallback(
    async (next: AppMode) => {
      let changed = false;
      setModeState((curr) => {
        changed = curr !== next;
        return next;
      });
      if (!changed) return;
      try {
        await setAppMode(db, next);
      } catch {
        // Defensive — UI already updated; persist failure non-fatal (the read
        // on next launch just falls back to the previous stored value).
      }
    },
    [db],
  );

  const value = useMemo<AppModeContextValue>(
    () => ({ mode, isMinimal: mode === 'minimal', setMode }),
    [mode, setMode],
  );

  return <AppModeContext.Provider value={value}>{children}</AppModeContext.Provider>;
}

/**
 * Hook — call from any component below <AppModeProvider>. Throws if used
 * outside the Provider (a developer mistake — every screen renders inside the
 * root layout's Provider).
 */
export function useAppMode(): AppModeContextValue {
  const ctx = useContext(AppModeContext);
  if (!ctx) {
    throw new Error('useAppMode() must be called inside <AppModeProvider>');
  }
  return ctx;
}
