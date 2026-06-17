import type { Database } from '../types';
import { ACHIEVEMENT_DEFINITION_SEEDS } from '../seed/v008Achievements';

/**
 * v008 — Achievement system schema (ADR-0009 / slice 9).
 *
 * Tables:
 *   - achievement_definition: 255 system-seeded rows. Immutable in v1.
 *   - achievement_unlock:     user-state, one row per unlocked definition.
 *
 * Categories (encoded in `category`):
 *   first_combo    : (mg_id, bucket_id)            55 rows
 *   pr_per_mg      : (mg_id, pr_type, threshold)  132 rows
 *   pr_per_bucket  : (bucket_id, pr_type, thresh)  60 rows
 *   session_count  : (threshold)                    8 rows
 *
 * Note: we do NOT introduce a `bucket_constants` table — buckets remain pure
 * runtime constants (src/domain/pr/buckets.ts). `bucket_id` here stores the
 * BucketKey string (`max_strength`, etc.) for join semantic; the bucket label
 * is rendered at display time via `bucketLabel()`.
 */
export async function v008_achievements(db: Database): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS achievement_definition (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL CHECK (category IN ('first_combo','pr_per_mg','pr_per_bucket','session_count')),
      display_name TEXT NOT NULL,
      description TEXT,
      mg_id TEXT REFERENCES muscle_group(id),
      bucket_id TEXT,
      pr_type TEXT CHECK (pr_type IN ('weight','volume')),
      threshold INTEGER,
      tier INTEGER NOT NULL DEFAULT 1
    );

    CREATE INDEX IF NOT EXISTS idx_ach_def_category ON achievement_definition(category);
    CREATE INDEX IF NOT EXISTS idx_ach_def_mg ON achievement_definition(mg_id);
    CREATE INDEX IF NOT EXISTS idx_ach_def_bucket ON achievement_definition(bucket_id);

    CREATE TABLE IF NOT EXISTS achievement_unlock (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      achievement_definition_id INTEGER NOT NULL UNIQUE REFERENCES achievement_definition(id),
      unlocked_at INTEGER NOT NULL,
      session_id TEXT NOT NULL REFERENCES session(id),
      set_id TEXT REFERENCES "set"(id)
    );

    CREATE INDEX IF NOT EXISTS idx_ach_unlock_session ON achievement_unlock(session_id);
  `);

  // Seed all 255 definitions. INSERT OR IGNORE keeps migration idempotent.
  for (const def of ACHIEVEMENT_DEFINITION_SEEDS) {
    await db.runAsync(
      `INSERT OR IGNORE INTO achievement_definition
         (code, category, display_name, description, mg_id, bucket_id, pr_type, threshold, tier)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      def.code,
      def.category,
      def.display_name,
      def.description,
      def.mg_id,
      def.bucket_id,
      def.pr_type,
      def.threshold,
      def.tier
    );
  }
}
