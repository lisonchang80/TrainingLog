import type { Database } from '../types';

/**
 * v022 — `program_sub_tag` table: persistent per-program 強度 label dictionary
 * (round 15 polish, 2026-05-21).
 *
 * Problem this solves
 * -------------------
 * The Programs tab row-apply picker and template-meta-sheet built their
 * 強度 chip list by scanning either `program_cell.sub_tag` (cells currently
 * using a label) or `template.sub_tag` (templates currently classified
 * under a label). Both sources are *transient* — once the last cell using
 * "II-2" is overwritten to "II-1", "II-2" disappears from the picker
 * entirely. Users complained that a 強度 they typed minutes ago "won't
 * save" — actually it was applied, then disappeared from the chip list as
 * soon as no cell or template referenced it.
 *
 * Schema
 * ------
 * One row per (program, sub_tag) ever introduced. Inserts are idempotent
 * via `INSERT OR IGNORE` on the composite PRIMARY KEY. Cascades on program
 * deletion (cleaning up label dictionary when a program is removed).
 *
 * Backfill
 * --------
 * On migration, populate the table from two existing sources for backward
 * compatibility — any program already referenced by templates/cells gets
 * its current strength labels seeded so picker behavior is consistent for
 * pre-existing data:
 *   - `template.sub_tag` (where program_id IS NOT NULL)
 *   - `program_cell.sub_tag` (where sub_tag IS NOT NULL)
 *
 * Idempotency: re-runs are no-ops via INSERT OR IGNORE on the table
 * creation isn't possible (CREATE TABLE IF NOT EXISTS); backfill uses
 * INSERT OR IGNORE so duplicate (program_id, sub_tag) pairs collapse to
 * the existing row.
 */
export async function v022_program_sub_tag(db: Database): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS program_sub_tag (
      program_id TEXT NOT NULL,
      sub_tag TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (program_id, sub_tag),
      FOREIGN KEY (program_id) REFERENCES program(id) ON DELETE CASCADE
    );
  `);
  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_program_sub_tag_program
      ON program_sub_tag (program_id);
  `);

  const now = Date.now();

  // Backfill from `template.sub_tag` — every distinct (program_id, sub_tag)
  // currently classified on templates becomes a known label for that program.
  await db.runAsync(
    `INSERT OR IGNORE INTO program_sub_tag (program_id, sub_tag, created_at)
       SELECT DISTINCT program_id, sub_tag, ?
         FROM template
        WHERE program_id IS NOT NULL
          AND sub_tag IS NOT NULL
          AND sub_tag != ''`,
    now,
  );

  // Backfill from `program_cell.sub_tag` — any sub_tag stamped onto a cell
  // is also a known label for that program (covers labels that may have
  // been added via row-apply ▶ before any template was created).
  await db.runAsync(
    `INSERT OR IGNORE INTO program_sub_tag (program_id, sub_tag, created_at)
       SELECT DISTINCT program_id, sub_tag, ?
         FROM program_cell
        WHERE sub_tag IS NOT NULL
          AND sub_tag != ''`,
    now,
  );
}
