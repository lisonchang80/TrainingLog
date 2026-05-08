import type { Database } from '../../db/types';
import type { Exercise } from '../../domain/exercise/types';

/**
 * Legacy entry point — the slice 6 schema (v006) widened the Exercise type
 * with `muscle_group_id` + `is_custom`, so the SELECT here mirrors the
 * one in `exerciseLibraryRepository.listExercises`. Existing callers
 * (Today screen, Template editor, Save-back diff) keep working unchanged.
 *
 * Prefer importing from `exerciseLibraryRepository` for new slice 6 work —
 * this file remains for back-compat with slice 1-5 callers.
 */
export async function listExercises(db: Database): Promise<Exercise[]> {
  return db.getAllAsync<Exercise>(
    `SELECT id, name, load_type, is_builtin, is_archived,
            muscle_group_id, is_custom
       FROM exercise
      WHERE is_archived = 0
      ORDER BY name ASC`
  );
}
