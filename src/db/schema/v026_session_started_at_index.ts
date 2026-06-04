import type { Database } from '../types';

/**
 * v026 — index on `session.started_at` (perf/history-list-aggregate P2).
 *
 * Background
 * ----------
 * Two hot read paths sort/filter by `session.started_at` with no supporting
 * index:
 *   - History tab: `listSessions` / `loadHistoryListRows` do
 *     `ORDER BY started_at DESC` over the full session table.
 *   - Stats: period queries `WHERE started_at >= ?` to bound a window.
 *
 * Without an index SQLite does a full table scan + filesort on every History
 * focus / pull-to-refresh. At ~hundreds of sessions this is cheap in absolute
 * terms but it's pure waste, and it grows linearly with the user's training
 * history — the one thing this local-first app accumulates forever. A plain
 * b-tree index on `started_at` lets the ORDER BY DESC be served directly from
 * the index and turns the Stats range filter into a range scan.
 *
 * Schema
 * ------
 * `CREATE INDEX IF NOT EXISTS idx_session_started_at ON session(started_at)`.
 * Non-unique (multiple sessions can share a timestamp, e.g. same-second start
 * + a Watch-mirrored row). Pure read optimization — no behaviour change.
 *
 * Idempotency
 * -----------
 * `IF NOT EXISTS` makes both the fresh-chain creation and a re-run / restored-
 * older-file re-migrate no-ops after the first apply (parallel to the other
 * index-creating migrations and the PRAGMA-guarded ADD COLUMN steps). The
 * runner wraps this in a transaction, so a partial failure rolls back cleanly.
 */
export async function v026_session_started_at_index(db: Database): Promise<void> {
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_session_started_at ON session(started_at);`,
  );
}
