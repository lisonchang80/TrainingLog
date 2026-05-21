import type { Database } from '../../db/types';
import type {
  ProgramCell,
  ProgramCore,
  ProgramWithCells,
} from '../../domain/program/types';
import { RESERVED_NONE_PROGRAM_ID } from '../../db/seed/v017ProgramNone';

/**
 * Persistence layer for Program + cells (slice 5).
 *
 * Same pure-function-over-`Database` pattern as templateRepository. Handles
 * the "at most one active program" invariant at write time (createProgram +
 * setActiveProgram) since SQLite partial-unique-index support is awkward to
 * test on better-sqlite3.
 *
 * Per ADR-0003: a Template's identity is the triple `(name, program_id,
 * sub_tag)` — this repository attaches/detaches templates to a Program but
 * does NOT enforce triple uniqueness in SQL (the wizard validates pre-insert;
 * a future slice may add a unique index when name-level propagation lands).
 */

export interface ProgramRow extends ProgramCore {
  created_at: number;
  updated_at: number;
}

export interface ProgramSummary {
  id: string;
  name: string;
  main_tag: string | null;
  cycle_length: number;
  cycle_count: number;
  start_date: string;
  is_active: 0 | 1;
  cellCount: number;
}

export async function listPrograms(db: Database): Promise<ProgramSummary[]> {
  // The reserved 「無」 program (id = RESERVED_NONE_PROGRAM_ID, seeded by
  // v017 per ADR-0019 § (N1)) is filtered out of the user-facing program
  // list — it represents "no program assigned" and is not editable /
  // deletable. Sessions / templates can still resolve their `program_id`
  // FK to it via `getProgram(id)` for display purposes.
  return db.getAllAsync<ProgramSummary>(
    `SELECT p.id, p.name, p.main_tag, p.cycle_length, p.cycle_count,
            p.start_date, p.is_active,
            COUNT(c.id) AS cellCount
       FROM program p
       LEFT JOIN program_cell c ON c.program_id = p.id
      WHERE p.id != ?
      GROUP BY p.id
      ORDER BY p.is_active DESC, p.updated_at DESC`,
    RESERVED_NONE_PROGRAM_ID
  );
}

export async function getProgram(
  db: Database,
  id: string
): Promise<ProgramWithCells | null> {
  const p = await db.getFirstAsync<ProgramRow>(
    `SELECT id, name, main_tag, cycle_length, cycle_count, start_date,
            is_active, created_at, updated_at
       FROM program WHERE id = ?`,
    id
  );
  if (!p) return null;
  const cells = await db.getAllAsync<ProgramCell>(
    `SELECT id, program_id, cycle_index, day_index, template_id, sub_tag
       FROM program_cell
      WHERE program_id = ?
      ORDER BY cycle_index ASC, day_index ASC`,
    id
  );
  return {
    program: {
      id: p.id,
      name: p.name,
      main_tag: p.main_tag,
      cycle_length: p.cycle_length,
      cycle_count: p.cycle_count,
      start_date: p.start_date,
      is_active: p.is_active,
    },
    cells,
  };
}

/** The currently-active program (or null). Used by Today to resolve "today's cell". */
export async function getActiveProgram(
  db: Database
): Promise<ProgramWithCells | null> {
  const row = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM program WHERE is_active = 1 LIMIT 1`
  );
  if (!row) return null;
  return getProgram(db, row.id);
}

/**
 * Create a Program and (optionally) its full cell grid in one transaction.
 * If `cells` is provided, every cell is INSERTed; otherwise the program is
 * empty and cells can be added later (not currently exposed by the wizard).
 *
 * `is_active` is forced to 0 here — call `setActiveProgram(id)` afterwards
 * if the caller wants to flip the flag (which also de-activates any other
 * active program in the same transaction).
 *
 * Name uniqueness: SELECT-then-throw guard against case-insensitive trimmed
 * dup names. Throws `Error('DUPLICATE_PROGRAM_NAME')` if `LOWER(TRIM(name))`
 * collides with an existing row. Mirror the `insertReusableSuperset` pattern
 * (round 26) — we don't add a SQL UNIQUE constraint because SQLite's
 * case-insensitive UNIQUE indexes require COLLATE NOCASE on the column and
 * we'd need a migration. UI is expected to surface this as an Alert so the
 * user can rename + retry inline.
 */
export async function createProgram(
  db: Database,
  args: {
    program: ProgramCore;
    cells?: ProgramCell[];
    now?: () => number;
  }
): Promise<void> {
  const ts = (args.now ?? Date.now)();
  // Dup guard — case-insensitive + trim match. Reserved「無」 (RESERVED_NONE_PROGRAM_ID)
  // is included in this scan so users can't shadow it either.
  const existing = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM program WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1`,
    args.program.name
  );
  if (existing) {
    throw new Error('DUPLICATE_PROGRAM_NAME');
  }
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO program
         (id, name, main_tag, cycle_length, cycle_count, start_date,
          is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      args.program.id,
      args.program.name,
      args.program.main_tag,
      args.program.cycle_length,
      args.program.cycle_count,
      args.program.start_date,
      ts,
      ts
    );
    for (const c of args.cells ?? []) {
      await db.runAsync(
        `INSERT INTO program_cell
           (id, program_id, cycle_index, day_index, template_id, sub_tag)
         VALUES (?, ?, ?, ?, ?, ?)`,
        c.id,
        c.program_id,
        c.cycle_index,
        c.day_index,
        c.template_id,
        c.sub_tag
      );
    }
  });
}

/**
 * Mark `id` active and de-activate every other program. Atomic via a single
 * transaction. No-op if `id` doesn't exist.
 */
export async function setActiveProgram(
  db: Database,
  args: { id: string; now?: () => number }
): Promise<void> {
  const ts = (args.now ?? Date.now)();
  await db.withTransactionAsync(async () => {
    await db.runAsync(`UPDATE program SET is_active = 0`);
    await db.runAsync(
      `UPDATE program SET is_active = 1, updated_at = ? WHERE id = ?`,
      ts,
      args.id
    );
  });
}

/** Clear `is_active` on every program. */
export async function clearActiveProgram(db: Database): Promise<void> {
  await db.runAsync(`UPDATE program SET is_active = 0`);
}

/**
 * Permanently remove a Program and its cells. Templates that point at this
 * program (`template.program_id`) are NOT cascaded — they're "orphaned" and
 * become 自由 templates. This matches ADR-0003's stance that Template entities
 * live independently from their parent Program (they own their snapshot
 * history; deleting Program shouldn't shred prior Sessions' lineage).
 */
export async function deleteProgram(db: Database, id: string): Promise<void> {
  await db.withTransactionAsync(async () => {
    // Orphan attached templates rather than deleting them.
    await db.runAsync(
      `UPDATE template SET program_id = NULL, sub_tag = NULL WHERE program_id = ?`,
      id
    );
    await db.runAsync(`DELETE FROM program_cell WHERE program_id = ?`, id);
    await db.runAsync(`DELETE FROM program WHERE id = ?`, id);
  });
}

/**
 * Wave 15 (2026-05-21) — count of cells with `template_id != null` that
 * would be lost if the program were resized to `(new_cycle_length,
 * new_cycle_count)`. Cells with NULL template_id are 「休息」 = no
 * meaningful content, so they don't count toward the "this will erase
 * content" warning shown by the edit-mode resize Alert.
 */
export async function countFilledCellsOutsideBounds(
  db: Database,
  args: {
    program_id: string;
    new_cycle_length: number;
    new_cycle_count: number;
  }
): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM program_cell
      WHERE program_id = ?
        AND (cycle_index >= ? OR day_index >= ?)
        AND template_id IS NOT NULL`,
    args.program_id,
    args.new_cycle_count,
    args.new_cycle_length
  );
  return row?.n ?? 0;
}

/**
 * Wave 15 (2026-05-21) — atomic resize of a program's grid dimensions.
 * Updates `cycle_length` / `cycle_count` on the program row and DELETEs
 * any `program_cell` rows that fall outside the new bounds.
 *
 * New positions (within new bounds, no existing row) are NOT inserted —
 * the renderer treats missing rows as 「休息」 and any subsequent edit
 * (column-apply / row-apply / single-cell edit) uses `upsertCell` to
 * lazily INSERT when content first lands. Keeping the table sparse keeps
 * `getProgram` quick on large programs.
 *
 * `cycle_length` is CHECK 3-14 per ADR-0004 (v005 schema); `cycle_count`
 * is CHECK >= 1. Caller is responsible for validating the user input
 * before calling — the SQLite CHECK will throw but the message won't be
 * friendly to surface.
 */
export async function resizeProgram(
  db: Database,
  args: {
    program_id: string;
    new_cycle_length: number;
    new_cycle_count: number;
    now?: () => number;
  }
): Promise<void> {
  const ts = (args.now ?? Date.now)();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `DELETE FROM program_cell
        WHERE program_id = ?
          AND (cycle_index >= ? OR day_index >= ?)`,
      args.program_id,
      args.new_cycle_count,
      args.new_cycle_length
    );
    await db.runAsync(
      `UPDATE program
         SET cycle_length = ?,
             cycle_count = ?,
             updated_at = ?
       WHERE id = ?`,
      args.new_cycle_length,
      args.new_cycle_count,
      ts,
      args.program_id
    );
  });
}

/**
 * Wave 15 (2026-05-21) — upsert by (program_id, cycle_index, day_index).
 * Used by edit-mode column/row apply + single-cell edits (Phase 3-4).
 *
 * Behaviour:
 *   - If a `program_cell` exists at this position → UPDATE template_id +
 *     sub_tag in place.
 *   - Else → INSERT a new row with a caller-provided `uuid` (kept out of
 *     the helper to preserve the same pattern as createProgram).
 *
 * Returns the cell's id (existing or newly-inserted). `now` defaults to
 * Date.now and ticks program.updated_at so listPrograms ordering stays
 * correct.
 */
/**
 * Round 15 polish — record a (program_id, sub_tag) pair in the persistent
 * `program_sub_tag` label dictionary. INSERT OR IGNORE so duplicates are
 * silent no-ops. The picker reads from this table so 強度 labels persist
 * across overwrite cycles (e.g. row swapped from II-2 → II-1; user can
 * still see II-2 as a chip option to swap back).
 *
 * No-op when `sub_tag` is null / empty — only meaningful labels are
 * registered. Safe to call inside a transaction (single statement).
 */
export async function recordProgramSubTag(
  db: Database,
  program_id: string,
  sub_tag: string | null,
  now?: () => number,
): Promise<void> {
  if (sub_tag == null || sub_tag.length === 0) return;
  await db.runAsync(
    `INSERT OR IGNORE INTO program_sub_tag (program_id, sub_tag, created_at)
       VALUES (?, ?, ?)`,
    program_id,
    sub_tag,
    (now ?? Date.now)(),
  );
}

/**
 * Round 15 polish — list every (program_id, sub_tag) that's ever been
 * registered for this program, sorted alphabetically. Used by the Programs
 * tab row apply picker so user-typed labels persist even after no cell or
 * template currently references them.
 */
export async function listProgramSubTags(
  db: Database,
  program_id: string,
): Promise<string[]> {
  const rows = await db.getAllAsync<{ sub_tag: string }>(
    `SELECT sub_tag FROM program_sub_tag
      WHERE program_id = ?
      ORDER BY sub_tag ASC`,
    program_id,
  );
  return rows.map((r) => r.sub_tag);
}

export async function upsertCell(
  db: Database,
  args: {
    program_id: string;
    cycle_index: number;
    day_index: number;
    template_id: string | null;
    sub_tag: string | null;
    uuid: () => string;
    now?: () => number;
  }
): Promise<string> {
  const ts = (args.now ?? Date.now)();
  const existing = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM program_cell
      WHERE program_id = ? AND cycle_index = ? AND day_index = ?`,
    args.program_id,
    args.cycle_index,
    args.day_index
  );
  let cell_id: string;
  if (existing) {
    cell_id = existing.id;
    await db.runAsync(
      `UPDATE program_cell SET template_id = ?, sub_tag = ? WHERE id = ?`,
      args.template_id,
      args.sub_tag,
      cell_id
    );
  } else {
    cell_id = args.uuid();
    await db.runAsync(
      `INSERT INTO program_cell
         (id, program_id, cycle_index, day_index, template_id, sub_tag)
       VALUES (?, ?, ?, ?, ?, ?)`,
      cell_id,
      args.program_id,
      args.cycle_index,
      args.day_index,
      args.template_id,
      args.sub_tag
    );
  }
  await db.runAsync(
    `UPDATE program SET updated_at = ? WHERE id = ?`,
    ts,
    args.program_id
  );
  // Register sub_tag in the persistent per-program label dictionary so it
  // survives overwrite cycles (round 15 fix).
  await recordProgramSubTag(db, args.program_id, args.sub_tag, args.now);
  return cell_id;
}

/**
 * Wave 15 (2026-05-21) — bulk apply a template (or 休息) to an entire
 * column (day_index axis). For every cycle_index in [0, cycle_count) the
 * cell at (cycle_index, day_index) is upserted.
 *
 * Per user spec Q3:
 *   - `template_id = X`: set template, preserve each row's existing
 *     sub_tag. Cells that don't exist yet get sub_tag=NULL.
 *   - `template_id = null` (休息): clear both template_id AND sub_tag
 *     since rest occupies both visual slots.
 *
 * Round 15 polish (2026-05-21) — optional `sub_tag_override` (discriminated
 * via presence on the args object so `null` ≠ `undefined`):
 *   - omitted → preserve per-row sub_tag (Q3 default, used by the existing
 *     ▼ picker → "pick existing template" path).
 *   - present (string OR null) → write this value to every row in the
 *     column, overriding whatever was there. Used by the programs tab
 *     "+ 建立新模板" → 「建立並導入」 path (column kind) so the freshly-
 *     created template's sub_tag propagates to all cells in the column —
 *     otherwise the new sub_tag never lands anywhere and the row picker
 *     stays empty for newly-created programs.
 */
export async function applyTemplateToColumn(
  db: Database,
  args: {
    program_id: string;
    day_index: number;
    template_id: string | null;
    /** Present in args = override every row's sub_tag (even with null). */
    sub_tag_override?: string | null;
    uuid: () => string;
    now?: () => number;
  }
): Promise<void> {
  const ts = (args.now ?? Date.now)();
  const prog = await db.getFirstAsync<{ cycle_count: number }>(
    `SELECT cycle_count FROM program WHERE id = ?`,
    args.program_id
  );
  if (!prog) return;
  const isRest = args.template_id == null;
  // Detect "key present" vs absent so callers can pass null to clear.
  const hasOverride = Object.prototype.hasOwnProperty.call(
    args,
    'sub_tag_override',
  );
  await db.withTransactionAsync(async () => {
    for (let c = 0; c < prog.cycle_count; c++) {
      const existing = await db.getFirstAsync<{
        id: string;
        sub_tag: string | null;
      }>(
        `SELECT id, sub_tag FROM program_cell
          WHERE program_id = ? AND cycle_index = ? AND day_index = ?`,
        args.program_id,
        c,
        args.day_index
      );
      const new_sub_tag = isRest
        ? null
        : hasOverride
          ? (args.sub_tag_override ?? null)
          : (existing?.sub_tag ?? null);
      if (existing) {
        await db.runAsync(
          `UPDATE program_cell SET template_id = ?, sub_tag = ? WHERE id = ?`,
          args.template_id,
          new_sub_tag,
          existing.id
        );
      } else if (!isRest) {
        // Don't INSERT a sparse rest row when applying rest to an empty
        // position — the renderer treats missing rows as rest already.
        await db.runAsync(
          `INSERT INTO program_cell
             (id, program_id, cycle_index, day_index, template_id, sub_tag)
           VALUES (?, ?, ?, ?, ?, ?)`,
          args.uuid(),
          args.program_id,
          c,
          args.day_index,
          args.template_id,
          new_sub_tag
        );
      }
    }
    await db.runAsync(
      `UPDATE program SET updated_at = ? WHERE id = ?`,
      ts,
      args.program_id
    );
    // Register the override sub_tag in the persistent label dictionary so
    // it survives subsequent overwrite (round 15 fix). Only applies when
    // caller passed an explicit override (otherwise per-row sub_tags are
    // preserved per cell and individually registered via upsertCell).
    if (hasOverride && args.sub_tag_override != null) {
      await recordProgramSubTag(
        db,
        args.program_id,
        args.sub_tag_override,
        args.now,
      );
    }
  });
}

/**
 * Wave 15 (2026-05-21) — bulk apply a sub_tag to an entire row
 * (cycle_index axis). Only cells with `template_id != NULL` are touched —
 * rest cells skip per user spec Q3「避開休息」.
 */
export async function applyTagToRow(
  db: Database,
  args: {
    program_id: string;
    cycle_index: number;
    sub_tag: string | null;
    now?: () => number;
  }
): Promise<void> {
  const ts = (args.now ?? Date.now)();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE program_cell
          SET sub_tag = ?
        WHERE program_id = ?
          AND cycle_index = ?
          AND template_id IS NOT NULL`,
      args.sub_tag,
      args.program_id,
      args.cycle_index
    );
    await db.runAsync(
      `UPDATE program SET updated_at = ? WHERE id = ?`,
      ts,
      args.program_id
    );
    // Register the row-apply sub_tag in the persistent label dictionary so
    // it survives later swap to another sub_tag (round 15 fix). Even if
    // applyTagToRow updates 0 rows (row was all-rest), the label still
    // lands in the dictionary for future picker chip listing.
    await recordProgramSubTag(db, args.program_id, args.sub_tag, args.now);
  });
}

/**
 * Update a single cell's `template_id` / `sub_tag`. Used by post-wizard cell
 * edits (e.g. "I want Day 3 of cycle 2 to use template X with sub_tag '8RM'
 * instead"). No-op if the cell doesn't exist.
 */
export async function updateCell(
  db: Database,
  args: {
    cell_id: string;
    template_id: string | null;
    sub_tag: string | null;
    now?: () => number;
  }
): Promise<void> {
  const ts = (args.now ?? Date.now)();
  const row = await db.getFirstAsync<{ program_id: string }>(
    `SELECT program_id FROM program_cell WHERE id = ?`,
    args.cell_id
  );
  if (!row) return;
  await db.runAsync(
    `UPDATE program_cell SET template_id = ?, sub_tag = ? WHERE id = ?`,
    args.template_id,
    args.sub_tag,
    args.cell_id
  );
  await db.runAsync(
    `UPDATE program SET updated_at = ? WHERE id = ?`,
    ts,
    row.program_id
  );
}
