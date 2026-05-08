import { randomUUID } from 'expo-crypto';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Alert,
  FlatList,
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
import { getActiveProgram } from '@/src/adapters/sqlite/programRepository';
import {
  createSession,
  endSession,
  getActiveSession,
  listSessionExercisesWithName,
  type SessionExerciseRowWithName,
} from '@/src/adapters/sqlite/sessionRepository';
import { getUnitPreference } from '@/src/adapters/sqlite/settingsRepository';
import {
  listSetsBySession,
  recordSetInSession,
  type SetWithExercise,
} from '@/src/adapters/sqlite/setRepository';
import { listTemplates, type TemplateSummary } from '@/src/adapters/sqlite/templateRepository';
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
  const [selectedExerciseId, setSelectedExerciseId] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<SessionState>(IDLE);
  const [setsInSession, setSetsInSession] = useState<SetWithExercise[]>([]);
  const [plan, setPlan] = useState<SessionExerciseRowWithName[]>([]);
  const [weight, setWeight] = useState('');
  const [reps, setReps] = useState('');
  const [busy, setBusy] = useState(false);
  const [activeProgram, setActiveProgram] = useState<ProgramWithCells | null>(null);
  const [templatesById, setTemplatesById] = useState<Record<string, TemplateSummary>>({});
  const [programCellToday, setProgramCellToday] = useState<ProgramCell | null>(null);
  const [unit, setUnit] = useState<UnitPreference>('kg');
  const [bodyMetrics, setBodyMetrics] = useState<BodyMetric[]>([]);
  const [bwSnapshotKg, setBwSnapshotKg] = useState<number | null>(null);
  const [prePromptVisible, setPrePromptVisible] = useState(false);
  const [preBwInput, setPreBwInput] = useState('');
  const [inlinePanelOpen, setInlinePanelOpen] = useState(false);
  const [inlineBwInput, setInlineBwInput] = useState('');
  const [inlinePbfInput, setInlinePbfInput] = useState('');
  const [inlineSmmInput, setInlineSmmInput] = useState('');

  const refresh = useCallback(async () => {
    const [exs, active, prog, tpls, u, bms] = await Promise.all([
      listExercises(db),
      getActiveSession(db),
      getActiveProgram(db),
      listTemplates(db),
      getUnitPreference(db),
      listBodyMetrics(db),
    ]);
    setExercises(exs);
    setSessionState(fromRow(active));
    setActiveProgram(prog);
    setUnit(u);
    setBodyMetrics(bms);
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
      // If the session was started from a template, default the picker to the
      // first planned exercise so the user can record against it immediately.
      setSelectedExerciseId(
        (prev) => prev ?? planned[0]?.exercise_id ?? exs[0]?.id ?? null
      );
    } else {
      setSetsInSession([]);
      setPlan([]);
      setBwSnapshotKg(null);
      setSelectedExerciseId((prev) => prev ?? exs[0]?.id ?? null);
    }
  }, [db]);

  // Re-fetch on every focus so returning from the detail screen resets us.
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
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
      setInlinePanelOpen(false);
      const bms = await listBodyMetrics(db);
      setBodyMetrics(bms);
    } catch (e) {
      Alert.alert('儲存失敗', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onSaveSet = async () => {
    const session_id = getSessionId(sessionState);
    if (!canRecordSet(sessionState) || !session_id) {
      Alert.alert('No active session');
      return;
    }
    if (!selectedExerciseId) {
      Alert.alert('Pick an exercise first');
      return;
    }
    const weight_kg = Number(weight);
    const repsNum = Number(reps);
    const err = validateRecordSet({
      exercise_id: selectedExerciseId,
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
        input: { exercise_id: selectedExerciseId, weight_kg, reps: repsNum },
        uuid: randomUUID,
      });
      setWeight('');
      setReps('');
      const sets = await listSetsBySession(db, session_id);
      setSetsInSession(sets);
    } catch (e) {
      Alert.alert('Save failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onEndSession = async () => {
    const session_id = getSessionId(sessionState);
    if (!session_id) return;
    setBusy(true);
    try {
      const ended_at = Date.now();
      await endSession(db, { id: session_id, ended_at });
      // Validate the transition then redirect.
      endState(sessionState, ended_at);
      // If this Session was started from a Template (plan rows have a
      // template_id), intercept with the Save-back review screen first;
      // otherwise go straight to the summary.
      const fromTemplate = plan.some((p) => p.template_id != null);
      if (fromTemplate) {
        router.push(`/save-back/${session_id}`);
      } else {
        router.push(`/session/${session_id}`);
      }
      // Local state will reset on next focus via refresh().
    } catch (e) {
      Alert.alert('Could not end session', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const todayTemplate = programCellToday?.template_id
    ? templatesById[programCellToday.template_id] ?? null
    : null;
  const programBanner = activeProgram ? (
    <View style={styles.programBanner}>
      <Text style={styles.programBannerName} numberOfLines={1}>
        {activeProgram.program.name}
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
  ) : null;

  if (sessionState.status === 'idle') {
    const latest = latestPerMetric(bodyMetrics);
    return (
      <SafeAreaView style={styles.container}>
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
                <View style={styles.prePromptActions}>
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
                  <Pressable
                    onPress={() => onConfirmPrePrompt(false)}
                    disabled={busy}
                    style={({ pressed }) => [
                      styles.startBtn,
                      styles.flex1,
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
  const selectedExercise =
    exercises.find((e) => e.id === selectedExerciseId) ?? null;

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}>
        <ScrollView contentContainerStyle={styles.scrollBody} keyboardShouldPersistTaps="handled">
          <Text style={styles.heading}>Today</Text>
          {programBanner}
          <Text style={styles.subhead}>
            Session in progress · {setsInSession.length} set
            {setsInSession.length === 1 ? '' : 's'}
          </Text>

          {/* Inline body data panel — quick add during session */}
          <View style={styles.inlineBodyHeader}>
            <Text style={styles.label}>Body data</Text>
            <Pressable
              onPress={() => setInlinePanelOpen((v) => !v)}
              style={({ pressed }) => [styles.linkBtn, pressed && styles.btnPressed]}>
              <Text style={styles.linkBtnText}>
                {inlinePanelOpen ? '收合' : '＋ 新增記錄'}
              </Text>
            </Pressable>
          </View>
          {bwSnapshotKg != null ? (
            <View style={styles.snapshotBadge}>
              <Text style={styles.snapshotBadgeText}>
                🔒 BW snapshot · {formatWeight(bwSnapshotKg, unit)}
              </Text>
            </View>
          ) : null}
          {inlinePanelOpen && (
            <View style={styles.inlineBodyBox}>
              <View style={styles.inlineBodyRow}>
                <View style={styles.inlineBodyField}>
                  <Text style={styles.inlineFieldLabel}>體重 ({unit})</Text>
                  <TextInput
                    style={styles.input}
                    keyboardType="decimal-pad"
                    value={inlineBwInput}
                    onChangeText={setInlineBwInput}
                    placeholder="—"
                    placeholderTextColor="#999"
                  />
                </View>
                <View style={styles.inlineBodyField}>
                  <Text style={styles.inlineFieldLabel}>PBF (%)</Text>
                  <TextInput
                    style={styles.input}
                    keyboardType="decimal-pad"
                    value={inlinePbfInput}
                    onChangeText={setInlinePbfInput}
                    placeholder="—"
                    placeholderTextColor="#999"
                  />
                </View>
                <View style={styles.inlineBodyField}>
                  <Text style={styles.inlineFieldLabel}>SMM ({unit})</Text>
                  <TextInput
                    style={styles.input}
                    keyboardType="decimal-pad"
                    value={inlineSmmInput}
                    onChangeText={setInlineSmmInput}
                    placeholder="—"
                    placeholderTextColor="#999"
                  />
                </View>
              </View>
              <Pressable
                onPress={onSaveInlineBodyData}
                disabled={busy}
                style={({ pressed }) => [
                  styles.saveBtn,
                  busy && styles.btnDisabled,
                  pressed && styles.btnPressed,
                ]}>
                <Text style={styles.saveBtnText}>
                  {busy ? '儲存中…' : '儲存 body data'}
                </Text>
              </Pressable>
              <Text style={styles.inlineHint}>
                此 Session 的 bw_snapshot 不會被改寫。
              </Text>
            </View>
          )}

          {plan.length > 0 && (
            <>
              <Text style={styles.label}>Today&apos;s plan</Text>
              <View style={styles.planList}>
                {plan.map((p) => {
                  const done = setsInSession.filter(
                    (s) => s.exercise_id === p.exercise_id
                  ).length;
                  const complete = done >= p.planned_sets;
                  return (
                    <View key={p.id} style={styles.planRow}>
                      <Text style={styles.planMark}>{complete ? '✓' : '○'}</Text>
                      <View style={styles.planText}>
                        <Text style={styles.planName}>{p.exercise_name}</Text>
                        <Text style={styles.planDetails}>
                          {done}/{p.planned_sets} sets
                          {p.planned_reps != null ? ` · target ${p.planned_reps} reps` : ''}
                          {p.planned_weight_kg != null ? ` @ ${p.planned_weight_kg} kg` : ''}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </>
          )}

          <Text style={styles.label}>Exercise</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.pillsRow}>
            {exercises.map((ex) => {
              const isActive = ex.id === selectedExerciseId;
              return (
                <Pressable
                  key={ex.id}
                  accessibilityRole="button"
                  onPress={() => setSelectedExerciseId(ex.id)}
                  style={({ pressed }) => [
                    styles.pill,
                    isActive && styles.pillActive,
                    pressed && styles.btnPressed,
                  ]}>
                  <Text style={[styles.pillText, isActive && styles.pillTextActive]}>
                    {ex.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Text style={styles.label}>Weight (kg)</Text>
          <TextInput
            style={styles.input}
            keyboardType="decimal-pad"
            value={weight}
            onChangeText={setWeight}
            placeholder="60"
            placeholderTextColor="#999"
          />

          <Text style={styles.label}>Reps</Text>
          <TextInput
            style={styles.input}
            keyboardType="number-pad"
            value={reps}
            onChangeText={setReps}
            placeholder="10"
            placeholderTextColor="#999"
          />

          <Pressable
            accessibilityRole="button"
            onPress={onSaveSet}
            disabled={busy || !selectedExercise}
            style={({ pressed }) => [
              styles.saveBtn,
              (busy || !selectedExercise) && styles.btnDisabled,
              pressed && styles.btnPressed,
            ]}>
            <Text style={styles.saveBtnText}>{busy ? 'Saving…' : 'Save Set'}</Text>
          </Pressable>

          <Text style={styles.label}>Sets in this session</Text>
          {setsInSession.length === 0 ? (
            <Text style={styles.emptyText}>None yet — record your first set above.</Text>
          ) : (
            <FlatList
              data={setsInSession}
              keyExtractor={(item) => item.id}
              scrollEnabled={false}
              renderItem={({ item }) => (
                <View style={styles.setRow}>
                  <Text style={styles.setRowOrdering}>#{item.ordering}</Text>
                  <Text style={styles.setRowExercise}>{item.exercise_name}</Text>
                  <Text style={styles.setRowDetails}>
                    {item.weight_kg} kg × {item.reps} reps
                  </Text>
                </View>
              )}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
            />
          )}

          <Pressable
            accessibilityRole="button"
            onPress={onEndSession}
            disabled={busy}
            style={({ pressed }) => [
              styles.endBtn,
              busy && styles.btnDisabled,
              pressed && styles.btnPressed,
            ]}>
            <Text style={styles.endBtnText}>{busy ? 'Ending…' : 'End Session'}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  idleBody: { padding: 24, gap: 12, flex: 1, justifyContent: 'center' },
  scrollBody: { padding: 24, gap: 12, paddingBottom: 48 },
  heading: { fontSize: 28, fontWeight: '700' },
  subhead: { fontSize: 14, opacity: 0.7, marginBottom: 8 },
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
  saveBtn: {
    marginTop: 12,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#0a7ea4',
    alignItems: 'center',
  },
  saveBtnText: { color: 'white', fontSize: 16, fontWeight: '600' },
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
  btnDisabled: { opacity: 0.5 },
  btnPressed: { opacity: 0.85 },
  emptyText: { fontSize: 14, opacity: 0.6, fontStyle: 'italic' },
  setRow: { paddingVertical: 8, gap: 2 },
  setRowOrdering: { fontSize: 12, opacity: 0.6 },
  setRowExercise: { fontSize: 15, fontWeight: '600' },
  setRowDetails: { fontSize: 14 },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(127,127,127,0.3)' },
  planList: { gap: 6, paddingVertical: 4 },
  planRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(127,127,127,0.10)',
    borderRadius: 10,
  },
  planMark: { fontSize: 18, width: 22, textAlign: 'center' },
  planText: { flex: 1 },
  planName: { fontSize: 15, fontWeight: '600' },
  planDetails: { fontSize: 12, opacity: 0.7 },
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
  prePromptActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  flex1: { flex: 1 },
  secondaryBtn: {
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(127,127,127,0.18)',
    alignItems: 'center',
  },
  secondaryBtnText: { fontSize: 14, fontWeight: '600' },
  snapshotBadge: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(10,126,164,0.15)',
    marginVertical: 4,
  },
  snapshotBadgeText: { fontSize: 12, fontWeight: '600', color: '#0a7ea4' },
  inlineBodyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
  },
  linkBtn: { paddingVertical: 4, paddingHorizontal: 8 },
  linkBtnText: { fontSize: 13, color: '#0a7ea4', fontWeight: '600' },
  inlineBodyBox: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(127,127,127,0.06)',
    gap: 8,
  },
  inlineBodyRow: { flexDirection: 'row', gap: 8 },
  inlineBodyField: { flex: 1, gap: 4 },
  inlineFieldLabel: { fontSize: 11, opacity: 0.7 },
  inlineHint: { fontSize: 11, opacity: 0.6 },
});
