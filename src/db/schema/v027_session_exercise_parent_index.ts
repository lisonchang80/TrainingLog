import type { Database } from '../types';

/**
 * v027 — index on `session_exercise.parent_id` (perf/history correlated-subquery P2).
 *
 * Background
 * ----------
 * `session_exercise.parent_id` (added v014) groups cluster/superset child
 * exercises under a parent `session_exercise.id`. The exercise-history read
 * paths probe this relationship with correlated subqueries shaped like
 *
 *     ... WHERE EXISTS (SELECT 1 FROM session_exercise se2
 *                        WHERE se2.parent_id = se.id)
 *
 * — there are ~9 such `se2.parent_id = se.id` lookups across
 * `exerciseHistoryRepository.ts` (the cluster-aware history / chart queries).
 * The only existing index on `session_exercise` is `idx_session_exercise_session`
 * on `session_id`; `parent_id` is unindexed, so each correlated subquery does a
 * `SCAN session_exercise` per outer row. `EXPLAIN QUERY PLAN` at scale (perf
 * audit 2026-06-17, report 08) confirmed the full scan; it grows with the
 * user's accumulated history — the one thing this local-first app keeps forever.
 *
 * Schema
 * ------
 * `CREATE INDEX IF NOT EXISTS idx_session_exercise_parent ON session_exercise(parent_id)`.
 * Non-unique (a parent groups many children; most rows are solo with NULL
 * parent_id). NULLs are indexed but the equality lookup (`parent_id = se.id`)
 * skips them, so the cost is negligible. Pure read optimization — no behaviour
 * change. Mirrors v026 (`idx_session_started_at`).
 *
 * Idempotency
 * -----------
 * `IF NOT EXISTS` makes both the fresh-chain creation and a re-run / restored-
 * older-file re-migrate no-ops after the first apply (parallel to the other
 * index-creating migrations). The runner wraps this in a transaction, so a
 * partial failure rolls back cleanly. No backfill, no CASCADE surface (index
 * only).
 */
export async function v027_session_exercise_parent_index(
  db: Database
): Promise<void> {
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_session_exercise_parent ON session_exercise(parent_id);`
  );
}
