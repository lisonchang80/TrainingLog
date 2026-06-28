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
 * Live membership purge (live mirror, `purgeTail: false` but
 * `purgeSetsInPresentExercises` + `purgeExercisesAbsentFromSnapshot` true):
 * a LIVE tick mirrors current MEMBERSHIP — Watch-deleted sets (inside a
 * present exercise) and Watch-deleted whole exercises (#4, 2026-06-02) are
 * removed so the in-progress iPhone view tracks the Watch. What it still does
 * NOT do is the unconstrained session-wide tail purge or the unconditional
 * session-row UPSERT — those stay END-session reconcile's job (`purgeTail:
 * true`, from `reconcileEndSnapshot`). The producer-sends-full-tree + H1
 * liveness gate make membership-purge safe live. See ADR-0019 § "WC
 * Ship-Blocker Fixes E1/E2/E3" + § 2026-06-02 device-bug #4.
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
  /**
   * LIVE-mirror authority over SET membership WITHIN the exercises the
   * snapshot contains: after upserting an exercise's sets, DELETE that
   * exercise's other set rows (the Watch sends the exercise's FULL current
   * set list each tick, so a leftover is a Watch-side removal). Unlike
   * `purgeTail` this does NOT touch absent EXERCISES (those stay end-session's
   * job) — it just keeps the live mirror's per-exercise set list in lockstep
   * with the Watch so dropset structure edits (add / remove child, deconstruct)
   * don't leave orphan rows visible mid-session. Safe for WC applicationContext
   * (delivers complete snapshots, not partial diffs). The live caller passes
   * true; end-session passes false (its `purgeTail` already covers everything).
   */
  purgeSetsInPresentExercises?: boolean;
  /**
   * LIVE-mirror authority over EXERCISE membership (#4, 2026-06-02). When
   * true, after upserting every snapshot-present exercise, DELETE the
   * session_exercise rows the snapshot no longer contains (plus their sets).
   * This is the live-tick counterpart of `purgeTail` but NARROWER: it removes
   * whole absent EXERCISES only — it does NOT re-purge tail sets inside present
   * exercises (that's `purgeSetsInPresentExercises`). Before this, a Watch
   * delete-exercise propagated to History (end-session `purgeTail`) but NOT to
   * the in-progress iPhone session (device-bug #4: 刪除動作 live 不同步). Safe on
   * the live tick: the producer sends the FULL exercise tree every tick (an
   * absent exercise is a real delete, not a partial diff) and the H1 gate
   * (`requireExistingLiveSession`) already drops any post-teardown straggler.
   * The live caller passes true; end-session passes false (its `purgeTail`
   * already removes absent exercises too).
   */
  purgeExercisesAbsentFromSnapshot?: boolean;
  /**
   * LIVE-mirror liveness gate (H1, 2026-06-01). When true, this reconcile
   * REQUIRES the session row to already exist AND be un-ended before it
   * writes anything:
   *   - row ABSENT  → the session was discarded (放棄) → drop the whole tick.
   *   - `ended_at` set → the session was finalized (完成) → drop the whole tick.
   *   - present + live → UPDATE the mirror-bound columns only; NEVER INSERT
   *     the session row.
   *
   * Why a dedicated gate and why INSIDE the transaction: the live mirror
   * rides `sendMessage`/`applicationContext` while discard/end ride
   * `transferUserInfo` — three WC channels with NO cross-channel ordering. A
   * tick already in flight when the user hits 放棄/完成 can land AFTER the
   * discard's DELETE / the end's `purgeTail`. The unconditional
   * `INSERT INTO session ... ON CONFLICT` (used by the end path) would then
   * RESURRECT the just-deleted session as a zombie `ended_at = NULL` row, or
   * re-INSERT a `set`/`session_exercise` row `purgeTail` just removed
   * (regressing E2). Checking liveness in the SAME transaction as the writes
   * is what makes it airtight: a concurrent discard either commits before us
   * (our `SELECT` sees no row → bail) or after us (it deletes what we wrote)
   * — both orderings end at "session gone", never a zombie. Only the LIVE
   * caller (`replaceLiveMirror`) passes true; the end-session reconcile passes
   * false (it LEGITIMATELY writes an already-`ended_at` row, so it must keep
   * the unconditional UPSERT path).
   */
  requireExistingLiveSession?: boolean;
}

export interface ReconcileSessionTreeResult {
  exerciseCount: number;
  setCount: number;
  /** Rows deleted by the tail purge (0 when `purgeTail` is false). */
  purgedExercises: number;
  purgedSets: number;
  /**
   * Rows deleted by the PRECISE tombstone purge (Q5, slice 13d
   * sync-refactor) — driven by `snapshot.deletedIds`, independent of
   * `purgeTail`. 0 when the snapshot carries no `deletedIds`.
   */
  tombstonedExercises: number;
  tombstonedSets: number;
  /**
   * Set to `'session-gone'` (and all counts 0) when `requireExistingLiveSession`
   * was true but the session row was ABSENT (discarded) or already `ended_at`
   * (finalized) — the whole reconcile was dropped without writing anything
   * (H1 liveness gate). `null` on a normal applied reconcile. The end path
   * (gate off) never sets it.
   */
  skipped: 'session-gone' | null;
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
/**
 * Session-namespaced on-device id for a Watch-authored set whose wire id
 * collides with a row from a DIFFERENT session (see the set INSERT branch).
 *
 * The Watch mints freestyle set ids ("ADD-<n>") from an in-memory counter that
 * resets to 0 on app relaunch, so two different sessions can both mint "ADD-1".
 * `set.id` is the PRIMARY KEY, so persisting the raw wire id lets a later
 * session's `INSERT … ON CONFLICT(id) DO UPDATE` clobber a prior session's row.
 * When that cross-session collision is detected we divert to this namespaced
 * id. The `::` separator never appears in a Watch wire id or a UUID, so the
 * transform is unambiguous + deterministic — every path that needs the diverted
 * id (tombstone purge, parent resolution) recomputes it from (sessionId, wireId).
 */
function localizeSetId(sessionId: string, wireId: string): string {
  return `${sessionId}::${wireId}`;
}

export async function reconcileSessionTree(
  db: Database,
  snapshot: SessionSnapshot,
  opts: ReconcileSessionTreeOptions,
): Promise<ReconcileSessionTreeResult> {
  let purgedExercises = 0;
  let purgedSets = 0;
  let tombstonedExercises = 0;
  let tombstonedSets = 0;
  let skipped: 'session-gone' | null = null;

  await db.withTransactionAsync(async () => {
    // ----- session row -----
    if (opts.requireExistingLiveSession) {
      // LIVE-mirror liveness gate (H1, 2026-06-01) — IN-TRANSACTION so it's
      // airtight against an unordered discard/end landing in the gap. A live
      // tick must NEVER create or revive a session row: the start path owns
      // creation, and a tick that finds no row (or an ended one) is a
      // late-after-discard / post-finalize straggler. Drop the WHOLE tick.
      const live = await db.getFirstAsync<{ ended_at: number | null }>(
        `SELECT ended_at FROM session WHERE id = ?`,
        snapshot.sessionId,
      );
      if (!live || live.ended_at != null) {
        skipped = 'session-gone';
        return; // no writes → no zombie, no post-end re-insert
      }
      // Present + live → UPDATE the mirror-bound columns only. NEVER INSERT
      // (an absent row was already handled above as session-gone).
      await db.runAsync(
        `UPDATE session SET started_at = ?, title = ? WHERE id = ?`,
        snapshot.startedAt,
        snapshot.title,
        snapshot.sessionId,
      );
    } else {
      // Default / end-session path. Mirror only the snapshot-bound columns.
      // `started_at` and `title` are mirror-bound; other columns (ended_at,
      // bodyweight_snapshot_kg, is_watch_tracked, ...) are preserved via UPSERT
      // (INSERT OR REPLACE would null them out). The end path LEGITIMATELY
      // writes an already-`ended_at` row, so it keeps the unconditional UPSERT.
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
    }

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
    // Dropset chains: a follower's `parent_set_id` on the wire is the HEAD's
    // WIRE setId, but on-device the head may have been matched onto a canonical
    // (template) row with a DIFFERENT id. Map wire-id → on-device-id as each
    // set is resolved so a follower (always later in `ordering` than its head)
    // can translate its parent to the real on-device id. Heads carry
    // `parent_set_id = null`, so only followers consult the map.
    const setIdMap = new Map<string, string>();

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
      // Set ids touched for THIS exercise — drives the live per-exercise purge.
      const exSetIds: string[] = [];

      // ----- Pass 1 (Q6 grill 2026-06-05): resolve every wire set's on-device
      // id up-front -----
      // The reconcile must NOT depend on `ex.sets` arriving head-before-
      // follower. The Watch sorts the wire array by display_rank, so a
      // long-press reorder can place a dropset follower BEFORE its head;
      // resolving the follower's parent in array order would then miss the head
      // (`setIdMap` not yet populated) and persist an orphan
      // `parent_set_id = null` (broken dropset chain). This write-free pass
      // pre-populates the wire-id → on-device-id map so the parent translation
      // in pass 2 is order-independent.
      const resolvedIds = new Map<
        string,
        { existingId: string | null; onDeviceId: string }
      >();
      for (const s of ex.sets) {
        const existingSet = await db.getFirstAsync<{ id: string }>(
          `SELECT id FROM "set"
            WHERE session_exercise_id = ? AND ordering = ?`,
          seId,
          s.ordinal,
        );
        let onDeviceId: string;
        if (existingSet) {
          onDeviceId = existingSet.id;
        } else {
          // Cross-session id-collision guard (full rationale at the INSERT
          // branch below): a Watch-minted freestyle id ("ADD-<n>") can already
          // belong to an EARLIER session, so divert to a namespaced id.
          const foreign = await db.getFirstAsync<{ session_id: string }>(
            `SELECT session_id FROM "set" WHERE id = ?`,
            s.setId,
          );
          onDeviceId =
            foreign && foreign.session_id !== snapshot.sessionId
              ? localizeSetId(snapshot.sessionId, s.setId)
              : s.setId;
        }
        resolvedIds.set(s.setId, {
          existingId: existingSet ? existingSet.id : null,
          onDeviceId,
        });
        setIdMap.set(s.setId, onDeviceId);
      }

      // ----- Pass 2: upsert set rows (parents now fully resolvable) -----
      for (const s of ex.sets) {
        const resolved = resolvedIds.get(s.setId)!;
        const existingSet =
          resolved.existingId != null ? { id: resolved.existingId } : null;

        // Translate a follower's wire parent into the on-device head id. With
        // pass 1 above this no longer depends on the head appearing earlier in
        // `ex.sets`. A head row has `parent_set_id = null` and skips this. A
        // genuinely dangling parent (head deleted) collapses to null.
        const resolvedParentId =
          s.parent_set_id != null
            ? setIdMap.get(s.parent_set_id) ?? null
            : null;

        if (existingSet) {
          // Overwrite the mirror-bound (logged) columns. `parent_set_id` is
          // structural so we normally DON'T touch it (preserve id /
          // exercise_id / session_exercise_id / created_at) — base sets lose
          // the template's chain linkage crossing the fat-tree, so blindly
          // writing it would null out a real canonical follower. BUT when the
          // Watch explicitly says this row is a follower (resolved parent
          // present), write it — that retro-fixes a follower first synced by
          // an older reconcile (no parent column) WITHOUT a fresh session, and
          // is safe because a head / canonical row sends parent = null and so
          // skips this branch.
          if (s.set_kind !== 'dropset') {
            // A non-dropset row NEVER has a chain parent (dropset-chain-
            // semantics invariant). Clear any stale value — e.g. a row that
            // was a dropset follower then got deconstructed back to working;
            // without this the stale parent would silently re-fold it if it
            // later cycles to dropset again.
            await db.runAsync(
              `UPDATE "set" SET
                 weight_kg = ?, reps = ?, notes = ?, set_kind = ?, is_logged = ?,
                 parent_set_id = NULL, display_rank = ?
               WHERE id = ?`,
              s.weight,
              s.reps,
              s.notes,
              s.set_kind,
              s.is_logged ? 1 : 0,
              s.display_rank ?? null,
              existingSet.id,
            );
          } else if (resolvedParentId !== null) {
            // Dropset follower — write the resolved on-device head id (also
            // retro-fixes a follower first synced by an older reconcile).
            await db.runAsync(
              `UPDATE "set" SET
                 weight_kg = ?, reps = ?, notes = ?, set_kind = ?, is_logged = ?,
                 parent_set_id = ?, display_rank = ?
               WHERE id = ?`,
              s.weight,
              s.reps,
              s.notes,
              s.set_kind,
              s.is_logged ? 1 : 0,
              resolvedParentId,
              s.display_rank ?? null,
              existingSet.id,
            );
          } else {
            // Dropset HEAD, or a follower whose parent the Watch didn't carry
            // (template fat-tree drops parent_set_id) — preserve the existing
            // parent so a real canonical follower isn't nulled out.
            await db.runAsync(
              `UPDATE "set" SET
                 weight_kg = ?, reps = ?, notes = ?, set_kind = ?, is_logged = ?,
                 display_rank = ?
               WHERE id = ?`,
              s.weight,
              s.reps,
              s.notes,
              s.set_kind,
              s.is_logged ? 1 : 0,
              s.display_rank ?? null,
              existingSet.id,
            );
          }
          keptSetIds.push(existingSet.id);
          exSetIds.push(existingSet.id);
          setIdMap.set(s.setId, existingSet.id);
        } else {
          // Watch-authored set with no canonical counterpart — INSERT. A
          // dropset follower carries the resolved on-device head id.
          //
          // On-device id resolved in pass 1 above. It is either the raw wire
          // id or — under the cross-session id-collision guard (2026-06-01,
          // device-DB-proven) — a session-namespaced divert: the Watch mints
          // freestyle ids ("ADD-<n>") from an in-memory counter that resets on
          // relaunch, so a LATER session can mint a wire id that ALREADY exists
          // on-device under an EARLIER session. `set.id` is the PRIMARY KEY, so
          // a raw INSERT … ON CONFLICT(id) DO UPDATE would clobber the prior
          // session's row (moving its session_exercise_id + parent_set_id to
          // THIS session, session_id left stale → cross-session orphan). The
          // namespaced id keeps the rows distinct.
          const localSetId = resolved.onDeviceId;
          await db.runAsync(
            `INSERT INTO "set"
               (id, session_id, exercise_id, session_exercise_id,
                weight_kg, reps, notes, set_kind, is_logged,
                ordering, created_at, parent_set_id, display_rank)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               weight_kg = excluded.weight_kg,
               reps = excluded.reps,
               notes = excluded.notes,
               set_kind = excluded.set_kind,
               is_logged = excluded.is_logged,
               ordering = excluded.ordering,
               session_exercise_id = excluded.session_exercise_id,
               parent_set_id = excluded.parent_set_id,
               display_rank = excluded.display_rank`,
            localSetId,
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
            resolvedParentId,
            // Watch display rank (#1/#2). Absent on a legacy Watch build →
            // null → iPhone sort falls back to `ordering`.
            s.display_rank ?? null,
          );
          keptSetIds.push(localSetId);
          exSetIds.push(localSetId);
          // Map the WIRE id → the on-device id so a later follower in THIS pass
          // resolves its parent to the (possibly diverted) head id.
          setIdMap.set(s.setId, localSetId);
        }
      }

      // ----- dropset-chain integrity heal (2026-06-28 cast rapid-tap race) -----
      // Enforce the invariant "a dropset FOLLOWER's parent must itself be a
      // dropset row". A rapid working↔dropset cycle on the Watch during sync can
      // land the head's working flip and the follower's row in DIFFERENT ticks
      // (head + follower are written by independent pass-2 branches), leaving an
      // ORPHAN follower (set_kind='dropset', parent → a row that is now
      // 'working' / was deleted). `setLabels.ts` then renders it as a BLANK kind
      // box (dropset + non-null parent → '') with no head before it, while the
      // Watch — which decides head/follower by `parentSetId == nil` — keeps
      // showing it as a "D1" head → the device-observed role SPLIT.
      //
      // Demote each such orphan to working + clear its parent. Data-safe: only
      // the kind/parent columns change, the row (and its weight/reps) survive.
      // The `NOT IN (… dropset …)` test reads the FINAL DB state, so a legit
      // follower whose head is merely ABSENT-from-this-snapshot but still a
      // dropset row in the DB is LEFT ALONE (its parent id IS in the subquery) —
      // only a genuinely headless follower (head turned working / deleted) is
      // demoted. Runs BEFORE the purge so a demoted row is counted as kept.
      if (exSetIds.length > 0) {
        const healPlaceholders = exSetIds.map(() => '?').join(', ');
        await db.runAsync(
          `UPDATE "set"
              SET set_kind = 'working', parent_set_id = NULL
            WHERE id IN (${healPlaceholders})
              AND set_kind = 'dropset'
              AND parent_set_id IS NOT NULL
              AND parent_set_id NOT IN
                  (SELECT id FROM "set" WHERE set_kind = 'dropset')`,
          ...exSetIds,
        );
      }

      // ----- live per-exercise SET purge -----
      // Keep the live mirror's per-exercise set list in lockstep with the
      // Watch so dropset structure edits don't leave orphan rows mid-session
      // (the in-progress iPhone view was the only place these showed —
      // end-session `purgeTail` already cleaned history). Only deletes sets
      // UNDER this present exercise; absent exercises stay end-session's job.
      if (opts.purgeSetsInPresentExercises) {
        const keep = exSetIds.length > 0 ? exSetIds : [''];
        const placeholders = keep.map(() => '?').join(', ');
        const del = await db.runAsync(
          `DELETE FROM "set"
            WHERE session_exercise_id = ? AND id NOT IN (${placeholders})`,
          seId,
          ...keep,
        );
        purgedSets += del.changes ?? 0;
      }
    }

    // ----- live EXERCISE purge (#4, 2026-06-02) -----
    // Delete session_exercise rows the snapshot no longer contains (a Watch
    // delete-exercise) plus their sets. NARROWER than `purgeTail`: it removes
    // whole ABSENT exercises only, never tail sets inside a PRESENT exercise
    // (that is `purgeSetsInPresentExercises`'s job, run per-exercise above).
    // Before this, a Watch delete-exercise reached History (end-session
    // `purgeTail`) but not the in-progress iPhone session. Safe live because
    // the producer sends the FULL exercise tree each tick + the H1 gate
    // already dropped post-teardown stragglers. The end path passes false
    // (its `purgeTail` covers absent exercises too).
    if (opts.purgeExercisesAbsentFromSnapshot) {
      const seKeep = keptSeIds.length > 0 ? keptSeIds : [''];
      const sePlaceholders = seKeep.map(() => '?').join(', ');
      // Sets under absent exercises FIRST (explicit — do NOT rely on FK
      // CASCADE). `session_exercise_id IS NOT NULL` keeps a NULL-attributed
      // legacy/orphan set out of this scope (it can't be tied to a deleted
      // exercise); SQL's `NULL NOT IN (...)` would already exclude it, but the
      // predicate is explicit for clarity.
      const setDel = await db.runAsync(
        `DELETE FROM "set"
          WHERE session_id = ?
            AND session_exercise_id IS NOT NULL
            AND session_exercise_id NOT IN (${sePlaceholders})`,
        snapshot.sessionId,
        ...seKeep,
      );
      purgedSets += setDel.changes ?? 0;
      const seDel = await db.runAsync(
        `DELETE FROM session_exercise
          WHERE session_id = ? AND id NOT IN (${sePlaceholders})`,
        snapshot.sessionId,
        ...seKeep,
      );
      purgedExercises += seDel.changes ?? 0;
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

    // ----- Tombstone purge (Q5 precise live-delete, both directions) -----
    // Independent of `purgeTail`: delete EXACTLY the ids the originator
    // marked deleted THIS session. Precise (not a mass-purge of absent
    // rows), so it propagates a live delete <1s without the stale-snapshot
    // over-purge risk that `purgeTail: true` carries. An id that matches no
    // local row is a harmless no-op — if a divergent-id row exists for it,
    // the authoritative end-session mass-purge still removes it (see the
    // SessionSnapshot tombstone id contract).
    const tomb = snapshot.deletedIds;
    if (tomb) {
      if (tomb.setIds.length > 0) {
        // Match BOTH the raw wire id (a non-diverted on-device id, incl.
        // canonical UUIDs) AND the session-namespaced form (a Watch-authored
        // set diverted on a cross-session collision — see the INSERT branch).
        // Scoped to session_id, so neither form can touch another session's row.
        const tombIds = [
          ...tomb.setIds,
          ...tomb.setIds.map((id) => localizeSetId(snapshot.sessionId, id)),
        ];
        const ph = tombIds.map(() => '?').join(', ');
        const r = await db.runAsync(
          `DELETE FROM "set" WHERE session_id = ? AND id IN (${ph})`,
          snapshot.sessionId,
          ...tombIds,
        );
        tombstonedSets += r.changes ?? 0;
      }
      if (tomb.exerciseIds.length > 0) {
        const ph = tomb.exerciseIds.map(() => '?').join(', ');
        // Delete the exercise's sets FIRST (explicit — do NOT rely on FK
        // CASCADE), then the orphaned exercise rows.
        const rs = await db.runAsync(
          `DELETE FROM "set"
            WHERE session_id = ? AND session_exercise_id IN (${ph})`,
          snapshot.sessionId,
          ...tomb.exerciseIds,
        );
        tombstonedSets += rs.changes ?? 0;
        const re = await db.runAsync(
          `DELETE FROM session_exercise
            WHERE session_id = ? AND id IN (${ph})`,
          snapshot.sessionId,
          ...tomb.exerciseIds,
        );
        tombstonedExercises += re.changes ?? 0;
      }
    }

    // ----- Q7 (grill 2026-06-05): cascade-delete orphaned dropset followers --
    // Decision「連 head 刪整鏈」: when a dropset HEAD is removed (end-session
    // purgeTail, the live per-exercise / absent-exercise purge, OR a
    // tombstone), a surviving follower still pointing at the now-deleted head
    // is a dangling FK (broken chain → unnumbered orphan in history). Rather
    // than re-home it as a standalone working set, delete the rest of the chain
    // too. Runs after every delete path so the「no follower without a head」
    // invariant holds session-wide; a follower whose head still exists is
    // untouched (the subquery lists surviving ids). Idempotent — 0 rows when
    // the tree is already clean (e.g. a pure upsert tick).
    const orphanDel = await db.runAsync(
      `DELETE FROM "set"
        WHERE session_id = ?
          AND parent_set_id IS NOT NULL
          AND parent_set_id NOT IN (SELECT id FROM "set" WHERE session_id = ?)`,
      snapshot.sessionId,
      snapshot.sessionId,
    );
    purgedSets += orphanDel.changes ?? 0;
  });

  // H1 liveness gate fired — the transaction wrote nothing. Report a clean
  // zero-count skip so the live caller can surface `code:'session-gone'`.
  if (skipped) {
    return {
      exerciseCount: 0,
      setCount: 0,
      purgedExercises: 0,
      purgedSets: 0,
      tombstonedExercises: 0,
      tombstonedSets: 0,
      skipped,
    };
  }

  const setCount = snapshot.exercises.reduce(
    (acc, ex) => acc + ex.sets.length,
    0,
  );
  return {
    exerciseCount: snapshot.exercises.length,
    setCount,
    purgedExercises,
    purgedSets,
    tombstonedExercises,
    tombstonedSets,
    skipped: null,
  };
}

/**
 * Replace the iPhone-side mirror of an active session with a Watch-
 * supplied snapshot, reconciling onto any canonical (template-built)
 * tree by natural key. Called by D32's applicationContext listener.
 *
 * Live-mirror semantics: upsert + membership-purge WITHIN the live tree —
 * `purgeSetsInPresentExercises` removes Watch-deleted sets inside a present
 * exercise, and `purgeExercisesAbsentFromSnapshot` (#4) removes whole Watch-
 * deleted exercises. Both are safe because the producer sends the FULL tree
 * each tick (absence = a real delete) and the H1 gate drops stragglers. It
 * still passes `purgeTail: false` — the unconstrained session-wide tail purge
 * (and the unconditional session UPSERT) stays the end-session reconcile's
 * job; the live tick only mirrors current membership.
 *
 * Liveness gate (H1): passes `requireExistingLiveSession: true` so a tick
 * that lands after the session was discarded / finalized (unordered WC
 * channels) is dropped instead of resurrecting a zombie. Returns the
 * reconcile result so the caller can read `.skipped === 'session-gone'`.
 */
export async function replaceLiveMirror(
  db: Database,
  snapshot: SessionSnapshot,
): Promise<ReconcileSessionTreeResult> {
  return reconcileSessionTree(db, snapshot, {
    purgeTail: false,
    purgeSetsInPresentExercises: true,
    // #4 (2026-06-02): a Watch delete-exercise must propagate to the
    // in-progress iPhone session, not just to History at end-session.
    purgeExercisesAbsentFromSnapshot: true,
    requireExistingLiveSession: true,
  });
}
