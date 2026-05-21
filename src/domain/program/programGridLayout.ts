/**
 * Program calendar grid — pure date / layout helpers (slice 10c wave 15,
 * 2026-05-21). Used by the programs tab grid view.
 *
 * ADR-0004: grid is `cycle_count` rows × `cycle_length` cols.
 * Cell at (cycle_index c, day_index d) maps to real date
 *   `start_date + c * cycle_length + d` days.
 *
 * No DB / React deps — everything works on plain string IDs + numbers
 * so tests don't need a sqlite fixture.
 */
import type { IsoDate, ProgramCell } from './types';

/**
 * Real date for cell at (cycle_index, day_index) given the program's
 * start_date and cycle_length.
 *
 * `start_date` MUST be a valid ISO `YYYY-MM-DD` (no time, no timezone).
 * The output preserves the same format. Computation uses UTC math so DST
 * boundaries don't shift the result by ±1 day — only the date label
 * matters, not wall-clock hours.
 */
export function cellDate(
  start_date: IsoDate,
  cycle_index: number,
  day_index: number,
  cycle_length: number,
): IsoDate {
  // Parse YYYY-MM-DD as UTC midnight. Date.parse('2026-05-21') is
  // implementation-defined in some engines (treated as local in older RN
  // JSC builds); explicit UTC construction is safe.
  const [yStr, mStr, dStr] = start_date.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  const baseUtc = Date.UTC(y, m - 1, d);
  const offsetDays = cycle_index * cycle_length + day_index;
  const cellUtc = baseUtc + offsetDays * 24 * 60 * 60 * 1000;
  const dt = new Date(cellUtc);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** Compact "M/D" label for a cell date — used inside grid cells. */
export function formatCellDateLabel(iso: IsoDate): string {
  const [, mStr, dStr] = iso.split('-');
  return `${Number(mStr)}/${Number(dStr)}`;
}

/**
 * Build a lookup table keyed by `${cycle_index},${day_index}` so the grid
 * renderer doesn't do an O(rows × cols) `find` on every cell.
 */
export function buildCellMap(
  cells: readonly ProgramCell[],
): Map<string, ProgramCell> {
  const map = new Map<string, ProgramCell>();
  for (const c of cells) {
    map.set(`${c.cycle_index},${c.day_index}`, c);
  }
  return map;
}

/**
 * For the "tap 休息 → fill from neighbour" UX (Q5 (a) — same row nearest
 * non-rest cell).
 *
 * Search order:
 *   1. Same row (cycle_index), walk outward from day_index — d-1, d+1,
 *      d-2, d+2, ... until a cell with template_id != null is found.
 *   2. If none found in the row, return null (caller should fall back
 *      to opening a plain template picker with no preset).
 *
 * A cell is "non-rest" iff `template_id != null`. `sub_tag` can be null
 * (filled cell with no intensity tag) — still counts as non-rest.
 */
export function findNearestNonRestInRow(
  cells: readonly ProgramCell[],
  cycle_index: number,
  day_index: number,
  cycle_length: number,
): ProgramCell | null {
  const byDay = new Map<number, ProgramCell>();
  for (const c of cells) {
    if (c.cycle_index === cycle_index && c.template_id != null) {
      byDay.set(c.day_index, c);
    }
  }
  if (byDay.size === 0) return null;
  // Walk outward: distance 1, 2, ..., cycle_length-1
  for (let dist = 1; dist < cycle_length; dist++) {
    const left = day_index - dist;
    const right = day_index + dist;
    if (left >= 0 && byDay.has(left)) return byDay.get(left)!;
    if (right < cycle_length && byDay.has(right)) return byDay.get(right)!;
  }
  return null;
}

/**
 * Distinct sub_tags used by cells of this program (non-null only).
 * Sorted by frequency desc, then alpha — for the row-apply picker's
 * "已用過的強度" list. Caller adds a 「+ 新增強度」inline option.
 */
export function distinctSubTagsInProgram(
  cells: readonly ProgramCell[],
): string[] {
  const counts = new Map<string, number>();
  for (const c of cells) {
    if (c.sub_tag != null && c.sub_tag.length > 0) {
      counts.set(c.sub_tag, (counts.get(c.sub_tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })
    .map(([tag]) => tag);
}
