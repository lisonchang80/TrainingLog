import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDatabase } from '@/components/database-provider';
import {
  getSession,
  listSessionExercisesWithName,
  type SessionExerciseRowWithName,
} from '@/src/adapters/sqlite/sessionRepository';
import {
  listSetsBySession,
  type SetWithExercise,
} from '@/src/adapters/sqlite/setRepository';
import { getReusableSupersetWithExercises } from '@/src/adapters/sqlite/supersetRepository';
import type { ReusableSupersetWithExercises } from '@/src/domain/superset/types';
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
 * Cluster rendering (ADR-0018 v014, I1–I6):
 *   - A new "Clusters / 超級組" section sits between "Per exercise" and
 *     "All sets". It groups session_exercise rows by parent_id linkage and
 *     renders each cluster as a vertical 2-column block (A | B) so cluster
 *     identity is visible without redesigning the rest of the page.
 *   - When `reusable_superset_id` is NOT NULL, the cluster header uses the
 *     RS name + color (I6); when NULL (ad-hoc / manual), it uses a neutral
 *     "超級組" label and a default border (still distinct from solos per I1).
 *   - Per-side load_type drives cell formatting (I5: loaded shows kg×reps,
 *     bodyweight hides kg).
 */
export default function SessionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDatabase();
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [sets, setSets] = useState<SetWithExercise[]>([]);
  const [sessionExercises, setSessionExercises] = useState<
    SessionExerciseRowWithName[]
  >([]);
  const [rsById, setRsById] = useState<
    Map<string, ReusableSupersetWithExercises>
  >(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [s, ss, ses] = await Promise.all([
        getSession(db, id),
        listSetsBySession(db, id),
        listSessionExercisesWithName(db, id),
      ]);
      if (!s) {
        setError('Session not found.');
        setLoading(false);
        return;
      }
      setSession(s);
      setSets(ss);
      setSummary(summarize(s, ss));
      setSessionExercises(ses);

      // Hydrate RS rows for any cluster that carries an rs_id (I6).
      const rsIds = new Set<string>();
      for (const e of ses) {
        if (e.reusable_superset_id) rsIds.add(e.reusable_superset_id);
      }
      if (rsIds.size > 0) {
        const entries: [string, ReusableSupersetWithExercises][] = [];
        for (const rsId of rsIds) {
          const rs = await getReusableSupersetWithExercises(db, rsId);
          if (rs) entries.push([rsId, rs]);
        }
        setRsById(new Map(entries));
      } else {
        setRsById(new Map());
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [db, id]);

  useEffect(() => {
    load();
  }, [load]);

  const clusters = useMemo(
    () => buildClusters(sessionExercises, sets),
    [sessionExercises, sets]
  );

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
              {session.ended_at != null
                ? ` → ${formatTimestamp(session.ended_at)}`
                : ''}
            </Text>

            <View style={styles.statsRow}>
              <Stat label="Sets" value={String(summary.totalSets)} />
              <Stat label="Exercises" value={String(summary.exerciseCount)} />
              <Stat
                label="Duration"
                value={
                  summary.durationMs == null
                    ? '—'
                    : formatDuration(summary.durationMs)
                }
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

            {clusters.length > 0 && (
              <>
                <Text style={styles.section}>超級組</Text>
                {clusters.map((c) => (
                  <ClusterBlock
                    key={c.parent.id}
                    cluster={c}
                    rs={
                      c.parent.reusable_superset_id
                        ? rsById.get(c.parent.reusable_superset_id) ?? null
                        : null
                    }
                  />
                ))}
              </>
            )}

            <Text style={styles.section}>All sets</Text>
            {sets.length === 0 ? (
              <Text style={styles.muted}>No sets recorded.</Text>
            ) : (
              <FlatList
                data={sets}
                keyExtractor={(item) => item.id}
                scrollEnabled={false}
                ItemSeparatorComponent={() => (
                  <View style={styles.separator} />
                )}
                renderItem={({ item }) => (
                  <View style={styles.setRow}>
                    <Text style={styles.setOrdering}>#{item.ordering}</Text>
                    <View style={styles.setMain}>
                      <Text style={styles.setExercise}>
                        {item.exercise_name}
                      </Text>
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
              style={({ pressed }) => [
                styles.doneBtn,
                pressed && styles.btnPressed,
              ]}>
              <Text style={styles.doneBtnText}>Done</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Cluster grouping (ADR-0018 v014)
// ─────────────────────────────────────────────────────────────────────────

interface ClusterRow {
  parent: SessionExerciseRowWithName;
  child: SessionExerciseRowWithName;
  /** Sets belonging to the parent (A side), ordered by ordering ASC. */
  setsA: SetWithExercise[];
  /** Sets belonging to the child (B side), ordered by ordering ASC. */
  setsB: SetWithExercise[];
}

function buildClusters(
  sessionExercises: SessionExerciseRowWithName[],
  sets: SetWithExercise[]
): ClusterRow[] {
  // Identify parents = rows that some other row references via parent_id.
  const parentIds = new Set<string>();
  for (const e of sessionExercises) {
    if (e.parent_id !== null) parentIds.add(e.parent_id);
  }
  // For each parent, find its child (the row whose parent_id matches).
  const out: ClusterRow[] = [];
  for (const parent of sessionExercises) {
    if (!parentIds.has(parent.id)) continue;
    const child = sessionExercises.find((e) => e.parent_id === parent.id);
    if (!child) continue;
    const setsA = sets
      .filter((s) => s.exercise_id === parent.exercise_id)
      .sort((a, b) => a.ordering - b.ordering);
    const setsB = sets
      .filter((s) => s.exercise_id === child.exercise_id)
      .sort((a, b) => a.ordering - b.ordering);
    out.push({ parent, child, setsA, setsB });
  }
  return out;
}

function ClusterBlock({
  cluster,
  rs,
}: {
  cluster: ClusterRow;
  rs: ReusableSupersetWithExercises | null;
}) {
  // I6: rs_id NOT NULL → RS color/name; rs_id NULL → neutral label + default border.
  const color = rs?.superset.color_hex ?? '#9aa0a6';
  const label = rs?.superset.name ?? '超級組';
  // I4: render up to max(A, B) rows; missing side cell stays empty.
  const rowCount = Math.max(cluster.setsA.length, cluster.setsB.length);
  const rows = Array.from({ length: rowCount }).map((_, i) => ({
    a: cluster.setsA[i] ?? null,
    b: cluster.setsB[i] ?? null,
  }));
  return (
    <View
      style={[
        styles.clusterCard,
        { borderColor: color, backgroundColor: hexAlpha(color, 0.08) },
      ]}>
      <View style={styles.clusterHeader}>
        <View style={[styles.clusterDot, { backgroundColor: color }]} />
        <Text style={styles.clusterLabel}>{label}</Text>
      </View>
      <View style={styles.clusterColRow}>
        <Text style={[styles.clusterColTitle, { color }]}>
          A · {cluster.parent.exercise_name}
        </Text>
        <Text style={[styles.clusterColTitle, { color }]}>
          B · {cluster.child.exercise_name}
        </Text>
      </View>
      {rows.length === 0 ? (
        <Text style={styles.muted}>No sets recorded.</Text>
      ) : (
        rows.map((r, i) => (
          <View key={i} style={styles.clusterPairRow}>
            <View style={styles.clusterCell}>
              {r.a ? (
                <Text style={styles.clusterCellText}>
                  {formatSetCell(r.a, cluster.parent.exercise_load_type)}
                </Text>
              ) : (
                <Text style={styles.clusterCellEmpty}>—</Text>
              )}
            </View>
            <View style={styles.clusterCell}>
              {r.b ? (
                <Text style={styles.clusterCellText}>
                  {formatSetCell(r.b, cluster.child.exercise_load_type)}
                </Text>
              ) : (
                <Text style={styles.clusterCellEmpty}>—</Text>
              )}
            </View>
          </View>
        ))
      )}
    </View>
  );
}

function formatSetCell(
  s: SetWithExercise,
  load_type: 'loaded' | 'bodyweight' | 'assisted'
): string {
  // I5: per-side load_type drives the cell format.
  if (load_type === 'bodyweight') return `BW × ${s.reps}`;
  if (load_type === 'assisted') return `-${s.weight_kg} kg × ${s.reps}`;
  return `${s.weight_kg} kg × ${s.reps}`;
}

function hexAlpha(hex: string, alpha: number): string {
  // Best-effort alpha overlay — only works for "#RRGGBB"; falls back to the
  // raw hex with a low-opacity wash by appending a 2-digit alpha. RN supports
  // 8-digit hex on iOS for backgroundColor.
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
  const a = Math.max(0, Math.min(255, Math.round(alpha * 255)))
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
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
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 12,
  },
  setOrdering: { fontSize: 12, opacity: 0.6, width: 28 },
  setMain: { flex: 1 },
  setExercise: { fontSize: 15, fontWeight: '600' },
  setDetails: { fontSize: 14, opacity: 0.85 },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(127,127,127,0.3)',
  },
  // Cluster block (I1 visual distinction + I6 RS color)
  clusterCard: {
    borderWidth: 1.5,
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
  },
  clusterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  clusterDot: { width: 10, height: 10, borderRadius: 5 },
  clusterLabel: { fontSize: 14, fontWeight: '600' },
  clusterColRow: { flexDirection: 'row', gap: 12, marginBottom: 6 },
  clusterColTitle: { flex: 1, fontSize: 12, fontWeight: '600' },
  clusterPairRow: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 4,
  },
  clusterCell: { flex: 1 },
  clusterCellText: { fontSize: 14 },
  clusterCellEmpty: { fontSize: 14, opacity: 0.3 },
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
