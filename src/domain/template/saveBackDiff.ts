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
 * Aggregation heuristic for the "actual" side (per exercise):
 *   - Group all non-skipped sets by their (reps, weight_kg) tuple.
 *   - Pick the *modal* group (largest count). This represents the user's
 *     "work set" pattern; warmups, deloads, and one-off back-off sets are
 *     correctly demoted instead of distorting the proposal.
 *   - Tiebreak: prefer the heavier weight; then earliest appearance.
 *   - `setCount` = size of the modal group (NOT total sets), so the proposed
 *     "X × R @ W kg" is internally consistent — exactly the way a strength
 *     trainer reads a plan.
 *
 * Example: user logs 4 sets at (8 reps, 70 kg) plus 1 set at (10 reps, 20 kg).
 *   - Old "last set" heuristic produced "5 × 10 @ 20 kg" — wrong.
 *   - Modal-group heuristic produces "4 × 8 @ 70 kg" — what the user actually
 *     wanted to save back.
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
  /**
   * Number of sets in the modal (reps, weight) group — see module docstring.
   * Smaller than the user's total sets when warmups / deloads / outliers
   * exist. Zero is filtered out by `computeSaveBackDiff`.
   */
  setCount: number;
  /** Modal group's reps. null when no sets logged. */
  reps: number | null;
  /** Modal group's weight (kg). null when no sets logged. */
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
 * Reduce raw set_log rows into per-exercise summaries using the modal-group
 * heuristic described in the module docstring.
 *
 * Skipped sets are dropped before aggregation. Output order preserves the
 * first-appearance order of each exercise (sorted by `ordering` ascending
 * first), so the diff entries downstream stay in a predictable order.
 */
export function aggregateActuals(sets: RawSetRow[]): SessionActualRow[] {
  const sorted = [...sets]
    .filter((s) => !s.is_skipped)
    .sort((a, b) => a.ordering - b.ordering);

  // Bucket sets per exercise (preserving first-appearance order).
  const byExercise = new Map<string, RawSetRow[]>();
  for (const s of sorted) {
    const arr = byExercise.get(s.exercise_id);
    if (arr) arr.push(s);
    else byExercise.set(s.exercise_id, [s]);
  }

  const out: SessionActualRow[] = [];
  for (const [exercise_id, exSets] of byExercise) {
    type Group = {
      reps: number | null;
      weight: number | null;
      count: number;
      firstOrdering: number;
    };
    const groups = new Map<string, Group>();
    for (const s of exSets) {
      const key = `${s.reps}|${s.weight_kg}`;
      const g = groups.get(key);
      if (g) g.count += 1;
      else
        groups.set(key, {
          reps: s.reps,
          weight: s.weight_kg,
          count: 1,
          firstOrdering: s.ordering,
        });
    }

    let best: Group | null = null;
    for (const g of groups.values()) {
      if (!best) {
        best = g;
        continue;
      }
      if (g.count > best.count) {
        best = g;
        continue;
      }
      if (g.count === best.count) {
        const bw = best.weight ?? -Infinity;
        const gw = g.weight ?? -Infinity;
        if (gw > bw) best = g;
        else if (gw === bw && g.firstOrdering < best.firstOrdering) best = g;
      }
    }

    out.push({
      exercise_id,
      setCount: best?.count ?? 0,
      reps: best?.reps ?? null,
      weight_kg: best?.weight ?? null,
    });
  }
  return out;
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
