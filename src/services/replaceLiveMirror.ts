/**
 * Slice 13d / NEW-Q50 (2026-05-29) — iPhone-side live-mirror reconcile.
 * Bug X fix (2026-05-30, task #270, "Approach A") — natural-key reconcile.
 *
 * Supersedes the 6-kind reducer (`liveMirrorReducer.ts`, deleted) +
 * per-field LWW (`setModifiedReducer.ts`, deleted). The Watch is the SoT
 * during a live session, periodically pushes its current SessionSnapshot
 * via WC applicationContext (Q6), and the iPhone rewrites its own SQLite
 * mirror of the three session-shape tables from that snapshot.
 *
 * Reconcile-by-natural-key (Bug X, Approach A) — the iPhone session may
 * ALREADY carry a canonical session_exercise/set tree built by
 * `startSessionFromTemplate` (template_id linkage + iPhone-minted UUIDs,
 * which the in-progress banner / history / 另存模板 all derive from). The
 * Watch snapshot uses its OWN ids (`SE-<idx>-<exerciseId>` /
 * `SET-<i>-<j>`) for the SAME logical rows. Keying the UPSERT on `id`
 * therefore INSERTed a PARALLEL tree → duplicate session_exercise rows
 * (one logged via the mirror, one empty from the template copy).
 *
 * Fix: match the canonical rows by their natural position instead of id:
 *   - session_exercise by (session_id, ordering)
 *   - set            by (session_exercise_id, ordering)
 * Both sides derive `ordering` from the same `template_exercise.ordering`
 * / `template_set` position, so they align. FOUND → UPDATE in place (keep
 * the canonical id + exercise_id + template_id linkage; overwrite only the
 * mirror-bound columns). ABSENT → INSERT (a freestyle add the Watch
 * authored — no template counterpart, so the Watch id + null template_id
 * are correct). This makes the live mirror UPDATE the canonical tree for
 * template sessions and AUTHOR the tree for freestyle sessions, with no
 * duplication either way.
 *
 * Idempotency: re-applying the same snapshot matches the rows it created/
 * updated last time → UPDATE with identical values = a no-op. No row
 * counts grow.
 *
 * Authority-but-not-purge: rows present in the iPhone DB but absent from
 * the snapshot are LEFT ALONE — purging snapshot-orphans is end-session
 * reconcile's job (D7), not the live-mirror replace's.
 *
 * Wrapped in a single transaction so a partial failure (Watch sent a
 * malformed mid-snapshot) doesn't leave a half-replaced mirror.
 */

import type { Database } from '../db/types';
import type { SessionSnapshot } from '../adapters/watch/handshake';

/**
 * Replace the iPhone-side mirror of an active session with a Watch-
 * supplied snapshot, reconciling onto any canonical (template-built)
 * tree by natural key. Called by D32's applicationContext listener.
 */
export async function replaceLiveMirror(
  db: Database,
  snapshot: SessionSnapshot,
): Promise<void> {
  await db.withTransactionAsync(async () => {
    // ----- session row -----
    // Mirror only the snapshot-bound columns. `started_at` and `title`
    // are mirror-bound; other columns (ended_at, bodyweight_snapshot_kg,
    // is_watch_tracked, ...) are preserved via UPSERT (INSERT OR REPLACE
    // would null them out).
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

    // ----- session_exercise rows (reconcile by POSITION / rank) -----
    // Match the snapshot's exercises onto the canonical tree by their
    // ORDER POSITION, NOT by the raw `ordering` value. The two sides use
    // DIFFERENT ordering conventions: the canonical tree
    // (startSessionFromTemplate → snapshotForSession) RE-INDEXES ordering
    // to 1..N, while the Watch snapshot carries the template's raw
    // `template_exercise.ordering` (often 0-based). Value-matching
    // therefore mis-fires (canonical 1 vs Watch 0) and inserts a parallel
    // row → the duplicate-exercise bug (task #270). Both lists ARE in
    // template order, so the i-th snapshot exercise is the i-th canonical
    // row — position-matching is convention-independent + handles the
    // same-exercise-appearing-twice case (distinct positions).
    const canonicalSes = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM session_exercise
        WHERE session_id = ?
        ORDER BY ordering ASC`,
      snapshot.sessionId,
    );
    const snapExercises = [...snapshot.exercises].sort(
      (a, b) => a.ordering - b.ordering,
    );

    for (let i = 0; i < snapExercises.length; i++) {
      const ex = snapExercises[i];
      const canonical = canonicalSes[i];

      let seId: string;
      if (canonical) {
        // Canonical (template-built) row at this position — UPDATE in
        // place. Do NOT touch id / exercise_id / template_id: keep the
        // template linkage the iPhone UI derives from.
        seId = canonical.id;
        await db.runAsync(
          `UPDATE session_exercise SET planned_sets = ? WHERE id = ?`,
          ex.plannedSets,
          seId,
        );
      } else {
        // No canonical row at this position — the Watch authored it
        // (freestyle add). INSERT with the Watch-minted id; template_id
        // stays NULL (correct: no template counterpart).
        seId = ex.sessionExerciseId;
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
      }

      // ----- set rows (reconcile by (session_exercise_id, ordering)) -----
      for (const s of ex.sets) {
        const existingSet = await db.getFirstAsync<{ id: string }>(
          `SELECT id FROM "set"
            WHERE session_exercise_id = ? AND ordering = ?`,
          seId,
          s.ordinal,
        );

        if (existingSet) {
          // Canonical set — overwrite only the mirror-bound (logged)
          // columns; preserve id / exercise_id / session_exercise_id /
          // created_at / parent_set_id.
          await db.runAsync(
            `UPDATE "set" SET
               weight_kg = ?, reps = ?, notes = ?, set_kind = ?, is_logged = ?
             WHERE id = ?`,
            s.weight,
            s.reps,
            s.notes,
            s.set_kind,
            s.is_logged ? 1 : 0,
            existingSet.id,
          );
        } else {
          // Watch-authored set with no canonical counterpart — INSERT.
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
            seId,
            s.weight,
            s.reps,
            s.notes,
            s.set_kind,
            s.is_logged ? 1 : 0,
            s.ordinal,
            // `created_at` NOT NULL (v001); stamp the snapshot's startedAt
            // on INSERT (best-effort — true creation moment unknown to the
            // Watch). UPDATE branch preserves the existing created_at.
            snapshot.startedAt,
          );
        }
      }
    }
  });
}
