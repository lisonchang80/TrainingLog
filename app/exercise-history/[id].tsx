import {
  Stack,
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
} from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
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
import { randomUUID } from 'expo-crypto';

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
import { getActiveSession } from '@/src/adapters/sqlite/sessionRepository';
import {
  replayCardSetsFromHistoricalSession,
  replayClusterCardSetsFromHistoricalSession,
} from '@/src/adapters/sqlite/setRepository';
import { getUnitPreference } from '@/src/adapters/sqlite/settingsRepository';
import { formatWeight, kgToDisplay } from '@/src/domain/body/unitConversion';
import type { UnitPreference } from '@/src/domain/body/types';
import { bucketLabel, classifyBucket } from '@/src/domain/pr/buckets';
import type { BucketKey } from '@/src/domain/pr/types';
import { effectiveLoad } from '@/src/domain/pr/e1rmEngine';
import { setVolume } from '@/src/domain/pr/volumeEngine';
import type { LoadType } from '@/src/domain/exercise/types';
import { computeHistorySetLabels } from '@/src/domain/set/historySetLabel';

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
  /** Raw input weight (in kg) for the weight-PR set. For load_type='assisted'
   *  this is the assistance amount (machine help); for 'loaded' / 'bodyweight'
   *  this equals weight_best. Threaded so the UI can show both effective +
   *  raw in the assisted case (user reload 2026-05-20: 「60 X 12 怎麼在歷史
   *  變成 3 X 12」— answer: 63 − 60 = 3 effective; show both for clarity). */
  weight_best_raw: number | null;
  weight_best_reps: number | null;
  weight_best_at: number | null;
  volume_best: number | null;
  volume_best_weight: number | null;
  /** Raw input weight for the volume-PR set (assisted-only meaningful). */
  volume_best_raw_weight: number | null;
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
import {
  parseSide,
  sideToPageIndex,
  pageIndexToSide,
  switcherArrowDisabled,
  type ClusterSide,
} from '@/src/domain/exercise/clusterSwitcher';
import {
  canReplayRow,
  classifyRowClusterShape,
  type ReplayTarget,
} from '@/src/domain/exercise/replayGate';

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
 *
 * Slice 10c overnight #16 — A↔B cluster paging: when caller passes
 * `partner=` and `clusterMode=cluster_only`, the body is wrapped in a
 * horizontal pagingEnabled ScrollView with two HistoryPageContent
 * instances (A on left, B on right). Each PageContent owns its own DB
 * queries / filter state — independent so a heavy query on one side
 * doesn't block the other and tap targets remain responsive. Swipe
 * gestures and the body-title arrow taps both route through scrollTo,
 * not router.replace, so the whole page doesn't re-mount on swap.
 */
export default function ExerciseHistoryScreen() {
  const {
    id,
    clusterMode: clusterModeParam,
    partner: partnerParam,
    side: sideParam,
    currentSeId: currentSeIdParam,
    currentSeIdA: currentSeIdAParam,
    currentSeIdB: currentSeIdBParam,
  } = useLocalSearchParams<{
    id: string;
    clusterMode?: string;
    partner?: string;
    side?: 'A' | 'B';
    // Slice 10c overnight #21 — owning card's session_exercise.id from the
    // current active session, used by the「再次訓練」button (SessionRow) to
    // overwrite the current card's sets with a historical session's sets.
    // - currentSeId: solo card context (caller is a solo ExerciseCard).
    // - currentSeIdA / currentSeIdB: cluster pair context (caller is a
    //   cluster card or cluster ⚙️ menu). Both must be set for cluster
    //   replay to fire; if only one is set, replay button is hidden.
    // - None of these set: caller is library / RS detail / pure browse,
    //   no in-progress card to replay onto → button hidden.
    currentSeId?: string;
    currentSeIdA?: string;
    currentSeIdB?: string;
  }>();
  const initialSide: ClusterSide = parseSide(sideParam);
  const db = useDatabase();
  const router = useRouter();
  const initialClusterMode = useMemo(
    () => parseClusterMode(clusterModeParam),
    [clusterModeParam]
  );
  // Wave 14 (2026-05-21) — when the caller (cluster card / solo card) passed
  // an explicit `clusterMode` in the URL, treat that as the caller's intent
  // and DO NOT let the persisted mailbox value overwrite it on hydration.
  // Library / chart-page round-trip / template-editor history (which omits
  // the param entirely) still falls back to mailbox.
  //
  // Rationale: user requirement —「以超級組打開動作歷史預設只含超級組 /
  // 以一般組打開預設不含超級組」. Pre-wave-14, opening from a solo card
  // could land on cluster_only because the previous superset visit had
  // persisted that mode into the mailbox.
  const hasExplicitClusterMode = useMemo(() => {
    const v = Array.isArray(clusterModeParam) ? clusterModeParam[0] : clusterModeParam;
    return v === 'exclude_cluster' || v === 'all' || v === 'cluster_only';
  }, [clusterModeParam]);

  // Partner-name lookup lives at the shell level so both PageContents
  // can render the body-title switcher consistently (each side shows
  // both arrows; their own name as the title).
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

  if (!id) return null;

  // Paging mode: caller wired up a cluster partner and asked for
  // cluster_only by default. Solo mode renders the original single page.
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
          hasExplicitClusterMode={hasExplicitClusterMode}
          db={db}
          currentSeId={currentSeIdParam ?? null}
          currentSeIdA={currentSeIdAParam ?? null}
          currentSeIdB={currentSeIdBParam ?? null}
        />
      ) : (
        <HistoryPageContent
          db={db}
          exerciseId={id}
          partnerExerciseId={partnerParam ?? null}
          partnerName={partnerName}
          selfName={selfName}
          initialClusterMode={initialClusterMode}
          hasExplicitClusterMode={hasExplicitClusterMode}
          showSwitcher={false}
          currentSide="A"
          onRequestSwap={undefined}
          currentSeId={currentSeIdParam ?? null}
          currentSeIdA={currentSeIdAParam ?? null}
          currentSeIdB={currentSeIdBParam ?? null}
        />
      )}
    </SafeAreaView>
  );
}

/**
 * Horizontal paging shell — 2 PageContents in a pagingEnabled ScrollView.
 * Owns scroll ref + current-side state + URL sync.
 */
function PagingShell({
  idA,
  idB,
  initialSide,
  nameA,
  nameB,
  initialClusterMode,
  hasExplicitClusterMode,
  db,
  currentSeId,
  currentSeIdA,
  currentSeIdB,
}: {
  idA: string;
  idB: string;
  initialSide: ClusterSide;
  nameA: string | null;
  nameB: string | null;
  initialClusterMode: ClusterFilterMode;
  hasExplicitClusterMode: boolean;
  db: Database;
  // Slice 10c overnight #21 — passed through verbatim to both PageContents
  // so each side's SessionRow can mount the「再次訓練」button. Both pages
  // see the same cluster pair ids; the helper invocation is positional
  // (A→A, B→B) regardless of which side is currently visible.
  currentSeId: string | null;
  currentSeIdA: string | null;
  currentSeIdB: string | null;
}) {
  const router = useRouter();
  // RN ScrollView doesn't accept a percent-based contentOffset, so we
  // measure the viewport on first onLayout and use that as the page
  // width. Until then we render with width=0 children (collapsed)
  // briefly — acceptable because layout completes synchronously.
  const [pageWidth, setPageWidth] = useState<number>(() =>
    Dimensions.get('window').width
  );
  const scrollRef = useRef<ScrollView | null>(null);
  const [currentSide, setCurrentSide] = useState<ClusterSide>(initialSide);
  // Track whether we've performed the initial scroll so we don't re-jump
  // on every re-render (e.g. partner-name resolution).
  const didInitialScrollRef = useRef(false);

  const onLayout = useCallback(
    (e: { nativeEvent: { layout: { width: number } } }) => {
      const w = e.nativeEvent.layout.width;
      if (w > 0 && w !== pageWidth) setPageWidth(w);
      if (!didInitialScrollRef.current && initialSide === 'B' && w > 0) {
        // Jump to B without animation on first layout (cold open on B
        // side, e.g. user tapped 動作歷史 (B) from cluster ⚙️ menu).
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
        // setParams (not router.replace) — purely a URL nudge; does not
        // re-mount the screen so the swipe-snap animation isn't
        // interrupted.
        router.setParams({ side: nextSide });
      }
    },
    [pageWidth, currentSide, router]
  );

  const onRequestSwap = useCallback(() => {
    const targetSide: ClusterSide = currentSide === 'A' ? 'B' : 'A';
    const targetX = sideToPageIndex(targetSide) * pageWidth;
    scrollRef.current?.scrollTo({ x: targetX, y: 0, animated: true });
    // Optimistic update; onMomentumScrollEnd will reconcile if needed.
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
        <HistoryPageContent
          db={db}
          exerciseId={idA}
          partnerExerciseId={idB}
          partnerName={nameB}
          selfName={nameA}
          initialClusterMode={initialClusterMode}
          hasExplicitClusterMode={hasExplicitClusterMode}
          showSwitcher={true}
          currentSide={currentSide}
          onRequestSwap={onRequestSwap}
          currentSeId={currentSeId}
          currentSeIdA={currentSeIdA}
          currentSeIdB={currentSeIdB}
        />
      </View>
      <View style={{ width: pageWidth }}>
        <HistoryPageContent
          db={db}
          exerciseId={idB}
          partnerExerciseId={idA}
          partnerName={nameA}
          selfName={nameB}
          initialClusterMode={initialClusterMode}
          hasExplicitClusterMode={hasExplicitClusterMode}
          showSwitcher={true}
          currentSide={currentSide}
          onRequestSwap={onRequestSwap}
          currentSeId={currentSeId}
          currentSeIdA={currentSeIdA}
          currentSeIdB={currentSeIdB}
        />
      </View>
    </ScrollView>
  );
}

/**
 * Per-page body: header card + chips + segmented + advanced + timeline.
 * Owns its own DB fetch + filter state — two PageContents on the screen
 * are fully isolated (one's filter changes don't bleed into the other).
 */
function HistoryPageContent({
  db,
  exerciseId,
  partnerExerciseId,
  partnerName,
  selfName: _selfName,
  initialClusterMode,
  hasExplicitClusterMode,
  showSwitcher,
  currentSide,
  onRequestSwap,
  currentSeId,
  currentSeIdA,
  currentSeIdB,
}: {
  db: Database;
  exerciseId: string;
  partnerExerciseId: string | null;
  partnerName: string | null;
  selfName: string | null;
  initialClusterMode: ClusterFilterMode;
  /**
   * Wave 14 (2026-05-21): true when the caller's URL contained an explicit
   * `clusterMode=...` param (cluster card / solo card / superset detail
   * page / template editor — all pass a value). When true, the mailbox
   * hydrate logic skips overwriting `clusterMode` so the caller's intent
   * wins. False for library / 解剖頁 entry which omits the param.
   */
  hasExplicitClusterMode: boolean;
  showSwitcher: boolean;
  currentSide: ClusterSide;
  onRequestSwap: (() => void) | undefined;
  // Slice 10c overnight #21 — see top-level page comment. Used by the
  //「再次訓練」button on each SessionRow.
  currentSeId: string | null;
  currentSeIdA: string | null;
  currentSeIdB: string | null;
}) {
  const router = useRouter();
  const [header, setHeader] = useState<ExerciseHistoryHeader | null>(null);
  const [hasClusterRows, setHasClusterRows] = useState(false);
  const [sessions, setSessions] = useState<ExerciseHistorySession[]>([]);
  const [programs, setPrograms] = useState<{ id: string; name: string }[]>([]);
  const [unit, setUnit] = useState<UnitPreference>('kg');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Filter state (per-page; not synced across A/B sides).
  const [bucketFilters, setBucketFilters] = useState<Set<RepBucketChip>>(
    new Set()
  );
  const [programId, setProgramId] = useState<string | null>(null);
  const [subTagFilters, setSubTagFilters] = useState<Set<string>>(new Set());
  const [clusterMode, setClusterMode] =
    useState<ClusterFilterMode>(initialClusterMode);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [programPickerOpen, setProgramPickerOpen] = useState(false);

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

  // Hydrate filter from mailbox on focus + refresh data. Mailbox is
  // singleton across both sides — first PageContent to mount on focus
  // wins, the other will overwrite the same data. Acceptable because
  // mailbox is "user's last intent" not "this side's filter".
  //
  // Wave 14 (2026-05-21) — `hasExplicitClusterMode` skips mailbox
  // overwrite of cluster mode so the caller's URL value wins. Other
  // mailbox fields (buckets / programId / subTags) still hydrate because
  // they aren't caller-driven.
  useFocusEffect(
    useCallback(() => {
      refresh();
      const f = peekFilter();
      if (f) {
        setBucketFilters(new Set(f.buckets));
        setProgramId(f.programId);
        setSubTagFilters(new Set(f.subTags));
        if (!hasExplicitClusterMode) {
          setClusterMode(f.clusterMode);
        }
        if (f.buckets.size > 0 || f.programId != null || f.subTags.size > 0) {
          setAdvancedOpen(true);
        }
      }
    }, [refresh, hasExplicitClusterMode])
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

  const prs = useMemo<PRSnapshotWithDate[]>(() => {
    if (!header) return [];
    return computePRs(sessions, header.load_type);
  }, [sessions, header]);

  const [prSectionOpen, setPrSectionOpen] = useState(false);

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
    const newSubTags = new Set<string>();
    setSubTagFilters(newSubTags);
    persistFilter(bucketFilters, newPid, newSubTags, clusterMode);
    setProgramPickerOpen(false);
  };

  const onJumpToChart = () => {
    persistFilter(bucketFilters, programId, subTagFilters, clusterMode);
    // replace (not push) to avoid stacking two screens — see ADR-0017
    // Q14 amendment notes. Carry partner + clusterMode + side so chart
    // page mirrors the paging shell on cold open.
    const query = partnerExerciseId
      ? `?clusterMode=${clusterMode}&partner=${partnerExerciseId}&side=${currentSide}`
      : '';
    router.replace(`/exercise-chart/${exerciseId}${query}`);
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

  // Slice 10c overnight #21 —「再次訓練」button gating.
  //   - cluster mode: need BOTH ids (A + B) to do the cluster replay.
  //   - solo mode: need currentSeId.
  //   - library / pure browse: neither set → button hidden.
  // The two flags are mutually exclusive in practice (cluster callsites
  // never pass currentSeId, solo callsites never pass the A/B pair) but
  // we treat cluster as taking precedence if both happen to be passed.
  //
  // Wave 14 (2026-05-21) — gating is now per-row (not page-level). The
  // `replayTarget` object below describes the target shape; each
  // SessionRow classifies its own cluster shape and combines them via
  // `canReplayRow` (src/domain/exercise/replayGate.ts). Pre-wave-14 a
  // global `canReplay` lit up every row uniformly, allowing the user to
  // tap ↻ on a solo source row even though the target was a cluster
  // (and vice versa) — that path errored mid-replay ("找不到該超級組 B 側
  // 來源卡") instead of being blocked at the UI.
  const isClusterReplay = currentSeIdA != null && currentSeIdB != null;
  const replayTarget: ReplayTarget = isClusterReplay
    ? {
        kind: 'cluster',
        currentSeIdA: currentSeIdA!,
        currentSeIdB: currentSeIdB!,
        partnerExerciseId: partnerExerciseId ?? '',
      }
    : currentSeId != null
      ? { kind: 'solo', currentSeId }
      : { kind: 'none' };

  // Slice 10c overnight #21 Commit 4 —「再次訓練」live handler.
  //
  // Flow: confirm via Alert → resolve active session id → wipe + replay
  // (solo or cluster helper depending on canReplay branch) → router.back()
  // → Today tab's useFocusEffect re-fetches and shows the new sets with
  // is_logged=0 ready for user ✓.
  //
  // Active session id: fetched lazily via getActiveSession on confirm
  // rather than threaded through URL params (alternative was a
  // currentSessionId URL param, but that bloats every callsite for a
  // value the DB can resolve on demand). If no active session is found
  // (user opened history from library while no in-progress session
  // existed), we surface a friendly error — but this shouldn't happen in
  // practice because canReplay=true requires a currentSeId, which only
  // gets passed when there IS an in-progress session.
  const onReplay = useCallback(
    (sourceSession: ExerciseHistorySession) => {
      const setCount = sourceSession.sets.length;
      const title = isClusterReplay
        ? '再次訓練（超級組）？'
        : '再次訓練？';
      const msg = isClusterReplay
        ? `將砍掉目前這組超級組 A+B 兩側所有 sets，依該 session 的 ${setCount} 組記錄重新建立。\n\n（is_logged 會重置為未 ✓ 狀態，weight / reps / set_kind 會複製，notes 不複製）`
        : `將砍掉目前這張卡片所有 sets，依該 session 的 ${setCount} 組記錄重新建立。\n\n（is_logged 會重置為未 ✓ 狀態，weight / reps / set_kind 會複製，notes 不複製）`;

      Alert.alert(title, msg, [
        { text: '取消', style: 'cancel' },
        {
          text: '覆蓋',
          style: 'destructive',
          onPress: async () => {
            try {
              const activeSession = await getActiveSession(db);
              if (!activeSession) {
                Alert.alert(
                  '無法覆蓋',
                  '找不到進行中的訓練 session。請先回 Today 頁開始一次訓練後再試。',
                );
                return;
              }
              if (isClusterReplay) {
                // #27 source isolation — look up the source session's RS A/B
                // session_exercise rows so the replay helper can scope the
                // source SELECT by card (not by exercise_id alone, which
                // would conflate a sibling solo Bench card with the RS A
                // Bench card in the same source session).
                const sourceA = await db.getFirstAsync<{ id: string }>(
                  `SELECT id FROM session_exercise
                    WHERE session_id = ?
                      AND exercise_id = ?
                      AND parent_id IS NULL
                      AND reusable_superset_id IS NOT NULL
                    ORDER BY ordering ASC
                    LIMIT 1`,
                  sourceSession.session_id,
                  exerciseId,
                );
                if (!sourceA) {
                  Alert.alert('覆蓋失敗', '找不到該超級組 A 側來源卡。');
                  return;
                }
                const sourceB = await db.getFirstAsync<{ id: string }>(
                  `SELECT id FROM session_exercise
                    WHERE session_id = ?
                      AND exercise_id = ?
                      AND parent_id = ?
                    LIMIT 1`,
                  sourceSession.session_id,
                  partnerExerciseId!,
                  sourceA.id,
                );
                if (!sourceB) {
                  Alert.alert('覆蓋失敗', '找不到該超級組 B 側來源卡。');
                  return;
                }
                await replayClusterCardSetsFromHistoricalSession(db, {
                  current_session_id: activeSession.id,
                  current_se_id_a: currentSeIdA!,
                  current_se_id_b: currentSeIdB!,
                  source_session_id: sourceSession.session_id,
                  source_session_exercise_id_a: sourceA.id,
                  source_session_exercise_id_b: sourceB.id,
                  source_exercise_id_a: exerciseId,
                  source_exercise_id_b: partnerExerciseId!,
                  uuid: randomUUID,
                });
              } else {
                // #27 source isolation — look up the source session's solo
                // (non-RS, no parent) card for this exercise.
                const sourceCard = await db.getFirstAsync<{ id: string }>(
                  `SELECT id FROM session_exercise
                    WHERE session_id = ?
                      AND exercise_id = ?
                      AND parent_id IS NULL
                      AND reusable_superset_id IS NULL
                    ORDER BY ordering ASC
                    LIMIT 1`,
                  sourceSession.session_id,
                  exerciseId,
                );
                if (!sourceCard) {
                  Alert.alert('覆蓋失敗', '找不到該動作來源卡。');
                  return;
                }
                await replayCardSetsFromHistoricalSession(db, {
                  current_session_id: activeSession.id,
                  current_se_id: currentSeId!,
                  source_session_id: sourceSession.session_id,
                  source_session_exercise_id: sourceCard.id,
                  source_exercise_id: exerciseId,
                  uuid: randomUUID,
                });
              }
              // Back to Today — its useFocusEffect re-fetches plan +
              // setsInSession so the user sees the replayed sets land.
              router.back();
            } catch (e) {
              Alert.alert(
                '覆蓋失敗',
                e instanceof Error ? e.message : String(e),
              );
            }
          },
        },
      ]);
    },
    [
      db,
      isClusterReplay,
      currentSeId,
      currentSeIdA,
      currentSeIdB,
      exerciseId,
      partnerExerciseId,
      router,
    ],
  );

  return (
    <>
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
              onRequestSwap={onRequestSwap}
              partnerName={partnerName}
              currentSide={currentSide}
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
              onRequestSwap={onRequestSwap}
              partnerName={partnerName}
              currentSide={currentSide}
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

            {hasClusterRows ? (
              <ClusterModeSegmented value={clusterMode} onChange={onClusterModeTap} />
            ) : null}

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
                  <Text style={styles.advancedLabel}>週期</Text>
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

            <View style={{ gap: 8 }}>
              {filteredSessions.length === 0 ? (
                <Text style={styles.empty}>篩選條件下沒有紀錄。</Text>
              ) : (
                filteredSessions.map((sess) => {
                  const rowShape = classifyRowClusterShape(sess.sets);
                  const rowIsCluster =
                    rowShape.kind === 'cluster' || rowShape.kind === 'cluster_mixed';
                  const rowCanReplay = canReplayRow(rowShape, replayTarget);
                  return (
                    <SessionRow
                      key={sess.session_id}
                      session={sess}
                      expanded={expanded.has(sess.session_id)}
                      onToggle={() => toggleExpand(sess.session_id)}
                      loadType={header.load_type}
                      unit={unit}
                      canReplay={rowCanReplay}
                      rowIsCluster={rowIsCluster}
                      onReplay={() => onReplay(sess)}
                    />
                  );
                })
              )}
            </View>
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
    </>
  );
}

function HeaderCard({
  header,
  prs,
  unit,
  prSectionOpen,
  togglePrSection,
  showSwitcher,
  onRequestSwap,
  partnerName,
  currentSide,
}: {
  header: ExerciseHistoryHeader;
  prs: PRSnapshotWithDate[];
  unit: UnitPreference;
  prSectionOpen: boolean;
  togglePrSection: () => void;
  showSwitcher: boolean;
  onRequestSwap: (() => void) | undefined;
  partnerName: string | null;
  currentSide: ClusterSide;
}) {
  // Boundary dim — arrow pointing at the current side's edge has no
  // further partner to swap to. Pure-logic in clusterSwitcher.ts.
  const leftDisabled = switcherArrowDisabled(currentSide, 'left');
  const rightDisabled = switcherArrowDisabled(currentSide, 'right');
  const visiblePRs = prSectionOpen
    ? prs
    : prs.filter((p) => p.key === 'all');

  return (
    <View style={styles.headerCard}>
      {showSwitcher ? (
        <View style={styles.headerNameRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={leftDisabled ? '已是 A 側' : `切換到 ${partnerName}`}
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
            {header.exercise_name}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={rightDisabled ? '已是 B 側' : `切換到 ${partnerName}`}
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
                重量 {formatHistoryWeight(pr.weight_best, pr.weight_best_raw, header.load_type, unit)}
                {pr.weight_best_reps != null ? ` × ${pr.weight_best_reps}` : ''}
                {pr.weight_best_at != null ? `（${formatDate(pr.weight_best_at)}）` : ''}
              </Text>
              <Text style={styles.prValue}>
                容量 {formatVolume(pr.volume_best, unit)}
                {pr.volume_best_weight != null && pr.volume_best_reps != null
                  ? ` (${formatHistoryWeight(pr.volume_best_weight, pr.volume_best_raw_weight, header.load_type, unit)} × ${pr.volume_best_reps})`
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
    weight_best_raw: null,
    weight_best_reps: null,
    weight_best_at: null,
    volume_best: null,
    volume_best_weight: null,
    volume_best_raw_weight: null,
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

  // 2026-05-20: track raw alongside eff so assisted display can render
  //「<eff> kg（助力 <raw> kg）」(user reload feedback).
  const update = (
    key: PRKey,
    eff: number,
    raw: number,
    reps: number,
    v: number,
    at: number,
  ) => {
    const snap = acc[key];
    if (snap.weight_best == null || eff > snap.weight_best) {
      snap.weight_best = eff;
      snap.weight_best_raw = raw;
      snap.weight_best_reps = reps;
      snap.weight_best_at = at;
    }
    if (snap.volume_best == null || v > snap.volume_best) {
      snap.volume_best = v;
      snap.volume_best_weight = eff;
      snap.volume_best_raw_weight = raw;
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

      update('all', eff, s.weight_kg, s.reps, v, at);
      if (bucket) update(bucket, eff, s.weight_kg, s.reps, v, at);
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
  canReplay,
  rowIsCluster,
  onReplay,
}: {
  session: ExerciseHistorySession;
  expanded: boolean;
  onToggle: () => void;
  loadType: 'loaded' | 'bodyweight' | 'assisted';
  unit: UnitPreference;
  // Slice 10c overnight #21 —「再次訓練」button affordance.
  //
  // Wave 14 (2026-05-21): now per-row, not page-level. True iff the row's
  // cluster shape is compatible with the page's replay target (see
  // `canReplayRow` in `src/domain/exercise/replayGate.ts`). Library / RS
  // detail browse paths still leave this false uniformly (target.kind='none').
  canReplay: boolean;
  /**
   * True iff this session row contains at least one cluster set (after
   * `clusterMode` filtering). Drives the `[超]` prefix on the date line
   * — user requirement, wave 14: cluster rows should be visually
   * distinguishable from solo rows on the same list.
   */
  rowIsCluster: boolean;
  onReplay: () => void;
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

  // Slice 10c overnight #22 — replace `#{ordering}` with set-kind labels
  // (熱 / 1 / D1 …). Map is per-session so warmup / dropset counters reset
  // between sessions; memoised on session.sets so the expanded card doesn't
  // recompute on unrelated re-renders (collapse/expand still triggers it
  // exactly once).
  const labelMap = useMemo(
    () =>
      computeHistorySetLabels(
        session.sets.map((s) => ({
          id: s.set_id,
          set_kind: s.set_kind,
          ordering: s.ordering,
        }))
      ),
    [session.sets]
  );

  return (
    <Pressable onPress={onToggle} style={styles.sessionCard}>
      <View style={styles.sessionRowHeader}>
        <View style={styles.sessionDateRow}>
          {/* Wave 14 (2026-05-21) — purple「超」chip marks cluster session
              rows. Mirror styling from session/cluster-card.tsx's
              `supersetTag` palette (#5856D6 bg, white text, 4px corners,
              fontSize 11) so cluster identity reads consistently across
              session card / template editor / history list. */}
          {rowIsCluster ? <Text style={styles.supersetTag}>超</Text> : null}
          <Text style={styles.sessionDate}>{dateLabel}</Text>
        </View>
        <Text style={styles.sessionMeta}>
          {session.sets.length} 組 · 容量 {formatVolume(totalVolume, unit)}
        </Text>
      </View>
      {topSet ? (
        <Text style={styles.topSetLine}>
          頂組：{formatHistoryWeight(topSet.eff, topSet.set.weight_kg ?? null, loadType, unit)} × {topSet.set.reps}
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
                <Text style={styles.setLabel}>
                  {labelMap.get(set.set_id) ?? '—'}
                </Text>
                <Text style={styles.setText}>
                  {formatHistoryWeight(eff, set.weight_kg, loadType, unit)} × {set.reps ?? '—'}
                </Text>
                <Text style={styles.setBucket}>
                  {bucket ? bucketLabel(bucket) : '—'}
                </Text>
              </View>
            );
          })}
          {canReplay ? (
            <Pressable
              onPress={(e) => {
                // Stop the Pressable bubble so the outer card's onToggle
                // (which collapses the row) doesn't fire and yank the
                // alert away. RN Pressable doesn't have a true bubble
                // model, but on iOS the inner Pressable wins focus and
                // the outer's onPress is suppressed — defensive guard.
                e.stopPropagation?.();
                onReplay();
              }}
              style={({ pressed }) => [
                styles.replayBtn,
                pressed && styles.btnPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="再次訓練 — 覆蓋目前卡片的 sets">
              <Text style={styles.replayBtnText}>↻ 再次訓練</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

function formatPRWeight(kgValue: number | null, unit: UnitPreference): string {
  if (kgValue == null || !Number.isFinite(kgValue)) return '—';
  return formatWeight(kgValue, unit);
}

/**
 * History weight formatter — wraps `formatPRWeight` with an assisted-only
 * suffix「（助力 <raw> kg）」so users see both effective load (what they
 * actually lifted) AND raw input (what they typed into the assistance
 * field). For loaded / bodyweight exercises, raw === eff so we render only
 * the effective value (no suffix needed). NULL raw on assisted (defensive,
 * shouldn't happen in production but possible for PR snapshots predating
 * the raw-tracking) falls back to eff-only.
 *
 * User reload feedback (2026-05-20): 「60 X 12 怎麼在歷史變成 3 X 12」—
 * answer: 63 (bw) − 60 (assistance) = 3 effective. Show both for clarity.
 */
function formatHistoryWeight(
  effKg: number | null,
  rawKg: number | null,
  loadType: LoadType,
  unit: UnitPreference,
): string {
  if (effKg == null || !Number.isFinite(effKg)) return '—';
  const effStr = formatWeight(effKg, unit);
  if (loadType !== 'assisted') return effStr;
  if (rawKg == null || !Number.isFinite(rawKg)) return effStr;
  return `${effStr}（助力 ${formatWeight(rawKg, unit)}）`;
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
  pager: { flex: 1 },
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
  sessionRowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sessionDateRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sessionDate: { fontSize: 14, fontWeight: '600' },
  sessionMeta: { fontSize: 12, opacity: 0.7 },
  // Wave 14 (2026-05-21) — purple「超」chip on cluster session rows.
  // Palette mirrors components/session/cluster-card.tsx::supersetTag
  // (#5856D6 iOS system indigo/purple, white text, 4px corners). Keep
  // these in sync if either palette changes.
  supersetTag: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
    backgroundColor: '#5856D6',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
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
  // Slice 10c overnight #22 — set-kind label column (熱 / 1 / D1 …)
  // replaces the previous `#{ordering}` text. Slightly bolder + larger
  // than the old caption so "熱" / "D2" are immediately readable on the
  // expanded card; same fixed width keeps the value column aligned.
  setLabel: {
    fontSize: 13,
    fontWeight: '600',
    opacity: 0.85,
    width: 28,
  },
  setText: { fontSize: 13, flex: 1 },
  setBucket: { fontSize: 11, opacity: 0.7 },
  // Slice 10c overnight #21 —「再次訓練」button (SessionRow expanded).
  // iOS-system blue + white text, centered, modest padding so it doesn't
  // dominate the set list above it.
  replayBtn: {
    marginTop: 8,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#007AFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  replayBtnText: {
    color: 'white',
    fontSize: 15,
    fontWeight: '600',
  },
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
  // Slice 10c overnight #13 — dim boundary arrow (current side has no
  // further partner to swap to). 0.3 matches iOS toolbar disabled-tint feel.
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
