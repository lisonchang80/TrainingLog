import type { Database } from '../types';

/**
 * v015 — Set table cluster + lifecycle columns (slice 10a foundation).
 *
 * Adds three columns to the runtime `set` table to support ADR-0019's
 * session UI/UX integral redesign:
 *
 *   - `set_kind TEXT NOT NULL DEFAULT 'working'` — same enum as v009
 *     `template_set.set_kind` (warmup / working / dropset). Replaces the
 *     `is_warmup BOOLEAN` design from ADR-0012 § 161 that was *planned* but
 *     never landed on the runtime `set` table (verified by grep on
 *     2026-05-16 — no schema file ever added the column). Existing rows
 *     therefore default cleanly to 'working'; no data migration needed.
 *
 *   - `parent_set_id TEXT NULL` — no FK, mirrors the v014
 *     `session_exercise.parent_id` convention. Points to another `set.id`
 *     within the same session/exercise. NULL = solo set. Used by Q2.4
 *     "一 cycle 一 ✓" cluster semantics + dropset chains (cluster member
 *     sets share a parent root set).
 *
 *   - `is_logged INTEGER NOT NULL DEFAULT 0` — per-row "set 完成" flag.
 *     Tap ✓ in session UI flips this to 1 (and starts rest timer). Cluster
 *     ✓ writes is_logged=1 to ALL cluster members transactionally
 *     (per ADR-0019 Q2.4). Existing rows default to 0; downstream readers
 *     that don't care about completion semantics are unaffected.
 *
 * Idempotency: PRAGMA table_info introspection before each ADD COLUMN, so
 * a re-run on an already-migrated DB is a no-op (sibling pattern: v014).
 *
 * SQLite gotcha: ADD COLUMN with DEFAULT requires constant default; the
 * literals 'working' and 0 used here are constant — no expression default.
 */
export async function v015_set_kind_and_clusters(db: Database): Promise<void> {
  const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info("set")`);
  const have = new Set(cols.map((c) => c.name));

  if (!have.has('set_kind')) {
    await db.execAsync(`
      ALTER TABLE "set" ADD COLUMN set_kind TEXT NOT NULL DEFAULT 'working'
        CHECK(set_kind IN ('warmup','working','dropset'));
    `);
  }

  if (!have.has('parent_set_id')) {
    await db.execAsync(`ALTER TABLE "set" ADD COLUMN parent_set_id TEXT;`);
  }

  if (!have.has('is_logged')) {
    await db.execAsync(`ALTER TABLE "set" ADD COLUMN is_logged INTEGER NOT NULL DEFAULT 0;`);
  }
}
