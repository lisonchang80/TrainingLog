export type LoadType = 'loaded' | 'bodyweight' | 'assisted';

export type MuscleRole = 'primary' | 'secondary';

/**
 * Equipment classification (ADR-0017 Q6). 8 enum values; CHECK constraint
 * enforced at the DB layer (v010 migration).
 *
 * `自重` replaces v0–v009 informal label 「徒手」 per Q6.
 * `史密斯機` and `壺鈴` have zero built-in seeds — reserved for Custom
 * exercises.
 */
export type Equipment =
  | '槓鈴'
  | '啞鈴'
  | '史密斯機'
  | '滑輪'
  | '固定機械'
  | '自重'
  | '壺鈴'
  | '其他';

export const EQUIPMENT_VALUES: readonly Equipment[] = [
  '槓鈴',
  '啞鈴',
  '史密斯機',
  '滑輪',
  '固定機械',
  '自重',
  '壺鈴',
  '其他',
] as const;

export interface Exercise {
  id: string;
  name: string;
  load_type: LoadType;
  is_builtin: number; // SQLite stores 0/1
  is_archived: number;
  muscle_group_id: string | null;
  is_custom: number; // 0/1
  /** ADR-0017 Q6 — 8-enum equipment (default '其他'). */
  equipment: Equipment;
  /** ADR-0017 Q5 — per-Exercise global notes; replaces v009 template_exercise.notes. */
  notes: string | null;
  /** ADR-0017 Q8 — local file path for ≤5 sec mp4 demo loop. */
  media_path: string | null;
  /** ADR-0017 Q3 — placeholder for v1; populated in v1.5+ when cue copy ships. */
  cues_text: string | null;
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
