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
import { listExercises } from '@/src/adapters/sqlite/exerciseRepository';
import {
  createSession,
  endSession,
  getActiveSession,
} from '@/src/adapters/sqlite/sessionRepository';
import {
  listSetsBySession,
  recordSetInSession,
  type SetWithExercise,
} from '@/src/adapters/sqlite/setRepository';
import type { Exercise } from '@/src/domain/exercise/types';
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
  const [weight, setWeight] = useState('');
  const [reps, setReps] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [exs, active] = await Promise.all([
      listExercises(db),
      getActiveSession(db),
    ]);
    setExercises(exs);
    setSessionState(fromRow(active));
    if (active) {
      const sets = await listSetsBySession(db, active.id);
      setSetsInSession(sets);
    } else {
      setSetsInSession([]);
    }
    setSelectedExerciseId((prev) => prev ?? exs[0]?.id ?? null);
  }, [db]);

  // Re-fetch on every focus so returning from the detail screen resets us.
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const onStartSession = async () => {
    setBusy(true);
    try {
      const id = randomUUID();
      const started_at = Date.now();
      await createSession(db, { id, started_at });
      setSessionState(startState({ id, started_at }));
      setSetsInSession([]);
    } catch (e) {
      Alert.alert('Could not start session', e instanceof Error ? e.message : String(e));
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
      // Validate the transition then redirect to the detail/summary screen.
      endState(sessionState, ended_at);
      router.push(`/session/${session_id}`);
      // Local state will reset on next focus via refresh().
    } catch (e) {
      Alert.alert('Could not end session', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (sessionState.status === 'idle') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.idleBody}>
          <Text style={styles.heading}>Today</Text>
          <Text style={styles.idleHint}>No session in progress.</Text>
          <Pressable
            accessibilityRole="button"
            onPress={onStartSession}
            disabled={busy}
            style={({ pressed }) => [
              styles.startBtn,
              busy && styles.btnDisabled,
              pressed && styles.btnPressed,
            ]}>
            <Text style={styles.startBtnText}>{busy ? 'Starting…' : 'Start Session'}</Text>
          </Pressable>
        </View>
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
          <Text style={styles.subhead}>
            Session in progress · {setsInSession.length} set
            {setsInSession.length === 1 ? '' : 's'}
          </Text>

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
});
