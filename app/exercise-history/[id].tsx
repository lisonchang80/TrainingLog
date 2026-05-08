import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';

import { useDatabase } from '@/components/database-provider';
import {
  getExerciseHistoryHeader,
  listExerciseHistoryBySession,
  type ExerciseHistoryHeader,
  type ExerciseHistorySession,
  type ExerciseHistorySet,
} from '@/src/adapters/sqlite/exerciseHistoryRepository';
import { getUnitPreference } from '@/src/adapters/sqlite/settingsRepository';
import { formatWeight, kgToDisplay } from '@/src/domain/body/unitConversion';
import type { UnitPreference } from '@/src/domain/body/types';
import { BUCKETS, bucketLabel, classifyBucket } from '@/src/domain/pr/buckets';
import { aggregateBucketPRs, type BucketPRSnapshot } from '@/src/domain/pr/prEngine';
import type { BucketKey, SetForPR } from '@/src/domain/pr/types';
import { effectiveLoad } from '@/src/domain/pr/e1rmEngine';
import { setVolume } from '@/src/domain/pr/volumeEngine';

/**
 * Exercise History — cross-Template, cross-Program aggregate per ADR-0006.
 *
 * Header: name + N sessions + 全時 PR (per bucket) + last-7-day count.
 * Filter row: 全部 / 各 bucket (5 fixed v1).
 * Trend chart: top set per session (heaviest weight) over time.
 * Timeline: session-grouped list, expandable to show every set + bucket chip.
 */
export default function ExerciseHistoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDatabase();
  const router = useRouter();
  const [header, setHeader] = useState<ExerciseHistoryHeader | null>(null);
  const [sessions, setSessions] = useState<ExerciseHistorySession[]>([]);
  const [bucketFilter, setBucketFilter] = useState<BucketKey | 'all'>('all');
  const [chartMetric, setChartMetric] = useState<'weight' | 'volume'>('weight');
  const [unit, setUnit] = useState<UnitPreference>('kg');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    if (!id) return;
    const [h, ss, u] = await Promise.all([
      getExerciseHistoryHeader(db, id),
      listExerciseHistoryBySession(db, id),
      getUnitPreference(db),
    ]);
    setHeader(h);
    setSessions(ss);
    setUnit(u);
  }, [db, id]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const allSets = useMemo<ExerciseHistorySet[]>(
    () => sessions.flatMap((s) => s.sets),
    [sessions]
  );

  const bucketPRs = useMemo<BucketPRSnapshot[]>(() => {
    if (!header) return [];
    const setsForPR: SetForPR[] = allSets.map((s) => ({
      weight_kg: s.weight_kg,
      reps: s.reps,
      load_type: header.load_type,
      bw_snapshot_kg: s.bw_snapshot_kg,
    }));
    return aggregateBucketPRs(setsForPR);
  }, [allSets, header]);

  const filteredSessions = useMemo(() => {
    if (bucketFilter === 'all') return sessions;
    return sessions
      .map((s) => ({
        ...s,
        sets: s.sets.filter((set) => classifyBucket(set.reps) === bucketFilter),
      }))
      .filter((s) => s.sets.length > 0);
  }, [sessions, bucketFilter]);

  const trendPoints = useMemo(
    () => buildTrendPoints(filteredSessions, header, chartMetric),
    [filteredSessions, header, chartMetric]
  );

  if (!id) return null;

  const toggleExpand = (sid: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(sid)) next.delete(sid);
      else next.add(sid);
      return next;
    });
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {!header ? (
          <Text style={styles.empty}>找不到此動作。</Text>
        ) : sessions.length === 0 ? (
          <View>
            <HeaderCard header={header} bucketPRs={[]} unit={unit} />
            <Text style={styles.empty}>
              還沒有此動作的歷史紀錄。完成第 1 次 Session 後就會出現。
            </Text>
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            <HeaderCard header={header} bucketPRs={bucketPRs} unit={unit} />

            {/* Filter chips */}
            <View style={styles.filterRow}>
              <FilterChip
                label="全部"
                active={bucketFilter === 'all'}
                onPress={() => setBucketFilter('all')}
              />
              {BUCKETS.map((b) => (
                <FilterChip
                  key={b.key}
                  label={bucketLabel(b.key)}
                  sublabel={`(${b.max == null ? `${b.min}+` : `${b.min}~${b.max}`}RM)`}
                  active={bucketFilter === b.key}
                  onPress={() => setBucketFilter(b.key)}
                />
              ))}
            </View>

            {/* Trend chart */}
            {trendPoints.length >= 2 ? (
              <View style={styles.chartCard}>
                <View style={styles.chartHeader}>
                  <Text style={styles.cardTitle}>
                    趨勢（每次 Session{chartMetric === 'weight' ? '最重一組' : '容量最大一組'}）
                  </Text>
                  <View style={styles.metricToggle}>
                    <Pressable
                      onPress={() => setChartMetric('weight')}
                      style={[
                        styles.metricToggleBtn,
                        chartMetric === 'weight' && styles.metricToggleBtnActive,
                      ]}>
                      <Text
                        style={[
                          styles.metricToggleText,
                          chartMetric === 'weight' && styles.metricToggleTextActive,
                        ]}>
                        重量
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setChartMetric('volume')}
                      style={[
                        styles.metricToggleBtn,
                        chartMetric === 'volume' && styles.metricToggleBtnActive,
                      ]}>
                      <Text
                        style={[
                          styles.metricToggleText,
                          chartMetric === 'volume' && styles.metricToggleTextActive,
                        ]}>
                        容量
                      </Text>
                    </Pressable>
                  </View>
                </View>
                <TrendChart points={trendPoints} unit={unit} metric={chartMetric} />
              </View>
            ) : null}

            {/* Timeline */}
            <View style={{ gap: 8 }}>
              {filteredSessions.length === 0 ? (
                <Text style={styles.empty}>此 bucket 範圍內沒有紀錄。</Text>
              ) : (
                filteredSessions.map((sess) => (
                  <SessionRow
                    key={sess.session_id}
                    session={sess}
                    expanded={expanded.has(sess.session_id)}
                    onToggle={() => toggleExpand(sess.session_id)}
                    loadType={header.load_type}
                    unit={unit}
                  />
                ))
              )}
            </View>
          </View>
        )}

        <Pressable
          style={({ pressed }) => [styles.backBtn, pressed && styles.btnPressed]}
          onPress={() => router.back()}>
          <Text style={styles.backBtnText}>返回</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function HeaderCard({
  header,
  bucketPRs,
  unit,
}: {
  header: ExerciseHistoryHeader;
  bucketPRs: BucketPRSnapshot[];
  unit: UnitPreference;
}) {
  return (
    <View style={styles.headerCard}>
      <Text style={styles.headerName}>{header.exercise_name}</Text>
      <Text style={styles.headerSubline}>
        共 {header.total_sessions} 次 Session · 最近 7 天 {header.sessions_last_7_days} 次
      </Text>
      <Text style={styles.headerLoadType}>
        類型：{LOAD_TYPE_LABEL[header.load_type]}
      </Text>
      {bucketPRs.length === 0 ? null : (
        <View style={styles.prList}>
          <Text style={styles.prHeading}>全時 PR（橫跨所有 rep range）</Text>
          {bucketPRs.map((pr) => (
            <View key={pr.bucket} style={styles.prRow}>
              <Text style={styles.prBucket}>{bucketLabel(pr.bucket)}</Text>
              <Text style={styles.prValue}>
                重量 {formatPRWeight(pr.weight_best, unit)}
                {pr.weight_best_reps != null ? ` × ${pr.weight_best_reps}` : ''}
              </Text>
              <Text style={styles.prValue}>
                容量 {formatVolume(pr.volume_best, unit)}
                {pr.volume_best_weight != null && pr.volume_best_reps != null
                  ? ` (${formatPRWeight(pr.volume_best_weight, unit)} × ${pr.volume_best_reps})`
                  : ''}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function FilterChip({
  label,
  sublabel,
  active,
  onPress,
}: {
  label: string;
  sublabel?: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.filterChip,
        active && styles.filterChipActive,
        pressed && styles.btnPressed,
      ]}>
      <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
        {label}
      </Text>
      {sublabel ? (
        <Text
          style={[
            styles.filterChipSubtext,
            active && styles.filterChipSubtextActive,
          ]}>
          {sublabel}
        </Text>
      ) : null}
    </Pressable>
  );
}

function SessionRow({
  session,
  expanded,
  onToggle,
  loadType,
  unit,
}: {
  session: ExerciseHistorySession;
  expanded: boolean;
  onToggle: () => void;
  loadType: 'loaded' | 'bodyweight' | 'assisted';
  unit: UnitPreference;
}) {
  // Top set = heaviest single set's effective weight, fallback to highest volume
  const topSet = session.sets
    .map((s) => ({
      set: s,
      eff:
        s.weight_kg == null
          ? null
          : effectiveLoad(s.weight_kg, loadType, s.bw_snapshot_kg),
    }))
    .filter((x) => x.eff != null)
    .sort((a, b) => (b.eff ?? 0) - (a.eff ?? 0))[0];

  const totalVolume = session.sets.reduce((sum, s) => {
    const v = setVolume({
      weight_kg: s.weight_kg,
      reps: s.reps,
      load_type: loadType,
      bw_snapshot_kg: s.bw_snapshot_kg,
    });
    return sum + (v ?? 0);
  }, 0);

  const date = new Date(session.session_started_at);
  const dateLabel = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

  return (
    <Pressable onPress={onToggle} style={styles.sessionCard}>
      <View style={styles.sessionRowHeader}>
        <Text style={styles.sessionDate}>{dateLabel}</Text>
        <Text style={styles.sessionMeta}>
          {session.sets.length} 組 · 容量 {formatVolume(totalVolume, unit)}
        </Text>
      </View>
      {topSet ? (
        <Text style={styles.topSetLine}>
          頂組：{formatPRWeight(topSet.eff, unit)} × {topSet.set.reps}
          {topSet.set.reps != null ? `（${bucketLabel(classifyBucket(topSet.set.reps) ?? 'endurance')}）` : ''}
        </Text>
      ) : null}

      {expanded ? (
        <View style={styles.expandedBox}>
          {session.bw_snapshot_kg != null ? (
            <Text style={styles.bwLine}>
              當天體重：{formatPRWeight(session.bw_snapshot_kg, unit)}
            </Text>
          ) : null}
          {session.sets.map((set) => {
            const bucket = classifyBucket(set.reps);
            const eff =
              set.weight_kg != null
                ? effectiveLoad(set.weight_kg, loadType, set.bw_snapshot_kg)
                : null;
            return (
              <View key={set.set_id} style={styles.setLine}>
                <Text style={styles.setOrdering}>#{set.ordering}</Text>
                <Text style={styles.setText}>
                  {formatPRWeight(eff, unit)} × {set.reps ?? '—'}
                </Text>
                <Text style={styles.setBucket}>
                  {bucket ? bucketLabel(bucket) : '—'}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}
    </Pressable>
  );
}

function TrendChart({
  points,
  unit,
  metric,
}: {
  points: TrendPoint[];
  unit: UnitPreference;
  metric: 'weight' | 'volume';
}) {
  const W = 320;
  const H = 160;
  const PT = 12;
  const PB = 28;
  const PL = 36;
  const PR = 12;

  const xs = points.map((p) => p.t);
  const ys = points.map((p) => p.value);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const xSpan = xMax - xMin || 1;
  const ySpan = yMax - yMin || 1;
  const scaleX = (t: number) =>
    PL + ((t - xMin) / xSpan) * (W - PL - PR);
  const scaleY = (v: number) =>
    H - PB - ((v - yMin) / ySpan) * (H - PT - PB);

  const polyline = points
    .map((p) => `${scaleX(p.t).toFixed(1)},${scaleY(p.value).toFixed(1)}`)
    .join(' ');

  const fmt = metric === 'weight' ? formatPRWeight : formatVolume;

  return (
    <View>
      <Svg width={W} height={H}>
        <Line x1={PL} y1={H - PB} x2={W - PR} y2={H - PB} stroke="#aaa" strokeWidth={1} />
        <Line x1={PL} y1={PT} x2={PL} y2={H - PB} stroke="#aaa" strokeWidth={1} />
        <Polyline
          points={polyline}
          fill="none"
          stroke="#0a7ea4"
          strokeWidth={2}
        />
        {points.map((p, idx) => (
          <Circle
            key={idx}
            cx={scaleX(p.t)}
            cy={scaleY(p.value)}
            r={3.5}
            fill="#0a7ea4"
          />
        ))}
      </Svg>
      <View style={styles.chartLegend}>
        <Text style={styles.chartLegendText}>
          範圍 {fmt(yMin, unit)} – {fmt(yMax, unit)}
        </Text>
      </View>
    </View>
  );
}

interface TrendPoint {
  t: number;
  value: number;
}

function buildTrendPoints(
  sessions: ExerciseHistorySession[],
  header: ExerciseHistoryHeader | null,
  metric: 'weight' | 'volume'
): TrendPoint[] {
  if (!header) return [];
  const points: TrendPoint[] = [];
  // Iterate chronologically (sessions list is DESC; reverse for chart)
  const ordered = [...sessions].reverse();
  for (const sess of ordered) {
    if (metric === 'weight') {
      let topEff: number | null = null;
      for (const set of sess.sets) {
        if (set.weight_kg == null || set.reps == null) continue;
        const eff = effectiveLoad(set.weight_kg, header.load_type, set.bw_snapshot_kg);
        if (eff == null) continue;
        if (header.load_type === 'assisted' && eff <= 0) continue;
        if (topEff == null || eff > topEff) topEff = eff;
      }
      if (topEff != null) {
        points.push({ t: sess.session_started_at, value: topEff });
      }
    } else {
      // volume = highest per-set volume in this session (symmetric with weight mode)
      let topVol: number | null = null;
      for (const set of sess.sets) {
        const v = setVolume({
          weight_kg: set.weight_kg,
          reps: set.reps,
          load_type: header.load_type,
          bw_snapshot_kg: set.bw_snapshot_kg,
        });
        if (v == null) continue;
        if (topVol == null || v > topVol) topVol = v;
      }
      if (topVol != null) {
        points.push({ t: sess.session_started_at, value: topVol });
      }
    }
  }
  return points;
}

function formatPRWeight(kgValue: number | null, unit: UnitPreference): string {
  if (kgValue == null || !Number.isFinite(kgValue)) return '—';
  return formatWeight(kgValue, unit);
}

function formatVolume(kgVolume: number | null, unit: UnitPreference): string {
  if (kgVolume == null || !Number.isFinite(kgVolume)) return '—';
  // Volume is kg-reps; convert "kg" half via kgToDisplay for unit symmetry.
  const display = kgToDisplay(kgVolume, unit);
  return `${display.toFixed(0)} ${unit}-reps`;
}

const LOAD_TYPE_LABEL: Record<string, string> = {
  loaded: '加重',
  bodyweight: '徒手',
  assisted: '助力',
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 36, gap: 12 },
  empty: { fontSize: 14, opacity: 0.6, fontStyle: 'italic', paddingVertical: 12 },
  headerCard: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: 'rgba(10,126,164,0.08)',
    gap: 4,
  },
  headerName: { fontSize: 22, fontWeight: '700' },
  headerSubline: { fontSize: 13, opacity: 0.75 },
  headerLoadType: { fontSize: 12, opacity: 0.65, marginBottom: 4 },
  prList: { marginTop: 8, gap: 6 },
  prHeading: { fontSize: 12, fontWeight: '700', opacity: 0.7 },
  prRow: { gap: 2, paddingVertical: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(0,0,0,0.1)' },
  prBucket: { fontSize: 13, fontWeight: '700', color: '#0a7ea4' },
  prValue: { fontSize: 13 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  filterChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(127,127,127,0.12)',
    alignItems: 'center',
    minWidth: 60,
  },
  filterChipActive: { backgroundColor: '#0a7ea4' },
  filterChipText: { fontSize: 12, fontWeight: '600' },
  filterChipTextActive: { color: 'white' },
  filterChipSubtext: { fontSize: 10, fontWeight: '400', opacity: 0.7, marginTop: 1 },
  filterChipSubtextActive: { color: 'white', opacity: 0.85 },
  chartCard: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(127,127,127,0.06)',
    gap: 8,
  },
  cardTitle: { fontSize: 14, fontWeight: '600', flex: 1 },
  chartHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  metricToggle: {
    flexDirection: 'row',
    borderRadius: 999,
    backgroundColor: 'rgba(127,127,127,0.12)',
    padding: 2,
  },
  metricToggleBtn: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  metricToggleBtnActive: { backgroundColor: '#0a7ea4' },
  metricToggleText: { fontSize: 12, fontWeight: '500' },
  metricToggleTextActive: { color: 'white' },
  chartLegend: { flexDirection: 'row', justifyContent: 'flex-end' },
  chartLegendText: { fontSize: 11, opacity: 0.6 },
  sessionCard: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(127,127,127,0.08)',
    gap: 4,
  },
  sessionRowHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  sessionDate: { fontSize: 14, fontWeight: '600' },
  sessionMeta: { fontSize: 12, opacity: 0.7 },
  topSetLine: { fontSize: 13 },
  expandedBox: {
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.1)',
    gap: 4,
  },
  bwLine: { fontSize: 12, opacity: 0.7 },
  setLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  setOrdering: { fontSize: 12, opacity: 0.6, width: 28 },
  setText: { fontSize: 13, flex: 1 },
  setBucket: { fontSize: 11, opacity: 0.7 },
  backBtn: {
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(127,127,127,0.18)',
    alignItems: 'center',
  },
  backBtnText: { fontSize: 14, fontWeight: '600' },
  btnPressed: { opacity: 0.85 },
});
