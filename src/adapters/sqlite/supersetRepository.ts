import type { Database } from '../../db/types';
import type {
  Exercise,
  Equipment,
  LoadType,
} from '../../domain/exercise/types';
import {
  createReusableSuperset,
  type ReusableSupersetDraft,
} from '../../domain/superset/supersetManager';
import type {
  ReusableSuperset,
  ReusableSupersetWithExercises,
  SupersetExerciseSlot,
} from '../../domain/superset/types';

/**
 * Persistence layer for the Reusable Superset library (ADR-0017 Q10, v011
 * schema). Matches exerciseLibraryRepository style: pure functions over a
 * `Database` interface; domain layer (supersetManager) supplies the row
 * builders, this file handles I/O + tx.
 *
 * Sort order for the library grid: `use_count DESC, updated_at DESC` —
 * recently / heavily used supersets float to the top, ties broken by
 * recency. Caller can re-sort client-side if needed.
 */

interface SupersetRow {
  id: string;
  name: string;
  color_hex: string | null;
  use_count: number;
  created_at: number;
  updated_at: number;
}

interface SupersetExerciseJoinRow {
  superset_id: string;
  position: number;
  exercise_id: string;
  // hydrated exercise columns
  e_id: string;
  e_name: string;
  e_load_type: LoadType;
  e_is_builtin: number;
  e_is_archived: number;
  e_muscle_group_id: string | null;
  e_is_custom: number;
  e_equipment: Equipment;
  e_notes: string | null;
  e_media_path: string | null;
  e_cues_text: string | null;
}

function rowToExercise(r: SupersetExerciseJoinRow): Exercise {
  return {
    id: r.e_id,
    name: r.e_name,
    load_type: r.e_load_type,
    is_builtin: r.e_is_builtin,
    is_archived: r.e_is_archived,
    muscle_group_id: r.e_muscle_group_id,
    is_custom: r.e_is_custom,
    equipment: r.e_equipment,
    notes: r.e_notes,
    media_path: r.e_media_path,
    cues_text: r.e_cues_text,
  };
}

export async function listReusableSupersets(
  db: Database
): Promise<ReusableSuperset[]> {
  return db.getAllAsync<SupersetRow>(
    `SELECT id, name, color_hex, use_count, created_at, updated_at
       FROM superset
      ORDER BY use_count DESC, updated_at DESC`
  );
}

/**
 * Hydrated list for the library sidebar tab. One query joins each superset
 * to its 2 (position 0/1) exercises; rows are grouped by superset id and
 * exercises emitted in `position` order.
 *
 * If a superset has != 2 exercises (corruption — UI prevents creating
 * size != 2), this function still emits the row but with however many
 * exercises were found. Caller should treat `exercises.length !== 2` as
 * a data-quality bug.
 */
export async function listReusableSupersetsWithExercises(
  db: Database
): Promise<ReusableSupersetWithExercises[]> {
  const supersets = await listReusableSupersets(db);
  if (supersets.length === 0) return [];

  const links = await db.getAllAsync<SupersetExerciseJoinRow>(
    `SELECT se.superset_id, se.position, se.exercise_id,
            e.id          AS e_id,
            e.name        AS e_name,
            e.load_type   AS e_load_type,
            e.is_builtin  AS e_is_builtin,
            e.is_archived AS e_is_archived,
            e.muscle_group_id AS e_muscle_group_id,
            e.is_custom   AS e_is_custom,
            e.equipment   AS e_equipment,
            e.notes       AS e_notes,
            e.media_path  AS e_media_path,
            e.cues_text   AS e_cues_text
       FROM superset_exercise se
       JOIN exercise e ON e.id = se.exercise_id
      ORDER BY se.superset_id, se.position ASC`
  );

  const byId = new Map<string, Exercise[]>();
  for (const l of links) {
    const list = byId.get(l.superset_id) ?? [];
    list.push(rowToExercise(l));
    byId.set(l.superset_id, list);
  }

  return supersets.map((s) => ({
    superset: s,
    exercises: byId.get(s.id) ?? [],
  }));
}

export async function getReusableSupersetWithExercises(
  db: Database,
  id: string
): Promise<ReusableSupersetWithExercises | null> {
  const row = await db.getFirstAsync<SupersetRow>(
    `SELECT id, name, color_hex, use_count, created_at, updated_at
       FROM superset WHERE id = ?`,
    id
  );
  if (!row) return null;
  const links = await db.getAllAsync<SupersetExerciseJoinRow>(
    `SELECT se.superset_id, se.position, se.exercise_id,
            e.id          AS e_id,
            e.name        AS e_name,
            e.load_type   AS e_load_type,
            e.is_builtin  AS e_is_builtin,
            e.is_archived AS e_is_archived,
            e.muscle_group_id AS e_muscle_group_id,
            e.is_custom   AS e_is_custom,
            e.equipment   AS e_equipment,
            e.notes       AS e_notes,
            e.media_path  AS e_media_path,
            e.cues_text   AS e_cues_text
       FROM superset_exercise se
       JOIN exercise e ON e.id = se.exercise_id
      WHERE se.superset_id = ?
      ORDER BY se.position ASC`,
    id
  );
  return { superset: row, exercises: links.map(rowToExercise) };
}

/**
 * Look up whether a Reusable Superset already exists with the SAME pair of
 * exercises (order-insensitive: {A, B} == {B, A}). Returns the existing
 * superset's id, or null if no dup.
 *
 * Used by:
 *   - `insertReusableSuperset` — last-line DB guard before INSERT
 *   - UI pre-check in `app/superset/new.tsx` — earlier user-friendly alert
 *     before the throw round-trip
 *
 * SQL strategy: the inner sub-query restricts to supersets that have
 * exactly 2 distinct exercise ids (the well-formed shape per v011); the
 * outer aggregate ensures both of the input ids are present. The
 * `COUNT(DISTINCT exercise_id) = 2` guard means a row pairing exercise A
 * with itself cannot match a query for (A, B). The outer
 * `HAVING COUNT(*) = 2` (combined with the inner `AND exercise_id IN (?, ?)`)
 * confirms both target ids exist for the same superset. Order-insensitive
 * by construction — we never reference `position`.
 */
export async function findExistingReusableSupersetByPair(
  db: Database,
  exercise_id_a: string,
  exercise_id_b: string
): Promise<string | null> {
  if (exercise_id_a === exercise_id_b) {
    // A pair against itself can't form a valid RS (validate-draft rejects
    // it). Return null — there is no "existing matching pair" to surface.
    return null;
  }
  type Row = { superset_id: string };
  const rows = await db.getAllAsync<Row>(
    `SELECT superset_id
       FROM superset_exercise
      WHERE superset_id IN (
        SELECT superset_id
          FROM superset_exercise
         GROUP BY superset_id
         HAVING COUNT(DISTINCT exercise_id) = 2
            AND COUNT(*) = 2
      )
        AND exercise_id IN (?, ?)
      GROUP BY superset_id
      HAVING COUNT(DISTINCT exercise_id) = 2`,
    exercise_id_a,
    exercise_id_b
  );
  return rows.length > 0 ? rows[0].superset_id : null;
}

/**
 * Insert a new Reusable Superset + its 2 link rows in one transaction.
 *
 * Caller MUST `validateReusableSupersetDraft` first. UUID generator is
 * injected (Hermes lacks `crypto.randomUUID`).
 *
 * Throws `Error('duplicate RS pair: ...')` if an RS template with the same
 * (exercise_id_a, exercise_id_b) pair (order-insensitive) already exists.
 * UI should pre-check via `findExistingReusableSupersetByPair` for a nicer
 * error path; this throw is the last-line DB guard against races / future
 * caller bugs.
 *
 * Returns the new superset id.
 */
export async function insertReusableSuperset(
  db: Database,
  draft: ReusableSupersetDraft,
  uuid: () => string,
  now: () => number
): Promise<string> {
  const { superset, links } = createReusableSuperset({
    draft,
    idGen: uuid,
    now,
  });

  // Dup pair guard — mirror appendReusableSupersetToSession's
  // SELECT-then-throw pattern. Runs BEFORE the transaction wrap so the
  // throw doesn't leave behind a partial row.
  const [exA, exB] = draft.exercise_ids;
  const existing = await findExistingReusableSupersetByPair(db, exA, exB);
  if (existing !== null) {
    throw new Error(
      `duplicate RS pair: 已有同樣動作組合的超級組 (existing id: ${existing})`
    );
  }

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO superset (id, name, color_hex, use_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      superset.id,
      superset.name,
      superset.color_hex,
      superset.use_count,
      superset.created_at,
      superset.updated_at
    );
    for (const l of links) {
      await db.runAsync(
        `INSERT INTO superset_exercise (superset_id, position, exercise_id)
         VALUES (?, ?, ?)`,
        l.superset_id,
        l.position,
        l.exercise_id
      );
    }
  });

  return superset.id;
}

export async function updateReusableSupersetName(
  db: Database,
  id: string,
  name: string,
  now: () => number
): Promise<void> {
  await db.runAsync(
    `UPDATE superset SET name = ?, updated_at = ? WHERE id = ?`,
    name.trim(),
    now(),
    id
  );
}

/**
 * Slice 10c overnight #24 — dynamic "N 次" badge for the RS template card,
 * aligned with #19 方向 A for solo exercises (`exerciseLibraryRepository.
 * getExerciseSessionCount`). One "次" = one ended session that recorded at
 * least one logged (`is_logged=1 AND is_skipped=0`) set against a
 * `session_exercise` row carrying `reusable_superset_id = ?`.
 *
 * Why not read `superset.use_count` directly?
 *   `superset.use_count` is a hand-maintained counter that only bumps on
 *   "explode RS into Template" via `incrementUseCount`. Sessions that
 *   actually log sets through a Template→Session expansion never re-bump
 *   the counter, so the library badge under-counts real usage. The
 *   counter column is preserved for the explode flow but UIs that want
 *   "real usage" should call this function instead.
 *
 * INNER JOIN on `session_exercise.id = set.session_exercise_id`:
 *   All RS-side `set` rows are inserted with `session_exercise_id` set —
 *   the slice 10c set logger has always wired this through (see
 *   `setRepository.insertSessionSet`). v019-and-later sets are guaranteed
 *   non-NULL on `session_exercise_id` when the set originated from a
 *   cluster card. Pre-v019 data MAY have NULL `session_exercise_id`, but
 *   pre-v019 also pre-dates RS-on-session-side, so a NULL row physically
 *   cannot belong to an RS — the inner JOIN is safe.
 */
export async function getReusableSupersetSessionCount(
  db: Database,
  supersetId: string
): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(DISTINCT s.session_id) AS n
       FROM "set" s
       JOIN session ss ON ss.id = s.session_id
       JOIN session_exercise se ON se.id = s.session_exercise_id
      WHERE se.reusable_superset_id = ?
        AND s.is_logged = 1
        AND s.is_skipped = 0
        AND ss.ended_at IS NOT NULL`,
    supersetId
  );
  return row?.n ?? 0;
}

/**
 * Batch variant — one query returns a `Map<supersetId, count>` covering
 * every RS template that has at least one logged set in an ended session.
 * Used by the library grid to avoid N+1 lookups.
 *
 * RS templates with zero usage will be MISSING from the map (not present
 * with value 0) — callers should treat `map.get(id) ?? 0` as the count.
 */
export async function getReusableSupersetSessionCounts(
  db: Database
): Promise<Map<string, number>> {
  const rows = await db.getAllAsync<{ reusable_superset_id: string; n: number }>(
    `SELECT se.reusable_superset_id AS reusable_superset_id,
            COUNT(DISTINCT s.session_id) AS n
       FROM "set" s
       JOIN session ss ON ss.id = s.session_id
       JOIN session_exercise se ON se.id = s.session_exercise_id
      WHERE se.reusable_superset_id IS NOT NULL
        AND s.is_logged = 1
        AND s.is_skipped = 0
        AND ss.ended_at IS NOT NULL
      GROUP BY se.reusable_superset_id`
  );
  return new Map(rows.map((r) => [r.reusable_superset_id, r.n]));
}

/**
 * Increment `use_count` by 1 and bump `updated_at`. Called by domain hooks
 * after a successful explode-into-Template / add-to-Session.
 *
 * Slice 10c #24: `superset.use_count` column is preserved for the explode
 * flow's bump call site (`bumpReusableSupersetUseCount`) but is NO LONGER
 * read by the library "N 次" badge — use `getReusableSupersetSessionCount`
 * / `getReusableSupersetSessionCounts` instead.
 */
export async function incrementUseCount(
  db: Database,
  id: string,
  now: () => number
): Promise<void> {
  await db.runAsync(
    `UPDATE superset SET use_count = use_count + 1, updated_at = ? WHERE id = ?`,
    now(),
    id
  );
}

/**
 * Delete a Reusable Superset. `superset_exercise` rows wipe via
 * ON DELETE CASCADE; existing Templates that already exploded this
 * superset are unaffected (the explode model decouples after add).
 */
export async function deleteReusableSuperset(
  db: Database,
  id: string
): Promise<void> {
  await db.runAsync(`DELETE FROM superset WHERE id = ?`, id);
}

/**
 * Internal helper exported for tests: returns the raw 2-link rows for a
 * superset in position order. Production callers should use
 * `getReusableSupersetWithExercises` instead.
 */
export async function listSlotsForSuperset(
  db: Database,
  superset_id: string
): Promise<SupersetExerciseSlot[]> {
  return db.getAllAsync<SupersetExerciseSlot>(
    `SELECT superset_id, position, exercise_id
       FROM superset_exercise
      WHERE superset_id = ?
      ORDER BY position ASC`,
    superset_id
  );
}
