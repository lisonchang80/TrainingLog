/**
 * UnitContext — app-wide display-unit (kg / lb) preference.
 *
 * Mirrors AppModeContext / ThemeContext, but for the weight display unit.
 * Two responsibilities (SQLite-backed):
 *   1. Hydrate the stored unit on mount via `getUnitPreference(db)`.
 *   2. Re-render every consumer when the user flips the unit in Settings
 *      (`setUnit(...)`), so EVERY weight-showing surface (訓練中 / session 詳情 /
 *      模板編輯器 / body / exercise-history / exercise-chart) switches live
 *      without a relaunch or a per-screen focus re-read.
 *
 * WHY this exists: unit used to be a plain `app_settings` row each screen
 * re-read into its own `useState` on focus. That model silently froze any
 * screen that forgot to re-read (template editor was kg-only; session detail
 * only read on mount). A single reactive context — the same primitive the app
 * already uses for theme + app-mode — removes the whole class of bug.
 *
 * WHY inside DatabaseProvider (not the root like ThemeProvider): the unit lives
 * in SQLite (`app_settings.unit_preference`), so the Provider needs
 * `useDatabase()`, which only resolves below DatabaseProvider. No boot-order
 * constraint — unit only affects UI that renders after the DB is open, and the
 * safe default 'kg' (canonical storage unit) covers the pre-hydration window.
 *
 * Usage:
 *   const { unit } = useUnit();
 *   <SetRowContent unit={unit} … />
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
  getUnitPreference,
  setUnitPreference,
} from '@/src/adapters/sqlite/settingsRepository';
import type { UnitPreference } from '@/src/domain/body/types';

interface UnitContextValue {
  /** Stored display unit. Settings reads this to render the selection. */
  unit: UnitPreference;
  /**
   * Persist a new unit + re-render subscribers immediately (optimistic).
   * No-op if `next` === current `unit`.
   */
  setUnit: (next: UnitPreference) => Promise<void>;
}

const UnitContext = createContext<UnitContextValue | null>(null);

/**
 * Provider — mount once INSIDE <DatabaseProvider> (db must be open).
 *
 * `unit` starts as 'kg' so the first render before SQLite hydrates uses the
 * canonical storage unit (the safe, no-surprise default). Once
 * `getUnitPreference` resolves, the tree re-renders with the user's real pick.
 */
export function UnitProvider({ children }: { children: ReactNode }) {
  const db = useDatabase();
  const [unit, setUnitState] = useState<UnitPreference>('kg');

  // Hydrate from SQLite on mount. Failure → keep default 'kg' (never trap the
  // user showing wrong units over a settings read error; kg is canonical).
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const stored = await getUnitPreference(db);
        if (mounted) setUnitState(stored);
      } catch {
        // Defensive — default 'kg' already in place.
      }
    })();
    return () => {
      mounted = false;
    };
  }, [db]);

  const setUnit = useCallback(
    async (next: UnitPreference) => {
      // Compare against the hook's current `unit` (captured in deps) rather
      // than a render-phase updater flag (double-invoke under StrictMode would
      // run the side effect twice). Settings also guards upstream; defensive.
      if (next === unit) return;
      setUnitState(next);
      try {
        await setUnitPreference(db, next);
      } catch {
        // Defensive — UI already updated; persist failure non-fatal (next
        // launch just falls back to the previous stored value).
      }
    },
    [db, unit],
  );

  const value = useMemo<UnitContextValue>(() => ({ unit, setUnit }), [unit, setUnit]);

  return <UnitContext.Provider value={value}>{children}</UnitContext.Provider>;
}

/**
 * Hook — call from any component below <UnitProvider>. Throws if used outside
 * the Provider (a developer mistake — every screen renders inside the root
 * layout's Provider).
 */
export function useUnit(): UnitContextValue {
  const ctx = useContext(UnitContext);
  if (!ctx) {
    throw new Error('useUnit() must be called inside <UnitProvider>');
  }
  return ctx;
}
