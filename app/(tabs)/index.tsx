import { randomUUID } from 'expo-crypto';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  ActionSheetIOS,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDatabase } from '@/components/database-provider';
import {
  insertBodyMetric,
  listBodyMetrics,
} from '@/src/adapters/sqlite/bodyMetricRepository';
import { listExercises } from '@/src/adapters/sqlite/exerciseRepository';
import {
  getExerciseNotes,
  updateExerciseNotes,
} from '@/src/adapters/sqlite/exerciseLibraryRepository';
import { consumePick } from '@/src/domain/exercise/pickerBridge';
import { getActiveProgram } from '@/src/adapters/sqlite/programRepository';
import {
  appendSessionExercise,
  createSession,
  deleteSessionExerciseAndSets,
  discardSession,
  endSession,
  getActiveSession,
  listSessionExercisesWithName,
  appendReusableSupersetToSession,
  reorderSessionExercises,
  updateSessionExerciseRestSec,
  type SessionExerciseRowWithName,
} from '@/src/adapters/sqlite/sessionRepository';
import { getSetting, getUnitPreference } from '@/src/adapters/sqlite/settingsRepository';
import {
  addSessionDropsetRow,
  deleteSet,
  insertSessionSet,
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
  NestableScrollContainer,
  NestableDraggableFlatList,
  type RenderItemParams,
} from 'react-native-draggable-flatlist';
import { NumericKeypad } from '@/components/shared/numeric-keypad';
import { SegmentedProgressBar } from '@/components/shared/segmented-progress-bar';
import { computeExerciseProgress } from '@/src/domain/session/exerciseProgress';
import { countUniqueExercises } from '@/src/domain/session/countUniqueExercises';
import { SessionStatsPanel } from '@/components/session/session-stats-panel';
import { BodyDataSheet } from '@/components/session/body-data-sheet';
import { RestTimerModal } from '@/components/session/rest-timer-modal';
import { ClusterCard } from '@/components/session/cluster-card';
import { groupClusterSides } from '@/src/domain/session/clusterCard';
import {
  computePRSnapshot,
  type PRSnapshot,
} from '@/src/domain/pr/prQuery';
import { listExerciseHistorySets } from '@/src/adapters/sqlite/exerciseHistoryRepository';
import { computeSessionSetLayout } from '@/src/domain/set/sessionSetLayout';
import { cycleSessionSetKindClusterAware } from '@/src/domain/set/cycleSessionSetKind';
import {
  getSessionLinkedTemplateTriple,
  listTemplates,
  type TemplateSummary,
} from '@/src/adapters/sqlite/templateRepository';
import { formatTemplateTriple } from '@/src/domain/template/templateManager';
import {
  latestPerMetric,
  validateBodyMetric,
} from '@/src/domain/body/bodyMetricManager';
import type { BodyMetric, UnitPreference } from '@/src/domain/body/types';
import {
  formatWeight,
  kgToDisplay,
  parseWeightInput,
} from '@/src/domain/body/unitConversion';
import type { Exercise } from '@/src/domain/exercise/types';
import {
  resolveProgramLabel,
  todayCell,
  utcMsToIsoDate,
} from '@/src/domain/program/programManager';
import type { ProgramCell, ProgramWithCells } from '@/src/domain/program/types';
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
import { evaluateAndPersistAchievements } from '@/src/adapters/sqlite/achievementRepository';
import { detectPRBreaks } from '@/src/domain/pr/prEngine';
import { sortBreaksForDisplay, bucketLabel } from '@/src/domain/pr/buckets';
import type { BucketKey, PRDelta } from '@/src/domain/pr/types';

/**
 * Today tab — proper Session lifecycle (slice 2).
 *
 *   idle ──Start──▶ in_progress ──End──▶ ended → push to detail screen → idle
 *
 * The DB is source of truth: on focus we re-query the active session and
 * recompute SessionState via `sessionManager.fromRow`. UI only ever holds
 * derived state — no risk of drifting from persisted reality.
 */
export default function TodayScreen() {
  const db = useDatabase();
  const router = useRouter();
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
  const [bodyMetrics, setBodyMetrics] = useState<BodyMetric[]>([]);
  const [bwSnapshotKg, setBwSnapshotKg] = useState<number | null>(null);
  const [prePromptVisible, setPrePromptVisible] = useState(false);
  const [preBwInput, setPreBwInput] = useState('');
  // Body data editor sheet (slice 10c overnight #4 第 3 點) — replaces the
  // previous inline panel. Opened from header ⋯ menu「Body data」.
  const [bodySheetVisible, setBodySheetVisible] = useState(false);
  const [inlineBwInput, setInlineBwInput] = useState('');
  const [inlinePbfInput, setInlinePbfInput] = useState('');
  const [inlineSmmInput, setInlineSmmInput] = useState('');
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
   * computed once on refresh from listExerciseHistorySets (cross-session).
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
   * 「自由訓練」. Refreshed by a useEffect keyed on session status + id below.
   */
  const [sessionTemplateInfo, setSessionTemplateInfo] = useState<{
    template_name: string;
    program_name: string | null;
    sub_tag: string | null;
  } | null>(null);

  const refresh = useCallback(async () => {
    const [exs, active, prog, tpls, u, bms, popup] = await Promise.all([
      listExercises(db),
      getActiveSession(db),
      getActiveProgram(db),
      listTemplates(db),
      getUnitPreference(db),
      listBodyMetrics(db),
      // v016 seeds auto_popup_rest_timer = '1' (raw string, JSON-parses to 1).
      // null / 0 / undefined → autoPopup off.
      getSetting<number | boolean>(db, 'auto_popup_rest_timer'),
    ]);
    setExercises(exs);
    setSessionState(fromRow(active));
    setActiveProgram(prog);
    setUnit(u);
    setBodyMetrics(bms);
    setAutoPopupTimer(popup === 1 || popup === true);
    const tplMap: Record<string, TemplateSummary> = {};
    for (const t of tpls) tplMap[t.id] = t;
    setTemplatesById(tplMap);
    const cell = todayCell({ active: prog, today: utcMsToIsoDate(Date.now()) });
    setProgramCellToday(cell);
    if (active) {
      const [sets, planned] = await Promise.all([
        listSetsBySession(db, active.id),
        listSessionExercisesWithName(db, active.id),
      ]);
      setSetsInSession(sets);
      setPlan(planned);
      setBwSnapshotKg(active.bodyweight_snapshot_kg ?? null);
      // Fetch all-time history for each planned exercise + compute its PR
      // snapshot once per refresh. Per-exercise queries — cheap given the
      // typical session has <10 planned exercises.
      const prMap: Record<string, PRSnapshot> = {};
      await Promise.all(
        planned.map(async (p) => {
          const history = await listExerciseHistorySets(db, p.exercise_id);
          prMap[p.exercise_id] = computePRSnapshot(
            history.map((h) => ({ weight_kg: h.weight_kg, reps: h.reps })),
          );
        }),
      );
      setPrSnapshotById(prMap);
    } else {
      setSetsInSession([]);
      setPlan([]);
      setBwSnapshotKg(null);
      setPrSnapshotById({});
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
          try {
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
            }
            await refresh();
          } catch (e) {
            Alert.alert(
              'Add failed',
              e instanceof Error ? e.message : String(e),
            );
          }
        })();
      }
    }, [refresh, db])
  );

  const onShowPrePrompt = () => {
    // Pre-fill with latest bw if available, in user's display unit.
    const latest = latestPerMetric(bodyMetrics);
    setPreBwInput(
      latest.bodyweight_kg != null
        ? kgToDisplay(latest.bodyweight_kg, unit).toFixed(1)
        : ''
    );
    setPrePromptVisible(true);
  };

  const onCancelPrePrompt = () => {
    setPrePromptVisible(false);
    setPreBwInput('');
  };

  const onConfirmPrePrompt = async (skipBw: boolean) => {
    let bwKg: number | null = null;
    if (!skipBw) {
      bwKg = parseWeightInput(preBwInput, unit);
      if (bwKg == null) {
        Alert.alert('體重輸入無效', '請輸入正數，或選擇略過');
        return;
      }
      if (bwKg <= 0 || bwKg > 500) {
        Alert.alert('體重輸入無效', '應為 0–500 kg 區間');
        return;
      }
    }
    setBusy(true);
    try {
      const id = randomUUID();
      const started_at = Date.now();
      await createSession(db, {
        id,
        started_at,
        bodyweight_snapshot_kg: bwKg,
      });
      // If user supplied bw, also record as a body_metric so the trend chart
      // sees it. Skip mode doesn't write a body_metric.
      if (bwKg != null) {
        await insertBodyMetric(
          db,
          {
            recorded_at: started_at,
            bodyweight_kg: bwKg,
            pbf: null,
            smm_kg: null,
          },
          randomUUID
        );
      }
      setSessionState(startState({ id, started_at }));
      setSetsInSession([]);
      setPlan([]);
      setBwSnapshotKg(bwKg);
      setPrePromptVisible(false);
      setPreBwInput('');
      // Reload body metrics so latestPerMetric reflects the new entry.
      const bms = await listBodyMetrics(db);
      setBodyMetrics(bms);
    } catch (e) {
      Alert.alert('Could not start session', e instanceof Error ? e.message : String(e));
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
      Alert.alert('輸入無效', '至少輸入一個欄位且數值合理');
      return;
    }
    setBusy(true);
    try {
      await insertBodyMetric(db, draft, randomUUID);
      setInlineBwInput('');
      setInlinePbfInput('');
      setInlineSmmInput('');
      setBodySheetVisible(false);
      const bms = await listBodyMetrics(db);
      setBodyMetrics(bms);
    } catch (e) {
      Alert.alert('儲存失敗', e instanceof Error ? e.message : String(e));
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
  const onAddSet = async (
    exercise_id: string,
    session_exercise_id: string,
  ) => {
    const session_id = getSessionId(sessionState);
    if (!canRecordSet(sessionState) || !session_id) {
      Alert.alert('No active session');
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

    // 2026-05-20 fix — 「新增 1 組」 should extend the EXISTING last group:
    // if exercise ends in a dropset chain, append another follower (mirror
    // the inline `+` button + right-swipe routing). Without this, the new
    // row was always set_kind='working' and appeared as a new D1 + a
    // working row below the chain, contradicting「新增最後一組」semantics.
    if (lastSetInSession?.set_kind === 'dropset') {
      setBusy(true);
      try {
        await addSessionDropsetRow(db, {
          session_id,
          after_set_id: lastSetInSession.id,
          uuid: randomUUID,
        });
        const sets = await listSetsBySession(db, session_id);
        setSetsInSession(sets);
      } catch (e) {
        Alert.alert('Save failed', e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
      return;
    }

    let weight_kg = 0;
    let repsNum = 10; // Starter default for true first-time exercises

    if (lastSetInSession) {
      weight_kg = lastSetInSession.weight_kg ?? 0;
      repsNum = lastSetInSession.reps ?? repsNum;
    } else {
      // Fall back to cross-session history (動作記憶) — pull most recent set
      // for this exercise from any prior session.
      try {
        const historicalPriors = await listPriorSetsForExercise(
          db,
          exercise_id,
          Date.now() + 1 // cutoff exclusive of now+1ms = include all prior
        );
        if (historicalPriors.length > 0) {
          const mostRecent = historicalPriors[0]; // ORDER BY created_at DESC
          weight_kg = mostRecent.weight_kg ?? 0;
          repsNum = mostRecent.reps ?? repsNum;
        }
      } catch {
        // History query failure → fall through to starter defaults
      }
    }

    // Final guard: if reps somehow still 0 / non-positive, use starter default
    // so validator never rejects an auto-add. User can tap-edit afterwards.
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
        session_id,
        input: { exercise_id, weight_kg, reps: repsNum },
        uuid: randomUUID,
        session_exercise_id, // v019 isolation
      });
      const sets = await listSetsBySession(db, session_id);
      setSetsInSession(sets);
      // NOTE: PR detection moved to onToggleLogged — new sets start unlogged,
      // so the PR ceremony should fire only when user marks the set complete.
      // Per user 「還沒打勾就跳出ＰＲ！」 (smoke 2026-05-17 ultra-late).
    } catch (e) {
      Alert.alert('Save failed', e instanceof Error ? e.message : String(e));
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
    } catch (e) {
      Alert.alert('Save failed', e instanceof Error ? e.message : String(e));
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
      // Compute the ordering for any insertFollower op once, up front, by
      // grabbing the current max ordering. Same trick recordSetInSession
      // uses — we don't expect concurrent writes in the same session.
      const maxOrdering = setsInSession.reduce(
        (m, s) => Math.max(m, s.ordering),
        0,
      );
      let appendOffset = 1;
      for (const op of ops) {
        if (op.type === 'update') {
          await updateSetFields(db, op.set_id, op.patch);
        } else if (op.type === 'delete') {
          await deleteSet(db, op.set_id);
        } else {
          // insertFollower — v019 isolation fix: inherit the head set's
          // session_exercise_id so the dropset follower stays on the
          // same card as its parent (matters when two cards share
          // exercise_id; #17).
          const head = setsInSession.find((s) => s.id === op.parent_set_id);
          await insertSessionSet(db, {
            id: op.new_set_id,
            session_id,
            exercise_id,
            weight_kg: op.weight_kg,
            reps: op.reps,
            is_skipped: 0,
            ordering: maxOrdering + appendOffset,
            created_at: Date.now(),
            set_kind: 'dropset',
            parent_set_id: op.parent_set_id,
            session_exercise_id: head?.session_exercise_id ?? null,
          });
          appendOffset += 1;
        }
      }
      const sets = await listSetsBySession(db, session_id);
      setSetsInSession(sets);
    } catch (e) {
      Alert.alert('Save failed', e instanceof Error ? e.message : String(e));
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
    } catch (e) {
      Alert.alert('Delete failed', e instanceof Error ? e.message : String(e));
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
      // 2026-05-20 fix — dropset cluster +1 swipe: route to
      // addSessionDropsetRow so the new row joins the existing chain
      // (parent_set_id = head) instead of inserting a foreign HEAD into
      // the middle of the chain (which previously broke grouping and
      // surfaced as orphan-like rows after my prior fix).
      const source = setsInSession.find((s) => s.id === source_set_id);
      if (source?.set_kind === 'dropset') {
        await addSessionDropsetRow(db, {
          session_id,
          after_set_id: source_set_id,
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
      // PR detection moved to onToggleLogged — new rows start unlogged.
    } catch (e) {
      Alert.alert('Save failed', e instanceof Error ? e.message : String(e));
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
    } catch (e) {
      Alert.alert('新增 dropset 失敗', e instanceof Error ? e.message : String(e));
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
      const exercise_name = planRow?.exercise_name ?? '';
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
    } catch (e) {
      console.warn('[cluster cycle ✓] failed:', e);
      return;
    }

    if (nextLogged === 1 && autoPopupTimer) {
      // Q2 § (C): cluster timer launched from PARENT's rest_sec, not
      // either child's. Falls back to 60s when NULL (system default).
      const rest_sec = group.a.exercise.rest_sec ?? 60;
      // Banner-style name: "A名 + B名"
      const exercise_name = `${group.a.exercise.exercise_name} + ${group.b.exercise.exercise_name}`;
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
    } catch (e) {
      Alert.alert(
        'Delete failed',
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
    } catch (e) {
      Alert.alert(
        'Clone failed',
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
    } catch (e) {
      Alert.alert(
        'Add cycle failed',
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
    } catch (e) {
      Alert.alert('Save failed', e instanceof Error ? e.message : String(e));
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
    // Build options array. Cluster context inserts two history items
    // before 🔃 排序動作 so the destructive 🗑️ 刪除動作 keeps its
    // visual separation. Indices below are derived from this array.
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
          // Open keypad pre-filled with current rest_sec (default 60).
          setRestSecTarget({
            session_exercise_id: planRow.id,
            current: planRow.rest_sec ?? 60,
            exercise_name: planRow.exercise_name,
          });
        } else if (label === '📖 動作歷史 (A)') {
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
        } else if (label === '📖 動作歷史 (B)') {
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
        } else if (label === '🔃 排序動作') {
          setReorderSheetOpen(true);
        } else if (label === '🗑️ 刪除動作') {
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
            const partnerName =
              partnerPlan?.exercise_name ?? '(未知動作)';
            const setsForCluster = setsInSession.filter(
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
                        '刪除失敗',
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
  };

  /**
   * Header [⋯] menu (ADR-0019 Q15). Items:
   *   1. Body data — open body-data editor sheet (slice 10c overnight #4 第 3 點)
   *   2. 🚫 放棄訓練 — destructive, CASCADE delete the active session
   * Cancel is index 0; more items可以陸續加。
   */
  const onHeaderMenuPress = () => {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: ['取消', 'Body data', '🚫 放棄訓練'],
        cancelButtonIndex: 0,
        destructiveButtonIndex: 2,
      },
      (idx) => {
        if (idx === 1) {
          setBodySheetVisible(true);
          return;
        }
        if (idx !== 2) return;
        Alert.alert(
          '放棄此次訓練？',
          '此操作不可復原 — 將刪除整個 session、所有動作及記錄。',
          [
            { text: '取消', style: 'cancel' },
            {
              text: '放棄',
              style: 'destructive',
              onPress: async () => {
                const session_id = getSessionId(sessionState);
                if (!session_id) return;
                try {
                  await discardSession(db, session_id);
                  setSessionState(IDLE);
                  setSetsInSession([]);
                  setPlan([]);
                  setBwSnapshotKg(null);
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
  const finalizeEndAndRoute = async (session_id: string) => {
    const ended_at = Date.now();
    await endSession(db, { id: session_id, ended_at });
    try {
      await evaluateAndPersistAchievements(db, {
        ended_session_id: session_id,
        unlocked_at: ended_at,
      });
    } catch (e) {
      console.warn('[achievements] evaluate failed:', e);
    }
    setLastPRDelta(null);
    setLastPRExerciseName('');
    endState(sessionState, ended_at);
    router.push(`/session/${session_id}`);
  };

  const onEndSession = async () => {
    const session_id = getSessionId(sessionState);
    if (!session_id) return;

    setBusy(true);
    try {
      // 2026-05-18: 直接結束 + 跳詳情頁，不再彈「結束訓練？」alert。
      // 模板操作（儲存模板 / 另存模板）統一從詳情頁 sticky action bar 走。
      await finalizeEndAndRoute(session_id);
    } catch (e) {
      Alert.alert(
        'Could not end session',
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
  // mirror the session's linked template (or「自由訓練」for freestyle);
  // idle / ended fall through to the existing active-program banner.
  let programBanner: ReactNode = null;
  if (sessionState.status === 'in_progress') {
    if (sessionTemplateInfo) {
      programBanner = (
        <View style={styles.programBanner}>
          <Text style={styles.programBannerName} numberOfLines={1}>
            {sessionTemplateInfo.template_name}
          </Text>
          <Text style={styles.programBannerCell}>
            {formatTemplateTriple(
              sessionTemplateInfo.program_name,
              sessionTemplateInfo.sub_tag,
            )}
          </Text>
        </View>
      );
    } else {
      programBanner = (
        <View style={styles.programBanner}>
          <Text style={styles.programBannerName} numberOfLines={1}>
            自由訓練
          </Text>
        </View>
      );
    }
  } else if (activeProgram) {
    programBanner = (
      <View style={styles.programBanner}>
        <Text style={styles.programBannerName} numberOfLines={1}>
          {resolveProgramLabel(activeProgram.program)}
          {activeProgram.program.main_tag ? ` · ${activeProgram.program.main_tag}` : ''}
        </Text>
        {programCellToday ? (
          <Text style={styles.programBannerCell}>
            今天：{todayTemplate ? todayTemplate.name : '休息日'}
            {programCellToday.sub_tag ? ` · ${programCellToday.sub_tag}` : ''}
          </Text>
        ) : (
          <Text style={styles.programBannerCell}>今天不在 Program 範圍內</Text>
        )}
      </View>
    );
  }

  if (sessionState.status === 'idle') {
    const latest = latestPerMetric(bodyMetrics);
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.flex}>
          <ScrollView
            contentContainerStyle={styles.idleBody}
            keyboardShouldPersistTaps="handled">
            <Text style={styles.heading}>Today</Text>
            {programBanner}
            {!prePromptVisible ? (
              <>
                <Text style={styles.idleHint}>No session in progress.</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={onShowPrePrompt}
                  disabled={busy}
                  style={({ pressed }) => [
                    styles.startBtn,
                    busy && styles.btnDisabled,
                    pressed && styles.btnPressed,
                  ]}>
                  <Text style={styles.startBtnText}>Start Session</Text>
                </Pressable>
              </>
            ) : (
              <View style={styles.prePromptBox}>
                <Text style={styles.prePromptHeading}>Pre-session</Text>
                <Text style={styles.prePromptHint}>
                  確認當下體重（鎖入此 Session）。
                  {latest.bodyweight_kg != null
                    ? `\n上次紀錄：${formatWeight(latest.bodyweight_kg, unit)}`
                    : ''}
                </Text>
                <Text style={styles.label}>體重 ({unit})</Text>
                <TextInput
                  style={styles.input}
                  keyboardType="decimal-pad"
                  value={preBwInput}
                  onChangeText={setPreBwInput}
                  placeholder={
                    latest.bodyweight_kg != null
                      ? kgToDisplay(latest.bodyweight_kg, unit).toFixed(1)
                      : '70.0'
                  }
                  placeholderTextColor="#999"
                  autoFocus
                />
                <View style={styles.prePromptActionsWrapper}>
                  <View style={styles.prePromptSecondaryRow}>
                    <Pressable
                      onPress={onCancelPrePrompt}
                      disabled={busy}
                      style={({ pressed }) => [
                        styles.secondaryBtn,
                        busy && styles.btnDisabled,
                        pressed && styles.btnPressed,
                      ]}>
                      <Text style={styles.secondaryBtnText}>取消</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => onConfirmPrePrompt(true)}
                      disabled={busy}
                      style={({ pressed }) => [
                        styles.secondaryBtn,
                        busy && styles.btnDisabled,
                        pressed && styles.btnPressed,
                      ]}>
                      <Text style={styles.secondaryBtnText}>略過</Text>
                    </Pressable>
                  </View>
                  <Pressable
                    onPress={() => onConfirmPrePrompt(false)}
                    disabled={busy}
                    style={({ pressed }) => [
                      styles.startBtn,
                      styles.prePromptConfirmBtn,
                      busy && styles.btnDisabled,
                      pressed && styles.btnPressed,
                    ]}>
                    <Text style={styles.startBtnText}>
                      {busy ? 'Starting…' : 'Confirm & Start'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // sessionState.status === 'in_progress' (ended is unreachable: we navigate away)

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}>
        <View style={styles.sessionHeader}>
          <Text style={styles.heading}>Today</Text>
          <View style={styles.sessionHeaderActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Session menu"
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
                {busy ? '結束中…' : '完成'}
              </Text>
            </Pressable>
          </View>
        </View>
        <NestableScrollContainer
          contentContainerStyle={styles.scrollBody}
          keyboardShouldPersistTaps="handled"
        >
          {programBanner}
          {/* ADR-0019 Q6 — in-session 3-tile stats panel (P1 position) */}
          {sessionState.status === 'in_progress' ? (
            <SessionStatsPanel
              sets={setsInSession.map((s) => ({
                set_kind: s.set_kind,
                is_logged: s.is_logged,
                reps: s.reps,
                weight_kg: s.weight_kg,
              }))}
              exercise_count={countUniqueExercises(plan)}
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
              <Text style={styles.emptyPlanTitle}>尚未加入動作</Text>
              <Text style={styles.emptyPlanBody}>
                點下方「+ 動作」開始記錄這次訓練。
              </Text>
            </View>
          )}

          {plan.length > 0 && (
            <>
              <Text style={styles.label}>Today&apos;s plan</Text>
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
                          isExpanded={isExpanded}
                          colorHex={p.reusable_superset_color_hex}
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
                                '排序失敗',
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
                              '排序失敗',
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

          {lastPRDelta ? (
            <View style={styles.prBanner}>
              <View style={styles.prBannerHeader}>
                <Text style={styles.prBannerTitle}>🏆 PR! · {lastPRExerciseName}</Text>
                <Pressable
                  onPress={() => {
                    setLastPRDelta(null);
                    setLastPRExerciseName('');
                  }}
                  style={styles.linkBtn}>
                  <Text style={styles.linkBtnText}>關閉</Text>
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
                        · {b.type === 'weight' ? '重量' : '容量'} PR
                        {b.prior_best == null
                          ? '（第一次）'
                          : ` · 從 ${formatPRDeltaValue(b.prior_best, b.type, unit)} → ${formatPRDeltaValue(b.new_value, b.type, unit)}`}
                      </Text>
                    </View>
                  );
                });
              })()}
              {lastPRDelta.is_all_time_weight_pr ? (
                <Text style={styles.prBannerAllTime}>★ 全紀錄重量 PR</Text>
              ) : null}
              {lastPRDelta.is_all_time_volume_pr ? (
                <Text style={styles.prBannerAllTime}>★ 全紀錄容量 PR</Text>
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
            <Text style={styles.bottomStickyBtnTextPrimary}>+ 動作</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="手動開始休息倒數"
            onPress={() => {
              // 手動計時 — opens the same RestTimerModal that tap-✓ uses,
              // but unbounded from any specific set. Default 60s; user can
              // cancel anytime. Per 2026-05-12 grill recommendation +
              // 2026-05-16 ultra-late pull-forward from slice 10d.
              setRestTimerTarget({ rest_sec: 60, exercise_name: '手動休息' });
              setRestTimerTrigger((n) => n + 1);
            }}
            style={({ pressed }) => [
              styles.bottomStickyBtn,
              styles.bottomStickyBtnSecondary,
              pressed && styles.btnPressed,
            ]}>
            <Text style={styles.bottomStickyBtnTextSecondary}>
              ⏱ 手動計時
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              Alert.alert(
                '傳至手錶 ⌚',
                'Coming in slice 13 — WatchConnectivity transferUserInfo + Watch SwiftUI app。',
              )
            }
            style={({ pressed }) => [
              styles.bottomStickyBtn,
              styles.bottomStickyBtnSecondary,
              pressed && styles.btnPressed,
            ]}>
            <Text style={styles.bottomStickyBtnTextSecondary}>
              傳至手錶 ⌚
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
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
      <ReorderExercisesSheet
        visible={reorderSheetOpen}
        initialItems={plan.map((p) => ({
          id: p.id,
          name: p.exercise_name,
        }))}
        onConfirm={async (orderedIds) => {
          setReorderSheetOpen(false);
          const session_id = getSessionId(sessionState);
          if (!session_id) return;
          try {
            await reorderSessionExercises(db, {
              session_id,
              orderedIds,
            });
            await refresh();
          } catch (e) {
            Alert.alert(
              '排序失敗',
              e instanceof Error ? e.message : String(e),
            );
          }
        }}
        onCancel={() => setReorderSheetOpen(false)}
      />
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
              await refresh();
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
    })),
  );
  const { labels, groups } = layout;
  // Per-id lookup for raw SessionSetWithExercise → used inside group render.
  const setsById = new Map(sets.map((s) => [s.id, s] as const));
  const progress = computeExerciseProgress(
    sets.map((s) => ({
      set_kind: s.set_kind,
      is_logged: s.is_logged,
      weight_kg: s.weight_kg,
      reps: s.reps,
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
            <View style={styles.exerciseCardTitleRow}>
              <Text style={styles.planName} numberOfLines={1}>
                {planRow.exercise_name}
              </Text>
            </View>
            {(() => {
              // Bar 分段 = 實際 working set row 數（drop plannedTotal — user
              // 反映 chip 100% 但 bar 1/3 不一致；template plannedTotal
              // 跟 body 實際 row 數脫節）。0 row 不渲染（per user「沒組時
              // 不要有進度條」）。
              // 容量 chip 搬到 progress bar row 右側 (overnight #5 第 1 點)
              const workingRowCount = sets.filter(
                (s) => s.set_kind === 'working',
              ).length;
              if (workingRowCount <= 0) return null;
              return (
                <View style={styles.exerciseCardProgressRow}>
                  <View style={styles.exerciseCardProgressBarFill}>
                    <SegmentedProgressBar
                      done={progress.workingDone}
                      total={workingRowCount}
                    />
                  </View>
                  {progress.volumeTotal > 0 ? (
                    <Text style={styles.exerciseCardVolumeChip}>
                      {Math.round(progress.volumeDone)}/
                      {Math.round(progress.volumeTotal)}
                    </Text>
                  ) : null}
                </View>
              );
            })()}
          </View>
          <Text style={styles.exerciseCardChevron}>{isExpanded ? '▼' : '▶'}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="動作設定"
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
                重量 PR:{' '}
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
                容量 PR:{' '}
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
                        // overnight #46 第 2 點 — solo set 級別 swipe-delete
                        // 直接執行、不跳 confirm Alert。Cluster 內 set 刪除 /
                        // exercise card 級 / cluster 整 row 級 confirm 不動。
                        //
                        // Slice 10c overnight #61: when this is a dropset
                        // chain HEAD, deleting cascades the whole chain
                        // (followers' parent_set_id points at this head;
                        // deleteSet on the head leaves orphans, but the
                        // reload pulls them too and they render as
                        // standalone — TODO ADR for cascade semantics).
                        // For now match prior behavior: just delete the head.
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
                        Slice 10c overnight #61 — dropset chain followers.
                        Each follower:
                          - empty label (head owns D{N})
                          - shows − button (disabled when chain shrunk to 2)
                          - last follower shows + button to extend chain
                          - NO ✓ tap target (head owns logged state)
                          - shares the parent's SwipeableSetRow (single
                            swipe unit — head + followers travel together)
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
              ]}>
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

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  idleBody: { padding: 24, gap: 12, flex: 1, justifyContent: 'center' },
  scrollBody: { padding: 24, gap: 12, paddingBottom: 48 },
  heading: { fontSize: 28, fontWeight: '700' },
  idleHint: { fontSize: 16, opacity: 0.65, marginBottom: 16, textAlign: 'center' },
  label: { fontSize: 14, fontWeight: '500', marginTop: 12, opacity: 0.7 },
  pillsRow: { gap: 8, paddingVertical: 4 },
  pill: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: 'rgba(127,127,127,0.12)',
  },
  pillActive: { backgroundColor: '#0a7ea4' },
  pillText: { fontSize: 14, fontWeight: '500' },
  pillTextActive: { color: 'white' },
  input: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: 'rgba(127,127,127,0.12)',
    fontSize: 18,
  },
  startBtn: {
    paddingVertical: 18,
    borderRadius: 12,
    backgroundColor: '#0a7ea4',
    alignItems: 'center',
  },
  startBtnText: { color: 'white', fontSize: 18, fontWeight: '700' },
  endBtn: {
    marginTop: 24,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(220,53,69,0.95)',
    alignItems: 'center',
  },
  endBtnText: { color: 'white', fontSize: 16, fontWeight: '700' },
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
  headerIconBtnText: { fontSize: 22, fontWeight: '700', color: '#6b7280' },
  headerDoneBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#0a7ea4',
  },
  headerDoneBtnText: { color: 'white', fontSize: 14, fontWeight: '700' },
  bottomStickyBar: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e7eb',
    backgroundColor: '#fff',
  },
  bottomStickyBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  bottomStickyBtnPrimary: { backgroundColor: '#0a7ea4' },
  bottomStickyBtnSecondary: { backgroundColor: 'rgba(127,127,127,0.18)' },
  bottomStickyBtnTextPrimary: {
    color: 'white',
    fontSize: 15,
    fontWeight: '700',
  },
  bottomStickyBtnTextSecondary: {
    color: '#0a7ea4',
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
    backgroundColor: 'rgba(127,127,127,0.06)',
  },
  emptyPlanTitle: { fontSize: 15, fontWeight: '600', opacity: 0.75 },
  emptyPlanBody: { fontSize: 13, opacity: 0.55, textAlign: 'center' },
  planMark: { fontSize: 18, width: 22, textAlign: 'center' },
  planText: { flex: 1 },
  planName: { fontSize: 15, fontWeight: '600' },
  planDetails: { fontSize: 12, opacity: 0.7 },
  // ADR-0019 Q3 動作卡 collapsed/expanded model — slice 10b
  exerciseCard: {
    backgroundColor: 'rgba(127,127,127,0.10)',
    borderRadius: 10,
    overflow: 'hidden',
  },
  exerciseCardExpanded: {
    backgroundColor: 'rgba(127,127,127,0.14)',
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
  exerciseCardProgressBar: {
    marginTop: 4,
    width: '100%',
  },
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
  exerciseCardVolume: {
    fontSize: 11,
    opacity: 0.55,
    marginTop: 2,
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
    opacity: 0.7,
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
    color: '#b35900',
  },
  exerciseCardPREmphasis: {
    fontWeight: '700',
    textDecorationLine: 'underline',
    color: '#b35900',
  },
  exerciseCardBody: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    // overnight #52 — solo row 間距加大 (規格 A、setsBox gap 8→12)
    gap: 12,
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
    // overnight #52 — 規格 A (solo): gap 8→12, paddingVertical 4→8
    gap: 12,
    paddingVertical: 8,
    // Transparent — let the card's translucent gray (exerciseCard backgroundColor)
    // show through. Drag-active state overrides via exerciseCardSetRowDragActive.
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
    backgroundColor: 'rgba(127,127,127,0.18)',
  },
  completeBtnDone: {
    backgroundColor: '#28a745',
  },
  completeBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#6b7280',
  },
  completeBtnTextDone: {
    color: 'white',
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
  programBanner: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: 'rgba(10,126,164,0.12)',
    gap: 4,
    marginVertical: 8,
  },
  programBannerName: { fontSize: 14, fontWeight: '700', color: '#0a7ea4' },
  programBannerCell: { fontSize: 13 },
  prePromptBox: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: 'rgba(10,126,164,0.08)',
    gap: 8,
    marginVertical: 8,
  },
  prePromptHeading: { fontSize: 18, fontWeight: '700' },
  prePromptHint: { fontSize: 13, opacity: 0.8 },
  prePromptActionsWrapper: { gap: 8, marginTop: 4 },
  prePromptSecondaryRow: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
  prePromptConfirmBtn: { width: '100%' },
  secondaryBtn: {
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(127,127,127,0.18)',
    alignItems: 'center',
  },
  secondaryBtnText: { fontSize: 14, fontWeight: '600' },
  linkBtn: { paddingVertical: 4, paddingHorizontal: 8 },
  linkBtnText: { fontSize: 13, color: '#0a7ea4', fontWeight: '600' },
  exerciseHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
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
  prBannerTitle: { fontSize: 15, fontWeight: '700' },
  prBannerBucket: { fontSize: 13, fontWeight: '700', color: '#b35900', marginTop: 2 },
  prBannerLine: { fontSize: 13, marginLeft: 6 },
  prBannerAllTime: { fontSize: 12, fontWeight: '700', color: '#b35900' },
});
