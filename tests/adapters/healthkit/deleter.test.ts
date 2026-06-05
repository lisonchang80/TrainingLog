/**
 * Grill 2026-06-05 Q3 — HealthKit workout deleter call-shape tests.
 *
 * Mocks `deleteObjects` + `ComparisonPredicateOperator` from Kingstinct and
 * verifies the reverse-lookup filter (workout type + HKExternalUUID == sessionId
 * with the equality operator) and the never-throws / count contract.
 *
 * NOT covered (real iOS runtime): the actual HealthKit deletion.
 */

const deleteObjectsMock = jest.fn();

jest.mock('@kingstinct/react-native-healthkit', () => ({
  __esModule: true,
  deleteObjects: deleteObjectsMock,
  ComparisonPredicateOperator: { equalTo: 4 },
  WorkoutTypeIdentifier: 'HKWorkoutTypeIdentifier',
}));

import { deleteTrainingLogWorkout } from '../../../src/adapters/healthkit/deleter';

describe('Grill 2026-06-05 Q3 — deleteTrainingLogWorkout', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    deleteObjectsMock.mockReset();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warnSpy.mockRestore());

  it('deletes HKWorkout by HKExternalUUID == sessionId, returns the count', async () => {
    deleteObjectsMock.mockResolvedValue(1);

    const n = await deleteTrainingLogWorkout('sess-42');

    expect(n).toBe(1);
    expect(deleteObjectsMock).toHaveBeenCalledWith('HKWorkoutTypeIdentifier', {
      metadata: {
        withMetadataKey: 'HKExternalUUID',
        operatorType: 4, // ComparisonPredicateOperator.equalTo
        value: 'sess-42',
      },
    });
  });

  it('native rejection → returns 0 without throwing (best-effort)', async () => {
    deleteObjectsMock.mockRejectedValue(new Error('HK delete denied'));

    await expect(deleteTrainingLogWorkout('sess-42')).resolves.toBe(0);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('non-number return → coerced to 0', async () => {
    deleteObjectsMock.mockResolvedValue(undefined);
    await expect(deleteTrainingLogWorkout('sess-42')).resolves.toBe(0);
  });
});
