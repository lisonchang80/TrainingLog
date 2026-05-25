import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
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
import { t } from '@/src/i18n';
import { useTheme, type ThemeTokens } from '@/src/theme';

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
  const { tokens } = useTheme();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
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
            title: t('button', 'editExercise'),
            headerLeft: () => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('common', 'cancel')}
                onPress={() => router.back()}>
                <Text style={styles.headerCancel}>{t('common', 'cancel')}</Text>
              </Pressable>
            ),
          }}
        />
        <View style={styles.placeholderWrap}>
          <Text style={styles.placeholder}>{t('alert', 'builtinExerciseNoEdit')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Waiting for data load
  if (!initial) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ title: t('button', 'editExercise') }} />
        <View style={styles.placeholderWrap}>
          <Text style={styles.placeholder}>{t('status', 'loading')}</Text>
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
      title={t('button', 'editExercise')}
      initial={initial}
      existingNames={existingNames}
      muscleGroups={muscleGroups}
      onSubmit={handleSubmit}
      onCancel={() => router.back()}
    />
  );
}

function makeStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: tokens.bg.base },
    headerCancel: {
      color: tokens.action.primary,
      fontSize: 17,
      paddingHorizontal: 8,
    },
    placeholderWrap: { padding: 24 },
    placeholder: { fontSize: 14, color: tokens.text.secondary },
  });
}
