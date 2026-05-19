/**
 * countUniqueExercises — overnight #47 第 5 點.
 *
 * The "動作數" tile (both session detail page and Today in-session stats
 * panel) previously rendered `session_exercise.length` which counted each
 * session_exercise row separately. That's misleading for clusters: a
 * superset (A+B) creates two session_exercise rows but a user thinks of
 * it as a single piece of programming; even worse, two cards sharing the
 * same `exercise_id` (e.g. solo Bench Press + cluster member Bench Press)
 * inflate the count further.
 *
 * New spec: count distinct `exercise_id` across the entire session — one
 * physical exercise = one unit, regardless of how many cards / clusters
 * reference it.
 *
 * Example (from the user's 2026-05-19 screenshot):
 *   - cluster 1: Cable Crossover + Chest Dip
 *   - cluster 2: Bench Press   + Chest Dip
 *   - solo:     Bench Press
 *   → 5 session_exercise rows, but 3 unique exercises {CC, CD, BP}.
 */

export interface CountUniqueExercisesInput {
  exercise_id: string;
}

export function countUniqueExercises(
  sessionExercises: ReadonlyArray<CountUniqueExercisesInput>,
): number {
  const seen = new Set<string>();
  for (const se of sessionExercises) {
    seen.add(se.exercise_id);
  }
  return seen.size;
}
