import type { Database } from '../../db/types';
import type {
  Exercise,
  ExerciseMuscleLink,
  ExerciseWithMuscles,
  Muscle,
  MuscleGroup,
} from '../../domain/exercise/types';
import type { CustomExerciseDraft } from '../../domain/exercise/exerciseLibrary';

/**
 * Persistence layer for Exercise Library v1 (slice 6).
 *
 * Reads:
 *   - listMuscleGroups / listMuscles                — reference taxonomy
 *   - listExercisesWithLinks                        — list page (joined for filter)
 *   - getExerciseWithMuscles                        — detail page (with diagram)
 *
 * Writes:
 *   - createCustomExercise                          — Custom Exercise create flow
 *
 * Pattern matches programRepository / templateRepository: pure functions over a
 * `Database` interface; production = expo-sqlite, tests = better-sqlite3 in-mem.
 */

export async function listMuscleGroups(db: Database): Promise<MuscleGroup[]> {
  return db.getAllAsync<MuscleGroup>(
    `SELECT id, name, display_order FROM muscle_group ORDER BY display_order ASC`
  );
}

export async function listMuscles(db: Database): Promise<Muscle[]> {
  return db.getAllAsync<Muscle>(
    `SELECT id, name, mg_id, display_order FROM muscle
      ORDER BY mg_id ASC, display_order ASC`
  );
}

export async function listExercises(db: Database): Promise<Exercise[]> {
  return db.getAllAsync<Exercise>(
    `SELECT id, name, load_type, is_builtin, is_archived,
            muscle_group_id, is_custom,
            equipment, notes, media_path, cues_text
       FROM exercise
      WHERE is_archived = 0
      ORDER BY name ASC`
  );
}

export async function listExerciseMuscleLinks(
  db: Database
): Promise<ExerciseMuscleLink[]> {
  return db.getAllAsync<ExerciseMuscleLink>(
    `SELECT exercise_id, muscle_id, role FROM exercise_muscle`
  );
}

/**
 * Convenience: list exercises and all muscle links in two queries (one round
 * trip is fine since the dataset is bounded ~70 exercises × ~5 links each).
 */
export async function listExercisesWithLinks(db: Database): Promise<{
  exercises: Exercise[];
  links: ExerciseMuscleLink[];
}> {
  const [exercises, links] = await Promise.all([
    listExercises(db),
    listExerciseMuscleLinks(db),
  ]);
  return { exercises, links };
}

export async function getExerciseWithMuscles(
  db: Database,
  id: string
): Promise<ExerciseWithMuscles | null> {
  const exercise = await db.getFirstAsync<Exercise>(
    `SELECT id, name, load_type, is_builtin, is_archived,
            muscle_group_id, is_custom,
            equipment, notes, media_path, cues_text
       FROM exercise WHERE id = ?`,
    id
  );
  if (!exercise) return null;

  const primary = await db.getAllAsync<Muscle>(
    `SELECT m.id, m.name, m.mg_id, m.display_order
       FROM muscle m
       JOIN exercise_muscle em ON em.muscle_id = m.id
      WHERE em.exercise_id = ? AND em.role = 'primary'
      ORDER BY m.display_order ASC`,
    id
  );
  const secondary = await db.getAllAsync<Muscle>(
    `SELECT m.id, m.name, m.mg_id, m.display_order
       FROM muscle m
       JOIN exercise_muscle em ON em.muscle_id = m.id
      WHERE em.exercise_id = ? AND em.role = 'secondary'
      ORDER BY m.display_order ASC`,
    id
  );

  return { exercise, primary, secondary };
}

export async function getExerciseMuscleLinks(
  db: Database,
  exerciseId: string
): Promise<ExerciseMuscleLink[]> {
  return db.getAllAsync<ExerciseMuscleLink>(
    `SELECT exercise_id, muscle_id, role FROM exercise_muscle WHERE exercise_id = ?`,
    exerciseId
  );
}

/**
 * ADR-0017 Q7 「N 次」徽章 — number of distinct Sessions where this exercise
 * had at least one **done** (`is_skipped = 0`) set.
 *
 * Derived (no cached column on `exercise`). Library grid calls
 * `getExerciseSessionCounts` once, detail page calls
 * `getExerciseSessionCount` for a single id; 0 returns from the map mean
 * "no done sets ever" — UI hides the badge per ADR-0017 「0 次時不顯示」.
 *
 * Note: the spec text in ADR says `is_done = 1`; the v001 schema actually
 * uses `is_skipped` (inverse), so the predicate here is `is_skipped = 0`.
 * Semantically identical.
 */
export async function getExerciseSessionCount(
  db: Database,
  exerciseId: string
): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(DISTINCT session_id) AS n
       FROM "set"
      WHERE exercise_id = ? AND is_skipped = 0`,
    exerciseId
  );
  return row?.n ?? 0;
}

export async function getExerciseSessionCounts(
  db: Database
): Promise<Map<string, number>> {
  const rows = await db.getAllAsync<{ exercise_id: string; n: number }>(
    `SELECT exercise_id, COUNT(DISTINCT session_id) AS n
       FROM "set"
      WHERE is_skipped = 0
      GROUP BY exercise_id`
  );
  return new Map(rows.map((r) => [r.exercise_id, r.n]));
}

/**
 * Insert a Custom Exercise + its muscle mapping rows in one transaction.
 *
 * @param uuid — UUID generator. REQUIRED, no default — Hermes lacks
 *   `crypto.randomUUID` so we always inject `randomUUID` from `expo-crypto`
 *   in production / a deterministic stub in tests (see ADR-0008 + slice 1
 *   gotcha encoded in ship-slice skill).
 */
export async function createCustomExercise(
  db: Database,
  draft: CustomExerciseDraft,
  uuid: () => string
): Promise<string> {
  const id = uuid();

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO exercise (id, name, load_type, is_builtin, is_archived,
                             muscle_group_id, is_custom, equipment)
       VALUES (?, ?, ?, 0, 0, ?, 1, ?)`,
      id,
      draft.name.trim(),
      draft.load_type,
      draft.muscle_group_id,
      draft.equipment
    );
    for (const mid of draft.primaryMuscleIds) {
      await db.runAsync(
        `INSERT INTO exercise_muscle (exercise_id, muscle_id, role)
         VALUES (?, ?, 'primary')`,
        id,
        mid
      );
    }
    for (const mid of draft.secondaryMuscleIds) {
      // Skip if already in primary (defence in depth — UI should prevent it)
      if (draft.primaryMuscleIds.includes(mid)) continue;
      await db.runAsync(
        `INSERT INTO exercise_muscle (exercise_id, muscle_id, role)
         VALUES (?, ?, 'secondary')`,
        id,
        mid
      );
    }
  });

  return id;
}
