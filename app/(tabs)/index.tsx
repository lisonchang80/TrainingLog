import { randomUUID } from 'expo-crypto';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActionSheetIOS,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackupFailureBanner } from '@/components/backup-failure-banner';
import { useDatabase } from '@/components/database-provider';
import { useAchievementsEnabled } from '@/src/achievements-enabled';
import { insertBodyMetric } from '@/src/adapters/sqlite/bodyMetricRepository';
import {
  getExerciseNotes,
  updateExerciseNotes,
} from '@/src/adapters/sqlite/exerciseLibraryRepository';
import { consumePick } from '@/src/domain/exercise/pickerBridge';
import { listPrograms } from '@/src/adapters/sqlite/programRepository';
import {
  appendSessionExercise,
  countSessionExercises,
  createSession,
  deleteSessionExerciseAndSets,
  discardSession,
  endSession,
  getActiveSession,
  getSession,
  appendReusableSupersetToSession,
  reorderSessionExercises,
  updateSessionExerciseRestSec,
  type SessionExerciseRowWithName,
} from '@/src/adapters/sqlite/sessionRepository';
import { runBackup } from '@/src/services/backupService';
import { loadTrainingTabState } from '@/src/services/loadTrainingTabState';
import { syncSessionWithHealthKit } from '@/src/services/healthkitSessionSync';
import { pushEndToWatch } from '@/src/services/watchSessionEnd';
import { reconcileEndSnapshot } from '@/src/services/endSnapshotReconcile';
import { onStartResolve } from '@/src/services/watchSessionResolve';
import { onDiscardSession } from '@/src/services/watchSessionDiscard';
import {
  addAppContextListener,
  addMessageListener,
  addUserInfoListener,
  makeEnvelope,
  onHandshakeRequest,
  onHistoryRequest,
  onNotesRequest,
  onStartFromWatch,
  sendUserInfo,
  type WCMessage,
} from '@/src/adapters/watch';
import { onLiveMirror } from '@/src/services/watchLiveMirrorReceiver';
import {
  scheduleLiveMirrorPush,
  runWhileApplyingRemoteSnapshot,
} from '@/src/services/iphoneLiveMirrorProducer';
import {
  applyHrTick,
  applyKcalTick,
  liveTicksForSession,
  type WatchLiveTicks,
} from '@/src/services/watchLiveTicksReceiver';
import {
  deleteSetting,
  getSetting,
  setSetting,
} from '@/src/adapters/sqlite/settingsRepository';
import { setGlobalLastUsed } from '@/src/adapters/sqlite/startStickyRepository';
import {
  addSessionDropsetCluster,
  addSessionDropsetRow,
  deleteSet,
  insertDropsetFollower,
  listSetsBySession,
  addClusterCycleAtEnd,
  deleteClusterCycle,
  insertSessionSetAfter,
  markClusterCycleLogged,
  markClusterCycleUnlogged,
  prefillReusableSupersetFromLastSession,
  prefillSessionExerciseFromLastSession,
  recordSetInSession,
  removeSessionDropsetRow,
  reorderSessionSetsForExercise,
  updateSetFields,
  type SessionSetWithExercise,
} from '@/src/adapters/sqlite/setRepository';
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
import {
  NestableScrollContainer,
  NestableDraggableFlatList,
  type RenderItemParams,
} from 'react-native-draggable-flatlist';
import { NumericKeypad } from '@/components/shared/numeric-keypad';
import { SegmentedProgressBar } from '@/components/shared/segmented-progress-bar';
import { computeExerciseProgress } from '@/src/domain/session/exerciseProgress';
import { countPerformedExercises } from '@/src/domain/session/countPerformedExercises';
import { computeDeleteWarningSuffix } from '@/src/domain/session/deleteWarningSuffix';
import { SessionStatsPanel } from '@/components/session/session-stats-panel';
import { BodyDataSheet } from '@/components/session/body-data-sheet';
import { RestTimerModal } from '@/components/session/rest-timer-modal';
import { ClusterCard } from '@/components/session/cluster-card';
import { groupClusterSides } from '@/src/domain/session/clusterCard';
import type { PRSnapshot } from '@/src/domain/pr/prQuery';
import { computeSessionSetLayout } from '@/src/domain/set/sessionSetLayout';
import { cycleSessionSetKindClusterAware } from '@/src/domain/set/cycleSessionSetKind';
import {
  findTemplateByTriple,
  getSessionLinkedTemplateTriple,
  type TemplateSummary,
} from '@/src/adapters/sqlite/templateRepository';
import { ensureTemplateVariantReady } from '@/src/services/ensureTemplateVariant';
import { useAppMode } from '@/src/app-mode';
import { RESERVED_NONE_PROGRAM_ID } from '@/src/db/seed/v017ProgramNone';
import { planResolveTarget } from '@/src/domain/template/resolveTargetTemplate';
import type { ProgramOption } from '@/src/domain/program/resolveProgramDefaults';
import { StartTemplateSheet } from '@/components/templates/start-template-sheet';
import { formatSessionSubtitle } from '@/src/domain/template/templateManager';
import { validateBodyMetric } from '@/src/domain/body/bodyMetricManager';
import type { UnitPreference } from '@/src/domain/body/types';
import {
  displayToKg,
  displayWeight,
  formatWeight,
  kgToDisplay,
  parseWeightInput,
} from '@/src/domain/body/unitConversion';
import type { Exercise } from '@/src/domain/exercise/types';
import {
  resolveProgramLabel,
  localMsToIsoDate,
} from '@/src/domain/program/programManager';
import type { ProgramCell, ProgramWithCells } from '@/src/domain/program/types';
import { resolveTodayPlan, type TodayPlan } from '@/src/domain/training/todayPlan';
import {
  STICKY_KEY_LAST_PROGRAM_ID as LAST_PROGRAM_KEY,
  STICKY_KEY_LAST_SUB_TAG as LAST_SUB_TAG_KEY,
} from '@/src/domain/training/templateListGroups';
import { TemplateListSection } from '@/components/training/template-list-section';
import {
  SessionTitleEditor,
  type SessionTitleEditorHandle,
} from '@/components/session/session-title-editor';
import { startSessionFromTemplate } from '@/src/adapters/sqlite/sessionFromTemplate';
import { pushStartToWatch } from '@/src/services/watchSessionStart';
import { pushCastToWatch } from '@/src/services/watchSessionCast';
import { useCastEditLock } from '@/app/hooks/useCastEditLock';
import { CastLockOverlay } from '@/components/session/cast-lock-overlay';
import {
  CoachMarkProvider,
  HelpButton,
  PageHelpHost,
  useCoachMarkTarget,
  usePageHelp,
} from '@/components/help';
import { todayMinimalHelp } from '@/components/help/content/today-minimal';
import { todayPlanHelp } from '@/components/help/content/today-plan';
import { TemplateMetaSheet } from '@/components/session/template-meta-sheet';
import { ToastController, ToastHost } from '@/components/ui/Toast';
import { useSessionTemplateSave } from '@/hooks/useSessionTemplateSave';
import { formatLocalYmdFromMs } from '@/src/domain/date/localYmd';
import { shouldFireFirstAddPush } from '@/src/services/freestyleFirstAddPush';
import {
  IDLE,
  canRecordSet,
  end as endState,
  fromRow,
  getSessionId,
  start as startState,
  type SessionState,
} from '@/src/domain/session/sessionManager';
import { validateRecordSet } from '@/src/domain/set/validateRecordSet';
import { listPriorSetsForExercise } from '@/src/adapters/sqlite/exerciseHistoryRepository';
import { resolveSetDefaults } from '@/src/domain/set/resolveSetDefaults';
import { evaluateAndPersistAchievements } from '@/src/adapters/sqlite/achievementRepository';
import { detectPRBreaks } from '@/src/domain/pr/prEngine';
import { sortBreaksForDisplay, bucketLabel } from '@/src/domain/pr/buckets';
import type { BucketKey, PRDelta } from '@/src/domain/pr/types';
import {
  t,
  tA11yStartPlanned,
  tExercise,
  tExerciseCount,
  tExerciseNoteHeader,
  tPrDeltaLine,
  tRemoveExerciseFromSessionPrompt,
  tRemoveSupersetFromSessionPrompt,
  tRestSecondsHeader,
  tWarningPerExerciseSetsUnfinished,
  tWarningPerExerciseSetsWithLogged,
  tWarningTotalSetsUnfinished,
  tWarningTotalSetsWithLogged,
  useLocale,
} from '@/src/i18n';
import {
  useTheme,
  type ThemeTokens,
  dragActiveRowStyle,
  interactiveCardBg,
  swipeActionColors,
} from '@/src/theme';

/**
 * Today tab — proper Session lifecycle (slice 2).
 *
 *   idle ──Start──▶ in_progress ──End──▶ ended → push to detail screen → idle
 *
 * The DB is source of truth: on focus we re-query the active session and
 * recompute SessionState via `sessionManager.fromRow`. UI only ever holds
 * derived state — no risk of drifting from persisted reality.
 */
function TodayScreen() {
  // `'use no memo'` + `useLocale()`: opt this screen out of React Compiler
  // memoization and subscribe to language changes so its many INLINE `t()` /
  // `tExercise()` calls re-evaluate fresh on a `setLocale()`. Tab screens stay
  // mounted, so without this subscription the boot-language strings stick (the
  // root `<Stack key={locale}>` in app/_layout.tsx does NOT remount mounted
  // expo-router screens). The memoized leaf `ExerciseCard` needs its OWN
  // subscription on top of this. Cf. project_traininglog_react_compiler_i18n_gotcha.
  'use no memo';
  useLocale();
  const db = useDatabase();
  const router = useRouter();
  // Slice 17 / ADR-0009 amendment — UI-only gate. PR banner (and other
  // achievement surfaces) hide when the user turns the system OFF; background
  // evaluation/persistence keeps running regardless.
  const { enabled: achievementsEnabled } = useAchievementsEnabled();
  // ADR-0025 — all colors flow from useTheme().tokens via makeStyles below.
  const { tokens } = useTheme();
  // ADR-0026 — 極簡模式：整個「計劃 (program)」概念在 UI 消失。reactive，
  // 切換即時 re-render。gate 首頁三塊計劃面 + 開始模板直接帶 (null,null) 解析。
  const { isMinimal } = useAppMode();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
  // Page help overlay (pilot — page-help-overlay skill). Coach-only 引導遮罩
  // (no text-only modal). 計劃 vs 極簡 are two separate content files so the tour
  // explains only the current mode — minimal mode drops the 計劃訓練 step. Each
  // mode owns its own `help_seen:` flag (auto-shows once per mode). The coach
  // targets tag the idle 三區; in-session gestures are a deferred follow-up.
  // CoachMarkProvider wraps this screen via the default export below.
  const help = usePageHelp(
    isMinimal ? 'today-minimal' : 'today-plan',
    isMinimal ? todayMinimalHelp : todayPlanHelp,
    { autoShowOnce: true },
  );
  const planTarget = useCoachMarkTarget('today.planPanel');
  const templateTarget = useCoachMarkTarget('today.templateList');
  const blankTarget = useCoachMarkTarget('today.blankStart');
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [sessionState, setSessionState] = useState<SessionState>(IDLE);
  const [setsInSession, setSetsInSession] = useState<SessionSetWithExercise[]>([]);
  const [plan, setPlan] = useState<SessionExerciseRowWithName[]>([]);
  /**
   * ADR-0019 Q3 動作卡互動模型 — only-one-expanded state. NULL = all cards
   * collapsed (default per a-1). Setting to a plan row id expands that card
   * and implicitly collapses any other (c-2 single-expansion). Tapping the
   * already-expanded card's header toggles back to NULL (b-1 collapse on
   * second tap). State is in-memory only — re-opening session resets all
   * cards to collapsed (per ADR-0019 Q3 § 副作用拍板「狀態持久化」).
   */
  const [expandedExerciseId, setExpandedExerciseId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeProgram, setActiveProgram] = useState<ProgramWithCells | null>(null);
  const [templatesById, setTemplatesById] = useState<Record<string, TemplateSummary>>({});
  const [programCellToday, setProgramCellToday] = useState<ProgramCell | null>(null);
  const [unit, setUnit] = useState<UnitPreference>('kg');
  const [bwSnapshotKg, setBwSnapshotKg] = useState<number | null>(null);
  /**
   * Card 11 / ADR-0014 — session.title for the in-session header tap-to-edit
   * editor. Sourced from `active.title` on refresh; updates land via
   * `SessionTitleEditor`'s onUpdated callback so we don't re-query the DB
   * just to reflect the user's own keystroke.
   */
  const [sessionTitle, setSessionTitle] = useState<string>('');
  /**
   * Bug F4 (2026-05-25) — ref to the in-session SessionTitleEditor so the
   * ⋯ menu trigger can call `blur()` BEFORE opening the ActionSheet. This
   * fires the editor's commit-on-blur so any pending edit is persisted to
   * the DB before focus is stolen by the secondary surface. The editor
   * exposes a `SessionTitleEditorHandle` via `forwardRef` (see
   * `components/session/session-title-editor.tsx`).
   */
  const editorRef = useRef<SessionTitleEditorHandle>(null);
  // Body data editor sheet (slice 10c overnight #4 第 3 點) — replaces the
  // previous inline panel. Opened from header ⋯ menu「Body data」.
  const [bodySheetVisible, setBodySheetVisible] = useState(false);
  const [inlineBwInput, setInlineBwInput] = useState('');
  const [inlinePbfInput, setInlinePbfInput] = useState('');
  const [inlineSmmInput, setInlineSmmInput] = useState('');
  // 儲存模板 / 另存模板 from the in-session ⋯ menu (2026-06-27), applied to the
  // IN-PROGRESS session (lets the user snapshot a template mid-workout without
  // finishing). The detail page (app/session/[id].tsx) has its own entry point
  // (post-finish); the 2026-05-18 single-entry decision is intentionally relaxed
  // to dual-entry per user request. Both entries share useSessionTemplateSave —
  // here we seed the default name from the live header title.
  const toastRef = useRef<ToastController | null>(null);
  if (toastRef.current == null) {
    toastRef.current = new ToastController();
  }
  const {
    programs,
    templateMetaSheetOpen,
    templateMetaPrefill,
    templateMetaBusy,
    handleSaveTemplate,
    handleTemplateMetaConfirm,
    closeSheet: closeTemplateMetaSheet,
  } = useSessionTemplateSave({
    db,
    getSessionId: () =>
      sessionState.status === 'in_progress' ? sessionState.id : null,
    getStartedAt: () =>
      sessionState.status === 'in_progress' ? sessionState.started_at : null,
    getSessionTitle: () =>
      sessionState.status === 'in_progress' ? sessionTitle.trim() || null : null,
    toast: toastRef,
  });
  const [lastPRDelta, setLastPRDelta] = useState<PRDelta | null>(null);
  const [lastPRExerciseName, setLastPRExerciseName] = useState<string>('');
  /** Per-set notes editor sheet — `null` means closed. */
  const [noteSheetTarget, setNoteSheetTarget] =
    useState<{ set_id: string; initial: string | null } | null>(null);
  /** Numeric keypad modal — `null` means closed (ADR-0019 Q6). */
  const [keypadTarget, setKeypadTarget] = useState<{
    set_id: string;
    field: 'reps' | 'weight';
    current: number;
  } | null>(null);
  /** Rest-sec keypad target — reuses NumericKeypad with a different field. */
  const [restSecTarget, setRestSecTarget] = useState<{
    session_exercise_id: string;
    current: number;
    exercise_name: string;
  } | null>(null);
  /**
   * Exercise-level notes sheet target (📝 menu path). Reuses SetNoteSheet
   * with a custom title; the Exercise.notes column is global (per-Exercise,
   * not per-Session) per ADR-0017.
   */
  const [exerciseNoteTarget, setExerciseNoteTarget] = useState<{
    exercise_id: string;
    exercise_name: string;
    initial: string | null;
  } | null>(null);
  /** 🔃 reorder-exercises modal open flag. */
  const [reorderSheetOpen, setReorderSheetOpen] = useState(false);
  /**
   * Per-exercise all-time PR snapshot (ADR-0019 Q5). Keyed by exercise_id;
   * computed once on refresh from listExercisePRSetRows (cross-session).
   * Stays static during the session — newly recorded PRs surface via the
   * existing PR banner (lastPRDelta), this map is the "已知 PR" baseline.
   */
  const [prSnapshotById, setPrSnapshotById] = useState<
    Record<string, PRSnapshot>
  >({});
  /**
   * Rest timer (ADR-0019 Q2 R1 v1). `autoPopup` mirrors the
   * `auto_popup_rest_timer` app setting (default ON via v016 seed).
   * `restTimerTrigger` is bumped each tap-✓ to flag the modal it
   * should restart with fresh rest_sec; `restTimerTarget` carries the
   * rest_sec + exercise name to render in the modal.
   */
  const [autoPopupTimer, setAutoPopupTimer] = useState<boolean>(true);
  const [restTimerTarget, setRestTimerTarget] = useState<{
    rest_sec: number;
    exercise_name: string;
  } | null>(null);
  const [restTimerTrigger, setRestTimerTrigger] = useState<number>(0);
  /**
   * Today banner (5/19 polish #43): during an in-progress session the banner
   * mirrors the session's linked template (name + program · sub_tag) instead
   * of the user's active Program. `null` while loading or for freestyle
   * sessions (no row carries a non-null template_id) — caller renders
   * 「空白訓練」. Refreshed by a useEffect keyed on session status + id below.
   */
  const [sessionTemplateInfo, setSessionTemplateInfo] = useState<{
    template_name: string;
    program_name: string | null;
    sub_tag: string | null;
  } | null>(null);

  /**
   * point2 live-sync (2026-06-12) — latest Watch hr-tick / kcal-tick
   * readings (Q4 channels #9/#10). Display-only ephemera feeding the
   * in-session 5-tile panel's ❤️/🔥 tiles; never persisted (a live tick
   * must not be able to resurrect a discarded session — live-mirror
   * audit H1 class). Reducers + the per-session projection live in
   * `watchLiveTicksReceiver.ts`; listeners mount in the WC useEffect
   * below alongside live-mirror.
   */
  const [watchLiveTicks, setWatchLiveTicks] = useState<WatchLiveTicks | null>(
    null,
  );

  /**
   * StartTemplateSheet wire-up (ADR-0024 § 2.c). `sheetTemplate != null`
   * controls visibility — set when the user taps a row in 模板訓練, cleared
   * on cancel / start / edit. Picker option lists (`programs`, `subTags`) +
   * sticky last-used values are loaded on-demand inside `onPickTemplate` so
   * they reflect any edits made since the last open. Pattern (b) per the
   * slice spec: sheet lives in this screen, `TemplateListSection` stays a
   * pure presentational component (its `onPickTemplate` contract unchanged).
   */
  const [sheetTemplate, setSheetTemplate] = useState<TemplateSummary | null>(
    null,
  );
  const [sheetPrograms, setSheetPrograms] = useState<ProgramOption[]>([]);
  const [sheetLastProgramId, setSheetLastProgramId] = useState<string | null>(
    null,
  );
  const [sheetLastSubTag, setSheetLastSubTag] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    // Query fan-out + derivation lives in the service (report 09 #3); this
    // screen keeps only the setState wiring + the `fromRow` mapping into its
    // SessionState machine. See loadTrainingTabState for the (behaviour-
    // preserved) read/derive logic + per-exercise PR snapshot.
    const s = await loadTrainingTabState(db);
    setExercises(s.exercises);
    setSessionState(fromRow(s.activeSession));
    setActiveProgram(s.activeProgram);
    setUnit(s.unit);
    setAutoPopupTimer(s.autoPopupTimer);
    setTemplatesById(s.templatesById);
    setProgramCellToday(s.programCellToday);
    setSetsInSession(s.setsInSession);
    setPlan(s.plan);
    setBwSnapshotKg(s.bwSnapshotKg);
    setSessionTitle(s.sessionTitle);
    setPrSnapshotById(s.prSnapshotById);
    // Phase C-core (2026-06-26) reverse sync — single collection point. Every
    // edit handler already calls refreshRef.current?.(), so pushing here covers
    // them all without per-handler wiring. Gated to a watch-led in-progress
    // session (loadTrainingTabState only returns a non-null activeSession when
    // one is in progress, so the null-check IS the in-progress check; exactly
    // the set the retired read-only guard covered). The producer's 280ms
    // debounce coalesces bursts; its applyDepth>0 latch (set by
    // runWhileApplyingRemoteSnapshot around the inbound apply) no-ops a refresh
    // caused by applying a Watch snapshot, so this can't ping-pong.
    if (s.activeSession && s.activeSession.is_watch_tracked) {
      scheduleLiveMirrorPush(db, s.activeSession.id);
    }
  }, [db]);

  // 5/19 polish #43 — banner mirror session linked template. Fetches the
  // (template_name, program_name, sub_tag) triple from the most-common
  // non-null `session_exercise.template_id` while the session is in_progress.
  // Resets to null otherwise (idle / ended) so the idle branch falls back to
  // its existing active-program banner unaffected.
  const sessionIdForBanner =
    sessionState.status === 'in_progress' ? getSessionId(sessionState) : null;
  useEffect(() => {
    if (!sessionIdForBanner) {
      setSessionTemplateInfo(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const info = await getSessionLinkedTemplateTriple(db, sessionIdForBanner);
      if (cancelled) return;
      setSessionTemplateInfo(
        info
          ? {
              template_name: info.template_name,
              program_name: info.program_name,
              sub_tag: info.sub_tag,
            }
          : null,
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [db, sessionIdForBanner]);

  // Slice 13d D7-TS — Watch-led end-session inbound listener.
  //
  // Per Q23 / NEW-Q45 / channel #11 (`end-session`): when Watch initiates
  // session end (user taps end on Watch → SessionController.end() +
  // discardWorkout → Watch sends end-session msg with side='watch'),
  // iPhone mirrors by calling finalizeEndAndRoute. The idempotent gate
  // baked into finalizeEndAndRoute (DB read of session.ended_at) prevents
  // double-execution if iPhone-led path also fires simultaneously.
  //
  // Ref pattern: finalizeEndAndRoute is declared later in this component
  // body (~line 1900) and captures sessionState (which changes every set
  // log). Putting it in useEffect deps would re-mount the listener every
  // render — wasteful. The ref pattern lets us mount once and always
  // invoke the freshest closure.
  //
  // Mount lifecycle: (tabs)/index.tsx stays mounted under expo-router
  // even when user is on Settings/History/Programs tabs, so the listener
  // is always alive while the app is foregrounded. App kill / cold start
  // remounts via component init. SQLite SoT remains correct across
  // restarts via the idempotent gate above.
  const finalizeEndAndRouteRef = useRef<
    | ((
        sessionId: string,
        opts?: {
          endedAt?: number;
          snapshot?: unknown;
          fromWatchInbound?: boolean;
        },
      ) => Promise<void>)
    | null
  >(null);

  // 2026-06-11 — dual-fire 同時到的 TOCTOU 擋板：sendMessage 與 TUI 兩發
  // 幾乎同時抵達時，第二發會在第一發的 await 空檔讀到 ended_at=null →
  // 雙跑 finalize（雙 HK sync / 雙成就 eval / 雙 router.push）。in-flight
  // set 讓重疊的第二發直接 return（ended_at 閘門只擋「先後」、擋不了
  // 「同時」）。
  const endInFlightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    // Slice 13d WC ship-blocker E1/E2 (grill 2026-05-30, Q1/Q2/Q4) —
    // listen on BOTH WC channels for a Watch-led end:
    //   - addMessageListener  → instant delivery when iPhone is reachable
    //   - addUserInfoListener → transferUserInfo backstop, OS-queued so it
    //     STILL arrives when iPhone was backgrounded / locked / out of
    //     range at end time. Without this TUI listener a Watch [完成]
    //     fired while iPhone unreachable was lost forever → session row
    //     kept ended_at NULL → every future start refused (the E1 zombie).
    // Both route to the same finalize; the ended_at idempotent gate inside
    // finalizeEndAndRoute makes the second (dual-fire) delivery a no-op, so
    // the two channels can't diverge (end is terminal — unlike start, E4).
    // `fromWatchInbound: true` tells the gate a duplicate delivery must
    // NOT router.push（2026-06-11 fix — 雙發都到時完成頁跳兩次）；只有
    // iPhone-led（按鈕）在 already-ended 時才需要補跳頁。
    // The envelope now carries `endedAt` (Q4 — real finish time) + the
    // final `snapshot` (Q1/Q2 — reconcile-by-membership purge); both are
    // forwarded to finalize.
    const routeEnd = async (
      sessionId: string,
      endedAt?: number,
      snapshot?: unknown,
    ) => {
      const fn = finalizeEndAndRouteRef.current;
      if (!fn) return;
      try {
        await fn(sessionId, { endedAt, snapshot, fromWatchInbound: true });
      } catch (e) {
        console.warn('[watch] end-session handler failed:', e);
      }
    };
    // Defensive: ignore own outbound. iPhone-led envelopes carry
    // side='iphone'; Apple's WC framework doesn't echo a device's own
    // sends back to its own listeners, but this guard is cheap insurance
    // against bridge weirdness / future loopback testing.
    const unsubMsg = addMessageListener('end-session', async (env) => {
      if (env.payload.side !== 'watch') return;
      await routeEnd(
        env.payload.sessionId,
        env.payload.endedAt,
        env.payload.snapshot,
      );
    });
    const unsubTui = addUserInfoListener('end-session', async (env) => {
      if (env.payload.side !== 'watch') return;
      await routeEnd(
        env.payload.sessionId,
        env.payload.endedAt,
        env.payload.snapshot,
      );
    });
    return () => {
      unsubMsg();
      unsubTui();
    };
    // Intentional empty deps — handlers read latest finalize closure
    // via ref. Listeners mount once on component mount, unsubscribe
    // on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // D9 wire-in (ADR-0019 NEW-Q44) — handshake + start-from-watch listeners.
  //
  // `handshake` (channel #0): Watch app launch fires this; iPhone replies
  // with Stage 1 (active session summary + template prefetch list). Watch
  // picker uses the reply to decide Adopt vs new-start without a second
  // round-trip.
  //
  // `start-from-watch` (channel #1): Watch picker user picked freestyle /
  // a template; iPhone creates the session row (or adopts the existing
  // one on race), flips is_watch_tracked=true, then replies with the
  // session snapshot. Watch hydrates its in-memory mirror from the reply.
  //
  // Both handlers receive a `replyHandler` from the bridge (lib's
  // 'message' callback signature: `(payload, replyHandler)`). The
  // orchestrators in `handshake.ts` invoke `replyHandler` with the
  // Stage1ReplyPayload / StartFromIphonePayload. Errors degrade to
  // empty replies (best-effort per Q11).
  //
  // After the handlers fire, `refresh()` re-reads the active session so
  // the iPhone UI flips into in-session mode if Watch initiated start.
  // refresh is called via the same component-scoped closure that other
  // listeners use, so we capture it via ref.
  const refreshRef = useRef<(() => void) | null>(null);
  refreshRef.current = refresh;

  // ADR-0028 — cast edit-token lock. When this iPhone casts a session it holds
  // the token; the paired Watch is locked. Editing is gated on `editLock.canEdit`
  // (the lock overlay below blocks all interaction when locked), and inbound
  // lock-* envelopes drive the handshake. `applyInboundSnapshot` applies a
  // holder's flush (lock-grant / lock-sync) like a live-mirror, suppressing the
  // producer so it can't bounce back.
  const editLock = useCastEditLock({
    db,
    sessionId:
      sessionState.status === 'in_progress' ? sessionState.id : null,
    applyInboundSnapshot: async (snapshot) => {
      await runWhileApplyingRemoteSnapshot(async () => {
        await onLiveMirror(db, snapshot);
        refreshRef.current?.();
      });
    },
  });
  const editLockRef = useRef(editLock);
  editLockRef.current = editLock;

  // 2026-06-26 — the D32 interim "Watch-led ⇒ iPhone read-only + toast" guard
  // is RETIRED. iPhone edits during a Watch-led session now flow to the Watch
  // (reverse-sync Phase C-core): each edit writes the DB, `refresh()` runs, and
  // its tail `scheduleLiveMirrorPush` pushes the tree to the wrist. The 7 set
  // handlers below therefore no longer short-circuit.
  useEffect(() => {
    const unsubHandshake = addMessageListener('handshake', async (env, reply) => {
      await onHandshakeRequest(db, env, reply);
      // ADR-0028 restart-resilience — the Watch only handshakes from the picker
      // (hasLocalSession !== true). If the iPhone is mid-cast (lock paired), the
      // Watch must have lost its session (restart) → RE-CAST so it re-enters the
      // set logger. castInitiated() bumps the epoch + makes iPhone the holder
      // (拍板: Watch-was-holder restart 翻回 iPhone); pushCastToWatch re-projects.
      // Gated on hasLocalSession so a mere background→foreground (still in-session)
      // can't yank the Watch's edit token.
      const lock = editLockRef.current.lock;
      if (
        env.payload.hasLocalSession !== true &&
        lock.status !== 'unpaired' &&
        lock.sessionId
      ) {
        const epoch = editLockRef.current.castInitiated();
        void pushCastToWatch(db, lock.sessionId, { epoch });
      }
    });
    // #311-A (2026-06-09 grill) — Watch 📊 查看歷史 pull-on-tap. Same
    // request-reply shape as handshake: the Watch sends
    // `history-request { exerciseId }`, we query + format display-ready
    // records (unit + locale resolved here) and ack via the replyHandler.
    // Reply shape lives in watchHistory.ts (not a modelled WC kind).
    const unsubHistory = addMessageListener('history-request', async (env, reply) => {
      await onHistoryRequest(db, env, reply);
    });
    // Goal 3a (2026-06-26) — Watch 備註 pull-on-tap. Same request-reply shape
    // as history: the Watch sends `notes-request { exerciseId }`, we read the
    // per-exercise global note (exercise.notes) and ack via the replyHandler.
    // Reply shape lives in watchNotes.ts (not a modelled WC kind).
    const unsubNotes = addMessageListener('notes-request', async (env, reply) => {
      await onNotesRequest(db, env, reply);
    });
    // NEW-Q50 D9 Wave 2 wire-in (2026-05-29) — `start-from-watch` swapped
    // from sendMessage path (v1) to TUI transport (v2). The Watch
    // initiator side sends via `transferUserInfo` so the envelope queues
    // even if iPhone is unreachable (background / locked); we receive it
    // via `addUserInfoListener` once the OS delivers.
    //
    // The orchestrator emits `StartFromWatchReconcile` (a domain shape);
    // we wrap it in the `start-reconcile` envelope kind and ship back
    // via `sendUserInfo` (queued TUI — Watch picks it up next time it's
    // reachable). D30 Watch-side Swift handles the reverse-TUI receive.
    const unsubStartFromWatch = addUserInfoListener(
      'start-from-watch',
      async (env) => {
        // 2026-05-29 deep-night smoke fix (B2): pass `randomUUID` so
        // onStartFromWatch can route to `startSessionFromTemplate` when
        // the Watch supplies a templateId. Without uuid injection the
        // orchestrator falls back to the empty-title freestyle path
        // (banner shows 「空白訓練」 even if Watch picked a template).
        await onStartFromWatch(
          db,
          env,
          (response) => {
            sendUserInfo(makeEnvelope('start-reconcile', response));
          },
          randomUUID,
        );
        // Watch just created (or adopted) a session — refresh iPhone
        // state so the UI flips into in-session mode. Read latest
        // closure via ref.
        refreshRef.current?.();
      },
    );
    // NEW-Q50 D9 Wave 2 wire-in (2026-05-29) — `start-from-watch`
    // message-channel listener (the Watch's sendMessage leg).
    //
    // ⚠️ DO NOT REMOVE as "v1 compat debt" — verified 2026-06-12 (F3
    // cleanup STOP). An older revision of this comment said "REMOVE
    // THIS BLOCK once D30 active"; that became WRONG when audit-F4
    // made the msgId dedupe ring SHARED across both intake channels:
    //
    //   - Watch Swift `sendStartFromWatchTUI` + `resendStartFromWatch`
    //     still DUAL-FIRE the same envelope (same msgId) via
    //     transferUserInfo AND sendMessage (the sendMessage leg exists
    //     because foreground TUI latency is unpredictable — minutes of
    //     queueing observed 2026-05-29).
    //   - The 'message' intake (connectivity.ts) claims the msgId in
    //     the shared ring BEFORE the handler-existence check, and parks
    //     handler-less envelopes in the pre-handler buffer (#287 Fix C).
    //   - If this listener were removed: sendMessage leg arrives first
    //     (the common foreground case) → claims the ring → no message-
    //     channel handler → parked forever → the TUI leg is then
    //     dropped as a ring dup → `onStartFromWatch` never runs →
    //     Watch-initiated start silently lost on iPhone.
    //
    // So post-F4 this listener IS the live handling path whenever the
    // sendMessage leg wins intake; the TUI listener above owns the
    // TUI-leg-wins + background/queued-delivery cases. Removal
    // precondition: Watch Swift single-fires (TUI only) — ack is now
    // unified (below), but this leg is still the msg-leg dispatch path.
    const unsubStartFromWatchV1 = addMessageListener(
      'start-from-watch',
      async (env) => {
        // 2026-05-29 deep-night smoke fix (B2): same uuid injection as
        // the TUI path above — Watch templates need to materialise
        // template_name + exercise tree, not collapse to freestyle.
        await onStartFromWatch(
          db,
          env,
          (response) => {
            // 2026-06-12 (audit 01 F3 residual): the Watch sendMessage
            // leg fires with `replyHandler:nil`, so a message-channel
            // reply can never reach it — ack MUST go reverse-TUI like
            // the TUI path above, or a msg-leg win drops the
            // 'conflict' reconcile (alert intermittently missing).
            // Watch dedupes start-reconcile via Equatable onChange, so
            // an ack per winning leg is safe.
            sendUserInfo(makeEnvelope('start-reconcile', response));
          },
          randomUUID,
        );
        refreshRef.current?.();
      },
    );
    // D31 (2026-05-29 late) — start-resolve forward-TUI inbound.
    // Watch fires this after the user picked "中止 iPhone 保留 Watch"
    // in the conflict alert sheet that landed when start-reconcile
    // returned {status:'conflict'}. iPhone hard-deletes the now-losing
    // existingSessionId via discardSession (cascades sets +
    // session_exercise + achievement_unlock + edit-snapshot in one txn).
    //
    // No reply envelope — Watch dismissed its alert immediately on
    // tap. We call refresh() so the iPhone UI flips out of the
    // now-stale active-session mode (typical: idle banner returns
    // to "選擇訓練" since both the old session AND the new Watch
    // session might not yet be visible to iPhone — that's fine,
    // the standard start-reconcile pipeline adopts the Watch session
    // separately).
    const unsubStartResolve = addUserInfoListener(
      'start-resolve',
      async (env) => {
        await onStartResolve(db, env);
        refreshRef.current?.();
      },
    );
    // D31 wave 2 (2026-05-29 late) — discard-session forward-TUI inbound.
    // Watch fires this when the user tapped [放棄] in FinishPageView.
    // iPhone hard-deletes the row via discardSession (cascades sets /
    // session_exercise / achievement_unlock / edit-snapshot in one txn).
    //
    // Distinct from end-session: end-session preserves the row in history
    // (sets ended_at); discard-session deletes it entirely. User explicit
    // intent.
    const unsubDiscardSession = addUserInfoListener(
      'discard-session',
      async (env) => {
        await onDiscardSession(db, env);
        refreshRef.current?.();
      },
    );
    // D32 (2026-05-29) — applicationContext live-mirror inbound.
    // Per ADR-0019 § Slice 13d NEW-Q50 Q6. During a live session the
    // Watch is the SoT; it builds a full SessionSnapshot and pushes it
    // via `WCSession.updateApplicationContext` every ~15s (Watch-side
    // D29 — not yet shipped, see watchLiveMirrorReceiver TODO). The OS
    // delivers only the LATEST payload (latest-state-replace semantics,
    // no FIFO queue), so `onLiveMirror` unconditionally adopts it via
    // `replaceLiveMirror` snapshot-replace (no diff/reduce/LWW — the
    // most-recent snapshot IS the resolved state).
    //
    // The payload is a raw SessionSnapshot dict (not a {kind,payload}
    // envelope — applicationContext isn't envelope-shaped), so the
    // handler receives `ctx: object` directly; `onLiveMirror` runtime-
    // validates it. Never throws (returns {ok:false,...} on bad payload
    // / db error) — we just refresh so the iPhone in-session UI reflects
    // the latest mirrored sets/exercises.
    const unsubLiveMirror = addAppContextListener(async (ctx) => {
      // ADR-0028 — feed the holder's epoch into the lock machine (demote if the
      // Watch has superseded us; no-op when we're already locked).
      editLockRef.current.noteMirrorEpoch(
        (ctx as { epoch?: number }).epoch,
        (ctx as { sessionId?: string }).sessionId,
      );
      // Phase C-core (2026-06-26): wrap the inbound apply so the refresh it
      // triggers (which now tail-calls scheduleLiveMirrorPush) is no-op'd by
      // the producer's applyDepth gate — a Watch snapshot must not bounce back.
      await runWhileApplyingRemoteSnapshot(async () => {
        await onLiveMirror(db, ctx);
        refreshRef.current?.();
      });
    });
    // Sync fast lane (2026-06-01) — the SAME live-mirror snapshot, dual-fired
    // by the Watch over `sendMessage` for instant (<1s, FIFO-ordered) delivery
    // when the iPhone is reachable. applicationContext (above) stays as the
    // background backstop. Both route to the rev-guarded `onLiveMirror`, which
    // drops a stale redelivery so the two channels never clobber each other.
    // `env.payload` IS the raw SessionSnapshot dict (same shape the appContext
    // path delivers), so `onLiveMirror` consumes it identically. Riding
    // applicationContext alone was the "又慢、又亂、時有時無（尤其遞減組）"
    // regression — sendMessage is the real-time channel.
    const unsubLiveMirrorMsg = addMessageListener('live-mirror', async (env) => {
      editLockRef.current.noteMirrorEpoch(env.payload.epoch, env.payload.sessionId); // ADR-0028
      await runWhileApplyingRemoteSnapshot(async () => {
        await onLiveMirror(db, env.payload);
        refreshRef.current?.();
      });
    });
    // point2 live-sync (2026-06-12) — hr-tick / kcal-tick inbound (Q4
    // channels #9/#10). The Watch's LiveTicksProducer throttles its D17
    // `streamedStats` stream to one emit per 3-5s and sends each metric
    // as its own `sendMessage` envelope (NO TUI — a durable queue
    // replaying stale ticks is worse than dropping them; NO appContext —
    // that slot is the live-mirror snapshot's backstop). Display-only:
    // no DB, no refresh() — just the React state feeding the 5-tile
    // panel's ❤️/🔥 tiles. The reducers runtime-validate + drop
    // stale/out-of-order ticks and return the SAME reference on reject,
    // so setState skips the re-render.
    // ADR-0028 — cast edit-token lock handshake. Each lock-* kind is dual-fired
    // by the sender (instant sendMessage + durable TUI); register both channels.
    // The receiver dedupes by msgId, so a double-delivery is idempotent, and the
    // pure state machine drops stale/duplicate epochs.
    const lockHandler = (env: WCMessage) =>
      editLockRef.current.handleLockEnvelope(env);
    const unsubLockReqM = addMessageListener('lock-request', lockHandler);
    const unsubLockReqT = addUserInfoListener('lock-request', lockHandler);
    const unsubLockGrantM = addMessageListener('lock-grant', lockHandler);
    const unsubLockGrantT = addUserInfoListener('lock-grant', lockHandler);
    const unsubLockAckM = addMessageListener('lock-ack', lockHandler);
    const unsubLockAckT = addUserInfoListener('lock-ack', lockHandler);
    const unsubLockTakeM = addMessageListener('lock-takeover', lockHandler);
    const unsubLockTakeT = addUserInfoListener('lock-takeover', lockHandler);
    const unsubLockSyncM = addMessageListener('lock-sync', lockHandler);
    const unsubLockSyncT = addUserInfoListener('lock-sync', lockHandler);
    const unsubHrTick = addMessageListener('hr-tick', (env) => {
      setWatchLiveTicks((prev) => applyHrTick(prev, env));
    });
    const unsubKcalTick = addMessageListener('kcal-tick', (env) => {
      setWatchLiveTicks((prev) => applyKcalTick(prev, env));
    });
    return () => {
      unsubHandshake();
      unsubHistory();
      unsubNotes();
      unsubStartFromWatch();
      unsubStartFromWatchV1();
      unsubStartResolve();
      unsubDiscardSession();
      unsubLiveMirror();
      unsubLiveMirrorMsg();
      unsubLockReqM();
      unsubLockReqT();
      unsubLockGrantM();
      unsubLockGrantT();
      unsubLockAckM();
      unsubLockAckT();
      unsubLockTakeM();
      unsubLockTakeT();
      unsubLockSyncM();
      unsubLockSyncT();
      unsubHrTick();
      unsubKcalTick();
    };
    // Intentional empty deps — db handle stable; refresh read via ref.
    // Listeners mount once on component mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fetch on every focus so returning from the detail screen resets us.
  // Also drain the picker mailbox here (per template editor convention) for
  // the [+ 動作] flow: when Library screen submitPick → router.back(), this
  // focus listener fires, grabs the payload, and appends rows. The append
  // logic is inlined (vs extracted as a useCallback above) so we don't have
  // to hoist + thread through `useFocusEffect`'s dep array — the only
  // caller is here.
  useFocusEffect(
    useCallback(() => {
      const payload = consumePick();
      refresh();
      if (
        payload &&
        (payload.exerciseIds.length > 0 ||
          payload.reusableSupersetIds.length > 0)
      ) {
        void (async () => {
          const active = await getActiveSession(db);
          if (!active) return;
          // ADR-0019 NEW-Q49 (slice 13d D9) — capture first-add gate state
          // BEFORE any append: freestyle sessions (0 rows at this point) get
          // a one-shot pushStartToWatch after the append loop succeeds, so
          // the Watch in-session UI hydrates with the new exercise. Template-
          // based sessions already snapshot ≥1 row at start so the count
          // gate naturally short-circuits here.
          const exerciseCountBefore = await countSessionExercises(db, active.id);
          const willFireFirstAddPush = shouldFireFirstAddPush({
            is_watch_tracked: active.is_watch_tracked,
            currentExerciseCount: exerciseCountBefore,
          });
          // TODO(ADR-0024 § 4 assisted modal block, slice 10g 落地): before
          // calling `appendSessionExercise` for any `load_type === 'assisted'`
          // exercise, gate via `needsBwSnapshotForAppend({ load_type,
          // snapshot_kg })` (from `@/src/domain/session/assistedBlockGuard`).
          // If returns true, surface a blocking modal「請先輸入體重」+
          // TextInput + 儲存 → write through `insertBodyMetric` then refresh
          // `session.bodyweight_snapshot_kg`. Pure helper is ready; UI side
          // pending.
          try {
            // ADR-0019 Round D Amendment Q4 — track lastAppendedId so we can
            // auto-expand the LAST appended exercise card after the loop.
            // RS appends → parent (a_id) of the cluster is the visible card.
            // Solo appends → newSeId is the card. Solos run AFTER RS in this
            // loop, so a solo wins over an RS if both kinds were picked.
            let lastAppendedId: string | null = null;
            // Reusable supersets FIRST (per pickerBridge convention) — each
            // explodes into a cluster pair (A + B session_exercise rows
            // linked via parent_id + reusable_superset_id).
            //
            // NOTE: RS pick prefills from SAME RS template history only
            // (slice 10c overnight #25). 個別 exercise 的 solo / 跨 template
            // 記憶仍不取 — 避免「我在 solo Bench 練 100kg 結果新加的 RS Bench
            // 也跳出 100kg」這種混淆。同 RS template 的歷史是同環境記憶，
            // 不衝突。
            for (const rs_id of payload.reusableSupersetIds) {
              const { a_id, b_id } = await appendReusableSupersetToSession(
                db,
                {
                  session_id: active.id,
                  reusable_superset_id: rs_id,
                  uuid: randomUUID,
                },
              );
              await prefillReusableSupersetFromLastSession(db, {
                current_session_id: active.id,
                reusable_superset_id: rs_id,
                new_a_session_exercise_id: a_id,
                new_b_session_exercise_id: b_id,
                uuid: randomUUID,
              });
              lastAppendedId = a_id;
            }
            // Solo exercises after.
            for (const exercise_id of payload.exerciseIds) {
              // v019 isolation fix: hold onto the newly-minted
              // session_exercise.id and thread it into the prefill call so
              // the cloned sets tag onto the new card (not some other card
              // that happens to target the same exercise_id elsewhere in
              // this session).
              const newSeId = randomUUID();
              await appendSessionExercise(db, {
                id: newSeId,
                session_id: active.id,
                exercise_id,
              });
              await prefillSessionExerciseFromLastSession(db, {
                session_id: active.id,
                exercise_id,
                uuid: randomUUID,
                session_exercise_id: newSeId,
              });
              lastAppendedId = newSeId;
            }
            await refresh();
            // Round D Amendment Q4 — auto-expand the last appended card
            // (Q3 c-2 "only-one-expanded" invariant: setting this collapses
            // any previously-expanded card automatically).
            if (lastAppendedId) {
              setExpandedExerciseId(lastAppendedId);
            }
            // ADR-0019 NEW-Q49 (slice 13d D9) — fire one-shot
            // pushStartToWatch when this batch added the first exercise(s)
            // to a freestyle session. Mirrors `onStartPlanned` / `onSheetStart`
            // — fire-and-forget; ack flips is_watch_tracked, Watch unreachable
            // = silent no-op + retry on next +動作.
            if (willFireFirstAddPush) {
              void pushStartToWatch(db, active.id, {});
            }
          } catch (e) {
            Alert.alert(
              t('alert', 'addExerciseFailed'),
              e instanceof Error ? e.message : String(e),
            );
          }
        })();
      }
    }, [refresh, db])
  );

  /**
   * Start a freestyle session — ADR-0024 § 2.b. No more pre-prompt: we just
   * createSession; the adapter auto-pulls the latest body_metric as the
   * snapshot (slice 10g.5). If the user has no body_metric on record the
   * snapshot stays null until an assisted exercise gets appended (10g.6
   * modal block).
   */
  const onStartFreestyle = async () => {
    setBusy(true);
    try {
      const id = randomUUID();
      const started_at = Date.now();
      await createSession(db, { id, started_at });
      setSessionState(startState({ id, started_at }));
      setSetsInSession([]);
      setPlan([]);
      // Re-read so we surface the snapshot the adapter auto-pulled (latest
      // body_metric or null).
      const after = await getActiveSession(db);
      setBwSnapshotKg(after?.bodyweight_snapshot_kg ?? null);
    } catch (e) {
      Alert.alert(
        t('alert', 'cannotStartSession'),
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setBusy(false);
    }
  };

  /**
   * Start the active program's today template — ADR-0024 § 2.a. Unlike the
   * 模板訓練 row (which needs StartTemplateSheet because program/sub_tag must
   * be picked), here both come from the program cell — atomic start, no
   * sheet. Sets the snapshot via the same adapter auto-pull as freestyle.
   */
  const onStartPlanned = async (
    template_id: string,
    program_id: string | null,
    sub_tag: string | null,
  ) => {
    setBusy(true);
    try {
      const { session_id } = await startSessionFromTemplate(db, {
        template_id,
        uuid: randomUUID,
        program_id: program_id ?? undefined,
        sub_tag: sub_tag ?? null,
      });
      await refresh();
      // D6 — fire WC `start-from-iphone` push to Watch (silent, fire-and-forget).
      // Ack flips session.is_watch_tracked = true so detail page renders 5-tile.
      // Watch unreachable / unpaired → no-op, session stays iPhone-led.
      void pushStartToWatch(db, session_id, {});
    } catch (e) {
      Alert.alert(
        t('alert', 'cannotStartSession'),
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setBusy(false);
    }
  };

  /**
   * ADR-0024 § 2.c — 模板訓練 row tap. Loads picker data on demand (programs,
   * sub_tags, sticky last-used) then opens `StartTemplateSheet`. Mirrors the
   * deleted Templates tab's `onRowPress` (commit e08944e). Loading happens
   * inline so the lists reflect any program / template edits the user made
   * between visits.
   */
  const onPickTemplate = async (item: TemplateSummary) => {
    // ADR-0026 極簡模式：不開 StartTemplateSheet（無計劃/強度選擇器）。
    // 直接把 (program=null, sub_tag=null) 丟進「現有」resolver = 通用：
    // 群裡有通用 variant → 用它；沒有 → fallback 到 representative（最新）。
    // 與 onSheetStart 共用 resolveTargetTemplateId / startSessionFromTemplate /
    // WC push，唯一差異是 alert 靜音（D3）＋ 不寫 per-template sticky（計劃概念）。
    if (isMinimal) {
      await onStartMinimalTemplate(item);
      return;
    }
    setBusy(true);
    try {
      // 2026-06-04 — sticky last-used (program + intensity) is now PER-TEMPLATE
      // (key suffixed with the template id) so each template remembers its own
      // last selection instead of all templates sharing one global default.
      const [programSummaries, lastProgram, lastTag] = await Promise.all([
        listPrograms(db),
        getSetting<string>(db, `${LAST_PROGRAM_KEY}:${item.id}`),
        getSetting<string>(db, `${LAST_SUB_TAG_KEY}:${item.id}`),
      ]);
      setSheetPrograms(
        programSummaries.map((p) => ({ id: p.id, name: p.name })),
      );
      // Default the sheet selection to the template's OWN (program, sub_tag)
      // when it has no per-template sticky yet (e.g. a template just created via
      // 模板訓練「＋」 + classified in the editor — its sticky is only written by
      // start/edit-via-sheet, never by editor-save). Without this the sheet
      // defaulted to 通用, which mismatches the template's real triple →
      // planResolveTarget fires the「尚未建立模板」fallback alert on re-edit.
      setSheetLastProgramId(lastProgram ?? item.program_id ?? null);
      setSheetLastSubTag(lastTag ?? item.sub_tag ?? null);
      setSheetTemplate(item);
    } catch (e) {
      Alert.alert(
        t('alert', 'cannotOpen'),
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setBusy(false);
    }
  };

  const closeSheet = () => setSheetTemplate(null);

  const persistSticky = async (
    template_id: string,
    program_id: string,
    sub_tag: string | null,
  ): Promise<void> => {
    // Per-template sticky (2026-06-04) — keyed by template id so each template
    // remembers its own last (program, intensity) selection.
    await setSetting<string>(db, `${LAST_PROGRAM_KEY}:${template_id}`, program_id);
    if (sub_tag != null) {
      await setSetting<string>(db, `${LAST_SUB_TAG_KEY}:${template_id}`, sub_tag);
    } else {
      // 通用 (no intensity) — clear any stored value so the next open defaults
      // back to 通用 rather than resurfacing a stale intensity.
      await deleteSetting(db, `${LAST_SUB_TAG_KEY}:${template_id}`);
    }
  };

  /**
   * Lookup-or-fallback used by onSheetEdit (編輯模板). Returns the template_id of
   * the sibling matching the user's (period_id, intensity_id) selection, or the
   * representative + 「尚未建立模板」alert on miss (#50 no-spawn). Pure planner is
   * `planResolveTarget` in src/domain/template/resolveTargetTemplate.ts.
   *
   * 開始訓練 (onSheetStart) no longer uses this — it auto-materialises the picked
   * variant via `ensureTemplateVariantReady` (option 1 推廣, 2026-06-26), so the
   * START path never falls back/alerts; the editor's alert self-resolves once a
   * start has created the row.
   */
  const resolveTargetTemplateId = useCallback(
    async (
      sheetTpl: TemplateSummary,
      selection: { period_id: string; intensity_id: string | null },
    ): Promise<{
      template_id: string;
      alert?: { title: string; body: string };
    }> => {
      const sourceProgramId = sheetTpl.program_id ?? null;
      const sourceSubTag = sheetTpl.sub_tag ?? null;
      const isNoneProgram = selection.period_id === RESERVED_NONE_PROGRAM_ID;
      const wantedProgramId = isNoneProgram ? null : selection.period_id;
      const wantedSubTag = selection.intensity_id;

      const source = {
        id: sheetTpl.id,
        name: sheetTpl.name,
        program_id: sourceProgramId,
        sub_tag: sourceSubTag,
      };
      const sel = {
        wanted_program_id: wantedProgramId,
        wanted_sub_tag: wantedSubTag,
      };

      const matchesSelf =
        sourceProgramId === wantedProgramId && sourceSubTag === wantedSubTag;
      const found = matchesSelf
        ? null
        : await findTemplateByTriple(db, {
            name: sheetTpl.name,
            program_id: wantedProgramId,
            sub_tag: wantedSubTag,
          });

      const plan = planResolveTarget(source, sel, found);
      switch (plan.kind) {
        case 'use_self':
        case 'use_sibling':
          return { template_id: plan.template_id };
        case 'fallback_with_alert':
          return { template_id: plan.template_id, alert: plan.alert };
      }
    },
    [db],
  );

  /**
   * [編輯模板] handler — lookup-or-spawn + router.push to the editor with
   * the user's (period, intensity) selection encoded as query params so the
   * editor header shows what they picked even on fallback. Mirrors the
   * deleted Templates tab handler (round 42 + #50 C1).
   */
  const onSheetEdit = async (selection: {
    period_id: string;
    intensity_id: string | null;
  }) => {
    if (!sheetTemplate) return;
    setBusy(true);
    try {
      await persistSticky(
        sheetTemplate.id,
        selection.period_id,
        selection.intensity_id,
      );
      const resolved = await resolveTargetTemplateId(sheetTemplate, selection);
      closeSheet();
      if (resolved.alert) {
        Alert.alert(resolved.alert.title, resolved.alert.body);
      }
      const dpidParam =
        selection.period_id === RESERVED_NONE_PROGRAM_ID
          ? '__none__'
          : encodeURIComponent(selection.period_id);
      const dstParam =
        selection.intensity_id === null
          ? '__none__'
          : encodeURIComponent(selection.intensity_id);
      router.push(
        `/template/${resolved.template_id}?dpid=${dpidParam}&dst=${dstParam}`,
      );
    } catch (e) {
      Alert.alert(
        t('alert', 'cannotOpenEditor'),
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setBusy(false);
    }
  };

  /**
   * [開始訓練] handler — lookup-or-spawn + startSessionFromTemplate. Refuses
   * if a session is already in progress (guard mirrors template editor's
   * onStartSession). After start, closes the sheet + refreshes so the idle →
   * in_progress transition picks up.
   */
  const onSheetStart = async (selection: {
    period_id: string;
    intensity_id: string | null;
  }) => {
    if (!sheetTemplate) return;
    setBusy(true);
    try {
      const active = await getActiveSession(db);
      if (active) {
        Alert.alert(
          t('alert', 'sessionAlreadyInProgress'),
          t('alert', 'endActiveSessionFirst'),
        );
        return;
      }
      await persistSticky(
        sheetTemplate.id,
        selection.period_id,
        selection.intensity_id,
      );
      // Phase A (autostart-prefill) — remember this start's (program, intensity)
      // as the GLOBAL last-used so a fresh template's 開始訓練 can auto-adopt it.
      // Only REAL programs are recorded: a 通用 (reserved 「無」) start carries no
      // 計劃 concept and must NOT overwrite the user's last real plan.
      if (selection.period_id !== RESERVED_NONE_PROGRAM_ID) {
        await setGlobalLastUsed(db, selection.period_id, selection.intensity_id);
      }
      // option 1 推廣 — EVERY selection (通用 + 任何分類變體) materialises its
      // exact (program, sub_tag) row + prefills it. 反轉 #50 no-spawn + #308
      // start fallback-alert（僅 start 路徑；onSheetEdit 維持 fallback+告示）。
      // 通用 = (null, null)。session 副標題吃這個新建/分類過的 linked template。
      const wantedProgramId =
        selection.period_id === RESERVED_NONE_PROGRAM_ID
          ? null
          : selection.period_id;
      const targetTemplateId = await ensureTemplateVariantReady(db, {
        name: sheetTemplate.name,
        program_id: wantedProgramId,
        sub_tag: selection.intensity_id,
        uuid: randomUUID,
      });
      const { session_id } = await startSessionFromTemplate(db, {
        template_id: targetTemplateId,
        uuid: randomUUID,
        program_id: selection.period_id,
        sub_tag: selection.intensity_id,
      });
      closeSheet();
      await refresh();
      // D6 — fire WC `start-from-iphone` push to Watch (silent, fire-and-forget).
      // See sibling call site in `onStartPlanned` for rationale.
      void pushStartToWatch(db, session_id, {});
    } catch (e) {
      Alert.alert(
        t('alert', 'cannotStartSession'),
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setBusy(false);
    }
  };

  /**
   * ADR-0026 極簡模式的開始模板路徑 — 取代 StartTemplateSheet。一律開「通用」
   * 模板：`ensureTemplateVariantReady(name, null, null)` 解析-或-建立通用列（群組
   * 只有分類變體時自動建）+ 空模板用最近一次訓練 prefill，再走「相同」的
   * startSessionFromTemplate + WC push side-effects。
   *
   * 與 onSheetStart 差異（D3）：不開 sheet、不寫 per-template / 全域 sticky（皆計劃
   * 概念）。計劃模式行為不受影響（此分支只在 isMinimal 走到）。取代舊的
   * resolveTargetTemplateId 路徑（其 miss 會 fallback 到分類 representative，害極簡
   * 開到帶計劃的模板、且不建通用）。
   */
  const onStartMinimalTemplate = async (item: TemplateSummary) => {
    setBusy(true);
    try {
      const active = await getActiveSession(db);
      if (active) {
        Alert.alert(
          t('alert', 'sessionAlreadyInProgress'),
          t('alert', 'endActiveSessionFirst'),
        );
        return;
      }
      const generalId = await ensureTemplateVariantReady(db, {
        name: item.name,
        program_id: null,
        sub_tag: null,
        uuid: randomUUID,
      });
      const { session_id } = await startSessionFromTemplate(db, {
        template_id: generalId,
        uuid: randomUUID,
        program_id: undefined,
        sub_tag: null,
      });
      await refresh();
      // D6 — fire WC `start-from-iphone` push to Watch（同 onSheetStart）。
      void pushStartToWatch(db, session_id, {});
    } catch (e) {
      Alert.alert(
        t('alert', 'cannotStartSession'),
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setBusy(false);
    }
  };

  const onSaveInlineBodyData = async () => {
    const bwKg = parseWeightInput(inlineBwInput, unit);
    const smmKg = parseWeightInput(inlineSmmInput, unit);
    const pbfTrim = inlinePbfInput.trim();
    const pbfNum = pbfTrim === '' ? null : Number(pbfTrim);
    const pbf =
      pbfNum == null ? null : Number.isFinite(pbfNum) ? pbfNum : null;
    const draft = {
      recorded_at: Date.now(),
      bodyweight_kg: bwKg,
      pbf,
      smm_kg: smmKg,
    };
    const err = validateBodyMetric(draft);
    if (err) {
      Alert.alert(t('alert', 'invalidInput'), t('alert', 'atLeastOneField'));
      return;
    }
    setBusy(true);
    try {
      await insertBodyMetric(db, draft, randomUUID);
      setInlineBwInput('');
      setInlinePbfInput('');
      setInlineSmmInput('');
      setBodySheetVisible(false);
    } catch (e) {
      Alert.alert(t('alert', 'saveFailed'), e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Append one set to a specific exercise within the active session. Slice
   * 10c Phase 2 commit 5: replaces the previous outer Weight/Reps form +
   * Save Set button — now triggered from inside the exercise card's footer
   * 「+ 新增 1 組」 (ADR-0019 Q3). Default reps/weight come from the most
   * recent set already recorded for this exercise in this session (per the
   * v0 add-set UX); falls back to 0/0 if the exercise has no sets yet.
   * Subsequent commits will swap this minimum-viable handler for the full
   * 5-gesture wire-up (right-swipe add + notes, etc.).
   */
  // Phase C-core (2026-06-26) reverse sync — push the live tree to the Watch
  // after a LOCAL set/title edit. These handlers mutate via optimistic setState
  // (setSetsInSession / setSessionTitle), NOT refresh, so the refresh-tail push
  // misses them; each calls this explicitly. Re-reads the DB fresh (debounced),
  // gated to a watch-led in-progress session. Called ONLY from user-driven edit
  // handlers — the WC inbound path runs none of them — so it can NEVER echo a
  // just-applied Watch snapshot back (no ping-pong, even during concurrent use).
  const pushMirrorIfWatchLed = () => {
    if (sessionState.status !== 'in_progress' || !sessionState.is_watch_tracked) {
      return;
    }
    const sid = getSessionId(sessionState);
    if (sid) scheduleLiveMirrorPush(db, sid);
  };

  const onAddSet = async (
    exercise_id: string,
    session_exercise_id: string,
  ) => {
    const session_id = getSessionId(sessionState);
    if (!canRecordSet(sessionState) || !session_id) {
      Alert.alert(t('alert', 'noActiveSession'));
      return;
    }
    // Defaults priority chain (ADR-0012/0016 動作記憶):
    //   1. Last set in CURRENT session for this exercise (same-session continuity)
    //   2. Last set in HISTORY across all prior sessions (cross-session memory)
    //   3. Sensible starter defaults (weight=0, reps=10) for true first-time exercises
    //
    // v019 isolation fix: filter by session_exercise_id (the card) — not
    // bare exercise_id — so an RS A-side card doesn't pick up "last set"
    // from a coincidentally-same-exercise solo card sitting elsewhere in
    // the same session.
    const priorInSession = setsInSession.filter(
      (s) => s.session_exercise_id === session_exercise_id
    );
    const lastSetInSession = priorInSession[priorInSession.length - 1] ?? null;

    // 2026-05-20 (revised) — 「新增 1 組」 should add a NEW dropset cluster
    // when the exercise ends in dropset, NOT extend the existing chain.
    // 「最後一組」for dropset = 下一個同類 cluster (D2)，所以 head + follower
    // 一起加在 D1 chain 之後。
    if (lastSetInSession?.set_kind === 'dropset') {
      setBusy(true);
      try {
        // priorInSession is sorted ASC by ordering (listSetsBySession order),
        // so [length-1] is already the END of the chain.
        await addSessionDropsetCluster(db, {
          session_id,
          after_set_id: lastSetInSession.id,
          uuid: randomUUID,
        });
        const sets = await listSetsBySession(db, session_id);
        setSetsInSession(sets);
        pushMirrorIfWatchLed(); // Phase C-core reverse sync (local edit → Watch)
      } catch (e) {
        Alert.alert(t('alert', 'saveFailed'), e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
      return;
    }

    // Resolve cross-session history (動作記憶) ONLY when there is no last-set
    // in the current session — preserves the no-extra-query optimization. The
    // async lookup + Date.now() stay here; resolveSetDefaults is a pure
    // value-map over the already-fetched rows (big-file health #8).
    let historicalMostRecent = null;
    if (!lastSetInSession) {
      try {
        const historicalPriors = await listPriorSetsForExercise(
          db,
          exercise_id,
          Date.now() + 1 // cutoff exclusive of now+1ms = include all prior
        );
        if (historicalPriors.length > 0) {
          historicalMostRecent = historicalPriors[0]; // ORDER BY created_at DESC
        }
      } catch {
        // History query failure → fall through to starter defaults
      }
    }
    const { weight_kg, reps: repsNum } = resolveSetDefaults(
      lastSetInSession,
      historicalMostRecent
    );

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
        session_id,
        input: { exercise_id, weight_kg, reps: repsNum },
        uuid: randomUUID,
        session_exercise_id, // v019 isolation
      });
      const sets = await listSetsBySession(db, session_id);
      setSetsInSession(sets);
      pushMirrorIfWatchLed(); // Phase C-core reverse sync (local edit → Watch)
      // NOTE: PR detection moved to onToggleLogged — new sets start unlogged,
      // so the PR ceremony should fire only when user marks the set complete.
      // Per user 「還沒打勾就跳出ＰＲ！」 (smoke 2026-05-17 ultra-late).
    } catch (e) {
      Alert.alert(t('alert', 'saveFailed'), e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Persist a partial update to one set (weight_kg / reps) and refresh
   * the in-memory `setsInSession`. Wired to `<SetRowContent onUpdateSet>`
   * — each keystroke produces a patch like `{ weight: 47.5 }` (note the
   * key is `weight`, the prop name; we translate to DB col `weight_kg`).
   * The component buffers partial decimal input ("12.") locally so this
   * handler only sees well-formed numbers.
   *
   * No PR re-detection on edit: PR engine fires on add, not update. If
   * the user edits a set after PR has triggered, the chip stays as-is
   * until the next add.
   */
  const onUpdateSet = async (
    set_id: string,
    patch: { reps?: number; weight?: number },
  ) => {
    const dbPatch: { weight_kg?: number; reps?: number } = {};
    if (patch.reps !== undefined) dbPatch.reps = patch.reps;
    if (patch.weight !== undefined) dbPatch.weight_kg = patch.weight;
    const session_id = getSessionId(sessionState);
    if (!session_id) return;
    try {
      await updateSetFields(db, set_id, dbPatch);
      // Optimistic in-memory mutation so the row reflects the change
      // before the listSetsBySession round-trip lands. The persisted UPDATE
      // is authoritative; we still re-fetch below to stay aligned.
      setSetsInSession((curr) =>
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
      pushMirrorIfWatchLed(); // Phase C-core reverse sync (local edit → Watch)
    } catch (e) {
      Alert.alert(t('alert', 'saveFailed'), e instanceof Error ? e.message : String(e));
    }
  };

  /**
   * Apply a tap-label cycle (warmup ↔ working ↔ dropset) to one set
   * within one exercise. Slice 10c Phase 2 commit 7a: pure
   * `cycleSessionSetKind` emits the DB op list; this handler walks the
   * ops and issues the corresponding repo calls in sequence, then
   * refreshes `setsInSession`.
   *
   * No transaction wrapping yet — a partial failure mid-list would leave
   * an inconsistent kind/follower state, but the user can re-tap to
   * re-converge. Wrapping in a transaction is a future hardening (would
   * require pushing the op application down into the repo).
   */
  /**
   * Slice 10c overnight #7 第 2 點: cluster path routes through
   * `cycleSessionSetKindClusterAware` with `is_in_cluster=true` so the
   * cycle order is W ↔ Wm (skip dropset entirely). Solo path
   * (`is_in_cluster=false`, default) keeps the existing
   * W → Wm → D → W transition unchanged.
   */
  const onCycleSetKind = async (
    exercise_id: string,
    set_id: string,
    is_in_cluster: boolean = false,
  ) => {
    const session_id = getSessionId(sessionState);
    if (!session_id) return;
    // v019 isolation (slice 10c #17): cycle ops operate on a SINGLE card's
    // set list (warmup/working/dropset transitions are card-scoped). Look
    // up the target set's owning card via its session_exercise_id and
    // filter the cycle universe to that card; fall back to legacy
    // exercise_id when the row is pre-v019 untagged.
    const target = setsInSession.find((s) => s.id === set_id);
    const targetSeId = target?.session_exercise_id ?? null;
    const setsForExercise = setsInSession.filter((s) =>
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
          // insertFollower — dropset head promotion appends one follower at
          // head.ordering+1 with chain shift, ATOMICALLY (report 09 #1,
          // 2026-06-20). Single-sourced in setRepository — see
          // insertDropsetFollower for the ordering / v019-isolation /
          // atomicity rationale (was a non-transactional 2-step duplicated
          // here + session/[id].tsx).
          await insertDropsetFollower(db, {
            session_id,
            parent_set_id: op.parent_set_id,
            exercise_id,
            weight_kg: op.weight_kg,
            reps: op.reps,
            new_set_id: op.new_set_id,
          });
        }
      }
      const sets = await listSetsBySession(db, session_id);
      setSetsInSession(sets);
      pushMirrorIfWatchLed(); // Phase C-core reverse sync (local edit → Watch)
    } catch (e) {
      Alert.alert(t('alert', 'saveFailed'), e instanceof Error ? e.message : String(e));
    }
  };

  /**
   * Hard-delete a set (左滑 delete). Caller-facing confirmation Alert is
   * presented at the gesture handler in the card. No undo — re-recording
   * is one tap.
   */
  const onDeleteSet = async (set_id: string) => {
    const session_id = getSessionId(sessionState);
    if (!session_id) return;
    try {
      await deleteSet(db, set_id);
      const sets = await listSetsBySession(db, session_id);
      setSetsInSession(sets);
      pushMirrorIfWatchLed(); // Phase C-core reverse sync (local edit → Watch)
    } catch (e) {
      Alert.alert(t('alert', 'deleteFailed'), e instanceof Error ? e.message : String(e));
    }
  };

  /**
   * Right-swipe-add: insert one new set right after `source_set_id`, copying
   * the source set's reps/weight. Used when the user finishes a set and
   * wants another one just like it. Ordering uses MAX+1 (no reshuffle) —
   * the per-exercise filter sorts by ordering ASC so the new row shows up
   * after all current rows.
   *
   * Also runs PR detection (same as `onAddSet`) since this IS adding a
   * new set, just with a different default source.
   */
  const onAddSetAfter = async (
    _exercise_id: string,
    source_set_id: string,
  ) => {
    const session_id = getSessionId(sessionState);
    if (!canRecordSet(sessionState) || !session_id) return;
    setBusy(true);
    try {
      // 2026-05-20 (revised) — dropset cluster +1 swipe: add a NEW D2
      // cluster (head + 1 follower) AFTER the entire D1 chain, not
      // extending D1. User intent: 「+1」 = 新增最後一組 = 同種類的下一個。
      // Inline +/- buttons inside the chain still extend the same chain
      // (addSessionDropsetRow); +1 swipe creates a sibling cluster.
      const source = setsInSession.find((s) => s.id === source_set_id);
      if (source?.set_kind === 'dropset') {
        // Find the end of the chain (after_set_id passed to helper) so the
        // new D2 cluster lands BELOW D1's last follower, not in the middle.
        const headId = source.parent_set_id ?? source.id;
        const chainSets = setsInSession.filter(
          (s) => s.id === headId || s.parent_set_id === headId,
        );
        const lastInChain = chainSets.reduce(
          (a, b) => (a.ordering > b.ordering ? a : b),
          source,
        );
        await addSessionDropsetCluster(db, {
          session_id,
          after_set_id: lastInChain.id,
          uuid: randomUUID,
        });
      } else {
        // Use insertSessionSetAfter so the new row lands DIRECTLY below the
        // swiped row (not at end of session). Repo func handles the ordering
        // shift + mirrors source's set_kind / weight / reps automatically.
        await insertSessionSetAfter(db, {
          session_id,
          source_set_id,
          uuid: randomUUID,
        });
      }
      const sets = await listSetsBySession(db, session_id);
      setSetsInSession(sets);
      pushMirrorIfWatchLed(); // Phase C-core reverse sync (local edit → Watch)
      // PR detection moved to onToggleLogged — new rows start unlogged.
    } catch (e) {
      Alert.alert(t('alert', 'saveFailed'), e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Slice 10c overnight #61 — `+` button on cluster-last follower in a
   * dropset chain (solo card). Appends a new follower attached to the
   * chain HEAD via `addSessionDropsetRow`. Source row may be the head or
   * any existing follower — the repo helper resolves the head id internally.
   * Mirrors template editor's `addDropsetRow` UX, but persisted.
   */
  const onAddDropsetRow = async (after_set_id: string) => {
    const session_id = getSessionId(sessionState);
    if (!canRecordSet(sessionState) || !session_id) return;
    setBusy(true);
    try {
      await addSessionDropsetRow(db, {
        session_id,
        after_set_id,
        uuid: randomUUID,
      });
      const sets = await listSetsBySession(db, session_id);
      setSetsInSession(sets);
      pushMirrorIfWatchLed(); // Phase C-core reverse sync (local edit → Watch)
    } catch (e) {
      Alert.alert(t('alert', 'addDropsetFailed'), e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Slice 10c overnight #61 — `−` button on a dropset follower. Deletes
   * the follower row via `removeSessionDropsetRow`. Refuses to shrink
   * a chain below head + 1 follower (DROPSET_CHAIN_TOO_SHORT) — UI shows
   * an Alert explaining the user must delete the whole chain via the
   * head row if they want to remove all followers.
   */
  const onRemoveDropsetRow = async (set_id: string) => {
    const session_id = getSessionId(sessionState);
    if (!session_id) return;
    try {
      await removeSessionDropsetRow(db, {
        session_id,
        set_id,
      });
      const sets = await listSetsBySession(db, session_id);
      setSetsInSession(sets);
      pushMirrorIfWatchLed(); // Phase C-core reverse sync (local edit → Watch)
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
  };

  /**
   * Flip the v015 `is_logged` flag on a set (tap-✓). Source of truth for
   * Q4's segmented progress bar + the header `done/planned` count.
   * No alert on failure — toggle is idempotent so retry-on-next-render is
   * fine; we only catch the failure to avoid a hard crash.
   *
   * Slice 10c rest-timer hookup (ADR-0019 Q2 R1 v1):
   *   - flip TO 1 + autoPopup ON → launch rest-timer modal with the
   *     set's owning session_exercise.rest_sec (or 60 default). Per
   *     Q2.3 (b) M1 the modal restarts with fresh time even if already
   *     open (we bump `restTimerTrigger`).
   *   - flip TO 0 → cancel timer (Q2.3 (d) Y2 — un-logging removes the
   *     set's "complete" side-effect, timer included).
   */
  const onToggleLogged = async (set_id: string, currentlyLogged: boolean) => {
    const session_id = getSessionId(sessionState);
    if (!session_id) return;
    const nextLogged = currentlyLogged ? 0 : 1;
    try {
      await updateSetFields(db, set_id, {
        is_logged: nextLogged,
      });
      setSetsInSession((curr) =>
        curr.map((s) =>
          s.id === set_id ? { ...s, is_logged: nextLogged } : s,
        ),
      );
      pushMirrorIfWatchLed(); // Phase C-core reverse sync (local edit → Watch)
    } catch (e) {
      console.warn('[toggle is_logged] failed:', e);
      return;
    }

    // PR detection runs only when 0 → 1 transition (user actually logged it).
    // Moved here from onAddSet/onAddSetAfter (smoke 2026-05-17 ultra-late —
    // user 「還沒打勾就跳出ＰＲ！」). Setting to 0 cancels any prior PR display
    // for the same exercise to avoid stale state.
    if (nextLogged === 1) {
      const justLogged = setsInSession.find((s) => s.id === set_id);
      if (justLogged) {
        const exerciseObj =
          exercises.find((e) => e.id === justLogged.exercise_id) ?? null;
        if (exerciseObj) {
          try {
            const priors = await listPriorSetsForExercise(
              db,
              justLogged.exercise_id,
              justLogged.created_at,
            );
            const delta = detectPRBreaks({
              new_set: {
                weight_kg: justLogged.weight_kg ?? 0,
                reps: justLogged.reps ?? 0,
                load_type: exerciseObj.load_type,
                bw_snapshot_kg: bwSnapshotKg,
              },
              prior_sets: priors.map((p) => ({
                weight_kg: p.weight_kg,
                reps: p.reps,
                load_type: exerciseObj.load_type,
                bw_snapshot_kg: p.bw_snapshot_kg,
              })),
            });
            if (
              delta.breaks.length > 0 ||
              delta.is_all_time_weight_pr ||
              delta.is_all_time_volume_pr
            ) {
              setLastPRDelta(delta);
              setLastPRExerciseName(exerciseObj.name);
            }
          } catch (e) {
            // PR detection failure is non-blocking — the toggle already
            // committed; just log and move on.
            console.warn('[PR detect on toggle] failed:', e);
          }
        }
      }
    }

    if (nextLogged === 1 && autoPopupTimer) {
      // Resolve the owning session_exercise → rest_sec / exercise name.
      // Lookup via setsInSession (just-toggled set) → session_exercise_id →
      // plan row. v019 isolation (#17): prefer the per-row session_exercise_id
      // (unique per card) over the legacy exercise_id heuristic, which
      // would pick the wrong card when two cards share an exercise_id
      // (RS A side Cable Crossover + solo Cable Crossover). Fall back to
      // exercise_id only if the row is pre-v019 untagged.
      const toggled = setsInSession.find((s) => s.id === set_id);
      const planRow = toggled
        ? (toggled.session_exercise_id
            ? plan.find((p) => p.id === toggled.session_exercise_id) ?? null
            : plan.find((p) => p.exercise_id === toggled.exercise_id) ?? null)
        : null;
      const rest_sec = planRow?.rest_sec ?? 60;
      const exercise_name = planRow?.exercise_name ? tExercise(planRow.exercise_name) : '';
      setRestTimerTarget({ rest_sec, exercise_name });
      setRestTimerTrigger((n) => n + 1);
    } else if (nextLogged === 0) {
      // Cancel timer per Q2.3 (d) Y2.
      setRestTimerTarget(null);
    }
  };

  /**
   * Atomic cluster cycle ✓ tap (ADR-0019 Q16, slice 10c Phase 7).
   *
   * Tap on a cluster cycle row's shared ✓ flips BOTH sides via the
   * atomic `markClusterCycleLogged` repo method (transaction; partial
   * state never observable). Per Q2 § (C) the rest timer is started
   * from the **cluster parent's** rest_sec (A side), not either child —
   * cluster timing is cluster-level (Q2.2 § (C) decision).
   *
   * Un-tap (currentlyLogged=true) calls the inverse and cancels the
   * timer per Q2.3 (d) Y2.
   */
  const onToggleClusterCycle = async (
    group: import('@/src/domain/session/clusterCard').ClusterGroup<
      SessionExerciseRowWithName,
      SessionSetWithExercise
    >,
    args: {
      a_set_id: string;
      b_set_id: string;
      currentlyLogged: boolean;
    },
  ) => {
    const session_id = getSessionId(sessionState);
    if (!session_id) return;
    const nextLogged = args.currentlyLogged ? 0 : 1;
    try {
      if (nextLogged === 1) {
        await markClusterCycleLogged(db, {
          a_set_id: args.a_set_id,
          b_set_id: args.b_set_id,
        });
      } else {
        await markClusterCycleUnlogged(db, {
          a_set_id: args.a_set_id,
          b_set_id: args.b_set_id,
        });
      }
      // Optimistic update — set both rows' is_logged in memory.
      setSetsInSession((curr) =>
        curr.map((s) => {
          if (s.id === args.a_set_id || s.id === args.b_set_id) {
            return { ...s, is_logged: nextLogged };
          }
          return s;
        }),
      );
      pushMirrorIfWatchLed(); // Phase C-core reverse sync (local edit → Watch)
    } catch (e) {
      console.warn('[cluster cycle ✓] failed:', e);
      return;
    }

    if (nextLogged === 1 && autoPopupTimer) {
      // Q2 § (C): cluster timer launched from PARENT's rest_sec, not
      // either child's. Falls back to 60s when NULL (system default).
      const rest_sec = group.a.exercise.rest_sec ?? 60;
      // Banner-style name: "A名 + B名"
      const exercise_name = `${tExercise(group.a.exercise.exercise_name)} + ${tExercise(group.b.exercise.exercise_name)}`;
      setRestTimerTarget({ rest_sec, exercise_name });
      setRestTimerTrigger((n) => n + 1);
    } else if (nextLogged === 0) {
      setRestTimerTarget(null);
    }
  };

  /**
   * Delete one cluster cycle row (atomic A+B set delete). Wired into the
   * cluster card's left-swipe 「刪」 gesture per the template-editor pattern.
   */
  const onDeleteClusterCycle = async (args: {
    a_set_id: string | null;
    b_set_id: string | null;
  }) => {
    const session_id = getSessionId(sessionState);
    if (!session_id) return;
    try {
      await deleteClusterCycle(db, args);
      const sets = await listSetsBySession(db, session_id);
      setSetsInSession(sets);
      pushMirrorIfWatchLed(); // Phase C-core reverse sync (local edit → Watch)
    } catch (e) {
      Alert.alert(
        t('alert', 'deleteFailed'),
        e instanceof Error ? e.message : String(e),
      );
    }
  };

  /**
   * Clone one cluster cycle row, landing the new pair DIRECTLY BELOW the
   * source cycle (overnight 第 6 點). Uses `insertSessionSetAfter` per side
   * — which slot-shifts everything `>= new_ordering` by +1, mirroring solo
   * card's right-swipe `+1` behavior (commit 0a9c1d3-style logic, lifted to
   * cluster). Mirrors source weight/reps/set_kind on the new row.
   *
   * Why two sequential insertSessionSetAfter calls (not the atomic
   * cloneClusterCycle): cloneClusterCycle uses MAX+1 per side, so the new
   * pair lands at the end of EACH side — which violates "加在該排之下".
   * Sequential insertSessionSetAfter correctly handles the cluster-interleaved
   * ordering (see tests/db/insertClusterCycleAfter.test.ts).
   */
  const onCloneClusterCycle = async (args: {
    a_set_id: string | null;
    b_set_id: string | null;
  }) => {
    const session_id = getSessionId(sessionState);
    if (!session_id) return;
    try {
      // Order matters: insert A first, then B. The second call re-reads
      // b's CURRENT ordering (post-A-insert shift), so transitive correctness
      // is preserved by the repo's per-call shift+re-read.
      if (args.a_set_id) {
        await insertSessionSetAfter(db, {
          session_id,
          source_set_id: args.a_set_id,
          uuid: randomUUID,
        });
      }
      if (args.b_set_id) {
        await insertSessionSetAfter(db, {
          session_id,
          source_set_id: args.b_set_id,
          uuid: randomUUID,
        });
      }
      const sets = await listSetsBySession(db, session_id);
      setSetsInSession(sets);
      pushMirrorIfWatchLed(); // Phase C-core reverse sync (local edit → Watch)
    } catch (e) {
      Alert.alert(
        t('alert', 'cloneFailed'),
        e instanceof Error ? e.message : String(e),
      );
    }
  };

  /**
   * Add one cluster cycle at end (atomic A+B set insert with last cycle's
   * weight/reps OR cross-session 動作記憶 fallback). Wired into the cluster
   * card's footer [新增 1 組] button per the template-editor pattern.
   */
  const onAddClusterCycle = async (
    group: import('@/src/domain/session/clusterCard').ClusterGroup<
      SessionExerciseRowWithName,
      SessionSetWithExercise
    >,
  ) => {
    const session_id = getSessionId(sessionState);
    if (!session_id) return;

    // For each side, pick defaults: last set in this session OR fallback
    // to historical 動作記憶 OR starter defaults.
    //
    // v019 isolation: filter by session_exercise_id (the cluster side)
    // not raw exercise_id, so an A-side cycle add doesn't pick up
    // weight/reps from a coincidentally-same-exercise solo card.
    const pickDefaults = async (
      exercise_id: string,
      session_exercise_id: string,
    ) => {
      const inSession = setsInSession
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
        // fall through to starter defaults
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
        session_id,
        a: {
          exercise_id: group.a.exercise.exercise_id,
          new_set_id: randomUUID(),
          weight_kg: aDefaults.weight_kg,
          reps: aDefaults.reps,
          // v019 isolation: tag each new set to its cluster card so
          // the A side doesn't collide with a coincidentally-same-exercise
          // solo card sitting elsewhere in the same session.
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
      const sets = await listSetsBySession(db, session_id);
      setSetsInSession(sets);
      pushMirrorIfWatchLed(); // Phase C-core reverse sync (local edit → Watch)
    } catch (e) {
      Alert.alert(
        t('alert', 'addCycleFailed'),
        e instanceof Error ? e.message : String(e),
      );
    }
  };

  /**
   * Persist a notes patch (from SetNoteSheet confirm). Empty / whitespace
   * are coerced to NULL upstream by the sheet so the 📝 indicator hides
   * cleanly when the user clears the field.
   */
  const onUpdateNotes = async (set_id: string, notes: string | null) => {
    const session_id = getSessionId(sessionState);
    if (!session_id) return;
    try {
      await updateSetFields(db, set_id, { notes });
      setSetsInSession((curr) =>
        curr.map((s) => (s.id === set_id ? { ...s, notes } : s)),
      );
      pushMirrorIfWatchLed(); // Phase C-core reverse sync (local edit → Watch)
    } catch (e) {
      Alert.alert(t('alert', 'saveFailed'), e instanceof Error ? e.message : String(e));
    }
  };

  /**
   * Open the ⚙️ ActionSheetIOS menu for one exercise card. Per ADR-0019 Q11
   * (post-grill revision 2026-05-16 ultra-late) the menu has 3 main paths
   * + 1 reorder utility. 「🔀 換動作」 was discarded; the "change exercise"
   * UX is unified via 🗑️ 刪除動作 → bottom-bar [+ 動作] 動作庫勾選 flow
   * (per ADR-0019 amend Q5 § (b) 修訂段). The 5th item「🔃 排序動作」 is
   * here as a secondary entry; the primary trigger is long-press on the
   * card header.
   *
   * Cancel slot is index 0 + cancelButtonIndex per iOS convention.
   *
   * Slice 10c overnight #14C — cluster context (partnerExerciseId truthy)
   * adds two history entries「📖 動作歷史 (A)」「📖 動作歷史 (B)」直接從
   * ⚙️ menu 跳到對應側 cluster-only 歷史頁，省去 footer 按「動作歷史」
   * 後再到歷史頁切換 switcher 的兩步操作。其他 menu 行為（編輯備註、
   * 休息秒數、排序）保留共用 solo logic 不分離，等正解 redesign。
   *
   * Slice 10c overnight #18 — cluster context (partnerSessionExerciseId also
   * truthy) makes 🗑️ 刪除動作 cascade-delete BOTH sides of the cluster
   * (A + B session_exercise rows + every set on either side). Without
   * this, deleting one side left the other as an orphan card (B's
   * parent_id still pointed at the deleted A row). Solo path unchanged.
   */
  const onSettingsPress = (
    planRow: SessionExerciseRowWithName,
    options?: { partnerExerciseId?: string; partnerSessionExerciseId?: string },
  ) => {
    const partnerExerciseId = options?.partnerExerciseId;
    const partnerSessionExerciseId = options?.partnerSessionExerciseId;
    const isCluster = !!partnerExerciseId && !!partnerSessionExerciseId;
    // Localized labels — extracted as locals so the dispatch `===` comparison
    // below references the same string the menu was built with.
    const labelCancel = t('common', 'cancel');
    const labelEditNote = t('button', 'clusterEditNote');
    const labelRestSeconds = t('button', 'clusterRestSeconds');
    const labelHistoryA = t('button', 'clusterHistoryA');
    const labelHistoryB = t('button', 'clusterHistoryB');
    const labelDeleteExercise = t('button', 'clusterDeleteExercise');
    const labelReorder = t('button', 'clusterReorderExercises');
    // Build options array. Cluster context inserts two history items
    // before 🔃 排序動作 so the destructive 🗑️ 刪除動作 keeps its
    // visual separation. Indices below are derived from this array.
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
          // Open keypad pre-filled with current rest_sec (default 60).
          setRestSecTarget({
            session_exercise_id: planRow.id,
            current: planRow.rest_sec ?? 60,
            exercise_name: planRow.exercise_name,
          });
        } else if (label === labelHistoryA) {
          // cluster A side history — mirror cluster card footer entry
          // (overnight #11) so user can reach A-side cluster_only history
          // from the ⚙️ menu without going through footer + switcher.
          //
          // Slice 10c overnight #21 — pass current session_exercise ids for
          // BOTH sides so the「再次訓練」button on the destination history
          // page can overwrite the current cluster pair's sets. Order: the
          // page's primary side is A → currentSeIdA = this card's se.id;
          // partner B → currentSeIdB = partner's se.id.
          router.push(
            `/exercise-history/${planRow.exercise_id}?clusterMode=cluster_only&partner=${partnerExerciseId}&side=A&currentSeIdA=${planRow.id}&currentSeIdB=${partnerSessionExerciseId}`,
          );
        } else if (label === labelHistoryB) {
          // cluster B side history — direct entry skips the manual swap
          // step on the destination's A↔B switcher. partner inverted so
          // the switcher arrow points back to A.
          //
          // Slice 10c overnight #21 — currentSeIdA/B reflect the OWNER per
          // the swapped perspective: from B's side, the「A」of the cluster
          // pair in user terms is THIS card (planRow), and partner is the
          // other one. The replay helper takes A/B by position not by
          // letter, so we invert to match the side=B viewing.
          router.push(
            `/exercise-history/${partnerExerciseId}?clusterMode=cluster_only&partner=${planRow.exercise_id}&side=B&currentSeIdA=${partnerSessionExerciseId}&currentSeIdB=${planRow.id}`,
          );
        } else if (label === labelReorder) {
          setReorderSheetOpen(true);
        } else if (label === labelDeleteExercise) {
          // Slice 10c overnight #18 — cluster context cascade-deletes BOTH
          // sides (A + B session_exercise rows + every set on either side).
          // 「刪超級組」= 拆掉整個 cluster, otherwise the B side becomes an
          // orphan card (parent_id pointing at a deleted row). Solo path
          // unchanged from #17 — single-card scoped delete.
          if (isCluster && partnerSessionExerciseId) {
            // v019 isolation: count sets across BOTH cards by
            // session_exercise_id ∈ {A.id, B.id}. Legacy fallback (untagged
            // pre-v019 rows) is intentionally NOT applied here — cluster
            // pairs were always created post-v019 so any row in this branch
            // has session_exercise_id set.
            const partnerPlan = plan.find(
              (p) => p.id === partnerSessionExerciseId,
            );
            const partnerName = partnerPlan?.exercise_name
              ? tExercise(partnerPlan.exercise_name)
              : t('common', 'unknownExercise');
            const setsForCluster = setsInSession.filter(
              (s) =>
                s.session_exercise_id === planRow.id ||
                s.session_exercise_id === partnerSessionExerciseId,
            );
            const warningSuffix = computeDeleteWarningSuffix(setsForCluster, {
              withLogged: tWarningTotalSetsWithLogged,
              unfinished: tWarningTotalSetsUnfinished,
            });
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
                    const session_id = getSessionId(sessionState);
                    if (!session_id) return;
                    // sessionRepository's deleteSessionExerciseAndSets is
                    // not transactional, so we await sequentially. Partial-
                    // failure handling: if the SECOND delete throws, the
                    // first is already committed — refresh() in the catch
                    // arm so UI reflects the actual half-state instead of
                    // a stale full-cluster card. User can re-tap delete on
                    // the remaining orphan to finish the job.
                    try {
                      await deleteSessionExerciseAndSets(db, {
                        session_id,
                        exercise_id: planRow.exercise_id,
                        session_exercise_id: planRow.id,
                      });
                      await deleteSessionExerciseAndSets(db, {
                        session_id,
                        exercise_id:
                          partnerPlan?.exercise_id ?? '',
                        session_exercise_id: partnerSessionExerciseId,
                      });
                      await refresh();
                    } catch (e) {
                      Alert.alert(
                        t('alert', 'deleteFailed'),
                        e instanceof Error ? e.message : String(e),
                      );
                      await refresh();
                    }
                  },
                },
              ],
            );
            return;
          }
          // Solo path — single-card cascade (unchanged from #17).
          // v019 isolation: count sets on THIS card only (not all cards
          // that happen to share the same exercise_id). Falls back to
          // legacy exercise_id matching for any pre-v019 untagged rows.
          const setsForExercise = setsInSession.filter(
            (s) =>
              s.session_exercise_id === planRow.id ||
              (s.session_exercise_id == null &&
                s.exercise_id === planRow.exercise_id),
          );
          const warningSuffix = computeDeleteWarningSuffix(setsForExercise, {
            withLogged: tWarningPerExerciseSetsWithLogged,
            unfinished: tWarningPerExerciseSetsUnfinished,
          });
          Alert.alert(
            t('alert', 'deleteExerciseQ'),
            tRemoveExerciseFromSessionPrompt(tExercise(planRow.exercise_name), warningSuffix),
            [
              { text: t('common', 'cancel'), style: 'cancel' },
              {
                text: t('common', 'delete'),
                style: 'destructive',
                onPress: async () => {
                  const session_id = getSessionId(sessionState);
                  if (!session_id) return;
                  try {
                    await deleteSessionExerciseAndSets(db, {
                      session_id,
                      exercise_id: planRow.exercise_id,
                      session_exercise_id: planRow.id,
                    });
                    await refresh();
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
  };

  /**
   * 投影 Watch — push the active session to the paired Watch via the
   * `cast-session` envelope (`pushCastToWatch`). Unlike the old path (which
   * sent a D6 `start-from-iphone` with an EMPTY `{}` snapshot to a Watch that
   * had no consumer — "跳已送出 但手錶無反應"), this fetches the FULL session
   * snapshot and dual-fires it: an instant `sendMessage` when the Watch is
   * reachable (the Watch navigates into the session NOW + acks → synced) PLUS a
   * durable TUI backstop that lands on the Watch's next wake (iOS cannot
   * force-launch the Watch app). Fire-and-forget — never blocks the UI; a toast
   * reports synced / queued / failed.
   */
  const handleCastToWatch = useCallback(() => {
    if (sessionState.status !== 'in_progress') return;
    const session_id = sessionState.id;
    // ADR-0028 — iPhone becomes the edit-token holder (発起方初握) and seeds the
    // Watch's epoch via the cast payload; the Watch goes LOCKED on receipt.
    const epoch = editLockRef.current.castInitiated();
    void (async () => {
      const res = await pushCastToWatch(db, session_id, { epoch });
      if (res.acked) {
        toastRef.current?.show(t('status', 'castToWatchOk'), { icon: 'success' });
      } else if (res.queued) {
        toastRef.current?.show(t('status', 'castToWatchQueued'), { icon: 'info' });
      } else {
        // NO_SNAPSHOT — should not happen for an in-progress session (the row
        // vanished). Report honestly rather than a false "已送出".
        toastRef.current?.show(t('status', 'castToWatchFailed'), { icon: 'error' });
      }
      // 2026-06-28 — pushCastToWatch flips `is_watch_tracked` true in the DB (the
      // Watch is now the HR/kcal source), but the React `sessionState` snapshot is
      // stale until something refreshes it. Without this the 5-tile ❤️/🔥 panel
      // only appeared once the Watch pushed its first mirror (i.e. after 解除鎖定).
      // Refresh now so casting alone surfaces the HR/kcal tiles immediately.
      refreshRef.current?.();
    })();
  }, [db, sessionState]);

  /**
   * Header [⋯] menu (ADR-0019 Q15). Items:
   *   1. 儲存模板 — overwrite linked template (convertSessionToTemplate update)
   *   2. 另存模板 — open TemplateMetaSheet (convertSessionToTemplate create)
   *   3. 投影 Watch — cast active session to paired Watch (cast-session envelope)
   *   4. Body data — open body-data editor sheet (slice 10c overnight #4 第 3 點)
   *   5. 🚫 放棄訓練 — destructive, CASCADE delete the active session
   * Cancel is index 0.
   */
  const onHeaderMenuPress = () => {
    // Bug F4 — blur the title editor FIRST so any pending edit commits to
    // the DB before the ActionSheet steals focus. No-op when not in edit
    // mode. See `components/session/session-title-editor.tsx` for the
    // exposed `blur()` handle.
    editorRef.current?.blur();
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: [
          t('common', 'cancel'),
          t('button', 'saveTemplate'),
          t('button', 'saveAsTemplate'),
          t('button', 'castToWatch'),
          t('button', 'bodyData'),
          t('button', 'discardSession'),
        ],
        cancelButtonIndex: 0,
        destructiveButtonIndex: 5,
      },
      (idx) => {
        if (idx === 1) {
          void handleSaveTemplate('update');
          return;
        }
        if (idx === 2) {
          void handleSaveTemplate('create');
          return;
        }
        if (idx === 3) {
          handleCastToWatch();
          return;
        }
        if (idx === 4) {
          setBodySheetVisible(true);
          return;
        }
        if (idx !== 5) return;
        Alert.alert(
          t('alert', 'discardSessionQ'),
          t('alert', 'cannotUndoLong'),
          [
            { text: t('common', 'cancel'), style: 'cancel' },
            {
              text: t('button', 'discardSimple'),
              style: 'destructive',
              onPress: async () => {
                const session_id = getSessionId(sessionState);
                if (!session_id) return;
                // Phase C-core (2026-06-26) — tell the paired Watch to end its
                // session too. Discard = an end for the Watch's teardown, so
                // reuse the end-session envelope (the Watch's handler runs
                // SessionController.end → discardWorkout). Watch-led only;
                // fire-and-forget (never blocks discard UX); fired BEFORE the
                // local delete so the sessionId is unambiguous. Mirrors the
                // finalize path's pushEndToWatch (finish already syncs).
                if (
                  sessionState.status === 'in_progress' &&
                  sessionState.is_watch_tracked
                ) {
                  void pushEndToWatch(db, session_id);
                }
                try {
                  await discardSession(db, session_id);
                  setSessionState(IDLE);
                  setSetsInSession([]);
                  setPlan([]);
                  setBwSnapshotKg(null);
                  setSessionTitle('');
                  setLastPRDelta(null);
                  setLastPRExerciseName('');
                  setPrSnapshotById({});
                } catch (e) {
                  Alert.alert(
                    'Discard failed',
                    e instanceof Error ? e.message : String(e),
                  );
                }
              },
            },
          ],
        );
      },
    );
  };

  /**
   * Finalise the session and route forward.
   *
   * 2026-05-18 UX 改: 移除原本完成訓練後的「結束訓練？」alert
   * (template-based 3-option / freestyle 2-option)。改為直接 endSession +
   * 跳轉 `/session/{id}` 詳情頁。模板操作 (儲存模板 / 另存模板) 統一從
   * 詳情頁的 sticky action bar 走，避免兩個入口 redundant。
   *
   * 詳情頁的「儲存模板」按鈕對 freestyle session (template_id IS NULL) 會
   * dim + disabled，因為沒有 linked template 可 overwrite；freestyle 想升級
   * 成模板的話走「另存模板」(create-mode) bottom sheet。
   *
   * 行為保留：ALWAYS endSession + 跑 achievement eval — 只移 alert，路由 +
   * side effects (PR delta cleanup / sessionState end) 全部維持。
   */
  const finalizeEndAndRoute = async (
    session_id: string,
    opts?: {
      endedAt?: number;
      snapshot?: unknown;
      /** Watch-led inbound (end-session listener)。duplicate delivery
       *  （dual-fire 第二發 / TUI 晚到）在 already-ended 閘門不准再
       *  router.push（2026-06-11 fix — 完成頁跳兩次）。 */
      fromWatchInbound?: boolean;
    },
  ) => {
    // 2026-06-11 — dual-fire 同時抵達擋板（見 endInFlightRef 宣告處）。
    // 重疊的第二發直接 return：第一發會完成 finalize + 路由。
    if (endInFlightRef.current.has(session_id)) return;
    endInFlightRef.current.add(session_id);
    try {
      await finalizeEndAndRouteInner(session_id, opts);
    } finally {
      endInFlightRef.current.delete(session_id);
    }
  };

  const finalizeEndAndRouteInner = async (
    session_id: string,
    opts?: {
      endedAt?: number;
      snapshot?: unknown;
      fromWatchInbound?: boolean;
    },
  ) => {
    // Slice 13d D7 — idempotent gate (ADR-0019 § Q23 + NEW-Q45).
    //
    // Two paths can call this:
    //   1. iPhone-led: user taps 結束訓練 on iPhone → onEndSession → here
    //   2. Watch-led: Watch sends `end-session` WC msg → useEffect listener
    //      (below, mounted via `addMessageListener`) → here
    //
    // If both fire (theoretical race — user taps iPhone End the same instant
    // Watch sends end-session), the second invocation must NOT re-run
    // achievement eval (duplicate unlock toasts) / HK sync (duplicate HKWorkout
    // entry) / router.push (double navigation). Gate is DB read: if session
    // already has ended_at, just route to detail and skip everything else.
    //
    // The endSession SQLite call itself is unconditional UPDATE — not gated.
    // Gating at this finalize layer means BOTH start paths (iPhone-led button
    // tap + Watch-led inbound) share one idempotent contract.
    const existing = await getSession(db, session_id);
    if (!existing) {
      // Defensive: Watch-led inbound for a session iPhone has no row
      // for (e.g. future D8+ Watch-led start path before iPhone's
      // handshake has imported the session row). Silent no-op —
      // don't router.push to a non-existent detail page.
      return;
    }
    if (existing.ended_at != null) {
      // Already finalized (iPhone-led path beat us, or duplicate
      // Watch msg). 2026-06-11 fix：Watch-led duplicate（dual-fire
      // 第二發 / TUI 晚到）絕不再 router.push — E1 雙發後這裡每場
      // Watch 完成都會疊出第二張完成頁。只有 iPhone-led（user 真的
      // 按了結束按鈕）才補跳頁、skip side effects。
      if (!opts?.fromWatchInbound) {
        router.push(`/session/${session_id}`);
      }
      return;
    }

    // Q4 (E1): a Watch-led end carries the authoritative finish time on
    // its envelope — use it so a delayed transferUserInfo delivery (iPhone
    // was unreachable at end) still records the TRUE ended_at + the correct
    // HK [started_at, ended_at] kcal/HR window. iPhone-led passes no opts
    // → falls back to receive-time Date.now() (unchanged behaviour).
    //
    // Grill 2026-06-05 Q5 — clamp the finish time forward. The Watch's
    // clock-stamped endedAt can be ≤ started_at under clock skew, which would
    // persist a backwards interval (and an inverted HK kcal/HR window). Trust
    // the stamp only when it's a real forward time; otherwise fall back to
    // receive-time (now), and as a last resort started_at + 1ms (covers the
    // pathological case where started_at itself is in the future).
    const rawEnd = opts?.endedAt ?? Date.now();
    const ended_at =
      rawEnd > existing.started_at
        ? rawEnd
        : Math.max(Date.now(), existing.started_at + 1);

    // Q1/Q2/Q3 (E2): reconcile-by-membership against the Watch's final
    // snapshot — purge the rows the Watch deleted mid-session that the
    // non-purging live mirror left behind — BEFORE achievement eval + HK
    // sync read the tree. Runs ONLY here inside the first-delivery gate
    // (Q4 derived): a late dual-fire / TUI redelivery is gated out above
    // (ended_at != null), so it can never re-purge over a later
    // history-page edit (Round G). `reconcileEndSnapshot` never throws and
    // self-guards a malformed / suspiciously-empty snapshot (drops to
    // finalize-only rather than wiping real data). iPhone-led has no
    // snapshot → skipped entirely.
    if (opts?.snapshot !== undefined) {
      await reconcileEndSnapshot(db, session_id, opts.snapshot);
    }

    await endSession(db, { id: session_id, ended_at });
    try {
      await evaluateAndPersistAchievements(db, {
        ended_session_id: session_id,
        unlocked_at: ended_at,
      });
    } catch (e) {
      console.warn('[achievements] evaluate failed:', e);
    }
    // Slice 13c C3 — HealthKit sync. Extracted to `syncSessionWithHealthKit`
    // service module (slice 13c "tests" pass) so the best-effort contract is
    // jest-tested instead of relying only on iPhone smoke. Caller resolves the
    // i18n placeholder up-front because `t` is a React hook and can't be used
    // inside the pure service module.
    await syncSessionWithHealthKit(db, session_id, {
      fallbackTitle: t('page', 'sessionTitlePlaceholder'),
    });
    setLastPRDelta(null);
    setLastPRExerciseName('');
    endState(sessionState, ended_at);
    router.push(`/session/${session_id}`);

    // Slice 13d D7-TS — fire-and-forget WC push to Watch + 5s reconcile.
    //
    // Per Q23 / NEW-Q45 / channel #11: iPhone-led finalize → push
    // `end-session` envelope so paired Watch can teardown its in-memory
    // mirror + run SessionController.end() (which calls discardWorkout per
    // Q28 Branch C trigger-only sampling — no HKWorkout entry from Watch).
    //
    // `pushEndToWatch` awaits sendMessage with 5000ms timeout and reconciles
    // `is_watch_tracked` to false if Watch never acks; flag stays true on ack.
    // Never throws — fire-and-forget at the call site. UI has already routed.
    //
    // Slice 15 C3 — session-finalize backup trigger, chained AFTER the watch
    // reconcile settles (ADR-0011 2026-06-12 grill Q7-B ordering guarantee:
    // HK sync was awaited above; pushEndToWatch resolves only after the
    // Watch acked or the 5s timeout reconciled). `runBackup` never throws
    // and self-gates (mode/debounce), so the whole chain stays
    // fire-and-forget — finalize UX is never blocked on backup.
    void pushEndToWatch(db, session_id).then(() => {
      void runBackup(db, 'session-finalize');
    });
  };

  // Slice 13d D7-TS — keep ref pointed at the latest finalize closure
  // so the Watch-led end-session listener (mounted with empty deps,
  // see useEffect at ~line 419) always invokes the freshest sessionState
  // capture. Assigning to ref.current during render is the official
  // React pattern (https://react.dev/learn/referencing-values-with-refs).
  finalizeEndAndRouteRef.current = finalizeEndAndRoute;

  const onEndSession = async () => {
    const session_id = getSessionId(sessionState);
    if (!session_id) return;
    // ADR-0028 — 結束訓練收進編輯鎖：只有 holder 能結束。鎖定方須先解鎖（解鎖會
    // 先拉到對方最終狀態），故結束前一定拿到最終資料。蓋層已擋住此按鈕，這是防禦。
    if (!editLockRef.current.canEdit) {
      toastRef.current?.show(t('status', 'lockEditingOnWatch'), { icon: 'info' });
      return;
    }

    setBusy(true);
    try {
      // 2026-05-18: 直接結束 + 跳詳情頁，不再彈「結束訓練？」alert。
      // 模板操作（儲存模板 / 另存模板）統一從詳情頁 sticky action bar 走。
      await finalizeEndAndRoute(session_id);
    } catch (e) {
      Alert.alert(
        t('alert', 'endSessionFailed'),
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setBusy(false);
    }
  };

  const todayTemplate = programCellToday?.template_id
    ? templatesById[programCellToday.template_id] ?? null
    : null;
  // 5/19 polish #43 — banner branches on session status. In-progress sessions
  // mirror the session's linked template (or「空白訓練」for freestyle);
  // idle / ended fall through to the existing active-program banner.
  let programBanner: ReactNode = null;
  if (sessionState.status === 'in_progress') {
    if (sessionTemplateInfo) {
      // 2026-06-26 翻盤 — 第2行(banner) = 不可改的「模板名·計劃·強度」身份標
      // (使用者拍板：模板名固定取自模板，刻意與第1行可改標題並列)。原 #6
      // (2026-05-30) 為避免與標題重複而拿掉模板名行；現使用者要求加回，故
      // 改用 formatSessionSubtitle 前綴模板名。subtitle 永遠 truthy(至少有
      // 模板名)；ADR-0026 極簡模式仍整段藏掉(純計劃概念)。
      const subtitle = formatSessionSubtitle(
        sessionTemplateInfo.template_name,
        sessionTemplateInfo.program_name,
        sessionTemplateInfo.sub_tag,
      );
      programBanner =
        subtitle && !isMinimal ? (
          <View style={styles.programBanner}>
            <Text style={styles.programBannerCell}>{subtitle}</Text>
          </View>
        ) : null;
    } else {
      // 空白訓練 marker 非計劃概念，極簡模式保留。
      programBanner = (
        <View style={styles.programBanner}>
          <Text style={styles.programBannerName} numberOfLines={1}>
            {t('domain', 'freestyle')}
          </Text>
        </View>
      );
    }
  } else if (activeProgram && !isMinimal) {
    programBanner = (
      <View style={styles.programBanner}>
        <Text style={styles.programBannerName} numberOfLines={1}>
          {resolveProgramLabel(activeProgram.program)}
          {activeProgram.program.main_tag ? ` · ${activeProgram.program.main_tag}` : ''}
        </Text>
        {programCellToday ? (
          <Text style={styles.programBannerCell}>
            {t('status', 'todayPrefix')}
            {todayTemplate ? todayTemplate.name : t('domain', 'restDay')}
            {programCellToday.sub_tag ? ` · ${programCellToday.sub_tag}` : ''}
          </Text>
        ) : (
          <Text style={styles.programBannerCell}>{t('status', 'todayOutsideProgram')}</Text>
        )}
      </View>
    );
  }

  if (sessionState.status === 'idle') {
    // ADR-0024 § 2 三區塊：計劃訓練 / 空白訓練 / 模板訓練
    const todayPlan: TodayPlan = resolveTodayPlan({
      active: activeProgram,
      today: localMsToIsoDate(Date.now()),
      templatesById,
    });
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScrollView
          contentContainerStyle={styles.idleScroll}
          keyboardShouldPersistTaps="handled">
          <View style={styles.helpHeaderRow}>
            <Text style={styles.heading}>{t('tabs', 'training')}</Text>
            <HelpButton onPress={help.open} />
          </View>
          {/* Slice 15 C5 — backup failure escalation banner (Q14-B in-app
              only). Self-contained: renders null until the 3/7-day streak
              threshold, idle home screen only (in-session UI stays clean). */}
          <BackupFailureBanner />
          {/*
            2026-05-29 polish: programBanner removed from idle scroll
            (above 計劃訓練). Rationale per user: visually redundant —
            計劃訓練 section already implies "today's plan from your
            active program" so the banner doubles up. programBanner
            is still mounted in the in-progress branch (line ~2380)
            where it surfaces the linked template / freestyle marker.
          */}

          {/* (a) 計劃訓練 — ADR-0024 § 2.a
              ADR-0026 極簡模式：整個「計劃訓練」section（今日計劃 / 休息日 /
              無計劃 CTA）= 純計劃概念 → 整段藏掉。 */}
          {!isMinimal && (
            <View ref={planTarget.ref} style={styles.section}>
              <Text style={styles.sectionHeading}>
                {t('page', 'plannedTraining')}
              </Text>
              {todayPlan.kind === 'no-program' && (
                <View style={styles.emptyBox}>
                  <Text style={styles.emptyTextBlock}>
                    {t('status', 'noActiveProgram')}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('button', 'gotoPrograms')}
                    onPress={() => router.push('/programs')}
                    style={({ pressed }) => [
                      styles.secondaryBtn,
                      pressed && styles.btnPressed,
                    ]}>
                    <Text style={styles.secondaryBtnText}>
                      {t('button', 'createOrActivateProgram')}
                    </Text>
                  </Pressable>
                </View>
              )}
              {todayPlan.kind === 'rest' && (
                <View style={styles.restRow}>
                  <Text style={styles.restRowText}>
                    {t('status', 'todayRest')}
                  </Text>
                </View>
              )}
              {todayPlan.kind === 'template' && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={tA11yStartPlanned(todayPlan.template.name)}
                  onPress={() =>
                    onStartPlanned(
                      todayPlan.template.id,
                      activeProgram?.program.id ?? null,
                      todayPlan.cell.sub_tag,
                    )
                  }
                  disabled={busy}
                  style={({ pressed }) => [
                    styles.plannedRow,
                    busy && styles.btnDisabled,
                    pressed && styles.btnPressed,
                  ]}>
                  <Text style={styles.plannedRowName}>
                    {todayPlan.template.name}
                  </Text>
                  <Text style={styles.plannedRowDetails}>
                    {tExerciseCount(todayPlan.template.exerciseCount)}
                    {todayPlan.cell.sub_tag ? ` · ${todayPlan.cell.sub_tag}` : ''}
                  </Text>
                </Pressable>
              )}
            </View>
          )}

          {/* (b) 模板訓練 — ADR-0024 § 2.c (renumbered)
              2026-05-29 polish: reordered ABOVE 空白訓練. Rationale:
              user reqs brightness 計劃>模板>空白 + 空白 should be
              last (lowest-effort fallback when no plan/template
              applies today). Section component stays a pure list.
            Tap a row → load picker data + open StartTemplateSheet. The sheet
            owns the (program, sub_tag) pick + lookup-or-spawn before either
            editing or starting a session. Wired here rather than inside
            TemplateListSection so the section component stays a pure list
            (its `onPickTemplate` contract unchanged for reuse).
          */}
          <View ref={templateTarget.ref}>
            <TemplateListSection
              heading={t('page', 'templateTraining')}
              onPickTemplate={onPickTemplate}
            />
          </View>

          {/* (c) 空白訓練 — ADR-0024 § 2.b (renumbered, moved to bottom)
              2026-05-29 polish: lowest prominence per user — use
              styles.freestyleBtn (ghost / secondary) instead of the
              old styles.startBtn (filled primary CTA). 計劃 takes
              the filled-primary spot now. */}
          <View ref={blankTarget.ref} style={styles.section}>
            <Text style={styles.sectionHeading}>
              {t('page', 'freestyleTraining')}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('button', 'startFreestyle')}
              onPress={onStartFreestyle}
              disabled={busy}
              style={({ pressed }) => [
                styles.freestyleBtn,
                busy && styles.btnDisabled,
                pressed && styles.btnPressed,
              ]}>
              <Text style={styles.freestyleBtnText}>
                {busy ? t('button', 'starting') : t('button', 'startFreestyle')}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
        <StartTemplateSheet
          visible={sheetTemplate != null}
          templateName={sheetTemplate?.name ?? ''}
          programs={sheetPrograms}
          lastUsedProgramId={sheetLastProgramId}
          lastUsedSubTag={sheetLastSubTag}
          onEdit={onSheetEdit}
          onStart={onSheetStart}
          onCancel={closeSheet}
        />
        <PageHelpHost help={help} />
      </SafeAreaView>
    );
  }

  // sessionState.status === 'in_progress' (ended is unreachable: we navigate away)

  // point2 live-sync (2026-06-12) — project the latest Watch hr/kcal
  // ticks onto THIS session. Cross-session (or absent) ticks render as
  // null → the panel's '—' fallback, so a stale tick from a just-ended
  // session can never paint onto a new session's tiles.
  const liveTicks = liveTicksForSession(
    watchLiveTicks,
    getSessionId(sessionState),
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}>
        <View style={styles.sessionHeader}>
          {/* Card 11 / ADR-0014 — in-session header session.title tap-to-edit.
              Falls back to the static training tab title when no session is
              active (defense-in-depth: this branch is gated by in_progress,
              but getSessionId can still return null in a transient state). */}
          {(() => {
            const session_id = getSessionId(sessionState);
            if (!session_id) {
              return (
                <Text style={styles.heading}>{t('tabs', 'training')}</Text>
              );
            }
            return (
              <SessionTitleEditor
                ref={editorRef}
                sessionId={session_id}
                initialTitle={sessionTitle}
                placeholder={t('page', 'sessionTitlePlaceholder')}
                onUpdated={(tt) => {
                  setSessionTitle(tt);
                  pushMirrorIfWatchLed(); // Phase C-core reverse sync (title → Watch)
                }}
              />
            );
          })()}
          <View style={styles.sessionHeaderActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('button', 'a11ySessionMenu')}
              onPress={onHeaderMenuPress}
              hitSlop={8}
              style={({ pressed }) => [
                styles.headerIconBtn,
                pressed && styles.btnPressed,
              ]}>
              <Text style={styles.headerIconBtnText}>⋯</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={onEndSession}
              disabled={busy}
              style={({ pressed }) => [
                styles.headerDoneBtn,
                busy && styles.btnDisabled,
                pressed && styles.btnPressed,
              ]}>
              <Text style={styles.headerDoneBtnText}>
                {busy ? t('status', 'ending') : t('common', 'done')}
              </Text>
            </Pressable>
          </View>
        </View>
        <NestableScrollContainer
          contentContainerStyle={styles.scrollBody}
          keyboardShouldPersistTaps="handled"
        >
          {programBanner}
          {/* ADR-0019 Q6 — in-session stats panel (P1 position).
              Slice 13d D5 (ADR-0019 § Q19): the 5-tile Watch variant fires
              when the active session's `is_watch_tracked` flag (v024 column,
              surfaced into SessionState by `fromRow`) is true — i.e. the
              session is being driven from the paired Apple Watch. Falls
              back to the legacy 3-tile layout otherwise.
              point2 live-sync (2026-06-12): ❤️/🔥 now stream from the
              Watch via hr-tick / kcal-tick (3-5s throttle) — `liveTicks`
              is the session-gated projection computed above; '—' until
              the first tick lands (HR's first HK sample can take
              10-60s). avgHr carries the LATEST bpm (matches the Watch's
              own HRFrozenPane semantics), kcal is cumulative active
              energy since session start. */}
          {sessionState.status === 'in_progress' ? (
            <SessionStatsPanel
              variant={sessionState.is_watch_tracked ? '5tile-watch' : '3tile'}
              kcal={liveTicks.kcal}
              avgHr={liveTicks.bpm}
              sets={setsInSession.map((s) => ({
                set_kind: s.set_kind,
                is_logged: s.is_logged,
                reps: s.reps,
                weight_kg: s.weight_kg,
              }))}
              exercise_count={countPerformedExercises(setsInSession)}
              started_at_ms={sessionState.started_at}
            />
          ) : null}

          {/*
            Body data inline panel moved to header ⋯ menu → BodyDataSheet
            (slice 10c overnight #4 第 3 點). Snapshot badge lives inside
            the sheet now — no more inline footprint on the Today screen.
          */}

          {/*
            Empty-state placeholder — session 已開但 plan.length === 0
            (freestyle start without template, or all exercises deleted via
            ⚙️ 🗑️). Guides the user to the bottom-bar [+ 動作] flow.
            Slice 10c overnight 第 3 點 — empty-state placeholder.
          */}
          {plan.length === 0 && (
            <View style={styles.emptyPlanBlock}>
              <Text style={styles.emptyPlanTitle}>{t('status', 'noExercisesAdded')}</Text>
              <Text style={styles.emptyPlanBody}>
                {t('status', 'emptyPlanBody')}
              </Text>
            </View>
          )}

          {plan.length > 0 && (
            <>
              <View style={styles.planList}>
                {(() => {
                  // ADR-0019 Q16 (slice 10c Phase 7): cluster session_exercise
                  // rows (linked via parent_id v014 schema) render as a single
                  // ClusterCard. Follower rows are skipped — the parent owns the
                  // render. Solo rows pass through unchanged.
                  const clusterGroups = groupClusterSides(plan, setsInSession);
                  // Set of session_exercise ids whose render is owned by a
                  // cluster (both parent A and follower B).
                  const clusterMemberIds = new Set<string>();
                  for (const g of clusterGroups) {
                    clusterMemberIds.add(g.a.exercise.id);
                    clusterMemberIds.add(g.b.exercise.id);
                  }
                  // Pre-index cluster groups by parent row id for quick lookup
                  // during the plan iteration.
                  const clusterByParentId = new Map(
                    clusterGroups.map((g) => [g.a.exercise.id, g] as const),
                  );

                  const out: React.ReactNode[] = [];
                  for (const p of plan) {
                    // Cluster follower → skip (parent owns the render)
                    if (
                      p.parent_id !== null &&
                      clusterMemberIds.has(p.id)
                    ) {
                      continue;
                    }

                    // Cluster parent → render ClusterCard
                    const group = clusterByParentId.get(p.id);
                    if (group) {
                      const isExpanded = expandedExerciseId === p.id;
                      out.push(
                        <ClusterCard
                          key={p.id}
                          group={group}
                          unit={unit}
                          isExpanded={isExpanded}
                          onToggleExpand={() =>
                            setExpandedExerciseId(isExpanded ? null : p.id)
                          }
                          onToggleCycleLogged={(args) =>
                            onToggleClusterCycle(group, args)
                          }
                          onAddCycle={() => onAddClusterCycle(group)}
                          onDeleteCycle={onDeleteClusterCycle}
                          onCloneCycle={onCloneClusterCycle}
                          onShowCycleNote={(parent_set_id) => {
                            const parent = setsInSession.find(
                              (s) => s.id === parent_set_id,
                            );
                            setNoteSheetTarget({
                              set_id: parent_set_id,
                              initial: parent?.notes ?? null,
                            });
                          }}
                          onOpenHistory={() =>
                            // Cluster card → default to cluster_only view so the
                            // user lands on the pair's shared history (overnight
                            // #8 spec — replaces deprecated /superset-history).
                            // Slice 10c overnight #11 — carry `partner=B.id` so
                            // the destination renders the A↔B switcher.
                            //
                            // Slice 10c overnight #21 — currentSeIdA/B carry
                            // the cluster pair's session_exercise ids so the
                            //「再次訓練」button on the destination history page
                            // can overwrite the current cluster pair's sets
                            // (both A and B together).
                            router.push(
                              `/exercise-history/${group.a.exercise.exercise_id}?clusterMode=cluster_only&partner=${group.b.exercise.exercise_id}&side=A&currentSeIdA=${group.a.exercise.id}&currentSeIdB=${group.b.exercise.id}`,
                            )
                          }
                          onSettingsPress={() =>
                            // Slice 10c overnight #14C — pass partner B's
                            // exercise_id so the ⚙️ menu can render the
                            // dual「動作歷史 (A)」「動作歷史 (B)」entries
                            // that jump straight to the matching side's
                            // cluster_only history page.
                            //
                            // Slice 10c overnight #18 — also pass partner B's
                            // session_exercise.id so 🗑️ 刪除動作 in cluster
                            // context can cascade-delete BOTH sides (A + B
                            // session_exercise rows + all their sets) rather
                            // than half-tearing the RS (B-side orphan).
                            onSettingsPress(p, {
                              partnerExerciseId:
                                group.b.exercise.exercise_id,
                              partnerSessionExerciseId: group.b.exercise.id,
                            })
                          }
                          onUpdateClusterSet={(set_id, patch) =>
                            onUpdateSet(set_id, patch)
                          }
                          onTapClusterNumber={(set_id, field, current) =>
                            setKeypadTarget({ set_id, field, current })
                          }
                          onCycleClusterSetKind={(set_id) => {
                            // Mirror solo path: route through onCycleSetKind
                            // with the set's owning exercise_id. is_in_cluster=true
                            // → cycle 跳過 dropset (overnight #7 第 2 點).
                            const s = setsInSession.find(
                              (x) => x.id === set_id,
                            );
                            if (s) onCycleSetKind(s.exercise_id, set_id, true);
                          }}
                          onCycleClusterCycleSetKind={async (args) => {
                            // Shared `#` button — fire both sides in lockstep
                            // (overnight 第 3 點). Per ADR-0019 Q5 amend,
                            // A and B should share set_kind state at the
                            // cycle granularity since the shared button is
                            // the only entry point exposed in UI.
                            // is_in_cluster=true → cycle 跳過 dropset，A 跟 B
                            // 都只 W ↔ Wm 兩態 (overnight #7 第 2 點).
                            const a = args.a_set_id
                              ? setsInSession.find(
                                  (x) => x.id === args.a_set_id,
                                )
                              : null;
                            const b = args.b_set_id
                              ? setsInSession.find(
                                  (x) => x.id === args.b_set_id,
                                )
                              : null;
                            if (a) await onCycleSetKind(a.exercise_id, a.id, true);
                            if (b) await onCycleSetKind(b.exercise_id, b.id, true);
                          }}
                          onShowClusterSetNote={(set_id, current) =>
                            setNoteSheetTarget({
                              set_id,
                              initial: current,
                            })
                          }
                          onConfirmReorderCycles={async (newOrder) => {
                            // 第 5 點 — inline drag reorder for cluster cycles.
                            // One drag affects BOTH A and B sides in lockstep:
                            // newOrder[i] is the cycle that should land in
                            // cycle slot i, so we project per-side ordered ids
                            // and run reorderSessionSetsForExercise twice.
                            // Asymmetric short-side null slots are skipped on
                            // the empty side (the side's existing ordering for
                            // those slots stays a no-op).
                            const session_id = getSessionId(sessionState);
                            if (!session_id) return;
                            const aOrderedIds = newOrder
                              .map((c) => c.a_set?.id)
                              .filter(
                                (id): id is string =>
                                  typeof id === 'string' && id.length > 0,
                              );
                            const bOrderedIds = newOrder
                              .map((c) => c.b_set?.id)
                              .filter(
                                (id): id is string =>
                                  typeof id === 'string' && id.length > 0,
                              );
                            try {
                              if (aOrderedIds.length > 0) {
                                await reorderSessionSetsForExercise(db, {
                                  session_id,
                                  exercise_id: group.a.exercise.exercise_id,
                                  orderedIds: aOrderedIds,
                                  // v019 isolation — scope to cluster A card
                                  session_exercise_id: group.a.exercise.id,
                                });
                              }
                              if (bOrderedIds.length > 0) {
                                await reorderSessionSetsForExercise(db, {
                                  session_id,
                                  exercise_id: group.b.exercise.exercise_id,
                                  orderedIds: bOrderedIds,
                                  // v019 isolation — scope to cluster B card
                                  session_exercise_id: group.b.exercise.id,
                                });
                              }
                              await refresh();
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

                    // Solo path — existing render unchanged.
                    // v019 isolation (#17): show ONLY this card's sets so
                    // a coincidentally-same-exercise solo card doesn't
                    // mirror its rows into another card. Legacy untagged
                    // rows fall back to exercise_id match.
                    const setsForExercise = setsInSession.filter(
                      (s) =>
                        s.session_exercise_id === p.id ||
                        (s.session_exercise_id == null &&
                          s.exercise_id === p.exercise_id),
                    );
                    const isExpanded = expandedExerciseId === p.id;
                    out.push(
                      <ExerciseCard
                        key={p.id}
                        planRow={p}
                        unit={unit}
                        isExpanded={isExpanded}
                        sets={setsForExercise}
                        busy={busy}
                        onToggleExpand={() =>
                          setExpandedExerciseId(isExpanded ? null : p.id)
                        }
                        onAddSet={() => onAddSet(p.exercise_id, p.id)}
                        onUpdateSet={onUpdateSet}
                        onCycleSetKind={(set_id) =>
                          onCycleSetKind(p.exercise_id, set_id)
                        }
                        onDeleteSet={onDeleteSet}
                        onAddSetAfter={(set_id) =>
                          onAddSetAfter(p.exercise_id, set_id)
                        }
                        onAddDropsetRow={onAddDropsetRow}
                        onRemoveDropsetRow={onRemoveDropsetRow}
                        onToggleLogged={onToggleLogged}
                        onShowSetNote={(set_id, current) =>
                          setNoteSheetTarget({ set_id, initial: current })
                        }
                        onTapNumber={(set_id, field, current) =>
                          setKeypadTarget({ set_id, field, current })
                        }
                        prSnapshot={prSnapshotById[p.exercise_id] ?? null}
                        onOpenHistory={() =>
                          // Solo card → default to exclude_cluster (overnight #8
                          // spec default 1) so cluster sessions don't pollute
                          // the user's "what does this exercise do solo" view.
                          //
                          // Slice 10c overnight #21 — currentSeId carries this
                          // solo card's session_exercise.id so the「再次訓練」
                          // button on the destination history page can
                          // overwrite this card's sets.
                          router.push(
                            `/exercise-history/${p.exercise_id}?clusterMode=exclude_cluster&currentSeId=${p.id}`,
                          )
                        }
                        onSettingsPress={() => onSettingsPress(p)}
                        onLongPressHeader={() => setReorderSheetOpen(true)}
                        onConfirmReorderSets={async (orderedIds) => {
                          const session_id = getSessionId(sessionState);
                          if (!session_id) return;
                          try {
                            await reorderSessionSetsForExercise(db, {
                              session_id,
                              exercise_id: p.exercise_id,
                              orderedIds,
                              // v019 isolation — scope reorder to this card
                              session_exercise_id: p.id,
                            });
                            await refresh();
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
                })()}
              </View>
            </>
          )}

          {lastPRDelta && achievementsEnabled ? (
            <View style={styles.prBanner}>
              <View style={styles.prBannerHeader}>
                <Text style={styles.prBannerTitle}>🏆 PR! · {lastPRExerciseName}</Text>
                <Pressable
                  onPress={() => {
                    setLastPRDelta(null);
                    setLastPRExerciseName('');
                  }}
                  style={styles.linkBtn}>
                  <Text style={styles.linkBtnText}>{t('common', 'close')}</Text>
                </Pressable>
              </View>
              {(() => {
                const sorted = sortBreaksForDisplay(lastPRDelta.breaks);
                let prevBucket: BucketKey | null = null;
                return sorted.map((b, idx) => {
                  const showBucket = b.bucket !== prevBucket;
                  prevBucket = b.bucket;
                  return (
                    <View key={`${b.bucket}-${b.type}-${idx}`}>
                      {showBucket ? (
                        <Text style={styles.prBannerBucket}>{bucketLabel(b.bucket)}</Text>
                      ) : null}
                      <Text style={styles.prBannerLine}>
                        · {b.type === 'weight' ? t('domain', 'weight') : t('domain', 'volume')} PR
                        {b.prior_best == null
                          ? t('status', 'firstTime')
                          : tPrDeltaLine(
                              formatPRDeltaValue(b.prior_best, b.type, unit),
                              formatPRDeltaValue(b.new_value, b.type, unit),
                            )}
                      </Text>
                    </View>
                  );
                });
              })()}
              {lastPRDelta.is_all_time_weight_pr ? (
                <Text style={styles.prBannerAllTime}>{t('status', 'allTimeWeightPr')}</Text>
              ) : null}
              {lastPRDelta.is_all_time_volume_pr ? (
                <Text style={styles.prBannerAllTime}>{t('status', 'allTimeVolumePr')}</Text>
              ) : null}
            </View>
          ) : null}

        </NestableScrollContainer>
        <View style={styles.bottomStickyBar}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/exercise-picker?mode=picker')}
            disabled={busy}
            style={({ pressed }) => [
              styles.bottomStickyBtn,
              styles.bottomStickyBtnPrimary,
              busy && styles.btnDisabled,
              pressed && styles.btnPressed,
            ]}>
            <Text style={styles.bottomStickyBtnTextPrimary}>{t('button', 'addExercise')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('button', 'manualRestStart')}
            onPress={() => {
              // 手動計時 — opens the same RestTimerModal that tap-✓ uses,
              // but unbounded from any specific set. Default 60s; user can
              // cancel anytime. Per 2026-05-12 grill recommendation +
              // 2026-05-16 ultra-late pull-forward from slice 10d.
              setRestTimerTarget({ rest_sec: 60, exercise_name: t('button', 'manualRest') });
              setRestTimerTrigger((n) => n + 1);
            }}
            style={({ pressed }) => [
              styles.bottomStickyBtn,
              styles.bottomStickyBtnSecondary,
              pressed && styles.btnPressed,
            ]}>
            <Text style={styles.bottomStickyBtnTextSecondary}>
              {t('button', 'manualTimer')}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
      {/* ADR-0028 — cast 編輯鎖「鎖定視窗」: a touch-capturing overlay over the
          whole in-session view (header + content). Blocks every edit at one
          choke point while the live read-only mirror shows through; the only
          control is the unlock button. */}
      {editLock.isLockedOut ? (
        <CastLockOverlay
          lock={editLock.lock}
          onUnlock={editLock.requestUnlock}
          onForceTake={editLock.forceTake}
          onKeepLock={editLock.keepLock}
        />
      ) : null}
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
        initialValue={
          keypadTarget?.field === 'weight'
            ? displayWeight(keypadTarget?.current ?? 0, unit) // kg → display unit
            : keypadTarget?.current ?? 0
        }
        label={keypadTarget?.field === 'weight' ? t('domain', 'weightKg') : t('domain', 'reps')}
        mode={keypadTarget?.field === 'weight' ? 'decimal' : 'integer'}
        onConfirm={(value) => {
          if (keypadTarget) {
            const patch =
              keypadTarget.field === 'weight'
                ? { weight: displayToKg(value, unit) } // entered display unit → kg
                : { reps: value };
            onUpdateSet(keypadTarget.set_id, patch);
          }
          setKeypadTarget(null);
        }}
        onCancel={() => setKeypadTarget(null)}
      />
      {(() => {
        // 同 session 詳情頁編輯模式：cluster parent + child collapse 成單列「A + B」、
        // children 不獨立顯示；confirm 時 expandClusterIds 把 child id 塞回 parent id 後面。
        const { rows: reorderRows, childByParent } =
          buildSessionReorderRows(plan);
        return (
      <ReorderExercisesSheet
        visible={reorderSheetOpen}
        initialItems={reorderRows}
        onConfirm={async (orderedParentIds) => {
          setReorderSheetOpen(false);
          const session_id = getSessionId(sessionState);
          if (!session_id) return;
          const orderedIds = expandClusterIds(
            orderedParentIds,
            childByParent,
          );
          try {
            await reorderSessionExercises(db, {
              session_id,
              orderedIds,
            });
            await refresh();
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
              await refresh();
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
      <RestTimerModal
        visible={restTimerTarget !== null}
        rest_sec={restTimerTarget?.rest_sec ?? 60}
        triggerKey={restTimerTrigger}
        exerciseName={restTimerTarget?.exercise_name}
        onSkip={() => setRestTimerTarget(null)}
        onCancel={() => setRestTimerTarget(null)}
      />
      <BodyDataSheet
        visible={bodySheetVisible}
        unit={unit}
        bwSnapshotKg={bwSnapshotKg}
        bwInput={inlineBwInput}
        pbfInput={inlinePbfInput}
        smmInput={inlineSmmInput}
        onBwInputChange={setInlineBwInput}
        onPbfInputChange={setInlinePbfInput}
        onSmmInputChange={setInlineSmmInput}
        onSave={onSaveInlineBodyData}
        onClose={() => setBodySheetVisible(false)}
        busy={busy}
      />
      {/* 另存模板 bottom sheet (2026-06-27 in-session ⋯ menu) — mirror of the
          session 詳情頁 sheet, opened by handleSaveTemplate('create'). */}
      <TemplateMetaSheet
        visible={templateMetaSheetOpen}
        defaultName={
          templateMetaPrefill?.name ??
          (sessionState.status === 'in_progress'
            ? formatLocalYmdFromMs(sessionState.started_at)
            : 'Session')
        }
        defaultProgramId={templateMetaPrefill?.program_id ?? null}
        defaultSubTag={templateMetaPrefill?.sub_tag ?? null}
        programs={programs}
        onCancel={closeTemplateMetaSheet}
        onConfirm={handleTemplateMetaConfirm}
        busy={templateMetaBusy}
      />
      {/* D32 interim — Watch-led read-only feedback toast. */}
      <ToastHost controller={toastRef.current!} />
    </SafeAreaView>
  );
}

/**
 * Format a PR delta value for the chip line. Weight values display in the
 * user's unit; volume is internally kg-reps but rendered with the unit suffix
 * so the user reads it consistently.
 */
function formatPRDeltaValue(
  raw: number,
  type: 'weight' | 'volume',
  unit: UnitPreference
): string {
  if (!Number.isFinite(raw)) return '—';
  if (type === 'weight') return formatWeight(raw, unit);
  const display = kgToDisplay(raw, unit);
  return `${display.toFixed(0)} ${unit}-reps`;
}

/**
 * Today tab session exercise card (ADR-0019 Q3 動作卡互動模型).
 *
 * Affordances:
 *   - a-1: collapsed by default (parent state starts at expandedExerciseId=null)
 *   - b-1: tap collapsed card → expand; tap expanded header → collapse self
 *   - c-2: parent state is single id → setting it auto-collapses any other
 *   - d-1: vertical scroll for the card list (the parent ScrollView)
 *   - e-3: expanded card uses bigger padding + same border (no active ring)
 *
 * The ⚙️ icon on the right opens the settings menu (slice 10c, Phase 4).
 * For Phase 2 it's a placeholder Alert documenting the four sheets coming
 * next (📝 編輯備註 / ⏱️ 休息秒數 / 🔀 換動作 / 🗑️ 刪除動作).
 *
 * Expanded body (slice 10c Phase 2 commit 6 — SetRowContent rendering):
 *   - Each set rendered via the shared `<SetRowContent>` so weight / reps
 *     are inline-editable (per ADR-0019 Q6/Q7). Numeric edits persist
 *     keystroke-by-keystroke via `onUpdateSet → updateSetFields`.
 *   - Tap on set label / dropset add-remove / per-set notes show an alert
 *     "coming next commit" — those handlers wire in commit 7.
 *   - Footer two-button row [+ 新增 1 組][📖 動作歷史] per Q3.
 *
 * Out of scope for this commit:
 *   - Swipe gestures (左滑刪 / 右滑加 / 右滑備註) — commit 7
 *   - tap-✓ is_logged completion — commit 7
 *   - NumericKeypad swap (currently uses inline TextInput) — commit 8
 *   - Long-press reorder — commit 9
 *   - Per-set notes (schema doesn't have `set.notes` yet) — separate ticket
 *
 * Cluster handling is also deferred to Phase 7 — for now every set is
 * rendered as solo (no parent_set_id mirror behavior, no cluster atomic ✓).
 */
function ExerciseCard({
  planRow,
  unit,
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
  prSnapshot,
  onOpenHistory,
  onSettingsPress,
  onLongPressHeader,
  onConfirmReorderSets,
}: {
  planRow: SessionExerciseRowWithName;
  /** Display / entry unit for set weight (F4). */
  unit: UnitPreference;
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
  prSnapshot: PRSnapshot | null;
  onOpenHistory: () => void;
  onSettingsPress: () => void;
  onLongPressHeader: () => void;
  /**
   * Long-press any set row → inline drag mode (slice 10c Phase 2 c9 留尾 —
   * 翻盤 modal approach 後落地 inline via NestableDraggableFlatList per user
   * "直接在動作卡上移動"). On drop, this callback fires with the new
   * orderedIds; caller commits via reorderSessionSetsForExercise + refresh.
   */
  onConfirmReorderSets: (orderedIds: string[]) => Promise<void> | void;
}): React.ReactElement {
  // Memoized leaf — re-render + re-evaluate its `tExercise(planRow.exercise_name)`
  // + `t()` labels on a language switch. The parent reuses this card's cached
  // element on stable props, so it needs its OWN `useLocale()` subscription
  // (force-re-render) plus `'use no memo'` (re-evaluate, not serve cached
  // strings). Cf. project_traininglog_react_compiler_i18n_gotcha.
  'use no memo';
  useLocale();
  // ADR-0025 — pull tokens locally so styles match parent (single token
  // source via Context; ExerciseCard re-renders when parent does).
  const { tokens } = useTheme();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
  const swipeColors = swipeActionColors(tokens);
  // Slice 10c overnight #61 — labels + groups via single helper. Replaces
  // the prior `displaySetLabel`-based path (which collapsed dropset → 'D').
  // Now dropset HEAD renders `D{N}` and follower renders '' (mirror
  // template editor `computeExMeta` lines 1957-1989). Groups bundle each
  // dropset chain (head + followers) for single-swipe-unit rendering
  // (mirror template editor lines 2197-2237).
  const layout = computeSessionSetLayout(
    sets.map((s) => ({
      id: s.id,
      set_kind: s.set_kind,
      parent_set_id: s.parent_set_id,
      ordering: s.ordering,
      display_rank: s.display_rank,
    })),
  );
  const { labels, groups } = layout;
  // Per-id lookup for raw SessionSetWithExercise → used inside group render.
  const setsById = new Map(sets.map((s) => [s.id, s] as const));
  const progress = computeExerciseProgress(
    sets.map((s) => ({
      id: s.id,
      set_kind: s.set_kind,
      is_logged: s.is_logged,
      weight_kg: s.weight_kg,
      reps: s.reps,
      parent_set_id: s.parent_set_id,
    })),
  );
  return (
    <View style={[styles.exerciseCard, isExpanded && styles.exerciseCardExpanded]}>
      <View style={styles.exerciseCardHeader}>
        <Pressable
          accessibilityRole="button"
          onPress={onToggleExpand}
          onLongPress={onLongPressHeader}
          delayLongPress={400}
          style={({ pressed }) => [
            styles.exerciseCardHeaderMain,
            pressed && styles.btnPressed,
          ]}>
          <View style={styles.planText}>
            {/*
              #2 (2026-05-30) — 容量分數 (volume chip) 移到標題行右側；進度條
              獨佔下一行成為「標題 ↔ set 列」之間的全寬格線 (與 Watch 相似)。
              收合 / 展開都渲染 (progress row 不 gate isExpanded)。
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
            {/*
              Bar 分段 = setsTotal (working count + dropset chain head count
              per `computeExerciseProgress`). Dropset 納入 wave 12 2026-05-20.
            */}
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
          <Text style={styles.exerciseCardChevron}>{isExpanded ? '▼' : '▶'}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('button', 'a11yExerciseSettings')}
          onPress={onSettingsPress}
          style={({ pressed }) => [
            styles.exerciseCardGear,
            pressed && styles.btnPressed,
          ]}>
          <Text style={styles.exerciseCardGearText}>⚙️</Text>
        </Pressable>
      </View>
      {/*
        PR row 只在 expanded 才渲染 (overnight #5 第 3 點): collapsed = 只有
        header + progress bar row (跟 cluster card 一致 — cluster 沒 PR row);
        expanded = PR row + set rows + footer.
      */}
      {isExpanded &&
      prSnapshot &&
      (prSnapshot.topWeightSet !== null ||
        prSnapshot.topVolumeSet !== null) ? (
        <View style={styles.exerciseCardPRLine}>
          <Text style={styles.exerciseCardPRText}>
            {prSnapshot.topWeightSet !== null ? (
              <>
                {t('domain', 'weight')} PR:{' '}
                <Text style={styles.exerciseCardPREmphasis}>
                  {prSnapshot.topWeightSet.weight_kg}
                </Text>
                <Text>×{prSnapshot.topWeightSet.reps}</Text>
              </>
            ) : null}
            {prSnapshot.topWeightSet !== null &&
            prSnapshot.topVolumeSet !== null
              ? '   '
              : ''}
            {prSnapshot.topVolumeSet !== null ? (
              <>
                {t('domain', 'volume')} PR:{' '}
                <Text style={styles.exerciseCardPREmphasis}>
                  {prSnapshot.topVolumeSet.weight_kg}
                </Text>
                <Text>×</Text>
                <Text style={styles.exerciseCardPREmphasis}>
                  {prSnapshot.topVolumeSet.reps}
                </Text>
              </>
            ) : null}
          </Text>
        </View>
      ) : null}
      {isExpanded && (
        <View style={styles.exerciseCardBody}>
          {/*
            Slice 10e bundle 1 — per-Exercise global notes (ADR-0013) surfaced
            inline in active session card so user sees coaching cues while
            logging without an extra tap. Template editor uses 📝 indicator
            + sheet; session 上下文 user is mid-rep, inline render is the
            higher-utility variant.
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
                // Slice 10c overnight #61 — drag is group-based now. Flatten
                // new group order into a flat set-id sequence (head followed
                // by its followers) so the existing reorder helper still
                // works on flat ordering. Dropset followers stay contiguous
                // with their head — the user can never split a chain via
                // drag (mirror template editor invariant).
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
                // Per-id ordinal lookup (slice 10c overnight #7 第 1 點)
                // — survives drag re-renders where positional index drifts.
                // Guard the lookup: during a drag-reorder the list `data`
                // (=groups) can transiently lag a `sets` state update, so the
                // id may briefly be absent from `setsById`; returning null
                // avoids a render-time throw (mirrors history's `if (!headSet)`).
                const head = setsById.get(g.head.id);
                if (!head) return null;
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
                        color: swipeColors.remove,
                        // overnight #46 第 2 點 — solo set 級別 swipe-delete
                        // 直接執行、不跳 confirm Alert。Cluster 內 set 刪除 /
                        // exercise card 級 / cluster 整 row 級 confirm 不動。
                        //
                        // Dropset chain HEAD swipe-delete: cascades the whole
                        // chain via `deleteSet` (setRepository.ts:101-115,
                        // commit 3fe066a 2026-05-20). Schema
                        // `set.parent_set_id` is intentionally FK-less;
                        // cascade is app-layer in a transaction (also NULLs
                        // achievement_unlock.set_id back-refs for any logged
                        // sets in the chain). Followers / non-head rows:
                        // `deleteSet` is a no-op cascade (no rows with
                        // parent_set_id = follower_id), safe to call
                        // uniformly. G1 grill 2026-05-25 ratified — see
                        // ADR-0019 § G1 amendment.
                        onPress: () => onDeleteSet(head.id),
                      },
                    ]}
                    swipeRightActions={[
                      {
                        key: 'add',
                        label: '+1',
                        color: swipeColors.add,
                        onPress: () => onAddSetAfter(head.id),
                      },
                      {
                        key: 'note',
                        label: t('domain', 'note'),
                        color: swipeColors.note,
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
                            unit={unit}
                            setLabel={labels.get(head.id) ?? ''}
                            isDropsetFollower={false}
                            showAddDrop={false}
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
                        Slice 10c overnight #61 — dropset chain followers.
                        Each follower:
                          - empty label (head owns D{N})
                          - shows − button (disabled when chain shrunk to 2)
                          - last follower shows + button to extend chain
                          - NO ✓ tap target (head owns logged state)
                          - shares the parent's SwipeableSetRow (single
                            swipe unit — head + followers travel together)
                      */}
                      {g.followers.map((fset) => {
                        const f = setsById.get(fset.id);
                        if (!f) return null;
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
                                unit={unit}
                                setLabel=""
                                isDropsetFollower
                                showAddDrop={true}
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
                            {/*
                              NO ✓ button for followers (head owns chain
                              logged state). Spacer keeps SetRowContent
                              column-aligned with the head row.
                            */}
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
              ]}>
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
              ]}>
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

/**
 * ADR-0025 — index.tsx styles are token-driven. The previous module-level
 * `const styles = StyleSheet.create(...)` was hoisted into this factory
 * so both TodayScreen and ExerciseCard can derive matching styles from
 * the same tokens via useTheme(). Layout (flex/padding/radius) stays
 * untouched; only colors changed.
 */
function makeStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: tokens.bg.base },
  flex: { flex: 1 },
  // ADR-0024 § 2 — 3-section idle scroll (replaces the old centered idleBody).
  idleScroll: { padding: 24, gap: 20, paddingBottom: 48 },
  section: { gap: 8 },
  sectionHeading: { fontSize: 18, fontWeight: '700', color: tokens.text.primary },
  emptyBox: {
    padding: 16,
    borderRadius: 10,
    backgroundColor: tokens.bg.elevated,
    gap: 10,
    alignItems: 'stretch',
  },
  emptyTextBlock: {
    fontSize: 14,
    color: tokens.text.secondary,
    textAlign: 'center',
  },
  restRow: {
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: tokens.bg.elevated,
    alignItems: 'center',
  },
  restRowText: { fontSize: 14, color: tokens.text.secondary },
  // 2026-05-29 polish: plannedRow promoted to filled primary CTA
  // (highest visual prominence). User reqs brightness 計劃>模板>空白;
  // 計劃 is the "default daily training" so it should sit at the top
  // of the visual hierarchy when a planned template is available. The
  // emptyBox + restRow branches (no-program / rest day) keep their
  // existing low-prominence styling because they're not the active
  // CTA in those states.
  plannedRow: {
    paddingVertical: 18,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: tokens.action.primary,
    gap: 4,
  },
  plannedRowName: {
    fontSize: 18,
    fontWeight: '700',
    color: tokens.action.onPrimary,
  },
  plannedRowDetails: {
    fontSize: 13,
    color: tokens.action.onPrimary,
    opacity: 0.85,
  },
  scrollBody: { padding: 24, gap: 12, paddingBottom: 48 },
  heading: { fontSize: 28, fontWeight: '700', color: tokens.text.primary },
  helpHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    marginTop: 12,
    color: tokens.text.secondary,
  },
  // startBtn / startBtnText — legacy filled-primary CTA, no longer
  // referenced in idle scroll after the 2026-05-29 polish (plannedRow
  // took over filled-primary; 空白訓練 dropped to freestyleBtn ghost).
  // Kept for now in case other call sites surface; safe to remove
  // along with a grep sweep in a later cleanup commit.
  startBtn: {
    paddingVertical: 18,
    borderRadius: 12,
    backgroundColor: tokens.action.primary,
    alignItems: 'center',
  },
  startBtnText: {
    color: tokens.action.onPrimary,
    fontSize: 18,
    fontWeight: '700',
  },
  // 2026-05-29 polish: 空白訓練 ghost / secondary button. Lowest
  // visual prominence in the 3-section idle scroll — sits at the
  // bottom of the brightness hierarchy 計劃 > 模板 > 空白 per user.
  // Outlined / muted bg so the tap target is still discoverable
  // without competing with 計劃 (filled primary) or the 模板 row list.
  freestyleBtn: {
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: tokens.bg.elevated,
    alignItems: 'center',
  },
  freestyleBtnText: {
    color: tokens.text.secondary,
    fontSize: 15,
    fontWeight: '600',
  },
  sessionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 4,
    paddingBottom: 8,
  },
  sessionHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerIconBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  headerIconBtnText: {
    fontSize: 22,
    fontWeight: '700',
    color: tokens.text.secondary,
  },
  headerDoneBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: tokens.action.primary,
  },
  headerDoneBtnText: {
    color: tokens.action.onPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  bottomStickyBar: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: tokens.border.subtle,
    backgroundColor: tokens.bg.elevated,
  },
  bottomStickyBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  bottomStickyBtnPrimary: { backgroundColor: tokens.action.primary },
  bottomStickyBtnSecondary: { backgroundColor: tokens.bg.surface },
  bottomStickyBtnTextPrimary: {
    color: tokens.action.onPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  bottomStickyBtnTextSecondary: {
    color: tokens.action.primary,
    fontSize: 15,
    fontWeight: '700',
  },
  btnDisabled: { opacity: 0.5 },
  btnPressed: { opacity: 0.85 },
  planList: { gap: 8, paddingVertical: 4 },
  // Empty-state for in_progress session with 0 exercises (overnight 第 3 點).
  // Mirrors `library.tsx` empty pattern (尚未建立超級組) for consistency.
  emptyPlanBlock: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 24,
    gap: 6,
    marginTop: 8,
    borderRadius: 10,
    backgroundColor: tokens.bg.elevated,
  },
  emptyPlanTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: tokens.text.secondary,
  },
  emptyPlanBody: {
    fontSize: 13,
    color: tokens.text.tertiary,
    textAlign: 'center',
  },
  planText: { flex: 1 },
  planName: {
    fontSize: 15,
    fontWeight: '600',
    color: tokens.text.primary,
    // #2 — flexShrink so a long name truncates (numberOfLines={1}) and
    // leaves room for the volume chip now sharing the title row.
    flexShrink: 1,
  },
  // ADR-0019 Q3 動作卡 collapsed/expanded model — slice 10b
  exerciseCard: {
    backgroundColor: interactiveCardBg(tokens),
    borderRadius: 10,
    overflow: 'hidden',
  },
  exerciseCardExpanded: {
    backgroundColor: interactiveCardBg(tokens),
  },
  exerciseCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  exerciseCardHeaderMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
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
  exerciseCardGearText: { fontSize: 18, color: tokens.text.primary },
  // Progress bar + 容量 chip 同一 row (overnight #5 第 1 點)
  // chip 在 bar 右側、與齒輪 column 對齊
  exerciseCardProgressRow: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: '100%',
  },
  exerciseCardProgressBarFill: {
    flex: 1,
  },
  exerciseCardTitleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    justifyContent: 'space-between',
  },
  exerciseCardVolumeChip: {
    // overnight #5 第 2 點: 字體 fit `9999/9999` (9 chars), minWidth 鎖避免
    // progress bar 寬度 jitter (短數字如 `0/200` 不會讓 bar 變長), 純數字無
    // 「容量」prefix. fontSize 12 (原 13) — 在 ~75px 寬內可容 9999/9999.
    fontSize: 12,
    fontWeight: '600',
    color: tokens.text.secondary,
    minWidth: 76,
    textAlign: 'right',
  },
  exerciseCardPRLine: {
    paddingHorizontal: 12,
    paddingBottom: 8,
    gap: 2,
  },
  exerciseCardPRText: {
    fontSize: 12,
    color: tokens.action.warning,
  },
  exerciseCardPREmphasis: {
    fontWeight: '700',
    textDecorationLine: 'underline',
    color: tokens.action.warning,
  },
  exerciseCardBody: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    // overnight #52 — solo row 間距加大 (規格 A、setsBox gap 8→12)
    gap: 12,
  },
  exerciseCardEmpty: {
    fontSize: 13,
    color: tokens.text.tertiary,
    fontStyle: 'italic',
    paddingVertical: 8,
  },
  // Slice 10e bundle 1 — inline notes callout in expanded session card.
  // Semantic warm-amber accent intentionally retained (sticky-note feel);
  // ADR-0025 keeps warm-tone callouts as their own design intent.
  exerciseCardNotes: {
    backgroundColor: '#FEF3C7', // amber-100 — gentle highlight, mirror sticky-note feel
    borderLeftWidth: 3,
    borderLeftColor: '#F59E0B', // amber-500 — accent
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 4,
  },
  exerciseCardNotesText: {
    fontSize: 13,
    color: '#78350F', // amber-900 — high contrast on amber-100 bg
    lineHeight: 18,
  },
  exerciseCardSetRowWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    // overnight #52 — 規格 A (solo): gap 8→12, paddingVertical 4→8
    gap: 12,
    paddingVertical: 8,
    // Transparent — let the card's translucent gray (exerciseCard backgroundColor)
    // show through. Drag-active state overrides via exerciseCardSetRowDragActive.
  },
  // Bug #309 — an EXPANDED card's background is already `tokens.bg.surface`,
  // so the old `backgroundColor: tokens.bg.surface` here made the dragged row
  // identical to the card → no visible「拖曳中」feedback (ADR-0025 theme
  // migration regressed this from a distinct gray). Use `bg.elevated` so the
  // grabbed row visibly shifts off the card in both light + dark, matching the
  // template editor's drag-active lift (用戶要求「拖曳時變色如模板一樣」).
  exerciseCardSetRowDragActive: dragActiveRowStyle(tokens),
  exerciseCardSetRowContent: {
    flex: 1,
  },
  /**
   * Slice 10c overnight #61 — dropset chain cluster stack. Head + all
   * followers render inside ONE SwipeableSetRow (single swipe unit),
   * stacked vertically via this container. Mirrors template editor's
   * `clusterStack` style usage at template-editor-view.tsx lines 2197-2237.
   * No backgroundColor / borders — visual grouping comes from the row
   * indent and the `D{N}` HEAD label vs the follower's blank label slot.
   */
  exerciseCardDropsetClusterStack: {
    flexDirection: 'column',
  },
  completeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: tokens.bg.surface,
  },
  completeBtnDone: {
    backgroundColor: tokens.action.success,
  },
  completeBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: tokens.text.secondary,
  },
  completeBtnTextDone: {
    color: tokens.action.onPrimary,
  },
  /**
   * Slice 10c overnight #61 — same width as completeBtn so dropset
   * follower rows keep their SetRowContent column-aligned with the
   * head row (head has ✓, follower has nothing). Width 28 matches
   * `completeBtn.width`.
   */
  completeBtnSpacer: { width: 28, height: 28 },
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
    backgroundColor: tokens.bg.surface,
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
  programBanner: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: tokens.bg.elevated,
    gap: 4,
    marginVertical: 8,
  },
  programBannerName: {
    fontSize: 14,
    fontWeight: '700',
    color: tokens.action.primary,
  },
  programBannerCell: { fontSize: 13, color: tokens.text.primary },
  secondaryBtn: {
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: tokens.bg.surface,
    alignItems: 'center',
  },
  secondaryBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: tokens.text.primary,
  },
  linkBtn: { paddingVertical: 4, paddingHorizontal: 8 },
  linkBtnText: {
    fontSize: 13,
    color: tokens.action.primary,
    fontWeight: '600',
  },
  // Semantic warm-amber PR banner intentionally retained (alert-on-record feel);
  // ADR-0025 keeps warm-tone callouts as their own design intent.
  prBanner: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,180,0,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,140,0,0.4)',
    gap: 4,
  },
  prBannerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  prBannerTitle: { fontSize: 15, fontWeight: '700', color: tokens.text.primary },
  prBannerBucket: {
    fontSize: 13,
    fontWeight: '700',
    color: tokens.action.warning,
    marginTop: 2,
  },
  prBannerLine: { fontSize: 13, marginLeft: 6, color: tokens.text.primary },
  prBannerAllTime: {
    fontSize: 12,
    fontWeight: '700',
    color: tokens.action.warning,
  },
  });
}

/**
 * Default export wraps the screen in CoachMarkProvider so the in-component
 * `useCoachMarkTarget` hooks (idle 三區 help tour) can register their nodes —
 * a context consumer must live BELOW the provider. page-help-overlay pilot
 * (2026-06-29).
 */
export default function TodayScreenWithHelp() {
  return (
    <CoachMarkProvider>
      <TodayScreen />
    </CoachMarkProvider>
  );
}
