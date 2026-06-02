import type { Database } from '../types';

/**
 * v025 — `set.display_rank REAL` (slice 13d 2026-06-02, device-bug #1/#2).
 *
 * Background
 * ----------
 * The Watch is the source of truth during a live session. Its set logger
 * lets the user REORDER sets (long-press drag) and INSERT a set mid-list
 * (+1 「插下一行」). The Watch tracks this with a fractional `displayRank`
 * (Double) — `SessionInteractionState.setRankOverrides` for reorders and
 * `AddedSet.displayRank` (midpoint between neighbours) for mid-inserts —
 * and `LiveMirrorProducer.mergeSets` already SORTS the snapshot by it.
 *
 * But the wire `ordinal` is deliberately glued to set IDENTITY (the iPhone
 * reconcile matches base sets by `(session_exercise_id, ordinal)` VALUE, so
 * a mid-list delete purges the right row — see `replaceLiveMirror`). The
 * ordinal therefore CANNOT also encode display position. Pre-this-migration
 * the wire carried only `ordinal`, so the iPhone re-sorted by `set.ordering`
 * (= ordinal) and LOST the Watch's display order → a Watch reorder / mid-
 * insert did not propagate (device bugs #1 拖曳換位 / #2 中插位置).
 *
 * Fix: carry the Watch's effective rank on the wire as `display_rank` and
 * render by it. This column is the iPhone-side landing spot.
 *
 * Schema
 * ------
 * `display_rank REAL` — nullable (no DEFAULT). Real (not integer) because a
 * mid-insert rank is a fractional midpoint (e.g. between 2 and 3 → 2.5). The
 * row IDENTITY is unchanged — still `(session_exercise_id, ordering)`; this
 * column is a pure SORT key. `computeSessionSetLayout` sorts by
 * `display_rank ?? ordering`, so a NULL (a plain iPhone-authored set, or a
 * set synced from a legacy Watch build that omits the field) transparently
 * falls back to the legacy `ordering` sort = no behaviour change.
 *
 * Backfill
 * --------
 * `display_rank = ordering` for every existing row, so a session created
 * before this migration renders byte-identically (display order == creation
 * order, which is exactly what `ordering` already gave). Guarded by
 * `WHERE display_rank IS NULL` so it only touches the freshly-added column.
 *
 * Idempotency
 * -----------
 * `PRAGMA table_info("set")` introspection before ADD COLUMN (parallel to
 * v019/v024); the backfill UPDATE is `WHERE display_rank IS NULL` so a
 * re-run never overwrites a real value. SQLite `ALTER TABLE ADD COLUMN`
 * can't add a CHECK/constraint, which is fine — this is a plain nullable
 * sort column.
 */
export async function v025_set_display_rank(db: Database): Promise<void> {
  const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info("set")`);
  if (!cols.some((c) => c.name === 'display_rank')) {
    await db.execAsync(`ALTER TABLE "set" ADD COLUMN display_rank REAL;`);
  }
  // Backfill: display order == creation order for pre-13d rows. WHERE guard
  // keeps it a no-op on a re-run (and on a fresh DB the table is empty).
  await db.execAsync(
    `UPDATE "set" SET display_rank = ordering WHERE display_rank IS NULL;`,
  );
}
