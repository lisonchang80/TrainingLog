import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import type { Database } from '@/src/db/types';
import { openDatabase } from '@/src/adapters/sqlite/expoDatabase';
import { backfillAchievementsIfNeeded } from '@/src/adapters/sqlite/achievementRepository';

/**
 * React glue for the Database singleton. Opens the production SQLite database
 * once at app start, runs migrations, and exposes the wrapped Database via
 * context. Children only render after the DB is ready.
 *
 * Repository functions are NOT exposed here — call them directly with the
 * Database returned by `useDatabase()`. Keeps UI layer dependency-light.
 *
 * Slice 15 C4 — also exposes `useSuspendForRestore()`: the in-place-swap
 * runner (grill Q12-A) for the Settings restore entry. It unmounts the whole
 * consumer tree (db → null) BEFORE the restore engine closes/swaps the DB
 * file, then re-opens and re-publishes the new instance. Unmounting first is
 * the R9 mitigation: long-lived closures that captured the old `Database`
 * (home-screen WC handlers, focus effects) are torn down with their screens,
 * and the watch bridge's pre-handler replay buffers park any envelope that
 * arrives mid-restore until handlers re-register against the NEW instance.
 */

const DatabaseContext = createContext<Database | null>(null);

type SuspendForRestore = (fn: () => Promise<void>) => Promise<void>;

const DatabaseRestoreContext = createContext<SuspendForRestore | null>(null);

export function DatabaseProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<Database | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    openDatabase()
      .then(async (d) => {
        // First-launch retroactive achievement unlocks for sessions logged
        // before slice 9 deployed. No-op when the sentinel is already set.
        await backfillAchievementsIfNeeded(d);
        if (!cancelled) setDb(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e : new Error(String(e)));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Slice 15 C4 (Q12-A) — see module docblock. `fn` is expected to be the
  // restore engine's executeRestore call; whatever it does, the finally
  // block re-opens (the restore engine's reopenLive already re-ran
  // migrations on success / rollback) and re-publishes. A reopen failure
  // lands on the same error screen as a boot-open failure.
  //
  // Audit Y-6 (ACCEPTED, not a bug): `setDb(null)` schedules a re-render that
  // unmounts the consumer tree (stopping in-flight queries), but React's
  // commit is NOT guaranteed to flush before `fn()`'s first synchronous file
  // ops. The window is benign by construction: executeRestore's FIRST step is
  // close-live (closeAndResetForRestore), so any query still racing here was
  // already doomed by the close — it surfaces as console noise, never touches
  // a new file (the new connection only exists after reopen). No data
  // ordering hazard, so we deliberately do NOT insert a macrotask yield
  // (which would only shrink the noise window, at the cost of slowing every
  // restore start).
  const suspendForRestore = useCallback<SuspendForRestore>(async (fn) => {
    setDb(null);
    try {
      await fn();
    } finally {
      try {
        const d = await openDatabase();
        await backfillAchievementsIfNeeded(d);
        setDb(d);
      } catch (e: unknown) {
        setError(e instanceof Error ? e : new Error(String(e)));
      }
    }
  }, []);

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>Database initialization failed</Text>
        <Text style={styles.errorBody}>{error.message}</Text>
      </View>
    );
  }

  if (!db) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <DatabaseRestoreContext.Provider value={suspendForRestore}>
      <DatabaseContext.Provider value={db}>{children}</DatabaseContext.Provider>
    </DatabaseRestoreContext.Provider>
  );
}

export function useDatabase(): Database {
  const db = useContext(DatabaseContext);
  if (!db) {
    throw new Error(
      'useDatabase() must be used inside <DatabaseProvider>. ' +
        'Wrap your tree in app/_layout.tsx.'
    );
  }
  return db;
}

/**
 * Slice 15 C4 — the Q12-A in-place-swap runner for the Settings restore
 * entry. The caller's screen UNMOUNTS while `fn` runs (provider shows the
 * boot spinner); the async continuation after `await suspend(...)` still
 * executes, so imperative follow-ups (Alert.alert) are fine.
 */
export function useSuspendForRestore(): SuspendForRestore {
  const suspend = useContext(DatabaseRestoreContext);
  if (!suspend) {
    throw new Error(
      'useSuspendForRestore() must be used inside <DatabaseProvider>. ' +
        'Wrap your tree in app/_layout.tsx.'
    );
  }
  return suspend;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorTitle: { fontSize: 18, fontWeight: '600', marginBottom: 8 },
  errorBody: { fontSize: 14, opacity: 0.8, textAlign: 'center' },
});
