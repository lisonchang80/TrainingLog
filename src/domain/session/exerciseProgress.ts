/**
 * Per-exercise progress computation for the session set logger card
 * (ADR-0019 Q4, slice 10c Phase 3 commit 14).
 *
 * Two numbers the UI cares about:
 *   - segmented bar fill (completed "set units" vs total "set units")
 *   - 容量 numerator / denominator (logged volume vs total non-warmup volume)
 *
 * What counts as ONE "set unit" (2026-05-20 wave 12 dropset 納入):
 *   - Each `working` set                                       → 1 unit
 *   - Each dropset chain HEAD (`set_kind='dropset'` AND
 *     `parent_set_id IS NULL`)                                 → 1 unit
 *   - Warmup sets                                              → 0 (excluded)
 *   - Dropset chain FOLLOWERS (`parent_set_id != null`)        → 0 (rolled into head)
 *
 * Rationale: the UI collapses a dropset chain into ONE visible row with the
 * head's ✓ slot — followers don't have their own toggle (per #61). Counting
 * head-only keeps "segmented bar `done/total`" aligned with what the user
 * sees.
 *
 * What counts as "done":
 *   - working: `is_logged === 1` on that row
 *   - dropset head: `is_logged === 1` on the head (toggle marks head only,
 *     followers stay is_logged=0 in DB but inherit via chain UI semantics)
 *
 * Volume chip (`volumeDone` / `volumeTotal`):
 *   - `volumeTotal`: Σ weight×reps over every non-warmup row (working +
 *     dropset head + dropset followers — all the "real volume" the user did)
 *   - `volumeDone`:  Σ weight×reps over every non-warmup row whose EFFECTIVE
 *     is_logged is 1. Dropset followers inherit is_logged from their chain
 *     head (since the UI toggle only writes the head), so a logged head's
 *     follower volume contributes to `volumeDone`.
 */

import type { SetKind } from '../set/setLabels';

export interface ExerciseProgressInput {
  id: string;
  set_kind: SetKind;
  is_logged: number; // 0/1
  weight_kg: number | null;
  reps: number | null;
  /** NULL for working / warmup / dropset chain head; points at head id for
   *  dropset followers. Needed for chain-aware effective is_logged + to
   *  exclude followers from the set-unit count. */
  parent_set_id: string | null;
}

export interface ExerciseProgress {
  /** Count of completed "set units" — working logged + dropset HEAD logged. */
  setsDone: number;
  /** Count of total "set units" — working rows + dropset HEAD rows. */
  setsTotal: number;
  /** Volume (Σ weight×reps) for sets whose effective is_logged === 1 AND
   *  non-warmup. Dropset followers inherit head's is_logged. */
  volumeDone: number;
  /** Volume (Σ weight×reps) for ALL non-warmup recorded sets, regardless of
   *  is_logged. Used as the chip denominator per ADR-0019 Q4 formula. */
  volumeTotal: number;
}

export function computeExerciseProgress(
  sets: ExerciseProgressInput[],
): ExerciseProgress {
  // Build id → set map so dropset followers can look up their head's
  // is_logged (effective is_logged inheritance for the volume chip).
  const byId = new Map(sets.map((s) => [s.id, s]));

  let setsDone = 0;
  let setsTotal = 0;
  let volumeDone = 0;
  let volumeTotal = 0;

  for (const s of sets) {
    const w = s.weight_kg ?? 0;
    const r = s.reps ?? 0;
    const vol = w * r;

    // Chain-aware effective is_logged. Followers (set_kind='dropset' AND
    // parent_set_id != null) inherit from their head; everyone else uses
    // their own value.
    let effLogged = s.is_logged;
    if (s.set_kind === 'dropset' && s.parent_set_id != null) {
      const head = byId.get(s.parent_set_id);
      if (head) effLogged = head.is_logged;
    }

    // Volume: every non-warmup row contributes to total; effectively-logged
    // ones contribute to done.
    if (s.set_kind !== 'warmup') {
      volumeTotal += vol;
      if (effLogged === 1) volumeDone += vol;
    }

    // Set-unit counting. One unit = a working row OR a dropset chain head.
    // Followers don't count (they're part of the head's unit).
    const isUnit =
      s.set_kind === 'working' ||
      (s.set_kind === 'dropset' && s.parent_set_id == null);
    if (isUnit) {
      setsTotal += 1;
      // For working `effLogged` === `s.is_logged`; for dropset head same
      // (head's effLogged is its own is_logged). Single branch suffices.
      if (effLogged === 1) setsDone += 1;
    }
  }

  return { setsDone, setsTotal, volumeDone, volumeTotal };
}
