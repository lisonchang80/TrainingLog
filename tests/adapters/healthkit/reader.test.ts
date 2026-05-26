/**
 * Slice 13c — HealthKit reader adapter tests.
 *
 * Mirrors `permission.test.ts`'s setup: mock the Kingstinct native binding
 * (which can't load under `testEnvironment: node`) and assert the wrapper's
 * mapping + no-throw contract.
 *
 * What's covered:
 *   - `queryHeartRateSamples`: empty native result → `[]`
 *   - `queryHeartRateSamples`: 3 samples out-of-order → sorted ascending by ts
 *   - `queryHeartRateSamples`: ts = midpoint of [startDate, endDate]
 *   - `queryHeartRateSamples`: native rejects → `[]`, console.warn called
 *   - `aggregateActiveEnergyBurned`: 3 samples → sum
 *   - `aggregateActiveEnergyBurned`: empty array → 0
 *   - `aggregateActiveEnergyBurned`: native rejects → null, console.warn called
 *   - `aggregateActiveEnergyBurned`: ignores NaN/Infinity entries
 *
 * What's NOT covered (requires real iOS runtime):
 *   - actual HK source revision behaviour (sort hint honoring)
 *   - per-sample metadata (motion context, etc. — not consumed by chart)
 */

const queryQuantitySamplesMock = jest.fn();

jest.mock('@kingstinct/react-native-healthkit', () => ({
  __esModule: true,
  queryQuantitySamples: queryQuantitySamplesMock,
}));

import {
  aggregateActiveEnergyBurned,
  queryHeartRateSamples,
} from '../../../src/adapters/healthkit/reader';

describe('Slice 13c — HealthKit reader adapter', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    queryQuantitySamplesMock.mockReset();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe('queryHeartRateSamples', () => {
    it('returns [] when HK reports no samples in window', async () => {
      queryQuantitySamplesMock.mockResolvedValue([]);

      const result = await queryHeartRateSamples(1000, 2000);

      expect(result).toEqual([]);
      // Verify call shape (identifier + date filter + unit).
      const [identifier, options] = queryQuantitySamplesMock.mock.calls[0];
      expect(identifier).toBe('HKQuantityTypeIdentifierHeartRate');
      expect(options.unit).toBe('count/min');
      expect(options.filter.date.startDate.getTime()).toBe(1000);
      expect(options.filter.date.endDate.getTime()).toBe(2000);
    });

    it('sorts 3 out-of-order samples ascending by ts (midpoint)', async () => {
      // Native returns mid-tier first, then latest, then earliest. Each sample
      // has startDate / endDate as Date objects (Kingstinct's contract).
      queryQuantitySamplesMock.mockResolvedValue([
        {
          quantity: 130,
          startDate: new Date(1500),
          endDate: new Date(1500),
        },
        {
          quantity: 145,
          startDate: new Date(1900),
          endDate: new Date(1900),
        },
        {
          quantity: 110,
          startDate: new Date(1100),
          endDate: new Date(1100),
        },
      ]);

      const result = await queryHeartRateSamples(1000, 2000);

      expect(result).toEqual([
        { ts: 1100, bpm: 110 },
        { ts: 1500, bpm: 130 },
        { ts: 1900, bpm: 145 },
      ]);
    });

    it('uses midpoint of [startDate, endDate] for ts', async () => {
      // HK can report HR as a small interval (rare, but possible — typically
      // ~1s for Apple Watch). Midpoint keeps ts unbiased.
      queryQuantitySamplesMock.mockResolvedValue([
        {
          quantity: 120,
          startDate: new Date(1000),
          endDate: new Date(2000),
        },
      ]);

      const result = await queryHeartRateSamples(1000, 2000);

      expect(result).toEqual([{ ts: 1500, bpm: 120 }]);
    });

    it('returns [] and console.warns when native call rejects', async () => {
      queryQuantitySamplesMock.mockRejectedValue(
        new Error('HK entitlement missing')
      );

      const result = await queryHeartRateSamples(1000, 2000);

      expect(result).toEqual([]);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toMatch(/queryHeartRateSamples/);
    });

    it("passes unit 'count/min' to the native binding", async () => {
      // Explicit contract: HR samples MUST be requested in count/min so the
      // mapped bpm values land in the chart's [Y_BPM_MIN, Y_BPM_MAX] window.
      // If a future refactor accidentally drops the unit param, HK falls back
      // to its raw storage unit (also count/min in practice, but undocumented
      // — we want the call site to be explicit). Regression guard for the
      // call-shape, complementary to the broader assertion in the "empty
      // window" case.
      queryQuantitySamplesMock.mockResolvedValue([]);

      await queryHeartRateSamples(1000, 2000);

      expect(queryQuantitySamplesMock).toHaveBeenCalledTimes(1);
      const [identifier, options] = queryQuantitySamplesMock.mock.calls[0];
      expect(identifier).toBe('HKQuantityTypeIdentifierHeartRate');
      expect(options.unit).toBe('count/min');
    });
  });

  describe('aggregateActiveEnergyBurned', () => {
    it('sums quantity across 3 samples', async () => {
      queryQuantitySamplesMock.mockResolvedValue([
        { quantity: 12.5, startDate: new Date(1000), endDate: new Date(1100) },
        { quantity: 7.25, startDate: new Date(1200), endDate: new Date(1300) },
        { quantity: 3.0, startDate: new Date(1400), endDate: new Date(1500) },
      ]);

      const result = await aggregateActiveEnergyBurned(1000, 2000);

      expect(result).toBeCloseTo(22.75, 5);
      const [identifier, options] = queryQuantitySamplesMock.mock.calls[0];
      expect(identifier).toBe('HKQuantityTypeIdentifierActiveEnergyBurned');
      expect(options.unit).toBe('kcal');
    });

    it('returns 0 (not null) when HK reports empty array', async () => {
      // Successful query, no samples in window. Caller distinguishes 0 from
      // null: 0 = "definitively burned nothing tracked"; null = "we don't know".
      queryQuantitySamplesMock.mockResolvedValue([]);

      const result = await aggregateActiveEnergyBurned(1000, 2000);

      expect(result).toBe(0);
    });

    it('returns null and console.warns when native call rejects', async () => {
      queryQuantitySamplesMock.mockRejectedValue(
        new Error('HK permission denied')
      );

      const result = await aggregateActiveEnergyBurned(1000, 2000);

      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toMatch(/aggregateActiveEnergyBurned/);
    });

    it('skips NaN / Infinity entries when summing', async () => {
      // Defensive: HK shouldn't produce these, but if a third-party app wrote
      // garbage we don't want NaN to poison the whole session's kcal column.
      queryQuantitySamplesMock.mockResolvedValue([
        { quantity: 5, startDate: new Date(1000), endDate: new Date(1100) },
        {
          quantity: Number.NaN,
          startDate: new Date(1200),
          endDate: new Date(1300),
        },
        {
          quantity: Number.POSITIVE_INFINITY,
          startDate: new Date(1400),
          endDate: new Date(1500),
        },
        { quantity: 10, startDate: new Date(1600), endDate: new Date(1700) },
      ]);

      const result = await aggregateActiveEnergyBurned(1000, 2000);

      expect(result).toBe(15);
    });

    it("passes unit 'kcal' to the native binding", async () => {
      // Explicit contract: active-energy samples MUST be requested in kcal so
      // the session.kcal column + detail-page tile both read in the same unit
      // as the writer's HKWorkoutBuilder totals payload. If a future refactor
      // accidentally drops the unit (or sets it to 'J'), the kcal tile would
      // display ~4184× the expected value. Regression guard for the
      // call-shape, complementary to the broader assertion in the "sums 3
      // samples" case.
      queryQuantitySamplesMock.mockResolvedValue([]);

      await aggregateActiveEnergyBurned(1000, 2000);

      expect(queryQuantitySamplesMock).toHaveBeenCalledTimes(1);
      const [identifier, options] = queryQuantitySamplesMock.mock.calls[0];
      expect(identifier).toBe('HKQuantityTypeIdentifierActiveEnergyBurned');
      expect(options.unit).toBe('kcal');
    });
  });
});
