import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

import {
  CustomExerciseForm,
  type CustomExerciseInitial,
} from '@/components/exercise/custom-exercise-form';
import { useDatabase } from '@/components/database-provider';
import {
  createCustomExercise,
  listMuscleGroups,
  listMuscles,
} from '@/src/adapters/sqlite/exerciseLibraryRepository';
import { listExercises } from '@/src/adapters/sqlite/exerciseRepository';
import type { CustomExerciseDraft } from '@/src/domain/exercise/exerciseLibrary';
import type { Muscle, MuscleGroup } from '@/src/domain/exercise/types';
import { submitNewlyCreated } from '@/src/domain/exercise/pickerBridge';

const INITIAL_DRAFT: CustomExerciseInitial = {
  name: '',
  muscleGroupId: '',
  equipment: '其他',
  primaryMuscleIds: new Set(),
  secondaryMuscleIds: new Set(),
};

export default function NewExerciseScreen() {
  const db = useDatabase();
  const router = useRouter();
  const [muscleGroups, setMuscleGroups] = useState<MuscleGroup[]>([]);
  const [muscles, setMuscles] = useState<Muscle[]>([]);
  const [existingNames, setExistingNames] = useState<readonly string[]>([]);

  useEffect(() => {
    Promise.all([listMuscleGroups(db), listMuscles(db), listExercises(db)]).then(
      ([mgs, ms, exs]) => {
        setMuscleGroups(mgs);
        setMuscles(ms);
        setExistingNames(exs.filter((e) => e.is_archived !== 1).map((e) => e.name));
      }
    );
  }, [db]);

  const handleSubmit = async (draft: CustomExerciseDraft) => {
    const id = await createCustomExercise(db, draft, () => Crypto.randomUUID());
    // Hand the new id off to library picker (auto-select); browse mode silently drains.
    submitNewlyCreated(id);
    router.back();
  };

  return (
    <CustomExerciseForm
      title="新增自訂動作"
      initial={INITIAL_DRAFT}
      existingNames={existingNames}
      muscleGroups={muscleGroups}
      muscles={muscles}
      onSubmit={handleSubmit}
      onCancel={() => router.back()}
    />
  );
}
