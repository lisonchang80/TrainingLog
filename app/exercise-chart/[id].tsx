import {
  Stack,
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
} from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  Modal,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg';

import { useDatabase } from '@/components/database-provider';
import type { Database } from '@/src/db/types';
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
import {
  parseSide,
  sideToPageIndex,
  pageIndexToSide,
  switcherArrowDisabled,
  type ClusterSide,
} from '@/src/domain/exercise/clusterSwitcher';
import { t, tSwitchToPartner } from '@/src/i18n';

type ChartMetric = 'weight' | 'volume' | 'e1rm';
type ChartToggle = ChartMetric | 'parallel';

/**
 * PR bucket labels from `src/domain/pr/buckets.ts::bucketLabel` are raw zh
 * literals (ADR-0007). Round-trip via this map to render localized variants
 * without touching domain. Mirror of exercise-history page helper.
 */
const PR_BUCKET_ZH_TO_DOMAIN_KEY: Record<string, 'maxStrength' | 'strength' | 'hypertrophy' | 'muscularEndurance' | 'endurance'> = {
  最大力量: 'maxStrength',
  力量: 'strength',
  增肌: 'hypertrophy',
  肌耐力: 'muscularEndurance',
  耐力: 'endurance',
};
function tPrBucketLabel(zhLabel: string): string {
  const key = PR_BUCKET_ZH_TO_DOMAIN_KEY[zhLabel];
  return key ? t('domain', key) : zhLabel;
}

function chartTitle(metric: ChartMetric): string {
  if (metric === 'weight') return t('domain', 'maxWeight');
  if (metric === 'volume') return t('domain', 'trainingVolume');
  return '1RM';
}

function chartDesc(metric: ChartMetric): string {
  if (metric === 'weight') return t('status', 'heaviestSetPerSession');
  if (metric === 'volume') return t('status', 'highestVolumePerSession');
  return t('status', 'maxEstimated1rmPerSession');
}

function chartToggleLabel(toggle: ChartToggle): string {
  if (toggle === 'weight') return t('domain', 'weight');
  if (toggle === 'volume') return t('domain', 'volume');
  if (toggle === 'e1rm') return '1RM';
  return t('button', 'sideBySide');
}

/**
 * Exercise Chart page (ADR-0017 Q14). Shares filter surface with history page
 * via historyFilterMailbox: rep bucket multi-select + Program 週期 / 強度.
 * Differs from history page in the 進階篩選 action row: 看歷史 / 取消篩選.
 *
 * Slice 10c overnight #16 — same A↔B cluster paging shell as the
 * history page. When caller passes `partner=` + `clusterMode=cluster_only`,
 * body is wrapped in a horizontal pagingEnabled ScrollView with two
 * ChartPageContent instances. Chart queries are heavier (trend
 * aggregation per metric), so per-side isolated state matters even
 * more than on the history page.
 */
export default function ExerciseChartScreen() {
  const {
    id,
    clusterMode: clusterModeParam,
    partner: partnerParam,
    side: sideParam,
  } = useLocalSearchParams<{
    id: string;
    clusterMode?: string;
    partner?: string;
    side?: 'A' | 'B';
  }>();
  const initialSide: ClusterSide = parseSide(sideParam);
  const db = useDatabase();
  const router = useRouter();
  const initialClusterMode = useMemo(
    () => parseClusterMode(clusterModeParam),
    [clusterModeParam]
  );

  // Shell-level name lookup so both PageContents render switcher arrows
  // consistently (each side shows its own name; arrow points to partner).
  const [partnerName, setPartnerName] = useState<string | null>(null);
  const [selfName, setSelfName] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [pName, sName] = await Promise.all([
        partnerParam
          ? getExerciseName(db, partnerParam)
          : Promise.resolve(null),
        id ? getExerciseName(db, id) : Promise.resolve(null),
      ]);
      if (cancelled) return;
      setPartnerName(pName);
      setSelfName(sName);
    })();
    return () => {
      cancelled = true;
    };
  }, [db, id, partnerParam]);

  const screenOptions = useMemo(
    () => ({
      title: t('page', 'exerciseChart'),
      headerBackVisible: false,
      headerLeft: () => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common', 'backPlain')}
          onPress={() => router.back()}
          hitSlop={12}>
          <Text style={styles.headerBack}>{t('common', 'backArrow')}</Text>
        </Pressable>
      ),
    }),
    [router]
  );

  if (!id) return null;

  const pagingEnabled =
    !!partnerParam && initialClusterMode === 'cluster_only';

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen options={screenOptions} />
      {pagingEnabled ? (
        <PagingShell
          idA={id}
          idB={partnerParam!}
          initialSide={initialSide}
          nameA={selfName}
          nameB={partnerName}
          initialClusterMode={initialClusterMode}
          db={db}
        />
      ) : (
        <ChartPageContent
          db={db}
          exerciseId={id}
          partnerExerciseId={partnerParam ?? null}
          partnerName={partnerName}
          selfName={selfName}
          initialClusterMode={initialClusterMode}
          showSwitcher={false}
          currentSide="A"
          onRequestSwap={undefined}
        />
      )}
    </SafeAreaView>
  );
}

/**
 * Horizontal paging shell — mirror of exercise-history's PagingShell.
 * Per-side isolated state matters extra here because chart trend builds
 * are O(n_sessions × n_sets) per metric.
 */
function PagingShell({
  idA,
  idB,
  initialSide,
  nameA,
  nameB,
  initialClusterMode,
  db,
}: {
  idA: string;
  idB: string;
  initialSide: ClusterSide;
  nameA: string | null;
  nameB: string | null;
  initialClusterMode: ClusterFilterMode;
  db: Database;
}) {
  const router = useRouter();
  const [pageWidth, setPageWidth] = useState<number>(() =>
    Dimensions.get('window').width
  );
  const scrollRef = useRef<ScrollView | null>(null);
  const [currentSide, setCurrentSide] = useState<ClusterSide>(initialSide);
  const didInitialScrollRef = useRef(false);

  const onLayout = useCallback(
    (e: { nativeEvent: { layout: { width: number } } }) => {
      const w = e.nativeEvent.layout.width;
      if (w > 0 && w !== pageWidth) setPageWidth(w);
      if (!didInitialScrollRef.current && initialSide === 'B' && w > 0) {
        scrollRef.current?.scrollTo({ x: w, y: 0, animated: false });
        didInitialScrollRef.current = true;
      } else if (!didInitialScrollRef.current && w > 0) {
        didInitialScrollRef.current = true;
      }
    },
    [initialSide, pageWidth]
  );

  const onMomentumScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const x = e.nativeEvent.contentOffset.x;
      const idx = Math.round(x / Math.max(pageWidth, 1));
      const nextSide = pageIndexToSide(idx);
      if (nextSide !== currentSide) {
        setCurrentSide(nextSide);
        router.setParams({ side: nextSide });
      }
    },
    [pageWidth, currentSide, router]
  );

  const onRequestSwap = useCallback(() => {
    const targetSide: ClusterSide = currentSide === 'A' ? 'B' : 'A';
    const targetX = sideToPageIndex(targetSide) * pageWidth;
    scrollRef.current?.scrollTo({ x: targetX, y: 0, animated: true });
    setCurrentSide(targetSide);
    router.setParams({ side: targetSide });
  }, [currentSide, pageWidth, router]);

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      pagingEnabled
      showsHorizontalScrollIndicator={false}
      onLayout={onLayout}
      onMomentumScrollEnd={onMomentumScrollEnd}
      style={styles.pager}>
      <View style={{ width: pageWidth }}>
        <ChartPageContent
          db={db}
          exerciseId={idA}
          partnerExerciseId={idB}
          partnerName={nameB}
          selfName={nameA}
          initialClusterMode={initialClusterMode}
          showSwitcher={true}
          currentSide={currentSide}
          onRequestSwap={onRequestSwap}
        />
      </View>
      <View style={{ width: pageWidth }}>
        <ChartPageContent
          db={db}
          exerciseId={idB}
          partnerExerciseId={idA}
          partnerName={nameA}
          selfName={nameB}
          initialClusterMode={initialClusterMode}
          showSwitcher={true}
          currentSide={currentSide}
          onRequestSwap={onRequestSwap}
        />
      </View>
    </ScrollView>
  );
}

/**
 * Per-page body: title with switcher + chips + segmented + advanced +
 * period stats + metric toggle + chart card(s) + year filter. Owns its
 * own DB fetch + filter state so two PageContents are fully isolated.
 */
function ChartPageContent({
  db,
  exerciseId,
  partnerExerciseId,
  partnerName,
  selfName: _selfName,
  initialClusterMode,
  showSwitcher,
  currentSide,
  onRequestSwap,
}: {
  db: Database;
  exerciseId: string;
  partnerExerciseId: string | null;
  partnerName: string | null;
  selfName: string | null;
  initialClusterMode: ClusterFilterMode;
  showSwitcher: boolean;
  currentSide: ClusterSide;
  onRequestSwap: (() => void) | undefined;
}) {
  const router = useRouter();
  const [header, setHeader] = useState<ExerciseHistoryHeader | null>(null);
  const [hasClusterRows, setHasClusterRows] = useState(false);
  const [sessions, setSessions] = useState<ExerciseHistorySession[]>([]);
  const [programs, setPrograms] = useState<{ id: string; name: string }[]>([]);
  const [unit, setUnit] = useState<UnitPreference>('kg');

  const [bucketFilters, setBucketFilters] = useState<Set<RepBucketChip>>(
    new Set()
  );
  const [programId, setProgramId] = useState<string | null>(null);
  const [subTagFilters, setSubTagFilters] = useState<Set<string>>(new Set());
  const [clusterMode, setClusterMode] =
    useState<ClusterFilterMode>(initialClusterMode);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [programPickerOpen, setProgramPickerOpen] = useState(false);

  const [chartToggle, setChartToggle] = useState<ChartToggle>('weight');
  const [yearFilter, setYearFilter] = useState<number | null>(
    new Date().getFullYear()
  );

  const refresh = useCallback(async () => {
    if (!exerciseId) return;
    const [h, ss, ps, u, has] = await Promise.all([
      getExerciseHistoryHeader(db, exerciseId),
      listExerciseHistoryBySession(db, exerciseId),
      listProgramsForExercise(db, exerciseId),
      getUnitPreference(db),
      hasClusterHistory(db, exerciseId),
    ]);
    setHeader(h);
    setSessions(ss);
    setPrograms(ps);
    setUnit(u);
    setHasClusterRows(has);
  }, [db, exerciseId]);

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
        const clustered = filterSetsByClusterMode(bucketed, clusterMode);
        return { ...s, sets: clustered };
      })
      .filter((s) => s.sets.length > 0);
  }, [sessions, bucketFilters, programId, subTagFilters, clusterMode]);

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
    // replace (not push) — see ADR-0017 Q14 amendment notes; carry
    // partner + clusterMode + side so history page mirrors this paging
    // shell on cold open.
    const query = partnerExerciseId
      ? `?clusterMode=${clusterMode}&partner=${partnerExerciseId}&side=${currentSide}`
      : '';
    router.replace(`/exercise-history/${exerciseId}${query}`);
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
    <>
      <ScrollView contentContainerStyle={styles.scroll}>
        {!header ? (
          <Text style={styles.empty}>{t('alert', 'exerciseNotFound')}</Text>
        ) : sessions.length === 0 ? (
          // TODO(i18n): no key for "還沒有此動作的歷史紀錄。完成第 1 次 Session 後就會出現。" empty-state copy
          <Text style={styles.empty}>
            還沒有此動作的歷史紀錄。完成第 1 次 Session 後就會出現。
          </Text>
        ) : (
          <View style={{ gap: 12 }}>
            {/* Body title with A↔B switcher arrows when paging; plain
                name otherwise. Disabled boundary arrow per
                switcherArrowDisabled() in clusterSwitcher.ts. */}
            {showSwitcher ? (
              <SwitcherTitle
                name={header.exercise_name}
                currentSide={currentSide}
                onRequestSwap={onRequestSwap}
                partnerName={partnerName}
              />
            ) : (
              <Text style={styles.headerName}>{header.exercise_name}</Text>
            )}

            <View style={styles.filterRow}>
              {REP_BUCKET_CHIPS.map((chip) => {
                const active =
                  chip === 'all'
                    ? bucketFilters.size === 0
                    : bucketFilters.has(chip);
                return (
                  <FilterChip
                    key={chip}
                    label={chip === 'all' ? t('common', 'all') : tPrBucketLabel(bucketDomainLabel(chip))}
                    sublabel={chip === 'all' ? undefined : `${repRangeLabel(chip)}RM`}
                    active={active}
                    onPress={() => onBucketChipTap(chip)}
                  />
                );
              })}
            </View>

            {hasClusterRows ? (
              <ClusterModeSegmented value={clusterMode} onChange={onClusterModeTap} />
            ) : null}

            <View style={styles.advancedWrap}>
              <Pressable
                onPress={() => setAdvancedOpen((v) => !v)}
                style={styles.advancedHeader}>
                <Text style={styles.advancedHeaderText}>
                  {/* TODO(i18n): no key for "進階篩選" advanced-filter header */}
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
                  <Text style={styles.advancedLabel}>{t('domain', 'cycle')}</Text>
                  <Pressable
                    style={styles.dropdown}
                    onPress={() => setProgramPickerOpen(true)}>
                    <Text style={styles.dropdownText}>
                      {selectedProgram ? selectedProgram.name : t('common', 'notSelected')}
                    </Text>
                    <Text style={styles.dropdownChevron}>▾</Text>
                  </Pressable>

                  {programId != null && (
                    <View>
                      <Text style={styles.advancedLabel}>{t('domain', 'intensity')}</Text>
                      {subTagOptions.length === 0 ? (
                        <Text style={styles.empty}>{t('alert', 'programHasNoSubTag')}</Text>
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
                      <Text style={styles.actionBtnTextPrimary}>{t('button', 'viewHistory')}</Text>
                    </Pressable>
                    <Pressable
                      style={({ pressed }) => [
                        styles.actionBtn,
                        styles.actionBtnSecondary,
                        pressed && styles.btnPressed,
                      ]}
                      onPress={onClearAllFilters}>
                      <Text style={styles.actionBtnTextSecondary}>{t('button', 'clearFilter')}</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}
            </View>

            <PeriodStatsCard
              sessions={filteredSessions}
              header={header}
              unit={unit}
              yearFilter={yearFilter}
            />

            <View style={styles.metricToggle}>
              {(['weight', 'volume', 'e1rm', 'parallel'] as const).map((tog) => (
                <Pressable
                  key={tog}
                  onPress={() => setChartToggle(tog)}
                  style={[
                    styles.metricToggleBtn,
                    chartToggle === tog && styles.metricToggleBtnActive,
                  ]}>
                  <Text
                    style={[
                      styles.metricToggleText,
                      chartToggle === tog && styles.metricToggleTextActive,
                    ]}>
                    {chartToggleLabel(tog)}
                  </Text>
                </Pressable>
              ))}
            </View>

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
            <Text style={styles.modalTitle}>{t('page', 'selectProgram')}</Text>
            <Pressable
              style={styles.modalRow}
              onPress={() => onPickProgram(null)}>
              <Text style={styles.modalRowText}>{t('common', 'notSelected')}</Text>
            </Pressable>
            {programs.length === 0 ? (
              <Text style={styles.empty}>{t('alert', 'noProgramsAvailable')}</Text>
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
    </>
  );
}

function SwitcherTitle({
  name,
  currentSide,
  onRequestSwap,
  partnerName,
}: {
  name: string;
  currentSide: ClusterSide;
  onRequestSwap: (() => void) | undefined;
  partnerName: string | null;
}) {
  const leftDisabled = switcherArrowDisabled(currentSide, 'left');
  const rightDisabled = switcherArrowDisabled(currentSide, 'right');
  return (
    <View style={styles.headerNameRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={leftDisabled ? t('status', 'alreadyASide') : tSwitchToPartner(partnerName ?? '')}
        accessibilityState={{ disabled: leftDisabled }}
        onPress={leftDisabled ? undefined : onRequestSwap}
        disabled={leftDisabled || !onRequestSwap}
        hitSlop={12}>
        <Text
          style={[
            styles.headerArrow,
            leftDisabled && styles.headerArrowDisabled,
          ]}>
          ‹
        </Text>
      </Pressable>
      <Text
        style={[styles.headerName, styles.headerNameInRow]}
        numberOfLines={2}>
        {name}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={rightDisabled ? t('status', 'alreadyBSide') : tSwitchToPartner(partnerName ?? '')}
        accessibilityState={{ disabled: rightDisabled }}
        onPress={rightDisabled ? undefined : onRequestSwap}
        disabled={rightDisabled || !onRequestSwap}
        hitSlop={12}>
        <Text
          style={[
            styles.headerArrow,
            rightDisabled && styles.headerArrowDisabled,
          ]}>
          ›
        </Text>
      </Pressable>
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
    { label: t('domain', 'maxWeight'), metric: 'weight' },
    { label: t('domain', 'maxVolume'), metric: 'volume' },
    { label: t('domain', 'oneRepMaxEstimate'), metric: 'e1rm' },
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

  const yearBadge = yearFilter == null ? t('common', 'all') : `${yearFilter}`;

  return (
    <View style={styles.chartCard}>
      <View style={styles.chartTitleRow}>
        <View style={styles.chartTitleBlock}>
          <Text style={styles.cardTitle}>{chartTitle(metric)}</Text>
          <Text style={styles.cardSubtitle}>{chartDesc(metric)}</Text>
        </View>
        <Text style={styles.yearBadge}>{yearBadge}</Text>
      </View>
      {points.length >= 2 ? (
        <TrendChart points={points} unit={unit} metric={metric} />
      ) : (
        <Text style={styles.empty}>{t('alert', 'notEnoughDataPoints')}</Text>
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
    { key: 'prev', label: t('status', 'previousYear'), year: thisYear - 1 },
    { key: 'cur', label: t('status', 'thisYear'), year: thisYear },
    { key: 'next', label: t('status', 'nextYear'), year: thisYear + 1 },
    { key: 'all', label: t('common', 'all'), year: null },
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
  pager: { flex: 1 },
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
  headerArrowDisabled: { opacity: 0.3 },
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
