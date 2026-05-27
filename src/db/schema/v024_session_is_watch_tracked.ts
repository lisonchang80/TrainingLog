import type { Database } from '../types';

/**
 * v024 — session.is_watch_tracked column (ADR-0019 slice 13d D1 / Q24).
 *
 * Background
 * ----------
 * Slice 13d introduces the Apple Watch in-session lifecycle. The Today tab's
 * 5-tile `SessionStatsPanel` variant must render only when the active session
 * was started / driven from the Watch. Prior to 13d, the predicate was a dev
 * AsyncStorage toggle (`dev_simulate_watch_tracked`, retired in D2) — and the
 * Q19 ratification picked an explicit `session.is_watch_tracked` flag over
 * `healthkit_workout_uuid !== null` to avoid false positives from iPhone-led
 * sessions that still write an HKWorkout via the 13c finalize path.
 *
 * Schema
 * ------
 * `is_watch_tracked INTEGER NOT NULL DEFAULT 0`. Stored as 0/1; the
 * sessionRepository adapter maps to TypeScript boolean at the boundary
 * (Session type extension lands in D1 + setter wired through D6/D7 — those
 * are separate commits in the 28-commit chain; this commit only stands up
 * the column).
 *
 * Backfill
 * --------
 * None needed. The DEFAULT 0 covers every pre-13d session row — which is
 * semantically correct: no row predating slice 13d could have been Watch
 * tracked (the Watch app didn't exist yet). Future write paths flip the
 * flag to 1 on Watch-initiated session start (D6) or paired-share session
 * start with WC handshake ack (D7); see `setIsWatchTracked` adapter (lands
 * in D1 too, in a sibling commit if extracted).
 *
 * Idempotency
 * -----------
 * The ALTER TABLE is guarded by `PRAGMA table_info(session)` so re-runs
 * skip the column creation (parallel to v023's pattern). No backfill UPDATE
 * is needed, so this migration is a pure additive column.
 *
 * Predicate switch
 * ----------------
 * The 5-tile vs 3-tile switch in `app/(tabs)/index.tsx` is changed in a
 * *separate* commit (D5 / D21 — naming varies between ADR text revisions
 * but maps to the predicate flip). This v024 commit is purely the schema
 * landing.
 */
export async function v024_session_is_watch_tracked(
  db: Database,
): Promise<void> {
  const cols = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info(session)`,
  );
  if (!cols.some((c) => c.name === 'is_watch_tracked')) {
    await db.execAsync(`
      ALTER TABLE session ADD COLUMN is_watch_tracked INTEGER NOT NULL DEFAULT 0;
    `);
  }
}
