import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useDatabase } from '@/components/database-provider';
import { runBackup } from '@/src/services/backupService';

/**
 * BackupTriggers — slice 15 C3 (ADR-0011 + 2026-06-12 grill Q6-B).
 *
 * Renders nothing; mounts the two PASSIVE automatic backup triggers:
 *
 *   ② AppState → 'background' listener
 *   ③ cold-start sweep (one shot per mount — `runBackup('cold-start')`
 *      itself enforces the "last success > 24h and mode=auto" gate, so
 *      mounting is unconditional)
 *
 * (① — the session-finalize trigger — lives in app/(tabs)/index.tsx,
 * chained after `pushEndToWatch` settles for the Q7-B ordering guarantee.)
 *
 * ## Placement
 * Must sit INSIDE <DatabaseProvider> (needs the live `Database`), which also
 * gives the correct boot order for free: DatabaseProvider only renders
 * children after openDatabase()+migrate resolve, so the cold-start sweep can
 * never snapshot a half-migrated file; and RestoreGate sits ABOVE the
 * provider, so on a fresh install the sweep cannot run (and create a DB
 * file) before the gate's fresh-install detection has finished.
 *
 * ## Restore interplay
 * `useSuspendForRestore` unmounts the provider's consumer tree during an
 * in-place restore — this component (and its AppState subscription) is torn
 * down with it and remounts against the NEW db instance afterwards, so a
 * background trigger can never run against the closed/old handle (R9). The
 * remount re-fires the cold-start sweep; the 5min debounce / 24h gate make
 * that a no-op in practice (and after a restore, a fresh backup of the
 * restored state is desirable anyway).
 *
 * Every `runBackup` call is fire-and-forget: it never throws, and skips /
 * failures are recorded in backup metadata (surfaced via Settings + the C5
 * home banner), so there is deliberately no UI here.
 */
export function BackupTriggers() {
  const db = useDatabase();

  useEffect(() => {
    // ③ Q6-B cold-start sweep — covers "只改 template/體重、長期不關 app"
    // drift where neither finalize nor background fired for >24h.
    void runBackup(db, 'cold-start');

    // ② app → background. 'background' (not 'inactive': that fires for
    // control-center pulls / incoming calls, and iOS gives no meaningful
    // execution window guarantee there anyway — the ADR trigger is App 進
    // background). The 5min debounce absorbs the common "finalize 後馬上切
    // background" double-fire.
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'background') void runBackup(db, 'background');
    });
    return () => sub.remove();
  }, [db]);

  return null;
}
