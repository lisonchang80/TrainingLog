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
} from '@/src/adapters/sqlite/exerciseLibraryRepository';
import { listExercises } from '@/src/adapters/sqlite/exerciseRepository';
import type { CustomExerciseDraft } from '@/src/domain/exercise/exerciseLibrary';
import type { MuscleGroup } from '@/src/domain/exercise/types';
import { submitNewlyCreated } from '@/src/domain/exercise/pickerBridge';
import { t } from '@/src/i18n';

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
  const [existingNames, setExistingNames] = useState<readonly string[]>([]);

  useEffect(() => {
    Promise.all([listMuscleGroups(db), listExercises(db)]).then(([mgs, exs]) => {
      setMuscleGroups(mgs);
      setExistingNames(exs.filter((e) => e.is_archived !== 1).map((e) => e.name));
    });
  }, [db]);

  const handleSubmit = async (draft: CustomExerciseDraft) => {
    const id = await createCustomExercise(db, draft, () => Crypto.randomUUID());
    // Hand the new id off to library picker (auto-select); browse mode silently drains.
    submitNewlyCreated(id);
    router.back();
  };

  return (
    <CustomExerciseForm
      title={t('button', 'addCustomExercise')}
      initial={INITIAL_DRAFT}
      existingNames={existingNames}
      muscleGroups={muscleGroups}
      onSubmit={handleSubmit}
      onCancel={() => router.back()}
    />
  );
}
