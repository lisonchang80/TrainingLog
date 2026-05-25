/**
 * HealthKit type surface for TrainingLog.
 *
 * `react-native-health` exposes 100+ permission strings; we surface only the
 * subset slice 13b requests + slice 13c-d will read/write. Adding more in
 * future slices = append here + extend the request call in `permission.ts`.
 */

/**
 * Local permission state — distinct from iOS's authorization status (which
 * is not exposed via the public RN-Health API for privacy reasons; you can
 * only infer it by attempting a read).
 *
 * `'never'` = OS dialog has never been shown for this app
 * `'requested'` = OS dialog has been shown at least once (regardless of
 *                 whether user granted or denied — iOS doesn't tell us
 *                 which)
 */
export type HKPermissionState = 'never' | 'requested';

/** READ scopes requested in slice 13b. Phase B sub-scopes append here. */
export type HKReadScope = 'heartRate' | 'activeEnergyBurned';

/**
 * WRITE scopes requested in slice 13b. Per ADR-0019 § Q8 (2026-05-25 grill),
 * iPhone補寫 HKWorkout when `session.healthkit_workout_uuid IS NULL` so all
 * sessions land in the Fitness app (slice 13c-d implements the writer).
 */
export type HKWriteScope = 'workout';
