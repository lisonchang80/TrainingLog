/**
 * OnboardingContext — ADR-0029 新使用者首啟引導 gate + lifecycle.
 *
 * Mirrors AppModeContext (SQLite-backed, mounts inside DatabaseProvider). Owns
 * the single「should the wizard be showing?」state:
 *
 *   status 'loading' → hydrating from SQLite (blank themed frame, no flash)
 *   status 'active'  → OnboardingGate renders <OnboardingWizard/>
 *   status 'done'    → OnboardingGate renders the app (the Stack)
 *
 * Trigger (see shouldShowOnboarding): show only when the flag is unset AND the
 * DB has no user session — a genuinely fresh install. Existing users upgrading
 * to this build and restored backups have data → the provider back-fills the
 * flag `true` and skips (ADR-0029 D1 refinement, discovered during impl).
 *
 * `restart()` re-shows the wizard in-memory WITHOUT clearing the flag (Settings
 * 「重新查看新手引導」): re-running never resets the user's existing mode / HK /
 * body data, it just walks the flow again.
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
  getOnboardingCompleted,
  setOnboardingCompleted,
} from '@/src/adapters/sqlite/settingsRepository';
import { hasAnySession } from '@/src/adapters/sqlite/sessionRepository';
import { shouldShowOnboarding } from '@/src/domain/onboarding/onboardingFlow';

type OnboardingStatus = 'loading' | 'active' | 'done';

interface OnboardingContextValue {
  /** Gate render decision — see status doc above. */
  status: OnboardingStatus;
  /** Persist completed=true + dismiss the wizard (finish OR skip). */
  finish: () => Promise<void>;
  /** Re-show the wizard (Settings re-run). In-memory only — does NOT touch
   *  the persisted flag, so an abandoned re-run leaves completed=true. */
  restart: () => void;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const db = useDatabase();
  const [status, setStatus] = useState<OnboardingStatus>('loading');

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [completed, anySession] = await Promise.all([
          getOnboardingCompleted(db),
          hasAnySession(db),
        ]);
        if (!mounted) return;
        if (shouldShowOnboarding({ completed, hasAnySession: anySession })) {
          setStatus('active');
        } else {
          setStatus('done');
          // Back-fill the flag for an existing / restored DB that has data but
          // no flag row, so later boots are a pure fast flag read (no session
          // probe) and the wizard never resurfaces for them.
          if (!completed) {
            setOnboardingCompleted(db, true).catch(() => undefined);
          }
        }
      } catch {
        // Never trap the user behind onboarding over a settings read error —
        // fail open to the app.
        if (mounted) setStatus('done');
      }
    })();
    return () => {
      mounted = false;
    };
  }, [db]);

  const finish = useCallback(async () => {
    setStatus('done');
    try {
      await setOnboardingCompleted(db, true);
    } catch {
      // UI already dismissed; a persist failure just means the next boot
      // re-evaluates (and back-fills once data exists).
    }
  }, [db]);

  const restart = useCallback(() => {
    setStatus('active');
  }, []);

  const value = useMemo<OnboardingContextValue>(
    () => ({ status, finish, restart }),
    [status, finish, restart],
  );

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding(): OnboardingContextValue {
  const ctx = useContext(OnboardingContext);
  if (!ctx) {
    throw new Error('useOnboarding() must be called inside <OnboardingProvider>');
  }
  return ctx;
}
