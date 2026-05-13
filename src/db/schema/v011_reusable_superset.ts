import type { Database } from '../types';

/**
 * v011 — Reusable Superset entity (ADR-0017 Q10).
 *
 * v1 fixed at 2 exercises per superset (UI prevents creating size != 2).
 * `superset_exercise` table is the order-preserving link; PRIMARY KEY
 * (superset_id, position) prevents duplicate slots.
 *
 * Use count is a cached column on `superset` row, bumped by the domain layer
 * each time the superset is exploded into a Template (per ADR-0017 Q10).
 * Reading it doesn't require a JOIN aggregate.
 *
 * Color: 12-color palette per ADR-0015 (reuses Template per-name color
 * convention).
 *
 * Cross-ADR:
 *   - ADR-0015 (Template per-name color) — palette reused
 *   - ADR-0016 (Template editor + per-set schema) — explode model reuses
 *     superset pair UX via template_exercise.parent_id
 *   - ADR-0017 (Reusable Superset entity)
 */
export async function v011_reusable_superset(db: Database): Promise<void> {
  await db.execAsync(`
    CREATE TABLE superset (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      color_hex TEXT,
      use_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE superset_exercise (
      superset_id TEXT NOT NULL REFERENCES superset(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      exercise_id TEXT NOT NULL REFERENCES exercise(id),
      PRIMARY KEY (superset_id, position)
    );

    CREATE INDEX idx_superset_exercise_exercise ON superset_exercise(exercise_id);
  `);
}
