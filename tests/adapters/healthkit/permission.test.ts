/**
 * Slice 13b — HealthKit permission state machine tests.
 *
 * The native `@kingstinct/react-native-healthkit` binding doesn't load
 * under `testEnvironment: node` (it requires the iOS Nitro module), so
 * we mock it via `jest.mock` and assert the wrapper's Promise handling +
 * persisted-state transitions.
 *
 * What's covered:
 *   - default `getAuthorizationState` returns `'never'`
 *   - `markAuthorizationRequested` flips local state to `'requested'`
 *   - `requestHKAuthorization` happy path → callback resolves + state flips
 *   - `requestHKAuthorization` error path → rejects + state stays unchanged
 *
 * What's NOT covered (requires real iOS runtime):
 *   - real OS permission dialog
 *   - per-scope grant outcome (iOS hides this; we can't infer)
 *   - actual HK data reads (slice 13c)
 *   - HKWorkout writer (slice 13c-d)
 */

const requestAuthorizationMock = jest.fn();

jest.mock('@kingstinct/react-native-healthkit', () => ({
  __esModule: true,
  requestAuthorization: requestAuthorizationMock,
}));

import { BetterSqliteDatabase } from '../../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../../src/db/migrate';
import {
  getAuthorizationState,
  markAuthorizationRequested,
  requestHKAuthorization,
  resetAuthorizationStateForTests,
} from '../../../src/adapters/healthkit/permission';

describe('Slice 13b — HealthKit permission state machine', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    requestAuthorizationMock.mockReset();
  });

  afterEach(() => {
    db.close();
  });

  it('defaults to "never" on a fresh DB', async () => {
    const state = await getAuthorizationState(db);
    expect(state).toBe('never');
  });

  it('markAuthorizationRequested flips state to "requested"', async () => {
    expect(await getAuthorizationState(db)).toBe('never');
    await markAuthorizationRequested(db);
    expect(await getAuthorizationState(db)).toBe('requested');
  });

  it('markAuthorizationRequested is idempotent (second call still "requested")', async () => {
    await markAuthorizationRequested(db);
    await markAuthorizationRequested(db);
    expect(await getAuthorizationState(db)).toBe('requested');
  });

  it('requestHKAuthorization (happy path) flips state to "requested"', async () => {
    // Kingstinct API: requestAuthorization({ toShare, toRead }) → Promise<boolean>.
    // Happy path = resolves true (user granted at least one scope).
    requestAuthorizationMock.mockResolvedValue(true);

    await requestHKAuthorization(db);

    expect(requestAuthorizationMock).toHaveBeenCalledTimes(1);
    expect(await getAuthorizationState(db)).toBe('requested');

    // Verify the requested scopes match Q4 (ratified) + Q8 amendment (WRITE
    // Workout for iPhone 補寫 path).
    const args = requestAuthorizationMock.mock.calls[0][0] as {
      toShare?: readonly string[];
      toRead?: readonly string[];
    };
    expect(args.toRead).toEqual([
      'HKQuantityTypeIdentifierHeartRate',
      'HKQuantityTypeIdentifierActiveEnergyBurned',
    ]);
    expect(args.toShare).toEqual(['HKWorkoutTypeIdentifier']);
  });

  it('requestHKAuthorization (false resolve) still flips state to "requested"', async () => {
    // Kingstinct resolves `false` when user dismissed without granting
    // anything — but the OS dialog WAS shown, so we still mark as requested
    // (iOS won't re-show the dialog regardless of grant outcome).
    requestAuthorizationMock.mockResolvedValue(false);

    await requestHKAuthorization(db);

    expect(await getAuthorizationState(db)).toBe('requested');
  });

  it('requestHKAuthorization rejects on native error + state unchanged', async () => {
    requestAuthorizationMock.mockRejectedValue(
      new Error('entitlement missing or HK unavailable')
    );

    await expect(requestHKAuthorization(db)).rejects.toThrow(
      /entitlement missing/
    );
    expect(await getAuthorizationState(db)).toBe('never');
  });

  it('resetAuthorizationStateForTests round-trips back to "never"', async () => {
    await markAuthorizationRequested(db);
    expect(await getAuthorizationState(db)).toBe('requested');
    await resetAuthorizationStateForTests(db);
    expect(await getAuthorizationState(db)).toBe('never');
  });
});
