/**
 * Slice 13c — `syncSessionWithHealthKit` regression tests.
 *
 * The service module wraps the on-finish HealthKit best-effort sync that
 * was extracted from `app/(tabs)/index.tsx` `finalizeEndAndRoute`. Before
 * this suite the contract was only exercised via iPhone smoke; these tests
 * lock in:
 *
 *   1. happy path  — reader + writer both succeed → persist (kcal, uuid)
 *   2. reader fail — aggregate returns null → persist (null, uuid)
 *   3. writer fail — saveTrainingLogWorkout returns null → persist (kcal, null)
 *   4. ended_at=null guard — service short-circuits without calling adapters
 *   5. freestyle title fallback — session.title='' uses `fallbackTitle` so
 *      Apple Fitness doesn't silently fall back to the activityType
 *      localized name (regression on commit 936339b).
 *
 * We deliberately inject all 4 collaborators via `deps` instead of relying
 * on the production adapters: it lets the suite run under `testEnvironment:
 * node` without standing up better-sqlite3 or jest.mock-ing the Kingstinct
 * native module. The contract under test is the orchestration shape, not
 * the SQL or the Apple bridge — those are covered by
 * `tests/db/setSessionHealthKitData.test.ts`,
 * `tests/adapters/healthkit/reader.test.ts`, and
 * `tests/adapters/healthkit/writer.test.ts`.
 */

// The service module transitively imports the writer module
// (`@kingstinct/react-native-healthkit` at the top level for the
// `WorkoutActivityType` enum), and the Kingstinct package barrel pulls in
// react-native ESM modules that crash under `testEnvironment: node`. Mock
// it the same way `tests/adapters/healthkit/writer.test.ts` does so the
// service module can be imported. We never actually invoke the writer
// here — every test injects a `saveTrainingLogWorkout` mock via `deps`.
jest.mock('@kingstinct/react-native-healthkit', () => ({
  __esModule: true,
  saveWorkoutSample: jest.fn(),
  queryQuantitySamples: jest.fn(),
  WorkoutActivityType: { traditionalStrengthTraining: 20 },
}));

import { syncSessionWithHealthKit } from '../../src/services/healthkitSessionSync';
import type { Session } from '../../src/domain/session/types';
import type { Database } from '../../src/db/types';

// Minimal Database stub — none of these methods get called (we mock every
// adapter that touches the DB), but we need an object to satisfy the
// function signature.
const dbStub = {} as unknown as Database;

const SESSION_ID = 'sess-13c-svc-1';
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

describe('Slice 13c — syncSessionWithHealthKit', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('happy path: reader + writer both succeed → persists (kcal, uuid)', async () => {
    const getSession = jest.fn().mockResolvedValue(makeSession());
    const aggregateActiveEnergyBurned = jest.fn().mockResolvedValue(300);
    const saveTrainingLogWorkout = jest.fn().mockResolvedValue('hk-1');
    const setSessionHealthKitData = jest.fn().mockResolvedValue(undefined);

    await syncSessionWithHealthKit(dbStub, SESSION_ID, {
      getSession,
      aggregateActiveEnergyBurned,
      saveTrainingLogWorkout,
      setSessionHealthKitData,
    });

    expect(aggregateActiveEnergyBurned).toHaveBeenCalledWith(STARTED_AT, ENDED_AT);
    expect(saveTrainingLogWorkout).toHaveBeenCalledWith({
      startMs: STARTED_AT,
      endMs: ENDED_AT,
      kcal: 300,
      title: 'Leg day',
      sessionId: SESSION_ID,
    });
    expect(setSessionHealthKitData).toHaveBeenCalledWith(dbStub, {
      id: SESSION_ID,
      kcal: 300,
      healthkit_workout_uuid: 'hk-1',
    });
  });

  it('reader returns null (e.g. HK denied) → persists (kcal=null, uuid="hk-1")', async () => {
    const getSession = jest.fn().mockResolvedValue(makeSession());
    // Production reader swallows native errors and returns null; we model
    // both that and the "reader threw" path by checking the post-sync
    // persisted shape. A throw inside the reader hits the outer try/catch
    // and skips persistence entirely (covered by the writer-throw case
    // below by symmetry). The kcal=null path is what reaches the writer.
    const aggregateActiveEnergyBurned = jest.fn().mockResolvedValue(null);
    const saveTrainingLogWorkout = jest.fn().mockResolvedValue('hk-1');
    const setSessionHealthKitData = jest.fn().mockResolvedValue(undefined);

    await syncSessionWithHealthKit(dbStub, SESSION_ID, {
      getSession,
      aggregateActiveEnergyBurned,
      saveTrainingLogWorkout,
      setSessionHealthKitData,
    });

    expect(saveTrainingLogWorkout).toHaveBeenCalledWith(
      expect.objectContaining({ kcal: null, title: 'Leg day' })
    );
    expect(setSessionHealthKitData).toHaveBeenCalledWith(dbStub, {
      id: SESSION_ID,
      kcal: null,
      healthkit_workout_uuid: 'hk-1',
    });
  });

  it('writer returns null (e.g. Apple Health unavailable) → persists (kcal=300, uuid=null)', async () => {
    const getSession = jest.fn().mockResolvedValue(makeSession());
    const aggregateActiveEnergyBurned = jest.fn().mockResolvedValue(300);
    const saveTrainingLogWorkout = jest.fn().mockResolvedValue(null);
    const setSessionHealthKitData = jest.fn().mockResolvedValue(undefined);

    await syncSessionWithHealthKit(dbStub, SESSION_ID, {
      getSession,
      aggregateActiveEnergyBurned,
      saveTrainingLogWorkout,
      setSessionHealthKitData,
    });

    expect(setSessionHealthKitData).toHaveBeenCalledWith(dbStub, {
      id: SESSION_ID,
      kcal: 300,
      healthkit_workout_uuid: null,
    });
  });

  it('session.ended_at=null guard → no HK adapter call at all', async () => {
    const getSession = jest.fn().mockResolvedValue(makeSession({ ended_at: null }));
    const aggregateActiveEnergyBurned = jest.fn();
    const saveTrainingLogWorkout = jest.fn();
    const setSessionHealthKitData = jest.fn();

    await syncSessionWithHealthKit(dbStub, SESSION_ID, {
      getSession,
      aggregateActiveEnergyBurned,
      saveTrainingLogWorkout,
      setSessionHealthKitData,
    });

    expect(aggregateActiveEnergyBurned).not.toHaveBeenCalled();
    expect(saveTrainingLogWorkout).not.toHaveBeenCalled();
    expect(setSessionHealthKitData).not.toHaveBeenCalled();
  });

  it('freestyle session (title="") uses fallbackTitle for HK metadata (regression: commit 936339b)', async () => {
    const getSession = jest.fn().mockResolvedValue(makeSession({ title: '' }));
    const aggregateActiveEnergyBurned = jest.fn().mockResolvedValue(300);
    const saveTrainingLogWorkout = jest.fn().mockResolvedValue('hk-1');
    const setSessionHealthKitData = jest.fn().mockResolvedValue(undefined);

    await syncSessionWithHealthKit(dbStub, SESSION_ID, {
      getSession,
      aggregateActiveEnergyBurned,
      saveTrainingLogWorkout,
      setSessionHealthKitData,
      fallbackTitle: '空白訓練',
    });

    expect(saveTrainingLogWorkout).toHaveBeenCalledWith(
      expect.objectContaining({ title: '空白訓練' })
    );
  });

  it('reader throws → outer try/catch swallows, no persistence, promise still resolves', async () => {
    const getSession = jest.fn().mockResolvedValue(makeSession());
    const aggregateActiveEnergyBurned = jest
      .fn()
      .mockRejectedValue(new Error('HK denied'));
    const saveTrainingLogWorkout = jest.fn();
    const setSessionHealthKitData = jest.fn();

    await expect(
      syncSessionWithHealthKit(dbStub, SESSION_ID, {
        getSession,
        aggregateActiveEnergyBurned,
        saveTrainingLogWorkout,
        setSessionHealthKitData,
      })
    ).resolves.toBeUndefined();

    // The contract is best-effort: a throw in any HK step aborts the
    // remaining steps but never propagates — the session's DB row stays
    // intact (endSession already ran before this), the UI continues to
    // finish the flow, and detail page renders the "no HK data" empty
    // state.
    expect(saveTrainingLogWorkout).not.toHaveBeenCalled();
    expect(setSessionHealthKitData).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      '[healthkit] finish sync failed:',
      expect.any(Error)
    );
  });
});
