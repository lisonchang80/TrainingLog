import { randomUUID } from 'expo-crypto';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import {
  Gesture,
  GestureDetector,
} from 'react-native-gesture-handler';
import {
  NestableScrollContainer,
  NestableDraggableFlatList,
  type RenderItemParams,
} from 'react-native-draggable-flatlist';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDatabase } from '@/components/database-provider';
import { ToastController, ToastHost } from '@/components/ui/Toast';
import { TemplateMetaSheet } from '@/components/session/template-meta-sheet';
import { SessionStatsPanel } from '@/components/session/session-stats-panel';
import { HRZoneChart } from '@/components/session/hr-zone-chart';
import type { HRSample } from '@/components/session/hr-zone-chart.behavior';
import { queryHeartRateSamples } from '@/src/adapters/healthkit';
import { SessionTimeEditorSheet } from '@/components/session/session-time-editor-sheet';
import { SessionTitleEditor } from '@/components/session/session-title-editor';
import { ClusterCard } from '@/components/session/cluster-card';
import {
  SetRowContent,
  type SetRowItem,
} from '@/components/shared/set-row-content';
import { SwipeableSetRow } from '@/components/shared/swipeable-set-row';
import { SetNoteSheet } from '@/components/shared/set-note-sheet';
import { ReorderExercisesSheet } from '@/components/shared/reorder-exercises-sheet';
import {
  buildSessionReorderRows,
  expandClusterIds,
} from '@/src/domain/session/reorderSessionItems';
import { NumericKeypad } from '@/components/shared/numeric-keypad';
import { SegmentedProgressBar } from '@/components/shared/segmented-progress-bar';
import {
  listPrograms,
  type ProgramSummary,
} from '@/src/adapters/sqlite/programRepository';
import {
  appendReusableSupersetToSession,
  appendSessionExercise,
  captureSessionSnapshot,
  countSessionExercises,
  deleteSessionExerciseAndSets,
  discardSession,
  getSession,
  listSessionExercisesWithName,
  reorderSessionExercises,
  restoreSessionFromSnapshot,
  updateSessionExerciseRestSec,
  type SessionExerciseRowWithName,
  type SessionSnapshot,
} from '@/src/adapters/sqlite/sessionRepository';
import { pushStartToWatch } from '@/src/services/watchSessionStart';
import { shouldFireFirstAddPush } from '@/src/services/freestyleFirstAddPush';
import { sessionSnapshotDirty } from '@/src/domain/session/sessionSnapshotDirty';
import {
  addClusterCycleAtEnd,
  addSessionDropsetCluster,
  addSessionDropsetRow,
  deleteClusterCycle,
  deleteSet,
  insertSessionSet,
  insertSessionSetAfter,
  listSetsBySession,
  prefillReusableSupersetFromLastSession,
  prefillSessionExerciseFromLastSession,
  recordSetInSession,
  removeSessionDropsetRow,
  reorderSessionSetsForExercise,
  updateSetFields,
  type SessionSetWithExercise,
} from '@/src/adapters/sqlite/setRepository';
import { getReusableSupersetWithExercises } from '@/src/adapters/sqlite/supersetRepository';
import {
  convertSessionToTemplate,
  getSessionLinkedTemplateTriple,
} from '@/src/adapters/sqlite/templateRepository';
import { formatTemplateTriple } from '@/src/domain/template/templateManager';
import {
  getExerciseNotes,
  updateExerciseNotes,
} from '@/src/adapters/sqlite/exerciseLibraryRepository';
import { consumePick } from '@/src/domain/exercise/pickerBridge';
import { listPriorSetsForExercise } from '@/src/adapters/sqlite/exerciseHistoryRepository';
import {
  groupClusterSides,
  type ClusterGroup,
} from '@/src/domain/session/clusterCard';
import {
  computeDefaultTemplateName,
  computeDeleteConfirmMessage,
  shouldShowEditChip,
} from '@/src/domain/session/sessionDetailLabels';
import {
  editSnapshotKey,
  isEditSnapshotStale,
  validateStoredEditSnapshot,
  type StoredEditSnapshot,
} from '@/src/domain/session/editSnapshotPersistence';
import {
  deleteSetting,
  getSetting,
  setSetting,
} from '@/src/adapters/sqlite/settingsRepository';
import { computeSessionSetLayout } from '@/src/domain/set/sessionSetLayout';
import { cycleSessionSetKindClusterAware } from '@/src/domain/set/cycleSessionSetKind';
import { computeExerciseProgress } from '@/src/domain/session/exerciseProgress';
import type { ReusableSupersetWithExercises } from '@/src/domain/superset/types';
import type { Session } from '@/src/domain/session/types';
import {
  buildSameDayNavState,
  parseSameDayIds,
  siblingId,
} from '@/src/domain/session/sameDayNav';
import { computeDetailPageStats } from '@/src/domain/session/sessionStats';
import { countUniqueExercises } from '@/src/domain/session/countUniqueExercises';
import { validateRecordSet } from '@/src/domain/set/validateRecordSet';
import {
  t,
  tDuplicateTemplateTriple,
  tExercise,
  tExerciseNoteHeader,
  tRemoveExerciseFromSessionPrompt,
  tRemoveSupersetFromSessionPrompt,
  tRestSecondsHeader,
  tTemplateCreated,
  tTemplateUpdated,
  tWarningPerExerciseSetsUnfinished,
  tWarningPerExerciseSetsWithLogged,
  tWarningTotalSetsUnfinished,
  tWarningTotalSetsWithLogged,
} from '@/src/i18n';
import { useTheme, type ThemeTokens } from '@/src/theme';

/**
 * Phase A placeholder HRmax (220 - 30). Used to position HR zone band
 * boundaries on the chart canvas while no real samples render. Phase B
 * will source from settings / HealthKit profile and pass per-user.
 */
const HRMAX_PLACEHOLDER = 190;

/**
 * ADR-0025 — DRY helper for the 5 components in this file that all need
 * the same memoised styles. Each calls `useSessionStyles()` instead of
 * repeating useTheme + useMemo (mirror app/(tabs)/library.tsx pattern).
 */
function useSessionStyles() {
  const { tokens } = useTheme();
  return useMemo(() => makeStyles(tokens), [tokens]);
}

/**
 * Session detail page — ADR-0019 Q10 final layout (slice 10c session detail).
 *
 * Mirrors the Template editor's chrome pattern (header + scroll body +
 * sticky bottom action bar). Reached from:
 *   - Today screen on End Session (router.push immediately after closing)
 *   - History tab on row tap (already-ended sessions, identical view)
 *
 * Layout (ADR-0019 Q10, expanded by Slice 13 Phase A Amendment 2026-05-25):
 *   - Header: title (session name or date fallback) + back button
 *   - 4-tile SessionStatsPanel (frozen mode — ended_at - started_at + tap to
 *     edit; 4th tile = 大卡, NULL in Phase A → '—', Phase B reads session.kcal)
 *   - HRZoneChart placeholder (Phase A renders chrome + grey empty hint;
 *     Phase B HealthKit ingest pipes real samples)
 *   - 動作清單: in read mode = SoloExerciseBlock / ClusterBlock simple display
 *     in edit mode = FULL active-session UI parity (ClusterCard + ExerciseCard
 *     mirrors with cluster CRUD + picker + drag + ⚙️ menu + swipe-delete +
 *     set_kind cycling + add cycle/dropset — minus rest timer + body data
 *     entry which are session-only).
 *   - 4-button sticky action bar:
 *       [編輯訓練/完成編輯] toggle
 *       [儲存模板] convertSessionToTemplate(mode='update')
 *       [另存模板] convertSessionToTemplate(mode='create') → TemplateMetaSheet
 *       [刪除] confirm Alert → discardSession → router.back()
 *
 * Edit-mode-specific differences from Today screen (overnight #59):
 *   - SessionStatsPanel rendered in frozen mode (ended_at - started_at,
 *     no live tick) + 訓練時間 tile tappable → SessionTimeEditorSheet.
 *   - tap-✓ on set toggles is_logged via updateSetFields but does NOT
 *     trigger RestTimerModal (no rest_timer state at all on this page).
 *   - No BodyDataSheet (already absent — kept removed).
 *
 * Note: prior to Slice 13a (2026-05-25) the detail page dropped the 大卡
 * tile and ran a 3-tile panel. Slice 13a wires the 4-tile variant + HR
 * zone chart placeholder so the structure is ready for Phase B HealthKit
 * ingest — both tile and chart render NULL/empty state in Phase A.
 */
export default function SessionDetailScreen() {
  // 2026-05-20 overnight #58 — ADR-0015 § Tap 日格行為: history calendar tap
  // emits ?sameDayIds=<csv> so the detail page can show ← N/M → switcher
  // between sessions sharing the same date. Absent param (e.g. opened from
  // Today end-session flow) → buildSameDayNavState degrades to single view.
  const { id, sameDayIds, dir } = useLocalSearchParams<{
    id: string;
    sameDayIds?: string;
    // #4 (2026-05-30) — 同日 session 切換方向。prev → 頁面從左滑入；
    // next / undefined(首次從歷史進入) → 從右滑入。驅動 <Stack.Screen>
    // 的 animation 讓「按左箭頭從左進、按右箭頭從右進」符合直覺。
    dir?: 'prev' | 'next';
  }>();
  const db = useDatabase();
  const router = useRouter();
  // ADR-0025 — token-driven styles for this screen.
  const styles = useSessionStyles();

  const navState = useMemo(
    () =>
      buildSameDayNavState({
        currentId: id ?? '',
        ids: parseSameDayIds(sameDayIds),
      }),
    [id, sameDayIds],
  );

  const goToSibling = useCallback(
    (direction: 'prev' | 'next') => {
      const target = siblingId(navState, direction);
      if (target == null) return;
      // router.replace (not push) so the back stack stays clean — from any
      // sibling, single back → returns to history tab.
      router.replace({
        pathname: '/session/[id]',
        params: {
          id: target,
          sameDayIds: navState.ids.join(','),
          // #4 — carry the nav direction so the incoming screen picks the
          // matching slide animation (prev=from-left / next=from-right).
          dir: direction,
        },
      });
    },
    [navState, router],
  );

  // Horizontal swipe gesture: ADR-0015 calls for swipe + ←/→ buttons in
  // parallel. Threshold = `dx > 80 OR velocityX > 600`; activeOffsetX = ±30
  // so the page-level pan only activates after meaningful horizontal motion,
  // letting vertical scroll and tap-to-edit children claim small motions.
  // `.runOnJS(true)` keeps the onEnd handler on the JS thread so we can call
  // router.replace directly without reanimated worklet bridging.
  const swipeGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-30, 30])
        .failOffsetY([-15, 15])
        .runOnJS(true)
        .onEnd((e) => {
          if (navState.total <= 1) return;
          const dx = e.translationX;
          const vx = e.velocityX;
          const passDist = Math.abs(dx) > 80;
          const passVel = Math.abs(vx) > 600;
          if (!passDist && !passVel) return;
          // Swipe-left (negative dx) → next; swipe-right (positive) → prev.
          if (dx < 0) {
            goToSibling('next');
          } else {
            goToSibling('prev');
          }
        }),
    [navState, goToSibling],
  );
  const [session, setSession] = useState<SessionWithHK | null>(null);
  /**
   * Slice 13c C4 — HR samples from HealthKit (live fetch each detail
   * page open per Q2). `null` = still loading OR query failed OR no
   * permission OR no samples in range; chart shows grey overlay + empty
   * hint in all these cases (Phase A behaviour preserved). `[]` (empty
   * array) also triggers overlay — only a populated array draws the
   * polyline.
   */
  const [hrSamples, setHrSamples] = useState<HRSample[] | null>(null);
  const [sets, setSets] = useState<SessionSetWithExercise[]>([]);
  const [sessionExercises, setSessionExercises] = useState<
    SessionExerciseRowWithName[]
  >([]);
  const [rsById, setRsById] = useState<
    Map<string, ReusableSupersetWithExercises>
  >(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);

  // Toast controller (Round F Q2 — replaces Alert.alert success on [儲存模板]).
  // Created once, kept alive for the entire page lifecycle; ToastHost subscribes.
  const toastRef = useRef<ToastController | null>(null);
  if (toastRef.current == null) {
    toastRef.current = new ToastController();
  }
  // 進入 edit mode 時拍 snapshot；按「完成」commit (清掉)、按「返回」若有
  // 變更 alert 確認後 restore；無變更則 silent exit。
  const [editSnapshot, setEditSnapshot] = useState<SessionSnapshot | null>(
    null,
  );
  // Detail 頁的 stats / time editor 永遠 frozen — 不該因為 session.ended_at 為
  // null（in-progress 邊角情況）而觸發 SessionStatsPanel 的 1-sec tick 或
  // SessionTimeEditorSheet 在 prop 漂移時 reset state。capture-once 在 mount 當
  // 下，作為任何 null ended_at 的 stable fallback (2026-05-20 fix)。
  const [viewOpenedAtMs] = useState(() => Date.now());
  // 動作清單「隱藏未打勾」開關 (2026-05-20)：on 時，set rows 中 is_logged!=1
  // (尚未打勾) 整體隱藏；cluster cycle 兩側皆未 logged 才隱藏整個 cycle
  // (保 pair 對齊)；若整個動作 / cluster 過濾後沒剩 set → 整張卡也不 render。
  const [hideUnchecked, setHideUnchecked] = useState(false);
  // ADR-0019 Q3 single-expanded card — only used in edit mode (mirror Today).
  const [expandedExerciseId, setExpandedExerciseId] = useState<string | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  // Per-set notes editor sheet — `null` means closed.
  const [noteSheetTarget, setNoteSheetTarget] =
    useState<{ set_id: string; initial: string | null } | null>(null);
  // Numeric keypad modal — `null` means closed (ADR-0019 Q6).
  const [keypadTarget, setKeypadTarget] = useState<{
    set_id: string;
    field: 'reps' | 'weight';
    current: number;
  } | null>(null);
  // Rest-sec keypad target — reuses NumericKeypad with a different field.
  const [restSecTarget, setRestSecTarget] = useState<{
    session_exercise_id: string;
    current: number;
    exercise_name: string;
  } | null>(null);
  // Exercise-level notes sheet target (📝 menu path). Reuses SetNoteSheet
  // with a custom title; the Exercise.notes column is global (per-Exercise,
  // not per-Session) per ADR-0017.
  const [exerciseNoteTarget, setExerciseNoteTarget] = useState<{
    exercise_id: string;
    exercise_name: string;
    initial: string | null;
  } | null>(null);
  // 🔃 reorder-exercises modal open flag.
  const [reorderSheetOpen, setReorderSheetOpen] = useState(false);
  // Tap-訓練時間 → time editor sheet (overnight #59).
  const [timeEditorOpen, setTimeEditorOpen] = useState(false);

  // 另存模板 bottom sheet state (2026-05-18). Sheet 在開啟時取一次 programs
  // 給 picker 用；sub_tags 由 sheet 內依選擇 program 動態查 (5/18 polish round 30).
  const [templateMetaSheetOpen, setTemplateMetaSheetOpen] = useState(false);
  const [programs, setPrograms] = useState<ProgramSummary[]>([]);
  const [templateMetaBusy, setTemplateMetaBusy] = useState(false);
  // 2026-05-20 overnight #55: prefill from the session's linked template if any.
  // Freestyle session → all three null (sheet opens blank, default name only).
  // Template-based session → linked template's (name, program_id, sub_tag)
  // pre-populate so user can either rename (creates an independent template)
  // or change (program, sub_tag) to spawn a sibling under ADR-0003 三元組 identity.
  const [templateMetaPrefill, setTemplateMetaPrefill] = useState<{
    name: string;
    program_id: string | null;
    sub_tag: string | null;
  } | null>(null);

  // ADR-0014 + ADR-0019 Q10 — header subtitle 「週期 · 強度」. Resolved from the
  // session's linked template (most-common non-null `session_exercise.template_id`).
  // `null` for freestyle sessions (no row carries a template_id) — caller hides
  // the subtitle row entirely. Refreshed inside `load()` so it stays in sync
  // with any edit-mode commit that adds/removes template-backed rows.
  const [sessionTemplateInfo, setSessionTemplateInfo] = useState<{
    template_name: string;
    program_name: string | null;
    sub_tag: string | null;
  } | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [s, ss, ses, hk] = await Promise.all([
        getSession(db, id),
        listSetsBySession(db, id),
        listSessionExercisesWithName(db, id),
        loadHealthkitColumns(db, id),
      ]);
      if (!s) {
        setError('Session not found.');
        setLoading(false);
        return;
      }
      setSession({ ...s, kcal: hk.kcal, avg_hr_bpm: hk.avg_hr_bpm });
      setSets(ss);
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

      // ADR-0014 + ADR-0019 Q10 — header subtitle 「週期 · 強度」. Best-effort:
      // if the lookup fails (e.g. linked template deleted between calls) we
      // silently clear so the subtitle row vanishes instead of stalling
      // the page. Freestyle sessions naturally resolve to null here.
      try {
        const linked = await getSessionLinkedTemplateTriple(db, id);
        setSessionTemplateInfo(
          linked
            ? {
                template_name: linked.template_name,
                program_name: linked.program_name,
                sub_tag: linked.sub_tag,
              }
            : null,
        );
      } catch {
        setSessionTemplateInfo(null);
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

  // Slice 13c C4 — HR samples live fetch (per Q2 + Q9). Fires when session
  // is loaded AND has ended (historical view). In-session live HR is
  // deferred to slice 13d (per Q4) — for active sessions, samples stays
  // null so the chart keeps its Phase A grey overlay. Reader never throws
  // (Q8): rejection / no permission / no data all return [], which the
  // chart treats the same as null (overlay + empty hint).
  useEffect(() => {
    if (!session || session.ended_at == null) {
      setHrSamples(null);
      return;
    }
    let cancelled = false;
    const startedAt = session.started_at;
    const endedAt = session.ended_at;
    (async () => {
      const samples = await queryHeartRateSamples(startedAt, endedAt);
      if (!cancelled) setHrSamples(samples.length > 0 ? samples : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  // ── Edit mode 進入 / 提交 / 捨棄 三條 path（2026-05-20 night transactional fix）──
  // 用戶反映「修改後按返回未按完成編輯仍然被記錄」。Snapshot/restore approach:
  // 進入 edit mode 時 snapshot session 全狀態、所有 edit op 仍直寫 DB、退出時
  // 用「完成」commit (drop snapshot) 或「返回」discard (restore snapshot)。
  const enterEditMode = useCallback(async () => {
    if (!id) return;
    try {
      const snap = await captureSessionSnapshot(db, id);
      if (!snap) {
        Alert.alert(t('alert', 'editFailed'), 'Session not found.');
        return;
      }
      setEditSnapshot(snap);
      setEditMode(true);
      // Card 12R / Round G Q1 — also persist to app_settings so an App
      // force-kill mid-edit can be recovered on next focus. Q2c 「覆蓋
      // 新 baseline」: setSetting uses INSERT OR REPLACE so each
      // enterEditMode overwrites any previous snapshot. Fire-and-forget;
      // if persist throws we still allow the in-memory edit to proceed.
      try {
        await setSetting<StoredEditSnapshot>(db, editSnapshotKey(id), {
          snap,
          savedAt: Date.now(),
        });
      } catch (persistErr) {
        // Non-fatal — log only. Worst case: this edit session won't be
        // recoverable on force-kill, but the edit itself proceeds.
        console.warn('[Card 12R] persist editSnapshot failed:', persistErr);
      }
    } catch (e) {
      Alert.alert(t('alert', 'editFailed'), e instanceof Error ? e.message : String(e));
    }
  }, [db, id]);

  const commitEditMode = useCallback(() => {
    // Edit ops 已陸續直寫 DB；commit 等同清掉 snapshot 即可。
    setEditSnapshot(null);
    setEditMode(false);
    // Card 12R — commit path 也清掉持久化 snapshot，避免下次 focus 又
    // restore 到 commit 前的 baseline。
    if (id) {
      deleteSetting(db, editSnapshotKey(id)).catch((e) => {
        console.warn('[Card 12R] commit deleteSetting failed:', e);
      });
    }
  }, [db, id]);

  // attemptExitEditMode：return true 表示「已 (或將) 退出 edit mode」、false
  // 表示「使用者選擇繼續編輯，沒退出」。caller 可依此決定要不要繼續做後續事
  // (例如 router.back 在 header 「返回」上仍要等退出 edit mode 才執行)。
  // 為了讓 alert 的非同步 confirm 也能 route 後續動作，傳 onExited callback。
  const attemptExitEditMode = useCallback(
    (onExited: () => void) => {
      if (!editSnapshot) {
        setEditMode(false);
        onExited();
        return;
      }
      // Card 12R: persistent snapshot 在所有 exit path 都要清掉
      // (silent no-dirty / Alert discard / commit) — 避免下次 focus
      // restore 到已經被使用者放棄/接受的 baseline。
      const clearPersistedSnapshot = () => {
        if (!id) return;
        deleteSetting(db, editSnapshotKey(id)).catch((e) => {
          console.warn('[Card 12R] exit deleteSetting failed:', e);
        });
      };
      const currentState = {
        session: {
          started_at: session?.started_at ?? editSnapshot.session.started_at,
          ended_at: session?.ended_at ?? editSnapshot.session.ended_at,
        },
        sessionExercises: sessionExercises.map((se) => ({
          id: se.id,
          ordering: se.ordering,
          parent_id: se.parent_id,
          rest_sec: se.rest_sec ?? null,
        })),
        sets: sets.map((s) => ({
          id: s.id,
          weight_kg: s.weight_kg,
          reps: s.reps,
          is_skipped: s.is_skipped,
          ordering: s.ordering,
          set_kind: s.set_kind,
          parent_set_id: s.parent_set_id,
          is_logged: s.is_logged,
          notes: s.notes,
          session_exercise_id: s.session_exercise_id,
        })),
      };
      const snapState = {
        session: {
          started_at: editSnapshot.session.started_at,
          ended_at: editSnapshot.session.ended_at,
        },
        sessionExercises: editSnapshot.sessionExercises.map((se) => ({
          id: se.id,
          ordering: se.ordering,
          parent_id: se.parent_id,
          rest_sec: se.rest_sec,
        })),
        sets: editSnapshot.sets.map((s) => ({
          id: s.id,
          weight_kg: s.weight_kg,
          reps: s.reps,
          is_skipped: s.is_skipped,
          ordering: s.ordering,
          set_kind: s.set_kind,
          parent_set_id: s.parent_set_id,
          is_logged: s.is_logged,
          notes: s.notes,
          session_exercise_id: s.session_exercise_id,
        })),
      };
      if (!sessionSnapshotDirty(currentState, snapState)) {
        setEditSnapshot(null);
        setEditMode(false);
        clearPersistedSnapshot();
        onExited();
        return;
      }
      Alert.alert(
        t('alert', 'discardChangesQ'),
        t('alert', 'discardChangesLong'),
        [
          { text: t('button', 'editKeep'), style: 'cancel' },
          {
            text: t('button', 'discardChanges'),
            style: 'destructive',
            onPress: async () => {
              try {
                await restoreSessionFromSnapshot(db, editSnapshot);
                await load();
              } catch (e) {
                Alert.alert(
                  t('alert', 'restoreFailed'),
                  e instanceof Error ? e.message : String(e),
                );
                return;
              }
              setEditSnapshot(null);
              setEditMode(false);
              clearPersistedSnapshot();
              onExited();
            },
          },
        ],
      );
    },
    [editSnapshot, session, sessionExercises, sets, db, id, load],
  );

  // Drain picker mailbox on focus — when [+ 動作] flow returns from
  // /exercise-picker, append the selected exercises / RS templates to
  // THIS session. Mirrors the Today screen's flow but routed to the
  // session detail screen.
  useFocusEffect(
    useCallback(() => {
      const payload = consumePick();
      if (
        !payload ||
        (payload.exerciseIds.length === 0 &&
          payload.reusableSupersetIds.length === 0)
      ) {
        return;
      }
      if (!id) return;
      void (async () => {
        try {
          // ADR-0019 NEW-Q49 (slice 13d D9) — capture first-add gate state
          // BEFORE any append. Same predicate as the Today screen consumePick
          // path; see app/(tabs)/index.tsx for rationale. Read session via
          // getSession (vs the Today screen's getActiveSession) since the
          // detail screen is keyed by `id` and may surface an in-progress
          // session that isn't the active one in edge cases.
          const sessionForGate = await getSession(db, id);
          const exerciseCountBefore = await countSessionExercises(db, id);
          const willFireFirstAddPush = sessionForGate
            ? shouldFireFirstAddPush({
                is_watch_tracked: sessionForGate.is_watch_tracked,
                currentExerciseCount: exerciseCountBefore,
              })
            : false;
          // ADR-0019 Round D Amendment Q4 — track lastAppendedId so we can
          // auto-expand the LAST appended exercise card after the loop.
          // Mirrors the Today screen consumePick (see app/(tabs)/index.tsx).
          let lastAppendedId: string | null = null;
          // Reusable supersets FIRST (per pickerBridge convention) — each
          // explodes into a cluster pair (A + B session_exercise rows
          // linked via parent_id + reusable_superset_id).
          for (const rs_id of payload.reusableSupersetIds) {
            const { a_id, b_id } = await appendReusableSupersetToSession(
              db,
              {
                session_id: id,
                reusable_superset_id: rs_id,
                uuid: randomUUID,
              },
            );
            await prefillReusableSupersetFromLastSession(db, {
              current_session_id: id,
              reusable_superset_id: rs_id,
              new_a_session_exercise_id: a_id,
              new_b_session_exercise_id: b_id,
              uuid: randomUUID,
            });
            lastAppendedId = a_id;
          }
          // Solo exercises after.
          for (const exercise_id of payload.exerciseIds) {
            const newSeId = randomUUID();
            await appendSessionExercise(db, {
              id: newSeId,
              session_id: id,
              exercise_id,
            });
            await prefillSessionExerciseFromLastSession(db, {
              session_id: id,
              exercise_id,
              uuid: randomUUID,
              session_exercise_id: newSeId,
            });
            lastAppendedId = newSeId;
          }
          await load();
          // Round D Amendment Q4 — auto-expand the last appended card
          // (Q3 c-2 "only-one-expanded" invariant).
          if (lastAppendedId) {
            setExpandedExerciseId(lastAppendedId);
          }
          // ADR-0019 NEW-Q49 (slice 13d D9) — fire one-shot pushStartToWatch
          // when this batch added the first exercise(s) to a freestyle
          // session. See sibling call site in app/(tabs)/index.tsx for full
          // rationale.
          if (willFireFirstAddPush) {
            void pushStartToWatch(db, id, {});
          }
        } catch (e) {
          Alert.alert(
            t('alert', 'addExerciseFailed'),
            e instanceof Error ? e.message : String(e),
          );
        }
      })();
    }, [db, id, load]),
  );

  // ── Card 12R / Round G — force-kill recovery for edit mode snapshot ──
  // 如果上次 enterEditMode 後 App 被 force-kill / OS 殺 process，閉到
  // commit/discard 兩個清理 path、persistent snapshot 會殘留在 app_settings.
  // 進 detail focus 時：
  //   1. 讀 session_edit_snapshot_${id} key
  //   2. 若 stale (>=7 天 per Q2a) → silent delete only
  //   3. 若 fresh → restoreSessionFromSnapshot + delete key + load() + toast
  //   4. 一律「不」自動進 edit mode，user 可重新 [編] 進入
  //
  // 用 ref 保證 per-id 只跑一次（避免 focus 重複觸發），且若 user
  // 此刻已在 edit mode（其他途徑進入）不會 silently overwrite 他的編輯。
  const snapshotRestoreCheckedRef = useRef<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      if (snapshotRestoreCheckedRef.current === id) return;
      snapshotRestoreCheckedRef.current = id;
      void (async () => {
        let stored: StoredEditSnapshot | null = null;
        try {
          const raw = await getSetting<unknown>(db, editSnapshotKey(id));
          stored = validateStoredEditSnapshot(raw);
        } catch (e) {
          console.warn('[Card 12R] read editSnapshot failed:', e);
          return;
        }
        if (!stored) return;
        if (isEditSnapshotStale(stored.savedAt, Date.now())) {
          // >7d — silent discard, never restore (per Q2a).
          await deleteSetting(db, editSnapshotKey(id)).catch(() => {});
          return;
        }
        if (editMode) {
          // User 此刻已在 edit mode（罕見：跳離後快速回來且 enterEditMode
          // 已重設新 snapshot）— 不要 silently overwrite，本次跳過、留鑰
          // 給之後再 check 一輪。
          snapshotRestoreCheckedRef.current = null;
          return;
        }
        try {
          await restoreSessionFromSnapshot(db, stored.snap);
          await deleteSetting(db, editSnapshotKey(id));
          await load();
          toastRef.current?.show(t('status', 'editSnapshotRestored'), {
            icon: 'info',
          });
        } catch (e) {
          console.warn('[Card 12R] restore editSnapshot failed:', e);
        }
      })();
    }, [db, id, editMode, load]),
  );

  const stats = useMemo(() => {
    if (!session) return null;
    return computeDetailPageStats({
      session: {
        started_at: session.started_at,
        ended_at: session.ended_at,
        kcal: session.kcal,
      },
      // overnight #47 第 5 點: dedup by exercise_id（兩個 cluster + 1 solo 共 5
      // session_exercise row 但只算 unique 集合大小）。
      exerciseCount: countUniqueExercises(sessionExercises),
      sets: sets.map((s) => ({
        set_kind: s.set_kind,
        is_logged: s.is_logged,
        weight_kg: s.weight_kg,
        reps: s.reps,
      })),
    });
  }, [session, sessionExercises, sets]);

  const clusters = useMemo(
    () => buildClusters(sessionExercises, sets),
    [sessionExercises, sets]
  );

  // Build a unified ordered list of "items" for the 動作清單 section: each
  // item is either a solo session_exercise or a cluster block. Cluster
  // followers (parent_id NOT NULL) are absorbed into their parent's block
  // so we don't render them twice. (Read-mode rendering path.)
  const orderedItems = useMemo(
    () => buildOrderedItems(sessionExercises, clusters, sets),
    [sessionExercises, clusters, sets]
  );

  // Freestyle session = no row carries a template_id. session_exercise.
  // template_id 是 nullable string; null = Freestyle. 「儲存模板」(update mode)
  // 對 Freestyle 沒意義 → dim + disabled。「另存模板」(create mode) 永遠 enabled。
  const isFreestyle = useMemo(
    () => sessionExercises.every((se) => se.template_id == null),
    [sessionExercises]
  );

  // ── Edit-mode CRUD callbacks (mirror Today, minus rest_timer) ──────────────

  /**
   * Append one set to a specific exercise within this session. Mirrors
   * Today's `onAddSet` minus the canRecordSet guard (detail page only
   * lands here when the session exists — `id` is checked at top of file).
   *
   * Defaults priority chain (ADR-0012/0016 動作記憶):
   *   1. Last set in CURRENT session for this card (same-session continuity)
   *   2. Last set in HISTORY across all prior sessions (cross-session memory)
   *   3. Sensible starter defaults (weight=0, reps=10)
   */
  const onAddSet = useCallback(
    async (exercise_id: string, session_exercise_id: string) => {
      if (!id) return;
      // v019 isolation: filter by session_exercise_id (the card) — not bare
      // exercise_id — so an RS A-side card doesn't pick up "last set" from
      // a coincidentally-same-exercise solo card sitting elsewhere.
      const priorInSession = sets.filter(
        (s) => s.session_exercise_id === session_exercise_id,
      );
      const lastSetInSession = priorInSession[priorInSession.length - 1] ?? null;

      // 2026-05-20 (revised) — 「新增 1 組」 adds a NEW dropset cluster D2
      // (head + 1 follower) after the existing D1 chain. Mirror Today.
      // priorInSession sorted ASC by ordering → [last] is end of chain.
      if (lastSetInSession?.set_kind === 'dropset') {
        setBusy(true);
        try {
          await addSessionDropsetCluster(db, {
            session_id: id,
            after_set_id: lastSetInSession.id,
            uuid: randomUUID,
          });
          await load();
        } catch (e) {
          Alert.alert(t('alert', 'saveFailed'), e instanceof Error ? e.message : String(e));
        } finally {
          setBusy(false);
        }
        return;
      }

      let weight_kg = 0;
      let repsNum = 10;
      if (lastSetInSession) {
        weight_kg = lastSetInSession.weight_kg ?? 0;
        repsNum = lastSetInSession.reps ?? repsNum;
      } else {
        try {
          const historicalPriors = await listPriorSetsForExercise(
            db,
            exercise_id,
            Date.now() + 1,
          );
          if (historicalPriors.length > 0) {
            const mostRecent = historicalPriors[0];
            weight_kg = mostRecent.weight_kg ?? 0;
            repsNum = mostRecent.reps ?? repsNum;
          }
        } catch {
          // History query failure → starter defaults.
        }
      }
      if (!Number.isInteger(repsNum) || repsNum <= 0) repsNum = 10;

      const err = validateRecordSet({
        exercise_id,
        weight_kg,
        reps: repsNum,
      });
      if (err) {
        Alert.alert(t('alert', 'invalidInput'), err);
        return;
      }
      setBusy(true);
      try {
        await recordSetInSession(db, {
          session_id: id,
          input: { exercise_id, weight_kg, reps: repsNum },
          uuid: randomUUID,
          session_exercise_id,
        });
        await load();
      } catch (e) {
        Alert.alert(t('alert', 'saveFailed'), e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [db, id, sets, load],
  );

  /**
   * Persist a partial update to one set (weight_kg / reps) and refresh
   * the in-memory sets. Mirrors Today's onUpdateSet.
   */
  const onUpdateSet = useCallback(
    async (
      set_id: string,
      patch: { reps?: number; weight?: number },
    ) => {
      const dbPatch: { weight_kg?: number; reps?: number } = {};
      if (patch.reps !== undefined) dbPatch.reps = patch.reps;
      if (patch.weight !== undefined) dbPatch.weight_kg = patch.weight;
      try {
        await updateSetFields(db, set_id, dbPatch);
        setSets((curr) =>
          curr.map((s) =>
            s.id === set_id
              ? {
                  ...s,
                  weight_kg: patch.weight ?? s.weight_kg,
                  reps: patch.reps ?? s.reps,
                }
              : s,
          ),
        );
      } catch (e) {
        Alert.alert(t('alert', 'saveFailed'), e instanceof Error ? e.message : String(e));
      }
    },
    [db],
  );

  /**
   * Apply a tap-label cycle (warmup ↔ working ↔ dropset) to one set
   * within one card. Mirrors Today's onCycleSetKind.
   */
  const onCycleSetKind = useCallback(
    async (
      exercise_id: string,
      set_id: string,
      is_in_cluster: boolean = false,
    ) => {
      if (!id) return;
      const target = sets.find((s) => s.id === set_id);
      const targetSeId = target?.session_exercise_id ?? null;
      const setsForExercise = sets.filter((s) =>
        targetSeId
          ? s.session_exercise_id === targetSeId
          : s.exercise_id === exercise_id,
      );
      const ops = cycleSessionSetKindClusterAware(
        setsForExercise.map((s) => ({
          id: s.id,
          set_kind: s.set_kind,
          parent_set_id: s.parent_set_id,
          reps: s.reps,
          weight_kg: s.weight_kg,
        })),
        set_id,
        randomUUID(),
        is_in_cluster,
      );
      if (ops.length === 0) return;
      try {
        for (const op of ops) {
          if (op.type === 'update') {
            await updateSetFields(db, op.set_id, op.patch);
          } else if (op.type === 'delete') {
            await deleteSet(db, op.set_id);
          } else {
            // insertFollower — 2026-05-20 fix mirror Today: insert at
            // head.ordering+1 with shift, not end-of-session, so the
            // chain stays contiguous.
            const head = sets.find((s) => s.id === op.parent_set_id);
            const headOrdering = head?.ordering ?? 0;
            const newOrdering = headOrdering + 1;
            await db.runAsync(
              `UPDATE "set" SET ordering = ordering + 1
                WHERE session_id = ? AND ordering >= ?`,
              id,
              newOrdering,
            );
            await insertSessionSet(db, {
              id: op.new_set_id,
              session_id: id,
              exercise_id,
              weight_kg: op.weight_kg,
              reps: op.reps,
              is_skipped: 0,
              ordering: newOrdering,
              created_at: Date.now(),
              set_kind: 'dropset',
              parent_set_id: op.parent_set_id,
              session_exercise_id: head?.session_exercise_id ?? null,
            });
          }
        }
        await load();
      } catch (e) {
        Alert.alert(t('alert', 'saveFailed'), e instanceof Error ? e.message : String(e));
      }
    },
    [db, id, sets, load],
  );

  const onDeleteSet = useCallback(
    async (set_id: string) => {
      if (!id) return;
      try {
        await deleteSet(db, set_id);
        await load();
      } catch (e) {
        Alert.alert(t('alert', 'deleteFailed'), e instanceof Error ? e.message : String(e));
      }
    },
    [db, id, load],
  );

  const onAddSetAfter = useCallback(
    async (source_set_id: string) => {
      if (!id) return;
      setBusy(true);
      try {
        // 2026-05-20 (revised) — dropset +1 swipe creates a NEW D2 cluster
        // BELOW the existing D1 chain (head + follower). Mirror Today.
        const source = sets.find((s) => s.id === source_set_id);
        if (source?.set_kind === 'dropset') {
          const headId = source.parent_set_id ?? source.id;
          const chainSets = sets.filter(
            (s) => s.id === headId || s.parent_set_id === headId,
          );
          const lastInChain = chainSets.reduce(
            (a, b) => (a.ordering > b.ordering ? a : b),
            source,
          );
          await addSessionDropsetCluster(db, {
            session_id: id,
            after_set_id: lastInChain.id,
            uuid: randomUUID,
          });
        } else {
          await insertSessionSetAfter(db, {
            session_id: id,
            source_set_id,
            uuid: randomUUID,
          });
        }
        await load();
      } catch (e) {
        Alert.alert(t('alert', 'saveFailed'), e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [db, id, sets, load],
  );

  /**
   * Slice 10c overnight #61 — wire `+` button on dropset cluster-last
   * follower in session detail edit mode. Mirror Today's behaviour
   * (app/(tabs)/index.tsx). source row may be head or follower; helper
   * resolves chain head id internally.
   */
  const onAddDropsetRow = useCallback(
    async (after_set_id: string) => {
      if (!id) return;
      setBusy(true);
      try {
        await addSessionDropsetRow(db, {
          session_id: id,
          after_set_id,
          uuid: randomUUID,
        });
        await load();
      } catch (e) {
        Alert.alert(
          t('alert', 'addDropsetFailed'),
          e instanceof Error ? e.message : String(e),
        );
      } finally {
        setBusy(false);
      }
    },
    [db, id, load],
  );

  /**
   * Slice 10c overnight #61 — wire `−` button on dropset follower in
   * session detail edit mode. DROPSET_CHAIN_TOO_SHORT (chain would shrink
   * below 2) surfaces as an explanatory Alert.
   */
  const onRemoveDropsetRow = useCallback(
    async (set_id: string) => {
      if (!id) return;
      try {
        await removeSessionDropsetRow(db, {
          session_id: id,
          set_id,
        });
        await load();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('DROPSET_CHAIN_TOO_SHORT')) {
          Alert.alert(
            t('alert', 'cannotDelete'),
            t('alert', 'dropsetMinimum'),
          );
        } else {
          Alert.alert(t('alert', 'deleteFailed'), msg);
        }
      }
    },
    [db, id, load],
  );

  /**
   * Flip is_logged on a set. Edit-history mode (overnight #59): NO rest
   * timer trigger — this is the key difference from Today's `onToggleLogged`.
   */
  const onToggleLogged = useCallback(
    async (set_id: string, currentlyLogged: boolean) => {
      const nextLogged = currentlyLogged ? 0 : 1;
      try {
        await updateSetFields(db, set_id, { is_logged: nextLogged });
        setSets((curr) =>
          curr.map((s) =>
            s.id === set_id ? { ...s, is_logged: nextLogged } : s,
          ),
        );
      } catch (e) {
        console.warn('[toggle is_logged] failed:', e);
      }
      // INTENTIONAL: no PR detection, no rest timer trigger. Detail page
      // is for editing logged history; the user has already finished and
      // PR / timer side-effects don't apply.
    },
    [db],
  );

  /**
   * Atomic cluster cycle ✓ tap (ADR-0019 Q16). Edit-history mode: NO
   * rest timer trigger (different from Today's `onToggleClusterCycle`).
   */
  const onToggleClusterCycle = useCallback(
    async (args: {
      a_set_id: string;
      b_set_id: string;
      currentlyLogged: boolean;
    }) => {
      const nextLogged = args.currentlyLogged ? 0 : 1;
      try {
        // Use updateSetFields per side directly — detail page doesn't need
        // the atomic markClusterCycleLogged repo path because there's no
        // concurrent in-flight write to race against (no rest timer side-
        // effect). Two sequential UPDATEs are good enough; both committed
        // before the next render.
        await updateSetFields(db, args.a_set_id, { is_logged: nextLogged });
        await updateSetFields(db, args.b_set_id, { is_logged: nextLogged });
        setSets((curr) =>
          curr.map((s) => {
            if (s.id === args.a_set_id || s.id === args.b_set_id) {
              return { ...s, is_logged: nextLogged };
            }
            return s;
          }),
        );
      } catch (e) {
        console.warn('[cluster cycle ✓] failed:', e);
      }
    },
    [db],
  );

  const onDeleteClusterCycle = useCallback(
    async (args: { a_set_id: string | null; b_set_id: string | null }) => {
      if (!id) return;
      try {
        await deleteClusterCycle(db, args);
        await load();
      } catch (e) {
        Alert.alert(t('alert', 'deleteFailed'), e instanceof Error ? e.message : String(e));
      }
    },
    [db, id, load],
  );

  const onCloneClusterCycle = useCallback(
    async (args: { a_set_id: string | null; b_set_id: string | null }) => {
      if (!id) return;
      try {
        if (args.a_set_id) {
          await insertSessionSetAfter(db, {
            session_id: id,
            source_set_id: args.a_set_id,
            uuid: randomUUID,
          });
        }
        if (args.b_set_id) {
          await insertSessionSetAfter(db, {
            session_id: id,
            source_set_id: args.b_set_id,
            uuid: randomUUID,
          });
        }
        await load();
      } catch (e) {
        Alert.alert(t('alert', 'cloneFailed'), e instanceof Error ? e.message : String(e));
      }
    },
    [db, id, load],
  );

  const onAddClusterCycle = useCallback(
    async (
      group: ClusterGroup<SessionExerciseRowWithName, SessionSetWithExercise>,
    ) => {
      if (!id) return;
      const pickDefaults = async (
        exercise_id: string,
        session_exercise_id: string,
      ) => {
        const inSession = sets
          .filter((s) => s.session_exercise_id === session_exercise_id)
          .slice(-1)[0];
        if (inSession) {
          return {
            weight_kg: inSession.weight_kg ?? 0,
            reps: inSession.reps ?? 10,
          };
        }
        try {
          const historical = await listPriorSetsForExercise(
            db,
            exercise_id,
            Date.now() + 1,
          );
          if (historical.length > 0) {
            return {
              weight_kg: historical[0].weight_kg ?? 0,
              reps: historical[0].reps ?? 10,
            };
          }
        } catch {
          // ignore
        }
        return { weight_kg: 0, reps: 10 };
      };
      try {
        const aDefaults = await pickDefaults(
          group.a.exercise.exercise_id,
          group.a.exercise.id,
        );
        const bDefaults = await pickDefaults(
          group.b.exercise.exercise_id,
          group.b.exercise.id,
        );
        await addClusterCycleAtEnd(db, {
          session_id: id,
          a: {
            exercise_id: group.a.exercise.exercise_id,
            new_set_id: randomUUID(),
            weight_kg: aDefaults.weight_kg,
            reps: aDefaults.reps,
            session_exercise_id: group.a.exercise.id,
          },
          b: {
            exercise_id: group.b.exercise.exercise_id,
            new_set_id: randomUUID(),
            weight_kg: bDefaults.weight_kg,
            reps: bDefaults.reps,
            session_exercise_id: group.b.exercise.id,
          },
        });
        await load();
      } catch (e) {
        Alert.alert(t('alert', 'addCycleFailed'), e instanceof Error ? e.message : String(e));
      }
    },
    [db, id, sets, load],
  );

  const onUpdateNotes = useCallback(
    async (set_id: string, notes: string | null) => {
      try {
        await updateSetFields(db, set_id, { notes });
        setSets((curr) =>
          curr.map((s) => (s.id === set_id ? { ...s, notes } : s)),
        );
      } catch (e) {
        Alert.alert(t('alert', 'saveFailed'), e instanceof Error ? e.message : String(e));
      }
    },
    [db],
  );

  /**
   * ⚙️ menu — mirror Today's onSettingsPress, minus the never-applicable
   * cluster context history navigation arguments (cluster ⚙️ history
   * entries still work because we wire partnerExerciseId/Id from the
   * cluster render path identically to Today).
   */
  const onSettingsPress = useCallback(
    (
      planRow: SessionExerciseRowWithName,
      options?: {
        partnerExerciseId?: string;
        partnerSessionExerciseId?: string;
      },
    ) => {
      const partnerExerciseId = options?.partnerExerciseId;
      const partnerSessionExerciseId = options?.partnerSessionExerciseId;
      const isCluster = !!partnerExerciseId && !!partnerSessionExerciseId;
      const labelCancel = t('common', 'cancel');
      const labelEditNote = t('button', 'clusterEditNote');
      const labelRestSeconds = t('button', 'clusterRestSeconds');
      const labelHistoryA = t('button', 'clusterHistoryA');
      const labelHistoryB = t('button', 'clusterHistoryB');
      const labelDeleteExercise = t('button', 'clusterDeleteExercise');
      const labelReorder = t('button', 'clusterReorderExercises');
      const menuOptions: string[] = isCluster
        ? [
            labelCancel,
            labelEditNote,
            labelRestSeconds,
            labelHistoryA,
            labelHistoryB,
            labelDeleteExercise,
            labelReorder,
          ]
        : [
            labelCancel,
            labelEditNote,
            labelRestSeconds,
            labelDeleteExercise,
            labelReorder,
          ];
      const destructiveButtonIndex = isCluster ? 5 : 3;
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: tExercise(planRow.exercise_name),
          options: menuOptions,
          cancelButtonIndex: 0,
          destructiveButtonIndex,
        },
        (idx) => {
          if (idx === 0) return;
          const label = menuOptions[idx];
          if (label === labelEditNote) {
            (async () => {
              try {
                const initial = await getExerciseNotes(db, planRow.exercise_id);
                setExerciseNoteTarget({
                  exercise_id: planRow.exercise_id,
                  exercise_name: planRow.exercise_name,
                  initial,
                });
              } catch (e) {
                Alert.alert(
                  t('alert', 'readFailed'),
                  e instanceof Error ? e.message : String(e),
                );
              }
            })();
          } else if (label === labelRestSeconds) {
            setRestSecTarget({
              session_exercise_id: planRow.id,
              current: planRow.rest_sec ?? 60,
              exercise_name: planRow.exercise_name,
            });
          } else if (label === labelHistoryA) {
            router.push(
              `/exercise-history/${planRow.exercise_id}?clusterMode=cluster_only&partner=${partnerExerciseId}&side=A&currentSeIdA=${planRow.id}&currentSeIdB=${partnerSessionExerciseId}`,
            );
          } else if (label === labelHistoryB) {
            router.push(
              `/exercise-history/${partnerExerciseId}?clusterMode=cluster_only&partner=${planRow.exercise_id}&side=B&currentSeIdA=${partnerSessionExerciseId}&currentSeIdB=${planRow.id}`,
            );
          } else if (label === labelReorder) {
            setReorderSheetOpen(true);
          } else if (label === labelDeleteExercise) {
            if (isCluster && partnerSessionExerciseId) {
              const partnerPlan = sessionExercises.find(
                (p) => p.id === partnerSessionExerciseId,
              );
              const partnerName = partnerPlan?.exercise_name
                ? tExercise(partnerPlan.exercise_name)
                : t('common', 'unknownExercise');
              const setsForCluster = sets.filter(
                (s) =>
                  s.session_exercise_id === planRow.id ||
                  s.session_exercise_id === partnerSessionExerciseId,
              );
              const loggedCount = setsForCluster.filter(
                (s) => s.is_logged === 1,
              ).length;
              const totalSets = setsForCluster.length;
              const warningSuffix =
                loggedCount > 0
                  ? tWarningTotalSetsWithLogged(totalSets, loggedCount)
                  : totalSets > 0
                    ? tWarningTotalSetsUnfinished(totalSets)
                    : '';
              Alert.alert(
                t('alert', 'deleteSupersetQ'),
                tRemoveSupersetFromSessionPrompt(
                  tExercise(planRow.exercise_name),
                  partnerName,
                  warningSuffix,
                ),
                [
                  { text: t('common', 'cancel'), style: 'cancel' },
                  {
                    text: t('common', 'delete'),
                    style: 'destructive',
                    onPress: async () => {
                      if (!id) return;
                      try {
                        await deleteSessionExerciseAndSets(db, {
                          session_id: id,
                          exercise_id: planRow.exercise_id,
                          session_exercise_id: planRow.id,
                        });
                        await deleteSessionExerciseAndSets(db, {
                          session_id: id,
                          exercise_id: partnerPlan?.exercise_id ?? '',
                          session_exercise_id: partnerSessionExerciseId,
                        });
                        await load();
                      } catch (e) {
                        Alert.alert(
                          t('alert', 'deleteFailed'),
                          e instanceof Error ? e.message : String(e),
                        );
                        await load();
                      }
                    },
                  },
                ],
              );
              return;
            }
            // Solo path
            const setsForExercise = sets.filter(
              (s) =>
                s.session_exercise_id === planRow.id ||
                (s.session_exercise_id == null &&
                  s.exercise_id === planRow.exercise_id),
            );
            const loggedCount = setsForExercise.filter(
              (s) => s.is_logged === 1,
            ).length;
            const warningSuffix =
              loggedCount > 0
                ? tWarningPerExerciseSetsWithLogged(setsForExercise.length, loggedCount)
                : setsForExercise.length > 0
                  ? tWarningPerExerciseSetsUnfinished(setsForExercise.length)
                  : '';
            Alert.alert(
              t('alert', 'deleteExerciseQ'),
              tRemoveExerciseFromSessionPrompt(tExercise(planRow.exercise_name), warningSuffix),
              [
                { text: t('common', 'cancel'), style: 'cancel' },
                {
                  text: t('common', 'delete'),
                  style: 'destructive',
                  onPress: async () => {
                    if (!id) return;
                    try {
                      await deleteSessionExerciseAndSets(db, {
                        session_id: id,
                        exercise_id: planRow.exercise_id,
                        session_exercise_id: planRow.id,
                      });
                      await load();
                    } catch (e) {
                      Alert.alert(
                        t('alert', 'deleteFailed'),
                        e instanceof Error ? e.message : String(e),
                      );
                    }
                  },
                },
              ],
            );
          }
        },
      );
    },
    [db, id, sessionExercises, sets, router, load],
  );

  // ── Top-level handlers ────────────────────────────────────────────────────

  // KNOWN RISK (Round F 2026-05-24 拍板接受):
  // edit mode 期間呼叫 [儲存模板] 會 silent overwrite，未列入
  // commitEditMode / discardSession 的 transactional protection
  // (template-side write 走獨立 convertSessionToTemplate path)。
  // user 決議不動、ADR-0019 § Q10 Round F 段確認 — 4-btn bar 在 edit mode
  // 只剩 [+ 動作][...] 兩 btn、[儲存模板] 不可見，所以 racing 入口窄；
  // 萬一未來把 btn 拿回 edit mode 要重新評估 protection cost。
  const handleSaveTemplate = useCallback(
    async (mode: 'update' | 'create') => {
      if (!session) return;

      if (mode === 'create') {
        try {
          const [progs, linked] = await Promise.all([
            listPrograms(db),
            getSessionLinkedTemplateTriple(db, id!),
          ]);
          setPrograms(progs);
          // Round F Q3 — prefill 跟著 fallback chain (sessionTitle [尚無欄位、
          // 永遠 null] → linkedTemplateName → dateLabel) 走，避免 freestyle
          // session 開 TemplateMetaSheet 時 input 空白。
          const dateLabel = formatDateLabel(session.started_at);
          const prefillName = computeDefaultTemplateName({
            sessionTitle: null,
            linkedTemplateName: linked?.template_name,
            dateLabel,
          });
          setTemplateMetaPrefill({
            name: prefillName,
            program_id: linked?.program_id ?? null,
            sub_tag: linked?.sub_tag ?? null,
          });
        } catch (e) {
          Alert.alert(t('alert', 'loadFailed'), e instanceof Error ? e.message : String(e));
          return;
        }
        setTemplateMetaSheetOpen(true);
        return;
      }

      // mode === 'update' (儲存模板):
      //   Direct overwrite of the linked template — no name prompt. Button
      //   is dimmed/disabled when isFreestyle, so we expect a linked template
      //   to exist; if it was deleted between session start and now we tell
      //   the user to use 另存模板 instead (rather than silently fall through
      //   to a create-mode dialog they didn't ask for).
      //   User-facing change (2026-05-20): the prompt asking for a name was
      //   counter-intuitive — template-based session 已經知道要寫哪個模板，
      //   不該再問名稱。
      let linked: Awaited<
        ReturnType<typeof getSessionLinkedTemplateTriple>
      >;
      try {
        linked = await getSessionLinkedTemplateTriple(db, id!);
      } catch (e) {
        Alert.alert(t('alert', 'loadFailed'), e instanceof Error ? e.message : String(e));
        return;
      }
      if (!linked) {
        Alert.alert(
          t('alert', 'originalTemplateNotFound'),
          t('alert', 'sessionTemplateMissing'),
        );
        return;
      }
      try {
        await convertSessionToTemplate(db, {
          session_id: id!,
          template_name: linked.template_name,
          mode: 'update',
          uuid: randomUUID,
        });
        // Round F Q2 — success feedback 改 toast (was Alert.alert).
        toastRef.current?.show(tTemplateUpdated(linked.template_name), {
          icon: 'success',
        });
      } catch (e) {
        Alert.alert(t('alert', 'failed'), e instanceof Error ? e.message : String(e));
      }
    },
    [db, id, session]
  );

  const handleTemplateMetaConfirm = useCallback(
    async (args: {
      name: string;
      program_id: string | null;
      sub_tag: string | null;
    }) => {
      if (!session) return;
      // Round F Q3 — final fallback chain mirrors the prefill chain so the
      // dialog default and the "user submitted blank input" default agree.
      const dateLabel = formatDateLabel(session.started_at);
      const defaultName = computeDefaultTemplateName({
        sessionTitle: null,
        linkedTemplateName: null,
        dateLabel,
      });
      const finalName = args.name.trim() || defaultName;
      setTemplateMetaBusy(true);
      try {
        await convertSessionToTemplate(db, {
          session_id: id!,
          template_name: finalName,
          mode: 'create',
          program_id: args.program_id,
          sub_tag: args.sub_tag,
          uuid: randomUUID,
        });
        setTemplateMetaSheetOpen(false);
        Alert.alert(t('status', 'savedAsNew'), tTemplateCreated(finalName));
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (message === 'DUPLICATE_TEMPLATE_TRIPLE') {
          Alert.alert(
            t('alert', 'variantExists'),
            tDuplicateTemplateTriple(finalName),
          );
        } else {
          Alert.alert(t('alert', 'failed'), message);
        }
      } finally {
        setTemplateMetaBusy(false);
      }
    },
    [db, id, session]
  );

  const handleDelete = useCallback(() => {
    // Round F Q4 — confirm 文案含 session 顯示名（目前 = dateLabel；session
    // table 還沒 title 欄位、未來加上後 displayName 自動 follow header title）。
    const displayName = session
      ? formatDateLabel(session.started_at)
      : 'Session';
    Alert.alert(
      t('button', 'deleteSession'),
      computeDeleteConfirmMessage({ sessionDisplayName: displayName }),
      [
        { text: t('common', 'cancel'), style: 'cancel' },
        {
          text: t('common', 'delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await discardSession(db, id!);
              router.back();
            } catch (e) {
              Alert.alert(t('alert', 'deleteFailed'), e instanceof Error ? e.message : String(e));
            }
          },
        },
      ]
    );
  }, [db, id, router, session]);

  /**
   * Persist new started_at / ended_at via direct UPDATE. Used by tap on
   * 訓練時間 tile → SessionTimeEditorSheet → save.
   */
  const handleTimeSave = useCallback(
    async (args: { started_at_ms: number; ended_at_ms: number }) => {
      if (!id) return;
      try {
        await db.runAsync(
          `UPDATE session SET started_at = ?, ended_at = ? WHERE id = ?`,
          args.started_at_ms,
          args.ended_at_ms,
          id,
        );
        setTimeEditorOpen(false);
        await load();
      } catch (e) {
        Alert.alert(t('alert', 'saveFailed'), e instanceof Error ? e.message : String(e));
      }
    },
    [db, id, load],
  );

  // Edit mode body — full active session UI parity.
  const renderEditBody = () => {
    if (!session) return null;
    const clusterGroups = groupClusterSides(sessionExercises, sets);
    const clusterMemberIds = new Set<string>();
    for (const g of clusterGroups) {
      clusterMemberIds.add(g.a.exercise.id);
      clusterMemberIds.add(g.b.exercise.id);
    }
    const clusterByParentId = new Map(
      clusterGroups.map((g) => [g.a.exercise.id, g] as const),
    );

    const out: React.ReactNode[] = [];
    for (const p of sessionExercises) {
      // Cluster follower → skip (parent owns the render).
      if (p.parent_id !== null && clusterMemberIds.has(p.id)) continue;

      const group = clusterByParentId.get(p.id);
      if (group) {
        // 隱藏未打勾：cluster cycle 兩側皆 logged 才跳過；整 cluster 全 logged
        // 則整張卡也不 render。
        let renderGroup = group;
        if (hideUnchecked) {
          const filtered = filterUncheckedClusterPair(group.a.sets, group.b.sets);
          if (filtered === null) continue;
          renderGroup = {
            ...group,
            a: { ...group.a, sets: filtered.setsA },
            b: { ...group.b, sets: filtered.setsB },
          };
        }
        const isExpanded = expandedExerciseId === p.id;
        out.push(
          <ClusterCard
            key={p.id}
            group={renderGroup}
            isExpanded={isExpanded}
            onToggleExpand={() =>
              setExpandedExerciseId(isExpanded ? null : p.id)
            }
            onToggleCycleLogged={(args) => onToggleClusterCycle(args)}
            onAddCycle={() => onAddClusterCycle(group)}
            onDeleteCycle={onDeleteClusterCycle}
            onCloneCycle={onCloneClusterCycle}
            onShowCycleNote={(parent_set_id) => {
              const parent = sets.find((s) => s.id === parent_set_id);
              setNoteSheetTarget({
                set_id: parent_set_id,
                initial: parent?.notes ?? null,
              });
            }}
            onOpenHistory={() =>
              router.push(
                `/exercise-history/${group.a.exercise.exercise_id}?clusterMode=cluster_only&partner=${group.b.exercise.exercise_id}&side=A&currentSeIdA=${group.a.exercise.id}&currentSeIdB=${group.b.exercise.id}`,
              )
            }
            onSettingsPress={() =>
              onSettingsPress(p, {
                partnerExerciseId: group.b.exercise.exercise_id,
                partnerSessionExerciseId: group.b.exercise.id,
              })
            }
            onUpdateClusterSet={(set_id, patch) => onUpdateSet(set_id, patch)}
            onTapClusterNumber={(set_id, field, current) =>
              setKeypadTarget({ set_id, field, current })
            }
            onCycleClusterSetKind={(set_id) => {
              const s = sets.find((x) => x.id === set_id);
              if (s) onCycleSetKind(s.exercise_id, set_id, true);
            }}
            onCycleClusterCycleSetKind={async (args) => {
              const a = args.a_set_id
                ? sets.find((x) => x.id === args.a_set_id)
                : null;
              const b = args.b_set_id
                ? sets.find((x) => x.id === args.b_set_id)
                : null;
              if (a) await onCycleSetKind(a.exercise_id, a.id, true);
              if (b) await onCycleSetKind(b.exercise_id, b.id, true);
            }}
            onShowClusterSetNote={(set_id, current) =>
              setNoteSheetTarget({ set_id, initial: current })
            }
            onConfirmReorderCycles={async (newOrder) => {
              if (!id) return;
              const aOrderedIds = newOrder
                .map((c) => c.a_set?.id)
                .filter(
                  (x): x is string => typeof x === 'string' && x.length > 0,
                );
              const bOrderedIds = newOrder
                .map((c) => c.b_set?.id)
                .filter(
                  (x): x is string => typeof x === 'string' && x.length > 0,
                );
              try {
                if (aOrderedIds.length > 0) {
                  await reorderSessionSetsForExercise(db, {
                    session_id: id,
                    exercise_id: group.a.exercise.exercise_id,
                    orderedIds: aOrderedIds,
                    session_exercise_id: group.a.exercise.id,
                  });
                }
                if (bOrderedIds.length > 0) {
                  await reorderSessionSetsForExercise(db, {
                    session_id: id,
                    exercise_id: group.b.exercise.exercise_id,
                    orderedIds: bOrderedIds,
                    session_exercise_id: group.b.exercise.id,
                  });
                }
                await load();
              } catch (e) {
                Alert.alert(
                  t('alert', 'reorderFailed'),
                  e instanceof Error ? e.message : String(e),
                );
              }
            }}
          />,
        );
        continue;
      }

      // Solo path
      const setsForExerciseRaw = sets.filter(
        (s) =>
          s.session_exercise_id === p.id ||
          (s.session_exercise_id == null && s.exercise_id === p.exercise_id),
      );
      // 隱藏未打勾：filter logged sets; whole card hidden when all logged.
      let setsForExercise = setsForExerciseRaw;
      if (hideUnchecked) {
        const filtered = filterUncheckedSolo(setsForExerciseRaw);
        if (filtered === null) continue;
        setsForExercise = filtered;
      }
      const isExpanded = expandedExerciseId === p.id;
      out.push(
        <EditableExerciseCard
          key={p.id}
          planRow={p}
          isExpanded={isExpanded}
          sets={setsForExercise}
          busy={busy}
          onToggleExpand={() => setExpandedExerciseId(isExpanded ? null : p.id)}
          onAddSet={() => onAddSet(p.exercise_id, p.id)}
          onUpdateSet={onUpdateSet}
          onCycleSetKind={(set_id) => onCycleSetKind(p.exercise_id, set_id)}
          onDeleteSet={onDeleteSet}
          onAddSetAfter={(set_id) => onAddSetAfter(set_id)}
          onAddDropsetRow={onAddDropsetRow}
          onRemoveDropsetRow={onRemoveDropsetRow}
          onToggleLogged={onToggleLogged}
          onShowSetNote={(set_id, current) =>
            setNoteSheetTarget({ set_id, initial: current })
          }
          onTapNumber={(set_id, field, current) =>
            setKeypadTarget({ set_id, field, current })
          }
          onOpenHistory={() =>
            router.push(
              `/exercise-history/${p.exercise_id}?clusterMode=exclude_cluster&currentSeId=${p.id}`,
            )
          }
          onSettingsPress={() => onSettingsPress(p)}
          onLongPressHeader={() => setReorderSheetOpen(true)}
          onConfirmReorderSets={async (orderedIds) => {
            if (!id) return;
            try {
              await reorderSessionSetsForExercise(db, {
                session_id: id,
                exercise_id: p.exercise_id,
                orderedIds,
                session_exercise_id: p.id,
              });
              await load();
            } catch (e) {
              Alert.alert(
                t('alert', 'reorderFailed'),
                e instanceof Error ? e.message : String(e),
              );
            }
          }}
        />,
      );
    }
    return out;
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/*
        #4 (2026-05-30) — 同日 session 切換的轉場方向。prev → slide_from_left
        (頁面從左進入)、next/首次 → slide_from_right。Stack.Screen render null，
        放這裡只為在本路由首次 render 時就設好 animation，讓 router.replace 的
        轉場依方向播放，符合「按左箭頭從左進」的直覺。
      */}
      <Stack.Screen
        options={{
          animation: dir === 'prev' ? 'slide_from_left' : 'slide_from_right',
        }}
      />
      {/* Header — back btn + title + (edit mode) 完成 btn */}
      <View style={styles.header}>
        <Pressable
          onPress={() => {
            if (editMode) {
              // 編輯模式下，「返回」走 transactional discard path：
              // 若有變更 alert 確認、確認後 restore；無變更則 silent 退出。
              // onExited 在退出 edit mode 後不再做事（停在詳情頁）。
              attemptExitEditMode(() => {});
            } else {
              router.back();
            }
          }}
          style={styles.headerBackBtn}>
          <Text style={styles.headerBackText}>{t('common', 'backArrow')}</Text>
        </Pressable>
        <View style={styles.headerTitleCol}>
          <View style={styles.headerTitleRow}>
            {session ? (
              <SessionTitleEditor
                sessionId={session.id}
                initialTitle={session.title ?? ''}
                placeholder={t('domain', 'freestyle')}
                size="nav"
                onUpdated={(newTitle) =>
                  setSession((s) => (s ? { ...s, title: newTitle } : s))
                }
              />
            ) : (
              <Text
                style={styles.headerTitleText}
                numberOfLines={1}
                ellipsizeMode="tail">
                {t('status', 'loading')}
              </Text>
            )}
            {shouldShowEditChip(editMode) ? (
              <View style={styles.editChip} accessibilityLabel={t('button', 'a11yEditMode')}>
                <Text style={styles.editChipText}>編</Text>
              </View>
            ) : null}
          </View>
          {sessionTemplateInfo ? (
            <Text
              style={styles.headerSubtitle}
              numberOfLines={1}
              ellipsizeMode="tail">
              {formatTemplateTriple(
                sessionTemplateInfo.program_name,
                sessionTemplateInfo.sub_tag,
              )}
            </Text>
          ) : null}
        </View>
        {editMode ? (
          <Pressable
            onPress={commitEditMode}
            style={styles.headerDoneBtn}
            accessibilityRole="button">
            <Text style={styles.headerDoneText}>{t('common', 'done')}</Text>
          </Pressable>
        ) : (
          <View style={styles.headerSpacer} />
        )}
      </View>

      {/*
        Same-day session switcher (ADR-0015 § Tap 日格行為). Renders only when
        the history tab embedded `?sameDayIds=<csv>` AND the list contains
        more than one entry.
      */}
      {navState.total > 1 ? (
        <View style={styles.sameDayBar}>
          <Pressable
            onPress={() => goToSibling('prev')}
            disabled={navState.currentIndex === 0}
            style={[
              styles.sameDayBtn,
              navState.currentIndex === 0 && styles.sameDayBtnDisabled,
            ]}>
            <Text
              style={[
                styles.sameDayBtnText,
                navState.currentIndex === 0 && styles.sameDayBtnTextDisabled,
              ]}>
              ←
            </Text>
          </Pressable>
          <Text style={styles.sameDayIndicator}>
            {navState.currentIndex + 1}/{navState.total}
          </Text>
          <Pressable
            onPress={() => goToSibling('next')}
            disabled={navState.currentIndex === navState.total - 1}
            style={[
              styles.sameDayBtn,
              navState.currentIndex === navState.total - 1 &&
                styles.sameDayBtnDisabled,
            ]}>
            <Text
              style={[
                styles.sameDayBtnText,
                navState.currentIndex === navState.total - 1 &&
                  styles.sameDayBtnTextDisabled,
              ]}>
              →
            </Text>
          </Pressable>
        </View>
      ) : null}

      <GestureDetector gesture={swipeGesture}>
        {editMode ? (
          // Edit mode — NestableScrollContainer + draggable lists for full
          // active-session UI parity (including drag-reorder per row).
          <NestableScrollContainer
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
          >
            {loading ? (
              <Text style={styles.muted}>Loading…</Text>
            ) : error ? (
              <Text style={styles.error}>{error}</Text>
            ) : !session || !stats ? (
              <Text style={styles.muted}>No data.</Text>
            ) : (
              <>
                <Text style={styles.timestamp}>
                  {formatTimestamp(session.started_at)}
                  {session.ended_at != null
                    ? ` ~ ${formatTimestamp(session.ended_at)}`
                    : ''}
                </Text>

                <SessionStatsPanel
                  variant="4tile"
                  kcal={session.kcal}
                  sets={sets.map((s) => ({
                    set_kind: s.set_kind,
                    is_logged: s.is_logged,
                    reps: s.reps,
                    weight_kg: s.weight_kg,
                  }))}
                  exercise_count={countUniqueExercises(sessionExercises)}
                  started_at_ms={session.started_at}
                  ended_at_ms={session.ended_at ?? viewOpenedAtMs}
                  onTapDuration={
                    session.ended_at != null
                      ? () => setTimeEditorOpen(true)
                      : undefined
                  }
                />

                <Text style={styles.section}>{t('page', 'hrZoneSection')}</Text>
                <HRZoneChart
                  samples={hrSamples}
                  hrmax={HRMAX_PLACEHOLDER}
                  durationSec={Math.max(
                    0,
                    ((session.ended_at ?? viewOpenedAtMs) - session.started_at) / 1000,
                  )}
                  sessionStartTs={session.started_at}
                />

                <View style={styles.sectionRow}>
                  <Text style={styles.section}>{t('page', 'exerciseListSection')}</Text>
                  <View style={styles.hideUncheckedToggle}>
                    <Text style={styles.hideUncheckedLabel}>{t('status', 'hideUnchecked')}</Text>
                    <Switch
                      value={hideUnchecked}
                      onValueChange={setHideUnchecked}
                    />
                  </View>
                </View>
                {sessionExercises.length === 0 ? (
                  <View style={styles.emptyPlanBlock}>
                    <Text style={styles.emptyPlanTitle}>{t('status', 'noExercisesAdded')}</Text>
                    <Text style={styles.emptyPlanBody}>
                      {t('status', 'emptyPlanBody')}
                    </Text>
                  </View>
                ) : (
                  <View style={styles.planList}>{renderEditBody()}</View>
                )}
              </>
            )}
          </NestableScrollContainer>
        ) : (
          // Read mode — original SoloExerciseBlock / ClusterBlock simple
          // read-only display in a plain ScrollView.
          <ScrollView contentContainerStyle={styles.body}>
            {loading ? (
              <Text style={styles.muted}>Loading…</Text>
            ) : error ? (
              <Text style={styles.error}>{error}</Text>
            ) : !session || !stats ? (
              <Text style={styles.muted}>No data.</Text>
            ) : (
              <>
                <Text style={styles.timestamp}>
                  {formatTimestamp(session.started_at)}
                  {session.ended_at != null
                    ? ` ~ ${formatTimestamp(session.ended_at)}`
                    : ''}
                </Text>

                <SessionStatsPanel
                  variant="4tile"
                  kcal={session.kcal}
                  sets={sets.map((s) => ({
                    set_kind: s.set_kind,
                    is_logged: s.is_logged,
                    reps: s.reps,
                    weight_kg: s.weight_kg,
                  }))}
                  exercise_count={countUniqueExercises(sessionExercises)}
                  started_at_ms={session.started_at}
                  ended_at_ms={session.ended_at ?? viewOpenedAtMs}
                  onTapDuration={
                    session.ended_at != null
                      ? () => setTimeEditorOpen(true)
                      : undefined
                  }
                />

                <Text style={styles.section}>{t('page', 'hrZoneSection')}</Text>
                <HRZoneChart
                  samples={hrSamples}
                  hrmax={HRMAX_PLACEHOLDER}
                  durationSec={Math.max(
                    0,
                    ((session.ended_at ?? viewOpenedAtMs) - session.started_at) / 1000,
                  )}
                  sessionStartTs={session.started_at}
                />

                <View style={styles.sectionRow}>
                  <Text style={styles.section}>{t('page', 'exerciseListSection')}</Text>
                  <View style={styles.hideUncheckedToggle}>
                    <Text style={styles.hideUncheckedLabel}>{t('status', 'hideUnchecked')}</Text>
                    <Switch
                      value={hideUnchecked}
                      onValueChange={setHideUnchecked}
                    />
                  </View>
                </View>
                {orderedItems.length === 0 ? (
                  <Text style={styles.muted}>No exercises.</Text>
                ) : (
                  orderedItems
                    .map((item) => {
                      if (item.kind === 'cluster') {
                        let renderCluster = item.cluster;
                        if (hideUnchecked) {
                          const filtered = filterUncheckedClusterPair(
                            item.cluster.setsA,
                            item.cluster.setsB,
                          );
                          if (filtered === null) return null;
                          renderCluster = {
                            ...item.cluster,
                            setsA: filtered.setsA,
                            setsB: filtered.setsB,
                          };
                        }
                        return (
                          <ClusterBlock
                            key={item.cluster.parent.id}
                            cluster={renderCluster}
                            rs={
                              item.cluster.parent.reusable_superset_id
                                ? rsById.get(
                                    item.cluster.parent.reusable_superset_id,
                                  ) ?? null
                                : null
                            }
                          />
                        );
                      }
                      let renderSets = item.sets;
                      if (hideUnchecked) {
                        const filtered = filterUncheckedSolo(item.sets);
                        if (filtered === null) return null;
                        renderSets = filtered;
                      }
                      return (
                        <SoloExerciseBlock
                          key={item.exercise.id}
                          exercise={item.exercise}
                          sets={renderSets}
                        />
                      );
                    })
                    .filter((node) => node !== null)
                )}
              </>
            )}
          </ScrollView>
        )}
      </GestureDetector>

      {/* Bottom sticky action bar — 4 buttons.
          Read mode: [編輯訓練][儲存模板][另存模板][刪除]
          Edit mode: [+ 動作][儲存模板][另存模板][刪除]
          完成 button 搬到 header 右上 (用戶 2026-05-20 night 要求)。 */}
      <View style={styles.actionBar}>
        {editMode ? (
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              router.push(`/exercise-picker?mode=picker&sessionId=${id}`)
            }
            disabled={busy}
            style={({ pressed }) => [
              styles.actionBtn,
              styles.actionBtnPrimary,
              busy && styles.actionBtnDisabled,
              pressed && styles.btnPressed,
            ]}>
            <Text style={[styles.actionBtnText, styles.actionBtnTextPrimary]}>
              {t('button', 'addExercise')}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            style={styles.actionBtn}
            onPress={enterEditMode}>
            <Text style={styles.actionBtnText}>{t('button', 'editSession')}</Text>
          </Pressable>
        )}
        <Pressable
          style={[styles.actionBtn, isFreestyle && styles.actionBtnDisabled]}
          disabled={isFreestyle}
          onPress={() => handleSaveTemplate('update')}>
          <Text style={styles.actionBtnText}>{t('button', 'saveTemplate')}</Text>
        </Pressable>
        <Pressable
          style={styles.actionBtn}
          onPress={() => handleSaveTemplate('create')}>
          <Text style={styles.actionBtnText}>{t('button', 'saveAsTemplate')}</Text>
        </Pressable>
        <Pressable
          style={styles.actionBtn}
          onPress={handleDelete}>
          <Text style={[styles.actionBtnText, styles.actionBtnTextDestructive]}>
            {t('common', 'delete')}
          </Text>
        </Pressable>
      </View>

      {/* 另存模板 bottom sheet (2026-05-18) */}
      <TemplateMetaSheet
        visible={templateMetaSheetOpen}
        defaultName={
          templateMetaPrefill?.name ??
          (session ? `Session ${formatDateLabel(session.started_at)}` : 'Session')
        }
        defaultProgramId={templateMetaPrefill?.program_id ?? null}
        defaultSubTag={templateMetaPrefill?.sub_tag ?? null}
        programs={programs}
        onCancel={() => setTemplateMetaSheetOpen(false)}
        onConfirm={handleTemplateMetaConfirm}
        busy={templateMetaBusy}
      />

      {/* Edit-mode shared sheets (mirror Today). */}
      <SetNoteSheet
        visible={noteSheetTarget !== null}
        initialValue={noteSheetTarget?.initial ?? null}
        onConfirm={(notes) => {
          if (noteSheetTarget) onUpdateNotes(noteSheetTarget.set_id, notes);
          setNoteSheetTarget(null);
        }}
        onCancel={() => setNoteSheetTarget(null)}
      />
      <NumericKeypad
        visible={keypadTarget !== null}
        initialValue={keypadTarget?.current ?? 0}
        label={keypadTarget?.field === 'weight' ? t('domain', 'weightKg') : t('domain', 'reps')}
        mode={keypadTarget?.field === 'weight' ? 'decimal' : 'integer'}
        onConfirm={(value) => {
          if (keypadTarget) {
            const patch =
              keypadTarget.field === 'weight'
                ? { weight: value }
                : { reps: value };
            onUpdateSet(keypadTarget.set_id, patch);
          }
          setKeypadTarget(null);
        }}
        onCancel={() => setKeypadTarget(null)}
      />
      {(() => {
        // Cluster (parent + child) collapse 成單列「A + B」、children 不獨立顯示。
        // onConfirm 時用 expandClusterIds 把 child id 塞回 parent id 後面，
        // 保 reorderSessionExercises 的 1..N 連續 ordering 中 cluster A↔B 緊鄰。
        const { rows: reorderRows, childByParent } =
          buildSessionReorderRows(sessionExercises);
        return (
          <ReorderExercisesSheet
            visible={reorderSheetOpen}
            initialItems={reorderRows}
            onConfirm={async (orderedParentIds) => {
              setReorderSheetOpen(false);
              if (!id) return;
              const orderedIds = expandClusterIds(
                orderedParentIds,
                childByParent,
              );
              try {
                await reorderSessionExercises(db, {
                  session_id: id,
                  orderedIds,
                });
                await load();
              } catch (e) {
                Alert.alert(
                  t('alert', 'reorderFailed'),
                  e instanceof Error ? e.message : String(e),
                );
              }
            }}
            onCancel={() => setReorderSheetOpen(false)}
          />
        );
      })()}
      <SetNoteSheet
        visible={exerciseNoteTarget !== null}
        initialValue={exerciseNoteTarget?.initial ?? null}
        title={exerciseNoteTarget ? tExerciseNoteHeader(exerciseNoteTarget.exercise_name) : ''}
        placeholder={t('page', 'notePlaceholder')}
        onConfirm={async (notes) => {
          if (exerciseNoteTarget) {
            try {
              await updateExerciseNotes(
                db,
                exerciseNoteTarget.exercise_id,
                notes,
              );
            } catch (e) {
              Alert.alert(
                t('alert', 'saveFailed'),
                e instanceof Error ? e.message : String(e),
              );
            }
          }
          setExerciseNoteTarget(null);
        }}
        onCancel={() => setExerciseNoteTarget(null)}
      />
      <NumericKeypad
        visible={restSecTarget !== null}
        initialValue={restSecTarget?.current ?? 60}
        label={tRestSecondsHeader(restSecTarget?.exercise_name ?? '')}
        mode="integer"
        onConfirm={async (value) => {
          if (restSecTarget) {
            try {
              await updateSessionExerciseRestSec(
                db,
                restSecTarget.session_exercise_id,
                value,
              );
              await load();
            } catch (e) {
              Alert.alert(
                t('alert', 'saveFailed'),
                e instanceof Error ? e.message : String(e),
              );
            }
          }
          setRestSecTarget(null);
        }}
        onCancel={() => setRestSecTarget(null)}
      />

      {/* Tap 訓練時間 → SessionTimeEditorSheet (overnight #59).
          Only when ended_at is non-null (always true on detail page since
          we only navigate here after endSession). */}
      <SessionTimeEditorSheet
        visible={timeEditorOpen}
        started_at_ms={session?.started_at ?? viewOpenedAtMs}
        ended_at_ms={session?.ended_at ?? viewOpenedAtMs}
        onSave={handleTimeSave}
        onClose={() => setTimeEditorOpen(false)}
      />
      {/* Round F Q2 — bottom toast (replaces Alert.alert on [儲存模板]). */}
      <ToastHost controller={toastRef.current!} />
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Types & helpers
// ─────────────────────────────────────────────────────────────────────────

interface SessionWithHK extends Session {
  /** v016 column — null until HealthKit writes from slice 13 onwards. */
  kcal: number | null;
  /** v016 column — null until HealthKit writes from slice 13 onwards. */
  avg_hr_bpm: number | null;
}

async function loadHealthkitColumns(
  db: ReturnType<typeof useDatabase>,
  id: string
): Promise<{ kcal: number | null; avg_hr_bpm: number | null }> {
  // Separate query because the Session domain type doesn't yet model v016
  // columns. Defensive: if the columns don't exist (test DB migrating to a
  // lower version), the catch falls back to nulls.
  try {
    const row = await db.getFirstAsync<{
      kcal: number | null;
      avg_hr_bpm: number | null;
    }>(
      `SELECT kcal, avg_hr_bpm FROM session WHERE id = ?`,
      id
    );
    return {
      kcal: row?.kcal ?? null,
      avg_hr_bpm: row?.avg_hr_bpm ?? null,
    };
  } catch {
    return { kcal: null, avg_hr_bpm: null };
  }
}

function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString();
}

// ─────────────────────────────────────────────────────────────────────────
// 隱藏未打勾 filter helpers (2026-05-20)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Resolve a set's "effective is_logged": for dropset followers, walk up to
 * the head and use the head's is_logged. Followers themselves are not
 * separately toggleable in UI — the head's ✓ represents the whole chain.
 */
function resolveEffectiveLogged<
  T extends {
    id: string;
    is_logged: number;
    set_kind: 'warmup' | 'working' | 'dropset';
    parent_set_id: string | null;
  },
>(set: T, byId: Map<string, T>): number {
  if (set.set_kind === 'dropset' && set.parent_set_id != null) {
    const head = byId.get(set.parent_set_id);
    if (head) return head.is_logged;
  }
  return set.is_logged;
}

/**
 * Filter unchecked (effective is_logged !== 1) sets from a solo exercise card.
 * Dropset chains are treated as one unit — if head is logged, all followers
 * stay visible (chain integrity). Returns `null` when every set is unchecked
 * (caller hides the whole card).
 */
function filterUncheckedSolo<
  T extends {
    id: string;
    is_logged: number;
    set_kind: 'warmup' | 'working' | 'dropset';
    parent_set_id: string | null;
  },
>(sets: T[]): T[] | null {
  const byId = new Map(sets.map((s) => [s.id, s] as const));
  const visible = sets.filter((s) => resolveEffectiveLogged(s, byId) === 1);
  if (sets.length > 0 && visible.length === 0) return null;
  return visible;
}

/**
 * Pair-aligned filter for cluster cycles: hide a cycle only when BOTH the
 * A side and B side of that cycle are (effectively) unchecked. Dropset
 * followers inherit their head's logged state so the whole chain travels
 * together. Returns `null` when every paired cycle is fully unchecked.
 */
function filterUncheckedClusterPair<
  T extends {
    id: string;
    is_logged: number;
    set_kind: 'warmup' | 'working' | 'dropset';
    parent_set_id: string | null;
  },
>(setsA: T[], setsB: T[]): { setsA: T[]; setsB: T[] } | null {
  const byIdA = new Map(setsA.map((s) => [s.id, s] as const));
  const byIdB = new Map(setsB.map((s) => [s.id, s] as const));
  const n = Math.min(setsA.length, setsB.length);
  const outA: T[] = [];
  const outB: T[] = [];
  for (let i = 0; i < n; i++) {
    const aLogged = resolveEffectiveLogged(setsA[i], byIdA) === 1;
    const bLogged = resolveEffectiveLogged(setsB[i], byIdB) === 1;
    if (!aLogged && !bLogged) continue;
    outA.push(setsA[i]);
    outB.push(setsB[i]);
  }
  // Leftover (defensive — sides usually equal length): drop unchecked tail sets.
  for (let i = n; i < setsA.length; i++) {
    if (resolveEffectiveLogged(setsA[i], byIdA) === 1) outA.push(setsA[i]);
  }
  for (let i = n; i < setsB.length; i++) {
    if (resolveEffectiveLogged(setsB[i], byIdB) === 1) outB.push(setsB[i]);
  }
  if (
    (setsA.length > 0 || setsB.length > 0) &&
    outA.length === 0 &&
    outB.length === 0
  ) {
    return null;
  }
  return { setsA: outA, setsB: outB };
}

function formatDateLabel(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

// ─────────────────────────────────────────────────────────────────────────
// Solo exercise block — READ MODE rendering
// ─────────────────────────────────────────────────────────────────────────

function SoloExerciseBlock({
  exercise,
  sets,
}: {
  exercise: SessionExerciseRowWithName;
  sets: SessionSetWithExercise[];
}) {
  const styles = useSessionStyles();
  // Session 詳情頁 read mode：用 computeSessionSetLayout，dropset chain
  // 只在 head 顯示 `D{N}`、follower 留空（mirror active session / edit mode）。
  // 避免出現 D1..D12 把整條 chain 每個 row 都當獨立 D 算的問題。
  const labelMap = useMemo(
    () =>
      computeSessionSetLayout(
        sets.map((s) => ({
          id: s.id,
          set_kind: s.set_kind,
          parent_set_id: s.parent_set_id,
          ordering: s.ordering,
        }))
      ).labels,
    [sets]
  );
  return (
    <View style={styles.exCard}>
      <View style={styles.exHeader}>
        <Text style={styles.exName}>{tExercise(exercise.exercise_name)}</Text>
      </View>
      {sets.length === 0 ? (
        <Text style={styles.muted}>No sets recorded.</Text>
      ) : (
        <View style={styles.setsBox}>
          {sets.map((s) => (
            <ReadOnlySetRow
              key={s.id}
              label={labelMap.get(s.id) ?? ''}
              setRow={s}
              loadType={exercise.exercise_load_type}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function ReadOnlySetRow({
  label,
  setRow,
  loadType,
}: {
  label: string;
  setRow: SessionSetWithExercise;
  loadType: 'loaded' | 'bodyweight' | 'assisted';
}) {
  const styles = useSessionStyles();
  return (
    <View style={styles.setRow}>
      <Text style={styles.setOrdering}>{label}</Text>
      <Text style={styles.setText}>{formatSetCell(setRow, loadType)}</Text>
      {setRow.is_logged === 1 && <Text style={styles.setCheck}>✓</Text>}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Cluster grouping (ADR-0018 v014) — READ MODE rendering
// ─────────────────────────────────────────────────────────────────────────

interface ClusterRow {
  parent: SessionExerciseRowWithName;
  child: SessionExerciseRowWithName;
  /** Sets belonging to the parent (A side), ordered by ordering ASC. */
  setsA: SessionSetWithExercise[];
  /** Sets belonging to the child (B side), ordered by ordering ASC. */
  setsB: SessionSetWithExercise[];
}

function buildClusters(
  sessionExercises: SessionExerciseRowWithName[],
  sets: SessionSetWithExercise[]
): ClusterRow[] {
  const parentIds = new Set<string>();
  for (const e of sessionExercises) {
    if (e.parent_id !== null) parentIds.add(e.parent_id);
  }
  const out: ClusterRow[] = [];
  for (const parent of sessionExercises) {
    if (!parentIds.has(parent.id)) continue;
    const child = sessionExercises.find((e) => e.parent_id === parent.id);
    if (!child) continue;
    const setsA = sets
      .filter((s) =>
        s.session_exercise_id === parent.id ||
        (s.session_exercise_id == null && s.exercise_id === parent.exercise_id),
      )
      .sort((a, b) => a.ordering - b.ordering);
    const setsB = sets
      .filter((s) =>
        s.session_exercise_id === child.id ||
        (s.session_exercise_id == null && s.exercise_id === child.exercise_id),
      )
      .sort((a, b) => a.ordering - b.ordering);
    out.push({ parent, child, setsA, setsB });
  }
  return out;
}

type OrderedItem =
  | { kind: 'solo'; exercise: SessionExerciseRowWithName; sets: SessionSetWithExercise[] }
  | { kind: 'cluster'; cluster: ClusterRow };

function buildOrderedItems(
  sessionExercises: SessionExerciseRowWithName[],
  clusters: ClusterRow[],
  sets: SessionSetWithExercise[]
): OrderedItem[] {
  const clusterChildIds = new Set<string>();
  const clusterByParentId = new Map<string, ClusterRow>();
  for (const c of clusters) {
    clusterChildIds.add(c.child.id);
    clusterByParentId.set(c.parent.id, c);
  }
  const out: OrderedItem[] = [];
  for (const ex of sessionExercises) {
    if (clusterChildIds.has(ex.id)) continue;
    const cluster = clusterByParentId.get(ex.id);
    if (cluster) {
      out.push({ kind: 'cluster', cluster });
      continue;
    }
    const exSets = sets
      .filter((s) =>
        s.session_exercise_id === ex.id ||
        (s.session_exercise_id == null && s.exercise_id === ex.exercise_id),
      )
      .sort((a, b) => a.ordering - b.ordering);
    out.push({ kind: 'solo', exercise: ex, sets: exSets });
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
  const styles = useSessionStyles();
  const { tokens } = useTheme();
  // Fallback border accent for clusters with no RS color — use border.default
  // (legacy `#9aa0a6` was a hard-coded mid-gray with bad dark-mode contrast).
  const color = rs?.superset.color_hex ?? tokens.border.default;
  const rowCount = Math.max(cluster.setsA.length, cluster.setsB.length);
  const rows = Array.from({ length: rowCount }).map((_, i) => ({
    a: cluster.setsA[i] ?? null,
    b: cluster.setsB[i] ?? null,
  }));
  // 與 SoloExerciseBlock 同理：cluster 兩側各自用 computeSessionSetLayout
  // 讓 dropset chain 的 D{N} 只標在 head row、follower 留空。
  const labelsA = useMemo(
    () =>
      computeSessionSetLayout(
        cluster.setsA.map((s) => ({
          id: s.id,
          set_kind: s.set_kind,
          parent_set_id: s.parent_set_id,
          ordering: s.ordering,
        })),
      ).labels,
    [cluster.setsA],
  );
  const labelsB = useMemo(
    () =>
      computeSessionSetLayout(
        cluster.setsB.map((s) => ({
          id: s.id,
          set_kind: s.set_kind,
          parent_set_id: s.parent_set_id,
          ordering: s.ordering,
        })),
      ).labels,
    [cluster.setsB],
  );
  return (
    <View
      style={[
        styles.clusterCard,
        { borderColor: color, backgroundColor: hexAlpha(color, 0.08) },
      ]}>
      <View style={styles.clusterHeader}>
        <View style={styles.clusterTagRow}>
          <Text style={styles.supersetTag}>{t('domain', 'supersetChip')}</Text>
        </View>
        <Text style={styles.clusterLabel}>
          {tExercise(cluster.parent.exercise_name)}
          <Text style={styles.clusterPlus}> + </Text>
          {tExercise(cluster.child.exercise_name)}
        </Text>
        {/* Column-aligned exercise name sub-headers: cycle slot + A column +
            B column + check slot (mirrors the data row structure so names
            sit directly above their values). */}
        <View style={styles.clusterPairRow}>
          <View style={styles.clusterCycle} />
          <View style={styles.clusterCell}>
            <Text style={styles.clusterColumnHeader} numberOfLines={1}>
              {tExercise(cluster.parent.exercise_name)}
            </Text>
          </View>
          <View style={styles.clusterCell}>
            <Text style={styles.clusterColumnHeader} numberOfLines={1}>
              {tExercise(cluster.child.exercise_name)}
            </Text>
          </View>
          <View style={styles.clusterCheckSlot} />
        </View>
      </View>
      <View style={styles.clusterDivider} />
      {rows.length === 0 ? (
        <Text style={styles.muted}>No sets recorded.</Text>
      ) : (
        rows.map((r, i) => {
          const cycleLabel =
            (r.a ? labelsA.get(r.a.id) : undefined) ??
            (r.b ? labelsB.get(r.b.id) : undefined) ??
            String(i + 1);
          return (
            <View key={i} style={styles.clusterPairRow}>
              <Text style={styles.clusterCycle}>{cycleLabel}</Text>
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
              <View style={styles.clusterCheckSlot}>
                {r.a?.is_logged === 1 || r.b?.is_logged === 1 ? (
                  <Text style={styles.setCheck}>✓</Text>
                ) : null}
              </View>
            </View>
          );
        })
      )}
    </View>
  );
}

function formatSetCell(
  s: SessionSetWithExercise,
  load_type: 'loaded' | 'bodyweight' | 'assisted'
): string {
  if (load_type === 'bodyweight') return `BW × ${s.reps}`;
  if (load_type === 'assisted') return `-${s.weight_kg} kg × ${s.reps}`;
  return `${s.weight_kg} kg × ${s.reps}`;
}

function hexAlpha(hex: string, alpha: number): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
  const a = Math.max(0, Math.min(255, Math.round(alpha * 255)))
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}

// ─────────────────────────────────────────────────────────────────────────
// EditableExerciseCard — EDIT MODE solo card (mirror Today's ExerciseCard)
// ─────────────────────────────────────────────────────────────────────────

type EditableExerciseCardProps = {
  planRow: SessionExerciseRowWithName;
  isExpanded: boolean;
  sets: SessionSetWithExercise[];
  busy: boolean;
  onToggleExpand: () => void;
  onAddSet: () => void;
  onUpdateSet: (
    set_id: string,
    patch: { reps?: number; weight?: number },
  ) => void;
  onCycleSetKind: (set_id: string) => void;
  onDeleteSet: (set_id: string) => void;
  onAddSetAfter: (set_id: string) => void;
  onAddDropsetRow: (after_set_id: string) => void;
  onRemoveDropsetRow: (set_id: string) => void;
  onToggleLogged: (set_id: string, currentlyLogged: boolean) => void;
  onShowSetNote: (set_id: string, currentNotes: string | null) => void;
  onTapNumber: (
    set_id: string,
    field: 'reps' | 'weight',
    current: number,
  ) => void;
  onOpenHistory: () => void;
  onSettingsPress: () => void;
  onLongPressHeader: () => void;
  onConfirmReorderSets: (orderedIds: string[]) => Promise<void> | void;
};

function EditableExerciseCard({
  planRow,
  isExpanded,
  sets,
  busy,
  onToggleExpand,
  onAddSet,
  onUpdateSet,
  onCycleSetKind,
  onDeleteSet,
  onAddSetAfter,
  onAddDropsetRow,
  onRemoveDropsetRow,
  onToggleLogged,
  onShowSetNote,
  onTapNumber,
  onOpenHistory,
  onSettingsPress,
  onLongPressHeader,
  onConfirmReorderSets,
}: EditableExerciseCardProps) {
  const styles = useSessionStyles();
  const { tokens } = useTheme();
  // Slice 10c overnight #61 — labels + groups via computeSessionSetLayout
  // (mirror active session / template editor). Replaces prior
  // computeWorkingSetOrdinals + displaySetLabel path.
  const layout = useMemo(
    () =>
      computeSessionSetLayout(
        sets.map((s) => ({
          id: s.id,
          set_kind: s.set_kind,
          parent_set_id: s.parent_set_id,
          ordering: s.ordering,
        })),
      ),
    [sets],
  );
  const { labels, groups } = layout;
  const setsById = useMemo(
    () => new Map(sets.map((s) => [s.id, s] as const)),
    [sets],
  );
  const progress = useMemo(
    () =>
      computeExerciseProgress(
        sets.map((s) => ({
          id: s.id,
          set_kind: s.set_kind,
          is_logged: s.is_logged,
          weight_kg: s.weight_kg,
          reps: s.reps,
          parent_set_id: s.parent_set_id,
        })),
      ),
    [sets],
  );
  // No PR snapshot — detail page edit mode skips PR ceremony (just like
  // Today does post-toggle, but here we don't have the in-session helpers).
  // If demand emerges, easy to add via listPriorSetsForExercise + computePRSnapshot.
  return (
    <View
      style={[styles.exerciseCard, isExpanded && styles.exerciseCardExpanded]}
    >
      <View style={styles.exerciseCardHeader}>
        <Pressable
          accessibilityRole="button"
          onPress={onToggleExpand}
          onLongPress={onLongPressHeader}
          delayLongPress={400}
          style={({ pressed }) => [
            styles.exerciseCardHeaderMain,
            pressed && styles.btnPressed,
          ]}
        >
          <View style={styles.planText}>
            {/*
              #2 (2026-05-30) — 容量分數移到標題行右側；進度條成為標題↔set
              的全寬格線。與 in-session 動作卡 (app/(tabs)/index.tsx) 一致。
            */}
            <View style={styles.exerciseCardTitleRow}>
              <Text style={styles.planName} numberOfLines={1}>
                {tExercise(planRow.exercise_name)}
              </Text>
              {progress.setsTotal > 0 && progress.volumeTotal > 0 ? (
                <Text style={styles.exerciseCardVolumeChip}>
                  {Math.round(progress.volumeDone)}/
                  {Math.round(progress.volumeTotal)}
                </Text>
              ) : null}
            </View>
            {progress.setsTotal > 0 ? (
              <View style={styles.exerciseCardProgressRow}>
                <View style={styles.exerciseCardProgressBarFill}>
                  <SegmentedProgressBar
                    done={progress.setsDone}
                    total={progress.setsTotal}
                  />
                </View>
              </View>
            ) : null}
          </View>
          <Text style={styles.exerciseCardChevron}>
            {isExpanded ? '▼' : '▶'}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('button', 'a11yExerciseSettings')}
          onPress={onSettingsPress}
          style={({ pressed }) => [
            styles.exerciseCardGear,
            pressed && styles.btnPressed,
          ]}
        >
          <Text style={styles.exerciseCardGearText}>⚙️</Text>
        </Pressable>
      </View>
      {isExpanded && (
        <View style={styles.exerciseCardBody}>
          {/*
            Slice 10e bundle 1 — per-Exercise global notes (ADR-0013)
            inline render in history-detail edit mode, mirror Today's
            ExerciseCard. Notes content is read-only here; edit happens
            via Library / Template editor (single source of truth).
          */}
          {planRow.exercise_notes && planRow.exercise_notes.trim().length > 0 ? (
            <View style={styles.exerciseCardNotes}>
              <Text style={styles.exerciseCardNotesText}>
                💬 {planRow.exercise_notes.trim()}
              </Text>
            </View>
          ) : null}
          {sets.length === 0 ? (
            <Text style={styles.exerciseCardEmpty}>
              {t('status', 'soloEmptyHint')}
            </Text>
          ) : (
            <NestableDraggableFlatList
              data={groups}
              keyExtractor={(g) => g.head.id}
              activationDistance={20}
              onDragEnd={async ({ data }) => {
                // Slice 10c overnight #61 — group-based drag (mirror Today).
                // Flatten new group order back to a flat set-id sequence
                // preserving chain contiguity (follower never splits from
                // its head via drag).
                const newIds = data.flatMap((g) => [
                  g.head.id,
                  ...g.followers.map((f) => f.id),
                ]);
                const oldIds = sets.map((s) => s.id);
                const changed = newIds.some((id, idx) => id !== oldIds[idx]);
                if (changed) await onConfirmReorderSets(newIds);
              }}
              renderItem={({
                item: g,
                drag,
                isActive,
              }: RenderItemParams<(typeof groups)[number]>) => {
                const head = setsById.get(g.head.id)!;
                const isDropsetCluster =
                  head.set_kind === 'dropset' && g.followers.length > 0;
                const clusterSize = 1 + g.followers.length;
                const followerMinusDisabled = clusterSize <= 2;
                const headRow: SetRowItem = {
                  id: head.id,
                  reps: head.reps ?? 0,
                  weight: head.weight_kg ?? 0,
                  notes: head.notes,
                };
                const headLogged = head.is_logged === 1;
                return (
                  <SwipeableSetRow
                    onLongPress={drag}
                    swipeLeftActions={[
                      {
                        key: 'delete',
                        label: t('common', 'delete'),
                        color: tokens.action.destructive,
                        onPress: () => onDeleteSet(head.id),
                      },
                    ]}
                    swipeRightActions={[
                      {
                        key: 'add',
                        label: '+1',
                        color: tokens.action.success,
                        onPress: () => onAddSetAfter(head.id),
                      },
                      {
                        key: 'note',
                        label: t('domain', 'note'),
                        color: tokens.action.primary,
                        onPress: () => onShowSetNote(head.id, head.notes),
                      },
                    ]}
                  >
                    <View
                      style={[
                        isDropsetCluster
                          ? styles.exerciseCardDropsetClusterStack
                          : null,
                        isActive && styles.exerciseCardSetRowDragActive,
                      ]}
                    >
                      {/* HEAD row */}
                      <View style={styles.exerciseCardSetRowWrapper}>
                        <View style={styles.exerciseCardSetRowContent}>
                          <SetRowContent
                            set={headRow}
                            setLabel={labels.get(head.id) ?? ''}
                            isDropsetFollower={false}
                            isClusterLast={false}
                            minusDisabled={false}
                            hideNoteIndicator={false}
                            onUpdateSet={(set_id, patch) =>
                              onUpdateSet(set_id, patch)
                            }
                            onShowSetNote={(target) =>
                              onShowSetNote(target.id, target.notes)
                            }
                            onTapNumber={(target, field, current) =>
                              onTapNumber(target.id, field, current)
                            }
                            onRemoveDropsetRow={(set_id) =>
                              onRemoveDropsetRow(set_id)
                            }
                            onAddDropsetRow={(set_id) =>
                              onAddDropsetRow(set_id)
                            }
                            onCycleLabel={(target) =>
                              onCycleSetKind(target.id)
                            }
                          />
                        </View>
                        <Pressable
                          onPress={() => onToggleLogged(head.id, headLogged)}
                          hitSlop={6}
                          accessibilityRole="button"
                          accessibilityLabel={
                            headLogged ? t('button', 'uncheck') : t('button', 'markAsDone')
                          }
                          style={({ pressed }) => [
                            styles.completeBtn,
                            headLogged && styles.completeBtnDone,
                            pressed && styles.btnPressed,
                          ]}
                        >
                          <Text
                            style={[
                              styles.completeBtnText,
                              headLogged && styles.completeBtnTextDone,
                            ]}
                          >
                            {headLogged ? '✓' : '○'}
                          </Text>
                        </Pressable>
                      </View>
                      {/*
                        Slice 10c overnight #61 — dropset followers share the
                        head's SwipeableSetRow. No ✓ button; spacer keeps
                        SetRowContent column-aligned with the head row.
                      */}
                      {g.followers.map((fset, fIdx) => {
                        const f = setsById.get(fset.id)!;
                        const fRow: SetRowItem = {
                          id: f.id,
                          reps: f.reps ?? 0,
                          weight: f.weight_kg ?? 0,
                          notes: f.notes,
                        };
                        return (
                          <View
                            key={f.id}
                            style={styles.exerciseCardSetRowWrapper}
                          >
                            <View style={styles.exerciseCardSetRowContent}>
                              <SetRowContent
                                set={fRow}
                                setLabel=""
                                isDropsetFollower
                                isClusterLast={
                                  fIdx === g.followers.length - 1
                                }
                                minusDisabled={followerMinusDisabled}
                                hideNoteIndicator={false}
                                onUpdateSet={(set_id, patch) =>
                                  onUpdateSet(set_id, patch)
                                }
                                onShowSetNote={(target) =>
                                  onShowSetNote(target.id, target.notes)
                                }
                                onTapNumber={(target, field, current) =>
                                  onTapNumber(target.id, field, current)
                                }
                                onRemoveDropsetRow={(set_id) =>
                                  onRemoveDropsetRow(set_id)
                                }
                                onAddDropsetRow={(set_id) =>
                                  onAddDropsetRow(set_id)
                                }
                                onCycleLabel={(target) =>
                                  onCycleSetKind(target.id)
                                }
                              />
                            </View>
                            <View style={styles.completeBtnSpacer} />
                          </View>
                        );
                      })}
                    </View>
                  </SwipeableSetRow>
                );
              }}
            />
          )}
          <View style={styles.exerciseCardFooter}>
            <Pressable
              accessibilityRole="button"
              onPress={onAddSet}
              disabled={busy}
              style={({ pressed }) => [
                styles.exerciseCardFooterBtn,
                styles.exerciseCardFooterBtnPrimary,
                busy && styles.btnDisabled,
                pressed && styles.btnPressed,
              ]}
            >
              <Text style={styles.exerciseCardFooterBtnTextPrimary}>
                {t('button', 'addOneSet')}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={onOpenHistory}
              style={({ pressed }) => [
                styles.exerciseCardFooterBtn,
                styles.exerciseCardFooterBtnSecondary,
                pressed && styles.btnPressed,
              ]}
            >
              <Text style={styles.exerciseCardFooterBtnTextSecondary}>
                {t('page', 'exerciseHistory')}
              </Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────

/**
 * ADR-0025 — token-driven styles. The 3349-LOC detail page mirrors the
 * canonical big-file pattern in `app/(tabs)/index.tsx`: all 5 components
 * (SessionDetailScreen + 4 sub-cards) call `useSessionStyles()` to derive
 * matching styles from the same token set.
 *
 * Notable kept-raw exceptions (with reason):
 *   - `#FF375F` editChip — high-saturation "Editing" pink badge, brand
 *     accent kept identical across modes (visual flag the user is in
 *     mutation mode; must remain attention-grabbing in both themes).
 *   - `#FEF3C7` / `#F59E0B` / `#78350F` notes callout — semantic amber
 *     "post-it" identical to TodayScreen's notes block (matches index.tsx
 *     wave-1 sweep; explicitly kept raw there for the same reason).
 *   - `#5856D6` supersetTag — brand indigo matching template-editor +
 *     ClusterCard (visual consistency with the «超» chip elsewhere).
 *   - Drag-active card shadow `#000` — shadow color, not a theme surface.
 */
function makeStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: tokens.bg.base },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: tokens.border.default,
      gap: 8,
    },
    headerBackBtn: { paddingHorizontal: 8, paddingVertical: 6 },
    headerBackText: { fontSize: 15, color: tokens.action.primary },
    // ADR-0014 + ADR-0019 Q10 — header title column hosts title row +
    // optional subtitle 「週期 · 強度」. flex:1 owns the middle slot so
    // back / done buttons keep their right slot intact; column 'center'
    // alignment matches iOS nav-bar conventions.
    headerTitleCol: {
      flex: 1,
      flexDirection: 'column',
      alignItems: 'center',
      gap: 2,
    },
    headerTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    headerTitleText: {
      fontSize: 17,
      fontWeight: '700',
      color: tokens.text.primary,
    },
    headerSubtitle: {
      fontSize: 12,
      color: tokens.text.secondary,
      maxWidth: '100%',
    },
    // Editing chip — kept raw `#FF375F` brand pink, identical in both
    // modes so it stays attention-grabbing as a mutation-mode flag.
    editChip: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 10,
      backgroundColor: '#FF375F',
    },
    editChipText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
    headerSpacer: { width: 60 },
    headerDoneBtn: {
      paddingHorizontal: 8,
      paddingVertical: 6,
      minWidth: 60,
      alignItems: 'flex-end',
    },
    headerDoneText: {
      fontSize: 15,
      color: tokens.action.primary,
      fontWeight: '700',
    },

    // Same-day switcher sub-row.
    sameDayBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 6,
      paddingHorizontal: 12,
      gap: 16,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: tokens.border.subtle,
      backgroundColor: tokens.bg.elevated,
    },
    sameDayBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: tokens.bg.surface,
    },
    sameDayBtnDisabled: { backgroundColor: tokens.bg.elevated },
    sameDayBtnText: {
      fontSize: 17,
      color: tokens.action.primary,
      fontWeight: '600',
    },
    sameDayBtnTextDisabled: { color: tokens.text.tertiary },
    sameDayIndicator: {
      fontSize: 14,
      fontWeight: '600',
      color: tokens.text.primary,
      minWidth: 36,
      textAlign: 'center',
    },
    body: { padding: 16, gap: 12, paddingBottom: 100 },
    timestamp: { fontSize: 13, color: tokens.text.secondary },
    section: { fontSize: 14, fontWeight: '600', color: tokens.text.secondary },
    sectionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 12,
    },
    hideUncheckedToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    hideUncheckedLabel: { fontSize: 13, color: tokens.text.secondary },

    // Empty-state placeholder (mirror Today's emptyPlanBlock).
    emptyPlanBlock: {
      padding: 24,
      alignItems: 'center',
      gap: 8,
      backgroundColor: tokens.bg.elevated,
      borderRadius: 12,
      marginTop: 8,
    },
    emptyPlanTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: tokens.text.primary,
    },
    emptyPlanBody: {
      fontSize: 13,
      color: tokens.text.secondary,
      textAlign: 'center',
    },
    planList: { gap: 8, marginTop: 8 },

    // ── Read-mode solo card ──────────────────────────────────────────────
    exCard: {
      borderRadius: 10,
      backgroundColor: tokens.bg.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: tokens.border.default,
      overflow: 'hidden',
      marginTop: 8,
    },
    exHeader: {
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    exName: {
      fontSize: 15,
      fontWeight: '600',
      color: tokens.text.primary,
    },
    setsBox: {
      paddingHorizontal: 12,
      paddingBottom: 10,
      gap: 4,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: tokens.border.subtle,
      paddingTop: 8,
    },
    setRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 4,
    },
    setOrdering: {
      fontSize: 13,
      color: tokens.text.secondary,
      width: 28,
    },
    setText: { flex: 1, fontSize: 14, color: tokens.text.primary },
    setCheck: {
      fontSize: 16,
      color: tokens.action.success,
      fontWeight: '600',
    },

    // ── Read-mode cluster card ───────────────────────────────────────────
    clusterCard: {
      borderWidth: 1.5,
      borderRadius: 12,
      padding: 12,
      marginTop: 8,
    },
    clusterHeader: {
      flexDirection: 'column',
      gap: 4,
      marginBottom: 0,
    },
    clusterTagRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    // ADR-0025 — purple/white kept raw: brand accent matches the «超» pill
    // in components/session/cluster-card.tsx + template-editor.
    supersetTag: {
      fontSize: 11,
      fontWeight: '700',
      color: '#fff',
      backgroundColor: '#5856D6',
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
      overflow: 'hidden',
      alignSelf: 'flex-start',
    },
    // Main title matches solo exName (fontSize 15 / weight 600).
    clusterLabel: {
      fontSize: 15,
      fontWeight: '600',
      color: tokens.text.primary,
    },
    clusterPlus: { fontSize: 15, color: tokens.text.tertiary },
    clusterPairRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 4,
    },
    clusterCycle: {
      fontSize: 12,
      color: tokens.text.secondary,
      width: 24,
    },
    clusterCell: { flex: 1 },
    clusterCellText: { fontSize: 13, color: tokens.text.primary },
    clusterCellEmpty: { fontSize: 13, color: tokens.text.tertiary },
    // Fixed-width slot keeps A/B columns aligned regardless of whether the
    // ✓ checkmark is shown (else flex:1 cells absorb the extra width and
    // B drifts right when no logged set in that cycle).
    clusterCheckSlot: { width: 16, alignItems: 'center' },
    // Column sub-header — smaller than main title, sits tight above the rows.
    clusterColumnHeader: {
      fontSize: 12,
      fontWeight: '600',
      color: tokens.text.secondary,
    },
    clusterDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: tokens.border.default,
      marginTop: 2,
      marginBottom: 4,
    },

    // ── Edit-mode solo card (mirrors Today's exerciseCard styles) ────────
    exerciseCard: {
      backgroundColor: tokens.bg.surface,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: tokens.border.default,
      overflow: 'hidden',
    },
    exerciseCardExpanded: {
      borderColor: tokens.action.primary,
    },
    exerciseCardHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
    },
    exerciseCardHeaderMain: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
      paddingVertical: 10,
      paddingHorizontal: 12,
    },
    planText: { flex: 1, gap: 4 },
    exerciseCardTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      // #2 — name 左、容量分數右 (chip 移上來後共用此行)。
      justifyContent: 'space-between',
    },
    planName: {
      fontSize: 15,
      fontWeight: '600',
      color: tokens.text.primary,
      // #2 — 長名 truncate，留空間給同行的容量分數。
      flexShrink: 1,
    },
    exerciseCardProgressRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      width: '100%',
    },
    exerciseCardProgressBarFill: { flex: 1 },
    exerciseCardVolumeChip: {
      fontSize: 12,
      fontWeight: '600',
      color: tokens.text.secondary,
      minWidth: 76,
      textAlign: 'right',
    },
    exerciseCardChevron: {
      fontSize: 14,
      color: tokens.text.tertiary,
      width: 18,
      textAlign: 'right',
    },
    exerciseCardGear: {
      paddingVertical: 10,
      paddingHorizontal: 12,
      minWidth: 44,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    exerciseCardGearText: { fontSize: 18 },
    // Slice 10e bundle 1 — per-Exercise notes callout. Semantic amber
    // "post-it" kept raw to mirror the wave-1 TodayScreen sweep — high-
    // saturation warmth signals user-authored note regardless of mode.
    exerciseCardNotes: {
      backgroundColor: '#FEF3C7',
      borderLeftWidth: 3,
      borderLeftColor: '#F59E0B',
      paddingVertical: 8,
      paddingHorizontal: 10,
      borderRadius: 4,
    },
    exerciseCardNotesText: {
      fontSize: 13,
      color: '#78350F',
      lineHeight: 18,
    },
    exerciseCardBody: {
      paddingHorizontal: 12,
      paddingBottom: 12,
      gap: 6,
    },
    exerciseCardEmpty: {
      fontSize: 13,
      color: tokens.text.tertiary,
      fontStyle: 'italic',
      paddingVertical: 8,
    },
    exerciseCardSetRowWrapper: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 4,
      gap: 8,
    },
    exerciseCardSetRowContent: {
      flex: 1,
    },
    /**
     * Slice 10c overnight #61 — dropset chain cluster stack. Head + all
     * followers render inside ONE SwipeableSetRow (single swipe unit),
     * stacked vertically via this container. Mirror Today
     * (`exerciseCardDropsetClusterStack` in app/(tabs)/index.tsx).
     */
    exerciseCardDropsetClusterStack: {
      flexDirection: 'column',
    },
    exerciseCardSetRowDragActive: {
      backgroundColor: tokens.bg.elevated,
      elevation: 6,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.18,
      shadowRadius: 6,
      borderRadius: 8,
    },
    exerciseCardFooter: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 8,
    },
    exerciseCardFooterBtn: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 8,
      alignItems: 'center',
    },
    exerciseCardFooterBtnPrimary: {
      backgroundColor: tokens.action.primary,
    },
    exerciseCardFooterBtnSecondary: {
      backgroundColor: tokens.bg.elevated,
    },
    exerciseCardFooterBtnTextPrimary: {
      color: tokens.action.onPrimary,
      fontSize: 14,
      fontWeight: '600',
    },
    exerciseCardFooterBtnTextSecondary: {
      color: tokens.action.primary,
      fontSize: 14,
      fontWeight: '600',
    },
    completeBtn: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: tokens.bg.elevated,
    },
    completeBtnDone: { backgroundColor: tokens.action.success },
    completeBtnText: {
      fontSize: 14,
      fontWeight: '700',
      color: tokens.text.secondary,
    },
    completeBtnTextDone: { color: tokens.action.onPrimary },
    /**
     * Slice 10c overnight #61 — same width as completeBtn so dropset
     * follower rows keep their SetRowContent column-aligned with the head
     * row (head has ✓, follower has nothing).
     */
    completeBtnSpacer: { width: 28, height: 28 },

    // ── Bottom 4-button sticky action bar ───────────────────────────────
    actionBar: {
      flexDirection: 'row',
      paddingHorizontal: 8,
      paddingVertical: 10,
      gap: 6,
      backgroundColor: tokens.bg.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: tokens.border.default,
    },
    actionBtn: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 8,
      backgroundColor: tokens.bg.elevated,
      alignItems: 'center',
    },
    actionBtnDisabled: { opacity: 0.4 },
    actionBtnPrimary: { backgroundColor: tokens.action.primary },
    actionBtnText: {
      fontSize: 13,
      fontWeight: '600',
      color: tokens.action.primary,
    },
    actionBtnTextPrimary: { color: tokens.action.onPrimary, fontWeight: '700' },
    actionBtnTextDestructive: { color: tokens.action.destructive },

    btnPressed: { opacity: 0.85 },
    btnDisabled: { opacity: 0.45 },

    muted: { fontSize: 14, color: tokens.text.secondary },
    error: { fontSize: 14, color: tokens.action.destructive },
  });
}
