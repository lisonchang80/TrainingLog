/**
 * HealthKit adapter — slice 13b foundation.
 *
 * Single import surface for the rest of the app. Phase B feature work
 * (slice 13c-d HR/kcal reads + HKWorkout writes) imports through this
 * module so we have one place to swap implementations or stub for tests.
 *
 * Why a wrapper instead of importing `react-native-health` directly?
 *   - tests live in `testEnvironment: node`; importing the native module
 *     anywhere in a test code-path explodes with `Cannot read properties
 *     of undefined (reading 'initHealthKit')`. The wrapper lets us mock
 *     just this module in test setup.
 *   - `react-native-health`'s callback API is uniformly ugly; the wrapper
 *     promisifies it for the rest of the app.
 *
 * slice 13b ships ONLY permission + auth state tracking. The actual data
 * read helpers (`fetchHRSamples`, `fetchActiveEnergy`, `writeWorkout`)
 * land in slice 13c-d.
 */

export {
  requestHKAuthorization,
  getAuthorizationState,
  markAuthorizationRequested,
  resetAuthorizationStateForTests,
} from './permission';

export type { HKPermissionState, HKReadScope, HKWriteScope } from './types';

// --- agent-A-reader-13c BEGIN ---
export { queryHeartRateSamples, aggregateActiveEnergyBurned } from './reader';
// --- agent-A-reader-13c END ---
