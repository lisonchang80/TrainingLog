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

  // ---------------------------------------------------------------------
  // Regression sentinels — these tests guard the two real-device-smoke bug
  // fixes that 13c shipped. They overlap conceptually with earlier cases
  // but use the exact bug-report inputs so future failures point straight
  // at the originating commit.
  // ---------------------------------------------------------------------

  it('regression (commit 33eaa1f): metadata uses SHORT key names (HKWorkoutBrandName / HKExternalUUID), not HKMetadataKey* prefixed', async () => {
    // First slice 13c real-device smoke caught Apple Fitness displaying the
    // default localized activityType name (「傳統肌力訓練」) instead of
    // session.title. Root cause: writer originally used the full ObjC
    // constant names (`HKMetadataKeyWorkoutBrandName`,
    // `HKMetadataKeyExternalUUID`) as JS string keys, but Apple's stored
    // NSString values strip the `HKMetadataKey` prefix.
    // See .claude/skills/healthkit-metadata-debug/SKILL.md TL;DR table.
    saveWorkoutSampleMock.mockResolvedValue({ uuid: 'hk-regress-1' });

    await saveTrainingLogWorkout({
      ...input,
      kcal: 497,
      title: '胸推日',
      sessionId: 'S1',
    });

    const metadata = saveWorkoutSampleMock.mock.calls[0][5] as Record<
      string,
      unknown
    >;
    expect(metadata).toEqual({
      HKWorkoutBrandName: '胸推日',
      HKExternalUUID: 'S1',
    });
    // Belt-and-suspenders: assert the *wrong* (full ObjC) keys are NOT set.
    expect(metadata.HKMetadataKeyWorkoutBrandName).toBeUndefined();
    expect(metadata.HKMetadataKeyExternalUUID).toBeUndefined();
  });

  it('regression (commit e5732ac): activityType = traditionalStrengthTraining, not functional', async () => {
    // Originally shipped as `functionalStrengthTraining` (mirroring 訓記's
    // first-pass screenshot). Real-device smoke + closer review of 訓記's
    // other entries showed traditional is the right bucket for barbell /
    // dumbbell hypertrophy. Asserting via the imported enum symbol means
    // any silent regression to `functionalStrengthTraining` would resolve
    // to a different mocked value (or undefined) and fail this test.
    //
    // The mock maps traditionalStrengthTraining → 20 (see jest.mock above);
    // functionalStrengthTraining intentionally has no mapping, so a writer
    // regression would pass `undefined` as activityType and trip this assert.
    saveWorkoutSampleMock.mockResolvedValue({ uuid: 'hk-regress-2' });

    await saveTrainingLogWorkout(input);

    const activityType = saveWorkoutSampleMock.mock.calls[0][0];
    expect(activityType).toBe(TST_ENUM);
    expect(activityType).not.toBeUndefined();
    expect(activityType).not.toBeNull();
  });
});
