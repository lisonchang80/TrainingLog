/**
 * Per-exercise progress computation for the session set logger card
 * (ADR-0019 Q4, slice 10c Phase 3 commit 14).
 *
 * Two numbers the UI cares about:
 *   - segmented bar fill (working set count completed vs planned)
 *   - 容量 numerator / denominator (logged working volume vs total
 *     working volume in the session for this exercise)
 *
 * Warmup sets are excluded from both counts — they're prep, not real
 * working volume per ADR-0019 Q4. Dropset rows (head + followers) count
 * as their own working / dropset set_kind respectively; from the
 * progress-bar POV the head adds to working count while followers do not
 * (the head represents one "set" that happens to chain followers).
 *
 * Wait — the spec wording on this is ambiguous: a "set" for chip purposes
 * could be (a) the dropset cluster as a unit, or (b) each row independently.
 * Pragmatic choice: count anything with set_kind == 'working' and
 * is_logged == 1 toward the numerator; dropsets are excluded from working
 * count entirely (they're a separate intensity technique, not a working
 * set). Adjust when ADR-0019 Q4 sub-question on dropsets is resolved.
 */

import type { SetKind } from '../set/setLabels';

export interface ExerciseProgressInput {
  set_kind: SetKind;
  is_logged: number; // 0/1
  weight_kg: number | null;
  reps: number | null;
}

export interface ExerciseProgress {
  /** Count of is_logged=1 AND set_kind='working' rows. */
  workingDone: number;
  /** Total working sets planned (from session_exercise.planned_sets). */
  plannedTotal: number;
  /** Volume (Σ weight×reps) for completed working sets. */
  volumeDone: number;
  /** Volume (Σ weight×reps) for ALL non-warmup recorded sets (working +
   *  dropset, regardless of is_logged). Used as the chip denominator
   *  per ADR-0019 Q4 formula. */
  volumeTotal: number;
}

export function computeExerciseProgress(
  sets: ExerciseProgressInput[],
  plannedTotal: number,
): ExerciseProgress {
  let workingDone = 0;
  let volumeDone = 0;
  let volumeTotal = 0;
  for (const s of sets) {
    const w = s.weight_kg ?? 0;
    const r = s.reps ?? 0;
    const vol = w * r;
    if (s.set_kind !== 'warmup') {
      volumeTotal += vol;
    }
    if (s.is_logged === 1 && s.set_kind === 'working') {
      workingDone += 1;
      volumeDone += vol;
    }
  }
  return { workingDone, plannedTotal, volumeDone, volumeTotal };
}
