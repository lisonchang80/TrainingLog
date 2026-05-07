import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';

import { useDatabase } from '@/components/database-provider';
import {
  listAllSetsWithExercise,
  type SetWithExercise,
} from '@/src/adapters/sqlite/setRepository';

/**
 * History tab — flat list of all saved Sets, newest first.
 *
 * Slice-1 simplification: no per-Session grouping yet; one row per Set with
 * exercise name + weight + reps + timestamp. Slice-3 (Session lifecycle)
 * will add session grouping.
 */
export default function HistoryScreen() {
  const db = useDatabase();
  const [rows, setRows] = useState<SetWithExercise[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const r = await listAllSetsWithExercise(db);
    setRows(r);
  }, [db]);

  useEffect(() => {
    load();
  }, [load]);

  // Reload when tab regains focus so newly-saved sets appear immediately.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.heading}>History</Text>
      </View>
      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        contentContainerStyle={rows.length === 0 ? styles.emptyContent : styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <Text style={styles.emptyText}>No sets yet — record one in the Today tab.</Text>
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.rowExercise}>{item.exercise_name}</Text>
            <Text style={styles.rowDetails}>
              {item.weight_kg} kg × {item.reps} reps
            </Text>
            <Text style={styles.rowTime}>{formatTimestamp(item.created_at)}</Text>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleString();
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { padding: 24, paddingBottom: 8 },
  heading: { fontSize: 28, fontWeight: '700' },
  listContent: { paddingHorizontal: 24, paddingBottom: 24, gap: 8 },
  emptyContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyText: { fontSize: 15, opacity: 0.6, textAlign: 'center' },
  row: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: 'rgba(127,127,127,0.12)',
    gap: 4,
  },
  rowExercise: { fontSize: 16, fontWeight: '600' },
  rowDetails: { fontSize: 15 },
  rowTime: { fontSize: 12, opacity: 0.6 },
});
