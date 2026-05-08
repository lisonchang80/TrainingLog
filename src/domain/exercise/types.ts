export type LoadType = 'loaded' | 'bodyweight' | 'assisted';

export type MuscleRole = 'primary' | 'secondary';

export interface Exercise {
  id: string;
  name: string;
  load_type: LoadType;
  is_builtin: number; // SQLite stores 0/1
  is_archived: number;
  muscle_group_id: string | null;
  is_custom: number; // 0/1
}

export interface MuscleGroup {
  id: string;
  name: string;
  display_order: number;
}

export interface Muscle {
  id: string;
  name: string;
  mg_id: string;
  display_order: number;
}

export interface ExerciseMuscleLink {
  exercise_id: string;
  muscle_id: string;
  role: MuscleRole;
}

/** Exercise + its muscle activation, used by the detail page. */
export interface ExerciseWithMuscles {
  exercise: Exercise;
  primary: Muscle[];
  secondary: Muscle[];
}
