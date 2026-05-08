/**
 * Module #1 — Program Manager (pure logic, no DB).
 *
 * Responsibilities:
 *   1. **Calendar arithmetic** — translate a real date into a `(cycle_index,
 *      day_index)` pair against a Program (and the inverse), so Today can ask
 *      "given the active program, which cell is today?".
 *   2. **Validation** — enforce ADR-0004's `cycle_length ∈ [3, 14]`, `cycle_count ≥
 *      1`, and ISO date format. Repository CHECK constraints catch bad data
 *      that escapes the UI; this catches it earlier with a friendlier message.
 *   3. **Wizard fan-out** — given a per-day plan (Day 0..N-1 → template +
 *      sub_tag) and an optional per-cycle sub_tag override, produce the full
 *      list of cells covering all `cycle_count × cycle_length` slots.
 *
 * Pure functions only. Tested in `tests/domain/programManager.test.ts`.
 */

import type {
  IsoDate,
  ProgramCell,
  ProgramCore,
  ProgramWithCells,
} from './types';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Normalize an ISO date to UTC midnight ms. Throws on bad input. */
export function isoDateToUtcMs(d: IsoDate): number {
  if (!ISO_DATE_RE.test(d)) {
    throw new Error(`invalid ISO date: ${d}`);
  }
  // `Date.UTC(yyyy, mm-1, dd)` — months are 0-based.
  const [y, m, day] = d.split('-').map(Number);
  return Date.UTC(y, m - 1, day);
}

/** Inverse of `isoDateToUtcMs` — emits `yyyy-mm-dd`. */
export function utcMsToIsoDate(ms: number): IsoDate {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Translate a real date to its `(cycle_index, day_index)` against the program,
 * or null when the date falls before `start_date` / outside the program's span.
 *
 * Edge cases:
 *   - `date === start_date` → `(0, 0)` (Day 0 = program start)
 *   - 1 day before start → null
 *   - `cycle_index >= cycle_count` → null (program already ended)
 */
export function dateToCycleDay(args: {
  start_date: IsoDate;
  cycle_length: number;
  cycle_count: number;
  date: IsoDate;
}): { cycle_index: number; day_index: number } | null {
  const startMs = isoDateToUtcMs(args.start_date);
  const dateMs = isoDateToUtcMs(args.date);
  const dayDiff = Math.floor((dateMs - startMs) / MS_PER_DAY);
  if (dayDiff < 0) return null;
  const cycle_index = Math.floor(dayDiff / args.cycle_length);
  if (cycle_index >= args.cycle_count) return null;
  const day_index = dayDiff % args.cycle_length;
  return { cycle_index, day_index };
}

/**
 * Inverse of `dateToCycleDay`: which real date corresponds to a given cell?
 * No null path — caller should pre-validate the indices are in range.
 */
export function cycleDayToDate(args: {
  start_date: IsoDate;
  cycle_length: number;
  cycle_index: number;
  day_index: number;
}): IsoDate {
  const startMs = isoDateToUtcMs(args.start_date);
  const dayDiff = args.cycle_index * args.cycle_length + args.day_index;
  return utcMsToIsoDate(startMs + dayDiff * MS_PER_DAY);
}

/**
 * Given a program + its cells, find which cell (if any) corresponds to a real
 * date. Convenience that composes `dateToCycleDay` + cell lookup.
 */
export function cellForDate(
  args: { program: ProgramCore; cells: ProgramCell[]; date: IsoDate }
): ProgramCell | null {
  const cd = dateToCycleDay({
    start_date: args.program.start_date,
    cycle_length: args.program.cycle_length,
    cycle_count: args.program.cycle_count,
    date: args.date,
  });
  if (!cd) return null;
  return (
    args.cells.find(
      (c) =>
        c.cycle_index === cd.cycle_index && c.day_index === cd.day_index
    ) ?? null
  );
}

/**
 * Validate a Program before persistence. Returns null on success or a
 * human-readable error string. SQLite CHECKs catch the same things at the
 * boundary, but we want a friendlier message for the wizard.
 */
export function validateProgram(p: Omit<ProgramCore, 'is_active'>): string | null {
  if (!p.id) return 'Program id is required';
  if (!p.name || !p.name.trim()) return 'Program name cannot be empty';
  if (
    !Number.isInteger(p.cycle_length) ||
    p.cycle_length < 3 ||
    p.cycle_length > 14
  ) {
    return 'cycle_length must be an integer between 3 and 14';
  }
  if (!Number.isInteger(p.cycle_count) || p.cycle_count < 1) {
    return 'cycle_count must be a positive integer';
  }
  if (!ISO_DATE_RE.test(p.start_date)) {
    return 'start_date must be ISO yyyy-mm-dd';
  }
  return null;
}

/**
 * Per-day plan entry used by the wizard. The wizard collects these for cycle 0
 * (Day 0 .. cycle_length-1) and then fans them out across all cycles. A null
 * `template_id` represents a rest day.
 */
export interface DayPlan {
  day_index: number;
  template_id: string | null;
  /** Default sub_tag for this day; per-cycle override below takes priority. */
  sub_tag: string | null;
}

/**
 * Per-cycle sub_tag override: `cycle_index` × `day_index` → custom sub_tag.
 * Common case: linear progression where the same template's sub_tag changes
 * each cycle (e.g. cycle 0 = "12RM", cycle 1 = "10RM", cycle 2 = "8RM").
 * Empty array means "use each DayPlan's default sub_tag for every cycle".
 */
export interface CycleSubTagOverride {
  cycle_index: number;
  day_index: number;
  sub_tag: string | null;
}

/**
 * Fan out the wizard draft into the full cell grid. Caller injects `uuid` for
 * cell ids (Hermes lacks `crypto.randomUUID`).
 *
 * Output: exactly `cycle_count × cycle_length` cells, ordered by
 * `(cycle_index, day_index)` ascending. Cells with `template_id === null` are
 * still emitted (representing rest days or unfilled slots) so consumers can
 * persist a complete grid and round-trip without "missing cell" surprises.
 */
export function expandWizardDraft(args: {
  program: ProgramCore;
  dayPlans: DayPlan[];
  overrides?: CycleSubTagOverride[];
  uuid: () => string;
}): ProgramCell[] {
  const overrideMap = new Map<string, string | null>();
  for (const o of args.overrides ?? []) {
    overrideMap.set(`${o.cycle_index}:${o.day_index}`, o.sub_tag);
  }
  const dayPlanMap = new Map<number, DayPlan>();
  for (const dp of args.dayPlans) dayPlanMap.set(dp.day_index, dp);

  const cells: ProgramCell[] = [];
  for (let c = 0; c < args.program.cycle_count; c++) {
    for (let d = 0; d < args.program.cycle_length; d++) {
      const plan = dayPlanMap.get(d);
      const overrideKey = `${c}:${d}`;
      const sub_tag = overrideMap.has(overrideKey)
        ? overrideMap.get(overrideKey) ?? null
        : plan?.sub_tag ?? null;
      cells.push({
        id: args.uuid(),
        program_id: args.program.id,
        cycle_index: c,
        day_index: d,
        template_id: plan?.template_id ?? null,
        sub_tag: plan?.template_id ? sub_tag : null,
      });
    }
  }
  return cells;
}

/**
 * "Today's cell" convenience for the Today tab: given the active program +
 * its cells + today's ISO date, return the cell or null (off-program, rest
 * day, or unfilled). Pure passthrough to `cellForDate` for symmetry with
 * how the UI consumes it.
 */
export function todayCell(args: {
  active: ProgramWithCells | null;
  today: IsoDate;
}): ProgramCell | null {
  if (!args.active) return null;
  return cellForDate({
    program: args.active.program,
    cells: args.active.cells,
    date: args.today,
  });
}
