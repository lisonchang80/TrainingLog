/**
 * Domain types for Program (Module #1) — schema-aligned with v005.
 *
 * Per ADR-0003: Template identity is the triple `(name, program_id, sub_tag)`,
 * so a Program "owns" a fan-out of cells, each potentially pointing at a
 * distinct Template even when the templates share a name.
 *
 * Per ADR-0004: the calendar grid is `cycle_count` rows × `cycle_length` cols,
 * indexed from 0. Real dates are derived: `start_date + cycle_index *
 * cycle_length + day_index` days.
 */

/** ISO `yyyy-mm-dd` (no time, no timezone). */
export type IsoDate = string;

export interface ProgramCore {
  id: string;
  name: string;
  /** Free-form 主標籤 (e.g. "增肌-Q1"); null when the user picks 「無」. */
  main_tag: string | null;
  /** Cycle length in days, 3-14 inclusive (ADR-0004). */
  cycle_length: number;
  /** Number of cycles in the program, ≥ 1. */
  cycle_count: number;
  start_date: IsoDate;
  /** 0 = inactive, 1 = active. At most one active program at a time. */
  is_active: 0 | 1;
}

export interface ProgramCell {
  id: string;
  program_id: string;
  /** 0-based cycle index, 0..cycle_count-1. */
  cycle_index: number;
  /** 0-based day index within a cycle, 0..cycle_length-1. */
  day_index: number;
  /** Template assigned to this cell; null = rest day or unfilled. */
  template_id: string | null;
  /** Per-cell 副標籤 free-form text; null when the cell has no template. */
  sub_tag: string | null;
}

/** A Program with its fan-out cells in one bag, used by Wizard preview etc. */
export interface ProgramWithCells {
  program: ProgramCore;
  cells: ProgramCell[];
}
