/**
 * Exercise Library (pure logic, no DB) — filter / classify / validate.
 *
 * Slice 6 introduces the 11-MG / 19-muscle taxonomy plus Custom Exercise
 * creation. The Library list page reads rows from the repository and applies
 * `filterExercises` to render only the matching rows; the Custom Exercise
 * form runs `validateCustomExerciseDraft` before submitting.
 *
 * Pure functions only. Tested in `tests/domain/exerciseLibrary.test.ts`.
 */

import { EQUIPMENT_VALUES } from './types';
import type {
  Equipment,
  Exercise,
  ExerciseMuscleLink,
  LoadType,
  MuscleRole,
} from './types';

export interface ExerciseFilter {
  /** Filter by muscle_group_id (single MG); null/undefined = no MG filter. */
  muscleGroupId?: string | null;
  /** Filter by muscle_id (single muscle); rows that activate this muscle in
   *  ANY role pass. null/undefined = no muscle filter. */
  muscleId?: string | null;
  /** Filter by load_type; null/undefined = no load_type filter. */
  loadType?: LoadType | null;
  /** Filter by equipment (ADR-0017 Q6); null/undefined = no equipment filter. */
  equipment?: Equipment | null;
  /** Free-text name match (case-insensitive substring). Empty/undefined = no search. */
  search?: string | null;
  /** When true, hide rows whose `is_archived = 1`. Defaults to true. */
  excludeArchived?: boolean;
}

/**
 * Apply a filter spec against a list of exercises + their muscle links.
 *
 * `links` is a flat list of all `exercise_muscle` rows for the candidate set;
 * the caller is responsible for fetching them — this function does not query
 * the DB.
 */
export function filterExercises(
  exercises: Exercise[],
  links: ExerciseMuscleLink[],
  filter: ExerciseFilter
): Exercise[] {
  const excludeArchived = filter.excludeArchived ?? true;
  const search = filter.search?.trim().toLowerCase() ?? '';
  const muscleId = filter.muscleId ?? null;

  // Pre-compute a Set of exercise_ids that activate the muscleId — O(N) once
  // instead of O(N×M) re-scanning links per exercise.
  let muscleHits: Set<string> | null = null;
  if (muscleId) {
    muscleHits = new Set();
    for (const l of links) {
      if (l.muscle_id === muscleId) muscleHits.add(l.exercise_id);
    }
  }

  return exercises.filter((ex) => {
    if (excludeArchived && ex.is_archived === 1) return false;
    if (filter.muscleGroupId && ex.muscle_group_id !== filter.muscleGroupId) {
      return false;
    }
    if (filter.loadType && ex.load_type !== filter.loadType) return false;
    if (filter.equipment && ex.equipment !== filter.equipment) return false;
    if (muscleHits && !muscleHits.has(ex.id)) return false;
    if (search && !ex.name.toLowerCase().includes(search)) return false;
    return true;
  });
}

// ---------- Custom Exercise validation ----------

export interface CustomExerciseDraft {
  name: string;
  load_type: LoadType;
  muscle_group_id: string | null;
  /** ADR-0017 Q6 — 8-enum equipment classification (default '其他' if unset). */
  equipment: Equipment;
  /** Muscle IDs assigned the `primary` role. */
  primaryMuscleIds: string[];
  /** Muscle IDs assigned the `secondary` role. */
  secondaryMuscleIds: string[];
}

export interface ValidationError {
  field: keyof CustomExerciseDraft | 'general';
  message: string;
}

export interface ValidateOptions {
  /**
   * Names of non-archived exercises that already exist. Names compared
   * case-insensitively after trim — "Bench Press" collides with "bench press".
   * Caller passes Set or array; we treat them the same.
   *
   * Note: pass the FULL list (both built-in + custom). Pure validator stays
   * DB-agnostic; the form loads the list once on mount.
   */
  existingNames?: readonly string[] | Set<string>;
}

/**
 * Validate a Custom Exercise draft per ADR-0010 acceptance:
 *   - name required, ≤ 60 chars after trim, AND case-insensitively unique
 *     against `options.existingNames` (when provided)
 *   - load_type ∈ {loaded, bodyweight, assisted}
 *   - muscle_group_id may be null (Custom Exercise allowed without MG per
 *     ADR-0010 #9), but if provided must be a non-empty string
 *   - a muscle id may not appear in BOTH primary and secondary lists
 *     (single role per muscle per exercise — matches PRIMARY KEY constraint)
 *   - duplicate muscle ids within either list collapse to one (caller may
 *     dedupe before calling, but we don't reject on duplicates)
 */
export function validateCustomExerciseDraft(
  draft: CustomExerciseDraft,
  options: ValidateOptions = {}
): ValidationError[] {
  const errors: ValidationError[] = [];

  const name = draft.name.trim();
  if (!name) {
    errors.push({ field: 'name', message: '請輸入動作名稱' });
  } else if (name.length > 60) {
    errors.push({ field: 'name', message: '動作名稱請少於 60 字元' });
  } else if (options.existingNames) {
    const needle = name.toLowerCase();
    const set =
      options.existingNames instanceof Set
        ? options.existingNames
        : new Set(options.existingNames);
    // Normalise comparison: trimmed + lowercased on both sides
    for (const n of set) {
      if (n.trim().toLowerCase() === needle) {
        errors.push({ field: 'name', message: '已有同名動作，請改個名字' });
        break;
      }
    }
  }

  const validLoad: LoadType[] = ['loaded', 'bodyweight', 'assisted'];
  if (!validLoad.includes(draft.load_type)) {
    errors.push({ field: 'load_type', message: 'load_type 必須是 loaded / bodyweight / assisted' });
  }

  if (draft.muscle_group_id !== null && draft.muscle_group_id.trim() === '') {
    errors.push({
      field: 'muscle_group_id',
      message: 'muscle_group_id 不可為空字串（傳 null 或合法 id）',
    });
  }

  if (!EQUIPMENT_VALUES.includes(draft.equipment)) {
    errors.push({
      field: 'equipment',
      message: 'equipment 必須是合法的 8 種分類之一',
    });
  }

  const primarySet = new Set(draft.primaryMuscleIds);
  const overlap = draft.secondaryMuscleIds.filter((id) => primarySet.has(id));
  if (overlap.length > 0) {
    errors.push({
      field: 'general',
      message: `肌群不可同時為主要與次要：${overlap.join(', ')}`,
    });
  }

  return errors;
}

/**
 * Group muscle links by role. Helper for UI rendering.
 *
 * Returns sorted arrays preserving the input link order for stability.
 */
export function partitionMuscleLinksByRole(
  links: ExerciseMuscleLink[]
): { primary: string[]; secondary: string[] } {
  const primary: string[] = [];
  const secondary: string[] = [];
  for (const l of links) {
    if (l.role === 'primary') primary.push(l.muscle_id);
    else if (l.role === 'secondary') secondary.push(l.muscle_id);
  }
  return { primary, secondary };
}

/**
 * For the body diagram: given an exercise's muscle activation, return a map
 * `muscle_id → role` so the SVG renderer can pick a fill color per path.
 *
 * Primary wins over secondary if a muscle id (defensively) appears as both —
 * matters for Custom Exercises that bypass the validation above.
 */
export function muscleHighlightMap(
  links: ExerciseMuscleLink[]
): Map<string, MuscleRole> {
  const m = new Map<string, MuscleRole>();
  for (const l of links) {
    const existing = m.get(l.muscle_id);
    if (existing === 'primary') continue; // already highlighted at strongest level
    m.set(l.muscle_id, l.role);
  }
  return m;
}
