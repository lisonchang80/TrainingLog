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

import { useDatabase } from '@/components/database-provider';
import { hashColor } from '@/components/template-editor/palette';
import { getUnitPreference } from '@/src/adapters/sqlite/settingsRepository';
import { formatWeight, kgToDisplay } from '@/src/domain/body/unitConversion';
import type { UnitPreference } from '@/src/domain/body/types';
import {
  queryReusableSupersetHistory,
  type ReusableSupersetHistoryRow,
} from '@/src/adapters/sqlite/exerciseHistoryRepository';
import { getReusableSupersetWithExercises } from '@/src/adapters/sqlite/supersetRepository';
import type { ReusableSupersetWithExercises } from '@/src/domain/superset/types';
import {
  REP_BUCKET_CHIPS,
  matchesChip,
  type RepBucketChip,
} from '@/src/domain/exercise/repBucketFilter';
import {
  EMPTY_SUPERSET_FILTER,
  clearSupersetFilter,
  peekSupersetFilter,
  submitSupersetFilter,
} from '@/src/domain/superset/historyChartFilterMailbox';

const CONTRAST_COLOR_B = '#222';

/**
 * Reusable Superset history page (ADR-0017 Q17 main page → 歷史 footer).
 *
 * Data via `queryReusableSupersetHistory` (templated-cluster path only;
 * freestyle clusters not yet supported — see ADR-0017 schema-gap note +
 * 9.8c data-layer report).
 *
 * Filter surface (Q16 first sub-bullet): rep-bucket chip multi-select only.
 * Shared with /superset-chart/[id] via `historyChartFilterMailbox`.
 */
export default function SupersetHistoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDatabase();
  const router = useRouter();
  const screenOptions = useMemo(
    () => ({
      title: '超級組歷史',
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
      queryReusableSupersetHistory(db, id, { limit: 200 }),
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

  // Apply chip filter on the client: a session is kept if at least one
  // side has ≥1 set in any selected bucket (mirrors Q16 + data-layer
  // "asymmetric pairings still surface" rule). Within each kept session,
  // sets in the OTHER bucket are NOT hidden — the cluster identity is
  // "both done in the same session", showing only filtered sets in one
  // column makes the cluster look asymmetric on screen.
  const filtered = useMemo(() => {
    if (bucketFilters.size === 0) return rows;
    return rows.filter((r) => {
      for (const side of r.sides) {
        for (const s of side.sets) {
          for (const b of bucketFilters) {
            if (matchesChip(s.reps, b)) return true;
          }
        }
      }
      return false;
    });
  }, [rows, bucketFilters]);

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

  const onJumpToChart = () => {
    if (!id) return;
    persistFilter(bucketFilters);
    router.replace(`/superset-chart/${id}`);
  };

  if (!id) return null;

  const barColor = meta
    ? meta.superset.color_hex ?? hashColor(meta.superset.name)
    : '#999';

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
                <View
                  style={[styles.colorDot, { backgroundColor: barColor }]}
                />
                <Text style={styles.heading}>{meta.superset.name}</Text>
              </View>
              <View style={styles.legendRow}>
                <LegendDot color={barColor} label={meta.exercises[0]?.name ?? 'A'} />
                <LegendDot color={CONTRAST_COLOR_B} label={meta.exercises[1]?.name ?? 'B'} />
              </View>
              <Text style={styles.metaText}>
                共 {filtered.length} 次配對訓練
                {meta.superset.use_count > 0
                  ? ` · 已加入 ${meta.superset.use_count} 個 Template`
                  : ''}
              </Text>
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
                onPress={onJumpToChart}
                style={({ pressed }) => [
                  styles.actionBtn,
                  pressed && styles.pressed,
                ]}>
                <Text style={styles.actionBtnText}>轉圖表</Text>
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
                  把這個超級組加進 Template 後，session 中同場完成兩個動作就會在這裡顯示。
                </Text>
              </View>
            ) : filtered.length === 0 ? (
              <View style={styles.emptyBlock}>
                <Text style={styles.emptyTitle}>沒有符合篩選的配對</Text>
                <Text style={styles.emptyBody}>
                  目前的 rep 範圍篩選找不到資料。試試別的 chip 或清除篩選。
                </Text>
              </View>
            ) : (
              filtered.map((r) => (
                <PairedSessionCard
                  key={r.session_id}
                  row={r}
                  colorA={barColor}
                  colorB={CONTRAST_COLOR_B}
                  unit={unit}
                />
              ))
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
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

function PairedSessionCard({
  row,
  colorA,
  colorB,
  unit,
}: {
  row: ReusableSupersetHistoryRow;
  colorA: string;
  colorB: string;
  unit: UnitPreference;
}) {
  const dateText = formatDate(row.session_started_at);
  return (
    <View style={styles.sessionCard}>
      <Text style={styles.sessionDate}>{dateText}</Text>
      <View style={styles.sidesRow}>
        <SideColumn side={row.sides[0]} color={colorA} unit={unit} />
        <View style={styles.divider} />
        <SideColumn side={row.sides[1]} color={colorB} unit={unit} />
      </View>
    </View>
  );
}

function SideColumn({
  side,
  color,
  unit,
}: {
  side: ReusableSupersetHistoryRow['sides'][number];
  color: string;
  unit: UnitPreference;
}) {
  return (
    <View style={styles.sideCol}>
      <View style={styles.sideHeader}>
        <View style={[styles.sideSwatch, { backgroundColor: color }]} />
        <Text style={styles.sideName} numberOfLines={2}>
          {side.exercise_name}
        </Text>
      </View>
      {side.sets.length === 0 ? (
        <Text style={styles.noSets}>—</Text>
      ) : (
        side.sets.map((s) => (
          <Text key={s.set_id} style={styles.setLine}>
            {formatSetLine(s.weight_kg, s.reps, unit)}
          </Text>
        ))
      )}
    </View>
  );
}

function formatSetLine(
  weight_kg: number | null,
  reps: number | null,
  unit: UnitPreference
): string {
  const w =
    weight_kg == null ? '—' : formatWeight(kgToDisplay(weight_kg, unit), unit);
  const r = reps == null ? '—' : `${reps}`;
  return `${w} × ${r}`;
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}/${m}/${day}`;
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
  metaText: { fontSize: 13, opacity: 0.7 },
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
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
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
  sessionCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(127,127,127,0.3)',
    borderRadius: 10,
    padding: 12,
    gap: 8,
  },
  sessionDate: { fontSize: 13, fontWeight: '600', opacity: 0.8 },
  sidesRow: { flexDirection: 'row', gap: 10 },
  sideCol: { flex: 1, gap: 4 },
  sideHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  sideSwatch: { width: 8, height: 8, borderRadius: 4 },
  sideName: { fontSize: 13, fontWeight: '600', flexShrink: 1 },
  setLine: { fontSize: 13, fontVariant: ['tabular-nums'] },
  noSets: { fontSize: 13, opacity: 0.4 },
  divider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(127,127,127,0.3)',
  },
  empty: { fontSize: 14, opacity: 0.6, padding: 24, textAlign: 'center' },
  emptyBlock: {
    padding: 24,
    alignItems: 'center',
    gap: 6,
  },
  emptyTitle: { fontSize: 15, fontWeight: '600' },
  emptyBody: { fontSize: 13, opacity: 0.6, textAlign: 'center' },
  headerBack: {
    color: '#0a7ea4',
    fontSize: 17,
    fontWeight: '400',
    paddingHorizontal: 8,
  },
});
