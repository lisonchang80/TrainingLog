import type { Database } from '../types';

/**
 * v005 — Program + Cycle × Day grid + Template triple identity (slice 5).
 *
 * New tables:
 *   - program          (named training cycle plan; one is "active" at a time)
 *   - program_cell     (one row per (program × cycle_index × day_index) — the
 *                       grid cell linking a date in the cycle to a template +
 *                       per-cell 強度)
 *
 * Extended:
 *   - template gets `program_id` (nullable; NULL = 自由 free template) and
 *     `sub_tag` (nullable; per ADR-0003 the Template identity is the triple
 *     `(name, program_id, sub_tag)` so two templates with the same name in the
 *     same program but different sub_tags are independent entities — e.g.
 *     「胸日 (增肌-Q1, 10-12RM)」 vs 「胸日 (增肌-Q1, 8-10RM)」). Existing
 *     slice 3/4 templates remain as 自由 (program_id NULL, sub_tag NULL).
 *
 * `cycle_length` is constrained to 3-14 per ADR-0004 (training cycles outside
 * this range are vanishingly rare and complicate UI rendering). Enforcement
 * happens in the program manager (`validateProgram`) — SQLite CHECK is added
 * for defence in depth.
 *
 * `is_active` is a 0/1 flag; the application enforces "at most one active
 * program" at write time (rather than via a partial unique index — SQLite
 * supports those but it complicates testing on better-sqlite3).
 */
export async function v005_program(db: Database): Promise<void> {
  await db.execAsync(`
    CREATE TABLE program (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      main_tag TEXT,
      cycle_length INTEGER NOT NULL CHECK (cycle_length >= 3 AND cycle_length <= 14),
      cycle_count INTEGER NOT NULL CHECK (cycle_count >= 1),
      start_date TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE program_cell (
      id TEXT PRIMARY KEY NOT NULL,
      program_id TEXT NOT NULL REFERENCES program(id),
      cycle_index INTEGER NOT NULL,
      day_index INTEGER NOT NULL,
      template_id TEXT REFERENCES template(id),
      sub_tag TEXT,
      UNIQUE(program_id, cycle_index, day_index)
    );

    CREATE INDEX idx_program_cell_program ON program_cell(program_id);

    ALTER TABLE template ADD COLUMN program_id TEXT;
    ALTER TABLE template ADD COLUMN sub_tag TEXT;
  `);
}
