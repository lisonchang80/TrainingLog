import type { Database } from '../types';

/**
 * v019 — Add `session_exercise_id TEXT NULL` to the runtime `set` table
 * + backfill from existing (session_id, exercise_id) → session_exercise.id.
 *
 * Why: prior to v019 the `set` table was only keyed by
 * `(session_id, exercise_id)` for within-session lookups. When a session
 * contained two `session_exercise` rows that shared the same `exercise_id`
 * — e.g. a Reusable Superset card with Cable Crossover on the A side, plus
 * a separate solo Cable Crossover card added later in the same session —
 * their sets could not be told apart at the row level. Every within-session
 * write/read/delete (edit weight, toggle ✓, swipe-delete, add notes, etc.)
 * leaked across both `session_exercise` cards because the WHERE clause only
 * narrowed by exercise_id, not by which card the set belonged to.
 *
 * Fix: add a per-row `session_exercise_id` FK pointer to the set table.
 * Within-session repo paths (insert/update/delete/list-by-card) switch to
 * filtering by this column. Cross-session aggregate queries (history, PR,
 * stats, volume engine, e1rm) intentionally keep using `exercise_id` —
 * those queries need to collect data ACROSS sessions for a given exercise,
 * so the per-row `session_exercise_id` (which is unique per session) would
 * be the wrong key for them.
 *
 * Why nullable, no FK constraint, no NOT NULL:
 *   - SQLite `ALTER TABLE ADD COLUMN` cannot add a column with a FK
 *     constraint (would require table rebuild). We enforce the relationship
 *     at the application layer instead.
 *   - Legacy rows that the backfill can't match (e.g. orphaned sets where
 *     no `session_exercise` row exists) stay NULL rather than blocking
 *     the migration. Production data shouldn't have such rows, but tests
 *     and dev databases sometimes do.
 *
 * Backfill strategy (best-effort, ordering-deterministic):
 *   For each pre-existing set, set `session_exercise_id` to the id of the
 *   `session_exercise` row whose (session_id, exercise_id) matches, picking
 *   the LOWEST `ordering` value if multiple match. In the bug scenario the
 *   current user has not actually shipped — they noticed the leak before
 *   adding a real duplicate-exercise session — so for every existing set
 *   the (session_id, exercise_id) pair maps to exactly one session_exercise.
 *   The `ORDER BY ordering ASC LIMIT 1` is a deterministic tie-breaker for
 *   ambiguous historic cases. Rows that match nothing (orphaned) stay NULL.
 *
 * Idempotency: PRAGMA table_info introspection before ADD COLUMN, and the
 * backfill UPDATE is `WHERE session_exercise_id IS NULL` so a re-run on an
 * already-migrated DB doesn't overwrite explicit values.
 */
export async function v019_set_session_exercise_id(db: Database): Promise<void> {
  const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info("set")`);
  const have = new Set(cols.map((c) => c.name));

  if (!have.has('session_exercise_id')) {
    await db.execAsync(`ALTER TABLE "set" ADD COLUMN session_exercise_id TEXT;`);
  }

  // Index for the new within-card lookup path.
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_set_session_exercise ON "set"(session_exercise_id);`
  );

  // Best-effort backfill — fill NULLs from the matching session_exercise row.
  // ORDER BY ordering ASC is a deterministic tie-breaker for the (currently
  // hypothetical) case of duplicate (session_id, exercise_id) plan rows.
  await db.execAsync(`
    UPDATE "set" SET session_exercise_id = (
      SELECT se.id FROM session_exercise se
       WHERE se.session_id = "set".session_id
         AND se.exercise_id = "set".exercise_id
       ORDER BY se.ordering ASC
       LIMIT 1
    ) WHERE session_exercise_id IS NULL;
  `);
}
