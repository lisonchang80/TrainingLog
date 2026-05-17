import {
  Stack,
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
} from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg';

import { useDatabase } from '@/components/database-provider';
import {
  getExerciseHistoryHeader,
  hasClusterHistory,
  listExerciseHistoryBySession,
  listProgramsForExercise,
  type ExerciseHistoryHeader,
  type ExerciseHistorySession,
} from '@/src/adapters/sqlite/exerciseHistoryRepository';
import { getExerciseName } from '@/src/adapters/sqlite/exerciseRepository';
import { getUnitPreference } from '@/src/adapters/sqlite/settingsRepository';
import { formatWeight, kgToDisplay } from '@/src/domain/body/unitConversion';
import type { UnitPreference } from '@/src/domain/body/types';
import { effectiveLoad, estimateE1RM } from '@/src/domain/pr/e1rmEngine';
import { setVolume } from '@/src/domain/pr/volumeEngine';
import {
  REP_BUCKET_CHIPS,
  bucketDomainLabel,
  matchesChip,
  repRangeLabel,
  type RepBucketChip,
} from '@/src/domain/exercise/repBucketFilter';
import {
  EMPTY_FILTER,
  clearFilter,
  peekFilter,
  submitFilter,
} from '@/src/domain/exercise/historyFilterMailbox';
import {
  CLUSTER_FILTER_MODES,
  DEFAULT_CLUSTER_MODE,
  clusterFilterLabel,
  filterSetsByClusterMode,
  parseClusterMode,
  type ClusterFilterMode,
} from '@/src/domain/exercise/clusterFilter';

type ChartMetric = 'weight' | 'volume' | 'e1rm';
type ChartToggle = ChartMetric | 'parallel';

const CHART_TITLE: Record<ChartMetric, string> = {
  weight: '最大重量',
  volume: '訓練容量',
  e1rm: '1RM',
};

const CHART_DESC: Record<ChartMetric, string> = {
  weight: '（每次 Session 最重一組）',
  volume: '（每次 Session 容量最大一組）',
  e1rm: '（每次 Session 預估 1RM 最大值）',
};

const CHART_TOGGLE_LABEL: Record<ChartToggle, string> = {
  weight: '重量',
  volume: '容量',
  e1rm: '1RM',
  parallel: '並排',
};

/**
 * Exercise Chart page (ADR-0017 Q14). Shares filter surface with history page
 * via historyFilterMailbox: rep bucket multi-select + Program 週期 / 強度.
 * Differs from history page in the 進階篩選 action row: 看歷史 / 取消篩選.
 */
export default function ExerciseChartScreen() {
  const {
    id,
    clusterMode: clusterModeParam,
    partner: partnerParam,
  } = useLocalSearchParams<{
    id: string;
    clusterMode?: string;
    partner?: string;
  }>();
  const db = useDatabase();
  const router = useRouter();
  const [header, setHeader] = useState<ExerciseHistoryHeader | null>(null);
  const [hasClusterRows, setHasClusterRows] = useState(false);
  // Slice 10c overnight #11 — cluster A↔B switcher partner name lookup
  // (mirrors history page). null when no partner param or lookup miss.
  const [partnerName, setPartnerName] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ExerciseHistorySession[]>([]);
  const [programs, setPrograms] = useState<{ id: string; name: string }[]>([]);
  const [unit, setUnit] = useState<UnitPreference>('kg');

  // Filter state (mirrors mailbox)
  const [bucketFilters, setBucketFilters] = useState<Set<RepBucketChip>>(
    new Set()
  );
  const [programId, setProgramId] = useState<string | null>(null);
  const [subTagFilters, setSubTagFilters] = useState<Set<string>>(new Set());
  // Slice 10c — same 3-段 cluster mode as the history page, shared via mailbox.
  // URL param wins on cold open, mailbox on warm re-focus.
  const [clusterMode, setClusterMode] = useState<ClusterFilterMode>(
    parseClusterMode(clusterModeParam)
  );
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [programPickerOpen, setProgramPickerOpen] = useState(false);

  const [chartToggle, setChartToggle] = useState<ChartToggle>('weight');
  const [yearFilter, setYearFilter] = useState<number | null>(
    new Date().getFullYear()
  );

  // Slice 10c overnight #12 — A↔B switcher moved to body title (mirror of
  // exercise-history). Visible only in cluster_only mode with resolved
  // partner; tap either arrow to swap A↔B.
  const showSwitcher =
    clusterMode === 'cluster_only' && !!partnerParam && !!partnerName;

  const onSwapPartner = useCallback(() => {
    if (!id || !partnerParam) return;
    router.replace(
      `/exercise-chart/${partnerParam}?clusterMode=cluster_only&partner=${id}`
    );
  }, [id, partnerParam, router]);

  const screenOptions = useMemo(
    () => ({
      title: '動作圖表',
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

  const refresh = useCallback(async () => {
    if (!id) return;
    const [h, ss, ps, u, has, pName] = await Promise.all([
      getExerciseHistoryHeader(db, id),
      listExerciseHistoryBySession(db, id),
      listProgramsForExercise(db, id),
      getUnitPreference(db),
      hasClusterHistory(db, id),
      // Slice 10c overnight #11 — partner name for A↔B switcher; skip the
      // DB call when caller didn't pass `partner=`.
      partnerParam
        ? getExerciseName(db, partnerParam)
        : Promise.resolve(null),
    ]);
    setHeader(h);
    setSessions(ss);
    setPrograms(ps);
    setUnit(u);
    setHasClusterRows(has);
    setPartnerName(pName);
  }, [db, id, partnerParam]);

  useFocusEffect(
    useCallback(() => {
      refresh();
      const f = peekFilter();
      if (f) {
        setBucketFilters(new Set(f.buckets));
        setProgramId(f.programId);
        setSubTagFilters(new Set(f.subTags));
        setClusterMode(f.clusterMode);
        if (f.buckets.size > 0 || f.programId != null || f.subTags.size > 0) {
          setAdvancedOpen(true);
        }
      }
    }, [refresh])
  );

  const persistFilter = useCallback(
    (
      buckets: Set<RepBucketChip>,
      pid: string | null,
      tags: Set<string>,
      mode: ClusterFilterMode
    ) => {
      submitFilter({
        buckets,
        programId: pid,
        subTags: tags,
        clusterMode: mode,
      });
    },
    []
  );

  const subTagOptions = useMemo<string[]>(() => {
    if (programId == null) return [];
    const tags = new Set<string>();
    for (const s of sessions) {
      if (s.program_id === programId && s.sub_tag != null) {
        tags.add(s.sub_tag);
      }
    }
    return [...tags].sort();
  }, [sessions, programId]);

  const filteredSessions = useMemo(() => {
    return sessions
      .filter((s) => {
        if (programId != null && s.program_id !== programId) return false;
        if (subTagFilters.size > 0) {
          if (s.sub_tag == null || !subTagFilters.has(s.sub_tag)) return false;
        }
        return true;
      })
      .map((s) => {
        const bucketed =
          bucketFilters.size === 0
            ? s.sets
            : s.sets.filter((set) =>
                [...bucketFilters].some((b) => matchesChip(set.reps, b))
              );
        // Slice 10c — cluster filter (independent of bucket filter axis).
        const clustered = filterSetsByClusterMode(bucketed, clusterMode);
        return { ...s, sets: clustered };
      })
      .filter((s) => s.sets.length > 0);
  }, [sessions, bucketFilters, programId, subTagFilters, clusterMode]);

  if (!id) return null;

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
      persistFilter(next, programId, subTagFilters, clusterMode);
      return next;
    });
  };

  const onClusterModeTap = (mode: ClusterFilterMode) => {
    setClusterMode(mode);
    persistFilter(bucketFilters, programId, subTagFilters, mode);
  };

  const onSubTagTap = (tag: string) => {
    setSubTagFilters((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      persistFilter(bucketFilters, programId, next, clusterMode);
      return next;
    });
  };

  const onPickProgram = (newPid: string | null) => {
    setProgramId(newPid);
    const newSubTags = new Set<string>();
    setSubTagFilters(newSubTags);
    persistFilter(bucketFilters, newPid, newSubTags, clusterMode);
    setProgramPickerOpen(false);
  };

  const onJumpToHistory = () => {
    persistFilter(bucketFilters, programId, subTagFilters, clusterMode);
    // replace (not push) to avoid stacking two modal screens — see ADR-0017
    // Q14 amendment notes; two stacked modals crash on Metro R reload.
    // Slice 10c overnight #11 — forward partner + clusterMode so the history
    // page renders the same A↔B switcher (mirror of onJumpToChart over there).
    const query = partnerParam
      ? `?clusterMode=${clusterMode}&partner=${partnerParam}`
      : '';
    router.replace(`/exercise-history/${id}${query}`);
  };

  const onClearAllFilters = () => {
    const empty = new Set<RepBucketChip>();
    const emptyTags = new Set<string>();
    setBucketFilters(empty);
    setProgramId(null);
    setSubTagFilters(emptyTags);
    setClusterMode(DEFAULT_CLUSTER_MODE);
    submitFilter(EMPTY_FILTER);
    clearFilter();
  };

  const selectedProgram = programs.find((p) => p.id === programId);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen options={screenOptions} />
      <ScrollView contentContainerStyle={styles.scroll}>
        {!header ? (
          <Text style={styles.empty}>找不到此動作。</Text>
        ) : sessions.length === 0 ? (
          <Text style={styles.empty}>
            還沒有此動作的歷史紀錄。完成第 1 次 Session 後就會出現。
          </Text>
        ) : (
          <View style={{ gap: 12 }}>
            {/* Slice 10c overnight #12 — body title with A↔B switcher arrows
                when in cluster_only mode with resolved partner. Mirrors the
                exercise-history HeaderCard's name row. */}
            {showSwitcher ? (
              <View style={styles.headerNameRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`切換到 ${partnerName}`}
                  onPress={onSwapPartner}
                  hitSlop={12}>
                  <Text style={styles.headerArrow}>‹</Text>
                </Pressable>
                <Text
                  style={[styles.headerName, styles.headerNameInRow]}
                  numberOfLines={2}>
                  {header.exercise_name}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`切換到 ${partnerName}`}
                  onPress={onSwapPartner}
                  hitSlop={12}>
                  <Text style={styles.headerArrow}>›</Text>
                </Pressable>
              </View>
            ) : (
              <Text style={styles.headerName}>{header.exercise_name}</Text>
            )}

            {/* Bucket multi-select chips */}
            <View style={styles.filterRow}>
              {REP_BUCKET_CHIPS.map((chip) => {
                const active =
                  chip === 'all'
                    ? bucketFilters.size === 0
                    : bucketFilters.has(chip);
                return (
                  <FilterChip
                    key={chip}
                    label={chip === 'all' ? '全部' : bucketDomainLabel(chip)}
                    sublabel={chip === 'all' ? undefined : `${repRangeLabel(chip)}RM`}
                    active={active}
                    onPress={() => onBucketChipTap(chip)}
                  />
                );
              })}
            </View>

            {/* 3-段 cluster filter (slice 10c) — same surface as history page. */}
            {hasClusterRows ? (
              <ClusterModeSegmented value={clusterMode} onChange={onClusterModeTap} />
            ) : null}

            {/* Advanced filter section (collapsible) */}
            <View style={styles.advancedWrap}>
              <Pressable
                onPress={() => setAdvancedOpen((v) => !v)}
                style={styles.advancedHeader}>
                <Text style={styles.advancedHeaderText}>
                  進階篩選 {advancedOpen ? '▲' : '▼'}
                </Text>
                {(programId != null || subTagFilters.size > 0) && (
                  <Text style={styles.advancedHeaderBadge}>
                    {[
                      programId ? '1 Program' : null,
                      subTagFilters.size > 0 ? `${subTagFilters.size} 副` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                )}
              </Pressable>
              {advancedOpen ? (
                <View style={styles.advancedBody}>
                  <Text style={styles.advancedLabel}>Program 主</Text>
                  <Pressable
                    style={styles.dropdown}
                    onPress={() => setProgramPickerOpen(true)}>
                    <Text style={styles.dropdownText}>
                      {selectedProgram ? selectedProgram.name : '— 尚未選擇 —'}
                    </Text>
                    <Text style={styles.dropdownChevron}>▾</Text>
                  </Pressable>

                  {programId != null && (
                    <View>
                      <Text style={styles.advancedLabel}>強度</Text>
                      {subTagOptions.length === 0 ? (
                        <Text style={styles.empty}>此 Program 無 sub_tag 紀錄。</Text>
                      ) : (
                        <View style={styles.filterRow}>
                          {subTagOptions.map((tag) => (
                            <SubTagChip
                              key={tag}
                              label={tag}
                              active={subTagFilters.has(tag)}
                              onPress={() => onSubTagTap(tag)}
                            />
                          ))}
                        </View>
                      )}
                    </View>
                  )}

                  <View style={styles.actionRow}>
                    <Pressable
                      style={({ pressed }) => [
                        styles.actionBtn,
                        styles.actionBtnPrimary,
                        pressed && styles.btnPressed,
                      ]}
                      onPress={onJumpToHistory}>
                      <Text style={styles.actionBtnTextPrimary}>看歷史</Text>
                    </Pressable>
                    <Pressable
                      style={({ pressed }) => [
                        styles.actionBtn,
                        styles.actionBtnSecondary,
                        pressed && styles.btnPressed,
                      ]}
                      onPress={onClearAllFilters}>
                      <Text style={styles.actionBtnTextSecondary}>取消篩選</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}
            </View>

            {/* Period stats */}
            <PeriodStatsCard
              sessions={filteredSessions}
              header={header}
              unit={unit}
              yearFilter={yearFilter}
            />

            {/* Metric toggle */}
            <View style={styles.metricToggle}>
              {(['weight', 'volume', 'e1rm', 'parallel'] as const).map((t) => (
                <Pressable
                  key={t}
                  onPress={() => setChartToggle(t)}
                  style={[
                    styles.metricToggleBtn,
                    chartToggle === t && styles.metricToggleBtnActive,
                  ]}>
                  <Text
                    style={[
                      styles.metricToggleText,
                      chartToggle === t && styles.metricToggleTextActive,
                    ]}>
                    {CHART_TOGGLE_LABEL[t]}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Chart card(s) */}
            {chartToggle === 'parallel'
              ? (['weight', 'volume', 'e1rm'] as const).map((m) => (
                  <ChartCard
                    key={m}
                    metric={m}
                    sessions={filteredSessions}
                    header={header}
                    unit={unit}
                    yearFilter={yearFilter}
                  />
                ))
              : (
                <ChartCard
                  metric={chartToggle}
                  sessions={filteredSessions}
                  header={header}
                  unit={unit}
                  yearFilter={yearFilter}
                />
              )}

            <YearFilterRow value={yearFilter} onChange={setYearFilter} />
          </View>
        )}

      </ScrollView>

      <Modal
        visible={programPickerOpen}
        animationType="fade"
        transparent
        onRequestClose={() => setProgramPickerOpen(false)}>
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setProgramPickerOpen(false)}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>選擇 Program</Text>
            <Pressable
              style={styles.modalRow}
              onPress={() => onPickProgram(null)}>
              <Text style={styles.modalRowText}>— 尚未選擇 —</Text>
            </Pressable>
            {programs.length === 0 ? (
              <Text style={styles.empty}>沒有可用的 Program。</Text>
            ) : (
              programs.map((p) => (
                <Pressable
                  key={p.id}
                  style={styles.modalRow}
                  onPress={() => onPickProgram(p.id)}>
                  <Text
                    style={[
                      styles.modalRowText,
                      programId === p.id && styles.modalRowTextActive,
                    ]}>
                    {p.name}
                  </Text>
                </Pressable>
              ))
            )}
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
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
      <Text
        style={[styles.filterChipText, active && styles.filterChipTextActive]}
        numberOfLines={1}>
        {label}
      </Text>
      {sublabel ? (
        <Text
          style={[styles.filterChipSubtext, active && styles.filterChipSubtextActive]}
          numberOfLines={1}>
          {sublabel}
        </Text>
      ) : null}
    </Pressable>
  );
}

function SubTagChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.subTagChip,
        active && styles.subTagChipActive,
        pressed && styles.btnPressed,
      ]}>
      <Text style={[styles.subTagChipText, active && styles.subTagChipTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * iOS-style 3-段 segmented control — mirrors exercise-history page (slice 10c).
 * Self-rolled to avoid a new dep; same styling as the page's metric toggle.
 */
function ClusterModeSegmented({
  value,
  onChange,
}: {
  value: ClusterFilterMode;
  onChange: (mode: ClusterFilterMode) => void;
}) {
  return (
    <View style={styles.segmentedWrap}>
      {CLUSTER_FILTER_MODES.map((mode) => {
        const active = value === mode;
        return (
          <Pressable
            key={mode}
            onPress={() => onChange(mode)}
            style={({ pressed }) => [
              styles.segmentedBtn,
              active && styles.segmentedBtnActive,
              pressed && styles.btnPressed,
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}>
            <Text
              style={[
                styles.segmentedText,
                active && styles.segmentedTextActive,
              ]}
              numberOfLines={1}>
              {clusterFilterLabel(mode)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function PeriodStatsCard({
  sessions,
  header,
  unit,
  yearFilter,
}: {
  sessions: ExerciseHistorySession[];
  header: ExerciseHistoryHeader;
  unit: UnitPreference;
  yearFilter: number | null;
}) {
  const scopedSessions = useMemo(() => {
    if (yearFilter == null) return sessions;
    return sessions.filter(
      (s) => new Date(s.session_started_at).getFullYear() === yearFilter
    );
  }, [sessions, yearFilter]);

  const maxFor = (metric: ChartMetric): number | null => {
    const pts = buildTrendPoints(scopedSessions, header, metric);
    if (pts.length === 0) return null;
    return pts.reduce((m, p) => (p.value > m ? p.value : m), -Infinity);
  };

  const items: { label: string; metric: ChartMetric }[] = [
    { label: '最大重量', metric: 'weight' },
    { label: '最大容量', metric: 'volume' },
    { label: '1RM 預測', metric: 'e1rm' },
  ];

  return (
    <View style={styles.statsCard}>
      {items.map((it) => {
        const v = maxFor(it.metric);
        const fmt = it.metric === 'volume' ? formatVolume : formatPRWeight;
        return (
          <View key={it.metric} style={styles.statsCell}>
            <Text style={styles.statsLabel}>{it.label}</Text>
            <Text style={styles.statsValue}>{v != null ? fmt(v, unit) : '—'}</Text>
          </View>
        );
      })}
    </View>
  );
}

function ChartCard({
  metric,
  sessions,
  header,
  unit,
  yearFilter,
}: {
  metric: ChartMetric;
  sessions: ExerciseHistorySession[];
  header: ExerciseHistoryHeader;
  unit: UnitPreference;
  yearFilter: number | null;
}) {
  const scopedSessions = useMemo(() => {
    if (yearFilter == null) return sessions;
    return sessions.filter(
      (s) => new Date(s.session_started_at).getFullYear() === yearFilter
    );
  }, [sessions, yearFilter]);

  const points = useMemo(
    () => buildTrendPoints(scopedSessions, header, metric),
    [scopedSessions, header, metric]
  );

  const yearBadge = yearFilter == null ? '全部' : `${yearFilter}`;

  return (
    <View style={styles.chartCard}>
      <View style={styles.chartTitleRow}>
        <View style={styles.chartTitleBlock}>
          <Text style={styles.cardTitle}>{CHART_TITLE[metric]}</Text>
          <Text style={styles.cardSubtitle}>{CHART_DESC[metric]}</Text>
        </View>
        <Text style={styles.yearBadge}>{yearBadge}</Text>
      </View>
      {points.length >= 2 ? (
        <TrendChart points={points} unit={unit} metric={metric} />
      ) : (
        <Text style={styles.empty}>此時段資料點不足，至少需 2 次 Session。</Text>
      )}
    </View>
  );
}

function YearFilterRow({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (next: number | null) => void;
}) {
  const thisYear = new Date().getFullYear();
  const options: { key: string; label: string; year: number | null }[] = [
    { key: 'prev', label: '上一年', year: thisYear - 1 },
    { key: 'cur', label: '今年', year: thisYear },
    { key: 'next', label: '下一年', year: thisYear + 1 },
    { key: 'all', label: '全部', year: null },
  ];
  return (
    <View style={styles.yearRow}>
      {options.map((o) => {
        const active = value === o.year;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.year)}
            style={[styles.yearBtn, active && styles.yearBtnActive]}>
            <Text style={[styles.yearBtnText, active && styles.yearBtnTextActive]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function TrendChart({
  points,
  unit,
  metric,
}: {
  points: TrendPoint[];
  unit: UnitPreference;
  metric: ChartMetric;
}) {
  const W = 320;
  const H = 196;
  const PT = 28;
  const PB = 36;
  const PL = 48;
  const PR = 12;

  const xs = points.map((p) => p.t);
  const ys = points.map((p) => p.value);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const xSpan = xMax - xMin || 1;
  const ySpan = yMax - yMin || 1;
  const scaleX = (t: number) => PL + ((t - xMin) / xSpan) * (W - PL - PR);
  const scaleY = (v: number) =>
    H - PB - ((v - yMin) / ySpan) * (H - PT - PB);

  const polyline = points
    .map((p) => `${scaleX(p.t).toFixed(1)},${scaleY(p.value).toFixed(1)}`)
    .join(' ');

  const yTicks = [yMin, yMin + ySpan / 2, yMax];
  const xTicks =
    points.length <= 2 ? [xMin, xMax] : [xMin, xMin + xSpan / 2, xMax];

  const yLabel = formatYTickLabel(metric, unit);
  const yAxisUnit = unitLabel(metric, unit);

  return (
    <View>
      <Svg width={W} height={H}>
        <Line x1={PL} y1={H - PB} x2={W - PR} y2={H - PB} stroke="#aaa" strokeWidth={1} />
        <Line x1={PL} y1={PT} x2={PL} y2={H - PB} stroke="#aaa" strokeWidth={1} />
        {yTicks.map((v, idx) => {
          const y = scaleY(v);
          return (
            <SvgText
              key={`y${idx}`}
              x={PL - 4}
              y={y + 4}
              fontSize={10}
              fill="#666"
              textAnchor="end">
              {yLabel(v)}
            </SvgText>
          );
        })}
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
        <Polyline points={polyline} fill="none" stroke="#0a7ea4" strokeWidth={2} />
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
  metric: ChartMetric
): TrendPoint[] {
  if (!header) return [];
  const points: TrendPoint[] = [];
  const ordered = [...sessions].reverse();
  for (const sess of ordered) {
    let top: number | null = null;
    for (const set of sess.sets) {
      let v: number | null = null;
      if (metric === 'weight') {
        if (set.weight_kg == null || set.reps == null) continue;
        const eff = effectiveLoad(set.weight_kg, header.load_type, set.bw_snapshot_kg);
        if (eff == null) continue;
        if (header.load_type === 'assisted' && eff <= 0) continue;
        v = eff;
      } else if (metric === 'volume') {
        v = setVolume({
          weight_kg: set.weight_kg,
          reps: set.reps,
          load_type: header.load_type,
          bw_snapshot_kg: set.bw_snapshot_kg,
        });
      } else {
        v = estimateE1RM({
          weight_kg: set.weight_kg,
          reps: set.reps,
          load_type: header.load_type,
          bw_snapshot_kg: set.bw_snapshot_kg,
        });
      }
      if (v == null) continue;
      if (top == null || v > top) top = v;
    }
    if (top != null) {
      points.push({ t: sess.session_started_at, value: top });
    }
  }
  return points;
}

function unitLabel(metric: ChartMetric, unit: UnitPreference): string {
  return metric === 'volume' ? `${unit}-reps` : unit;
}

function formatYTickLabel(
  metric: ChartMetric,
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

function formatPRWeight(kgValue: number | null, unit: UnitPreference): string {
  if (kgValue == null || !Number.isFinite(kgValue)) return '—';
  return formatWeight(kgValue, unit);
}

function formatVolume(kgVolume: number | null, unit: UnitPreference): string {
  if (kgVolume == null || !Number.isFinite(kgVolume)) return '—';
  const display = kgToDisplay(kgVolume, unit);
  return `${display.toFixed(0)} ${unit}-reps`;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 36, gap: 12 },
  empty: { fontSize: 14, opacity: 0.6, fontStyle: 'italic', paddingVertical: 12 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  filterChip: {
    flex: 1,
    paddingVertical: 5,
    paddingHorizontal: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(127,127,127,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 56,
  },
  filterChipActive: { backgroundColor: '#0a7ea4' },
  filterChipText: { fontSize: 12, fontWeight: '600' },
  filterChipTextActive: { color: 'white' },
  filterChipSubtext: { fontSize: 10, fontWeight: '400', opacity: 0.7, marginTop: 1 },
  filterChipSubtextActive: { color: 'white', opacity: 0.85 },
  segmentedWrap: {
    flexDirection: 'row',
    borderRadius: 999,
    backgroundColor: 'rgba(127,127,127,0.12)',
    padding: 2,
  },
  segmentedBtn: {
    flex: 1,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 999,
    alignItems: 'center',
  },
  segmentedBtnActive: { backgroundColor: '#0a7ea4' },
  segmentedText: { fontSize: 13, fontWeight: '500' },
  segmentedTextActive: { color: 'white' },
  advancedWrap: {
    borderRadius: 12,
    backgroundColor: 'rgba(127,127,127,0.08)',
    overflow: 'hidden',
  },
  advancedHeader: {
    flexDirection: 'row',
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  advancedHeaderText: { fontSize: 14, fontWeight: '600', flex: 1 },
  advancedHeaderBadge: {
    fontSize: 11,
    color: '#0a7ea4',
    fontWeight: '600',
  },
  advancedBody: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    gap: 8,
  },
  advancedLabel: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.7,
    marginTop: 6,
  },
  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: 'white',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.2)',
  },
  dropdownText: { flex: 1, fontSize: 14 },
  dropdownChevron: { fontSize: 14, opacity: 0.5 },
  subTagChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(127,127,127,0.15)',
  },
  subTagChipActive: { backgroundColor: '#0a7ea4' },
  subTagChipText: { fontSize: 13, fontWeight: '500' },
  subTagChipTextActive: { color: 'white' },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  actionBtnPrimary: { backgroundColor: '#0a7ea4' },
  actionBtnSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(127,127,127,0.4)',
  },
  actionBtnTextPrimary: { fontSize: 14, color: 'white', fontWeight: '600' },
  actionBtnTextSecondary: { fontSize: 14, color: '#333', fontWeight: '500' },
  statsCard: {
    flexDirection: 'row',
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(10,126,164,0.08)',
    gap: 8,
  },
  statsCell: { flex: 1, alignItems: 'center', gap: 4 },
  statsLabel: { fontSize: 12, opacity: 0.7, fontWeight: '500' },
  statsValue: { fontSize: 15, fontWeight: '700', color: '#0a7ea4' },
  chartCard: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(127,127,127,0.06)',
    gap: 8,
  },
  cardTitle: { fontSize: 16, fontWeight: '700' },
  cardSubtitle: { fontSize: 11, opacity: 0.6, marginTop: 1 },
  chartTitleBlock: { gap: 0, flex: 1 },
  chartTitleRow: { flexDirection: 'row', alignItems: 'flex-start' },
  yearBadge: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0a7ea4',
    paddingLeft: 8,
  },
  metricToggle: {
    flexDirection: 'row',
    borderRadius: 999,
    backgroundColor: 'rgba(127,127,127,0.12)',
    padding: 2,
  },
  metricToggleBtn: {
    flex: 1,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 999,
    alignItems: 'center',
  },
  metricToggleBtnActive: { backgroundColor: '#0a7ea4' },
  metricToggleText: { fontSize: 13, fontWeight: '500' },
  metricToggleTextActive: { color: 'white' },
  yearRow: { flexDirection: 'row', gap: 4, marginTop: 4 },
  yearBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(127,127,127,0.12)',
    alignItems: 'center',
  },
  yearBtnActive: { backgroundColor: '#0a7ea4' },
  yearBtnText: { fontSize: 13, fontWeight: '500' },
  yearBtnTextActive: { color: 'white' },
  headerBack: {
    color: '#0a7ea4',
    fontSize: 17,
    fontWeight: '400',
    paddingHorizontal: 8,
  },
  // Slice 10c overnight #12 — A↔B switcher relocated to body title row
  // (mirror of exercise-history). Chart had no body exercise name before, so
  // we add headerName here too for consistent visual hierarchy.
  headerName: { fontSize: 22, fontWeight: '700' },
  headerNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  headerArrow: {
    color: '#007AFF',
    fontSize: 28,
    fontWeight: '400',
    paddingHorizontal: 4,
  },
  headerNameInRow: { flex: 1, textAlign: 'center' },
  btnPressed: { opacity: 0.85 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: 'white',
    borderRadius: 14,
    padding: 16,
    gap: 4,
  },
  modalTitle: { fontSize: 16, fontWeight: '700', marginBottom: 8 },
  modalRow: {
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.1)',
  },
  modalRowText: { fontSize: 15 },
  modalRowTextActive: { color: '#0a7ea4', fontWeight: '600' },
});
