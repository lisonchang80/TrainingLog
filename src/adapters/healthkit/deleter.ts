/**
 * HealthKit workout deleter — grill 2026-06-05 Q3 (HK #4).
 *
 * Editing a completed session's start/end time used to leave the already-written
 * HKWorkout (and its kcal) frozen at the OLD interval — Apple Health silently
 * diverged from the app. HKWorkout samples are immutable in HealthKit, so a
 * "time edit" is really delete-then-rewrite: this module deletes the existing
 * TrainingLog HKWorkout so the re-sync (`resyncSessionWithHealthKit`) can write
 * a fresh one for the new window without leaving a duplicate.
 *
 * We reverse-look-up the workout by the `HKExternalUUID` metadata the writer
 * stamps with `session.id` (see writer.ts) — the canonical TrainingLog → HK
 * link. Scoped to that exact session, so it can never touch another workout.
 *
 * Like the writer this NEVER throws — a delete failure is best-effort (the
 * worst case is a stale/duplicate Fitness entry, not a crash mid-edit) and only
 * logs. Returns the number of HKWorkout objects deleted (0 on any failure).
 *
 * Device-gated: the real HealthKit delete can only be exercised on-device;
 * jest covers the orchestration (`resyncSessionWithHealthKit`) with this module
 * injected as a mock.
 */

import { WorkoutTypeIdentifier } from '@kingstinct/react-native-healthkit';

/**
 * Lazily imported so jest can mock the native module per-test (mirrors
 * writer.ts / reader.ts). `deleteObjects(typeId, filter)` returns the count of
 * deleted objects; `ComparisonPredicateOperator.equalTo` keys the metadata
 * predicate.
 */
function getNativeDeleter(): {
  deleteObjects: (
    objectTypeIdentifier: string,
    filter: {
      metadata?: {
        withMetadataKey: string;
        operatorType?: number;
        value?: string;
      };
    }
  ) => Promise<number>;
  equalTo: number;
} {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('@kingstinct/react-native-healthkit');
  return {
    deleteObjects: mod.deleteObjects,
    // ComparisonPredicateOperator.equalTo === 4 (QueryOptions enum). Read it
    // from the module so a future enum reorder can't silently break the filter.
    equalTo: mod.ComparisonPredicateOperator?.equalTo ?? 4,
  };
}

/**
 * Delete every TrainingLog HKWorkout whose `HKExternalUUID` metadata equals
 * `sessionId`. Returns the number deleted (0 on any failure). Never throws.
 */
export async function deleteTrainingLogWorkout(
  sessionId: string
): Promise<number> {
  try {
    const { deleteObjects, equalTo } = getNativeDeleter();
    const count = await deleteObjects(WorkoutTypeIdentifier, {
      metadata: {
        withMetadataKey: 'HKExternalUUID',
        operatorType: equalTo,
        value: sessionId,
      },
    });
    return typeof count === 'number' ? count : 0;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[hk-deleter] deleteTrainingLogWorkout failed:', err);
    return 0;
  }
}
