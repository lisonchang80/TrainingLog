import type { Database } from '../types';

/**
 * v001 — initial schema.
 *
 * Tables:
 *   - session       (workout instances)
 *   - exercise      (built-in + user-defined exercise definitions)
 *   - set           (one performed set within a session)
 *   - app_settings  (key/value, JSON-encoded values)
 *
 * Seed:
 *   - one built-in exercise: "Bench Press" (loaded)
 *
 * IDs are UUID strings (per ADR-0008). Generated client-side via `crypto.randomUUID()`.
 * Timestamps are unix epoch milliseconds (INTEGER).
 */

const BENCH_PRESS_ID = '00000000-0000-4000-8000-000000000001';

export async function v001_initial(db: Database): Promise<void> {
  await db.execAsync(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      bodyweight_snapshot_kg REAL
    );

    CREATE TABLE exercise (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      load_type TEXT NOT NULL CHECK(load_type IN ('loaded','bodyweight','assisted')),
      is_builtin INTEGER NOT NULL DEFAULT 0,
      is_archived INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE "set" (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL REFERENCES session(id),
      exercise_id TEXT NOT NULL REFERENCES exercise(id),
      weight_kg REAL,
      reps INTEGER,
      is_skipped INTEGER NOT NULL DEFAULT 0,
      ordering INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX idx_set_session ON "set"(session_id);
    CREATE INDEX idx_set_exercise ON "set"(exercise_id);

    CREATE TABLE app_settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT
    );
  `);

  // Seed built-in exercise. INSERT OR IGNORE makes migration idempotent
  // even if a partially-applied previous run left the row behind.
  await db.runAsync(
    `INSERT OR IGNORE INTO exercise (id, name, load_type, is_builtin)
     VALUES (?, ?, ?, ?)`,
    BENCH_PRESS_ID,
    'Bench Press',
    'loaded',
    1
  );
}
