import type { Database } from '../../db/types';
import {
  getHKAuthorizationRequested,
  setHKAuthorizationRequested,
} from '../sqlite/settingsRepository';
import type { HKPermissionState } from './types';

/**
 * HealthKit permission gateway — slice 13b foundation.
 *
 * Backed by `@kingstinct/react-native-healthkit@14.x` (Nitro / New
 * Architecture compatible). The original choice in ADR-0019 § Phase B
 * scope was `react-native-health` but it ships a legacy bridge that fails
 * to register under New Arch (`NativeModules.AppleHealthKit === undefined`
 * → `initHealthKit is not a function` runtime error). Since Expo SDK 54
 * forces New Arch on (via `react-native-reanimated`'s Podspec assertion),
 * the Kingstinct fork is the only compatible HK package as of 2026-05-25.
 *
 * iOS HealthKit has a *one-shot* permission dialog: once the OS shows it
 * (regardless of grant/deny outcome), the same app can never re-trigger
 * the dialog from code. The user has to go to Settings.app → Privacy →
 * Health → TrainingLog to change their answer.
 *
 * Privacy quirk: there's no read-back API for "is this scope authorized?"
 * Apple intentionally hides that to prevent fingerprinting. The only way
 * to know is to query and see if you get data (or an empty result). So
 * `'requested'` here means "we asked at least once" — not "user said yes."
 */

/**
 * Lazily imported so jest can mock the native module per-test.
 *
 * Kingstinct exports named bindings (no default surface):
 *   `requestAuthorization({ toRead, toShare }) → Promise<boolean>`
 *
 * The Promise resolves to a boolean whose meaning is misleading — `false`
 * just means "the user dismissed without granting anything"; it does NOT
 * tell us per-scope status. We treat any resolve (true OR false) as
 * "dialog completed" and flip local state to `'requested'`.
 */
function getNativeRequestAuthorization(): (toRequest: {
  toShare?: readonly string[];
  toRead?: readonly string[];
}) => Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('@kingstinct/react-native-healthkit');
  return mod.requestAuthorization;
}

/**
 * Trigger the HealthKit permission dialog.
 *
 * READ: HeartRate + ActiveEnergyBurned (slice 13b scope; slice 13c reads
 * these for the detail page 4-tile + HR chart).
 * WRITE: Workout (slice 13b scope; slice 13c-d writes when no Apple Watch
 * tracked the session, per ADR-0019 § Q8 Fitness app 覆蓋率 amendment).
 *
 * Behaviour:
 *   - First call → iOS shows the system dialog. Once user dismisses (Allow
 *     or Deny on every scope), we `markAuthorizationRequested` so the
 *     Settings UI flips into the "已連結" view.
 *   - Second+ call → iOS does NOT show the dialog (already-answered state).
 *     The promise still resolves cleanly so the UI can safely call this
 *     idempotently.
 *
 * Errors from RN-Healthkit (e.g. running on a non-iOS host, simulator
 * gaps, entitlement misconfig) reject the promise.
 */
export async function requestHKAuthorization(db: Database): Promise<void> {
  const requestAuthorization = getNativeRequestAuthorization();
  await requestAuthorization({
    toRead: [
      'HKQuantityTypeIdentifierHeartRate',
      'HKQuantityTypeIdentifierActiveEnergyBurned',
    ],
    toShare: ['HKWorkoutTypeIdentifier'],
  });
  await markAuthorizationRequested(db);
}

/** Local-only flag: have we ever shown the OS dialog? */
export async function getAuthorizationState(
  db: Database
): Promise<HKPermissionState> {
  const requested = await getHKAuthorizationRequested(db);
  return requested ? 'requested' : 'never';
}

/** Idempotent — second call after `'requested'` is a no-op. */
export async function markAuthorizationRequested(db: Database): Promise<void> {
  await setHKAuthorizationRequested(db, true);
}

/**
 * Test-only helper. Production code paths never go from 'requested' back
 * to 'never' (iOS never forgets the dialog answer; flipping our local flag
 * would just desync the UI). Tests need to reset between cases.
 */
export async function resetAuthorizationStateForTests(
  db: Database
): Promise<void> {
  await setHKAuthorizationRequested(db, false);
}
