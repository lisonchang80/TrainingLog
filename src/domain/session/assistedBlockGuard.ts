/**
 * Pure helper for the ADR-0024 § 4 "assisted modal block" rule.
 *
 * Given the exercise's `load_type` and the current session's
 * `bodyweight_snapshot_kg`, decide whether the UI must intercept the
 * "+ 動作" flow with a blocking modal that asks the user to record their
 * bodyweight before the exercise is appended.
 *
 * Block-only when ALL of:
 *   1. exercise.load_type === 'assisted'  (loaded / bodyweight never block)
 *   2. session snapshot is null            (already-filled snapshot ⇒ skip)
 *
 * Pure — storage stays single-purpose and the UI is free to swap the modal
 * implementation later without dragging the rule with it.
 */

export type LoadType = 'loaded' | 'bodyweight' | 'assisted';

export function needsBwSnapshotForAppend(args: {
  load_type: LoadType;
  snapshot_kg: number | null;
}): boolean {
  if (args.load_type !== 'assisted') return false;
  return args.snapshot_kg == null;
}
