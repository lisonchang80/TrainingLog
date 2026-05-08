import type { Database } from '../types';

/**
 * v007 — Body Data v1 (slice 7).
 *
 * Adds:
 *   - `body_metric(id, recorded_at, bodyweight_kg, pbf, smm_kg)` — one row per
 *     recorded measurement. Schema is permissive (all three nullable) so a row
 *     can carry any subset of the three metrics; domain-layer validation
 *     enforces "at least one non-null".
 *
 *   - Initial seed: none. Body data is purely user-supplied.
 *
 * No changes to `app_settings` (already exists from v001 — used here for
 * `unit_preference`) or `session.bodyweight_snapshot_kg` (also v001).
 *
 * Per AC of issue #8 / ADR-0007:
 *   - One day may carry many body_metric rows (no UNIQUE on date).
 *   - Schema stores weights in kg and PBF as %; UI converts on display.
 */
export async function v007_body_metric(db: Database): Promise<void> {
  await db.execAsync(`
    CREATE TABLE body_metric (
      id TEXT PRIMARY KEY NOT NULL,
      recorded_at INTEGER NOT NULL,
      bodyweight_kg REAL,
      pbf REAL,
      smm_kg REAL
    );

    CREATE INDEX idx_body_metric_recorded_at ON body_metric(recorded_at);
  `);
}
