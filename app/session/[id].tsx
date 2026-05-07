import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDatabase } from '@/components/database-provider';
import { getSession } from '@/src/adapters/sqlite/sessionRepository';
import {
  listSetsBySession,
  type SetWithExercise,
} from '@/src/adapters/sqlite/setRepository';
import type { Session } from '@/src/domain/session/types';
import {
  summarize,
  type SessionSummary,
} from '@/src/domain/session/sessionManager';

/**
 * Session detail / summary screen.
 *
 * Reached from two places:
 *   - Today screen on End Session (router.push immediately after closing the
 *     session in DB) — acts as the "summary" page.
 *   - History tab on row tap — same view, just for already-ended sessions.
 *
 * Same page in both flows: counts on top, full set list below.
 */
export default function SessionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDatabase();
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [sets, setSets] = useState<SetWithExercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [s, ss] = await Promise.all([
        getSession(db, id),
        listSetsBySession(db, id),
      ]);
      if (!s) {
        setError('Session not found.');
        setLoading(false);
        return;
      }
      setSession(s);
      setSets(ss);
      setSummary(summarize(s, ss));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [db, id]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Session' }} />
      <ScrollView contentContainerStyle={styles.body}>
        {loading ? (
          <Text style={styles.muted}>Loading…</Text>
        ) : error ? (
          <Text style={styles.error}>{error}</Text>
        ) : !session || !summary ? (
          <Text style={styles.muted}>No data.</Text>
        ) : (
          <>
            <Text style={styles.heading}>
              {session.ended_at == null ? 'In progress' : 'Session summary'}
            </Text>
            <Text style={styles.timestamp}>
              {formatTimestamp(session.started_at)}
              {session.ended_at != null ? ` → ${formatTimestamp(session.ended_at)}` : ''}
            </Text>

            <View style={styles.statsRow}>
              <Stat label="Sets" value={String(summary.totalSets)} />
              <Stat label="Exercises" value={String(summary.exerciseCount)} />
              <Stat
                label="Duration"
                value={summary.durationMs == null ? '—' : formatDuration(summary.durationMs)}
              />
            </View>

            <Text style={styles.section}>Per exercise</Text>
            {summary.perExercise.length === 0 ? (
              <Text style={styles.muted}>No sets recorded.</Text>
            ) : (
              summary.perExercise.map((p) => (
                <View key={p.exercise_id} style={styles.perExerciseRow}>
                  <Text style={styles.perExerciseName}>{p.exercise_name}</Text>
                  <Text style={styles.perExerciseCount}>
                    {p.setCount} set{p.setCount === 1 ? '' : 's'}
                  </Text>
                </View>
              ))
            )}

            <Text style={styles.section}>All sets</Text>
            {sets.length === 0 ? (
              <Text style={styles.muted}>No sets recorded.</Text>
            ) : (
              <FlatList
                data={sets}
                keyExtractor={(item) => item.id}
                scrollEnabled={false}
                ItemSeparatorComponent={() => <View style={styles.separator} />}
                renderItem={({ item }) => (
                  <View style={styles.setRow}>
                    <Text style={styles.setOrdering}>#{item.ordering}</Text>
                    <View style={styles.setMain}>
                      <Text style={styles.setExercise}>{item.exercise_name}</Text>
                      <Text style={styles.setDetails}>
                        {item.weight_kg} kg × {item.reps} reps
                      </Text>
                    </View>
                  </View>
                )}
              />
            )}

            <Pressable
              accessibilityRole="button"
              onPress={() => router.back()}
              style={({ pressed }) => [styles.doneBtn, pressed && styles.btnPressed]}>
              <Text style={styles.doneBtnText}>Done</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString();
}

function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { padding: 24, gap: 12, paddingBottom: 48 },
  heading: { fontSize: 28, fontWeight: '700' },
  timestamp: { fontSize: 14, opacity: 0.65 },
  statsRow: { flexDirection: 'row', gap: 12, marginVertical: 16 },
  stat: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(127,127,127,0.12)',
    alignItems: 'center',
  },
  statValue: { fontSize: 22, fontWeight: '700' },
  statLabel: { fontSize: 12, opacity: 0.65, marginTop: 4 },
  section: { fontSize: 16, fontWeight: '600', marginTop: 16 },
  perExerciseRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  perExerciseName: { fontSize: 15 },
  perExerciseCount: { fontSize: 15, opacity: 0.7 },
  setRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 12 },
  setOrdering: { fontSize: 12, opacity: 0.6, width: 28 },
  setMain: { flex: 1 },
  setExercise: { fontSize: 15, fontWeight: '600' },
  setDetails: { fontSize: 14, opacity: 0.85 },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(127,127,127,0.3)' },
  doneBtn: {
    marginTop: 24,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#0a7ea4',
    alignItems: 'center',
  },
  doneBtnText: { color: 'white', fontSize: 16, fontWeight: '600' },
  btnPressed: { opacity: 0.85 },
  muted: { fontSize: 14, opacity: 0.6 },
  error: { fontSize: 14, color: '#dc3545' },
});
