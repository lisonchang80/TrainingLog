/**
 * Slice 13d / NEW-Q50 (2026-05-29) — iPhone-side live-mirror snapshot
 * replace.
 *
 * Supersedes the 6-kind reducer (`liveMirrorReducer.ts`, deleted) +
 * per-field LWW (`setModifiedReducer.ts`, deleted). NEW-Q50 demoted
 * the live mirror from "diff envelope reduce" to "snapshot replace":
 * the Watch is the SoT during a live session, periodically pushes
 * its current SessionSnapshot via WC applicationContext (Q6), and
 * the iPhone unconditionally rewrites its own SQLite mirror of the
 * three session-shape tables from that snapshot.
 *
 * Aligns with applicationContext's latest-state-replace semantics —
 * the channel already collapses intermediate states, so a diff-merge
 * layer on top is wasted complexity. LWW reconciliation moves into
 * Watch Swift in-memory state (wave D29).
 *
 * Idempotency: `INSERT OR REPLACE` on every row. Re-applying the
 * same snapshot is a no-op (same column values overwrite themselves).
 *
 * Authority model: the snapshot is fully authoritative for the rows
 * it carries. Rows already in the iPhone DB but missing from the
 * snapshot are LEFT ALONE — purging "snapshot-orphan" rows is the
 * end-session reconcile's job (D7), not the live-mirror replace's.
 * This keeps the per-applicationContext write cheap (no full DELETE
 * + bulk INSERT every tick).
 *
 * Wrapped in a single transaction so a partial failure (Watch sent
 * malformed mid-snapshot) doesn't leave the iPhone with a half-
 * replaced mirror.
 */

import type { Database } from '../db/types';
import type { SessionSnapshot } from '../adapters/watch/handshake';

/**
 * Replace the iPhone-side mirror of an active session with a Watch-
 * supplied snapshot. Called by D32 (Wave 2) iPhone applicationContext
 * listener once the WC bridge is wired.
 */
export async function replaceLiveMirror(
  db: Database,
  snapshot: SessionSnapshot,
): Promise<void> {
  await db.withTransactionAsync(async () => {
    // ----- session row -----
    // Mirror only the columns the snapshot carries. `started_at` and
    // `title` are the snapshot-bound columns; other session columns
    // (ended_at, bodyweight_snapshot_kg, is_watch_tracked, ...) are
    // preserved across replace via an UPDATE-then-INSERT pattern.
    //
    // INSERT OR REPLACE on `session` would null-out the un-mirrored
    // columns, so use an explicit UPSERT.
    await db.runAsync(
      `INSERT INTO session (id, started_at, title)
         VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         started_at = excluded.started_at,
         title = excluded.title`,
      snapshot.sessionId,
      snapshot.startedAt,
      snapshot.title,
    );

    // ----- session_exercise rows -----
    for (const ex of snapshot.exercises) {
      // session_exercise's UNIQUE constraint is id (PK). exercise_id
      // is REFERENCES exercise(id) so we can't INSERT OR REPLACE here
      // — that would touch FK relationships. Use UPSERT on (id) and
      // overwrite the mirror-bound columns.
      await db.runAsync(
        `INSERT INTO session_exercise
           (id, session_id, exercise_id, ordering, planned_sets)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           ordering = excluded.ordering,
           planned_sets = excluded.planned_sets`,
        ex.sessionExerciseId,
        snapshot.sessionId,
        ex.exerciseId,
        ex.ordering,
        ex.plannedSets,
      );

      // ----- set rows under this session_exercise -----
      for (const s of ex.sets) {
        // Snapshot field name → DB column name:
        //   weight  → weight_kg
        //   ordinal → ordering
        //   is_logged (bool) → is_logged (INTEGER 0/1)
        // `rpe` / `rest_sec` are snapshot-only — no DB column yet
        // (per handshake.ts comment, `rpe` is forward-compat
        // placeholder; `rest_sec` denormalises onto each set on the
        // wire but the storage shape keeps it per-exercise).
        await db.runAsync(
          `INSERT INTO "set"
             (id, session_id, exercise_id, session_exercise_id,
              weight_kg, reps, notes, set_kind, is_logged,
              ordering, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             weight_kg = excluded.weight_kg,
             reps = excluded.reps,
             notes = excluded.notes,
             set_kind = excluded.set_kind,
             is_logged = excluded.is_logged,
             ordering = excluded.ordering,
             session_exercise_id = excluded.session_exercise_id`,
          s.setId,
          snapshot.sessionId,
          ex.exerciseId,
          ex.sessionExerciseId,
          s.weight,
          s.reps,
          s.notes,
          s.set_kind,
          s.is_logged ? 1 : 0,
          s.ordinal,
          // `created_at` is a NOT NULL column from v001; on first
          // INSERT we stamp the snapshot's startedAt (best-effort —
          // the row's true creation moment is unknown to the Watch).
          // On UPDATE the existing created_at is preserved.
          snapshot.startedAt,
        );
      }
    }
  });
}
