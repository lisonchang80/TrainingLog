import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  CustomExerciseForm,
  type CustomExerciseInitial,
} from '@/components/exercise/custom-exercise-form';
import { useDatabase } from '@/components/database-provider';
import {
  getExerciseWithMuscles,
  listMuscleGroups,
  updateCustomExercise,
} from '@/src/adapters/sqlite/exerciseLibraryRepository';
import { listExercises } from '@/src/adapters/sqlite/exerciseRepository';
import type { CustomExerciseDraft } from '@/src/domain/exercise/exerciseLibrary';
import type {
  Equipment,
  ExerciseWithMuscles,
  MuscleGroup,
} from '@/src/domain/exercise/types';

/**
 * Custom Exercise edit screen — thin wrapper around `<CustomExerciseForm>`.
 *
 * Built-in exercises (is_custom !== 1) show a readonly placeholder. SQL UPDATE
 * also guards via `WHERE is_custom = 1` (defence in depth).
 */
export default function EditExerciseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDatabase();
  const router = useRouter();
  const [original, setOriginal] = useState<ExerciseWithMuscles | null>(null);
  const [initial, setInitial] = useState<CustomExerciseInitial | null>(null);
  const [muscleGroups, setMuscleGroups] = useState<MuscleGroup[]>([]);
  const [existingNames, setExistingNames] = useState<readonly string[]>([]);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      getExerciseWithMuscles(db, id),
      listMuscleGroups(db),
      listExercises(db),
    ]).then(([d, mgs, exs]) => {
      setMuscleGroups(mgs);
      if (d) {
        setOriginal(d);
        setInitial({
          name: d.exercise.name,
          // Legacy rows may have NULL mg; treat as empty string so form picker forces selection.
          muscleGroupId: d.exercise.muscle_group_id ?? '',
          equipment: d.exercise.equipment as Equipment,
          primaryMuscleIds: new Set(d.primary.map((m) => m.id)),
          secondaryMuscleIds: new Set(d.secondary.map((m) => m.id)),
        });
      }
      // Exclude own name from dup-check (case-insensitive, trimmed) so saving without
      // renaming doesn't trigger the dup error.
      const ownName = d ? d.exercise.name.trim().toLowerCase() : null;
      setExistingNames(
        exs
          .filter((e) => e.is_archived !== 1)
          .map((e) => e.name)
          .filter((n) => n.trim().toLowerCase() !== ownName)
      );
    });
  }, [db, id]);

  // Built-in: readonly placeholder, no form rendered.
  if (original && original.exercise.is_custom !== 1) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen
          options={{
            title: '編輯動作',
            headerLeft: () => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="取消"
                onPress={() => router.back()}>
                <Text style={styles.headerCancel}>取消</Text>
              </Pressable>
            ),
          }}
        />
        <View style={styles.placeholderWrap}>
          <Text style={styles.placeholder}>內建動作目前無可編輯內容。</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Waiting for data load
  if (!initial) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ title: '編輯動作' }} />
        <View style={styles.placeholderWrap}>
          <Text style={styles.placeholder}>載入中…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const handleSubmit = async (draft: CustomExerciseDraft) => {
    if (!id) return;
    await updateCustomExercise(db, id, draft);
    router.back();
  };

  return (
    <CustomExerciseForm
      title="編輯動作"
      initial={initial}
      existingNames={existingNames}
      muscleGroups={muscleGroups}
      onSubmit={handleSubmit}
      onCancel={() => router.back()}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerCancel: {
    color: '#0a7ea4',
    fontSize: 17,
    paddingHorizontal: 8,
  },
  placeholderWrap: { padding: 24 },
  placeholder: { fontSize: 14, opacity: 0.6 },
});
