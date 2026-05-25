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

/**
 * Lookup helper used by the cluster A↔B switcher on the per-Exercise history /
 * chart pages (slice 10c overnight #11). Given an exercise_id, returns the
 * exercise's display name, or `null` when no row matches.
 *
 * Cheap single-row SELECT; safe to call inline from `refresh()`. No archived
 * filter — the switcher needs the name regardless of archive state so that a
 * past cluster partner that has since been archived still resolves.
 */
export async function getExerciseName(
  db: Database,
  exercise_id: string
): Promise<string | null> {
  const row = await db.getFirstAsync<{ name: string }>(
    `SELECT name FROM exercise WHERE id = ? LIMIT 1`,
    exercise_id
  );
  return row?.name ?? null;
}
