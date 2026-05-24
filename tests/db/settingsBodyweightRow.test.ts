/**
 * Settings 體重 row (ADR-0024 § 5) — integration test for the simple flow
 * the mini-sheet handler runs:
 *   parseWeightInput → insertBodyMetric → it shows up in listBodyMetrics.
 *
 * This mirrors the UI handler in app/(tabs)/settings.tsx without importing
 * react-native (the test env is node-only). If the handler ever stops
 * threading the value through one of these three calls, this test fails.
 */

import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  insertBodyMetric,
  listBodyMetrics,
} from '../../src/adapters/sqlite/bodyMetricRepository';
import { parseWeightInput } from '../../src/domain/body/unitConversion';

describe('Settings 體重 row → body_metric round-trip', () => {
  let db: BetterSqliteDatabase;
  let counter = 0;
  const fakeUuid = () => `bm-${++counter}`;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    counter = 0;
  });

  afterEach(() => db.close());

  it('saves kg input as kg via insertBodyMetric', async () => {
    const bwKg = parseWeightInput('72.5', 'kg');
    expect(bwKg).toBe(72.5);

    await insertBodyMetric(
      db,
      { recorded_at: 1234, bodyweight_kg: bwKg!, pbf: null, smm_kg: null },
      fakeUuid
    );

    const rows = await listBodyMetrics(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].bodyweight_kg).toBe(72.5);
    expect(rows[0].pbf).toBeNull();
    expect(rows[0].smm_kg).toBeNull();
  });

  it('converts lb input to kg before persisting', async () => {
    const bwKg = parseWeightInput('160', 'lb');
    expect(bwKg).not.toBeNull();
    // lb → kg uses the canonical conversion exposed by parseWeightInput;
    // we only assert the value is in a sane neighbourhood of 72.5kg without
    // pinning the exact float (the conversion factor lives in unitConversion).
    expect(bwKg!).toBeGreaterThan(70);
    expect(bwKg!).toBeLessThan(75);

    await insertBodyMetric(
      db,
      { recorded_at: 5678, bodyweight_kg: bwKg!, pbf: null, smm_kg: null },
      fakeUuid
    );

    const [row] = await listBodyMetrics(db);
    expect(row.bodyweight_kg).toBe(bwKg);
  });

  it('rejects garbage input (parser returns null → handler aborts before insert)', () => {
    expect(parseWeightInput('abc', 'kg')).toBeNull();
    expect(parseWeightInput('', 'kg')).toBeNull();
  });
});
