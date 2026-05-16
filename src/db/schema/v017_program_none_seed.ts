import type { Database } from '../types';
import { PROGRAM_NONE_SEED } from '../seed/v017ProgramNone';

/**
 * v017 — Seed the reserved 「無」 program entity (slice 10a foundation per
 * ADR-0019 § (N1) + 留尾 Q1+Q1b 拍板).
 *
 * Inserts one row into `program` with the nil UUID id and name 「無」.
 * Eliminates "NULL = 無 program" special-case branches across every query
 * that joins program — instead every template/session points at a real
 * program row, whether real-named or this sentinel.
 *
 * Idempotent via `INSERT OR IGNORE` keyed on PRIMARY KEY (id) — re-runs on
 * an already-seeded DB silently skip.
 *
 * See `src/db/seed/v017ProgramNone.ts` for the seed data definition + the
 * `RESERVED_NONE_PROGRAM_ID` constant exported for downstream consumers.
 */
export async function v017_program_none_seed(db: Database): Promise<void> {
  const now = Date.now();
  await db.runAsync(
    `INSERT OR IGNORE INTO program
       (id, name, main_tag, cycle_length, cycle_count, start_date, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    PROGRAM_NONE_SEED.id,
    PROGRAM_NONE_SEED.name,
    PROGRAM_NONE_SEED.main_tag,
    PROGRAM_NONE_SEED.cycle_length,
    PROGRAM_NONE_SEED.cycle_count,
    PROGRAM_NONE_SEED.start_date,
    PROGRAM_NONE_SEED.is_active,
    now,
    now,
  );
}
