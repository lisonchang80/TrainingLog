import type { Database } from '../../db/types';
import type {
  Exercise,
  ExerciseMuscleLink,
  ExerciseWithMuscles,
  Muscle,
  MuscleGroup,
} from '../../domain/exercise/types';
import { inferLoadType } from '../../domain/exercise/exerciseLibrary';
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
 * has at least one ✓ **logged** (`is_skipped = 0 AND is_logged = 1`) set.
 *
 * Derived (no cached column on `exercise`). Library grid calls
 * `getExerciseSessionCounts` once, detail page calls
 * `getExerciseSessionCount` for a single id; 0 returns from the map mean
 * "no logged sets ever" — UI hides the badge per ADR-0017 「0 次時不顯示」.
 *
 * 方向 A 對齊 `getExerciseHistoryHeader` / `getExerciseHistoryBySession` 的
 * `is_logged = 1` filter (per 用戶 5/18 中午拍板) — 「N 次 Session」一致
 * 指 ✓ 完成 N 次 Session，純 planned (未 ✓) session 不計入。
 *
 * Note: the spec text in ADR says `is_done = 1`; the v001 schema actually
 * uses `is_skipped` (inverse), so the predicate here is `is_skipped = 0`;
 * `is_logged = 1` is the v015 per-row 完成 flag.
 */
export async function getExerciseSessionCount(
  db: Database,
  exerciseId: string
): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(DISTINCT session_id) AS n
       FROM "set"
      WHERE exercise_id = ? AND is_skipped = 0 AND is_logged = 1`,
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
      WHERE is_skipped = 0 AND is_logged = 1
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
  const loadType = inferLoadType(draft.equipment);

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO exercise (id, name, load_type, is_builtin, is_archived,
                             muscle_group_id, is_custom, equipment)
       VALUES (?, ?, ?, 0, 0, ?, 1, ?)`,
      id,
      draft.name.trim(),
      loadType,
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

export async function archiveCustomExercise(
  db: Database,
  id: string
): Promise<void> {
  await db.runAsync(
    `UPDATE exercise SET is_archived = 1 WHERE id = ? AND is_custom = 1`,
    id
  );
}

/**
 * Update the global notes for an exercise (per ADR-0019 ⚙️ menu's 📝
 * option, slice 10c Phase 4 commit 18). Works for both built-in and
 * custom exercises — notes is a v010 column that any exercise can have.
 *
 * Empty / whitespace-only input is coerced to NULL upstream by the
 * SetNoteSheet so the indicator stays consistent with the per-set
 * `notes` semantics from commit 7c.
 */
/**
 * Read the global notes for an exercise (for prefilling the 📝 sheet).
 * Returns null when the row has no notes (or the row doesn't exist —
 * caller shouldn't get there with a valid exercise_id).
 */
export async function getExerciseNotes(
  db: Database,
  exercise_id: string
): Promise<string | null> {
  const row = await db.getFirstAsync<{ notes: string | null }>(
    `SELECT notes FROM exercise WHERE id = ?`,
    exercise_id
  );
  return row?.notes ?? null;
}

export async function updateExerciseNotes(
  db: Database,
  exercise_id: string,
  notes: string | null
): Promise<void> {
  await db.runAsync(
    `UPDATE exercise SET notes = ? WHERE id = ?`,
    notes,
    exercise_id
  );
}

export async function updateCustomExercise(
  db: Database,
  id: string,
  draft: CustomExerciseDraft
): Promise<void> {
  const loadType = inferLoadType(draft.equipment);

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE exercise
       SET name = ?, load_type = ?, muscle_group_id = ?, equipment = ?
       WHERE id = ? AND is_custom = 1`,
      draft.name.trim(),
      loadType,
      draft.muscle_group_id,
      draft.equipment,
      id
    );
    await db.runAsync(`DELETE FROM exercise_muscle WHERE exercise_id = ?`, id);
    for (const mid of draft.primaryMuscleIds) {
      await db.runAsync(
        `INSERT INTO exercise_muscle (exercise_id, muscle_id, role)
         VALUES (?, ?, 'primary')`,
        id,
        mid
      );
    }
    for (const mid of draft.secondaryMuscleIds) {
      if (draft.primaryMuscleIds.includes(mid)) continue;
      await db.runAsync(
        `INSERT INTO exercise_muscle (exercise_id, muscle_id, role)
         VALUES (?, ?, 'secondary')`,
        id,
        mid
      );
    }
  });
}
