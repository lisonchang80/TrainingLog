import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDatabase } from '@/components/database-provider';
import { listSessions } from '@/src/adapters/sqlite/sessionRepository';
import { listSetsBySession } from '@/src/adapters/sqlite/setRepository';
import type { Session } from '@/src/domain/session/types';
import { StatsPanel } from '@/components/stats-panel';
import { AchievementsPanel } from '@/components/achievements-panel';

interface SessionRowVM {
  session: Session;
  setCount: number;
  exerciseCount: number;
}

type SubTab = 'history' | 'stats' | 'achievements';

const SUB_TABS: readonly { key: SubTab; label: string }[] = [
  { key: 'history', label: '歷史' },
  { key: 'stats', label: '統計' },
  { key: 'achievements', label: '獎章' },
];

/**
 * History tab — three sub-tab structure (slice 9 / ADR-0009).
 *   歷史:   existing Session list, newest first
 *   統計:   per-period heatmap + capacity bars + duration metrics
 *   獎章:   255 system-seeded achievement grid (locked / unlocked)
 */
export default function HistoryScreen() {
  const [tab, setTab] = useState<SubTab>('history');

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.heading}>History</Text>
        <View style={styles.subTabRow}>
          {SUB_TABS.map((t) => (
            <Pressable
              key={t.key}
              style={[styles.subTabBtn, tab === t.key && styles.subTabBtnActive]}
              onPress={() => setTab(t.key)}>
              <Text
                style={[styles.subTabBtnText, tab === t.key && styles.subTabBtnTextActive]}>
                {t.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      {tab === 'history' ? <HistoryListPanel /> : null}
      {tab === 'stats' ? <StatsPanel /> : null}
      {tab === 'achievements' ? <AchievementsPanel /> : null}
    </SafeAreaView>
  );
}

function HistoryListPanel() {
  const db = useDatabase();
  const router = useRouter();
  const [rows, setRows] = useState<SessionRowVM[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const sessions = await listSessions(db);
    const enriched: SessionRowVM[] = await Promise.all(
      sessions.map(async (session) => {
        const sets = await listSetsBySession(db, session.id);
        const exerciseCount = new Set(sets.map((s) => s.exercise_id)).size;
        return { session, setCount: sets.length, exerciseCount };
      })
    );
    setRows(enriched);
  }, [db]);

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
    <FlatList
      data={rows}
      keyExtractor={(item) => item.session.id}
      contentContainerStyle={
        rows.length === 0 ? styles.emptyContent : styles.listContent
      }
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      ListEmptyComponent={
        <Text style={styles.emptyText}>No sessions yet — start one in the Today tab.</Text>
      }
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(`/session/${item.session.id}`)}
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
          <Text style={styles.rowTime}>{formatTimestamp(item.session.started_at)}</Text>
          <Text style={styles.rowDetails}>
            {item.exerciseCount} exercise{item.exerciseCount === 1 ? '' : 's'} ·{' '}
            {item.setCount} set{item.setCount === 1 ? '' : 's'}
          </Text>
          <Text style={styles.rowStatus}>
            {item.session.ended_at == null ? '⏱ in progress' : '✓ ended'}
          </Text>
        </Pressable>
      )}
    />
  );
}

function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString();
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingTop: 24, paddingHorizontal: 24, paddingBottom: 8, gap: 12 },
  heading: { fontSize: 28, fontWeight: '700' },
  subTabRow: {
    flexDirection: 'row',
    backgroundColor: 'rgba(127,127,127,0.12)',
    borderRadius: 10,
    padding: 4,
    gap: 4,
  },
  subTabBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  subTabBtnActive: { backgroundColor: '#fff' },
  subTabBtnText: { fontSize: 14, fontWeight: '500', color: '#6B7280' },
  subTabBtnTextActive: { color: '#111827', fontWeight: '700' },
  listContent: { paddingHorizontal: 24, paddingBottom: 24, gap: 8 },
  emptyContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  emptyText: { fontSize: 15, opacity: 0.6, textAlign: 'center' },
  row: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: 'rgba(127,127,127,0.12)',
    gap: 4,
  },
  rowPressed: { opacity: 0.85 },
  rowTime: { fontSize: 16, fontWeight: '600' },
  rowDetails: { fontSize: 14 },
  rowStatus: { fontSize: 12, opacity: 0.6 },
});
