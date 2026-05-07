import type { Database } from '../types';

/**
 * v003 — Templates + per-Session snapshots (slice 3).
 *
 * New tables:
 *   - template               (named workout plan)
 *   - template_exercise      (ordered list of exercises + planned sets/reps/weight per template)
 *   - session_exercise       (snapshot of a template's exercises captured at Session start)
 *
 * Snapshot isolation (acceptance criterion #4): `session_exercise` rows are a
 * frozen copy of the template's `template_exercise` rows at the moment a Session
 * starts. Editing the template after that does NOT affect already-started or
 * already-ended Sessions — they keep their snapshot rows untouched.
 *
 * `template_id` on `session_exercise` is nullable so a Session can also be
 * started "blank" (slice 2 flow) and still hold per-Session planned exercises
 * later if we want; for slice 3 it always points at the source template.
 */
export async function v003_templates(db: Database): Promise<void> {
  await db.execAsync(`
    CREATE TABLE template (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE template_exercise (
      id TEXT PRIMARY KEY NOT NULL,
      template_id TEXT NOT NULL REFERENCES template(id),
      exercise_id TEXT NOT NULL REFERENCES exercise(id),
      ordering INTEGER NOT NULL,
      default_sets INTEGER NOT NULL,
      default_reps INTEGER,
      default_weight_kg REAL
    );

    CREATE INDEX idx_template_exercise_template ON template_exercise(template_id);

    CREATE TABLE session_exercise (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL REFERENCES session(id),
      exercise_id TEXT NOT NULL REFERENCES exercise(id),
      ordering INTEGER NOT NULL,
      planned_sets INTEGER NOT NULL,
      planned_reps INTEGER,
      planned_weight_kg REAL,
      template_id TEXT
    );

    CREATE INDEX idx_session_exercise_session ON session_exercise(session_id);
  `);
}
