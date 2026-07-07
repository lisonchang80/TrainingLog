/**
 * Launch invariant: `syncSessionWithHealthKit` NEVER throws — no HealthKit
 * failure may crash the session-finish flow (ADR-0019 § Phase B Q8 best-effort
 * contract). `endSession` has already committed the user's data before this
 * runs; an exception escaping here would surface as a crash on 結束訓練, the
 * single worst moment to crash for a training log.
 *
 * `healthkitSessionSync.test.ts` locks the happy path + the null-RETURN legs
 * (reader/writer return null) + a reader-THROWS case. This file completes the
 * THROW matrix that the shared outer try/catch must swallow: getSession throws,
 * the writer throws, and the final DB persist throws (the last is the most
 * dangerous — it happens AFTER the HK reads succeeded, so a naive
 * implementation that only guarded the reads would still crash here).
 *
 * Every case asserts the promise RESOLVES (not rejects) and a single
 * console.warn diagnostic fired — the observable "best-effort skip" behaviour.
 */

// The service transitively imports the writer, which top-level-imports the
// Kingstinct native barrel (crashes under testEnvironment: node). Mock it the
// same way the sibling suites do; we inject every collaborator via `deps`.
jest.mock('@kingstinct/react-native-healthkit', () => ({
  __esModule: true,
  saveWorkoutSample: jest.fn(),
  queryQuantitySamples: jest.fn(),
  WorkoutActivityType: { traditionalStrengthTraining: 20 },
}));

import {
  rehealSessionKcal,
  syncSessionWithHealthKit,
} from '../../src/services/healthkitSessionSync';
import type { Session } from '../../src/domain/session/types';
import type { Database } from '../../src/db/types';

const dbStub = {} as unknown as Database;

const SESSION_ID = 'sess-nothrow-1';
const STARTED_AT = 1700000000000;
const ENDED_AT = 1700000300000; // +5 min

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: SESSION_ID,
    started_at: STARTED_AT,
    ended_at: ENDED_AT,
    bodyweight_snapshot_kg: 75,
    title: 'Leg day',
    is_watch_tracked: false,
    ...overrides,
  };
}

describe('syncSessionWithHealthKit — no-throw contract (throw matrix)', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('getSession throws (e.g. DB locked) → resolves, no adapter calls, warns', async () => {
    const getSession = jest.fn().mockRejectedValue(new Error('database is locked'));
    const aggregateActiveEnergyBurned = jest.fn();
    const saveTrainingLogWorkout = jest.fn();
    const setSessionHealthKitData = jest.fn();

    await expect(
      syncSessionWithHealthKit(dbStub, SESSION_ID, {
        getSession,
        aggregateActiveEnergyBurned,
        saveTrainingLogWorkout,
        setSessionHealthKitData,
      }),
    ).resolves.toBeUndefined();

    // The throw is at the very first step — nothing downstream runs.
    expect(aggregateActiveEnergyBurned).not.toHaveBeenCalled();
    expect(saveTrainingLogWorkout).not.toHaveBeenCalled();
    expect(setSessionHealthKitData).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      '[healthkit] finish sync failed:',
      expect.any(Error),
    );
  });

  it('writer throws (not just returns null) → resolves, persist skipped, warns', async () => {
    // saveTrainingLogWorkout is documented to return null on failure, but a
    // defensive contract must also survive an outright throw (e.g. the native
    // bridge rejecting rather than resolving null). The reader already ran, so
    // this proves the guard wraps the WHOLE sequence, not only the reads.
    const getSession = jest.fn().mockResolvedValue(makeSession());
    const aggregateActiveEnergyBurned = jest.fn().mockResolvedValue(300);
    const saveTrainingLogWorkout = jest
      .fn()
      .mockRejectedValue(new Error('HK bridge exploded'));
    const setSessionHealthKitData = jest.fn();

    await expect(
      syncSessionWithHealthKit(dbStub, SESSION_ID, {
        getSession,
        aggregateActiveEnergyBurned,
        saveTrainingLogWorkout,
        setSessionHealthKitData,
      }),
    ).resolves.toBeUndefined();

    expect(aggregateActiveEnergyBurned).toHaveBeenCalledTimes(1);
    // The throw pre-empts the persist — no half-written HK columns.
    expect(setSessionHealthKitData).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      '[healthkit] finish sync failed:',
      expect.any(Error),
    );
  });

  it('the final persist throws (AFTER HK reads succeeded) → still resolves, warns', async () => {
    // The most dangerous leg: reads + writer succeeded, then the DB write
    // rejects (disk full / locked). This is the case a "guard only the HK
    // calls" implementation would MISS — the exception escapes into
    // finalizeEndAndRoute and crashes 結束訓練. Lock it here.
    const getSession = jest.fn().mockResolvedValue(makeSession());
    const aggregateActiveEnergyBurned = jest.fn().mockResolvedValue(300);
    const saveTrainingLogWorkout = jest.fn().mockResolvedValue('hk-1');
    const setSessionHealthKitData = jest
      .fn()
      .mockRejectedValue(new Error('disk I/O error'));

    await expect(
      syncSessionWithHealthKit(dbStub, SESSION_ID, {
        getSession,
        aggregateActiveEnergyBurned,
        saveTrainingLogWorkout,
        setSessionHealthKitData,
      }),
    ).resolves.toBeUndefined();

    expect(setSessionHealthKitData).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      '[healthkit] finish sync failed:',
      expect.any(Error),
    );
  });

  it('getSession returns null (session vanished) → no HK calls, resolves silently', async () => {
    // Distinct from the ended_at=null guard already covered: here the row
    // itself is gone. The `session && session.ended_at != null` guard must
    // short-circuit without dereferencing null (a would-be TypeError crash).
    const getSession = jest.fn().mockResolvedValue(null);
    const aggregateActiveEnergyBurned = jest.fn();
    const saveTrainingLogWorkout = jest.fn();
    const setSessionHealthKitData = jest.fn();

    await expect(
      syncSessionWithHealthKit(dbStub, SESSION_ID, {
        getSession,
        aggregateActiveEnergyBurned,
        saveTrainingLogWorkout,
        setSessionHealthKitData,
      }),
    ).resolves.toBeUndefined();

    expect(aggregateActiveEnergyBurned).not.toHaveBeenCalled();
    expect(saveTrainingLogWorkout).not.toHaveBeenCalled();
    expect(setSessionHealthKitData).not.toHaveBeenCalled();
    // Clean short-circuit — no warn (this isn't an error, just nothing to do).
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe('rehealSessionKcal — no-throw contract (throw matrix)', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('getSession throws → returns null, warns, does not propagate', async () => {
    // The detail page calls this on open; a throw here would crash session
    // detail rendering. Returns null = "nothing healed" (the safe default).
    const getSession = jest.fn().mockRejectedValue(new Error('db locked'));

    await expect(
      rehealSessionKcal(dbStub, SESSION_ID, {
        getSession,
        getSessionKcal: jest.fn(),
        aggregateActiveEnergyBurned: jest.fn(),
        setSessionKcal: jest.fn(),
      }),
    ).resolves.toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      '[healthkit] kcal re-heal failed:',
      expect.any(Error),
    );
  });

  it('setSessionKcal throws mid-heal (AFTER a positive aggregate) → null, warns', async () => {
    // Watch-tracked ended session with empty kcal + a positive aggregate would
    // heal — but the persist rejects. Must not crash the detail page open.
    const getSession = jest
      .fn()
      .mockResolvedValue(makeSession({ is_watch_tracked: true }));
    const getSessionKcal = jest.fn().mockResolvedValue(null);
    const aggregateActiveEnergyBurned = jest.fn().mockResolvedValue(275);
    const setSessionKcal = jest
      .fn()
      .mockRejectedValue(new Error('disk full'));

    await expect(
      rehealSessionKcal(dbStub, SESSION_ID, {
        getSession,
        getSessionKcal,
        aggregateActiveEnergyBurned,
        setSessionKcal,
      }),
    ).resolves.toBeNull();
    expect(setSessionKcal).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      '[healthkit] kcal re-heal failed:',
      expect.any(Error),
    );
  });
});
