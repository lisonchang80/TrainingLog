import { randomUUID } from 'expo-crypto';
import { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDatabase } from '@/components/database-provider';
import { listExercises } from '@/src/adapters/sqlite/exerciseRepository';
import { recordSetAsAutoSession } from '@/src/adapters/sqlite/setRepository';
import type { Exercise } from '@/src/domain/exercise/types';
import { validateRecordSet } from '@/src/domain/set/validateRecordSet';

/**
 * Today tab — record a single Set.
 *
 * Slice-1 simplification: only one built-in Exercise (Bench Press) is shown
 * pre-selected; an Exercise picker arrives in slice 2 (Exercise library).
 * Save creates an auto-Session containing the set, then closes the Session
 * (see `recordSetAsAutoSession`).
 */
export default function TodayScreen() {
  const db = useDatabase();
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [weight, setWeight] = useState('');
  const [reps, setReps] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listExercises(db).then((rows) => {
      setExercise(rows[0] ?? null);
    });
  }, [db]);

  const onSave = async () => {
    if (!exercise) {
      Alert.alert('No exercise loaded yet');
      return;
    }
    const weight_kg = Number(weight);
    const repsNum = Number(reps);
    const err = validateRecordSet({
      exercise_id: exercise.id,
      weight_kg,
      reps: repsNum,
    });
    if (err) {
      Alert.alert('Invalid input', err);
      return;
    }

    setSaving(true);
    try {
      await recordSetAsAutoSession(
        db,
        { exercise_id: exercise.id, weight_kg, reps: repsNum },
        randomUUID
      );
      setWeight('');
      setReps('');
      Alert.alert('Saved', `${exercise.name} · ${weight_kg} kg × ${repsNum} reps`);
    } catch (e) {
      Alert.alert('Save failed', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}>
        <View style={styles.body}>
          <Text style={styles.heading}>Record a set</Text>

          <Text style={styles.label}>Exercise</Text>
          <View style={styles.fixedExercise}>
            <Text style={styles.fixedExerciseText}>
              {exercise ? exercise.name : 'Loading...'}
            </Text>
          </View>

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
            onPress={onSave}
            disabled={saving || !exercise}
            style={({ pressed }) => [
              styles.saveBtn,
              (saving || !exercise) && styles.saveBtnDisabled,
              pressed && styles.saveBtnPressed,
            ]}>
            <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save Set'}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  body: { padding: 24, gap: 12 },
  heading: { fontSize: 28, fontWeight: '700', marginBottom: 8 },
  label: { fontSize: 14, fontWeight: '500', marginTop: 8, opacity: 0.7 },
  fixedExercise: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: 'rgba(127,127,127,0.12)',
  },
  fixedExerciseText: { fontSize: 16, fontWeight: '500' },
  input: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: 'rgba(127,127,127,0.12)',
    fontSize: 18,
  },
  saveBtn: {
    marginTop: 24,
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: '#0a7ea4',
    alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnPressed: { opacity: 0.85 },
  saveBtnText: { color: 'white', fontSize: 16, fontWeight: '600' },
});
