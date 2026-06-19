/**
 * AchievementsEnabledContext — slice 17 「關閉獎章系統」app-wide toggle.
 *
 * Mirrors AppModeContext / ThemeContext, SQLite-backed:
 *   1. Hydrate the stored flag on mount via `getAchievementsEnabled(db)`.
 *   2. Re-render every consumer when the user flips it in Settings
 *      (`setEnabled(...)`), so the 獎章 sub-tab + the in-session 🏆 PR banner
 *      appear / disappear live without a relaunch.
 *
 * WHY inside DatabaseProvider (not at the root like ThemeProvider): the flag
 * lives in `app_settings` (SQLite), so the Provider needs `useDatabase()`.
 * There is NO boot-order constraint — the flag only gates UI that renders
 * well after the DB is open, and the safe default `true` (= system on, today's
 * behaviour) covers the brief pre-hydration window.
 *
 * Decision boundary (ADR-0009 amend): the toggle is UI-ONLY. Background
 * achievement evaluation keeps running regardless, so turning it back on
 * shows the correct unlock state with no backfill.
 *
 * Usage:
 *   const { enabled } = useAchievementsEnabled();
 *   if (!enabled) return null;   // hide an achievement/PR surface
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
  getAchievementsEnabled,
  setAchievementsEnabled,
} from '@/src/adapters/sqlite/settingsRepository';

interface AchievementsEnabledContextValue {
  /** Stored flag. Settings reads this to render the Switch. */
  enabled: boolean;
  /** Persist a new value + re-render subscribers immediately (optimistic). */
  setEnabled: (next: boolean) => Promise<void>;
}

const AchievementsEnabledContext =
  createContext<AchievementsEnabledContextValue | null>(null);

/**
 * Provider — mount once INSIDE <DatabaseProvider> (db must be open).
 *
 * `enabled` starts `true` so the first render before SQLite hydrates shows the
 * achievement surfaces (the safe, no-surprise default). Once
 * `getAchievementsEnabled` resolves, the tree re-renders with the real value.
 */
export function AchievementsEnabledProvider({ children }: { children: ReactNode }) {
  const db = useDatabase();
  const [enabled, setEnabledState] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const stored = await getAchievementsEnabled(db);
        if (mounted) setEnabledState(stored);
      } catch {
        // Defensive — default `true` already in place.
      }
    })();
    return () => {
      mounted = false;
    };
  }, [db]);

  const setEnabled = useCallback(
    async (next: boolean) => {
      let changed = false;
      setEnabledState((curr) => {
        changed = curr !== next;
        return next;
      });
      if (!changed) return;
      try {
        await setAchievementsEnabled(db, next);
      } catch {
        // Defensive — UI already updated; persist failure non-fatal (next
        // launch's read just falls back to the previous stored value).
      }
    },
    [db]
  );

  const value = useMemo<AchievementsEnabledContextValue>(
    () => ({ enabled, setEnabled }),
    [enabled, setEnabled]
  );

  return (
    <AchievementsEnabledContext.Provider value={value}>
      {children}
    </AchievementsEnabledContext.Provider>
  );
}

/**
 * Hook — call from any component below <AchievementsEnabledProvider>. Throws
 * if used outside the Provider (a developer mistake — every screen renders
 * inside the root layout's Provider).
 */
export function useAchievementsEnabled(): AchievementsEnabledContextValue {
  const ctx = useContext(AchievementsEnabledContext);
  if (!ctx) {
    throw new Error(
      'useAchievementsEnabled() must be called inside <AchievementsEnabledProvider>'
    );
  }
  return ctx;
}
