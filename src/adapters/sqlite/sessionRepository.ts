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
