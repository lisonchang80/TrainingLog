/**
 * v017 seed data — the reserved 「無」 program entity.
 *
 * Per ADR-0019 § (N1) + 留尾 Q1+Q1b 拍板 (2026-05-16 grill):
 *
 *   - All session/template that aren't under a real training program point
 *     at this row instead of NULL — eliminating "NULL = 無 program"
 *     special-case branches across every query that joins program.
 *
 *   - The id is the **nil UUID** (`00000000-0000-0000-0000-000000000000`).
 *     UUID v4's variant + version bits guarantee real generated ids never
 *     collide with this value, so it's safe as a reserved sentinel.
 *
 *   - The name is the short form 「無」 (not 「無 Program」) — DB column
 *     stores what the UI displays, no separate label mapping.
 *
 *   - cycle_length=3 / cycle_count=1 are the lowest values that satisfy
 *     the v005 CHECK constraints (cycle_length ∈ [3,14], cycle_count ≥ 1).
 *     start_date is epoch sentinel '1970-01-01'.
 */

export const RESERVED_NONE_PROGRAM_ID = '00000000-0000-0000-0000-000000000000';

export const PROGRAM_NONE_SEED = {
  id: RESERVED_NONE_PROGRAM_ID,
  name: '無',
  main_tag: null as string | null,
  cycle_length: 3,
  cycle_count: 1,
  start_date: '1970-01-01',
  is_active: 0,
} as const;
