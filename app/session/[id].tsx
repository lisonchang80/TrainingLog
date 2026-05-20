import { randomUUID } from 'expo-crypto';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { TemplateMetaSheet } from '@/components/session/template-meta-sheet';
import { SessionStatsPanel } from '@/components/session/session-stats-panel';
import { SessionTimeEditorSheet } from '@/components/session/session-time-editor-sheet';
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

/**
 * Session detail page — ADR-0019 Q10 final layout (slice 10c session detail).
 *
 * Mirrors the Template editor's chrome pattern (header + scroll body +
 * sticky bottom action bar). Reached from:
 *   - Today screen on End Session (router.push immediately after closing)
 *   - History tab on row tap (already-ended sessions, identical view)
 *
 * Layout (ADR-0019 Q10):
 *   - Header: title (session name or date fallback) + back button
 *   - 3-tile SessionStatsPanel (frozen mode — ended_at - started_at + tap to edit)
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
 * Note: the detail page intentionally DROPS the 大卡 tile that the prior
 * 4-tile implementation rendered. SessionStatsPanel is 3-tile, and kcal
 * is HealthKit-only data (deferred to slice 13). If the user complains
 * later, easy to add a 4th tile prop to SessionStatsPanel.
 */
export default function SessionDetailScreen() {
  // 2026-05-20 overnight #58 — ADR-0015 § Tap 日格行為: history calendar tap
  // emits ?sameDayIds=<csv> so the detail page can show ← N/M → switcher
  // between sessions sharing the same date. Absent param (e.g. opened from
  // Today end-session flow) → buildSameDayNavState degrades to single view.
  const { id, sameDayIds } = useLocalSearchParams<{
    id: string;
    sameDayIds?: string;
  }>();
  const db = useDatabase();
  const router = useRouter();

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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [db, id]);

  useEffect(() => {
    load();
  }, [load]);

  // ── Edit mode 進入 / 提交 / 捨棄 三條 path（2026-05-20 night transactional fix）──
  // 用戶反映「修改後按返回未按完成編輯仍然被記錄」。Snapshot/restore approach:
  // 進入 edit mode 時 snapshot session 全狀態、所有 edit op 仍直寫 DB、退出時
  // 用「完成」commit (drop snapshot) 或「返回」discard (restore snapshot)。
  const enterEditMode = useCallback(async () => {
    if (!id) return;
    try {
      const snap = await captureSessionSnapshot(db, id);
      if (!snap) {
        Alert.alert('編輯失敗', 'Session not found.');
        return;
      }
      setEditSnapshot(snap);
      setEditMode(true);
    } catch (e) {
      Alert.alert('編輯失敗', e instanceof Error ? e.message : String(e));
    }
  }, [db, id]);

  const commitEditMode = useCallback(() => {
    // Edit ops 已陸續直寫 DB；commit 等同清掉 snapshot 即可。
    setEditSnapshot(null);
    setEditMode(false);
  }, []);

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
        onExited();
        return;
      }
      Alert.alert(
        '捨棄修改？',
        '離開將還原為進入編輯前的狀態，所有變更會消失。',
        [
          { text: '繼續編輯', style: 'cancel' },
          {
            text: '捨棄修改',
            style: 'destructive',
            onPress: async () => {
              try {
                await restoreSessionFromSnapshot(db, editSnapshot);
                await load();
              } catch (e) {
                Alert.alert(
                  '還原失敗',
                  e instanceof Error ? e.message : String(e),
                );
                return;
              }
              setEditSnapshot(null);
              setEditMode(false);
              onExited();
            },
          },
        ],
      );
    },
    [editSnapshot, session, sessionExercises, sets, db, load],
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
          }
          await load();
        } catch (e) {
          Alert.alert(
            '加入動作失敗',
            e instanceof Error ? e.message : String(e),
          );
        }
      })();
    }, [db, id, load]),
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
          Alert.alert('Save failed', e instanceof Error ? e.message : String(e));
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
        Alert.alert('Invalid input', err);
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
        Alert.alert('Save failed', e instanceof Error ? e.message : String(e));
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
        Alert.alert('Save failed', e instanceof Error ? e.message : String(e));
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
        Alert.alert('Save failed', e instanceof Error ? e.message : String(e));
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
        Alert.alert('Delete failed', e instanceof Error ? e.message : String(e));
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
        Alert.alert('Save failed', e instanceof Error ? e.message : String(e));
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
          '新增 dropset 失敗',
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
            '無法刪除',
            'Dropset 至少需要 2 組（head + 1 follower）。如要整組刪除，請左滑 head 那一列。',
          );
        } else {
          Alert.alert('刪除失敗', msg);
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
        Alert.alert('Delete failed', e instanceof Error ? e.message : String(e));
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
        Alert.alert('Clone failed', e instanceof Error ? e.message : String(e));
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
        Alert.alert('Add cycle failed', e instanceof Error ? e.message : String(e));
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
        Alert.alert('Save failed', e instanceof Error ? e.message : String(e));
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
      const menuOptions: string[] = isCluster
        ? [
            '取消',
            '📝 編輯備註',
            '⏱️ 休息秒數',
            '📖 動作歷史 (A)',
            '📖 動作歷史 (B)',
            '🗑️ 刪除動作',
            '🔃 排序動作',
          ]
        : [
            '取消',
            '📝 編輯備註',
            '⏱️ 休息秒數',
            '🗑️ 刪除動作',
            '🔃 排序動作',
          ];
      const destructiveButtonIndex = isCluster ? 5 : 3;
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: planRow.exercise_name,
          options: menuOptions,
          cancelButtonIndex: 0,
          destructiveButtonIndex,
        },
        (idx) => {
          if (idx === 0) return;
          const label = menuOptions[idx];
          if (label === '📝 編輯備註') {
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
                  '讀取失敗',
                  e instanceof Error ? e.message : String(e),
                );
              }
            })();
          } else if (label === '⏱️ 休息秒數') {
            setRestSecTarget({
              session_exercise_id: planRow.id,
              current: planRow.rest_sec ?? 60,
              exercise_name: planRow.exercise_name,
            });
          } else if (label === '📖 動作歷史 (A)') {
            router.push(
              `/exercise-history/${planRow.exercise_id}?clusterMode=cluster_only&partner=${partnerExerciseId}&side=A&currentSeIdA=${planRow.id}&currentSeIdB=${partnerSessionExerciseId}`,
            );
          } else if (label === '📖 動作歷史 (B)') {
            router.push(
              `/exercise-history/${partnerExerciseId}?clusterMode=cluster_only&partner=${planRow.exercise_id}&side=B&currentSeIdA=${partnerSessionExerciseId}&currentSeIdB=${planRow.id}`,
            );
          } else if (label === '🔃 排序動作') {
            setReorderSheetOpen(true);
          } else if (label === '🗑️ 刪除動作') {
            if (isCluster && partnerSessionExerciseId) {
              const partnerPlan = sessionExercises.find(
                (p) => p.id === partnerSessionExerciseId,
              );
              const partnerName = partnerPlan?.exercise_name ?? '(未知動作)';
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
                  ? `\n\n將連同 ${totalSets} 組記錄一起刪除（其中 ${loggedCount} 組已標完成）。`
                  : totalSets > 0
                    ? `\n\n將連同 ${totalSets} 組未完成記錄一起刪除。`
                    : '';
              Alert.alert(
                '刪除超級組？',
                `要從這次訓練中移除整個超級組「${planRow.exercise_name} + ${partnerName}」？${warningSuffix}`,
                [
                  { text: '取消', style: 'cancel' },
                  {
                    text: '刪除',
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
                          '刪除失敗',
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
                ? `\n\n⚠️ 將連同此動作的 ${setsForExercise.length} 組記錄一起刪除（其中 ${loggedCount} 組已標完成）。`
                : setsForExercise.length > 0
                  ? `\n\n將連同此動作的 ${setsForExercise.length} 組未完成記錄一起刪除。`
                  : '';
            Alert.alert(
              '刪除動作？',
              `要從這次訓練中移除「${planRow.exercise_name}」？${warningSuffix}`,
              [
                { text: '取消', style: 'cancel' },
                {
                  text: '刪除',
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
                        'Delete failed',
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

  const handleSaveTemplate = useCallback(
    async (mode: 'update' | 'create') => {
      if (!session) return;
      const dateLabel = formatDateLabel(session.started_at);
      const defaultName = `Session ${dateLabel}`;

      if (mode === 'create') {
        try {
          const [progs, linked] = await Promise.all([
            listPrograms(db),
            getSessionLinkedTemplateTriple(db, id!),
          ]);
          setPrograms(progs);
          setTemplateMetaPrefill(
            linked
              ? {
                  name: linked.template_name,
                  program_id: linked.program_id,
                  sub_tag: linked.sub_tag,
                }
              : null,
          );
        } catch (e) {
          Alert.alert('載入失敗', e instanceof Error ? e.message : String(e));
          return;
        }
        setTemplateMetaSheetOpen(true);
        return;
      }

      if (typeof Alert.prompt === 'function') {
        Alert.prompt(
          '儲存模板',
          '將本場訓練結構覆寫到連結的模板（無連結則新建並綁定）',
          [
            { text: '取消', style: 'cancel' },
            {
              text: '儲存',
              onPress: async (name?: string) => {
                const trimmed = (name ?? '').trim() || defaultName;
                try {
                  await convertSessionToTemplate(db, {
                    session_id: id!,
                    template_name: trimmed,
                    mode,
                    uuid: randomUUID,
                  });
                  Alert.alert('已儲存', `模板「${trimmed}」已更新。`);
                } catch (e) {
                  Alert.alert(
                    '失敗',
                    e instanceof Error ? e.message : String(e)
                  );
                }
              },
            },
          ],
          'plain-text',
          defaultName
        );
      } else {
        Alert.alert(
          '儲存模板',
          `將以預設名稱「${defaultName}」儲存？`,
          [
            { text: '取消', style: 'cancel' },
            {
              text: '確定',
              onPress: async () => {
                try {
                  await convertSessionToTemplate(db, {
                    session_id: id!,
                    template_name: defaultName,
                    mode,
                    uuid: randomUUID,
                  });
                  Alert.alert('已儲存', `模板「${defaultName}」已更新。`);
                } catch (e) {
                  Alert.alert(
                    '失敗',
                    e instanceof Error ? e.message : String(e)
                  );
                }
              },
            },
          ]
        );
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
      const dateLabel = formatDateLabel(session.started_at);
      const defaultName = `Session ${dateLabel}`;
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
        Alert.alert('已另存', `模板「${finalName}」已建立。`);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (message === 'DUPLICATE_TEMPLATE_TRIPLE') {
          Alert.alert(
            '變體已存在',
            `「${finalName}」+ 該計畫 + 該強度的組合已存在。請改名或選不同變體。`,
          );
        } else {
          Alert.alert('失敗', message);
        }
      } finally {
        setTemplateMetaBusy(false);
      }
    },
    [db, id, session]
  );

  const handleDelete = useCallback(() => {
    Alert.alert(
      '刪除本訓練',
      '已記錄的 set 將全部刪除，無法復原。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '刪除',
          style: 'destructive',
          onPress: async () => {
            try {
              await discardSession(db, id!);
              router.back();
            } catch (e) {
              Alert.alert('刪除失敗', e instanceof Error ? e.message : String(e));
            }
          },
        },
      ]
    );
  }, [db, id, router]);

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
        Alert.alert('儲存失敗', e instanceof Error ? e.message : String(e));
      }
    },
    [db, id, load],
  );

  const titleText = useMemo(() => {
    if (!session) return 'Session';
    return formatDateLabel(session.started_at);
  }, [session]);

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
            colorHex={p.reusable_superset_color_hex}
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
                  '排序失敗',
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
                '排序失敗',
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
      <Stack.Screen options={{ headerShown: false }} />

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
          <Text style={styles.headerBackText}>‹ 返回</Text>
        </Pressable>
        <Text style={styles.headerTitle}>{titleText}</Text>
        {editMode ? (
          <Pressable
            onPress={commitEditMode}
            style={styles.headerDoneBtn}
            accessibilityRole="button">
            <Text style={styles.headerDoneText}>完成</Text>
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

                <View style={styles.sectionRow}>
                  <Text style={styles.section}>動作清單</Text>
                  <View style={styles.hideUncheckedToggle}>
                    <Text style={styles.hideUncheckedLabel}>隱藏未打勾</Text>
                    <Switch
                      value={hideUnchecked}
                      onValueChange={setHideUnchecked}
                    />
                  </View>
                </View>
                {sessionExercises.length === 0 ? (
                  <View style={styles.emptyPlanBlock}>
                    <Text style={styles.emptyPlanTitle}>尚未加入動作</Text>
                    <Text style={styles.emptyPlanBody}>
                      點下方「+ 動作」開始記錄這次訓練。
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

                <View style={styles.sectionRow}>
                  <Text style={styles.section}>動作清單</Text>
                  <View style={styles.hideUncheckedToggle}>
                    <Text style={styles.hideUncheckedLabel}>隱藏未打勾</Text>
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
              + 動作
            </Text>
          </Pressable>
        ) : (
          <Pressable
            style={styles.actionBtn}
            onPress={enterEditMode}>
            <Text style={styles.actionBtnText}>編輯訓練</Text>
          </Pressable>
        )}
        <Pressable
          style={[styles.actionBtn, isFreestyle && styles.actionBtnDisabled]}
          disabled={isFreestyle}
          onPress={() => handleSaveTemplate('update')}>
          <Text style={styles.actionBtnText}>儲存模板</Text>
        </Pressable>
        <Pressable
          style={styles.actionBtn}
          onPress={() => handleSaveTemplate('create')}>
          <Text style={styles.actionBtnText}>另存模板</Text>
        </Pressable>
        <Pressable
          style={styles.actionBtn}
          onPress={handleDelete}>
          <Text style={[styles.actionBtnText, styles.actionBtnTextDestructive]}>
            刪除
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
        label={keypadTarget?.field === 'weight' ? '重量 (kg)' : '次數'}
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
                  '排序失敗',
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
        title={`📝 ${exerciseNoteTarget?.exercise_name ?? ''} 備註`}
        placeholder="例：握距、發力重點、易犯錯誤..."
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
                'Save failed',
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
        label={`⏱️ 休息秒數 · ${restSecTarget?.exercise_name ?? ''}`}
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
                'Save failed',
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
        <Text style={styles.exName}>{exercise.exercise_name}</Text>
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
  const color = rs?.superset.color_hex ?? '#9aa0a6';
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
          <Text style={styles.supersetTag}>超</Text>
        </View>
        <Text style={styles.clusterLabel}>
          {cluster.parent.exercise_name}
          <Text style={styles.clusterPlus}> + </Text>
          {cluster.child.exercise_name}
        </Text>
        {/* Column-aligned exercise name sub-headers: cycle slot + A column +
            B column + check slot (mirrors the data row structure so names
            sit directly above their values). */}
        <View style={styles.clusterPairRow}>
          <View style={styles.clusterCycle} />
          <View style={styles.clusterCell}>
            <Text style={styles.clusterColumnHeader} numberOfLines={1}>
              {cluster.parent.exercise_name}
            </Text>
          </View>
          <View style={styles.clusterCell}>
            <Text style={styles.clusterColumnHeader} numberOfLines={1}>
              {cluster.child.exercise_name}
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
            <View style={styles.exerciseCardTitleRow}>
              <Text style={styles.planName} numberOfLines={1}>
                {planRow.exercise_name}
              </Text>
            </View>
            {progress.setsTotal > 0 ? (
              <View style={styles.exerciseCardProgressRow}>
                <View style={styles.exerciseCardProgressBarFill}>
                  <SegmentedProgressBar
                    done={progress.setsDone}
                    total={progress.setsTotal}
                  />
                </View>
                {progress.volumeTotal > 0 ? (
                  <Text style={styles.exerciseCardVolumeChip}>
                    {Math.round(progress.volumeDone)}/
                    {Math.round(progress.volumeTotal)}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
          <Text style={styles.exerciseCardChevron}>
            {isExpanded ? '▼' : '▶'}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="動作設定"
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
          {sets.length === 0 ? (
            <Text style={styles.exerciseCardEmpty}>
              還沒有 set — 按下方「+ 新增 1 組」開始記錄
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
                        label: '刪除',
                        color: '#dc3545',
                        onPress: () => onDeleteSet(head.id),
                      },
                    ]}
                    swipeRightActions={[
                      {
                        key: 'add',
                        label: '+1',
                        color: '#28a745',
                        onPress: () => onAddSetAfter(head.id),
                      },
                      {
                        key: 'note',
                        label: '備註',
                        color: '#007AFF',
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
                            headLogged ? '取消完成' : '標為完成'
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
                新增 1 組
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
                動作歷史
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

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(127,127,127,0.2)',
    gap: 8,
  },
  headerBackBtn: { paddingHorizontal: 8, paddingVertical: 6 },
  headerBackText: { fontSize: 15, color: '#007AFF' },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  headerSpacer: { width: 60 },
  headerDoneBtn: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    minWidth: 60,
    alignItems: 'flex-end',
  },
  headerDoneText: { fontSize: 15, color: '#007AFF', fontWeight: '700' },

  // Same-day switcher sub-row.
  sameDayBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    gap: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(127,127,127,0.15)',
    backgroundColor: 'rgba(0,122,255,0.04)',
  },
  sameDayBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,122,255,0.12)',
  },
  sameDayBtnDisabled: { backgroundColor: 'rgba(127,127,127,0.08)' },
  sameDayBtnText: { fontSize: 17, color: '#007AFF', fontWeight: '600' },
  sameDayBtnTextDisabled: { color: 'rgba(127,127,127,0.4)' },
  sameDayIndicator: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1F2937',
    minWidth: 36,
    textAlign: 'center',
  },
  body: { padding: 16, gap: 12, paddingBottom: 100 },
  timestamp: { fontSize: 13, opacity: 0.65 },
  section: { fontSize: 14, fontWeight: '600', color: '#6B7280' },
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
  hideUncheckedLabel: { fontSize: 13, color: '#6B7280' },

  // Empty-state placeholder (mirror Today's emptyPlanBlock).
  emptyPlanBlock: {
    padding: 24,
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(127,127,127,0.06)',
    borderRadius: 12,
    marginTop: 8,
  },
  emptyPlanTitle: { fontSize: 16, fontWeight: '700', color: '#1F2937' },
  emptyPlanBody: { fontSize: 13, color: '#6B7280', textAlign: 'center' },
  planList: { gap: 8, marginTop: 8 },

  // ── Read-mode solo card ──────────────────────────────────────────────
  exCard: {
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(127,127,127,0.3)',
    overflow: 'hidden',
    marginTop: 8,
  },
  exHeader: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  exName: { fontSize: 15, fontWeight: '600' },
  setsBox: {
    paddingHorizontal: 12,
    paddingBottom: 10,
    gap: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(127,127,127,0.15)',
    paddingTop: 8,
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  setOrdering: { fontSize: 13, opacity: 0.6, width: 28 },
  setText: { flex: 1, fontSize: 14 },
  setCheck: { fontSize: 16, color: '#34C759', fontWeight: '600' },

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
  clusterLabel: { fontSize: 15, fontWeight: '600' },
  clusterPlus: { fontSize: 15, opacity: 0.5 },
  clusterPairRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  clusterCycle: { fontSize: 12, opacity: 0.6, width: 24 },
  clusterCell: { flex: 1 },
  clusterCellText: { fontSize: 13 },
  clusterCellEmpty: { fontSize: 13, opacity: 0.3 },
  // Fixed-width slot keeps A/B columns aligned regardless of whether the
  // ✓ checkmark is shown (else flex:1 cells absorb the extra width and
  // B drifts right when no logged set in that cycle).
  clusterCheckSlot: { width: 16, alignItems: 'center' },
  // Column sub-header — smaller than main title, sits tight above the rows.
  clusterColumnHeader: { fontSize: 12, fontWeight: '600', opacity: 0.7 },
  clusterDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(0,0,0,0.18)',
    marginTop: 2,
    marginBottom: 4,
  },

  // ── Edit-mode solo card (mirrors Today's exerciseCard styles) ────────
  exerciseCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(127,127,127,0.3)',
    overflow: 'hidden',
  },
  exerciseCardExpanded: {
    borderColor: 'rgba(0,122,255,0.45)',
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
  },
  planName: { fontSize: 15, fontWeight: '600' },
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
    opacity: 0.7,
    minWidth: 76,
    textAlign: 'right',
  },
  exerciseCardChevron: {
    fontSize: 14,
    opacity: 0.5,
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
  exerciseCardBody: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    gap: 6,
  },
  exerciseCardEmpty: {
    fontSize: 13,
    opacity: 0.55,
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
    backgroundColor: '#f3f4f6',
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
    backgroundColor: '#0a7ea4',
  },
  exerciseCardFooterBtnSecondary: {
    backgroundColor: 'rgba(127,127,127,0.18)',
  },
  exerciseCardFooterBtnTextPrimary: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  exerciseCardFooterBtnTextSecondary: {
    color: '#0a7ea4',
    fontSize: 14,
    fontWeight: '600',
  },
  completeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(127,127,127,0.18)',
  },
  completeBtnDone: { backgroundColor: '#28a745' },
  completeBtnText: { fontSize: 14, fontWeight: '700', color: '#6b7280' },
  completeBtnTextDone: { color: 'white' },
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
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(127,127,127,0.2)',
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(0,122,255,0.10)',
    alignItems: 'center',
  },
  actionBtnActive: { backgroundColor: 'rgba(0,122,255,0.25)' },
  actionBtnDisabled: { opacity: 0.4 },
  actionBtnPrimary: { backgroundColor: '#0a7ea4' },
  actionBtnText: { fontSize: 13, fontWeight: '600', color: '#007AFF' },
  actionBtnTextActive: { color: '#0050B3' },
  actionBtnTextPrimary: { color: 'white', fontWeight: '700' },
  actionBtnTextDestructive: { color: '#FF3B30' },

  btnPressed: { opacity: 0.85 },
  btnDisabled: { opacity: 0.45 },

  muted: { fontSize: 14, opacity: 0.6 },
  error: { fontSize: 14, color: '#dc3545' },
});
