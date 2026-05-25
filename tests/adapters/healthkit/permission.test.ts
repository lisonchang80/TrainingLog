/**
 * Slice 13b — HealthKit permission state machine tests.
 *
 * The native `react-native-health` binding doesn't load under
 * `testEnvironment: node` (it requires the iOS native module), so we
 * mock it via `jest.mock` and assert the wrapper's callback handling
 * + persisted-state transitions.
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

const initHealthKitMock = jest.fn();

jest.mock('react-native-health', () => ({
  __esModule: true,
  default: {
    initHealthKit: initHealthKitMock,
  },
  initHealthKit: initHealthKitMock,
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
    initHealthKitMock.mockReset();
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
    // RN-Health's signature: callback(err, result). Happy path = err is
    // empty / falsy.
    initHealthKitMock.mockImplementation(
      (_perm: unknown, cb: (err: string) => void) => cb('')
    );

    await requestHKAuthorization(db);

    expect(initHealthKitMock).toHaveBeenCalledTimes(1);
    expect(await getAuthorizationState(db)).toBe('requested');

    // Verify the requested scopes match Q4 (ratified) + Q8 amendment (WRITE
    // Workout for iPhone 補寫 path).
    const args = initHealthKitMock.mock.calls[0][0] as {
      permissions: { read: string[]; write: string[] };
    };
    expect(args.permissions.read).toEqual(['HeartRate', 'ActiveEnergyBurned']);
    expect(args.permissions.write).toEqual(['Workout']);
  });

  it('requestHKAuthorization rejects on native error + state unchanged', async () => {
    initHealthKitMock.mockImplementation(
      (_perm: unknown, cb: (err: string) => void) =>
        cb('entitlement missing or HK unavailable')
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
