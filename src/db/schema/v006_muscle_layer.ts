import type { Database } from '../types';
import {
  MUSCLE_GROUP_SEEDS,
  MUSCLE_SEEDS,
  EXERCISE_LIBRARY_SEEDS,
} from '../seed/v006ExerciseLibrary';

/**
 * v006 — Anatomical muscle layer + Exercise Library v1 (slice 6).
 *
 * Implements ADR-0010:
 *   - 11 muscle_group seed (胸/背/腿/臀/肩/斜方肌/二頭/三頭/小腿/前臂/核心)
 *   - 19 muscle seed (anatomical layer)
 *   - exercise_muscle m:n with role ∈ {primary, secondary}
 *   - exercise.muscle_group_id (single-FK categorize layer)
 *   - exercise.is_custom (user-defined vs built-in)
 *   - 65 built-in exercise seed with muscle mapping + load_type
 *
 * Seeds are imported from `src/db/seed/v006ExerciseLibrary.ts` so tests can
 * assert against the same constants without duplicating data.
 *
 * Idempotent — every INSERT uses OR IGNORE; existing rows from v001/v002
 * (Bench Press / Back Squat / Deadlift / Overhead Press / Barbell Row /
 * Pull-up / Push-up) get backfilled with `muscle_group_id` + their muscle
 * mapping rows here (will already exist if user re-runs migration after
 * partial failure — OR IGNORE handles it).
 */
export async function v006_muscle_layer(db: Database): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS muscle_group (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL UNIQUE,
      display_order INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS muscle (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL UNIQUE,
      mg_id TEXT NOT NULL REFERENCES muscle_group(id),
      display_order INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS exercise_muscle (
      exercise_id TEXT NOT NULL REFERENCES exercise(id),
      muscle_id TEXT NOT NULL REFERENCES muscle(id),
      role TEXT NOT NULL CHECK (role IN ('primary','secondary')),
      PRIMARY KEY (exercise_id, muscle_id)
    );

    CREATE INDEX IF NOT EXISTS idx_exercise_muscle_exercise ON exercise_muscle(exercise_id);
    CREATE INDEX IF NOT EXISTS idx_exercise_muscle_muscle ON exercise_muscle(muscle_id);

    ALTER TABLE exercise ADD COLUMN muscle_group_id TEXT REFERENCES muscle_group(id);
    ALTER TABLE exercise ADD COLUMN is_custom INTEGER NOT NULL DEFAULT 0;

    CREATE INDEX IF NOT EXISTS idx_exercise_mg ON exercise(muscle_group_id);
  `);

  // Seed muscle_group
  for (const mg of MUSCLE_GROUP_SEEDS) {
    await db.runAsync(
      `INSERT OR IGNORE INTO muscle_group (id, name, display_order) VALUES (?, ?, ?)`,
      mg.id,
      mg.name,
      mg.display_order
    );
  }

  // Seed muscle
  for (const m of MUSCLE_SEEDS) {
    await db.runAsync(
      `INSERT OR IGNORE INTO muscle (id, name, mg_id, display_order) VALUES (?, ?, ?, ?)`,
      m.id,
      m.name,
      m.mg_id,
      m.display_order
    );
  }

  // Seed exercises (new) + backfill existing 7 with muscle_group_id
  for (const ex of EXERCISE_LIBRARY_SEEDS) {
    // INSERT OR IGNORE preserves rows already created by v001/v002 (id collides);
    // for those rows we still need to backfill muscle_group_id, so UPDATE after.
    await db.runAsync(
      `INSERT OR IGNORE INTO exercise (id, name, load_type, is_builtin, muscle_group_id)
       VALUES (?, ?, ?, ?, ?)`,
      ex.id,
      ex.name,
      ex.load_type,
      1,
      ex.muscle_group_id
    );
    // Backfill v001/v002 rows whose muscle_group_id is still NULL.
    await db.runAsync(
      `UPDATE exercise SET muscle_group_id = ? WHERE id = ? AND muscle_group_id IS NULL`,
      ex.muscle_group_id,
      ex.id
    );
  }

  // Seed exercise_muscle mapping
  for (const ex of EXERCISE_LIBRARY_SEEDS) {
    for (const mid of ex.primary) {
      await db.runAsync(
        `INSERT OR IGNORE INTO exercise_muscle (exercise_id, muscle_id, role)
         VALUES (?, ?, 'primary')`,
        ex.id,
        mid
      );
    }
    for (const mid of ex.secondary) {
      await db.runAsync(
        `INSERT OR IGNORE INTO exercise_muscle (exercise_id, muscle_id, role)
         VALUES (?, ?, 'secondary')`,
        ex.id,
        mid
      );
    }
  }
}
