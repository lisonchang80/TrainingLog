import type { Database } from '../../db/types';
import { snapshotForSession } from '../../domain/template/templateManager';
import {
  createSession,
  insertSessionExercise,
  getActiveSession,
} from './sessionRepository';
import { prefillSetsForNewSessionExercise } from './setRepository';
import { getTemplate } from './templateRepository';

/**
 * Start a new Session whose plan is a frozen copy of `template_id`'s exercises.
 *
 * Workflow:
 *   1. Load Template (full hydrated form)
 *   2. Run the pure `snapshotForSession` projection to produce session_exercise rows
 *   3. Persist Session header + planned-exercise rows in one transaction
 *   4. (Optional, round 35) If `program_id` is supplied: for each newly-
 *      inserted session_exercise, call `prefillSetsForNewSessionExercise`
 *      which walks a (program, sub_tag, exercise) priority tree to copy
 *      set rows from the most recent matching historical session. All
 *      copied rows land with `is_logged = 0` (user must tick to confirm).
 *
 * Refuses to run if a Session is already in progress — the UI should never
 * call this with an open Session, but defending here protects the invariant
 * "at most one active Session at a time".
 *
 * `uuid` is REQUIRED — no default. Hermes lacks `crypto.randomUUID`; production
 * passes `randomUUID` from `expo-crypto`, tests pass a deterministic stub.
 *
 * `program_id` / `sub_tag` are OPTIONAL for backward compat:
 *   - templates tab → start-template-sheet → onStart: passes both fields,
 *     prefill phase runs
 *   - template-editor → onStartSession: omits both fields (no sheet),
 *     prefill phase is skipped — preserves legacy behaviour
 */
export async function startSessionFromTemplate(
  db: Database,
  args: {
    template_id: string;
    uuid: () => string;
    now?: () => number;
    /**
     * (round 35) Picked program id from the start-template-sheet. When
     * undefined the prefill phase is skipped entirely (template-editor caller
     * path). When defined it MUST be a real Program UUID — the reserved
     * 「無 / 通用」 row has id `RESERVED_NONE_PROGRAM_ID` per Q9.2 N1.
     */
    program_id?: string;
    /**
     * (round 35) Picked sub_tag from the start-template-sheet. null = 通用
     * within `program_id`. Only consulted when `program_id` is also defined.
     */
    sub_tag?: string | null;
  }
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

  // Prefill phase — only when the caller supplied (program_id, sub_tag).
  // Each new session_exercise gets its own (program, sub_tag, exercise)
  // tree walk. Per-card scope means a cluster pair's A and B sides each
  // get their own resolution independently (the parent_id / RS linkage
  // isn't consulted here — that's by design, prefill is a hint, not a
  // structural copy).
  //
  // Runs AFTER the session/se insert transaction so it can open its own
  // (per-card) transaction inside `replayCardSetsFromHistoricalSession`.
  // SQLite doesn't support nested transactions; the alternative — inlining
  // the replay logic transaction-free here — would duplicate the dropset
  // chain remap / ordering math that the helper already battle-tested in
  // slice 10c #21 / #25 / #27. The trade-off: if a per-card prefill fails
  // mid-way (e.g. db lock), other cards still receive their prefill, and
  // the session itself is already durable. Prefill is a UX hint, not a
  // structural copy, so partial failure is acceptable.
  if (args.program_id !== undefined) {
    for (const row of snapshots) {
      await prefillSetsForNewSessionExercise(db, {
        current_session_id: session_id,
        current_session_exercise_id: row.id,
        exercise_id: row.exercise_id,
        program_id: args.program_id,
        sub_tag: args.sub_tag ?? null,
        uuid: args.uuid,
        now: args.now,
      });
    }
  }

  return { session_id, planned_count: snapshots.length };
}
