/**
 * Module #5 — Save-back differential (pure logic, no DB).
 *
 * At Session end we compare what the user *planned* (frozen `session_exercise`
 * snapshot taken at Session start) against what they *actually did* (set_log
 * aggregates) and surface the differences as `SaveBackChange` entries the UI
 * can review item-by-item.
 *
 * Categories of change (acceptance criterion #1):
 *   - 'modify' — same exercise present in plan and actual, but sets / reps /
 *                weight differ → propose updating the Template defaults.
 *   - 'remove' — exercise was planned but no actual sets logged → user
 *                skipped it. ONLY emitted for general-zone rows (is_evergreen
 *                = 0). Evergreen entries can never be removed via Save-back
 *                (criterion #4).
 *   - 'add'    — user logged sets for an exercise that was not in the plan
 *                → propose appending it to the Template (always to the
 *                general zone).
 *
 * Aggregation heuristic for the "actual" side:
 *   - sets   = total count of non-skipped sets logged for that exercise
 *   - reps   = the *last* set's reps  (deterministic, traceable; matches the
 *              user's mental model "this is what I went with at the end").
 *   - weight = the *last* set's weight (same reasoning).
 *
 * Pure functions only — no side effects, no DB, no React. The caller is
 * responsible for building the `actual` shape from raw set rows; see the
 * `aggregateActuals` helper here for the canonical implementation.
 */

/**
 * One row in the frozen plan (post-snapshot). Subset of `SessionExerciseRow`
 * used by the diff so the caller can pass either `session_exercise` rows
 * directly or whatever superset they prefer.
 */
export interface SessionPlanRow {
  exercise_id: string;
  /** ordering inside the plan (1..N). Used to keep diff entries stable. */
  ordering: number;
  planned_sets: number;
  planned_reps: number | null;
  planned_weight_kg: number | null;
  is_evergreen: 0 | 1;
}

/** Aggregated actuals for one exercise inside a Session. */
export interface SessionActualRow {
  exercise_id: string;
  setCount: number;
  /** Representative reps — see module docstring. null when no sets logged. */
  reps: number | null;
  /** Representative weight (kg) — see module docstring. null when no sets logged. */
  weight_kg: number | null;
}

/** One ordered raw set row used by `aggregateActuals`. */
export interface RawSetRow {
  exercise_id: string;
  weight_kg: number | null;
  reps: number | null;
  is_skipped: number;
  ordering: number;
}

/**
 * Reduce raw set_log rows into per-exercise summaries: count + last set's
 * weight/reps. Skipped sets are dropped before aggregation.
 *
 * Stable order: the result preserves the first-appearance order of each
 * exercise in `sets` (sorted ascending by `ordering` first).
 */
export function aggregateActuals(sets: RawSetRow[]): SessionActualRow[] {
  const sorted = [...sets]
    .filter((s) => !s.is_skipped)
    .sort((a, b) => a.ordering - b.ordering);
  const map = new Map<string, SessionActualRow>();
  for (const s of sorted) {
    const existing = map.get(s.exercise_id);
    if (existing) {
      existing.setCount += 1;
      existing.reps = s.reps;
      existing.weight_kg = s.weight_kg;
    } else {
      map.set(s.exercise_id, {
        exercise_id: s.exercise_id,
        setCount: 1,
        reps: s.reps,
        weight_kg: s.weight_kg,
      });
    }
  }
  return Array.from(map.values());
}

export type SaveBackChangeType = 'modify' | 'add' | 'remove';

export interface SaveBackChange {
  type: SaveBackChangeType;
  exercise_id: string;
  /** Carried so the UI can sort modifies/removes back into plan order. */
  ordering: number;
  /** Carried for UI labelling — "常設" badges sit on the row for modifies. */
  is_evergreen: 0 | 1;
  /** Present for 'modify' and 'remove'. */
  planned?: {
    sets: number;
    reps: number | null;
    weight_kg: number | null;
  };
  /** Present for 'modify' and 'add'. */
  actual?: {
    sets: number;
    reps: number | null;
    weight_kg: number | null;
  };
}

function plannedEqualsActual(
  plan: SessionPlanRow,
  actual: SessionActualRow
): boolean {
  return (
    plan.planned_sets === actual.setCount &&
    plan.planned_reps === actual.reps &&
    plan.planned_weight_kg === actual.weight_kg
  );
}

/**
 * Compute the per-exercise diff between plan and actual.
 *
 * Order in the result:
 *   1. 'modify' and 'remove' entries in plan-ordering order
 *   2. 'add' entries in first-appearance order from `actual`
 *
 * `remove` is suppressed for evergreen-zone rows so the UI never needs to
 * disable / hide them — we just don't suggest the action in the first place.
 */
export function computeSaveBackDiff(args: {
  plan: SessionPlanRow[];
  actual: SessionActualRow[];
}): SaveBackChange[] {
  const planned = [...args.plan].sort((a, b) => a.ordering - b.ordering);
  const actualByEx = new Map(args.actual.map((a) => [a.exercise_id, a]));
  const seen = new Set<string>();
  const out: SaveBackChange[] = [];

  for (const p of planned) {
    seen.add(p.exercise_id);
    const a = actualByEx.get(p.exercise_id);
    if (!a || a.setCount === 0) {
      // User skipped this exercise. Only propose remove for general zone.
      if (p.is_evergreen === 1) continue;
      out.push({
        type: 'remove',
        exercise_id: p.exercise_id,
        ordering: p.ordering,
        is_evergreen: p.is_evergreen,
        planned: {
          sets: p.planned_sets,
          reps: p.planned_reps,
          weight_kg: p.planned_weight_kg,
        },
      });
      continue;
    }
    if (!plannedEqualsActual(p, a)) {
      out.push({
        type: 'modify',
        exercise_id: p.exercise_id,
        ordering: p.ordering,
        is_evergreen: p.is_evergreen,
        planned: {
          sets: p.planned_sets,
          reps: p.planned_reps,
          weight_kg: p.planned_weight_kg,
        },
        actual: {
          sets: a.setCount,
          reps: a.reps,
          weight_kg: a.weight_kg,
        },
      });
    }
  }

  // Adds: actual entries with no matching plan row.
  let nextOrdering = planned.length + 1;
  for (const a of args.actual) {
    if (seen.has(a.exercise_id)) continue;
    if (a.setCount === 0) continue;
    out.push({
      type: 'add',
      exercise_id: a.exercise_id,
      ordering: nextOrdering++,
      is_evergreen: 0, // Adds always land in the general zone.
      actual: {
        sets: a.setCount,
        reps: a.reps,
        weight_kg: a.weight_kg,
      },
    });
  }

  return out;
}
