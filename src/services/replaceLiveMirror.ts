/**
 * Slice 13d / NEW-Q50 (2026-05-29) — iPhone-side live-mirror reconcile.
 * Bug X fix (2026-05-30, task #270, "Approach A") — natural-key reconcile.
 * Slice 13d WC ship-blocker E2 (2026-05-30) — `purgeTail` option added so
 *   the END-session reconcile can finally DELETE snapshot-orphans (the
 *   step this module's doc historically deferred to "D7"). Same single
 *   position/ordinal reconcile is shared by both callers so the Bug X
 *   alignment logic stays single-sourced.
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
 * Fix: match the canonical rows by a STABLE natural key instead of id:
 *   - session_exercise by `exercise_id` + occurrence-index (the N-th
 *     snapshot occurrence of an exercise_id → the N-th canonical row with
 *     that exercise_id, both walked in `ordering ASC`). NOT by list
 *     position: position survives tail deletes but a FIRST/MIDDLE Watch
 *     delete shifts later rows onto the wrong canonical row (the E2
 *     corruption — see the reconcile body for the worked [A,B,C]→[A,C]
 *     example).
 *   - set by (session_exercise_id, ordering) — both sides number sets
 *     1..N (canonical `set.ordering = j+1`, Watch `ordinal = setIdx+1`),
 *     so the VALUE aligns once the parent exercise is matched correctly.
 * FOUND → UPDATE in place (keep the canonical id + exercise_id +
 * template_id linkage; overwrite only the mirror-bound columns). ABSENT →
 * INSERT (a freestyle add the Watch authored — no template counterpart, so
 * the Watch id + null template_id are correct). This makes the live mirror
 * UPDATE the canonical tree for template sessions and AUTHOR the tree for
 * freestyle sessions, with no duplication either way.
 *
 * Idempotency: re-applying the same snapshot matches the rows it created/
 * updated last time → UPDATE with identical values = a no-op. No row
 * counts grow.
 *
 * Authority-but-not-purge (live mirror, `purgeTail: false`): rows present
 * in the iPhone DB but absent from the snapshot are LEFT ALONE during a
 * LIVE mirror tick — purging snapshot-orphans is END-session reconcile's
 * job (`purgeTail: true`, called from `reconcileEndSnapshot`), NOT the
 * live-mirror replace's. See ADR-0019 § "WC Ship-Blocker Fixes E1/E2/E3".
 *
 * Wrapped in a single transaction so a partial failure (Watch sent a
 * malformed mid-snapshot) doesn't leave a half-replaced mirror.
 */

import type { Database } from '../db/types';
import type { SessionSnapshot } from '../adapters/watch/handshake';

export interface ReconcileSessionTreeOptions {
  /**
   * When true, after upserting every snapshot-present row, DELETE the
   * iPhone-side rows that the snapshot no longer contains:
   *   - session_exercise rows whose id was not touched this pass (their
   *     `set` children CASCADE),
   *   - within each kept exercise, `set` rows whose id was not touched.
   * This is the E2 fix — it makes the snapshot AUTHORITATIVE (membership
   * = deletion). ONLY the end-session reconcile passes true, and ONLY
   * after `reconcileEndSnapshot` has run its Q3 guards (parse OK + not a
   * suspiciously-empty snapshot). The live-mirror tick passes false.
   */
  purgeTail: boolean;
}

export interface ReconcileSessionTreeResult {
  exerciseCount: number;
  setCount: number;
  /** Rows deleted by the tail purge (0 when `purgeTail` is false). */
  purgedExercises: number;
  purgedSets: number;
}

/**
 * Reconcile the iPhone-side mirror of a session against a Watch-supplied
 * snapshot by natural position key. Shared core for both the live-mirror
 * tick (`replaceLiveMirror`, purgeTail false) and the end-session
 * membership reconcile (`reconcileEndSnapshot`, purgeTail true).
 *
 * NOTE: with `purgeTail: true` this TRUSTS the snapshot as ground truth
 * and deletes anything absent. Callers MUST gate against a malformed /
 * empty snapshot first (see `reconcileEndSnapshot`'s Q3 guards) — calling
 * this directly with an empty snapshot + purgeTail would wipe the tree.
 */
export async function reconcileSessionTree(
  db: Database,
  snapshot: SessionSnapshot,
  opts: ReconcileSessionTreeOptions,
): Promise<ReconcileSessionTreeResult> {
  let purgedExercises = 0;
  let purgedSets = 0;

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

    // ----- session_exercise rows (reconcile by exercise_id + occurrence) -----
    // Match each snapshot exercise onto a canonical (template-built) row by
    // a STABLE KEY — `exercise_id` plus occurrence-index — NOT by list
    // POSITION (the previous Bug X "Approach A") and NOT by the raw
    // `ordering` value.
    //
    //   - POSITION matching aligned the i-th snapshot exercise with the
    //     i-th canonical row. It survives tail deletes + in-place edits,
    //     but a FIRST/MIDDLE delete shifts every later row up one slot:
    //     canonical [A,B,C], Watch deletes B, sends [A,C] → C lands on
    //     canonical B's row (UPDATEd with C's planned_sets, then C's sets
    //     overwrite B's set rows by ordinal), and the tail purge deletes
    //     canonical C. Net: exercise B's row now shows C's data and "C"
    //     vanishes instead of "B" — history corruption + the wrong row
    //     purged. That was the E2 ship-blocker.
    //   - `ordering` VALUE matching mis-fires because the two sides use
    //     DIFFERENT conventions: the canonical tree
    //     (startSessionFromTemplate → snapshotForSession) RE-INDEXES ordering
    //     to 1..N, while the Watch snapshot carries the template's raw
    //     `template_exercise.ordering` (often 0-based).
    //
    // The shared, convention-independent key is `exercise_id` — both sides
    // carry the real FK. To still handle the same-exercise-appearing-twice
    // case (the reason POSITION was originally chosen over a naive
    // exercise_id join), the N-th snapshot occurrence of a given exercise_id
    // maps to the N-th canonical row with that exercise_id, both walked in
    // `ordering ASC`. FOUND → UPDATE in place. ABSENT (a freestyle add, or
    // more occurrences than canonical rows) → INSERT with the Watch id. A
    // canonical row no occurrence claims is left untouched here and removed
    // by the tail purge (membership = deletion) — which is exactly how a
    // first/middle delete now drops the RIGHT row.
    const canonicalSes = await db.getAllAsync<{ id: string; exercise_id: string }>(
      `SELECT id, exercise_id FROM session_exercise
        WHERE session_id = ?
        ORDER BY ordering ASC`,
      snapshot.sessionId,
    );
    // exercise_id → FIFO queue of canonical ids in `ordering ASC`. Shifting
    // one per snapshot occurrence (the snapshot is also walked in ordering
    // order) realises the N-th ↔ N-th occurrence mapping.
    const canonicalByExercise = new Map<string, string[]>();
    for (const row of canonicalSes) {
      const q = canonicalByExercise.get(row.exercise_id);
      if (q) q.push(row.id);
      else canonicalByExercise.set(row.exercise_id, [row.id]);
    }
    const snapExercises = [...snapshot.exercises].sort(
      (a, b) => a.ordering - b.ordering,
    );

    // E2: accumulate the ids we touch so the tail purge can delete the
    // rest. Flat lists — the purge deletes by session scope (NOT relying
    // on FK CASCADE, which requires PRAGMA foreign_keys=ON and is not
    // guaranteed on every adapter / the test DB).
    const keptSeIds: string[] = [];
    const keptSetIds: string[] = [];

    for (const ex of snapExercises) {
      const queue = canonicalByExercise.get(ex.exerciseId);
      const canonicalId = queue && queue.length > 0 ? queue.shift() : undefined;

      let seId: string;
      if (canonicalId !== undefined) {
        // Canonical (template-built) row for this exercise_id occurrence —
        // UPDATE in place. Do NOT touch id / exercise_id / ordering /
        // template_id: keep the template linkage the iPhone UI derives from.
        seId = canonicalId;
        await db.runAsync(
          `UPDATE session_exercise SET planned_sets = ? WHERE id = ?`,
          ex.plannedSets,
          seId,
        );
      } else {
        // No unclaimed canonical row for this exercise_id — the Watch
        // authored it (freestyle add). INSERT with the Watch-minted id;
        // template_id stays NULL (correct: no template counterpart).
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
      keptSeIds.push(seId);

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
          keptSetIds.push(existingSet.id);
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
          keptSetIds.push(s.setId);
        }
      }
    }

    // ----- E2 tail purge (end-session reconcile only) -----
    // Snapshot is authoritative: any iPhone row not touched above is a
    // Watch-side deletion the mirror never propagated. Delete it now.
    if (opts.purgeTail) {
      // Delete sets FIRST (explicit — do NOT rely on FK CASCADE, which
      // needs PRAGMA foreign_keys=ON and isn't guaranteed across adapters),
      // then the orphan exercises. A set is purged when its id wasn't
      // touched this pass — covers BOTH a tail set in a kept exercise AND
      // any set under an exercise being purged. `NOT IN ('')` when the
      // keep-list is empty deletes every matching row (no real id == '').
      const setKeep = keptSetIds.length > 0 ? keptSetIds : [''];
      const setPlaceholders = setKeep.map(() => '?').join(', ');
      const setDel = await db.runAsync(
        `DELETE FROM "set"
          WHERE session_id = ? AND id NOT IN (${setPlaceholders})`,
        snapshot.sessionId,
        ...setKeep,
      );
      purgedSets = setDel.changes ?? 0;

      const seKeep = keptSeIds.length > 0 ? keptSeIds : [''];
      const sePlaceholders = seKeep.map(() => '?').join(', ');
      const seDel = await db.runAsync(
        `DELETE FROM session_exercise
          WHERE session_id = ? AND id NOT IN (${sePlaceholders})`,
        snapshot.sessionId,
        ...seKeep,
      );
      purgedExercises = seDel.changes ?? 0;
    }
  });

  const setCount = snapshot.exercises.reduce(
    (acc, ex) => acc + ex.sets.length,
    0,
  );
  return {
    exerciseCount: snapshot.exercises.length,
    setCount,
    purgedExercises,
    purgedSets,
  };
}

/**
 * Replace the iPhone-side mirror of an active session with a Watch-
 * supplied snapshot, reconciling onto any canonical (template-built)
 * tree by natural key. Called by D32's applicationContext listener.
 *
 * Live-mirror semantics: upsert-only, NEVER purge (a mid-session tick is
 * not authoritative about deletions — that is the end-session reconcile's
 * job). Thin wrapper over `reconcileSessionTree` with `purgeTail: false`.
 */
export async function replaceLiveMirror(
  db: Database,
  snapshot: SessionSnapshot,
): Promise<void> {
  await reconcileSessionTree(db, snapshot, { purgeTail: false });
}
