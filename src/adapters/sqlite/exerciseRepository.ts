import type { Database } from '../../db/types';
import type { Exercise } from '../../domain/exercise/types';

export async function listExercises(db: Database): Promise<Exercise[]> {
  return db.getAllAsync<Exercise>(
    `SELECT id, name, load_type, is_builtin, is_archived
       FROM exercise
      WHERE is_archived = 0
      ORDER BY name ASC`
  );
}
