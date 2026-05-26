/**
 * HealthKit workout writer — slice 13c (C2).
 *
 * Persists each TrainingLog session as an HKWorkout sample so it surfaces in
 * Apple's Fitness app under「傳統肌力訓練」(traditionalStrengthTraining filter)
 * and contributes to 動態大卡 totals. Workout appears with TrainingLog's
 * session title (via HKWorkoutBrandName metadata) and the strength-training
 * dumbbell icon.
 *
 * Per ADR-0019 § Phase B Q6 / Q7 / Q8 grill (ratified 2026-05-26):
 *   - activityType = traditionalStrengthTraining (Apple HK enum; Kingstinct
 *     maps to the Apple-internal HKWorkoutActivityType raw value 50).
 *     **2026-05-26 fix**: originally functionalStrengthTraining (mirroring
 *     訓記's choice), changed to traditional after first real-device smoke
 *     because TrainingLog is a barbell/dumbbell-focused hypertrophy log —
 *     traditionalStrengthTraining semantically fits "重量訓練" (Apple's
 *     definition: "free weights or weight machines with a barbell, dumbbell,
 *     kettlebell"). functional is the broader "free weights or body weight"
 *     bucket — less precise for our domain.
 *   - We only write the *active* energy (`totalEnergyBurned` field). Apple
 *     HK sums basal samples from the user's HK profile, so writing basal
 *     ourselves would double-count. The field name is misleading — it IS
 *     the active calories.
 *   - Caller awaits this synchronously on session finish (Q7).
 *   - Writer NEVER throws — returns `null` on ANY failure so the finish
 *     flow stays "best effort". Logging is the only side effect.
 *   - No backfill — this is invoked for new sessions only (Q11).
 *
 * Why this isn't `saveHKWorkout` or similar generic name: the function is
 * deliberately scoped to TrainingLog's metadata shape (brand name + external
 * UUID) so other code paths don't accidentally bypass the
 * `HKMetadataKeyExternalUUID` reverse-lookup contract slice 13d relies on
 * when reconciling with Apple Watch-tracked counterparts.
 */

import { WorkoutActivityType } from '@kingstinct/react-native-healthkit';

export interface WorkoutWriteInput {
  /** session.start_at (epoch ms) */
  startMs: number;
  /** session.end_at (epoch ms) */
  endMs: number;
  /** Active energy burned during session (kcal). null → omit totalEnergyBurned field from HK call. */
  kcal: number | null;
  /** session.title — displayed in Apple Fitness app as the workout name via HKMetadataKeyWorkoutBrandName. */
  title: string;
  /** session.id (UUID string) — stored as HKMetadataKeyExternalUUID for reverse-lookup. */
  sessionId: string;
}

/**
 * Lazily imported so jest can mock the native module per-test, mirroring
 * the permission.ts pattern. The native `saveWorkoutSample` binding does
 * not load under `testEnvironment: node` (it requires the iOS Nitro module),
 * so production-style top-level imports would explode during test
 * collection. `jest.mock(...)` replaces the require below.
 */
function getNativeSaveWorkoutSample(): (
  workoutActivityType: WorkoutActivityType,
  quantities: readonly unknown[],
  startDate: Date,
  endDate: Date,
  totals?: { distance?: number; energyBurned?: number },
  metadata?: Record<string, unknown>
) => Promise<{ uuid: string }> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('@kingstinct/react-native-healthkit');
  return mod.saveWorkoutSample;
}

/**
 * Save an HKWorkout to HealthKit (activityType = functionalStrengthTraining).
 * Returns the HKWorkout UUID on success, null on any failure.
 * NEVER throws — caller treats null as "Fitness app sync skipped".
 *
 * Apple displays:
 *   - 動態大卡 = our totalEnergyBurned (kcal)
 *   - 總大卡 = active + basal (Apple sums basal samples from HK profile; we don't write basal)
 *   - HR chart / 平均心率 = Apple reads HK HR samples in [startMs, endMs] range (Watch wrote them)
 */
export async function saveTrainingLogWorkout(
  input: WorkoutWriteInput
): Promise<string | null> {
  try {
    const saveWorkoutSample = getNativeSaveWorkoutSample();

    // Build metadata. Apple's ObjC HKMetadataKey* constants are symbols that
    // resolve to SHORTER NSString values at link time — the actual key Apple
    // stores in HKWorkout.metadata is e.g. `"HKWorkoutBrandName"` (NOT
    // `"HKMetadataKeyWorkoutBrandName"`). Kingstinct's AnyMap bridge passes
    // JS keys through verbatim, so we must use the *serialized* values.
    //
    // First slice 13c real-device smoke (2026-05-26) caught this — workout
    // saved fine but Apple Fitness app showed the default "功能性肌力訓練"
    // (activityType localized name) instead of session.title because the
    // (wrong-keyed) metadata was silently ignored by Apple's reader.
    //
    // Mapping (per Apple HKMetadata.m / react-native-health convention):
    //   HKMetadataKeyWorkoutBrandName → "HKWorkoutBrandName"
    //   HKMetadataKeyExternalUUID     → "HKExternalUUID"
    const metadata: Record<string, unknown> = {
      HKWorkoutBrandName: input.title,
      HKExternalUUID: input.sessionId,
    };

    // OMIT energyBurned entirely when kcal is null — passing 0 would lie
    // about the session, and passing undefined as a property would still
    // serialize through the AnyMap into native land (Kingstinct's TS types
    // tolerate it but the Apple bridge may write 0). Build the totals
    // object conditionally.
    const totals: { energyBurned?: number } | undefined =
      input.kcal == null ? undefined : { energyBurned: input.kcal };

    const result = await saveWorkoutSample(
      WorkoutActivityType.traditionalStrengthTraining,
      [], // no per-sample quantity rows — Apple Watch (when present) writes its own HR samples; we only need the workout container
      new Date(input.startMs),
      new Date(input.endMs),
      totals,
      metadata
    );

    if (!result || typeof result.uuid !== 'string') {
      // Defensive — Nitro modules should always return the proxy, but if
      // somehow not, treat as failure rather than letting an undefined
      // propagate into session.healthkit_workout_uuid.
      // eslint-disable-next-line no-console
      console.warn(
        '[hk-writer] saveWorkoutSample returned no uuid; treating as failure'
      );
      return null;
    }

    return result.uuid;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[hk-writer] saveTrainingLogWorkout failed:', err);
    return null;
  }
}
