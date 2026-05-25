import type { Database } from '../../db/types';
import {
  getHKAuthorizationRequested,
  setHKAuthorizationRequested,
} from '../sqlite/settingsRepository';
import type { HKPermissionState } from './types';

/**
 * HealthKit permission gateway — slice 13b foundation.
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
 *
 * The 13b UI uses this state to switch button labels: 'never' shows the
 * "Connect Apple Health" CTA; 'requested' shows the "Open System Settings"
 * shortcut + a hint that the answer can only be changed from Settings.app.
 */

const NATIVE_MODULE = 'react-native-health';

/** Lazily imported so jest can mock the native module per-test. */
function getNativeAppleHealthKit(): typeof import('react-native-health').default {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require(NATIVE_MODULE);
  return mod.default ?? mod;
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
 * Errors from RN-Health (e.g. running on a non-iOS host, simulator gaps,
 * entitlement misconfig) reject the promise.
 */
export async function requestHKAuthorization(db: Database): Promise<void> {
  const AppleHealthKit = getNativeAppleHealthKit();
  const permissions = {
    permissions: {
      read: ['HeartRate', 'ActiveEnergyBurned'],
      write: ['Workout'],
    },
  };
  await new Promise<void>((resolve, reject) => {
    AppleHealthKit.initHealthKit(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      permissions as any,
      (err: string) => {
        if (err) {
          reject(new Error(err));
          return;
        }
        resolve();
      }
    );
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
