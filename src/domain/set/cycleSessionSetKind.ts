/**
 * Pure tap-label cycle for SESSION sets (ADR-0019 Q7, slice 10c Phase 2
 * commit 7a). Session counterpart of template-side
 * `templateOps.cycleSetKind`: same transitions, but emits a list of
 * operations (update / insert / delete) instead of returning a new array
 * so callers can apply them to the DB row-by-row.
 *
 * Transitions (mirror template-side):
 *   - working → warmup          : update set_kind only.
 *   - warmup  → dropset head    : update kind + auto-insert 1 follower
 *                                  with the same reps/weight.
 *   - dropset head → working    : update kind + cascade-delete followers.
 *   - dropset follower → no-op  : returns empty op list.
 *
 * Why ops not array: session sets live in DB (one INSERT/DELETE/UPDATE
 * per row) — diffing two arrays to figure out which rows to touch would
 * be busywork. The caller maps each op to a single repo call.
 *
 * The new follower row's `ordering` is NOT computed here — the caller
 * assigns max(ordering)+1 from its DB view. Same for exercise_id /
 * session_id / created_at: those are caller context, not domain state.
 */

import type { SetKind } from './setLabels';

export interface CycleSessionSetInput {
  id: string;
  set_kind: SetKind;
  parent_set_id: string | null;
  reps: number | null;
  weight_kg: number | null;
}

export type CycleSessionSetOp =
  /** Patch an existing set row (set_kind and/or parent_set_id). */
  | {
      type: 'update';
      set_id: string;
      patch: { set_kind?: SetKind; parent_set_id?: string | null };
    }
  /** Insert one new dropset follower right after the head. Caller assigns
   *  session_id / exercise_id / ordering / created_at. */
  | {
      type: 'insertFollower';
      new_set_id: string;
      parent_set_id: string;
      reps: number | null;
      weight_kg: number | null;
    }
  /** Delete a row (used to cascade-strip dropset followers). */
  | { type: 'delete'; set_id: string };

/**
 * Compute the DB ops needed to apply a tap-label cycle on `set_id` within
 * `sets` (all sets for one exercise within one session). `new_set_id` is
 * injected so the caller can use a real `expo-crypto` UUID in prod and a
 * deterministic stub in tests.
 */
export function cycleSessionSetKind(
  sets: CycleSessionSetInput[],
  set_id: string,
  new_set_id: string,
): CycleSessionSetOp[] {
  const target = sets.find((s) => s.id === set_id);
  if (!target) return [];

  // Follower row — tap is a no-op (matches template-side guard).
  if (target.set_kind === 'dropset' && target.parent_set_id !== null) {
    return [];
  }

  if (target.set_kind === 'working') {
    return [{ type: 'update', set_id, patch: { set_kind: 'warmup' } }];
  }

  if (target.set_kind === 'warmup') {
    return [
      {
        type: 'update',
        set_id,
        patch: { set_kind: 'dropset', parent_set_id: null },
      },
      {
        type: 'insertFollower',
        new_set_id,
        parent_set_id: set_id,
        reps: target.reps,
        weight_kg: target.weight_kg,
      },
    ];
  }

  // target.set_kind === 'dropset' && parent_set_id === null  (i.e., head)
  const followers = sets.filter((s) => s.parent_set_id === set_id);
  return [
    {
      type: 'update',
      set_id,
      patch: { set_kind: 'working', parent_set_id: null },
    },
    ...followers.map(
      (f): CycleSessionSetOp => ({ type: 'delete', set_id: f.id }),
    ),
  ];
}
