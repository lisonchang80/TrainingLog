import type { Database } from '../../db/types';
import { snapshotForSession } from '../../domain/template/templateManager';
import {
  createSession,
  insertSessionExercise,
  getActiveSession,
} from './sessionRepository';
import { getTemplate } from './templateRepository';

/**
 * Start a new Session whose plan is a frozen copy of `template_id`'s exercises.
 *
 * Workflow:
 *   1. Load Template (full hydrated form)
 *   2. Run the pure `snapshotForSession` projection to produce session_exercise rows
 *   3. Persist Session header + planned-exercise rows in one transaction
 *
 * Refuses to run if a Session is already in progress — the UI should never
 * call this with an open Session, but defending here protects the invariant
 * "at most one active Session at a time".
 *
 * `uuid` is REQUIRED — no default. Hermes lacks `crypto.randomUUID`; production
 * passes `randomUUID` from `expo-crypto`, tests pass a deterministic stub.
 */
export async function startSessionFromTemplate(
  db: Database,
  args: { template_id: string; uuid: () => string; now?: () => number }
): Promise<{ session_id: string; planned_count: number }> {
  const active = await getActiveSession(db);
  if (active) {
    throw new Error(
      `Cannot start a new session — session ${active.id} is already in progress`
    );
  }

  const template = await getTemplate(db, args.template_id);
  if (!template) {
    throw new Error(`Template not found: ${args.template_id}`);
  }

  const session_id = args.uuid();
  const started_at = (args.now ?? Date.now)();
  const snapshots = snapshotForSession({
    template,
    session_id,
    uuid: args.uuid,
  });

  await db.withTransactionAsync(async () => {
    await createSession(db, { id: session_id, started_at });
    for (const row of snapshots) {
      await insertSessionExercise(db, { ...row });
    }
  });

  return { session_id, planned_count: snapshots.length };
}
