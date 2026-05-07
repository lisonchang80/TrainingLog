import type { Database } from '../../db/types';
import type { Session } from '../../domain/session/types';

export async function createSession(
  db: Database,
  args: { id: string; started_at: number }
): Promise<void> {
  await db.runAsync(
    `INSERT INTO session (id, started_at) VALUES (?, ?)`,
    args.id,
    args.started_at
  );
}

export async function endSession(
  db: Database,
  args: { id: string; ended_at: number }
): Promise<void> {
  await db.runAsync(
    `UPDATE session SET ended_at = ? WHERE id = ?`,
    args.ended_at,
    args.id
  );
}

export async function getSession(db: Database, id: string): Promise<Session | null> {
  return db.getFirstAsync<Session>(
    `SELECT id, started_at, ended_at, bodyweight_snapshot_kg
       FROM session WHERE id = ?`,
    id
  );
}

/**
 * Returns the session that's currently in progress (ended_at IS NULL),
 * or null when no Session is active.
 *
 * If multiple unfinished sessions exist (shouldn't normally happen — UI only
 * keeps one open at a time), returns the most recently started.
 */
export async function getActiveSession(db: Database): Promise<Session | null> {
  return db.getFirstAsync<Session>(
    `SELECT id, started_at, ended_at, bodyweight_snapshot_kg
       FROM session
      WHERE ended_at IS NULL
      ORDER BY started_at DESC
      LIMIT 1`
  );
}

/** All sessions, newest first. Used by the History tab list. */
export async function listSessions(db: Database): Promise<Session[]> {
  return db.getAllAsync<Session>(
    `SELECT id, started_at, ended_at, bodyweight_snapshot_kg
       FROM session
      ORDER BY started_at DESC`
  );
}
