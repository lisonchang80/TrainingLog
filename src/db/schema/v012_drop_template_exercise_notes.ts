import type { Database } from '../types';

/**
 * v012 — drop legacy `template_exercise.notes` (ADR-0017 amendment to ADR-0013).
 *
 * Background — phased DROP COLUMN:
 *   - v010 added `exercise.notes` and BACKFILLED it from the most-recently-
 *     updated `template_exercise.notes` row per exercise.
 *   - v010 deliberately KEPT `template_exercise.notes` around so production
 *     templateRepository / templateRepositoryV2 tests would keep working
 *     during the cutover.
 *   - Phase 2d (slice 9.6) switched templateRepository read AND write to
 *     `exercise.notes`. The column on `template_exercise` is now legacy
 *     garbage (new commits write NULL there).
 *   - v012 (this migration) finally drops the column.
 *
 * SQLite's `ALTER TABLE ... DROP COLUMN` is supported from SQLite 3.35 (2021),
 * which is far below Expo SDK's bundled version — safe to use directly.
 *
 * Idempotency: SQLite errors when DROPping a non-existent column; in that
 * case the migration is a no-op (we silently swallow the error, matching
 * pragma-introspection patterns used in other migrations).
 */
export async function v012_drop_template_exercise_notes(db: Database): Promise<void> {
  // Defensive: verify the column still exists before attempting DROP. If a
  // future code path lands a manual DROP, this becomes a no-op rather than
  // crashing the migration.
  const cols = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info(template_exercise)`
  );
  const hasNotes = cols.some((c) => c.name === 'notes');
  if (!hasNotes) return;

  await db.execAsync(`ALTER TABLE template_exercise DROP COLUMN notes;`);
}
