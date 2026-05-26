/**
 * Slice 13c — HealthKit workout writer tests.
 *
 * Mocks `saveWorkoutSample` from `@kingstinct/react-native-healthkit` and
 * verifies:
 *   - happy path returns the HK uuid + activityType=traditionalStrengthTraining
 *   - metadata wiring (HKWorkoutBrandName / HKExternalUUID)
 *   - kcal=null → totals argument omits energyBurned (not 0, not undefined-property)
 *   - kcal=number → totals.energyBurned matches input
 *   - native rejection → returns null without throwing (best-effort contract)
 *   - shape-defensive case where the bridge returns no uuid → null
 *
 * NOT covered (require real iOS runtime):
 *   - actual HK persistence
 *   - cross-app Fitness display
 *   - Watch HR sample range pickup
 */

const saveWorkoutSampleMock = jest.fn();

// The writer reads `WorkoutActivityType.traditionalStrengthTraining` at module
// load. The enum value in Kingstinct's generated module is 20; we mirror that
// here so the asserted activityType arg has a stable expected value.
jest.mock('@kingstinct/react-native-healthkit', () => ({
  __esModule: true,
  saveWorkoutSample: saveWorkoutSampleMock,
  WorkoutActivityType: {
    traditionalStrengthTraining: 20,
  },
}));

import { saveTrainingLogWorkout } from '../../../src/adapters/healthkit/writer';

const TST_ENUM = 20;

describe('Slice 13c — HealthKit workout writer', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    saveWorkoutSampleMock.mockReset();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  const input = {
    startMs: Date.UTC(2026, 4, 26, 10, 0, 0), // 2026-05-26T10:00:00Z
    endMs: Date.UTC(2026, 4, 26, 11, 30, 0), // 2026-05-26T11:30:00Z
    kcal: 497,
    title: '腿 (蹲)',
    sessionId: 'sess-uuid-abc-123',
  } as const;

  it('happy path: returns uuid + calls native with activityType=traditionalStrengthTraining', async () => {
    saveWorkoutSampleMock.mockResolvedValue({ uuid: 'hk-uuid-xyz' });

    const result = await saveTrainingLogWorkout(input);

    expect(result).toBe('hk-uuid-xyz');
    expect(saveWorkoutSampleMock).toHaveBeenCalledTimes(1);

    const args = saveWorkoutSampleMock.mock.calls[0];
    // saveWorkoutSample(activityType, quantities, startDate, endDate, totals, metadata)
    expect(args[0]).toBe(TST_ENUM);
    expect(args[1]).toEqual([]); // no per-sample quantities — workout container only
    expect(args[2]).toBeInstanceOf(Date);
    expect((args[2] as Date).getTime()).toBe(input.startMs);
    expect(args[3]).toBeInstanceOf(Date);
    expect((args[3] as Date).getTime()).toBe(input.endMs);
  });

  it('metadata: HKWorkoutBrandName === input.title', async () => {
    saveWorkoutSampleMock.mockResolvedValue({ uuid: 'hk-1' });

    await saveTrainingLogWorkout(input);

    const metadata = saveWorkoutSampleMock.mock.calls[0][5] as Record<
      string,
      unknown
    >;
    expect(metadata.HKWorkoutBrandName).toBe('腿 (蹲)');
  });

  it('metadata: HKExternalUUID === input.sessionId', async () => {
    saveWorkoutSampleMock.mockResolvedValue({ uuid: 'hk-1' });

    await saveTrainingLogWorkout(input);

    const metadata = saveWorkoutSampleMock.mock.calls[0][5] as Record<
      string,
      unknown
    >;
    expect(metadata.HKExternalUUID).toBe('sess-uuid-abc-123');
  });

  it('kcal passed: totals.energyBurned matches input', async () => {
    saveWorkoutSampleMock.mockResolvedValue({ uuid: 'hk-1' });

    await saveTrainingLogWorkout({ ...input, kcal: 497 });

    const totals = saveWorkoutSampleMock.mock.calls[0][4];
    expect(totals).toEqual({ energyBurned: 497 });
  });

  it('kcal=null: totals argument omits energyBurned (no 0, no null property)', async () => {
    saveWorkoutSampleMock.mockResolvedValue({ uuid: 'hk-1' });

    await saveTrainingLogWorkout({ ...input, kcal: null });

    const totals = saveWorkoutSampleMock.mock.calls[0][4];
    // Strict expectation: totals is undefined, not `{ energyBurned: 0 }` and
    // not `{ energyBurned: null }`. Apple HK would otherwise persist 0 kcal.
    expect(totals).toBeUndefined();
  });

  it('native rejection: returns null + warns + does NOT throw', async () => {
    saveWorkoutSampleMock.mockRejectedValue(
      new Error('HK entitlement missing or sim host')
    );

    const result = await saveTrainingLogWorkout(input);

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    const warnMsg = (warnSpy.mock.calls[0] as unknown[]).join(' ');
    expect(warnMsg).toMatch(/saveTrainingLogWorkout failed/);
  });

  it('defensive: bridge returns object without uuid → null + warn', async () => {
    saveWorkoutSampleMock.mockResolvedValue({} as { uuid?: string });

    const result = await saveTrainingLogWorkout(input);

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    const warnMsg = (warnSpy.mock.calls[0] as unknown[]).join(' ');
    expect(warnMsg).toMatch(/no uuid/);
  });
});
