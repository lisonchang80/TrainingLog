import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { t } from '@/src/i18n';
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
 */

const DatabaseContext = createContext<Database | null>(null);

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

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>{t('page', 'dbInitFailed')}</Text>
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

  return <DatabaseContext.Provider value={db}>{children}</DatabaseContext.Provider>;
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

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorTitle: { fontSize: 18, fontWeight: '600', marginBottom: 8 },
  errorBody: { fontSize: 14, opacity: 0.8, textAlign: 'center' },
});
