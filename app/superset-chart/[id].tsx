import {
  Stack,
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
} from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg';

import { useDatabase } from '@/components/database-provider';
import { hashColor } from '@/components/template-editor/palette';
import { getUnitPreference } from '@/src/adapters/sqlite/settingsRepository';
import { kgToDisplay } from '@/src/domain/body/unitConversion';
import type { UnitPreference } from '@/src/domain/body/types';
import {
  queryReusableSupersetHistory,
  type ReusableSupersetHistoryRow,
} from '@/src/adapters/sqlite/exerciseHistoryRepository';
import { getReusableSupersetWithExercises } from '@/src/adapters/sqlite/supersetRepository';
import type { ReusableSupersetWithExercises } from '@/src/domain/superset/types';
import {
  REP_BUCKET_CHIPS,
  type RepBucketChip,
} from '@/src/domain/exercise/repBucketFilter';
import {
  buildSupersetChartSeries,
  type SupersetChartSeries,
} from '@/src/domain/superset/supersetChart';
import type { ChartPoint } from '@/src/domain/exercise/exerciseChart';
import {
  EMPTY_SUPERSET_FILTER,
  clearSupersetFilter,
  peekSupersetFilter,
  submitSupersetFilter,
} from '@/src/domain/superset/historyChartFilterMailbox';

const CONTRAST_COLOR_B = '#222';

type Metric = 'max_weight' | 'volume' | 'e1rm';

const METRIC_TITLE: Record<Metric, string> = {
  max_weight: '最大重量',
  volume: '訓練容量',
  e1rm: '1RM 預測',
};

const METRIC_DESC: Record<Metric, string> = {
  max_weight: '（每次 Session 最重一組）',
  volume: '（每次 Session 加總容量）',
  e1rm: '（每次 Session 預估 1RM 最大值；不受篩選影響）',
};

/**
 * Reusable Superset chart page (ADR-0017 Q16).
 *
 * 3 metrics × 2 lines per chart (A / B sides of the cluster).
 * A = superset color; B = fixed contrast color.
 * Chip filter shared with /superset-history/[id] via mailbox.
 */
export default function SupersetChartScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDatabase();
  const router = useRouter();
  const screenOptions = useMemo(
    () => ({
      title: '超級組圖表',
      headerBackVisible: false,
      headerLeft: () => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="返回"
          onPress={() => router.back()}
          hitSlop={12}>
          <Text style={styles.headerBack}>‹ 返回</Text>
        </Pressable>
      ),
    }),
    [router]
  );

  const [meta, setMeta] = useState<ReusableSupersetWithExercises | null>(null);
  const [rows, setRows] = useState<ReusableSupersetHistoryRow[]>([]);
  const [unit, setUnit] = useState<UnitPreference>('kg');
  const [bucketFilters, setBucketFilters] = useState<Set<RepBucketChip>>(
    new Set()
  );

  const refresh = useCallback(async () => {
    if (!id) return;
    const [m, rs, u] = await Promise.all([
      getReusableSupersetWithExercises(db, id),
      // Note: no repBucket filter at SQL level — we do client-side multi-chip
      // narrowing in `buildSupersetChartSeries` per Q14 semantics.
      queryReusableSupersetHistory(db, id, { limit: 500 }),
      getUnitPreference(db),
    ]);
    setMeta(m);
    setRows(rs);
    setUnit(u);
  }, [db, id]);

  useFocusEffect(
    useCallback(() => {
      refresh();
      const f = peekSupersetFilter();
      if (f) setBucketFilters(new Set(f.buckets));
    }, [refresh])
  );

  const persistFilter = useCallback((buckets: Set<RepBucketChip>) => {
    submitSupersetFilter({ buckets });
  }, []);

  // For multi-chip, we OR-combine into a representative `RepBucketChip` arg
  // to `buildSupersetChartSeries`. The transformer expects a single chip;
  // for empty set we pass 'all', for size==1 the chip itself. For size>1
  // we fall back to 'all' since the underlying `filterSetsByBucket` is
  // single-bucket — multi-chip OR would need a separate code path in
  // exerciseChart, which is out of scope here.
  // TODO(slice-9.8d-polish): teach exerciseChart to accept Set<RepBucketChip>.
  const effectiveChip: RepBucketChip = useMemo(() => {
    if (bucketFilters.size === 0) return 'all';
    if (bucketFilters.size === 1) return [...bucketFilters][0]!;
    return 'all';
  }, [bucketFilters]);

  const series: SupersetChartSeries = useMemo(
    () => buildSupersetChartSeries(rows, effectiveChip),
    [rows, effectiveChip]
  );

  const onBucketChipTap = (chip: RepBucketChip) => {
    setBucketFilters((prev) => {
      const next = new Set(prev);
      if (chip === 'all') {
        next.clear();
      } else if (next.has(chip)) {
        next.delete(chip);
      } else {
        next.add(chip);
      }
      persistFilter(next);
      return next;
    });
  };

  const onClearFilter = () => {
    const empty = new Set<RepBucketChip>();
    setBucketFilters(empty);
    submitSupersetFilter(EMPTY_SUPERSET_FILTER);
    clearSupersetFilter();
  };

  const onJumpToHistory = () => {
    if (!id) return;
    persistFilter(bucketFilters);
    router.replace(`/superset-history/${id}`);
  };

  if (!id) return null;

  const barColor = meta
    ? meta.superset.color_hex ?? hashColor(meta.superset.name)
    : '#999';

  const nameA = meta?.exercises[0]?.name ?? 'A';
  const nameB = meta?.exercises[1]?.name ?? 'B';

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen options={screenOptions} />
      <ScrollView contentContainerStyle={styles.scroll}>
        {!meta ? (
          <Text style={styles.empty}>找不到此超級組。</Text>
        ) : (
          <>
            <View style={styles.headerCard}>
              <View style={styles.titleRow}>
                <View style={[styles.colorDot, { backgroundColor: barColor }]} />
                <Text style={styles.heading}>{meta.superset.name}</Text>
              </View>
              <View style={styles.legendRow}>
                <LegendDot color={barColor} label={nameA} />
                <LegendDot color={CONTRAST_COLOR_B} label={nameB} />
              </View>
            </View>

            <View style={styles.chipRow}>
              {REP_BUCKET_CHIPS.map((chip) => {
                const active =
                  chip === 'all'
                    ? bucketFilters.size === 0
                    : bucketFilters.has(chip);
                return (
                  <Pressable
                    key={chip}
                    onPress={() => onBucketChipTap(chip)}
                    style={[styles.chip, active && styles.chipActive]}>
                    <Text
                      style={[
                        styles.chipText,
                        active && styles.chipTextActive,
                      ]}>
                      {chipLabel(chip)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.actionRow}>
              <Pressable
                accessibilityRole="button"
                onPress={onJumpToHistory}
                style={({ pressed }) => [
                  styles.actionBtn,
                  pressed && styles.pressed,
                ]}>
                <Text style={styles.actionBtnText}>看歷史</Text>
              </Pressable>
              {bucketFilters.size > 0 && (
                <Pressable
                  accessibilityRole="button"
                  onPress={onClearFilter}
                  style={({ pressed }) => [
                    styles.actionBtnGhost,
                    pressed && styles.pressed,
                  ]}>
                  <Text style={styles.actionBtnGhostText}>取消篩選</Text>
                </Pressable>
              )}
            </View>

            {rows.length === 0 ? (
              <View style={styles.emptyBlock}>
                <Text style={styles.emptyTitle}>還沒有配對紀錄</Text>
                <Text style={styles.emptyBody}>
                  完成第一次配對訓練後圖表會自動繪製。
                </Text>
              </View>
            ) : (
              (['max_weight', 'volume', 'e1rm'] as Metric[]).map((m) => (
                <ChartSection
                  key={m}
                  metric={m}
                  series={series}
                  unit={unit}
                  colorA={barColor}
                  colorB={CONTRAST_COLOR_B}
                  nameA={nameA}
                  nameB={nameB}
                />
              ))
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function ChartSection({
  metric,
  series,
  unit,
  colorA,
  colorB,
  nameA,
  nameB,
}: {
  metric: Metric;
  series: SupersetChartSeries;
  unit: UnitPreference;
  colorA: string;
  colorB: string;
  nameA: string;
  nameB: string;
}) {
  const pointsA = series.a[metric];
  const pointsB = series.b[metric];
  const empty = pointsA.length === 0 && pointsB.length === 0;
  return (
    <View style={styles.chartSection}>
      <Text style={styles.chartTitle}>{METRIC_TITLE[metric]}</Text>
      <Text style={styles.chartDesc}>{METRIC_DESC[metric]}</Text>
      {empty ? (
        <View style={styles.chartEmpty}>
          <Text style={styles.emptyBody}>沒有可繪製的資料。</Text>
        </View>
      ) : (
        <DualLineChart
          pointsA={pointsA}
          pointsB={pointsB}
          unit={unit}
          metric={metric}
          colorA={colorA}
          colorB={colorB}
        />
      )}
      <View style={styles.legendRow}>
        <LegendDot color={colorA} label={`${nameA} · ${pointsA.length} 點`} />
        <LegendDot color={colorB} label={`${nameB} · ${pointsB.length} 點`} />
      </View>
    </View>
  );
}

function DualLineChart({
  pointsA,
  pointsB,
  unit,
  metric,
  colorA,
  colorB,
}: {
  pointsA: ChartPoint[];
  pointsB: ChartPoint[];
  unit: UnitPreference;
  metric: Metric;
  colorA: string;
  colorB: string;
}) {
  const W = 320;
  const H = 196;
  const PT = 28;
  const PB = 36;
  const PL = 48;
  const PR = 12;

  const allXs: number[] = [];
  const allYs: number[] = [];
  for (const p of pointsA) {
    allXs.push(p.started_at);
    allYs.push(p.value);
  }
  for (const p of pointsB) {
    allXs.push(p.started_at);
    allYs.push(p.value);
  }
  if (allXs.length === 0) return null;
  const xMin = Math.min(...allXs);
  const xMax = Math.max(...allXs);
  const yMin = Math.min(...allYs);
  const yMax = Math.max(...allYs);
  const xSpan = xMax - xMin || 1;
  const ySpan = yMax - yMin || 1;
  const scaleX = (t: number) => PL + ((t - xMin) / xSpan) * (W - PL - PR);
  const scaleY = (v: number) =>
    H - PB - ((v - yMin) / ySpan) * (H - PT - PB);

  const toPolyline = (pts: ChartPoint[]) =>
    pts
      .map(
        (p) =>
          `${scaleX(p.started_at).toFixed(1)},${scaleY(p.value).toFixed(1)}`
      )
      .join(' ');

  const yTicks = [yMin, yMin + ySpan / 2, yMax];
  const xTicks =
    allXs.length <= 2 ? [xMin, xMax] : [xMin, xMin + xSpan / 2, xMax];
  const yLabel = formatYTickLabel(metric, unit);
  const yAxisUnit = unitLabel(metric, unit);

  return (
    <Svg width={W} height={H}>
      <Line x1={PL} y1={H - PB} x2={W - PR} y2={H - PB} stroke="#aaa" strokeWidth={1} />
      <Line x1={PL} y1={PT} x2={PL} y2={H - PB} stroke="#aaa" strokeWidth={1} />
      {yTicks.map((v, idx) => (
        <SvgText
          key={`y${idx}`}
          x={PL - 4}
          y={scaleY(v) + 4}
          fontSize={10}
          fill="#666"
          textAnchor="end">
          {yLabel(v)}
        </SvgText>
      ))}
      <SvgText x={PL - 4} y={12} fontSize={10} fill="#666" textAnchor="end">
        {yAxisUnit}
      </SvgText>
      {xTicks.map((t, idx) => (
        <SvgText
          key={`x${idx}`}
          x={scaleX(t)}
          y={H - PB + 14}
          fontSize={10}
          fill="#666"
          textAnchor={
            idx === 0 ? 'start' : idx === xTicks.length - 1 ? 'end' : 'middle'
          }>
          {formatDateTick(t)}
        </SvgText>
      ))}
      {pointsA.length > 0 && (
        <Polyline
          points={toPolyline(pointsA)}
          fill="none"
          stroke={colorA}
          strokeWidth={2}
        />
      )}
      {pointsA.map((p, idx) => (
        <Circle
          key={`a${idx}`}
          cx={scaleX(p.started_at)}
          cy={scaleY(p.value)}
          r={3.5}
          fill={colorA}
        />
      ))}
      {pointsB.length > 0 && (
        <Polyline
          points={toPolyline(pointsB)}
          fill="none"
          stroke={colorB}
          strokeWidth={2}
        />
      )}
      {pointsB.map((p, idx) => (
        <Circle
          key={`b${idx}`}
          cx={scaleX(p.started_at)}
          cy={scaleY(p.value)}
          r={3.5}
          fill={colorB}
        />
      ))}
    </Svg>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendSwatch, { backgroundColor: color }]} />
      <Text style={styles.legendLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function unitLabel(metric: Metric, unit: UnitPreference): string {
  return metric === 'volume' ? `${unit}-reps` : unit;
}

function formatYTickLabel(
  metric: Metric,
  unit: UnitPreference
): (v: number) => string {
  if (metric === 'volume') {
    return (v) => {
      const display = kgToDisplay(v, unit);
      return display >= 1000
        ? `${(display / 1000).toFixed(1)}k`
        : display.toFixed(0);
    };
  }
  return (v) => {
    const display = kgToDisplay(v, unit);
    return display.toFixed(display < 10 ? 1 : 0);
  };
}

function formatDateTick(t: number): string {
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function chipLabel(c: RepBucketChip): string {
  switch (c) {
    case 'all':
      return '全部';
    case 'max_strength':
      return '最大力量';
    case 'strength':
      return '力量';
    case 'hypertrophy':
      return '增肌';
    case 'muscle_endurance':
      return '肌耐力';
    case 'endurance':
      return '耐力';
  }
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: 16, gap: 12 },
  headerCard: {
    backgroundColor: 'rgba(127,127,127,0.08)',
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  colorDot: { width: 14, height: 14, borderRadius: 7 },
  heading: { fontSize: 20, fontWeight: '700', flexShrink: 1 },
  legendRow: { flexDirection: 'row', gap: 16, marginTop: 2 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  legendSwatch: { width: 10, height: 10, borderRadius: 5 },
  legendLabel: { fontSize: 13, opacity: 0.85, flexShrink: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(127,127,127,0.4)',
  },
  chipActive: { backgroundColor: '#0a7ea4', borderColor: '#0a7ea4' },
  chipText: { fontSize: 13, color: '#0a7ea4' },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  actionRow: { flexDirection: 'row', gap: 10 },
  actionBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#0a7ea4',
  },
  actionBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  actionBtnGhost: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(127,127,127,0.4)',
  },
  actionBtnGhostText: { color: '#0a7ea4', fontSize: 14, fontWeight: '500' },
  pressed: { opacity: 0.5 },
  chartSection: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(127,127,127,0.3)',
    borderRadius: 10,
    padding: 12,
    gap: 6,
    alignItems: 'center',
  },
  chartTitle: {
    fontSize: 15,
    fontWeight: '600',
    alignSelf: 'flex-start',
  },
  chartDesc: {
    fontSize: 12,
    opacity: 0.6,
    alignSelf: 'flex-start',
  },
  chartEmpty: { padding: 24 },
  empty: { fontSize: 14, opacity: 0.6, padding: 24, textAlign: 'center' },
  emptyBlock: { padding: 24, alignItems: 'center', gap: 6 },
  emptyTitle: { fontSize: 15, fontWeight: '600' },
  emptyBody: { fontSize: 13, opacity: 0.6, textAlign: 'center' },
  headerBack: {
    color: '#0a7ea4',
    fontSize: 17,
    fontWeight: '400',
    paddingHorizontal: 8,
  },
});
