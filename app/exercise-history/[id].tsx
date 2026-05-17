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

import { useDatabase } from '@/components/database-provider';
import {
  getExerciseHistoryHeader,
  hasClusterHistory,
  listExerciseHistoryBySession,
  listProgramsForExercise,
  type ExerciseHistoryHeader,
  type ExerciseHistorySession,
  type ExerciseHistorySet,
} from '@/src/adapters/sqlite/exerciseHistoryRepository';
import { getExerciseName } from '@/src/adapters/sqlite/exerciseRepository';
import { getUnitPreference } from '@/src/adapters/sqlite/settingsRepository';
import { formatWeight, kgToDisplay } from '@/src/domain/body/unitConversion';
import type { UnitPreference } from '@/src/domain/body/types';
import { bucketLabel, classifyBucket } from '@/src/domain/pr/buckets';
import type { BucketKey } from '@/src/domain/pr/types';
import { effectiveLoad } from '@/src/domain/pr/e1rmEngine';
import { setVolume } from '@/src/domain/pr/volumeEngine';
import type { LoadType } from '@/src/domain/exercise/types';

type PRKey = 'all' | BucketKey;

const PR_ORDER: PRKey[] = [
  'all',
  'max_strength',
  'strength',
  'hypertrophy',
  'muscle_endurance',
  'endurance',
];

const PR_LABEL: Record<PRKey, string> = {
  all: '全部',
  max_strength: '最大力量',
  strength: '力量',
  hypertrophy: '增肌',
  muscle_endurance: '肌耐力',
  endurance: '耐力',
};

interface PRSnapshotWithDate {
  key: PRKey;
  weight_best: number | null;
  weight_best_reps: number | null;
  weight_best_at: number | null;
  volume_best: number | null;
  volume_best_weight: number | null;
  volume_best_reps: number | null;
  volume_best_at: number | null;
}
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

/**
 * Exercise History — cross-Template, cross-Program aggregate (ADR-0006).
 *
 * Filter surface (shared with /exercise-chart/[id] via historyFilterMailbox):
 *   - rep bucket multi-select (top-level chip row)
 *   - Program 週期 + 強度 multi-select (collapsible 進階篩選 section)
 *
 * Bucket + Program/sub_tag combine with AND.
 *
 * Default state: no filter (= 全部). User toggles chips; 全部 is mutually
 * exclusive with bucket chips per ADR-0017 Q14 second amendment.
 */
export default function ExerciseHistoryScreen() {
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
  // Slice 10c overnight #11 — cluster A↔B switcher; null when no partner
  // param or lookup miss (archived/missing exercise → fall back to plain title).
  const [partnerName, setPartnerName] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ExerciseHistorySession[]>([]);
  const [programs, setPrograms] = useState<{ id: string; name: string }[]>([]);
  const [unit, setUnit] = useState<UnitPreference>('kg');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Filter state (mirrored to mailbox on every change)
  const [bucketFilters, setBucketFilters] = useState<Set<RepBucketChip>>(
    new Set()
  );
  const [programId, setProgramId] = useState<string | null>(null);
  const [subTagFilters, setSubTagFilters] = useState<Set<string>>(new Set());
  // Slice 10c: 3-段 cluster mode. URL param takes precedence over mailbox on
  // first focus (caller decided the default — e.g. cluster ⚙️ → cluster_only).
  const [clusterMode, setClusterMode] = useState<ClusterFilterMode>(
    parseClusterMode(clusterModeParam)
  );
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [programPickerOpen, setProgramPickerOpen] = useState(false);

  // Slice 10c overnight #12 — A↔B switcher moved to body title (left/right
  // arrows around exercise name). Visible only in cluster_only mode with a
  // resolved partner. Tapping either arrow swaps A↔B by router.replace-ing
  // the partner route and swapping the partner param back to current id.
  // Mailbox keeps segment + bucket filters intact across the swap.
  const showSwitcher =
    clusterMode === 'cluster_only' && !!partnerParam && !!partnerName;

  const onSwapPartner = useCallback(() => {
    if (!id || !partnerParam) return;
    router.replace(
      `/exercise-history/${partnerParam}?clusterMode=cluster_only&partner=${id}`
    );
  }, [id, partnerParam, router]);

  const screenOptions = useMemo(
    () => ({
      title: '動作歷史',
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
      // Slice 10c overnight #11 — A↔B switcher partner name lookup. Skip the
      // DB call entirely when caller didn't pass `partner=` (most non-cluster
      // entrypoints) → setPartnerName(null) → switcher hidden.
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

  // Hydrate filter from mailbox on focus + refresh data.
  // URL clusterMode param wins on cold open; mailbox wins on warm re-focus.
  useFocusEffect(
    useCallback(() => {
      refresh();
      const f = peekFilter();
      if (f) {
        setBucketFilters(new Set(f.buckets));
        setProgramId(f.programId);
        setSubTagFilters(new Set(f.subTags));
        setClusterMode(f.clusterMode);
        if (
          f.buckets.size > 0 ||
          f.programId != null ||
          f.subTags.size > 0
        ) {
          setAdvancedOpen(true);
        }
      }
    }, [refresh])
  );

  // Persist filter changes back to mailbox
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

  const prs = useMemo<PRSnapshotWithDate[]>(() => {
    if (!header) return [];
    return computePRs(sessions, header.load_type);
  }, [sessions, header]);

  const [prSectionOpen, setPrSectionOpen] = useState(false);

  // Distinct sub_tags for the currently selected program
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
        // Program filter
        if (programId != null && s.program_id !== programId) return false;
        // Sub_tag filter (only if any selected)
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
        // Slice 10c — cluster filter applied after bucket filter; both axes
        // are independent so order is irrelevant for correctness.
        const clustered = filterSetsByClusterMode(bucketed, clusterMode);
        return { ...s, sets: clustered };
      })
      .filter((s) => s.sets.length > 0);
  }, [sessions, bucketFilters, programId, subTagFilters, clusterMode]);

  if (!id) return null;

  const toggleExpand = (sid: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(sid)) next.delete(sid);
      else next.add(sid);
      return next;
    });
  };

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
    // Reset sub_tag when program changes
    const newSubTags = new Set<string>();
    setSubTagFilters(newSubTags);
    persistFilter(bucketFilters, newPid, newSubTags, clusterMode);
    setProgramPickerOpen(false);
  };

  const onJumpToChart = () => {
    persistFilter(bucketFilters, programId, subTagFilters, clusterMode);
    // replace (not push) to avoid stacking two modal screens — see ADR-0017
    // Q14 amendment notes; two stacked modals crash on Metro R reload.
    // Slice 10c overnight #11 — carry partner so the chart can render the
    // same A↔B switcher (even when clusterMode is not cluster_only, the chip
    // is harmless and lets the user toggle modes there without losing it).
    // clusterMode is also forwarded because chart cold-open reads URL first.
    const query = partnerParam
      ? `?clusterMode=${clusterMode}&partner=${partnerParam}`
      : '';
    router.replace(`/exercise-chart/${id}${query}`);
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
          <View>
            <HeaderCard
              header={header}
              prs={[]}
              unit={unit}
              prSectionOpen={prSectionOpen}
              togglePrSection={() => setPrSectionOpen((v) => !v)}
              showSwitcher={showSwitcher}
              onSwapPartner={onSwapPartner}
              partnerName={partnerName}
            />
            <Text style={styles.empty}>
              還沒有此動作的歷史紀錄。完成第 1 次 Session 後就會出現。
            </Text>
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            <HeaderCard
              header={header}
              prs={prs}
              unit={unit}
              prSectionOpen={prSectionOpen}
              togglePrSection={() => setPrSectionOpen((v) => !v)}
              showSwitcher={showSwitcher}
              onSwapPartner={onSwapPartner}
              partnerName={partnerName}
            />

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

            {/* 3-段 cluster filter (slice 10c) — only when this exercise has
                cluster history; otherwise all 3 segments would be identical. */}
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
                    {[programId ? '1 Program' : null, subTagFilters.size > 0 ? `${subTagFilters.size} 副` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                )}
              </Pressable>
              {advancedOpen ? (
                <View style={styles.advancedBody}>
                  {/* Program dropdown */}
                  <Text style={styles.advancedLabel}>Program 主</Text>
                  <Pressable
                    style={styles.dropdown}
                    onPress={() => setProgramPickerOpen(true)}>
                    <Text style={styles.dropdownText}>
                      {selectedProgram ? selectedProgram.name : '— 尚未選擇 —'}
                    </Text>
                    <Text style={styles.dropdownChevron}>▾</Text>
                  </Pressable>

                  {/* Sub_tag buttons */}
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

                  {/* Bottom 2 buttons */}
                  <View style={styles.actionRow}>
                    <Pressable
                      style={({ pressed }) => [
                        styles.actionBtn,
                        styles.actionBtnPrimary,
                        pressed && styles.btnPressed,
                      ]}
                      onPress={onJumpToChart}>
                      <Text style={styles.actionBtnTextPrimary}>轉圖表</Text>
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

            {/* Timeline */}
            <View style={{ gap: 8 }}>
              {filteredSessions.length === 0 ? (
                <Text style={styles.empty}>篩選條件下沒有紀錄。</Text>
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

      </ScrollView>

      {/* Program picker modal */}
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

function HeaderCard({
  header,
  prs,
  unit,
  prSectionOpen,
  togglePrSection,
  showSwitcher,
  onSwapPartner,
  partnerName,
}: {
  header: ExerciseHistoryHeader;
  prs: PRSnapshotWithDate[];
  unit: UnitPreference;
  prSectionOpen: boolean;
  togglePrSection: () => void;
  showSwitcher: boolean;
  onSwapPartner: () => void;
  partnerName: string | null;
}) {
  // Collapsed: only render 'all'. Expanded: render all (全部 + 5 buckets).
  const visiblePRs = prSectionOpen
    ? prs
    : prs.filter((p) => p.key === 'all');

  return (
    <View style={styles.headerCard}>
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
      <Text style={styles.headerSubline}>
        共 {header.total_sessions} 次 Session · 最近 7 天 {header.sessions_last_7_days} 次
      </Text>
      <Text style={styles.headerLoadType}>
        類型：{LOAD_TYPE_LABEL[header.load_type]}
      </Text>
      {prs.length === 0 ? null : (
        <View style={styles.prList}>
          <Pressable onPress={togglePrSection} style={styles.prHeadingRow}>
            <Text style={styles.prHeading}>
              PR {prSectionOpen ? '▼' : '▶'}
            </Text>
          </Pressable>
          {visiblePRs.map((pr) => (
            <View key={pr.key} style={styles.prRow}>
              <Text style={styles.prBucket}>{PR_LABEL[pr.key]}</Text>
              <Text style={styles.prValue}>
                重量 {formatPRWeight(pr.weight_best, unit)}
                {pr.weight_best_reps != null ? ` × ${pr.weight_best_reps}` : ''}
                {pr.weight_best_at != null ? `（${formatDate(pr.weight_best_at)}）` : ''}
              </Text>
              <Text style={styles.prValue}>
                容量 {formatVolume(pr.volume_best, unit)}
                {pr.volume_best_weight != null && pr.volume_best_reps != null
                  ? ` (${formatPRWeight(pr.volume_best_weight, unit)} × ${pr.volume_best_reps})`
                  : ''}
                {pr.volume_best_at != null ? `（${formatDate(pr.volume_best_at)}）` : ''}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function computePRs(
  sessions: ExerciseHistorySession[],
  loadType: LoadType
): PRSnapshotWithDate[] {
  const empty = (key: PRKey): PRSnapshotWithDate => ({
    key,
    weight_best: null,
    weight_best_reps: null,
    weight_best_at: null,
    volume_best: null,
    volume_best_weight: null,
    volume_best_reps: null,
    volume_best_at: null,
  });
  const acc: Record<PRKey, PRSnapshotWithDate> = {
    all: empty('all'),
    max_strength: empty('max_strength'),
    strength: empty('strength'),
    hypertrophy: empty('hypertrophy'),
    muscle_endurance: empty('muscle_endurance'),
    endurance: empty('endurance'),
  };

  const update = (key: PRKey, eff: number, reps: number, v: number, at: number) => {
    const snap = acc[key];
    if (snap.weight_best == null || eff > snap.weight_best) {
      snap.weight_best = eff;
      snap.weight_best_reps = reps;
      snap.weight_best_at = at;
    }
    if (snap.volume_best == null || v > snap.volume_best) {
      snap.volume_best = v;
      snap.volume_best_weight = eff;
      snap.volume_best_reps = reps;
      snap.volume_best_at = at;
    }
  };

  for (const sess of sessions) {
    for (const s of sess.sets) {
      if (s.weight_kg == null || s.reps == null) continue;
      if (loadType === 'bodyweight' && s.weight_kg === 0) continue;
      if (loadType === 'assisted' && s.bw_snapshot_kg == null) continue;

      const eff = effectiveLoad(s.weight_kg, loadType, s.bw_snapshot_kg);
      if (eff == null) continue;
      if (loadType === 'assisted' && eff <= 0) continue;

      const v = setVolume({
        weight_kg: s.weight_kg,
        reps: s.reps,
        load_type: loadType,
        bw_snapshot_kg: s.bw_snapshot_kg,
      });
      if (v == null) continue;

      const bucket = classifyBucket(s.reps);
      const at = sess.session_started_at;

      update('all', eff, s.reps, v, at);
      if (bucket) update(bucket, eff, s.reps, v, at);
    }
  }

  return PR_ORDER.map((k) => acc[k]).filter((snap) => snap.weight_best != null);
}

function formatDate(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
 * iOS-style 3-段 segmented control for cluster filter (slice 10c).
 * Self-rolled Pressable+flexbox to avoid the platform-specific behavior of
 * @react-native-segmented-control/segmented-control (we don't already depend
 * on it; the spec forbids new deps). Active segment uses the page's accent
 * blue to match other chips' active state.
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

function formatPRWeight(kgValue: number | null, unit: UnitPreference): string {
  if (kgValue == null || !Number.isFinite(kgValue)) return '—';
  return formatWeight(kgValue, unit);
}

function formatVolume(kgVolume: number | null, unit: UnitPreference): string {
  if (kgVolume == null || !Number.isFinite(kgVolume)) return '—';
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
  prHeadingRow: { paddingVertical: 4 },
  prHeading: { fontSize: 12, fontWeight: '700', opacity: 0.7 },
  prRow: {
    gap: 2,
    paddingVertical: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.1)',
  },
  prBucket: { fontSize: 13, fontWeight: '700', color: '#0a7ea4' },
  prValue: { fontSize: 13 },
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
  headerBack: {
    color: '#0a7ea4',
    fontSize: 17,
    fontWeight: '400',
    paddingHorizontal: 8,
  },
  // Slice 10c overnight #12 — A↔B switcher relocated to body title row.
  // Arrow Pressables flank the exercise name; tap either to swap to partner.
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
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  modalRow: {
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.1)',
  },
  modalRowText: { fontSize: 15 },
  modalRowTextActive: { color: '#0a7ea4', fontWeight: '600' },
});
